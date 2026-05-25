"""Output filter tests: ensure chitchat replies never leak data."""

from __future__ import annotations

import pytest

from src.services.turn_router import scrub_chitchat_response
from src.services.turn_router.rules import CHITCHAT_FALLBACK_REPLY


CLEAN_CASES = [
    "Hi there! How can I help?",
    "You're welcome.",
    "Glad to hear it.",
    "Good morning to you too.",
    "Have a great rest of your day.",
]


DIRTY_CASES = [
    "Her score is 80",
    "Ada's mastery is improving",
    "The plan is to focus on phonics",
    "Progress looks good",
    "The intervention worked",
    "Assessment shows growth",
    "She is at 75% mastery",
    "Last session went well",
    "Here is the report",
    "Grade A",
    "",
    "   ",
]


@pytest.mark.parametrize("text", CLEAN_CASES)
def test_clean_replies_pass_through(text: str) -> None:
    reply, dirty = scrub_chitchat_response(text)
    assert dirty is False
    assert reply == text.strip()


@pytest.mark.parametrize("text", DIRTY_CASES)
def test_dirty_replies_are_replaced(text: str) -> None:
    reply, dirty = scrub_chitchat_response(text)
    assert dirty is True
    assert reply == CHITCHAT_FALLBACK_REPLY
