"""Natural-language intent routing for the unified assistant turn.

The unified planner (:class:`~src.learning.assistant_planner.UnifiedAssistantPlanner`)
routes by an explicit ``intent`` field, but the always-on message bar only ever
sends a free-form ``question``. So a typed request like *"do today's path
exercises"* or *"quiz me on ratios"* used to fall through to the grounded-prose
path and answer in **words** instead of returning an **exercise card**.

This module closes that gap by classifying the learner's typed message into one
of a small, fixed set of intents *before* the planner runs — but only when the
client did not already supply an explicit intent or an in-flight practice
signal, so a turn the client already disambiguated is never overridden.

Two layers, cheapest first:

1. A free, instant keyword/phrase matcher (:func:`classify_keyword`) for
   unambiguous practice / plan / progress requests. It is also the fallback
   when the LLM classifier is disabled or errors.
2. An optional LLM classifier (:class:`ModelIntentClassifier`) for the fuzzy
   middle — built only when the assistant LLM flag is on and Azure OpenAI is
   configured, reusing the same client + deployment as the Dig-Deeper tutor.

Both layers fail **open** to :data:`INTENT_QUESTION`, so any uncertainty keeps
the existing grounded-prose behaviour — a real question is never hijacked into a
quiz.
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any, Dict, Mapping, Optional

from src.services.azure_openai_auth import build_openai_client

logger = logging.getLogger(__name__)

# Planner-facing intent vocabulary. These map onto the routing buckets in
# ``UnifiedAssistantPlanner.plan_turn`` (``_PRACTICE_INTENTS`` / ``_PLAN_INTENTS``
# / ``_PROFILE_INTENTS``); ``question`` means "leave it as grounded prose".
INTENT_PRACTICE = "practice"
INTENT_PLAN = "plan"
INTENT_PROFILE = "profile"
INTENT_QUESTION = "question"

_VALID_INTENTS = frozenset(
    {INTENT_PRACTICE, INTENT_PLAN, INTENT_PROFILE, INTENT_QUESTION}
)

# Own flag so NL routing can be toggled independently; when unset it inherits
# the Dig-Deeper tutor's LLM flag so it ships wherever the model tutor is on.
INTENT_LLM_FLAG_ENV = "PATHFINDER_ASSISTANT_INTENT_LLM_ENABLED"
_ASSISTANT_LLM_FLAG_ENV = "PATHFINDER_ASSISTANT_LLM_ENABLED"
_ASSISTANT_MODEL_ENV = "PATHFINDER_ASSISTANT_MODEL_DEPLOYMENT"

# Phrases that unambiguously mean "start / continue practice" rather than
# "answer my question". Matched as substrings of the normalised message.
# Kept deliberately conservative so a genuine question is never hijacked.
_PRACTICE_PHRASES = (
    "today's path", "todays path", "today path",
    "today's exercise", "todays exercise",
    "today's practice", "todays practice",
    "today's question", "todays question",
    "do my exercise", "do the exercise", "do exercises", "do an exercise",
    "do my practice", "do some practice", "do practice",
    "start exercise", "start the exercise", "start an exercise",
    "start practice", "start practising", "start practicing",
    "start a quiz", "do a quiz", "take a quiz", "quiz me", "test me",
    "give me a question", "give me another question", "give me practice",
    "give me an exercise", "ask me a question", "another question",
    "next question", "practice question", "practice questions",
    "mcq question", "mcq questions", "the quiz", "answer the quiz",
    "answer today", "answer my question", "answer questions", "answer the question",
    "let's practice", "lets practice", "let's practise", "lets practise",
    "i want to practice", "i want to practise", "i wanna practice",
    "can i practice", "can we practice", "can i practise", "can we practise",
    "let's do questions", "lets do questions", "work on questions",
    "questions to practice", "questions to practise",
)

_SUBJECT_ALIASES: Dict[str, str] = {
    "agric": "agricultural_science",
    "agriculture": "agricultural_science",
    "agric science": "agricultural_science",
    "agricultural science": "agricultural_science",
    "govt": "government",
    "government": "government",
    "history": "history",
    "lit": "literature",
    "literature": "literature",
    "literature in english": "literature",
    "economics": "economics",
    "econs": "economics",
    "biology": "biology",
    "chemistry": "chemistry",
    "physics": "physics",
    "computer science": "computer_science",
    "computers": "computer_science",
    "data processing": "data_processing",
    "ict": "data_processing",
    "english": "english",
    "english language": "english",
    "math": "mathematics",
    "maths": "mathematics",
    "mathematics": "mathematics",
}


def _normalize(text: str) -> str:
    cleaned = "".join(
        ch if ch.isalnum() or ch.isspace() else " " if ch != "'" else "'"
        for ch in (text or "").lower()
    )
    return " ".join(cleaned.split())


# Session-control closings — "let's round up", "end the exercise", "we're done".
# These are wrap-up intents, NOT requests to *do* practice, so they must never
# be routed to the planner (which would hand back a fresh exercise card — the
# opposite of "round up"). They flow to the prose brain, whose smalltalk
# classifier (which imports this same list) answers with a warm wrap-up.
# Single source of truth so the intent router and the prose brain agree.
_CLOSING_PHRASES = (
    "end the exercise", "end exercise", "end the session", "end session",
    "end the practice", "end practice", "end the lesson", "end the quiz",
    "end it here", "end it now", "lets end", "let's end",
    "stop the exercise", "stop the session", "stop the practice",
    "stop practising", "stop practicing", "lets stop", "let's stop",
    "finish the exercise", "finish the session", "finish the practice",
    "finish for now", "finish for today", "finish up",
    "wrap up", "wrap it up", "wrap things up", "lets wrap", "let's wrap",
    "round up the exercise", "round up the session", "round up the lesson",
    "round up the practice", "round up the quiz", "lets round up",
    "let's round up", "round up for now", "round up for today",
    "round things up", "round it up",
    "we're done", "were done", "we are done", "i'm done", "im done",
    "i am done", "that's enough", "thats enough", "that is enough",
    "call it a day", "call it here", "done for today", "done for now",
    "thats all for", "that's all for", "that will be all",
)


def is_session_closing(question: str) -> bool:
    """True when the message is a wrap-up / session-control close.

    Matched as distinctive multi-word phrases so a genuine maths request (e.g.
    "round up 4.5 to the nearest whole number") is never mistaken for a close.
    """
    norm = _normalize(question)
    if not norm:
        return False
    return any(phrase in norm for phrase in _CLOSING_PHRASES)


def classify_keyword(question: str) -> Optional[str]:
    """Best-effort, zero-cost intent label from curated practice phrases.

    Returns :data:`INTENT_PRACTICE` when the message clearly asks to *do*
    practice/exercises/a quiz, else ``None`` so the caller can defer to the LLM
    classifier or keep the default prose path. Deliberately conservative: plan
    and progress routing are left to the LLM classifier so a typed concept
    question ("what should I study next?") keeps its grounded-prose answer.
    """
    norm = _normalize(question)
    if not norm:
        return None
    if any(phrase in norm for phrase in _PRACTICE_PHRASES):
        return INTENT_PRACTICE
    return None


def extract_subject(question: str, known_slugs: Optional[set[str]] = None) -> Optional[str]:
    """Extract an exam-prep subject slug mentioned in a learner message."""
    norm = _normalize(question)
    if not norm:
        return None

    allowed = {slug.strip().lower() for slug in (known_slugs or set()) if slug.strip()}
    for alias, slug in sorted(_SUBJECT_ALIASES.items(), key=lambda item: len(item[0]), reverse=True):
        if alias in norm and (not allowed or slug in allowed):
            return slug

    for slug in sorted(allowed, key=len, reverse=True):
        spoken = slug.replace("_", " ").replace("-", " ")
        if spoken and spoken in norm:
            return slug
    return None


_SYSTEM_PROMPT = (
    "You label a learner's chat message for a Nigerian exam-prep study app "
    "(Wulo, for WAEC/NECO/JAMB/Junior WAEC). Return STRICT JSON only: "
    '{"intent": "<practice|plan|profile|question>"}.\n'
    "Definitions:\n"
    "- practice: the learner wants to DO or START practice, exercises, a quiz, "
    "or 'today's path' — e.g. \"do today's exercises\", 'quiz me on ratios', "
    "\"let's practise\", 'give me a question', 'next question'.\n"
    "- plan: the learner wants to SEE their plan or what to do today — e.g. "
    "\"what's my plan\", \"today's plan\", 'what should I do next'.\n"
    "- profile: the learner wants to SEE their progress or weak areas — e.g. "
    "'how am I doing', 'where am I', 'my weak topics'.\n"
    "- question: anything else — asking to explain, teach, define or answer a "
    "concept, general chat, or a greeting. This is the DEFAULT.\n"
    "Only choose practice/plan/profile when the learner is clearly asking to "
    "start practice, see the plan, or see progress. When unsure, choose "
    "question."
)


class ModelIntentClassifier:
    """LLM intent classifier sharing the Dig-Deeper tutor's deployment."""

    def __init__(self, client: Any, model: str) -> None:
        self.client = client
        self.model = model
        # Adapted per-deployment on the first 400 (newer model families reject
        # ``max_tokens`` / non-default ``temperature``), then remembered.
        self._kwargs: Dict[str, Any] = {"temperature": 0, "max_tokens": 16}

    @classmethod
    def from_settings(cls, settings: Mapping[str, Any]) -> Optional["ModelIntentClassifier"]:
        """Build the classifier, or ``None`` when it should not be used.

        Returns ``None`` (so the caller falls back to the keyword matcher) when
        the flag is off, the model deployment is unresolved, or Azure OpenAI is
        not configured.
        """
        raw_flag = settings.get(INTENT_LLM_FLAG_ENV)
        if raw_flag is None:
            raw_flag = os.environ.get(INTENT_LLM_FLAG_ENV)
        if raw_flag is None or str(raw_flag).strip() == "":
            # Inherit the Dig-Deeper tutor's flag when not explicitly set.
            raw_flag = settings.get(_ASSISTANT_LLM_FLAG_ENV) or os.environ.get(
                _ASSISTANT_LLM_FLAG_ENV, ""
            )
        if str(raw_flag).strip().lower() not in {"1", "true", "yes", "on"}:
            return None

        client = build_openai_client(settings)
        if client is None:
            return None

        model = str(
            settings.get(_ASSISTANT_MODEL_ENV)
            or os.environ.get(_ASSISTANT_MODEL_ENV)
            or settings.get("model_deployment_name")
            or ""
        ).strip()
        if not model:
            return None
        return cls(client, model)

    def classify(self, question: str, context: Optional[Mapping[str, Any]] = None) -> str:
        """Return a validated intent label, defaulting to ``question``."""
        q = (question or "").strip()
        if not q:
            return INTENT_QUESTION

        setup = (context or {}).get("learner_setup") or {}
        subject = str(setup.get("subject") or "").strip()
        user_content = f"Learner subject: {subject}\nMessage: {q}" if subject else q
        messages = [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ]

        kwargs = dict(self._kwargs)
        started = time.perf_counter()
        completion = None
        for _attempt in range(3):
            try:
                completion = self.client.chat.completions.create(
                    model=self.model,
                    messages=messages,
                    response_format={"type": "json_object"},
                    **kwargs,
                )
                break
            except Exception as exc:  # noqa: BLE001
                msg = str(exc)
                adapted = False
                if "max_tokens" in msg and "max_tokens" in kwargs:
                    kwargs["max_completion_tokens"] = kwargs.pop("max_tokens")
                    adapted = True
                if "temperature" in msg and "temperature" in kwargs:
                    kwargs.pop("temperature")
                    adapted = True
                if not adapted:
                    logger.warning("intent classify call failed: %s", exc)
                    return INTENT_QUESTION
                self._kwargs = dict(kwargs)
        if completion is None:
            return INTENT_QUESTION

        try:
            content = completion.choices[0].message.content or "{}"
            label = str(json.loads(content).get("intent") or "").strip().lower()
        except Exception:  # noqa: BLE001
            return INTENT_QUESTION
        logger.info(
            "wulo.assistant_intent label=%s ms=%d",
            label if label in _VALID_INTENTS else "question",
            int((time.perf_counter() - started) * 1000),
        )
        return label if label in _VALID_INTENTS else INTENT_QUESTION


