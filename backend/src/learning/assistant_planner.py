"""Unified assistant planner — one brain, many blocks, any modality.

This facade is the keystone of the merged voice+chat assistant. Both the text
drawer and the realtime voice transport call :meth:`UnifiedAssistantPlanner.plan_turn`
and receive an :class:`~src.learning.assistant_blocks.AssistantTurnResult`.

It owns no model plumbing of its own. It delegates to the two brains the API
already wires up under the existing feature flags:

- ``assistant_provider`` — the grounded prose brain
  (:class:`~src.learning.assistant_llm.ModelAssistantProvider` when the LLM flag
  is on, else :class:`~src.learning.api.DeterministicAssistantProvider`). Used to
  answer free-form questions.
- ``voice_planner`` — the gen-UI card brain
  (:class:`~src.learning.learner_voice.LearnerVoiceTurnPlanner`, optionally
  upgraded to ``ModelLearnerVoicePlanner``). Used to drive a practice walk.

Routing is intent-first and transport-agnostic:

1. A practice walk in progress (the payload carries ``last_card_id`` / answer /
   advance) or an explicit ``practice`` / ``start_exercise`` intent →
   delegate to ``voice_planner`` and surface its card as a block.
2. A free-form ``question`` → delegate to ``assistant_provider`` and wrap the
   grounded answer in a :class:`ProseBlock`.
3. ``profile`` / ``plan`` intents → render the supplied snapshot directly.

Because the cards in :mod:`src.learning.learner_voice` are already members of
the ``AssistantBlock`` union, surfacing a card as a block is a no-op — no
lossy translation.
"""

from __future__ import annotations

import logging
from typing import Any, List, Mapping, Optional, Protocol

from src.learning.assistant_blocks import (
    AssistantTurnResult,
    Citation,
    PlanBlock,
    ProfileBlock,
    ProseBlock,
)
from src.learning.learner_voice import LearnerVoiceTurnRequest

logger = logging.getLogger(__name__)

# Intents that mean "run / continue a practice exercise" rather than "answer me".
_PRACTICE_INTENTS = frozenset({"practice", "start_exercise", "exercise", "next", "quiz"})
# Intents that render a snapshot the client already holds.
_PROFILE_INTENTS = frozenset({"profile", "progress_overview", "where_am_i"})
_PLAN_INTENTS = frozenset({"plan", "daily_plan", "today"})


class _ProseBrain(Protocol):
    def ask(self, question: str, context: Mapping[str, Any]) -> Mapping[str, Any]: ...


class _CardBrain(Protocol):
    def next_turn(self, request: LearnerVoiceTurnRequest) -> Any: ...


class UnifiedAssistantPlanner:
    """Modality-agnostic planner that normalises every turn to blocks."""

    def __init__(self, assistant_provider: _ProseBrain, voice_planner: _CardBrain) -> None:
        self._assistant = assistant_provider
        self._voice = voice_planner

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def plan_turn(
        self,
        *,
        question: str = "",
        intent: Optional[str] = None,
        context: Optional[Mapping[str, Any]] = None,
        voice_request: Optional[LearnerVoiceTurnRequest] = None,
        profile_block: Optional[ProfileBlock] = None,
        plan_block: Optional[PlanBlock] = None,
    ) -> AssistantTurnResult:
        """Produce the blocks for one assistant turn, in any modality."""
        intent_norm = (intent or "").strip().lower()
        ctx: Mapping[str, Any] = context or {}

        # 1) Practice walk — either explicitly requested or already in flight.
        walk_in_flight = voice_request is not None and (
            voice_request.last_card_id is not None
            or voice_request.answer_option_id is not None
            or voice_request.advance
        )
        if intent_norm in _PRACTICE_INTENTS or walk_in_flight:
            return self._plan_practice(voice_request)

        # 2) Snapshot intents — render what the client already supplied.
        if intent_norm in _PROFILE_INTENTS and profile_block is not None:
            return AssistantTurnResult(blocks=[profile_block])
        if intent_norm in _PLAN_INTENTS and plan_block is not None:
            return AssistantTurnResult(blocks=[plan_block])

        # 3) Free-form question — grounded prose answer.
        if question.strip():
            return self._plan_prose(question, ctx)

        # 4) Nothing actionable: open with a profile + plan if we have them,
        #    else a gentle prompt. This is the "just logged in / digging around"
        #    entry the user described.
        blocks: List[Any] = []
        if profile_block is not None:
            blocks.append(profile_block)
        if plan_block is not None:
            blocks.append(plan_block)
        if not blocks:
            blocks.append(
                ProseBlock(
                    speak="What would you like to look at today?",
                    text="What would you like to look at today? I can explain a "
                    "topic, talk through a question you got wrong, or set a quick "
                    "practice card.",
                    grounded=False,
                    smalltalk=True,
                )
            )
        return AssistantTurnResult(blocks=blocks)

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------
    def _plan_practice(
        self, voice_request: Optional[LearnerVoiceTurnRequest]
    ) -> AssistantTurnResult:
        if voice_request is None:
            # Caller asked to practise but gave no taxonomy — start the default
            # walk (the deterministic planner falls back to WAEC/SSS2/Maths).
            voice_request = LearnerVoiceTurnRequest(child_id="pending")
        response = self._voice.next_turn(voice_request)
        card = getattr(response, "card", None)
        blocks = [card] if card is not None else []
        return AssistantTurnResult(
            blocks=blocks,
            session_complete=bool(getattr(response, "session_complete", False)),
        )

    def _plan_prose(self, question: str, context: Mapping[str, Any]) -> AssistantTurnResult:
        reply = self._assistant.ask(question, context)
        answer = str(reply.get("answer", "") or "")
        citations = [
            Citation(
                label=str(c.get("label") or ""),
                url=c.get("url"),
                topic_id=c.get("topic_id"),
            )
            for c in (reply.get("citations") or [])
            if isinstance(c, Mapping) and (c.get("label") or c.get("topic_id"))
        ]
        block = ProseBlock(
            speak=answer,
            text=answer,
            citations=citations,
            grounded=bool(reply["grounded"]) if "grounded" in reply else None,
            smalltalk=bool(reply.get("smalltalk")),
        )
        return AssistantTurnResult(blocks=[block])


__all__ = ["UnifiedAssistantPlanner"]
