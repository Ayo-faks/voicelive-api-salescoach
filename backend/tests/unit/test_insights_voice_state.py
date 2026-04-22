"""Unit tests for the Insights voice-state contract."""

from __future__ import annotations

import pytest

from src.services.insights_voice_state import (
    DEFAULT_INSIGHTS_VOICE_STATE,
    INSIGHTS_VOICE_STATES,
    coerce_insights_voice_state,
    is_valid_insights_voice_state,
)


def test_states_are_the_locked_set():
    assert INSIGHTS_VOICE_STATES == (
        "idle",
        "listening",
        "thinking",
        "speaking",
        "interrupted",
        "error",
    )


def test_default_is_idle():
    assert DEFAULT_INSIGHTS_VOICE_STATE == "idle"
    assert DEFAULT_INSIGHTS_VOICE_STATE in INSIGHTS_VOICE_STATES


@pytest.mark.parametrize("state", list(INSIGHTS_VOICE_STATES))
def test_valid_states_recognised(state):
    assert is_valid_insights_voice_state(state)
    assert coerce_insights_voice_state(state) == state


@pytest.mark.parametrize("bad", ["IDLE", "mute", "", None, 1, {"state": "idle"}, "idle "])
def test_invalid_states_rejected_and_coerced(bad):
    assert not is_valid_insights_voice_state(bad)
    assert coerce_insights_voice_state(bad) == DEFAULT_INSIGHTS_VOICE_STATE
