"""Tests for the SQLite-backed storage service."""

from pathlib import Path

from src.services.storage import StorageService


class TestStorageService:
    """Test cases for persistence and therapist review records."""

    def test_list_children_seeds_defaults(self, tmp_path: Path):
        """Test default child profiles are available in a new database."""
        service = StorageService(str(tmp_path / "speakbright.db"))

        children = service.list_children()

        assert len(children) >= 3
        assert children[0]["name"]

    def test_save_and_get_session(self, tmp_path: Path):
        """Test saving a session record and reading it back for review."""
        service = StorageService(str(tmp_path / "speakbright.db"))

        saved_session = service.save_session(
            {
                "child_id": "child-ava",
                "child_name": "Ava",
                "exercise": {
                    "id": "exercise-s",
                    "name": "Say the S Sound",
                    "description": "Practice /s/ words",
                    "exerciseMetadata": {"targetSound": "s", "targetWords": ["sun", "sock"]},
                },
                "exercise_metadata": {"targetSound": "s", "targetWords": ["sun", "sock"]},
                "ai_assessment": {
                    "overall_score": 84,
                    "therapist_notes": "Improved after the second model.",
                },
                "pronunciation_assessment": {
                    "accuracy_score": 81,
                    "pronunciation_score": 82,
                    "words": [{"word": "sun", "accuracy": 84, "error_type": "None"}],
                },
                "transcript": "user: sun",
                "reference_text": "sun sock",
            }
        )

        session_detail = service.get_session(saved_session["id"])
        session_history = service.list_sessions_for_child("child-ava")

        assert session_detail is not None
        assert session_detail["child"]["name"] == "Ava"
        assert session_detail["assessment"]["ai_assessment"]["overall_score"] == 84
        assert session_history[0]["overall_score"] == 84
        assert session_history[0]["exercise"]["name"] == "Say the S Sound"

    def test_save_consent_acknowledgement(self, tmp_path: Path):
        """Test pilot consent timestamps persist in app settings."""
        service = StorageService(str(tmp_path / "speakbright.db"))

        timestamp = service.save_consent_acknowledgement("2026-03-26T12:00:00+00:00")
        pilot_state = service.get_pilot_state()

        assert timestamp == "2026-03-26T12:00:00+00:00"
        assert pilot_state["consent_timestamp"] == "2026-03-26T12:00:00+00:00"

    def test_save_session_feedback(self, tmp_path: Path):
        """Test therapist feedback can be attached to a saved session."""
        service = StorageService(str(tmp_path / "speakbright.db"))

        saved_session = service.save_session(
            {
                "child_id": "child-ava",
                "child_name": "Ava",
                "exercise": {
                    "id": "exercise-s",
                    "name": "Say the S Sound",
                    "description": "Practice /s/ words",
                    "exerciseMetadata": {"targetSound": "s", "targetWords": ["sun"]},
                },
                "exercise_metadata": {"targetSound": "s", "targetWords": ["sun"]},
                "ai_assessment": {"overall_score": 84},
                "pronunciation_assessment": {"accuracy_score": 81, "pronunciation_score": 82},
            }
        )

        updated_session = service.save_session_feedback(
            saved_session["id"],
            "up",
            "Child stayed engaged with light prompting.",
        )
        session_history = service.list_sessions_for_child("child-ava")

        assert updated_session is not None
        assert updated_session["therapist_feedback"]["rating"] == "up"
        assert updated_session["therapist_feedback"]["note"] == "Child stayed engaged with light prompting."
        assert session_history[0]["therapist_feedback"]["rating"] == "up"