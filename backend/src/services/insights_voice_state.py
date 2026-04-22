"""Insights voice-state contract.

Frozen enum of states the Insights voice pipeline may emit to the frontend.
The actual wiring lives in the Insights WebSocket / WebRTC path that arrives
with Phase 4; this module exists so the contract is stable and testable first.

Mirrors :mod:`frontend/src/types/index.ts`'s ``InsightsVoiceState`` union.
"""

from __future__ import annotations

from typing import FrozenSet, Tuple

INSIGHTS_VOICE_STATES: Tuple[str, ...] = (
    "idle",
    "listening",
    "thinking",
    "speaking",
    "interrupted",
    "error",
)

_INSIGHTS_VOICE_STATE_SET: FrozenSet[str] = frozenset(INSIGHTS_VOICE_STATES)

DEFAULT_INSIGHTS_VOICE_STATE: str = "idle"


def is_valid_insights_voice_state(value: object) -> bool:
    """Return True when *value* is a recognised insights voice-state string."""

    return isinstance(value, str) and value in _INSIGHTS_VOICE_STATE_SET


def coerce_insights_voice_state(value: object) -> str:
    """Return *value* if valid, otherwise :data:`DEFAULT_INSIGHTS_VOICE_STATE`.

    Never raises. Designed for defensive use at the WebSocket boundary where
    upstream events may be malformed or from an older build.
    """

    if is_valid_insights_voice_state(value):
        return value  # type: ignore[return-value]
    return DEFAULT_INSIGHTS_VOICE_STATE
