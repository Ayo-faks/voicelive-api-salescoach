"""Phase 5: memory-fact staleness flagging against current mastery.

A teacher-approved "needs practice" fact must be re-queued for human review once
the backing skill is secure again, instead of the system silently editing the
learner's memory.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from src.learning.api import (
    ITEM_BANK_PATH,
    LearningApi,
    PILOT_CLASS_ID,
    PILOT_STUDENT_ID,
    PILOT_TENANT_ID,
)
from src.learning.diagnostic import load_item_bank
from src.learning.models import MasteryEstimate, Provenance, StudentFactProposal


@pytest.fixture()
def learning_api() -> LearningApi:
    return LearningApi(item_bank=load_item_bank(Path(ITEM_BANK_PATH)))


def _approved_gap_fact(skill_id: str) -> StudentFactProposal:
    return StudentFactProposal(
        tenant_id=PILOT_TENANT_ID,
        class_id=PILOT_CLASS_ID,
        student_id=PILOT_STUDENT_ID,
        key=f"diagnostic_gap:{skill_id}",
        value=f"Needs targeted practice on {skill_id}",
        evidence="Diagnostic completed with 30% mastery estimate",
        lang="en-NG",
        provenance=[Provenance(source="test", rule_id="seed")],
    )
def _secure_estimate() -> MasteryEstimate:
    return MasteryEstimate(kind="beta", probability=0.92, uncertainty=0.18, a=12.0, b=2.0)


def _weak_estimate() -> MasteryEstimate:
    return MasteryEstimate(kind="beta", probability=0.3, uncertainty=0.4, a=2.0, b=6.0)


def test_review_flags_gap_fact_when_skill_now_secure(learning_api: LearningApi) -> None:
    fact = _approved_gap_fact("fractions")
    learning_api.repository.save_student_fact(fact, actor_id="teacher-1", status="approved")
    learning_api._student_estimates[(PILOT_TENANT_ID, PILOT_STUDENT_ID)] = {
        "fractions": _secure_estimate()
    }

    flagged = learning_api.review_fact_staleness(PILOT_TENANT_ID, PILOT_STUDENT_ID)

    assert flagged == [{"fact_id": fact.fact_id, "reason": "skill_now_secure"}]
    records = learning_api.repository.list_student_facts(
        PILOT_TENANT_ID, student_id=PILOT_STUDENT_ID
    )
    record = next(r for r in records if r["id"] == fact.fact_id)
    assert record["status"] == "pending"  # re-queued for teacher review
    assert record["fact"]["staleness_reason"] == "skill_now_secure"


def test_review_leaves_gap_fact_when_skill_still_weak(learning_api: LearningApi) -> None:
    fact = _approved_gap_fact("fractions")
    learning_api.repository.save_student_fact(fact, actor_id="teacher-1", status="approved")
    learning_api._student_estimates[(PILOT_TENANT_ID, PILOT_STUDENT_ID)] = {
        "fractions": _weak_estimate()
    }

    flagged = learning_api.review_fact_staleness(PILOT_TENANT_ID, PILOT_STUDENT_ID)

    assert flagged == []
    records = learning_api.repository.list_student_facts(
        PILOT_TENANT_ID, student_id=PILOT_STUDENT_ID
    )
    record = next(r for r in records if r["id"] == fact.fact_id)
    assert record["status"] == "approved"


def test_review_is_idempotent(learning_api: LearningApi) -> None:
    fact = _approved_gap_fact("fractions")
    learning_api.repository.save_student_fact(fact, actor_id="teacher-1", status="approved")
    learning_api._student_estimates[(PILOT_TENANT_ID, PILOT_STUDENT_ID)] = {
        "fractions": _secure_estimate()
    }

    first = learning_api.review_fact_staleness(PILOT_TENANT_ID, PILOT_STUDENT_ID)
    second = learning_api.review_fact_staleness(PILOT_TENANT_ID, PILOT_STUDENT_ID)

    assert len(first) == 1
    assert second == []  # already flagged + already pending, not re-flagged
