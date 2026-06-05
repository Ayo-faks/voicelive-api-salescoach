"""Post-consent "voice onboarding" VoiceLive profile.

The voice agent that runs the getting-to-know-you part of onboarding AND the
goal intake in one conversation. After the learner has given the explicit,
auditable consents (a short text step the agent never owns), this profile
collects — conversationally, one thing at a time — their name, age band, exam,
year group, subjects, and interests, persisting each via ``set_profile``; then it
captures their study goal via ``set_goal_and_recommend`` and reads back instant
"start here" recommendations. The same data immediately personalises learning,
because both tools write to the same profile/goal stores the planner reads.

Consents are deliberately out of scope here: the agent must never assert
terms/privacy/AI consent on the learner's behalf (a spoken "sure" is not a sound
legal basis, and the under-13 guardian gate is a safeguarding control). The
client gates consents before opening this scope.
"""

from __future__ import annotations

from typing import Any, Mapping

from azure.ai.voicelive.models import FunctionTool

from src.services.voice_agent_profiles.base import AgentProfile, AgentProfileContext

LEARNER_ONBOARDING_SYSTEM_PROMPT = """
You are Pathfinder, a warm and encouraging Nigerian tutor welcoming a new
learner who has just agreed to the terms and is setting up their account by
voice. Keep it light, friendly, and quick — this is a chat, not a form.

Collect these, ONE AT A TIME, in this order, reading any choices aloud:
1. Their first name. ("What should I call you?")
2. Their age band — under 13, 13 to 15, 16 to 17, 18 to 24, or 25 plus.
3. The exam they're preparing for — WAEC, NECO, JAMB, Junior WAEC, IGCSE, or
   A-Level.
4. Their class / year group — JSS1, JSS2, JSS3, SS1, SS2, or SS3.
5. The subjects they want to study (they can name a few).
6. Optionally, what careers or topics they're interested in.

As you gather each batch of answers, call the set_profile tool with what you
have so far (all fields optional — pass only what they told you). You may call
set_profile more than once as you learn more.

After the profile is set, ask their study goal: what to focus on first, whether
they're working toward an exam, and by when. Then call set_goal_and_recommend
ONCE and warmly read back the recommended starting point it returns.

Only speak what the tools return for recommendations — never invent skills,
plans, or facts about the learner. Never claim to see the learner or their
screen. Never ask about or record consent, passwords, or payment — those are
handled elsewhere. Use simple language and keep encouragement brief.

Speech formatting rules — this is voice-only, the learner hears every character:
- Never use LaTeX, markdown, code blocks, asterisks, underscores, or backslashes.
- Read maths in plain spoken English (say "x squared", not symbols).
""".strip()

SET_PROFILE_TOOL = FunctionTool(
    name="set_profile",
    description=(
        "Save the learner's getting-to-know-you details during voice onboarding. "
        "All fields are optional — pass only what the learner has shared so far. "
        "Does NOT handle consent, which is captured separately."
    ),
    parameters={
        "type": "object",
        "properties": {
            "display_name": {
                "type": "string",
                "description": "The learner's first name or what to call them.",
            },
            "age_band": {
                "type": "string",
                "enum": ["under-13", "13-15", "16-17", "18-24", "25-plus"],
                "description": "Their age band.",
            },
            "exam": {
                "type": "string",
                "enum": ["WAEC", "NECO", "JAMB", "Junior WAEC", "IGCSE", "A-Level"],
                "description": "The exam they're preparing for.",
            },
            "year_group": {
                "type": "string",
                "enum": ["JSS1", "JSS2", "JSS3", "SS1", "SS2", "SS3"],
                "description": "Their class / year group.",
            },
            "subjects": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Subjects they want to study.",
            },
            "interests": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Career or topic interests (optional).",
            },
        },
        "required": [],
    },
)

SET_GOAL_AND_RECOMMEND_TOOL = FunctionTool(
    name="set_goal_and_recommend",
    description=(
        "Save the learner's study goal and return instant 'start here' "
        "recommendations. Call once, after the profile is set."
    ),
    parameters={
        "type": "object",
        "properties": {
            "subject": {
                "type": "string",
                "description": "Subject to focus on first.",
            },
            "exam": {
                "type": "string",
                "enum": ["WAEC", "NECO", "JAMB", "Junior WAEC", "IGCSE", "A-Level"],
                "description": "Exam they're working toward, if any.",
            },
            "target_date": {
                "type": "string",
                "enum": ["this_term", "this_year", "no_deadline"],
                "description": "How soon they want to be ready.",
            },
            "note": {
                "type": "string",
                "description": "Any optional free-form note.",
            },
        },
        "required": [],
    },
)


def _str_or_none(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None


def _set_profile(arguments: Mapping[str, Any], context: AgentProfileContext) -> Mapping[str, Any]:
    """Persist the spoken profile fields via the shared orchestrator.

    Lazily imports ``apply_learner_profile_from_voice`` (which owns
    ``storage_service`` + validation) because the profile registry is imported
    during app boot — a top-level import would be circular.
    """
    from src.app import apply_learner_profile_from_voice  # lazy: avoids circular import

    user_id = context.child_id or "learner"
    fields = {
        "display_name": arguments.get("display_name"),
        "age_band": arguments.get("age_band"),
        "exam": arguments.get("exam"),
        "year_group": arguments.get("year_group"),
        "subjects": arguments.get("subjects"),
        "interests": arguments.get("interests"),
    }
    try:
        result = apply_learner_profile_from_voice(user_id, fields)
    except Exception:  # noqa: BLE001 - never crash the realtime session on a bad field
        return {"ok": False}
    return {"ok": True, "needs_onboarding": bool(result.get("needs_onboarding", True))}


def _set_goal_and_recommend(
    arguments: Mapping[str, Any], context: AgentProfileContext
) -> Mapping[str, Any]:
    """Persist the spoken goal and return "start here" recommendation blocks."""
    from src.app import apply_learner_goal_and_recommend  # lazy: avoids circular import

    learner_id = context.child_id or "learner"
    goal_input = {
        "subject": _str_or_none(arguments.get("subject")),
        "exam": _str_or_none(arguments.get("exam")),
        "target_date": _str_or_none(arguments.get("target_date")),
        "note": _str_or_none(arguments.get("note")),
    }
    result = apply_learner_goal_and_recommend(
        user_id=learner_id, student_id=learner_id, goal_input=goal_input
    )
    return dict(result)


def build_profile() -> AgentProfile:
    return AgentProfile(
        id="learner_onboarding",
        system_prompt=LEARNER_ONBOARDING_SYSTEM_PROMPT,
        tools=[SET_PROFILE_TOOL, SET_GOAL_AND_RECOMMEND_TOOL],
        voice="en-NG-EzinneNeural",
        temperature=0.6,
        max_response_output_tokens=900,
        forced_response_tool_name=None,
        tool_handlers={
            "set_profile": _set_profile,
            "set_goal_and_recommend": _set_goal_and_recommend,
        },
    )
