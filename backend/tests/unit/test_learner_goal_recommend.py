"""Unit coverage for goal soft-bias in the planner and ``set_goal_and_recommend``.

Asserts the Option A contract: a goal's ``goal_skill_ids`` only acts as a
SECONDARY ordering key (mastery probability still drives the weak-skill order),
and ``set_goal_and_recommend`` returns the shared AssistantBlock contract with a
"start here" prose block plus a plan block.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from src.learning.api import ITEM_BANK_PATH, LearningApi, PILOT_TENANT_ID
from src.learning.diagnostic import load_item_bank
from src.learning.models import MasteryEstimate


@pytest.fixture()
def learning_api() -> LearningApi:
    assert ITEM_BANK_PATH.exists()
    return LearningApi(item_bank=load_item_bank(ITEM_BANK_PATH))


def _beta(probability: float) -> MasteryEstimate:
    return MasteryEstimate(kind="beta", probability=probability, uncertainty=0.4, a=2.0, b=2.0)


def test_goal_skill_ids_do_not_override_mastery_ordering(learning_api: LearningApi):
    # trigonometry is the weakest skill; a goal nudging differentiation must NOT
    # promote it ahead of the weaker trigonometry card.
    learning_api._student_estimates[(PILOT_TENANT_ID, "stu-goal")] = {
        "trigonometry": _beta(0.20),
        "differentiation": _beta(0.80),
    }

    plan = learning_api.build_learner_plan(
        {
            "student_id": "stu-goal",
            "exam": "WAEC",
            "class_year": "SSS2",
            "subject": "Mathematics",
            "goal_skill_ids": ["differentiation"],
        }
    )

    skill_order = [item["skill_id"] for item in plan["today"]]
    assert skill_order[0] == "trigonometry"  # mastery still wins


def test_set_goal_and_recommend_returns_blocks(learning_api: LearningApi):
    result = learning_api.set_goal_and_recommend(
        {
            "student_id": "brand-new-learner",
            "exam": "WAEC",
            "class_year": "SSS2",
            "subject": "Mathematics",
            "target_date": "this_term",
        }
    )

    assert result["session_complete"] is True
    kinds = [block["kind"] for block in result["blocks"]]
    assert "prose" in kinds
    assert "plan" in kinds

    prose = next(b for b in result["blocks"] if b["kind"] == "prose")
    # Pacing line for "this_term" is appended to the spoken summary.
    assert "term" in prose["speak"].lower()

    plan_block = next(b for b in result["blocks"] if b["kind"] == "plan")
    assert len(plan_block["steps"]) >= 1


def test_set_goal_and_recommend_defaults_tenant(learning_api: LearningApi):
    # No tenant_id supplied -> falls back to the pilot tenant without error.
    result = learning_api.set_goal_and_recommend({"student_id": "another-learner"})
    assert result["session_complete"] is True
    assert result["blocks"]
