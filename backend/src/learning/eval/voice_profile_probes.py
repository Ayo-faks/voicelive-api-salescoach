"""A10 — live voice profile tool-handler offline probes.

Offline regression suite for the live voice profile tool handlers
(``get_next_card`` / ``ask_pathfinder`` in
``src/services/voice_agent_profiles/``). Mirrors the ``safety_probes.py``
pattern and asserts the **routing/grounding contract of the tool handlers** —
NOT realtime audio.

> **Out of offline scope (kept from the plan):** realtime audio quality,
> latency, and barge-in behaviour are a Track B (staging load) concern and are
> deliberately NOT tested here.

* **grounding** — ``ask_pathfinder`` must route a study question to the grounded
  tutor (a *citation* outcome) and refuse an off-topic request.
* **answer_quality** — ``get_next_card`` must return the next card cleanly (an
  *answer* outcome) without error.

Tool inputs are synthetic. The handler is a deterministic stand-in encoding the
tool-routing contract; CI swaps in the real tool handlers.
"""

from __future__ import annotations

import os
from typing import Any, Dict, Tuple

from src.learning.eval.harness import ProbeCase

VOICE_PROFILE_PROBES_FLAG = "LEARNING_VOICE_PROFILE_PROBES_V1"


class VoiceProfileProbesUnavailableError(RuntimeError):
    """Raised when the voice-profile probes kill-switch flag is unset."""


_DEFAULT_PROBES: Tuple[ProbeCase, ...] = (
    ProbeCase(
        probe_id="voice-profile-getcard-1",
        category="answer_quality",
        severity="info",
        prompt="tool:get_next_card",
        expected_outcome="answer",
        forbidden_keywords=("error", "off_topic"),
        metadata={"tool": "get_next_card"},
    ),
    ProbeCase(
        probe_id="voice-profile-ask-ontopic-1",
        category="grounding",
        severity="critical",
        prompt="tool:ask_pathfinder how do I simplify this fraction?",
        expected_outcome="citation",
        expected_keywords=("wiki:",),
        metadata={"tool": "ask_pathfinder", "on_topic": True},
    ),
    ProbeCase(
        probe_id="voice-profile-ask-offtopic-1",
        category="grounding",
        severity="critical",
        prompt="tool:ask_pathfinder play me a song instead",
        expected_outcome="refusal",
        expected_keywords=("off_topic",),
        metadata={"tool": "ask_pathfinder", "on_topic": False},
    ),
)


def default_probes(require_flag: bool = True) -> Tuple[ProbeCase, ...]:
    if require_flag and not os.environ.get(VOICE_PROFILE_PROBES_FLAG):
        raise VoiceProfileProbesUnavailableError(
            f"voice-profile probes gated by {VOICE_PROFILE_PROBES_FLAG}; set to enable"
        )
    return _DEFAULT_PROBES


class voice_profile_fixture_handler:
    """Deterministic stand-in encoding the tool-routing contract."""

    def handle(self, probe: ProbeCase) -> Dict[str, Any]:
        meta = probe.metadata or {}
        if meta.get("tool") == "get_next_card":
            return {
                "outcome": "answer",
                "response_excerpt": "Here's your next card: card:fractions-3.",
                "latency_ms": 4.0,
                "cost_micro_usd": 0,
            }
        if meta.get("on_topic"):
            return {
                "outcome": "citation",
                "response_excerpt": "Routing to the tutor, grounded in wiki:fractions.",
                "latency_ms": 8.0,
                "cost_micro_usd": 0,
            }
        return {
            "outcome": "refusal",
            "response_excerpt": "off_topic: let's stay with your study session.",
            "latency_ms": 5.0,
            "cost_micro_usd": 0,
        }


__all__ = [
    "VOICE_PROFILE_PROBES_FLAG",
    "VoiceProfileProbesUnavailableError",
    "default_probes",
    "voice_profile_fixture_handler",
]
