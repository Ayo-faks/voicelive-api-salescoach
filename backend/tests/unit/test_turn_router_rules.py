"""Table-driven tests for the turn router classifier."""

from __future__ import annotations

import pytest

from src.services.turn_router import classify
from src.services.turn_router.types import RouterConfig


CHITCHAT_CASES = [
    "hi",
    "Hi.",
    "HELLO",
    "hey",
    "hey!",
    "yo",
    "hiya",
    "howdy",
    "good morning",
    "Good Morning!",
    "good afternoon",
    "good evening",
    "thanks",
    "thank you",
    "thank you.",
    "ta",
    "cheers",
    "ok",
    "okay",
    "cool",
    "nice",
    "great",
    "awesome",
    "sorry",
    "bye",
    "goodbye",
    "see you",
    "see ya",
    "how are you",
    "how are you doing",
    "are you there",
    "you there?",
    "can you hear me",
    "nice to meet you",
]


INSIGHTS_CASES = [
    # Empty / whitespace
    "",
    "   ",
    # Digits
    "what about session 7",
    "score 80",
    # Deny verbs / data nouns
    "show me ada's progress",
    "list children",
    "tell me about ada",
    "find sessions",
    "summarise this week",
    "summarize this week",
    "compare ada and ben",
    "what is the score",
    "who is ada",
    "how did ada do today",
    "why did mastery drop",
    "when was the last session",
    "where is the report",
    "which child needs help",
    # Data nouns alone
    "score",
    "mastery",
    "progress",
    "plan",
    "intervention",
    "report",
    "assessment",
    "grade",
    "session",
    # Time references
    "today",
    "yesterday",
    "this week",
    "last month",
    # Length guard (>8 tokens, no allow-list match)
    "by the way I really like working with you today",
]


@pytest.mark.parametrize("message", CHITCHAT_CASES)
def test_chitchat_messages_route_to_chitchat(message: str) -> None:
    decision = classify(message)
    assert decision.route == "chitchat", f"{message!r} → {decision}"
    assert decision.classifier == "rules"
    assert decision.reason == "allow:exact"


@pytest.mark.parametrize("message", INSIGHTS_CASES)
def test_insights_messages_route_to_insights(message: str) -> None:
    decision = classify(message)
    assert decision.route == "insights", f"{message!r} → {decision}"


def test_unknown_short_text_defaults_to_insights() -> None:
    # No deny tokens, no allow-list match, short → still insights.
    decision = classify("blue penguin")
    assert decision.route == "insights"
    assert decision.reason == "default"


def test_router_config_unused_does_not_change_decision() -> None:
    # Phase 1 classify ignores config, but accepts it without error.
    decision = classify("hi", config=RouterConfig(enabled=True))
    assert decision.route == "chitchat"


def test_digit_takes_precedence_over_allow_phrase() -> None:
    # "hi 7" must NOT be chitchat — digits go to planner.
    decision = classify("hi 7")
    assert decision.route == "insights"
    assert decision.reason == "deny:digit"


# ---------------------------------------------------------------------------
# L2 fuzzy/token classifier
# ---------------------------------------------------------------------------


FUZZY_CHITCHAT_CASES = [
    "hello how are you doing today",
    "thanks so much for that",
    "hey nice to meet you mate",
    "appreciate it buddy",
    "good morning sir",
    "well thanks pal",
    "hey there friend",
    "cheers dude",
]


@pytest.mark.parametrize("message", FUZZY_CHITCHAT_CASES)
def test_fuzzy_chitchat_routes_to_chitchat(message: str) -> None:
    decision = classify(message)
    assert decision.route == "chitchat", f"{message!r} → {decision}"
    assert decision.classifier == "fuzzy"
    assert decision.reason.startswith("fuzzy:tokens=")
    assert 0.6 <= decision.confidence <= 0.9


FUZZY_INSIGHTS_CASES = [
    # Strong chitchat vocab present but hard-deny token wins.
    "thanks show me the scores",
    "hi list the pending approvals",
    "hello what is bobby's mastery",
    "good morning compare ada and ben",
    "thanks for the progress update",
    # 11+ words even with chitchat vocab → defer past fuzzy → length_guard.
    "thanks I just wanted to say I really like working with you",
    # No chitchat vocab → falls through to default-insights.
    "blue penguin walking",
]


@pytest.mark.parametrize("message", FUZZY_INSIGHTS_CASES)
def test_fuzzy_chitchat_negatives_route_to_insights(message: str) -> None:
    decision = classify(message)
    assert decision.route == "insights", f"{message!r} → {decision}"


def test_fuzzy_does_not_supersede_rules_allow_list() -> None:
    # Exact allow-list phrase must remain classifier=rules, not fuzzy.
    decision = classify("hi")
    assert decision.route == "chitchat"
    assert decision.classifier == "rules"
    assert decision.reason == "allow:exact"


def test_fuzzy_confidence_scales_with_overlap() -> None:
    one = classify("hello there friend")  # hello + friend → 2 matches
    assert one.classifier == "fuzzy"
    assert one.confidence >= 0.7

    many = classify("hey nice mate buddy")  # hey + nice + mate + buddy
    assert many.classifier == "fuzzy"
    assert many.confidence >= one.confidence
