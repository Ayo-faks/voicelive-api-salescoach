"""Registry for scoped VoiceLive agent profiles."""

from __future__ import annotations

from src.services.voice_agent_profiles.base import AgentProfile
from src.services.voice_agent_profiles.learner_ask_profile import build_profile as build_learner_ask_profile
from src.services.voice_agent_profiles.learner_goals_profile import build_profile as build_learner_goals_profile
from src.services.voice_agent_profiles.learner_onboarding_profile import build_profile as build_learner_onboarding_profile
from src.services.voice_agent_profiles.learner_profile import build_profile as build_learner_profile
from src.services.voice_agent_profiles.practice_profile import build_profile as build_practice_profile


def get_profile(scope: str) -> AgentProfile:
    normalized = (scope or "practice").strip().lower()
    if normalized == "practice":
        return build_practice_profile()
    if normalized == "learner":
        return build_learner_profile()
    if normalized == "learner_ask":
        return build_learner_ask_profile()
    if normalized == "learner_goals":
        return build_learner_goals_profile()
    if normalized == "learner_onboarding":
        return build_learner_onboarding_profile()
    raise ValueError(f"Unknown voice agent scope: {scope}")