"""Tests for retry-after-explanation aggregation (W3-A)."""

from __future__ import annotations

import pytest

from src.learning.retry_metrics import (
    RetryOutcomeRecord,
    aggregate_retry_outcomes,
    detect_regressions,
)


def _records(question: str, version: str, *, ok: int, ko: int):
    return (
        [RetryOutcomeRecord(question, version, True)] * ok
        + [RetryOutcomeRecord(question, version, False)] * ko
    )


def test_aggregate_empty_stream_returns_empty_list() -> None:
    assert aggregate_retry_outcomes([]) == []


def test_aggregate_groups_by_question_and_explanation_version() -> None:
    records = (
        _records("q1", "v1", ok=3, ko=1)
        + _records("q1", "v2", ok=1, ko=3)
        + _records("q2", "v1", ok=2, ko=2)
    )
    stats = aggregate_retry_outcomes(records)
    by_key = {(s.question_id, s.explanation_version): s for s in stats}
    assert by_key[("q1", "v1")].attempts == 4
    assert by_key[("q1", "v1")].successes == 3
    assert by_key[("q1", "v1")].rate == pytest.approx(0.75)
    assert by_key[("q1", "v2")].rate == pytest.approx(0.25)
    assert by_key[("q2", "v1")].rate == pytest.approx(0.5)


def test_aggregate_output_is_sorted_stable() -> None:
    records = _records("q2", "v1", ok=1, ko=0) + _records("q1", "v2", ok=1, ko=0) + _records("q1", "v1", ok=1, ko=0)
    stats = aggregate_retry_outcomes(records)
    assert [(s.question_id, s.explanation_version) for s in stats] == [
        ("q1", "v1"),
        ("q1", "v2"),
        ("q2", "v1"),
    ]


def test_wilson_interval_brackets_point_estimate() -> None:
    # 80% success on n=50 should bracket 0.80.
    records = _records("q", "v", ok=40, ko=10)
    [stat] = aggregate_retry_outcomes(records)
    assert stat.ci_low < stat.rate < stat.ci_high
    assert 0.0 <= stat.ci_low <= 1.0
    assert 0.0 <= stat.ci_high <= 1.0


def test_wilson_interval_widens_for_small_n() -> None:
    small = aggregate_retry_outcomes(_records("q", "v", ok=4, ko=1))
    large = aggregate_retry_outcomes(_records("q", "v", ok=400, ko=100))
    s, l = small[0], large[0]
    # Same point estimate, but small-N interval should be much wider.
    assert s.rate == pytest.approx(l.rate)
    assert (s.ci_high - s.ci_low) > (l.ci_high - l.ci_low)


def test_aggregate_skips_blank_identifiers() -> None:
    records = [
        RetryOutcomeRecord("", "v", True),
        RetryOutcomeRecord("q", "", False),
        RetryOutcomeRecord("q", "v", True),
    ]
    stats = aggregate_retry_outcomes(records)
    assert len(stats) == 1
    assert stats[0].attempts == 1


def test_detect_regressions_flags_only_meaningful_drops() -> None:
    previous = aggregate_retry_outcomes(_records("q", "v", ok=80, ko=20))   # 0.80
    current = aggregate_retry_outcomes(_records("q", "v", ok=30, ko=70))    # 0.30 → 50pp drop
    flags = detect_regressions(current, previous)
    assert len(flags) == 1
    qid, ver, drop_pp = flags[0]
    assert qid == "q" and ver == "v"
    assert drop_pp == pytest.approx(50.0, abs=0.5)


def test_detect_regressions_ignores_small_sample() -> None:
    previous = aggregate_retry_outcomes(_records("q", "v", ok=8, ko=2))   # n=10
    current = aggregate_retry_outcomes(_records("q", "v", ok=2, ko=8))    # n=10
    # Big drop, but below default min_attempts=30 → no flag.
    assert detect_regressions(current, previous) == []


def test_detect_regressions_ignores_small_drops() -> None:
    previous = aggregate_retry_outcomes(_records("q", "v", ok=60, ko=40))   # 0.60
    current = aggregate_retry_outcomes(_records("q", "v", ok=55, ko=45))    # 0.55 → 5pp drop
    assert detect_regressions(current, previous) == []
