"""Tests for clinic-level institutional memory compilation."""

from pathlib import Path

from src.services.institutional_memory_service import InstitutionalMemoryService
from src.services.storage import StorageService


def _save_reviewed_session(
    storage: StorageService,
    *,
    session_id: str,
    child_id: str,
    child_name: str,
    exercise_type: str,
    overall_score: int,
    feedback_rating: str,
) -> None:
    storage.save_session(
        {
            "id": session_id,
            "child_id": child_id,
            "child_name": child_name,
            "timestamp": "2026-04-06T10:00:00+00:00",
            "exercise": {
                "id": f"exercise-{exercise_type}-{child_id}",
                "name": "R practice",
                "description": "Practice /r/.",
                "exerciseMetadata": {
                    "targetSound": "r",
                    "difficulty": "medium",
                    "type": exercise_type,
                },
            },
            "exercise_metadata": {
                "targetSound": "r",
                "difficulty": "medium",
                "type": exercise_type,
            },
            "ai_assessment": {
                "overall_score": overall_score,
            },
            "pronunciation_assessment": {
                "accuracy_score": overall_score - 2,
                "pronunciation_score": overall_score - 1,
            },
            "transcript": "Child practised /r/ phrases.",
            "reference_text": "red rabbit",
        }
    )
    storage.save_session_feedback(session_id, feedback_rating, "Reviewed by therapist.")


def test_rebuild_insights_compiles_deidentified_cross_child_patterns(tmp_path: Path):
    storage = StorageService(str(tmp_path / "institutional-memory.db"))
    storage.get_or_create_user("therapist-1", "therapist@example.com", "Therapist", "aad")

    _save_reviewed_session(
        storage,
        session_id="session-ayo-1",
        child_id="child-ayo",
        child_name="Ayo",
        exercise_type="two_word_phrase",
        overall_score=84,
        feedback_rating="up",
    )
    _save_reviewed_session(
        storage,
        session_id="session-noah-1",
        child_id="child-noah",
        child_name="Noah",
        exercise_type="two_word_phrase",
        overall_score=80,
        feedback_rating="up",
    )
    _save_reviewed_session(
        storage,
        session_id="session-noah-2",
        child_id="child-noah",
        child_name="Noah",
        exercise_type="word_repetition",
        overall_score=61,
        feedback_rating="down",
    )

    for child_id, session_id in (("child-ayo", "session-ayo-1"), ("child-noah", "session-noah-1")):
        storage.save_child_memory_item(
            {
                "id": f"target-{child_id}",
                "child_id": child_id,
                "category": "targets",
                "memory_type": "constraint",
                "status": "approved",
                "statement": "Keep /r/ as the active target.",
                "detail": {"target_sound": "r"},
                "confidence": 0.9,
                "provenance": {"session_ids": [session_id]},
                "author_type": "therapist",
                "author_user_id": "therapist-1",
            }
        )
        storage.save_child_memory_item(
            {
                "id": f"cue-{child_id}",
                "child_id": child_id,
                "category": "effective_cues",
                "memory_type": "fact",
                "status": "approved",
                "statement": "Short verbal models help reset quickly.",
                "detail": {"cue": "short verbal model"},
                "confidence": 0.82,
                "provenance": {"session_ids": [session_id]},
                "author_type": "therapist",
                "author_user_id": "therapist-1",
            }
        )

    service = InstitutionalMemoryService(storage)

    snapshot = service.rebuild_insights("therapist-1")

    assert snapshot["insights"]
    tuning_insight = next(insight for insight in snapshot["insights"] if insight["insight_type"] == "recommendation_tuning")
    strategy_insight = next(insight for insight in snapshot["insights"] if insight["insight_type"] == "strategy_insight")

    assert tuning_insight["target_sound"] == "r"
    assert "two_word_phrase" in tuning_insight["detail"]["recommended_exercise_types"]
    assert tuning_insight["provenance"]["deidentified_child_count"] >= 2
    assert strategy_insight["detail"]["cue"] == "short verbal model"
    assert "Ayo" not in strategy_insight["summary"]
    assert "Noah" not in strategy_insight["summary"]
    assert storage.list_institutional_memory_insights(owner_user_id="therapist-1", status="active")