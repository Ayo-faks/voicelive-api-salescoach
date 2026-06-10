"""Model-backed learner voice planner (Phase 3 — turn-based brain).

The fullscreen learner voice surface (``/api/learning/voice/turn``) renders
gen-UI cards rather than a text chat. :class:`LearnerVoiceTurnPlanner` owns the
*deterministic* walk-through: it selects taxonomy-matched MCQs and, after a
wrong answer, shows a scripted worked example (an ``ExplanationCard``).

This module upgrades only the **teaching moment**. When the deterministic
planner decides to show an explanation, :class:`ModelLearnerVoicePlanner`
re-authors that one card with the model so the re-teach is phrased freshly and
grounded, while keeping the entire selection state machine, card vocabulary and
session contract identical. Everything else (greeting, MCQ presentation,
progress, advance, taxonomy validation, no-content handling) is delegated
untouched to the deterministic planner.

Guardrails carried over from the text brain (:mod:`src.learning.assistant_llm`):

- **Grounding contract** — the model may only use the numbered ``[S#]`` RAG
  snippets plus the item's stored rationale (the scripted explanation steps).
  When nothing grounds the card, we fall back to the deterministic scripted
  explanation rather than inventing.
- **Explain-mode only** — an explanation card is emitted *after* the learner
  has already answered, so the item is scored and the worked answer may be
  shown (Socratic-while-scored does not apply here).
- **Outbound safeguarding** — the generated card text is screened with the
  deterministic lexicon; any trip falls back to the (safe) scripted card.
- **Deterministic fallback** — missing creds, no grounding, a malformed model
  reply, or any error returns the deterministic card so the surface never
  breaks.

The module never imports :mod:`src.learning.api` (one-way dependency) so it
stays independently testable with a faked OpenAI client.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, List, Mapping, Optional, Sequence, Tuple

from src.learning.learner_voice import (
    ExplanationCard,
    LearnerVoiceTurnPlanner,
    LearnerVoiceTurnRequest,
    LearnerVoiceTurnResponse,
    McqTapCard,
)
from src.learning.rag import RagRetriever, RetrievalHit, retrieve_or_refuse
from src.learning.tutor import (
    FocusItem,
    build_grounded_context,
    screen_outbound_text,
)
from src.services.azure_openai_auth import build_openai_client

logger = logging.getLogger(__name__)

VOICE_LLM_FLAG_ENV = "PATHFINDER_VOICE_LLM_ENABLED"

_DEFAULT_TEMPERATURE = 0.3
_DEFAULT_MAX_TOKENS = 400
_MAX_STEPS = 4

# Map the voice taxonomy onto the RAG corpus axes. The wiki corpus only covers
# maths/english at the JSS3/SS3 bands; unmapped combinations (e.g. Basic
# Science, JSS2) skip retrieval and ground purely on the item rationale.
_SUBJECT_TO_CORPUS = {
    "Mathematics": "maths",
    "English Language": "english",
}
_CLASS_TO_YEAR_GROUP = {
    "JSS2": "JSS3",
    "JSS3": "JSS3",
    "SSS1": "SS3",
    "SSS2": "SS3",
    "SSS3": "SS3",
}

_VOICE_EXPLANATION_PROMPT = """You are Wulo, a warm, patient study tutor \
for Nigerian secondary-school learners preparing for Junior WAEC/JSSCE and \
WAEC/NECO/JAMB. Speak in clear, encouraging Nigerian English (en-NG).

The learner just answered a multiple-choice question INCORRECTLY. Re-teach the \
idea so it sticks; right after this they will try the next question.

Hard rules — follow every one:
- GROUND EVERY FACT, formula, rule and step in the numbered SOURCES below. The \
SOURCES include the official item rationale. Do NOT add facts that the SOURCES \
do not support, and do NOT invent citations.
- This question has already been marked, so you MAY state the correct answer \
and walk through the method.
- Keep it spoken and short: a one-sentence encouraging lead-in for "speak", a \
short "title", and 2 to 4 short "steps". No jargon dumps.
- Never promise or guarantee an exam grade, pass, or outcome.

