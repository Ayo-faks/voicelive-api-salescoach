"""Unit coverage for consent-gated episodic misconception memory (Phase 5).

These tests are fully offline and deterministic: ``summarise_traps`` and
``build_memory_callback`` are pure functions over attempt-history dicts. They
verify recurring-trap detection, the consent gate, lookback windowing, taxonomy
label resolution, and safeguarding screening of the assembled callback.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from src.learning.episodic_memory import (
    build_memory_callback,
    summarise_traps,
)


NOW = datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)


def _attempt(code: str, topic: str, *, days_ago: int = 1, correct: bool = False) -> dict:
    return {
        "misconception_code": code,
        "topic": topic,
        "correct": correct,
        "occurred_at": (NOW - timedelta(days=days_ago)).isoformat(),
    }


# ---------------------------------------------------------------------------
# summarise_traps
# ---------------------------------------------------------------------------


def test_summarise_returns_only_recurring_traps() -> None:
    attempts = [
        _attempt("sign_error", "Algebra", days_ago=1),
        _attempt("sign_error", "Algebra", days_ago=3),
        _attempt("place_value", "Decimals", days_ago=2),  # single -> not recurring
    ]
    summaries = summarise_traps(attempts, now=NOW)
    assert len(summaries) == 1
    trap = summaries[0]
    assert trap.code == "sign_error"
    assert trap.label == "Sign error"  # resolved from the taxonomy
    assert trap.topic == "Algebra"
    assert trap.count == 2


def test_summarise_skips_correct_attempts() -> None:
    attempts = [
        _attempt("sign_error", "Algebra", days_ago=1),
        _attempt("sign_error", "Algebra", days_ago=2, correct=True),  # correct -> not a trap
    ]
    assert summarise_traps(attempts, now=NOW) == []


def test_summarise_excludes_attempts_outside_lookback() -> None:
    attempts = [
        _attempt("sign_error", "Algebra", days_ago=1),
        _attempt("sign_error", "Algebra", days_ago=90),  # outside 30-day window
    ]
    assert summarise_traps(attempts, now=NOW, lookback_days=30) == []


def test_summarise_ranks_by_frequency() -> None:
    attempts = [
        _attempt("sign_error", "Algebra", days_ago=1),
        _attempt("sign_error", "Algebra", days_ago=2),
        _attempt("fraction_part_whole", "Fractions", days_ago=1),
        _attempt("fraction_part_whole", "Fractions", days_ago=2),
        _attempt("fraction_part_whole", "Fractions", days_ago=3),
    ]
    summaries = summarise_traps(attempts, now=NOW)
    assert [s.code for s in summaries] == ["fraction_part_whole", "sign_error"]
    assert summaries[0].count == 3


# ---------------------------------------------------------------------------
# build_memory_callback — consent gate
# ---------------------------------------------------------------------------


def test_callback_none_without_consent() -> None:
    attempts = [
        _attempt("sign_error", "Algebra", days_ago=1),
        _attempt("sign_error", "Algebra", days_ago=2),
    ]
    assert build_memory_callback(attempts, memory_allowed=False, now=NOW) is None


def test_callback_none_when_no_recurring_trap() -> None:
    attempts = [_attempt("sign_error", "Algebra", days_ago=1)]
    assert build_memory_callback(attempts, memory_allowed=True, now=NOW) is None


def test_callback_names_recurring_trap_with_consent() -> None:
    attempts = [
        _attempt("sign_error", "Algebra", days_ago=1),
        _attempt("sign_error", "Algebra", days_ago=2),
    ]
    callback = build_memory_callback(attempts, memory_allowed=True, now=NOW)
    assert callback is not None
    assert "sign error trap" in callback
    assert "twice" in callback
    assert "Algebra" in callback


def test_callback_caps_number_of_traps() -> None:
    attempts = []
    for code, topic in (("sign_error", "Algebra"), ("place_value", "Decimals"), ("ratio_inversion", "Ratio")):
        attempts.extend([_attempt(code, topic, days_ago=1), _attempt(code, topic, days_ago=2)])
    callback = build_memory_callback(attempts, memory_allowed=True, now=NOW, max_traps=2)
    assert callback is not None
    # Only two traps are named (one semicolon between exactly two clauses).
    assert callback.count(" trap caught you ") == 2


def test_callback_screens_safeguarding_topic() -> None:
    attempts = [
        _attempt("sign_error", "abuse at home", days_ago=1),
        _attempt("sign_error", "abuse at home", days_ago=2),
    ]
    assert build_memory_callback(attempts, memory_allowed=True, now=NOW) is None
