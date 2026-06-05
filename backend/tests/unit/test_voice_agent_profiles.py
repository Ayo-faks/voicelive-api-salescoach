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


def test_get_profile_learner_goals_shape():
    profile = get_profile("learner_goals")

    assert profile.id == "learner_goals"
    assert profile.voice == "en-NG-EzinneNeural"
    # Unlike the guided learner profile, goal intake must NOT force a tool call
    # every turn — the agent asks the guided questions first, then calls once.
    assert profile.forced_response_tool_name is None
    assert _tool_names(profile) == {"set_goal_and_recommend"}


def test_get_profile_learner_onboarding_shape():
    profile = get_profile("learner_onboarding")

    assert profile.id == "learner_onboarding"
    assert profile.voice == "en-NG-EzinneNeural"
    assert profile.forced_response_tool_name is None
    # Owns getting-to-know-you (set_profile) AND goals (set_goal_and_recommend),
    # but never consent.
    assert _tool_names(profile) == {"set_profile", "set_goal_and_recommend"}
    # The prompt explicitly instructs the agent never to record consent.
    assert "never ask about or record consent" in profile.system_prompt.lower()


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

def test_learner_profile_session_is_audio_only_no_avatar(monkeypatch):
    """Learner sessions must drop the AVATAR modality + avatar config so Azure
    streams audio over the realtime websocket via response.audio.delta.

    With AVATAR included, Azure routes synthesized speech through the avatar
    WebRTC track and only emits response.audio.done / transcript.done on the
    websocket, which leaves the learner UI silent.
    """
    from src.services import websocket_handler as wh

    monkeypatch.setattr(
        wh.config,
        "get",
        lambda key, default=None: {
            "azure_voice_name": "en-US-TestVoice",
            "azure_voice_type": "azure-standard",
            "azure_custom_lexicon_url": "",
            "azure_avatar_character": "meg",
            "azure_avatar_style": "casual",
        }.get(key, default),
    )

    profile = get_profile("learner")
    session = wh.VoiceProxyHandler(agent_manager=None)._build_session_config(
        None, profile, AgentProfileContext(scope="learner", child_id="kid-1")
    )

    modalities = [str(m) for m in session["modalities"]]
    assert "audio" in modalities
    assert "avatar" not in modalities
    assert session.get("avatar") is None
    assert session["output_audio_format"] == "pcm16"


def test_practice_profile_session_keeps_avatar(monkeypatch):
    """Regression: practice/teacher flow must keep AVATAR modality + config."""
    from src.services import websocket_handler as wh

    monkeypatch.setattr(
        wh.config,
        "get",
        lambda key, default=None: {
            "azure_voice_name": "en-US-TestVoice",
            "azure_voice_type": "azure-standard",
            "azure_custom_lexicon_url": "",
            "azure_avatar_character": "meg",
            "azure_avatar_style": "casual",
        }.get(key, default),
    )

    profile = get_profile("practice")
    session = wh.VoiceProxyHandler(agent_manager=None)._build_session_config(
        None, profile, AgentProfileContext(scope="practice")
    )

    modalities = [str(m) for m in session["modalities"]]
    assert "avatar" in modalities
    assert session.get("avatar") is not None
