"""Tests for deterministic recommendation ranking and explanation."""

from pathlib import Path

from src.services.recommendation_service import RecommendationService
from src.services.storage import StorageService


class _ScenarioStub:
    def list_scenarios(self):
        return [
            {
                "id": "exercise-word-r",
                "name": "R Word Repetition",
                "description": "Practice /r/ in single words.",
                "exerciseMetadata": {
                    "targetSound": "r",
                    "difficulty": "medium",
                    "type": "word_repetition",
                    "targetWords": ["red", "rabbit"],
                },
            },
            {
                "id": "exercise-phrase-r",
                "name": "R Phrase Builder",
                "description": "Move /r/ into short carrier phrases.",
                "exerciseMetadata": {
                    "targetSound": "r",
                    "difficulty": "hard",
                    "type": "two_word_phrase",
                    "targetWords": ["red rabbit"],
                },
            },
            {
                "id": "exercise-listening-r",
                "name": "R Listening Pairs",
                "description": "Listen and sort /r/ contrasts.",
                "exerciseMetadata": {
                    "targetSound": "r",
                    "difficulty": "easy",
                    "type": "listening_minimal_pairs",
                    "targetWords": ["red", "wed"],
                },
            },
        ]


def _seed_recommendation_context(service: StorageService) -> None:
    service.get_or_create_user("therapist-1", "therapist@example.com", "Therapist", "aad")
    saved_session = service.save_session(
        {
            "id": "session-recommendation-1",
            "child_id": "child-ayo",
            "child_name": "Ayo",
            "timestamp": "2026-04-06T10:00:00+00:00",
            "exercise": {
                "id": "exercise-source-r",
                "name": "R Warmup",
                "description": "Practice /r/ words",
                "exerciseMetadata": {
                    "targetSound": "r",
                    "difficulty": "medium",
                    "type": "two_word_phrase",
                },
            },
            "exercise_metadata": {
                "targetSound": "r",
                "difficulty": "medium",
                "type": "two_word_phrase",
            },
            "ai_assessment": {
                "overall_score": 84,
                "engagement_and_effort": {"willingness_to_retry": 8},
            },
            "pronunciation_assessment": {
                "accuracy_score": 82,
                "pronunciation_score": 81,
            },
            "transcript": "Child practised /r/ in words.",
            "reference_text": "red rabbit",
        }
    )
    service.save_session_feedback(
        saved_session["id"],
        "up",
        "Reviewed by therapist and approved as a strong session.",
    )

    service.save_child_memory_item(
        {
            "id": "memory-target-r",
            "child_id": "child-ayo",
            "category": "targets",
            "memory_type": "constraint",
            "status": "approved",
            "statement": "Keep /r/ as the active target.",
            "detail": {"target_sound": "r"},
            "confidence": 0.94,
            "provenance": {"session_ids": [saved_session["id"]]},
            "author_type": "therapist",
            "author_user_id": "therapist-1",
        }
    )
    service.save_child_memory_item(
        {
            "id": "memory-cue-phrase",
            "child_id": "child-ayo",
            "category": "effective_cues",
            "memory_type": "fact",
            "status": "approved",
            "statement": "Phrase practice with a short verbal model works best.",
            "detail": {"cue": "short verbal model", "level": "phrase"},
            "confidence": 0.88,
            "provenance": {"session_ids": [saved_session["id"]]},
            "author_type": "therapist",
            "author_user_id": "therapist-1",
        }
    )
    service.save_child_memory_evidence_link(
        {
            "id": "evidence-cue-phrase",
            "child_id": "child-ayo",
            "subject_type": "item",
            "subject_id": "memory-cue-phrase",
            "session_id": saved_session["id"],
            "evidence_kind": "session",
            "snippet": "Ayo responded faster when the therapist modeled the phrase once.",
            "metadata": {"source": "therapist_review"},
        }
    )


def test_generate_recommendations_prefers_memory_aligned_phrase_progression(tmp_path: Path):
    storage = StorageService(str(tmp_path / "recommendations.db"))
    _seed_recommendation_context(storage)
    service = RecommendationService(storage, _ScenarioStub())

    detail = service.generate_recommendations(
        child_id="child-ayo",
        created_by_user_id="therapist-1",
        therapist_constraints="Keep this playful and move into phrase work.",
    )

    assert detail["top_recommendation"]["exercise_id"] == "exercise-phrase-r"
    assert detail["target_sound"] == "r"
    assert detail["candidate_count"] == 3
    assert detail["therapist_constraints"]["parsed"]["playful"] is True
    assert detail["therapist_constraints"]["parsed"]["preferred_types"]

    top_candidate = detail["candidates"][0]
    assert top_candidate["exercise_name"] == "R Phrase Builder"
    assert top_candidate["ranking_factors"]["cue_compatibility"]["score"] > 0
    assert top_candidate["ranking_factors"]["therapist_constraints"]["score"] > 0
    assert detail["ranking_context"]["institutional_memory"]["insights"]
    assert top_candidate["explanation"]["institutional_insights"]
    assert "Ayo" not in detail["ranking_context"]["institutional_memory"]["summary_text"]
    assert "memory-cue-phrase" in {
        item["id"] for item in top_candidate["explanation"]["supporting_memory_items"]
    }
    assert "session-recommendation-1" in {
        session["id"] for session in top_candidate["explanation"]["supporting_sessions"]
    }

    history = service.list_recommendation_history("child-ayo")
    assert history[0]["id"] == detail["id"]
    assert history[0]["top_recommendation"]["exercise_name"] == "R Phrase Builder"
