"""Tests for the child memory domain service."""

from pathlib import Path
from unittest.mock import Mock

from src.services.child_memory_service import ChildMemoryService
from src.services.storage import StorageService


def _create_saved_session(storage_service: StorageService) -> dict:
    session = storage_service.save_session(
        {
            "id": "session-child-memory-1",
            "child_id": "child-ayo",
            "child_name": "Ayo",
            "exercise": {
                "id": "exercise-r",
                "name": "R Warmup",
                "description": "Practice /r/ words",
                "exerciseMetadata": {"targetSound": "r", "difficulty": "medium"},
            },
            "exercise_metadata": {"targetSound": "r", "difficulty": "medium"},
            "ai_assessment": {
                "overall_score": 74,
                "engagement_and_effort": {"willingness_to_retry": 8},
            },
            "pronunciation_assessment": {"accuracy_score": 63, "pronunciation_score": 65},
            "transcript": "Child practised /r/ words.",
            "reference_text": "red rabbit",
        }
    )
    feedback_session = storage_service.save_session_feedback(
        session["id"],
        "up",
        "Retry prompts kept Ayo engaged.",
    )
    assert feedback_session is not None
    return feedback_session


def test_synthesize_session_memory_auto_applies_targets_and_keeps_inferences_pending(tmp_path: Path):
    storage_service = StorageService(str(tmp_path / "child-memory.db"))
    service = ChildMemoryService(storage_service)
    saved_session = _create_saved_session(storage_service)

    result = service.synthesize_session_memory(saved_session["id"])

    assert result["child_id"] == "child-ayo"
    assert len(result["auto_applied_items"]) == 1
    assert len(result["proposals"]) == 2
    assert result["summary"]["source_item_count"] == 1
    assert result["auto_applied_items"][0]["statement"] == "Keep /r/ as an active therapy target."
    assert result["proposals"][0]["detail"]["therapist_feedback"]["rating"] == "up"
    assert result["proposals"][0]["evidence_links"]
    assert storage_service.list_child_memory_proposals("child-ayo", status="pending")


def test_approve_proposal_creates_memory_item_and_rebuilds_summary(tmp_path: Path):
    storage_service = StorageService(str(tmp_path / "child-memory.db"))
    storage_service.get_or_create_user("therapist-1", "therapist@example.com", "Therapist", "aad")
    service = ChildMemoryService(storage_service)
    saved_session = _create_saved_session(storage_service)
    synthesis_result = service.synthesize_session_memory(saved_session["id"])
    proposal = synthesis_result["proposals"][0]

    approval_result = service.approve_proposal(proposal["id"], reviewer_user_id="therapist-1", review_note="Keep")

    assert approval_result["proposal"]["status"] == "approved"
    assert approval_result["approved_item"]["source_proposal_id"] == proposal["id"]
    assert approval_result["summary"]["source_item_count"] == 2
    assert approval_result["summary"]["summary"][proposal["category"]][0]["statement"] == proposal["statement"]
    assert storage_service.list_child_memory_evidence_links("item", approval_result["approved_item"]["id"])


def test_reject_proposal_keeps_summary_limited_to_approved_items(tmp_path: Path):
    storage_service = StorageService(str(tmp_path / "child-memory.db"))
    storage_service.get_or_create_user("therapist-1", "therapist@example.com", "Therapist", "aad")
    service = ChildMemoryService(storage_service)
    saved_session = _create_saved_session(storage_service)
    synthesis_result = service.synthesize_session_memory(saved_session["id"])
    proposal = synthesis_result["proposals"][1]

    rejection_result = service.reject_proposal(proposal["id"], reviewer_user_id="therapist-1", review_note="Not yet")

    assert rejection_result["proposal"]["status"] == "rejected"
    assert rejection_result["summary"]["source_item_count"] == 1
    assert "Keep /r/ as an active therapy target." in rejection_result["summary"]["summary_text"]


def test_create_manual_item_rebuilds_summary(tmp_path: Path):
    storage_service = StorageService(str(tmp_path / "child-memory.db"))
    storage_service.get_or_create_user("therapist-1", "therapist@example.com", "Therapist", "aad")
    service = ChildMemoryService(storage_service)

    result = service.create_manual_item(
        child_id="child-ayo",
        category="preferences",
        statement="Ayo settles faster with short visual models.",
        therapist_user_id="therapist-1",
        memory_type="fact",
    )

    assert result["item"]["statement"] == "Ayo settles faster with short visual models."
    assert result["summary"]["source_item_count"] == 1
    assert result["summary"]["summary"]["preferences"][0]["statement"] == "Ayo settles faster with short visual models."


def test_build_live_session_personalization_reads_only_approved_memory():
    storage_service = Mock()
    storage_service.list_child_memory_items.return_value = [
        {
            "id": "memory-target-1",
            "child_id": "child-ayo",
            "category": "targets",
            "memory_type": "constraint",
            "status": "approved",
            "statement": "Keep /r/ as an active therapy target.",
            "detail": {"target_sound": "r"},
            "confidence": 0.9,
            "updated_at": "2026-04-06T09:00:00+00:00",
            "source_proposal_id": "proposal-1",
        },
        {
            "id": "memory-constraint-1",
            "child_id": "child-ayo",
            "category": "constraints",
            "memory_type": "constraint",
            "status": "active",
            "statement": "Keep cues short and specific.",
            "detail": {},
            "confidence": 0.88,
            "updated_at": "2026-04-06T09:05:00+00:00",
            "source_proposal_id": None,
        },
        {
            "id": "memory-cue-1",
            "child_id": "child-ayo",
            "category": "effective_cues",
            "memory_type": "fact",
            "status": "approved",
            "statement": "Short verbal models help Ayo reset quickly.",
            "detail": {},
            "confidence": 0.82,
            "updated_at": "2026-04-06T09:10:00+00:00",
            "source_proposal_id": None,
        },
        {
            "id": "memory-pending-1",
            "child_id": "child-ayo",
            "category": "effective_cues",
            "memory_type": "inference",
            "status": "pending",
            "statement": "Unapproved cue should not be used.",
            "detail": {},
            "confidence": 0.6,
            "updated_at": "2026-04-06T09:15:00+00:00",
            "source_proposal_id": None,
        },
    ]
    storage_service.get_child_memory_summary.return_value = {
        "child_id": "child-ayo",
        "summary_text": "Active targets: Keep /r/ as an active therapy target.",
        "source_item_count": 3,
        "last_compiled_at": "2026-04-06T09:20:00+00:00",
    }

    service = ChildMemoryService(storage_service)

    personalization = service.build_live_session_personalization("child-ayo")

    assert personalization["active_target_sound"] == "r"
    assert [item["id"] for item in personalization["approved_targets"]] == ["memory-target-1"]
    assert [item["id"] for item in personalization["approved_constraints"]] == ["memory-constraint-1"]
    assert [item["id"] for item in personalization["approved_effective_cues"]] == ["memory-cue-1"]
    assert "memory-pending-1" not in personalization["used_item_ids"]
    assert personalization["summary_last_compiled_at"] == "2026-04-06T09:20:00+00:00"
    storage_service.save_child_memory_item.assert_not_called()
    storage_service.save_child_memory_proposal.assert_not_called()
    storage_service.upsert_child_memory_summary.assert_not_called()