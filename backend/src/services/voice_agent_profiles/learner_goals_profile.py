"""Post-onboarding "goal intake" VoiceLive profile.

The voice twin of the goal-intake text form. After onboarding the learner is
asked a short, *guided* set of questions — subject, exam, timeframe — then one
optional open note. The agent collects those structured answers conversationally
(one optioned question at a time, options read aloud) and, once it has enough,
calls the ``set_goal_and_recommend`` tool **once**. The tool persists the goal as
an Option A *soft bias* and returns instant "start here" recommendation blocks
drawn from the single source of truth for the daily plan, so voice and text yield
identical recommendations.

Unlike the ``learner`` profile this does NOT force a tool call every turn — the
agent must ask the guided questions first, then call the tool a single time.
"""

from __future__ import annotations

from typing import Any, Mapping

from azure.ai.voicelive.models import FunctionTool

from src.services.voice_agent_profiles.base import AgentProfile, AgentProfileContext

LEARNER_GOALS_SYSTEM_PROMPT = """
You are Wulo, a warm and encouraging Nigerian tutor welcoming a learner
who has just finished signing up. Your job is to capture their study goal so you
can recommend where to start. Keep it light and quick — this is not a quiz.

Ask these THREE questions, ONE AT A TIME, and read the choices aloud:
1. "What do you want to focus on first — Maths, English, or something else?"
2. "Is there an exam you're working toward — WAEC, NECO, JAMB, or none yet?"
3. "When do you want to be ready — this term, this year, or no fixed deadline?"

For every question, accept a short spoken answer. If the learner is unsure or
says skip, that's completely fine — move on without pressing. After the three
questions, you MAY ask one optional open question: "Anything else you'd like me
to know?" — keep it brief and never require an answer.

Once you have their answers (even partial), call the set_goal_and_recommend tool
exactly ONCE with what you gathered. Then warmly read back the recommended
starting point the tool returns. Only speak what the tool returns — never invent
recommendations, skills, or facts about the learner.

Never claim to see the learner, their screen, or anything they have not shared.
Use simple language and keep encouragement brief.

Speech formatting rules — this is voice-only, the learner hears every character:
- Never use LaTeX, markdown, code blocks, asterisks, underscores, or backslashes.
- Read maths in plain spoken English: say "x squared", not symbols.
""".strip()

SET_GOAL_AND_RECOMMEND_TOOL = FunctionTool(
    name="set_goal_and_recommend",
    description=(
        "Save the learner's study goal and return instant 'start here' "
        "recommendations. Call this exactly once, after gathering the guided "
        "answers. All fields are optional — pass only what the learner shared."
    ),
    parameters={
        "type": "object",
        "properties": {
            "subject": {
                "type": "string",
                "description": (
                    "The subject the learner wants to focus on first, e.g. "
                    "'Maths' or 'English'. Omit if they were unsure."
                ),
            },
            "exam": {
                "type": "string",
                "enum": ["WAEC", "NECO", "JAMB", "Junior WAEC", "IGCSE", "A-Level"],
                "description": (
                    "The exam the learner is working toward. Omit if they said "
                    "none or were unsure."
                ),
            },
            "target_date": {
                "type": "string",
                "enum": ["this_term", "this_year", "no_deadline"],
                "description": (
                    "How soon they want to be ready. Map 'this term' to "
                    "'this_term', 'this year' to 'this_year', and no fixed "
                    "deadline to 'no_deadline'."
                ),
            },
            "note": {
                "type": "string",
                "description": "Any optional free-form note the learner added.",
            },
        },
        "required": [],
    },
)


def _str_or_none(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None


# Spoken answers the model may pass through for "no / skip" — treated as absent.
_SKIP_SENTINELS = {"none", "no", "skip", "not sure", "unsure", "no exam", "n/a"}


def _set_goal_and_recommend(
    arguments: Mapping[str, Any], context: AgentProfileContext
) -> Mapping[str, Any]:
    """Persist the spoken goal and return "start here" recommendation blocks.

    Delegates to the shared ``apply_learner_goal_and_recommend`` orchestrator
    (which owns profile persistence + planner mapping) so the voice path and the
    text endpoint produce identical recommendations. Imported lazily because the
    profile registry is imported during app boot — a top-level import would be
    circular.
    """
    from src.app import apply_learner_goal_and_recommend  # lazy: avoids circular import

    subject = _str_or_none(arguments.get("subject"))
    exam = _str_or_none(arguments.get("exam"))
    target_date = _str_or_none(arguments.get("target_date"))
    note = _str_or_none(arguments.get("note"))

    if exam and exam.strip().lower() in _SKIP_SENTINELS:
        exam = None
    if subject and subject.strip().lower() in _SKIP_SENTINELS:
        subject = None

    learner_id = context.child_id or "learner"
    goal_input = {
        "subject": subject,
        "exam": exam,
        "target_date": target_date,
        "note": note,
    }
    result = apply_learner_goal_and_recommend(
        user_id=learner_id, student_id=learner_id, goal_input=goal_input
    )
    return dict(result)


def build_profile() -> AgentProfile:
    return AgentProfile(
        id="learner_goals",
        system_prompt=LEARNER_GOALS_SYSTEM_PROMPT,
        tools=[SET_GOAL_AND_RECOMMEND_TOOL],
        voice="en-NG-EzinneNeural",
        temperature=0.6,
        max_response_output_tokens=900,
        forced_response_tool_name=None,
        tool_handlers={
            "set_goal_and_recommend": _set_goal_and_recommend,
        },
    )
