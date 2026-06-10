"""Learner-scoped VoiceLive profile."""

from __future__ import annotations

import json
from typing import Any, Mapping

from azure.ai.voicelive.models import FunctionTool

from src.learning.learner_voice import LearnerVoiceTurnPlanner, LearnerVoiceTurnRequest
from src.learning.learner_voice_llm import build_default_voice_planner
from src.services.voice_agent_profiles.base import AgentProfile, AgentProfileContext

_PLANNER = LearnerVoiceTurnPlanner()

# Lazily-resolved planner for the realtime tool. Built on first use (not at
# import) so the feature flag / Azure config are read at connection time and we
# never construct the OpenAI client just by importing this module. When the
# voice LLM flag is on it is a ``ModelLearnerVoicePlanner`` that re-authors the
# wrong-answer explanation moment with grounded RAG; otherwise it stays the
# deterministic ``_PLANNER``. Both expose ``next_turn``.
_RESOLVED_PLANNER: LearnerVoiceTurnPlanner | None = None


def _resolve_planner() -> LearnerVoiceTurnPlanner:
    global _RESOLVED_PLANNER
    if _RESOLVED_PLANNER is None:
        _RESOLVED_PLANNER = build_default_voice_planner(_PLANNER)
    return _RESOLVED_PLANNER


LEARNER_SYSTEM_PROMPT = """
You are Wulo, a warm and encouraging Nigerian tutor for a learner.
Use the session context values: child_id, exam, class_year, and subject.
Always call get_next_card before giving lesson content or a question.
Never invent questions, answers, skills, progress, or facts about the learner.
Never claim to see the learner, their screen, or anything they have not shared.
Use simple language and keep encouragement brief.
When the card is multiple choice, read the stem, then read each option aloud one at a time.
If the learner answers, call get_next_card with the previous card id and their option choice.
If the learner says they already know a skill, call mark_known.

Speech formatting rules — this is voice-only, the learner hears every character:
- Never use LaTeX, markdown, code blocks, asterisks, underscores, or backslashes.
- Never write "\\(", "\\)", "\\[", "\\]", "$", or "$$" around equations.
- Read maths in plain spoken English: say "y equals three x squared plus four x",
  not "\\( y = 3x^2 + 4x \\)". Read "x²" as "x squared", "x³" as "x cubed",
  "x^n" as "x to the n", "a/b" as "a over b", and "√x" as "the square root of x".
- Read each option as "Option A: ...", "Option B: ..." — never spell punctuation.
- If you would normally write a symbol, say its name in words instead.
""".strip()

GET_NEXT_CARD_TOOL = FunctionTool(
    name="get_next_card",
    description=(
        "Fetch the next learner practice card from Wulo. Always use this "
        "instead of inventing lesson content."
    ),
    parameters={
        "type": "object",
        "properties": {
            "child_id": {"type": "string"},
            "exam": {"type": "string"},
            "class_year": {"type": "string"},
            "subject": {"type": "string"},
            "prev_card_id": {"type": "string"},
            "answer_choice": {"type": "string"},
        },
        "required": ["child_id", "exam", "class_year", "subject"],
    },
)

MARK_KNOWN_TOOL = FunctionTool(
    name="mark_known",
    description="Mark a learner skill as already known. This is a no-op until spaced repetition lands.",
    parameters={
        "type": "object",
        "properties": {
            "child_id": {"type": "string"},
            "skill_id": {"type": "string"},
        },
        "required": ["child_id", "skill_id"],
    },
)


def _as_json_dict(value: Any) -> dict[str, Any]:
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    if hasattr(value, "json"):
        return json.loads(value.json())
    return dict(value)


def _str_or_none(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None


def _get_next_card(arguments: Mapping[str, Any], context: AgentProfileContext) -> Mapping[str, Any]:
    child_id = _str_or_none(arguments.get("child_id")) or context.child_id or "learner"
    exam = _str_or_none(arguments.get("exam")) or context.exam
    class_year = _str_or_none(arguments.get("class_year")) or context.class_year
    subject = _str_or_none(arguments.get("subject")) or context.subject
    prev_card_id = context.last_card_id
    answer_choice = _str_or_none(arguments.get("answer_choice"))
    if answer_choice:
        answer_choice = answer_choice.strip().lower()

    request = LearnerVoiceTurnRequest(
        child_id=child_id,
        exam=exam,
        class_year=class_year,
        subject=subject,
        last_card_id=prev_card_id,
        last_kind="mcq-tap" if prev_card_id and answer_choice else context.last_kind,
        answer_option_id=answer_choice,
        advance=bool(prev_card_id and not answer_choice),
    )
    response = _resolve_planner().next_turn(request)
    payload = _as_json_dict(response)
    card = payload.get("card")
    if isinstance(card, dict):
        context.last_card_id = _str_or_none(card.get("card_id"))
        context.last_kind = _str_or_none(card.get("kind"))
    return payload


def _mark_known(_arguments: Mapping[str, Any], _context: AgentProfileContext) -> Mapping[str, Any]:
    return {"ok": True}


def build_profile() -> AgentProfile:
    return AgentProfile(
        id="learner",
        system_prompt=LEARNER_SYSTEM_PROMPT,
        tools=[GET_NEXT_CARD_TOOL, MARK_KNOWN_TOOL],
        voice="en-NG-EzinneNeural",
        temperature=0.6,
        max_response_output_tokens=900,
        forced_response_tool_name="get_next_card",
        tool_handlers={
            "get_next_card": _get_next_card,
            "mark_known": _mark_known,
        },
    )