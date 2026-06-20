"""Unit coverage for the learner "This week" stats builder.

Exercises ``LearningApi.weekly_stats`` directly: the honest cold-start empty
state, distinct-day session counting, consecutive-day streaks, the
last-7d-vs-prior-7d mastery delta, and the recently-practised focus skill —
all derived from persisted ``MasteryEvent`` history.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict

import pytest

from src.learning.api import ITEM_BANK_PATH, LearningApi, PILOT_TENANT_ID
from src.learning.diagnostic import load_item_bank
from src.learning.errors import LearningApiError
from src.learning.models import MasteryEstimate


def _bank_path() -> Path:
    assert ITEM_BANK_PATH.exists(), f"item bank fixture missing at {ITEM_BANK_PATH}"
    return ITEM_BANK_PATH


@pytest.fixture()
def learning_api() -> LearningApi:
    return LearningApi(item_bank=load_item_bank(_bank_path()))


def _beta(probability: float) -> MasteryEstimate:
    return MasteryEstimate(
        kind="beta", probability=probability, uncertainty=0.4, a=2.0, b=2.0
    )


def _event(
    student_id: str, skill_id: str, probability: float, *, days_ago: float
) -> Dict[str, Any]:
    occurred = (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat()
    return {
        "tenant_id": PILOT_TENANT_ID,
        "student_id": student_id,
        "skill_id": skill_id,
        "estimate": _beta(probability).model_dump(),
        "created_at": occurred,
    }


def test_cold_start_returns_honest_zeros(learning_api: LearningApi):
    stats = learning_api.weekly_stats({"student_id": "brand-new-learner"})
    assert stats == {
        "sessions": {"completed": 0, "target": 5},
        "streak_days": 0,
        "current_mastery_pct": None,
        "mastery_delta_pct": 0.0,
        "mastery_focus_label": "",
    }


def test_missing_student_id_raises(learning_api: LearningApi):
    with pytest.raises(LearningApiError):
        learning_api.weekly_stats({})


def test_sessions_count_distinct_active_days(learning_api: LearningApi):
    repo = learning_api.repository
    # Two events the same day collapse to one "session"; a separate day adds one.
    repo.mastery_events.append(_event("stu-days", "ratio-proportion", 0.5, days_ago=0))  # type: ignore[attr-defined]
    repo.mastery_events.append(_event("stu-days", "ratio-proportion", 0.6, days_ago=0))  # type: ignore[attr-defined]
    repo.mastery_events.append(_event("stu-days", "fraction-operations", 0.4, days_ago=2))  # type: ignore[attr-defined]

    stats = learning_api.weekly_stats({"student_id": "stu-days"})
    assert stats["sessions"] == {"completed": 2, "target": 5}


def test_streak_counts_consecutive_days_only(learning_api: LearningApi):
    repo = learning_api.repository
    for day in (0, 1, 2):
        repo.mastery_events.append(  # type: ignore[attr-defined]
            _event("stu-streak", "ratio-proportion", 0.5, days_ago=day)
        )
    # A gap at day 3 then activity at day 4 must NOT extend the current streak.
    repo.mastery_events.append(  # type: ignore[attr-defined]
        _event("stu-streak", "ratio-proportion", 0.5, days_ago=4)
    )

    stats = learning_api.weekly_stats({"student_id": "stu-streak"})
    assert stats["streak_days"] == 3


def test_mastery_delta_last_week_vs_prior_week(learning_api: LearningApi):
    repo = learning_api.repository
    repo.mastery_events.append(  # type: ignore[attr-defined]
        _event("stu-grow", "ratio-proportion", 0.40, days_ago=10)
    )
    repo.mastery_events.append(  # type: ignore[attr-defined]
        _event("stu-grow", "ratio-proportion", 0.80, days_ago=1)
    )

    stats = learning_api.weekly_stats({"student_id": "stu-grow"})
    # mean(recent)=0.80, mean(prior)=0.40 -> +40.0 percentage points.
    assert stats["current_mastery_pct"] == 80.0
    assert stats["mastery_delta_pct"] == 40.0
    assert stats["mastery_focus_label"] != ""


def test_current_mastery_uses_latest_estimate_per_skill(learning_api: LearningApi):
    repo = learning_api.repository
    repo.mastery_events.append(_event("stu-current", "ratio-proportion", 0.30, days_ago=2))  # type: ignore[attr-defined]
    repo.mastery_events.append(_event("stu-current", "ratio-proportion", 0.70, days_ago=1))  # type: ignore[attr-defined]
    repo.mastery_events.append(_event("stu-current", "fraction-operations", 0.50, days_ago=0))  # type: ignore[attr-defined]

    stats = learning_api.weekly_stats({"student_id": "stu-current"})

    assert stats["current_mastery_pct"] == 60.0


def test_mastery_delta_zero_without_prior_window(learning_api: LearningApi):
    repo = learning_api.repository
    # Only recent evidence -> no truthful comparison -> 0.0, never invented.
    repo.mastery_events.append(  # type: ignore[attr-defined]
        _event("stu-recent", "ratio-proportion", 0.90, days_ago=1)
    )
    stats = learning_api.weekly_stats({"student_id": "stu-recent"})
    assert stats["current_mastery_pct"] == 90.0
    assert stats["mastery_delta_pct"] == 0.0
    assert stats["sessions"]["completed"] == 1


def test_focus_is_most_practised_recent_skill(learning_api: LearningApi):
    repo = learning_api.repository
    repo.mastery_events.append(_event("stu-focus", "ratio-proportion", 0.5, days_ago=1))  # type: ignore[attr-defined]
    repo.mastery_events.append(_event("stu-focus", "ratio-proportion", 0.6, days_ago=1))  # type: ignore[attr-defined]
    repo.mastery_events.append(_event("stu-focus", "fraction-operations", 0.4, days_ago=2))  # type: ignore[attr-defined]

    stats = learning_api.weekly_stats({"student_id": "stu-focus"})
    assert "ratio" in stats["mastery_focus_label"].lower()
