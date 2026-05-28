"""Tests for scoped VoiceLive agent profiles."""

from __future__ import annotations

import pytest

from src.services.voice_agent_profiles import AgentProfileContext, get_profile
from src.services.websocket_handler import VoiceProxyHandler


def _tool_names(profile) -> set[str]:
    return {str(tool.get("name") if isinstance(tool, dict) else getattr(tool, "name", "")) for tool in profile.tools}


def test_get_profile_practice_matches_existing_session_tool_shape():
    profile = get_profile("practice")
    session = VoiceProxyHandler(agent_manager=None)._build_session_config(None, profile, AgentProfileContext(scope="practice"))

    assert profile.id == "practice"
    assert _tool_names(profile) == {"finish_session"}
    assert {tool["name"] for tool in session["tools"]} == {"finish_session"}
    assert "instructions" not in session


def test_get_profile_learner_shape():
    profile = get_profile("learner")

    assert profile.id == "learner"
    assert profile.voice == "en-NG-EzinneNeural"
    assert profile.forced_response_tool_name == "get_next_card"
    assert {"get_next_card", "mark_known"} <= _tool_names(profile)


def test_get_profile_unknown_scope_raises():
    with pytest.raises(ValueError):
        get_profile("nope")


def test_learner_get_next_card_delegates_to_taxonomy_gate():
    profile = get_profile("learner")
    result = profile.handle_tool_call(
        "get_next_card",
        {
            "child_id": "stu-1",
            "exam": "JAMB",
            "class_year": "JSS2",
            "subject": "Mathematics",
        },
        AgentProfileContext(scope="learner"),
    )

    assert result["card"]["kind"] == "mark-known"


def test_learner_get_next_card_returns_matching_mcq():
    profile = get_profile("learner")
    result = profile.handle_tool_call(
        "get_next_card",
        {
            "child_id": "stu-1",
            "exam": "WAEC",
            "class_year": "SSS2",
            "subject": "Mathematics",
        },
        AgentProfileContext(scope="learner"),
    )

    assert result["card"]["kind"] == "mcq-tap"
    assert result["card"]["skill_id"] == "differentiation"


def test_learner_get_next_card_ignores_untracked_prev_card_id():
    profile = get_profile("learner")
    result = profile.handle_tool_call(
        "get_next_card",
        {
            "child_id": "stu-1",
            "exam": "WAEC",
            "class_year": "SSS2",
            "subject": "Mathematics",
            "prev_card_id": "made-up-card",
        },
        AgentProfileContext(scope="learner"),
    )

    assert result["card"]["kind"] == "mcq-tap"