"""Integration tests for the B2C learner memory endpoints on LearningApi."""

from __future__ import annotations

from src.learning.api import LearningApi
from src.learning.repository import InMemoryLearningRepository


def _api() -> LearningApi:
    return LearningApi()


def test_memory_consent_persists_across_api_instances() -> None:
    repo = InMemoryLearningRepository()
    learner_id = "learner-alex-persist"

    first = LearningApi(repository=repo)
    first.set_memory_consent({"learner_id": learner_id, "accepted": True})
    assert first.get_memory_consent_status({"learner_id": learner_id})["accepted"] is True

    second = LearningApi(repository=repo)
    status = second.get_memory_consent_status({"learner_id": learner_id})
    assert status["accepted"] is True
    assert status["policy_version"] == "v1"
    assert status["accepted_at"] is not None


def test_propose_learner_authored_fact_auto_approves_when_consented() -> None:
    api = _api()
    learner_id = "learner-alex-001"
    api.set_memory_consent({"learner_id": learner_id, "accepted": True})

    result = api.propose_student_fact({
        "student_id": learner_id,
        "key": "preferred_subject",
        "value": "Physics",
        "learner_self_authored": True,
        "actor_id": learner_id,
        "evidence": "self-report",
    })

    assert result["stored"] is True
    assert result["auto_approved"] is True
    assert result["fact"]["status"] == "auto_approved"


def test_propose_learner_authored_mood_has_expiry() -> None:
    api = _api()
    learner_id = "learner-alex-002"
    api.set_memory_consent({"learner_id": learner_id, "accepted": True})

    result = api.propose_student_fact({
        "student_id": learner_id,
        "key": "mood",
        "value": "anxious before exam",
        "learner_self_authored": True,
        "actor_id": learner_id,
        "evidence": "self-report",
    })

    assert result["auto_approved"] is True
    assert result["expires_at"] is not None


def test_propose_learner_authored_safeguarding_blocks_storage() -> None:
    api = _api()
    learner_id = "learner-alex-003"
    api.set_memory_consent({"learner_id": learner_id, "accepted": True})

    result = api.propose_student_fact({
        "student_id": learner_id,
        "key": "mood",
        "value": "i want to kill myself",
        "learner_self_authored": True,
        "actor_id": learner_id,
        "evidence": "self-report",
    })

    assert result["stored"] is False
    assert result["safeguarding"] is True
    assert any("116 123" == r["phone"] for r in result["help"])


def test_propose_learner_authored_pii_blocks_storage() -> None:
    api = _api()
    learner_id = "learner-alex-004"
    api.set_memory_consent({"learner_id": learner_id, "accepted": True})

    result = api.propose_student_fact({
        "student_id": learner_id,
        "key": "guardian_name",
        "value": "Jane Doe",
        "learner_self_authored": True,
        "actor_id": learner_id,
        "evidence": "self-report",
    })

    assert result["stored"] is False
    assert result["denied"] is True


def test_propose_learner_authored_without_consent_falls_back_to_pending() -> None:
    api = _api()
    learner_id = "learner-alex-005"

    result = api.propose_student_fact({
        "student_id": learner_id,
        "key": "preferred_subject",
        "value": "Maths",
        "learner_self_authored": True,
        "actor_id": learner_id,
        "evidence": "self-report",
    })

    assert "fact" in result
    assert result["fact"]["status"] == "pending"
    assert result["queued"] is True


def test_list_learner_memory_returns_only_active_facts() -> None:
    api = _api()
    learner_id = "learner-alex-006"
    api.set_memory_consent({"learner_id": learner_id, "accepted": True})

    api.propose_student_fact({
        "student_id": learner_id,
        "key": "preferred_subject",
        "value": "Maths",
        "learner_self_authored": True,
        "actor_id": learner_id,
        "evidence": "self-report",
    })

    listing = api.list_learner_memory({"learner_id": learner_id})
    assert listing["count"] == 1
    assert listing["consent"]["accepted"] is True
    assert listing["facts"][0]["fact"]["value"] == "Maths"


def test_delete_learner_memory_marks_rejected() -> None:
    api = _api()
    learner_id = "learner-alex-007"
    api.set_memory_consent({"learner_id": learner_id, "accepted": True})

    proposed = api.propose_student_fact({
        "student_id": learner_id,
        "key": "preferred_subject",
        "value": "Chemistry",
        "learner_self_authored": True,
        "actor_id": learner_id,
        "evidence": "self-report",
    })
    fact_id = proposed["fact"]["id"]

    deleted = api.delete_learner_memory(fact_id, {"learner_id": learner_id})
    assert deleted["ok"] is True

    listing = api.list_learner_memory({"learner_id": learner_id})
    assert listing["count"] == 0
