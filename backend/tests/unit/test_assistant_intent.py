"""Unit coverage for natural-language intent routing (:mod:`assistant_intent`).

The always-on composer only sends a free-form ``question``; these tests pin the
zero-cost keyword fast-path and the fail-open behaviour of ``resolve_intent`` so
a typed practice request lands on a card while a real question stays prose.
"""

from __future__ import annotations

import pytest

from src.learning.assistant_intent import (
    INTENT_PRACTICE,
    INTENT_QUESTION,
    classify_keyword,
    extract_subject,
    is_session_closing,
    resolve_intent,
)


@pytest.mark.parametrize(
    "text",
    [
        "do today's path exercises",
        "do todays exercises",
        "quiz me",
        "give me a question",
        "next question",
        "let's practise",
        "start practice",
        "okay, can we continue with today's exercises, please?",
        "can i answer today's mcq questions? the quiz, please",
    ],
)
def test_keyword_practice(text: str) -> None:
    assert classify_keyword(text) == INTENT_PRACTICE


def test_keyword_practice_handles_subject_questions() -> None:
    assert classify_keyword("give me agric questions to practice") == INTENT_PRACTICE


@pytest.mark.parametrize(
    "text, expected",
    [
        ("give me agric questions to practice", "agricultural_science"),
        ("quiz me on government", "government"),
        ("let's practise data processing", "data_processing"),
        ("physics questions please", "physics"),
    ],
)
def test_extract_subject_aliases(text: str, expected: str) -> None:
    assert extract_subject(
        text,
        {
            "agricultural_science",
            "data_processing",
            "government",
            "physics",
        },
    ) == expected


@pytest.mark.parametrize(
    "text",
    [
        # The keyword fast-path is deliberately practice-only: plan / progress
        # and genuine questions stay None so prose behaviour is preserved.
        "what is photosynthesis",
        "explain ratios to me",
        "what should i do today",
        "what's my plan",
        "my progress",
        "hi",
        "thanks",
        "",
    ],
)
def test_keyword_returns_none_for_non_practice(text: str) -> None:
    assert classify_keyword(text) is None


def test_resolve_intent_uses_keyword_without_llm() -> None:
    assert resolve_intent("do today's path exercises", {}, llm=None) == INTENT_PRACTICE
    assert resolve_intent("what is osmosis?", {}, llm=None) == INTENT_QUESTION


class _StubLLM:
    def __init__(self, label: str) -> None:
        self.label = label
        self.calls = 0

    def classify(self, question: str, context=None) -> str:  # noqa: ANN001
        self.calls += 1
        return self.label


def test_resolve_intent_defers_to_llm_only_when_keyword_misses() -> None:
    llm = _StubLLM(INTENT_PRACTICE)
    # Obvious keyword match short-circuits before the LLM is consulted.
    assert resolve_intent("quiz me", {}, llm=llm) == INTENT_PRACTICE
    assert llm.calls == 0
    # Ambiguous phrasing falls through to the LLM classifier.
    assert resolve_intent("i'd like to have a go at some sums", {}, llm=llm) == INTENT_PRACTICE
    assert llm.calls == 1


def test_resolve_intent_fails_open_when_llm_raises() -> None:
    class _Boom:
        def classify(self, question: str, context=None) -> str:  # noqa: ANN001
            raise RuntimeError("model down")

    assert resolve_intent("ambiguous mumble", {}, llm=_Boom()) == INTENT_QUESTION


@pytest.mark.parametrize(
    "text",
    [
        "lets round up the exercise",
        "Okay, let's end it. End the exercise please.",
        "wrap it up for today",
        "we're done",
        "stop the practice",
    ],
)
def test_session_closing_stays_prose_even_when_llm_says_practice(text: str) -> None:
    # A wrap-up must never be routed to the planner — even if the LLM would
    # mislabel it as practice — so the brain answers with a warm close instead
    # of handing back a fresh card. The LLM must not even be consulted.
    llm = _StubLLM(INTENT_PRACTICE)
    assert resolve_intent(text, {}, llm=llm) == INTENT_QUESTION
    assert llm.calls == 0


def test_round_up_maths_is_not_a_session_close() -> None:
    # "round up" as a maths verb is a genuine question, not a close.
    assert is_session_closing("round up 4.5 to the nearest whole number") is False
    assert is_session_closing("lets round up the exercise") is True
