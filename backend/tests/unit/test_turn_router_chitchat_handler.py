"""Unit tests for the chitchat handler."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any, List

import pytest

from src.services.insights_service import InsightsRequestContext
from src.services.turn_router.handlers.chitchat_handler import ChitchatHandler
from src.services.turn_router.rules import CHITCHAT_FALLBACK_REPLY


class _FakeCompletions:
    def __init__(self, *, content: str = "Hi there!", raise_exc: Exception | None = None) -> None:
        self._content = content
        self._raise_exc = raise_exc
        self.calls: List[dict] = []

    def create(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        if self._raise_exc is not None:
            raise self._raise_exc
        return SimpleNamespace(
            choices=[
                SimpleNamespace(message=SimpleNamespace(content=self._content))
            ]
        )


def _fake_client(*, content: str = "Hi there!", raise_exc: Exception | None = None) -> Any:
    completions = _FakeCompletions(content=content, raise_exc=raise_exc)
    return SimpleNamespace(chat=SimpleNamespace(completions=completions)), completions


def _ctx() -> InsightsRequestContext:
    return InsightsRequestContext(
        user_id="u",
        scope={"type": "caseload"},
        storage_service=None,
        deadline_monotonic=None,
    )


def test_chitchat_handler_returns_clean_reply() -> None:
    client, completions = _fake_client(content="Hi there!")
    handler = ChitchatHandler(client, model="gpt-4o-mini")
    result = handler.handle(user_message="hi", history=[], context=_ctx())
    assert result.answer_text == "Hi there!"
    assert result.error_text is None
    assert completions.calls[0]["model"] == "gpt-4o-mini"
    assert completions.calls[0]["max_tokens"] == 80
    # System prompt is first message.
    assert completions.calls[0]["messages"][0]["role"] == "system"
    assert completions.calls[0]["messages"][1] == {"role": "user", "content": "hi"}


def test_chitchat_handler_scrubs_dirty_reply() -> None:
    client, _ = _fake_client(content="Her score is 80")
    handler = ChitchatHandler(client, model="gpt-4o-mini")
    result = handler.handle(user_message="hi", history=[], context=_ctx())
    assert result.answer_text == CHITCHAT_FALLBACK_REPLY
    assert result.error_text == "chitchat_output_dirty"


def test_chitchat_handler_swallows_transport_errors() -> None:
    client, _ = _fake_client(raise_exc=RuntimeError("boom"))
    handler = ChitchatHandler(client, model="gpt-4o-mini")
    result = handler.handle(user_message="hi", history=[], context=_ctx())
    assert result.answer_text == CHITCHAT_FALLBACK_REPLY
    assert result.error_text is not None
    assert result.error_text.startswith("chitchat_error")


def test_chitchat_handler_handles_empty_content() -> None:
    client, _ = _fake_client(content="   ")
    handler = ChitchatHandler(client, model="gpt-4o-mini")
    result = handler.handle(user_message="hi", history=[], context=_ctx())
    assert result.answer_text == CHITCHAT_FALLBACK_REPLY
    assert result.error_text == "chitchat_empty"


def test_chitchat_handler_no_client_returns_fallback() -> None:
    handler = ChitchatHandler(client=None, model="gpt-4o-mini")
    result = handler.handle(user_message="hi", history=[], context=_ctx())
    assert result.answer_text == CHITCHAT_FALLBACK_REPLY
    assert result.error_text == "chitchat_no_client"
