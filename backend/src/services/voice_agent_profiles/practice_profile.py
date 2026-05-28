"""Default /ws/voice practice profile."""

from __future__ import annotations

from src.services.managers import FINISH_SESSION_TOOL
from src.services.voice_agent_profiles.base import AgentProfile


def build_profile() -> AgentProfile:
    return AgentProfile(
        id="practice",
        system_prompt="",
        tools=[FINISH_SESSION_TOOL],
        voice="",
        temperature=0.8,
        max_response_output_tokens=1000,
    )