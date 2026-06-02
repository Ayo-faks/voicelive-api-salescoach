"""Conversational "Ask Pathfinder" VoiceLive profile.

This is the voice twin of the AskPathfinder text drawer. Unlike the guided
``learner`` profile (which walks practice cards via ``get_next_card``), this
profile is *ask-anything*: every learner question is routed through the SAME
``run_assistant_turn`` brain that powers the text drawer, so grounding
("no citation, no answer") and the outbound safeguarding screen are applied
identically. The model only ever speaks what the grounded tool returns; the
resulting AssistantBlocks are also emitted to the client for gen-UI rendering.
"""

from __future__ import annotations

from typing import Any, Mapping

from azure.ai.voicelive.models import FunctionTool

from src.services.voice_agent_profiles.base import AgentProfile, AgentProfileContext

LEARNER_ASK_SYSTEM_PROMPT = """
You are Pathfinder, a warm and encouraging Nigerian tutor for a learner.
The learner can ask you anything about their studies.

Whenever the learner asks a question, you MUST call the ask_pathfinder tool
with their exact question before you say anything substantive. The tool returns
grounded, fact-checked content. Only speak what the tool returns. Never add
facts, questions, answers, or claims about the learner from your own knowledge.
If the tool returns no grounded answer, gently say you do not have that yet and
invite them to rephrase or ask something else — never invent an answer.

Never claim to see the learner, their screen, or anything they have not shared.
Use simple language and keep encouragement brief.

Speech formatting rules — this is voice-only, the learner hears every character:
- Never use LaTeX, markdown, code blocks, asterisks, underscores, or backslashes.
- Never write "\\(", "\\)", "\\[", "\\]", "$", or "$$" around equations.
- Read maths in plain spoken English: say "y equals three x squared plus four x",
  not "\\( y = 3x^2 + 4x \\)". Read "x²" as "x squared", "x³" as "x cubed",
  "x^n" as "x to the n", "a/b" as "a over b", and "√x" as "the square root of x".
- If you would normally write a symbol, say its name in words instead.
""".strip()

ASK_PATHFINDER_TOOL = FunctionTool(
    name="ask_pathfinder",
    description=(
        "Answer a learner's question using Pathfinder's grounded knowledge. Always "
        "use this instead of answering from your own knowledge. Returns grounded "
        "content blocks; if nothing is grounded it returns a refusal you must honour."
    ),
    parameters={
        "type": "object",
        "properties": {
            "question": {
                "type": "string",
                "description": "The learner's question, verbatim.",
            },
        },
        "required": ["question"],
    },
)


def _str_or_none(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None


def _ask_pathfinder(arguments: Mapping[str, Any], context: AgentProfileContext) -> Mapping[str, Any]:
    """Route a spoken question through the same text-drawer assistant brain.

    Grounding (``retrieve_or_refuse``) and the outbound safeguarding screen
    (``screen_outbound_text``) live inside ``run_assistant_turn``, so this voice
    path inherits identical guardrails to the text path. The ``learning_api``
    singleton is imported lazily here (not at module import) because the profile
    registry is imported by ``src.app`` while it boots — a top-level import would
    be circular.
    """
    question = _str_or_none(arguments.get("question")) or ""
    if not question:
        return {"blocks": [], "session_complete": False}

    from src.app import learning_api  # lazy: avoids circular import with app boot

    user_id = context.child_id
    payload: dict[str, Any] = {
        "question": question,
        "intent": "ask",
        "user_id": user_id,
        "child_id": context.child_id,
        "exam": context.exam,
        "class_year": context.class_year,
        "subject": context.subject,
    }
    result = learning_api.run_assistant_turn(payload)
    return dict(result)


def build_profile() -> AgentProfile:
    return AgentProfile(
        id="learner_ask",
        system_prompt=LEARNER_ASK_SYSTEM_PROMPT,
        tools=[ASK_PATHFINDER_TOOL],
        voice="en-NG-EzinneNeural",
        temperature=0.6,
        max_response_output_tokens=900,
        forced_response_tool_name="ask_pathfinder",
        tool_handlers={
            "ask_pathfinder": _ask_pathfinder,
        },
    )