def resolve_intent(
    question: str,
    context: Optional[Mapping[str, Any]] = None,
    *,
    llm: Optional[ModelIntentClassifier] = None,
) -> str:
    """Resolve a typed message to a planner intent.

    Keyword fast-path first (free, instant, and the only signal needed for the
    obvious cases), then the optional LLM classifier for the fuzzy middle.
    Always returns a valid intent; defaults to :data:`INTENT_QUESTION` so an
    uncertain turn keeps the grounded-prose behaviour.
    """
    # A wrap-up ("let's round up the exercise") is the opposite of "do
    # practice" — keep it as prose so the brain answers with a warm close
    # instead of the planner handing back a fresh card.
    if is_session_closing(question):
        return INTENT_QUESTION
    kw = classify_keyword(question)
    if kw is not None:
        return kw
    if llm is not None:
        try:
            return llm.classify(question, context)
        except Exception:  # noqa: BLE001
            logger.warning("intent classifier raised; defaulting to question", exc_info=True)
    return INTENT_QUESTION


__all__ = [
    "INTENT_PRACTICE",
    "INTENT_PLAN",
    "INTENT_PROFILE",
    "INTENT_QUESTION",
    "ModelIntentClassifier",
    "classify_keyword",
    "extract_subject",
    "is_session_closing",
    "resolve_intent",
]
