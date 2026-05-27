"""Contract tests — W8 weekly digest."""

from __future__ import annotations

import pytest

from src.learning.beta.weekly_digest import (
    WEEKLY_DIGEST_FLAG,
    WEEKLY_DIGEST_RULE_ID,
    LearnerActivity,
    WeeklyDigestUnavailableError,
    build_weekly_digest,
)


@pytest.fixture(autouse=True)
def _enable_flag(monkeypatch):
    monkeypatch.setenv(WEEKLY_DIGEST_FLAG, "1")
    yield


def _activity(
    learner_id: str,
    *,
    week: str = "2026-W18",
    sessions: int = 3,
    minutes: int = 45,
    attempted: int = 20,
    correct: int = 12,
    explanations: int = 5,
    retries: int = 3,
    refusals: int = 0,
    crisis: int = 0,
    misc=(),
    year_group: str = "ss1",
) -> LearnerActivity:
    return LearnerActivity(
        learner_id=learner_id,
        tenant_id="tnt-1",
        year_group=year_group,
        week_iso=week,
        sessions=sessions,
        minutes_on_task=minutes,
        items_attempted=attempted,
        items_correct=correct,
        explanations_shown=explanations,
        retries_after_explanation=retries,
        refusals_no_grounding=refusals,
        crisis_safe_responses=crisis,
        top_misconceptions=tuple(misc),
    )


def test_kill_switch_blocks(monkeypatch):
    monkeypatch.delenv(WEEKLY_DIGEST_FLAG, raising=False)
    with pytest.raises(WeeklyDigestUnavailableError):
        build_weekly_digest([], week_iso="2026-W18", cohort_size=0)


def test_force_disabled_runs(monkeypatch):
    monkeypatch.delenv(WEEKLY_DIGEST_FLAG, raising=False)
    digest = build_weekly_digest(
        [], week_iso="2026-W18", cohort_size=0, require_flag=False
    )
    assert digest.cohort_size == 0
    assert digest.rule_id == WEEKLY_DIGEST_RULE_ID


def test_empty_activity_zero_metrics():
    digest = build_weekly_digest([], week_iso="2026-W18", cohort_size=50)
    assert digest.active_learners == 0
    assert digest.cohort_accuracy == 0.0
    assert digest.retry_after_explanation_rate == 0.0
    assert digest.meets_retry_target is False


def test_totals_and_active_count():
    activities = [
        _activity("a", sessions=2, minutes=30, attempted=10, correct=6),
        _activity("b", sessions=0, minutes=0, attempted=0, correct=0,
                  explanations=0, retries=0),
        _activity("c", sessions=1, minutes=20, attempted=5, correct=4),
    ]
    digest = build_weekly_digest(activities, week_iso="2026-W18", cohort_size=3)
    assert digest.active_learners == 2
    assert digest.total_minutes == 50
    assert digest.total_items_attempted == 15
    assert digest.cohort_accuracy == round(10 / 15, 4)


def test_retry_target_met_at_or_above_threshold():
    # explanations=10, retries=6 -> 0.6 >= 0.55
    a = _activity("a", explanations=10, retries=6)
    digest = build_weekly_digest([a], week_iso="2026-W18", cohort_size=1)
    assert digest.retry_after_explanation_rate == 0.6
    assert digest.meets_retry_target is True


def test_retry_target_missed_below_threshold():
    a = _activity("a", explanations=10, retries=5)  # 0.5 < 0.55
    digest = build_weekly_digest([a], week_iso="2026-W18", cohort_size=1)
    assert digest.meets_retry_target is False


def test_retry_zero_explanations_treated_as_zero():
    a = _activity("a", explanations=0, retries=0)
    digest = build_weekly_digest([a], week_iso="2026-W18", cohort_size=1)
    assert digest.retry_after_explanation_rate == 0.0
    assert digest.meets_retry_target is False


def test_top_misconceptions_counter_ranked():
    activities = [
        _activity("a", misc=("frac.add.unlikedenom", "frac.eq")),
        _activity("b", misc=("frac.add.unlikedenom",)),
        _activity("c", misc=("frac.eq",)),
        _activity("d", misc=("frac.add.unlikedenom",)),
    ]
    digest = build_weekly_digest(activities, week_iso="2026-W18", cohort_size=4)
    codes = [code for code, _ in digest.top_misconceptions]
    assert codes[0] == "frac.add.unlikedenom"
    assert ("frac.add.unlikedenom", 3) in digest.top_misconceptions


def test_rejects_correct_exceeds_attempted():
    with pytest.raises(ValueError):
        _activity("a", attempted=2, correct=5)


def test_rejects_retries_exceed_explanations():
    with pytest.raises(ValueError):
        _activity("a", explanations=2, retries=5)


def test_rejects_activity_week_mismatch():
    a = _activity("a", week="2026-W18")
    with pytest.raises(ValueError):
        build_weekly_digest([a], week_iso="2026-W19", cohort_size=1)


def test_learner_snapshots_sorted_and_complete():
    activities = [_activity("z"), _activity("a"), _activity("m")]
    digest = build_weekly_digest(activities, week_iso="2026-W18", cohort_size=3)
    assert [s.learner_id for s in digest.learner_snapshots] == ["a", "m", "z"]


def test_signature_present_and_deterministic_per_payload():
    activities = [_activity("a")]
    d1 = build_weekly_digest(activities, week_iso="2026-W18", cohort_size=1)
    d2 = build_weekly_digest(activities, week_iso="2026-W18", cohort_size=1)
    # signature excludes generated_at and digest_id
    assert d1.signature == d2.signature
    assert len(d1.signature) == 64
