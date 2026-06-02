"""Unified assistant block contract.

The learner assistant historically split its output across two transports:

- the **text drawer** (``/api/learning/assistant/ask``) returned prose + citations
  via :class:`~src.learning.assistant_llm.ModelAssistantProvider`; and
- the **fullscreen voice surface** (``/api/learning/voice/turn``) returned
  rich gen-UI cards via :class:`~src.learning.learner_voice.LearnerVoiceTurnPlanner`.

That meant the text brain could not draw a question card and the voice brain
could not answer a free-form question. This module defines a single output
vocabulary — the ``AssistantBlock`` union — so one planner can emit *either*
prose *or* a gen-UI card (or a mix), and both transports render the same blocks.

Modality is just I/O: every block carries an optional ``speak`` string. Text
mode ignores it; voice mode feeds it to text-to-speech. That single field is
the entire difference between the two surfaces, exactly like ChatGPT voice vs.
text mode.

Reused cards (identical shape, identical renderer) are imported from
:mod:`src.learning.learner_voice`:
``greeting``, ``mcq-tap``, ``explanation``, ``progress``, ``mark-known``.

New conversational / profile blocks added here:
``prose`` (grounded answer + citations), ``profile`` (the learner's own
mastery snapshot), ``plan`` (today's adaptive plan), ``confirmation``
(a single yes/no action prompt such as "Start a 5-question Maths set?").
"""

from __future__ import annotations

from typing import List, Literal, Optional, Union

from pydantic import BaseModel, Field

from src.learning.learner_voice import (
    ExplanationCard,
    GreetingCard,
    MarkKnownCard,
    McqTapCard,
    ProgressCard,
)

# ---------------------------------------------------------------------------
# New conversational / profile blocks
# ---------------------------------------------------------------------------


class Citation(BaseModel):
    """A grounding reference bound to a real retrieval hit or topic node."""

    label: str
    url: Optional[str] = None
    topic_id: Optional[str] = None


class ProseBlock(BaseModel):
    """A free-form grounded answer — the text-drawer reply, now a block.

    ``grounded`` mirrors the model provider's grounding signal so the UI can
    render a "no grounded source" badge distinctly from a normal answer.
    ``smalltalk`` flags warm openers (greetings/thanks) that are intentionally
    ungrounded so the badge is suppressed for them.
    """

    kind: Literal["prose"] = "prose"
    speak: str = Field(min_length=0, description="Spoken form for voice TTS.")
    text: str
    citations: List[Citation] = Field(default_factory=list)
    grounded: Optional[bool] = None
    smalltalk: bool = False


class ProfileChip(BaseModel):
    label: str
    value: str
    tone: Literal["neutral", "good", "warn"] = "neutral"


class ProfileBlock(BaseModel):
    """The learner's own mastery snapshot, rendered as a self-view card.

    Adapted from the therapist ``studentProfile`` spec but scoped to the
    signed-in learner (never another student) so it is RLS-safe by construction.
    """

    kind: Literal["profile"] = "profile"
    speak: str = ""
    headline: str
    chips: List[ProfileChip] = Field(default_factory=list)
    weak_topics: List[str] = Field(default_factory=list)


class PlanStep(BaseModel):
    title: str
    skill_id: Optional[str] = None
    done: bool = False


class PlanBlock(BaseModel):
    """Today's adaptive daily plan rendered inline in the conversation."""

    kind: Literal["plan"] = "plan"
    speak: str = ""
    headline: str
    steps: List[PlanStep] = Field(default_factory=list)


class ConfirmationBlock(BaseModel):
    """A single yes/no action prompt, e.g. "Start a 5-question Maths set?".

    ``action`` names a capability the client knows how to deep-link to (e.g.
    ``start_practice``); ``params`` carries its arguments. The assistant never
    mutates state directly — the learner taps confirm and the client performs
    the navigation, keeping the human in the loop.
    """

    kind: Literal["confirmation"] = "confirmation"
    speak: str = ""
    prompt: str
    confirm_label: str = "Yes"
    dismiss_label: str = "Not now"
    action: Optional[str] = None
    params: dict = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# The unified union
# ---------------------------------------------------------------------------

AssistantBlock = Union[
    ProseBlock,
    GreetingCard,
    McqTapCard,
    ExplanationCard,
    ProgressCard,
    MarkKnownCard,
    ProfileBlock,
    PlanBlock,
    ConfirmationBlock,
]


class AssistantTurnResult(BaseModel):
    """The single shape every assistant turn returns, in any modality.

    ``blocks`` is an ordered list rendered top-to-bottom in the transcript.
    ``session_complete`` mirrors the voice planner's end-of-walk signal so a
    practice run can tell the client it has finished.
    """

    blocks: List[AssistantBlock] = Field(default_factory=list)
    session_complete: bool = False


__all__ = [
    "Citation",
    "ProseBlock",
    "ProfileChip",
    "ProfileBlock",
    "PlanStep",
    "PlanBlock",
    "ConfirmationBlock",
    "AssistantBlock",
    "AssistantTurnResult",
]
