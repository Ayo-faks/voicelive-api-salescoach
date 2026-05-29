"""Layer 3 — constrained-JSON LLM classifier.

Calls gpt-4o-mini (via the existing Azure OpenAI client) with a strict
JSON schema over our KCSIE-aligned taxonomy. The classifier is the
nuance layer: it catches soft disclosures the lexicon and Content
Safety miss (e.g. a child gently describing neglect). It is never the
sole gate.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from typing import Any, Mapping, Optional, Protocol, Sequence

from .models import KCSIE_CATEGORIES, LayerScore, Severity

logger = logging.getLogger(__name__)


ENV_MODEL = "SAFEGUARDING_CLASSIFIER_MODEL"
DEFAULT_MODEL = "gpt-4o-mini"


_SYSTEM_PROMPT = """\
You are a child-safeguarding classifier for an AI tutor used by children
in the UK. You receive a single utterance and must classify it against the
UK Keeping Children Safe in Education (KCSIE) taxonomy.

Return STRICT JSON with this shape and no extra text:
{
  "severity": "none" | "low" | "medium" | "high" | "critical",
  "categories": [<zero or more KCSIE category strings>],
  "rationale": "<one short sentence quoting the evidence>",
  "evidence_quote": "<the smallest verbatim span from the utterance that supports the call, or empty>"
}

Valid KCSIE category strings:
%s

Rules:
- Bias toward false positives. If unsure between low and none, choose low.
- "critical" is reserved for: explicit suicide ideation, active self-harm,
  explicit abuse disclosure (physical / sexual / emotional by an adult or
  carer), or clear, imminent danger to the child.
- Bullying / peer harm without injury: medium.
- General sadness, frustration, or academic stress with no harm indicator:
  none.
- Outbound checks: if the utterance is from the AI and contains harmful
  content directed at a child (insults, sexual content, medical advice,
  self-harm encouragement), use category "ai_harmful_output" and severity
  at least "high".
""" % "\n".join(f"- {c}" for c in KCSIE_CATEGORIES)


@dataclass(frozen=True)
class ClassifierResult:
    severity: Severity
    categories: tuple[str, ...]
    rationale: str
    evidence_quote: str


class _ChatCompletionsClient(Protocol):
    """Subset of the OpenAI client we use, narrowed for testability."""

    def create(self, **kwargs: Any) -> Any: ...


class SafeguardingClassifier:
    """LLM classifier using the existing Azure OpenAI ``chat.completions`` API."""

    def __init__(
        self,
        client_factory: Optional[Any] = None,
        *,
        model: Optional[str] = None,
    ):
        # ``client_factory`` is a no-arg callable returning an OpenAI-compatible
        # client. Resolved lazily so unit tests can inject without booting
        # the Azure auth path.
        self._client_factory = client_factory
        self._client: Any = None
        self._model = model or os.environ.get(ENV_MODEL, DEFAULT_MODEL)

    @property
    def model_version(self) -> str:
        return f"classifier:{self._model}"

    def _resolve_client(self) -> Optional[Any]:
        if self._client is not None:
            return self._client
        if self._client_factory is None:
            return None
        try:
            self._client = self._client_factory()
        except Exception as exc:  # noqa: BLE001
            logger.warning("Safeguarding classifier client init failed: %s", exc)
            self._client = None
        return self._client

    async def classify(
        self,
        text: str,
        *,
        direction: str = "inbound",
        context_turns: Sequence[str] = (),
    ) -> LayerScore:
        if not text or not text.strip():
            return LayerScore(layer="classifier", severity=Severity.NONE, model_version=self.model_version)

        client = self._resolve_client()
        if client is None:
            return LayerScore(
                layer="classifier",
                severity=Severity.NONE,
                raw={"skipped": "no_client"},
                model_version=self.model_version,
            )

        context_block = ""
        if context_turns:
            joined = "\n".join(f"- {t}" for t in context_turns[-5:])
            context_block = f"\n\nRecent prior turns (for context only):\n{joined}"

        user_msg = (
            f"Direction: {direction}\n"
            f"Utterance: \"\"\"{text}\"\"\"{context_block}\n\n"
            "Return JSON."
        )

        try:
            resp = await _run_in_thread(
                client.chat.completions.create,
                model=self._model,
                temperature=0,
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {"role": "user", "content": user_msg},
                ],
                max_tokens=300,
            )
        except Exception as exc:  # noqa: BLE001 — fail-open
            logger.warning("Safeguarding classifier call failed: %s", exc)
            return LayerScore(
                layer="classifier",
                severity=Severity.NONE,
                raw={"error": str(exc)[:120]},
                model_version=self.model_version,
            )

        return _parse_response(resp, model_version=self.model_version)


async def _run_in_thread(fn: Any, **kwargs: Any) -> Any:
    """Run a blocking SDK call off the event loop."""
    import asyncio

    return await asyncio.to_thread(lambda: fn(**kwargs))


def _parse_response(resp: Any, *, model_version: str) -> LayerScore:
    try:
        content = resp.choices[0].message.content or "{}"
        parsed: Mapping[str, Any] = json.loads(content)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Safeguarding classifier returned unparseable content: %s", exc)
        return LayerScore(
            layer="classifier",
            severity=Severity.NONE,
            raw={"error": "parse_failed"},
            model_version=model_version,
        )

    sev_raw = str(parsed.get("severity", "none")).lower()
    try:
        severity = Severity(sev_raw)
    except ValueError:
        severity = Severity.NONE

    cats_raw = parsed.get("categories") or []
    categories = tuple(
        c for c in cats_raw if isinstance(c, str) and c in KCSIE_CATEGORIES
    )

    return LayerScore(
        layer="classifier",
        severity=severity,
        categories=categories,
        raw={
            "rationale": str(parsed.get("rationale", ""))[:500],
            "evidence_quote": str(parsed.get("evidence_quote", ""))[:500],
        },
        model_version=model_version,
    )