Return ONLY a JSON object: \
{"speak": "<spoken lead-in>", "title": "<short title>", "steps": ["<step>", "<step>"]}."""


class ModelLearnerVoicePlanner:
    """Wraps a deterministic planner, re-authoring only explanation cards.

    Conforms to the :class:`LearnerVoiceTurnPlanner` surface used by
    ``LearningApi`` (``next_turn`` plus the stateless ``resolve_taxonomy`` /
    ``candidate_cards`` / ``default_taxonomy`` helpers), delegating everything
    except the explanation teaching moment to the wrapped planner.
    """

    def __init__(
        self,
        deterministic: LearnerVoiceTurnPlanner,
        client: Any,
        model: str,
        rag_retriever: RagRetriever,
        *,
        temperature: float = _DEFAULT_TEMPERATURE,
        max_tokens: int = _DEFAULT_MAX_TOKENS,
    ) -> None:
        self.deterministic = deterministic
        self.client = client
        self.model = model
        self.rag_retriever = rag_retriever
        self.temperature = temperature
        self.max_tokens = max_tokens

    # ------------------------------------------------------------------
    # Construction
    # ------------------------------------------------------------------
    @classmethod
    def from_settings(
        cls,
        settings: Mapping[str, Any],
        *,
        deterministic: LearnerVoiceTurnPlanner,
        rag_retriever: RagRetriever,
    ) -> Optional["ModelLearnerVoicePlanner"]:
        """Build the planner, or ``None`` when it should not be used.

        Returns ``None`` (so the caller keeps the deterministic planner) when
        the feature flag is off, the model deployment is unresolved, or Azure
        OpenAI is not configured.
        """
        raw_flag = str(
            settings.get(VOICE_LLM_FLAG_ENV) or os.environ.get(VOICE_LLM_FLAG_ENV, "")
        )
        if raw_flag.strip().lower() not in {"1", "true", "yes", "on"}:
            return None

        client = build_openai_client(settings)
        if client is None:
            logger.warning(
                "Voice LLM enabled but Azure OpenAI is not configured; using deterministic planner"
            )
            return None

        model = str(settings.get("model_deployment_name") or "").strip()
        if not model:
            logger.warning(
                "Voice LLM enabled but no model deployment name resolved; using deterministic planner"
            )
            return None

        return cls(deterministic, client, model, rag_retriever)

    # ------------------------------------------------------------------
    # Delegated stateless helpers (kept identical to the deterministic planner)
    # ------------------------------------------------------------------
    def resolve_taxonomy(self, **kwargs: Any) -> Tuple[str, str, str]:
        return self.deterministic.resolve_taxonomy(**kwargs)

    def candidate_cards(self, **kwargs: Any) -> List[McqTapCard]:
        return self.deterministic.candidate_cards(**kwargs)

    def default_taxonomy(self) -> Tuple[str, str, str]:
        return self.deterministic.default_taxonomy()

    # ------------------------------------------------------------------
    # Turn planning
    # ------------------------------------------------------------------
    def next_turn(self, request: LearnerVoiceTurnRequest) -> LearnerVoiceTurnResponse:
        resp = self.deterministic.next_turn(request)
        if getattr(resp.card, "kind", None) != "explanation":
            return resp

        try:
            model_card = self._regenerate_explanation(resp.card, request)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Voice explanation model call failed; using scripted card: %s", exc)
            return resp

        if model_card is None:
            return resp
        return LearnerVoiceTurnResponse(
            card=model_card, session_complete=resp.session_complete
        )

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------
    def _regenerate_explanation(
        self, scripted_card: ExplanationCard, request: LearnerVoiceTurnRequest
    ) -> Optional[ExplanationCard]:
        lookup = self.deterministic._index_by_card.get(scripted_card.card_id)
        if lookup is None:
            return None
        taxonomy, index = lookup
        walkthrough = self.deterministic._walkthrough_for(taxonomy)
        if index < 0 or index >= len(walkthrough):
            return None
        question = walkthrough[index]
        _exam, class_year, subject = taxonomy

        # Anchor on the scripted question. It is already scored (the learner
        # answered), so the worked answer may be shown. The scripted steps are
        # the stored rationale = factual authority.
        focus = FocusItem(
            stem=question.stem,
            options=[opt.text for opt in question.options],
            chosen=request.answer_option_id,
            correct=question.correct_option_id,
            rationale=" ".join(question.explanation_steps),
            skill_id=question.skill_id,
            scored=True,
        )

        corpus_subject = _SUBJECT_TO_CORPUS.get(subject)
        year_group = _CLASS_TO_YEAR_GROUP.get(class_year)
        hits: List[RetrievalHit] = []
        if corpus_subject and year_group:
            try:
                hits, _refusal = retrieve_or_refuse(
                    self.rag_retriever,
                    f"{question.stem}\n{question.explanation_title}".strip(),
                    subject=corpus_subject,  # type: ignore[arg-type]
                    year_group=year_group,  # type: ignore[arg-type]
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("Voice retrieval failed: %s", exc)
                hits = []

        snippets = [hit.node.body_markdown for hit in hits]
        grounded = build_grounded_context(
            question.stem,
            item=focus,
            retrieved=snippets,
            profile={},
            thread=(),
            memory_allowed=False,
        )
        # Grounding contract: with no authority we cannot safely re-author, so
        # keep the deterministic scripted card. (The rationale normally makes
        # this branch unreachable.)
        if not grounded.grounded:
            return None

        speak, title, steps = self._call_model(focus, hits)

        # Outbound safeguarding before anything is spoken to a learner.
        combined = " ".join([speak, title, *steps]).strip()
        decision = screen_outbound_text(combined)
        if not decision.allowed:
            logger.warning(
                "Voice explanation blocked (severity=%s, categories=%s); using scripted card",
                decision.severity.value,
                decision.categories,
            )
            return None

        model_card = ExplanationCard(
            speak=speak,
            title=title,
            steps=steps,
            next_action_label=scripted_card.next_action_label,
        )
        # Preserve the walkthrough state machine: the next turn maps this card's
        # id back to the same question index so "advance" lands on the next item.
        self.deterministic._index_by_card[model_card.card_id] = (taxonomy, index)
        return model_card

    def _call_model(
        self, focus: FocusItem, hits: Sequence[RetrievalHit]
    ) -> Tuple[str, str, List[str]]:
        messages: List[dict] = [
            {"role": "system", "content": _VOICE_EXPLANATION_PROMPT}
        ]

        source_lines: List[str] = []
        for idx, hit in enumerate(hits, start=1):
            title = hit.node.title or hit.node.topic or hit.node.node_id
            source_lines.append(f"[S{idx}] {title}: {hit.node.body_markdown}")
        if focus.rationale:
            source_lines.append(f"[R] Item rationale: {focus.rationale}")
        messages.append(
            {"role": "system", "content": "SOURCES:\n" + "\n".join(source_lines)}
        )

        item_bits: List[str] = [f"Question: {focus.stem}"]
        if focus.options:
            item_bits.append("Options: " + " | ".join(focus.options))
        if focus.chosen:
            item_bits.append(f"Learner chose (wrong): {focus.chosen}")
        if focus.correct:
            item_bits.append(f"Correct option id: {focus.correct}")
        messages.append(
            {"role": "system", "content": "CURRENT ITEM:\n" + "\n".join(item_bits)}
        )
        messages.append(
            {
                "role": "user",
                "content": "Re-teach this question so it sticks, then I'll try the next one.",
            }
        )

        completion = self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            response_format={"type": "json_object"},
            temperature=self.temperature,
            max_tokens=self.max_tokens,
        )
        content = completion.choices[0].message.content
        if not content:
            raise RuntimeError("voice model returned empty content")
        payload = json.loads(content)

        speak = str(payload.get("speak") or "").strip()
        title = str(payload.get("title") or "").strip()
        raw_steps = payload.get("steps") or []
        steps: List[str] = []
        if isinstance(raw_steps, Sequence) and not isinstance(raw_steps, (str, bytes)):
            for step in raw_steps:
                text = str(step or "").strip()
                if text:
                    steps.append(text)
        steps = steps[:_MAX_STEPS]

        if not speak or not steps:
            raise RuntimeError("voice model returned an incomplete explanation card")
        if not title:
            title = "Let's work through it"
        return speak, title, steps


def build_default_voice_planner(
    deterministic: Optional[LearnerVoiceTurnPlanner] = None,
) -> LearnerVoiceTurnPlanner:
    """Resolve the learner voice planner for a standalone caller.

    Used by the realtime learner voice profile (which constructs its planner
    outside :class:`LearningApi`) so the voice tool gets the same model-backed,
    grounded explanation re-authoring as the REST turn path. Builds the
    deterministic planner, then upgrades it to :class:`ModelLearnerVoicePlanner`
    when the flag is on and Azure OpenAI is configured. Any failure (or the flag
    being off) returns the deterministic planner, so the realtime tool always
    has a working planner.
    """
    base = deterministic or LearnerVoiceTurnPlanner()
    try:
        from src.config import get_config
        from src.learning.rag import build_default_retriever

        settings = get_config()
        raw_flag = str(
            settings.get(VOICE_LLM_FLAG_ENV) or os.environ.get(VOICE_LLM_FLAG_ENV, "")
        )
        # Cheap short-circuit so we never load the wiki corpus from disk when
        # the model brain is disabled.
        if raw_flag.strip().lower() not in {"1", "true", "yes", "on"}:
            return base

        model_planner = ModelLearnerVoicePlanner.from_settings(
            settings,
            deterministic=base,
            rag_retriever=build_default_retriever(),
        )
        if model_planner is not None:
            return model_planner
    except Exception:  # noqa: BLE001
        logger.exception(
            "Failed to build model learner voice planner; using deterministic fallback"
        )
    return base


__all__ = [
    "VOICE_LLM_FLAG_ENV",
    "ModelLearnerVoicePlanner",
    "build_default_voice_planner",
]

