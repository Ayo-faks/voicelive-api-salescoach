"""Learner-side fullscreen voice + gen-UI planner.

The therapist-side ``insights`` voice path is hard-locked to clinician
roles. Learners need their own fullscreen voice surface that renders
gen-UI cards (questions, MCQ tap targets, explanations) instead of a
text chat. This module owns the *deterministic* brain for that
surface; a future ``/ws/learning-voice`` realtime transport can swap
this planner for a model-backed one without changing the card
contract.

Card vocabulary (v0):

- ``greeting``       — opening message the agent speaks.
- ``mcq-tap``        — multiple-choice question with four tap targets.
- ``explanation``    — short worked example shown after a wrong answer.
- ``progress``       — daily-plan progress pill ("3 of 7 done").
- ``mark-known``     — single-tap confirmation card ("Got it").

The planner is intentionally stateless: the client sends the last
card id plus the learner's answer, the planner returns the next card.
Session state lives client-side so we never trust caller-supplied
``actor_id`` for cross-learner reads.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Literal, Optional, Union
from uuid import uuid4

from pydantic import BaseModel, Field


CardKind = Literal["greeting", "mcq-tap", "explanation", "progress", "mark-known"]


class _BaseCard(BaseModel):
    card_id: str = Field(default_factory=lambda: f"lv-card-{uuid4().hex[:10]}")
    kind: CardKind
    speak: str = Field(min_length=1, description="What the agent says out loud.")


class GreetingCard(_BaseCard):
    kind: Literal["greeting"] = "greeting"
    headline: str
    sub: str


class McqOption(BaseModel):
    id: str
    label: str  # e.g. "A"
    text: str


class McqTapCard(_BaseCard):
    kind: Literal["mcq-tap"] = "mcq-tap"
    stem: str
    options: List[McqOption]
    skill_id: Optional[str] = None


class ExplanationCard(_BaseCard):
    kind: Literal["explanation"] = "explanation"
    title: str
    steps: List[str]
    next_action_label: str = "Try the next one"


class ProgressCard(_BaseCard):
    kind: Literal["progress"] = "progress"
    completed: int
    total: int


class MarkKnownCard(_BaseCard):
    kind: Literal["mark-known"] = "mark-known"
    prompt: str
    confirm_label: str = "Got it"


LearnerVoiceCard = Union[
    GreetingCard, McqTapCard, ExplanationCard, ProgressCard, MarkKnownCard
]


class LearnerVoiceTurnRequest(BaseModel):
    """Client -> server turn payload.

    ``child_id`` is required so we can later RLS-scope every read. v0
    ignores it; the field is reserved for the realtime transport.
    """

    child_id: str = Field(min_length=1)
    lang: str = "en-NG"
    last_card_id: Optional[str] = None
    last_kind: Optional[CardKind] = None
    answer_option_id: Optional[str] = None  # MCQ choice
    advance: bool = False  # tap-through for non-MCQ cards


class LearnerVoiceTurnResponse(BaseModel):
    card: LearnerVoiceCard
    session_complete: bool = False


# ---------------------------------------------------------------------------
# Deterministic v0 brain — fixed 3-question walk-through.
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class _ScriptedQuestion:
    stem: str
    options: List[McqOption]
    correct_option_id: str
    explanation_title: str
    explanation_steps: List[str]
    skill_id: str


_SCRIPTED_WALKTHROUGH: List[_ScriptedQuestion] = [
    _ScriptedQuestion(
        stem="If a recipe uses flour to sugar in the ratio 3 : 2 and you use 6 cups of flour, how many cups of sugar do you need?",
        options=[
            McqOption(id="a", label="A", text="2 cups"),
            McqOption(id="b", label="B", text="3 cups"),
            McqOption(id="c", label="C", text="4 cups"),
            McqOption(id="d", label="D", text="9 cups"),
        ],
        correct_option_id="c",
        explanation_title="Scaling a ratio",
        explanation_steps=[
            "The ratio flour : sugar = 3 : 2.",
            "Multiply both parts by 2 because 6 = 3 x 2.",
            "So sugar = 2 x 2 = 4 cups.",
        ],
        skill_id="ratio-proportion",
    ),
    _ScriptedQuestion(
        stem="Which fraction is equivalent to 3/4?",
        options=[
            McqOption(id="a", label="A", text="2/3"),
            McqOption(id="b", label="B", text="6/8"),
            McqOption(id="c", label="C", text="4/5"),
            McqOption(id="d", label="D", text="9/16"),
        ],
        correct_option_id="b",
        explanation_title="Equivalent fractions",
        explanation_steps=[
            "Multiply the top and bottom of 3/4 by the same number.",
            "3 x 2 = 6 and 4 x 2 = 8.",
            "So 3/4 = 6/8.",
        ],
        skill_id="fraction-operations",
    ),
    _ScriptedQuestion(
        stem="Which sentence shows that the writer is making an inference?",
        options=[
            McqOption(id="a", label="A", text="The text says the boy was tired."),
            McqOption(id="b", label="B", text="The text suggests the boy walked far because his shoes were muddy."),
            McqOption(id="c", label="C", text="The text lists the boy's chores."),
            McqOption(id="d", label="D", text="The text names the boy."),
        ],
        correct_option_id="b",
        explanation_title="Reading inference",
        explanation_steps=[
            "An inference combines stated facts with a sensible conclusion.",
            "The muddy shoes are a clue; the conclusion is the long walk.",
            "Option B does both, so it is the inference.",
        ],
        skill_id="reading-inference",
    ),
]


class LearnerVoiceTurnPlanner:
    """Deterministic turn planner used by the fullscreen voice surface.

    v0 walks a fixed 3-question script so the frontend, transport, and
    card contract can be exercised end to end without a model. A
    learner-personalised plan walker (driven by ``daily_plan`` +
    ``weak_topic_profile``) will replace this in phase 2.1.
    """

    def __init__(self, walkthrough: Optional[List[_ScriptedQuestion]] = None) -> None:
        self._walkthrough = list(walkthrough or _SCRIPTED_WALKTHROUGH)
        self._index_by_card: Dict[str, int] = {}

    def next_turn(self, request: LearnerVoiceTurnRequest) -> LearnerVoiceTurnResponse:
        total = len(self._walkthrough)

        # Opening turn: no prior card -> greet and present Q1.
        if request.last_card_id is None or request.last_kind is None:
            return self._present_question(index=0, prefix_greeting=True, total=total)

        prev_index = self._index_by_card.get(request.last_card_id)

        if request.last_kind == "greeting":
            return self._present_question(index=0, prefix_greeting=False, total=total)

        if request.last_kind == "mcq-tap":
            if prev_index is None:
                # Unknown card id (e.g. after a server restart) — start fresh.
                return self._present_question(index=0, prefix_greeting=False, total=total)
            question = self._walkthrough[prev_index]
            if request.answer_option_id == question.correct_option_id:
                next_index = prev_index + 1
                if next_index >= total:
                    return LearnerVoiceTurnResponse(
                        card=ProgressCard(
                            speak="Nice work — you finished today's quick check.",
                            completed=total,
                            total=total,
                        ),
                        session_complete=True,
                    )
                return self._present_question(index=next_index, prefix_greeting=False, total=total)
            # Wrong answer -> show the worked example.
            card = ExplanationCard(
                speak=(
                    f"Not quite — let me walk you through it. "
                    f"{question.explanation_title}."
                ),
                title=question.explanation_title,
                steps=list(question.explanation_steps),
            )
            self._index_by_card[card.card_id] = prev_index
            return LearnerVoiceTurnResponse(card=card)

        if request.last_kind == "explanation":
            # After an explanation, advance to the next question (or finish).
            if prev_index is None:
                return self._present_question(index=0, prefix_greeting=False, total=total)
            next_index = prev_index + 1
            if next_index >= total:
                return LearnerVoiceTurnResponse(
                    card=ProgressCard(
                        speak="That's the end of today's check — good effort.",
                        completed=total,
                        total=total,
                    ),
                    session_complete=True,
                )
            return self._present_question(index=next_index, prefix_greeting=False, total=total)

        # Fallback: re-greet.
        return self._present_question(index=0, prefix_greeting=True, total=total)

    def _present_question(
        self, *, index: int, prefix_greeting: bool, total: int
    ) -> LearnerVoiceTurnResponse:
        question = self._walkthrough[index]
        intro = (
            "Hi — let's do a quick check. "
            if prefix_greeting
            else ""
        )
        card = McqTapCard(
            speak=f"{intro}Question {index + 1} of {total}. {question.stem}",
            stem=question.stem,
            options=list(question.options),
            skill_id=question.skill_id,
        )
        self._index_by_card[card.card_id] = index
        return card_response(card)


def card_response(card: LearnerVoiceCard, *, session_complete: bool = False) -> LearnerVoiceTurnResponse:
    return LearnerVoiceTurnResponse(card=card, session_complete=session_complete)


__all__ = [
    "CardKind",
    "GreetingCard",
    "McqOption",
    "McqTapCard",
    "ExplanationCard",
    "ProgressCard",
    "MarkKnownCard",
    "LearnerVoiceCard",
    "LearnerVoiceTurnRequest",
    "LearnerVoiceTurnResponse",
    "LearnerVoiceTurnPlanner",
]
