"""Chitchat handler: short, no-tools Azure OpenAI completion.

Cost budget: one chat-completion call, ~80 output tokens, ~4 second
wall-clock cap. Any failure (timeout, transport error, empty reply) is
turned into a :class:`InsightsPlannerResult` with ``error_text`` set so
the caller can transparently fall back to the planner.
"""

from __future__ import annotations

import logging
import time
from typing import Any, Mapping, Optional, Sequence

from src.services.insights_service import (
    InsightsPlannerResult,
    InsightsRequestContext,
)
from src.services.turn_router.output_filter import scrub_chitchat_response

logger = logging.getLogger(__name__)


CHITCHAT_SYSTEM_PROMPT = (
    "You are Pathfinder, a warm, brief voice assistant for therapists and "
    "teachers. Reply in one short sentence (max ~15 words). Be friendly "
    "and human, never clinical.\n"
    "\n"
    "You have NO access to user data, children, students, sessions, scores, "
    "plans, or any record. If the user asks about a child, student, score, "
    "plan, intervention, progress, or any data, reply EXACTLY: "
    "\"I'll check that for you.\" and nothing else."
)


class ChitchatHandler:
    """Phase 1 chit-chat handler.

    The handler accepts any object with an OpenAI-compatible
    ``chat.completions.create`` method — typically the
    :class:`openai.AzureOpenAI` client built by
    :func:`src.services.azure_openai_auth.build_openai_client`.
    """

    name = "chitchat"

    def __init__(
        self,
        client: Any,
        *,
        model: str,
        timeout_seconds: float = 4.0,
        max_tokens: int = 80,
        temperature: float = 0.6,
        system_prompt: str = CHITCHAT_SYSTEM_PROMPT,
    ) -> None:
        self._client = client
        self._model = model
        self._timeout_seconds = float(timeout_seconds)
        self._max_tokens = int(max_tokens)
        self._temperature = float(temperature)
        self._system_prompt = system_prompt

    def handle(
        self,
        *,
        user_message: str,
        history: Sequence[Mapping[str, Any]],
        context: InsightsRequestContext,
    ) -> InsightsPlannerResult:
        del history, context  # chitchat is stateless by design.

        if self._client is None:
            return self._fallback("chitchat_no_client")

        start = time.monotonic()
        try:
            response = self._client.chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": self._system_prompt},
                    {"role": "user", "content": user_message},
                ],
                max_tokens=self._max_tokens,
                temperature=self._temperature,
                timeout=self._timeout_seconds,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "chitchat handler failed: %s", exc, exc_info=False
            )
            return self._fallback(f"chitchat_error: {exc}")

        latency_ms = int((time.monotonic() - start) * 1000)
        raw_text = _extract_text(response)
        if not raw_text:
            return self._fallback("chitchat_empty")

        scrubbed, dirty = scrub_chitchat_response(raw_text)
        if dirty:
            return InsightsPlannerResult(
                answer_text=scrubbed,
                error_text="chitchat_output_dirty",
            )

        logger.debug(
            "chitchat reply latency_ms=%s tokens=%s",
            latency_ms,
            len(scrubbed.split()),
        )
        return InsightsPlannerResult(answer_text=scrubbed)

    @staticmethod
    def _fallback(reason: str) -> InsightsPlannerResult:
        from src.services.turn_router.rules import CHITCHAT_FALLBACK_REPLY

        return InsightsPlannerResult(
            answer_text=CHITCHAT_FALLBACK_REPLY,
            error_text=reason,
        )


def _extract_text(response: Any) -> Optional[str]:
    """Best-effort text extraction from an OpenAI chat completion."""

    try:
        choice = response.choices[0]
    except (AttributeError, IndexError, TypeError):
        return None
    message = getattr(choice, "message", None)
    if message is None and isinstance(choice, Mapping):
        message = choice.get("message")
    if message is None:
        return None
    content = getattr(message, "content", None)
    if content is None and isinstance(message, Mapping):
        content = message.get("content")
    if not isinstance(content, str):
        return None
    return content.strip() or None
