"""Unit coverage for the adaptive learner daily-plan builder.

Exercises ``LearningApi.build_learner_plan`` directly: the deterministic
fallback for brand-new learners, mastery-ranked ordering from the in-process
estimate cache, and the persisted ``MasteryEvent`` path through
``InMemoryLearningRepository.list_mastery_events_for_student``.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from src.learning.api import ITEM_BANK_PATH, LearningApi, PILOT_TENANT_ID
from src.learning.diagnostic import load_item_bank
from src.learning.models import MasteryEstimate


def _bank_path() -> Path:
    assert ITEM_BANK_PATH.exists(), f"item bank fixture missing at {ITEM_BANK_PATH}"
    return ITEM_BANK_PATH


@pytest.fixture()
def learning_api() -> LearningApi:
    return LearningApi(item_bank=load_item_bank(_bank_path()))


def _beta(probability: float) -> MasteryEstimate:
    return MasteryEstimate(kind="beta", probability=probability, uncertainty=0.4, a=2.0, b=2.0)


def test_fallback_plan_for_new_learner(learning_api: LearningApi):
    plan = learning_api.build_learner_plan({"student_id": "brand-new-learner"})

    assert plan["source"] == "fallback"
    assert plan["exam"] == "WAEC"
    assert plan["class_year"] == "SSS2"
    assert plan["subject"] == "Mathematics"
    assert plan["weak_topics"] == []
    assert 1 <= len(plan["today"]) <= 3
    # The queue is shaped as a check-in → practice → exit-ticket walk.
    assert plan["today"][0]["type"] == "check-in"
    assert all(item["minutes"] >= 1 for item in plan["today"])
    assert all(item["subject"] == "mathematics" for item in plan["today"])


def test_plan_ranks_weakest_skill_first_from_cache(learning_api: LearningApi):
    learning_api._student_estimates[(PILOT_TENANT_ID, "stu-cache")] = {
        "trigonometry": _beta(0.20),
        "differentiation": _beta(0.80),
    }

    plan = learning_api.build_learner_plan(
        {
            "student_id": "stu-cache",
            "exam": "WAEC",
            "class_year": "SSS2",
            "subject": "Mathematics",
        }
    )

    assert plan["source"] == "mastery"
    weak = plan["weak_topics"]
    assert weak[0]["skill_id"] == "trigonometry"
    assert weak[0]["mastery"] == 20
    # Strictly ascending mastery (weakest first).
    masteries = [topic["mastery"] for topic in weak]
    assert masteries == sorted(masteries)
    # The weakest skill's card is promoted to the front of today's queue even
    # though it is authored second in the deterministic bank.
    skill_order = [item["skill_id"] for item in plan["today"]]
    assert skill_order[0] == "trigonometry"


def test_persisted_mastery_events_drive_mastery_source(learning_api: LearningApi):
    repo = learning_api.repository
    # Oldest first; the repository returns newest-first so the later record wins.
    repo.mastery_events.append(  # type: ignore[attr-defined]
        {
            "tenant_id": PILOT_TENANT_ID,
            "student_id": "stu-persist",
            "skill_id": "ratio-proportion",
            "estimate": _beta(0.90).model_dump(),
        }
    )
    repo.mastery_events.append(  # type: ignore[attr-defined]
        {
            "tenant_id": PILOT_TENANT_ID,
            "student_id": "stu-persist",
            "skill_id": "ratio-proportion",
            "estimate": _beta(0.20).model_dump(),
        }
    )

    plan = learning_api.build_learner_plan(
        {
            "student_id": "stu-persist",
            "exam": "WAEC",
            "class_year": "SSS2",
            "subject": "Mathematics",
        }
    )

    assert plan["source"] == "mastery"
    weak = {topic["skill_id"]: topic["mastery"] for topic in plan["weak_topics"]}
    # Newest event (0.20) wins over the older 0.90 for the same skill.
    assert weak["ratio-proportion"] == 20


def test_invalid_exam_for_class_falls_back_to_default(learning_api: LearningApi):
    learning_api._student_estimates[(PILOT_TENANT_ID, "stu-mismatch")] = {
        "ratio-proportion": _beta(0.40),
    }

    # Junior WAEC is not valid for an SSS2 class -> no candidate cards ->
    # taxonomy falls back to the deterministic default, but mastery history is
    # still honoured for the weak-topic ranking.
    plan = learning_api.build_learner_plan(
        {
            "student_id": "stu-mismatch",
            "exam": "Junior WAEC",
            "class_year": "SSS2",
            "subject": "Mathematics",
        }
    )

    assert plan["source"] == "mastery"
    assert plan["exam"] == "WAEC"
    assert plan["class_year"] == "SSS2"
    assert len(plan["today"]) >= 1


def test_missing_student_id_raises(learning_api: LearningApi):
    from src.learning.errors import LearningApiError

    with pytest.raises(LearningApiError):
        learning_api.build_learner_plan({})
