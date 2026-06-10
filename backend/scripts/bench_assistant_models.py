"""Quick latency shoot-out for the Ask Wulo text tutor model swap.

Calls each deployed chat model with the tutor's REAL call shape (system prompt,
JSON mode, structured ~150-word answer) and reports wall-clock latency.
Run: python -m scripts.bench_assistant_models
"""

from __future__ import annotations

import json
import os
import statistics
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))

from openai import AzureOpenAI  # noqa: E402

ENDPOINT = os.environ["AZURE_OPENAI_ENDPOINT"]
KEY = os.environ.get("AZURE_OPENAI_API_KEY", "")

CANDIDATES = [s.strip() for s in (sys.argv[1:] or ["gpt-4o", "gpt-5.2-chat", "gpt-5.3-chat"])]
ROUNDS = int(os.environ.get("BENCH_ROUNDS", "3"))

SYSTEM = (
    "You are Pathfinder, a patient study tutor for Nigerian secondary-school "
    "learners. Ground every fact in the numbered SOURCES. Use this structure: "
    "one direct answer line, '**Why it matters:**', '**Quick breakdown:**' with "
    "3-5 bullets, '**Try this:**' numbered steps, '**In short:**' recap. Keep it "
    "about 90-180 words. Return ONLY a JSON object: "
    '{"answer": "<reply>", "sources_used": [<numbers>]}'
)
SOURCES = (
    "SOURCES:\n[S1] Photosynthesis: Photosynthesis is the process by which green "
    "plants use sunlight, water and carbon dioxide to make glucose and oxygen. "
    "It happens in the chloroplasts which contain chlorophyll. The word equation "
    "is carbon dioxide + water -> glucose + oxygen (in the presence of light and "
    "chlorophyll).\n[S2] Leaf structure: The palisade mesophyll has many "
    "chloroplasts and sits near the upper surface to absorb maximum light."
)
QUESTION = "what is photosynthesis?"


def bench(client: AzureOpenAI, model: str) -> None:
    times: list[float] = []
    note = ""
    kwargs = dict(
        model=model,
        messages=[
            {"role": "system", "content": SYSTEM},
            {"role": "system", "content": SOURCES},
            {"role": "user", "content": QUESTION},
        ],
        response_format={"type": "json_object"},
        temperature=0.3,
        max_tokens=600,
    )
    for i in range(ROUNDS):
        completion = None
        for _attempt in range(3):
            t0 = time.perf_counter()
            try:
                completion = client.chat.completions.create(**kwargs)
                break
            except Exception as exc:  # noqa: BLE001
                msg = str(exc)
                adapted = False
                # Newer model families reject max_tokens / non-default temperature.
                if "max_tokens" in msg and "max_tokens" in kwargs:
                    kwargs.pop("max_tokens", None)
                    kwargs["max_completion_tokens"] = 600
                    note += " [needs max_completion_tokens]"
                    adapted = True
                if "temperature" in msg and "temperature" in kwargs:
                    kwargs.pop("temperature", None)
                    note += " [no temperature]"
                    adapted = True
                if not adapted:
                    print(f"{model:14s} round {i+1}: FAILED {msg[:140]}")
                    return
        if completion is None:
            print(f"{model:14s} round {i+1}: FAILED after adaptation retries")
            return
        ms = (time.perf_counter() - t0) * 1000
        content = completion.choices[0].message.content or ""
        try:
            payload = json.loads(content)
            words = len(str(payload.get("answer", "")).split())
            ok = "ok" if payload.get("answer") else "EMPTY"
        except json.JSONDecodeError:
            words, ok = 0, "BAD-JSON"
        usage = completion.usage
        reasoning = 0
        details = getattr(usage, "completion_tokens_details", None)
        if details is not None:
            reasoning = getattr(details, "reasoning_tokens", 0) or 0
        times.append(ms)
        print(
            f"{model:14s} round {i+1}: {ms:7.0f} ms  json={ok}  words={words:3d}  "
            f"completion_tokens={usage.completion_tokens}  reasoning_tokens={reasoning}"
        )
    if times:
        print(
            f"{model:14s} median {statistics.median(times):7.0f} ms  "
            f"min {min(times):7.0f} ms{note}"
        )
    print()


def main() -> None:
    client = AzureOpenAI(
        api_version="2024-12-01-preview",
        azure_endpoint=ENDPOINT,
        api_key=KEY,
    )
    print(f"endpoint={ENDPOINT}  rounds={ROUNDS}\n")
    for model in CANDIDATES:
        bench(client, model)


if __name__ == "__main__":
    main()
