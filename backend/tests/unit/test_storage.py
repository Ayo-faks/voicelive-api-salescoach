"""Tests for the SQLite-backed storage service."""

from pathlib import Path
import sqlite3

from src.services.storage import StorageService


class TestStorageService:
    """Test cases for persistence and therapist review records."""

    def test_first_user_is_bootstrapped_as_therapist(self, tmp_path: Path):
        """Test the first authenticated user is promoted to therapist automatically."""
        service = StorageService(str(tmp_path / "wulo.db"))

        first_user = service.get_or_create_user("user-1", "first@example.com", "First User", "google")
        second_user = service.get_or_create_user("user-2", "second@example.com", "Second User", "aad")

        assert first_user["role"] == "therapist"
        assert second_user["role"] == "user"

    def test_update_user_role(self, tmp_path: Path):
        """Test user roles can be promoted and demoted."""
        service = StorageService(str(tmp_path / "wulo.db"))
        service.get_or_create_user("user-1", "first@example.com", "First User", "google")
        service.get_or_create_user("user-2", "second@example.com", "Second User", "aad")

        updated_user = service.update_user_role("user-2", "therapist")

        assert updated_user is not None
        assert updated_user["role"] == "therapist"
        assert service.get_user("user-2")["role"] == "therapist"

    def test_list_children_seeds_defaults(self, tmp_path: Path):
        """Test default child profiles are available in a new database."""
        service = StorageService(str(tmp_path / "wulo.db"))

        children = service.list_children()

        assert len(children) >= 3
        assert children[0]["name"]

    def test_save_and_get_session(self, tmp_path: Path):
        """Test saving a session record and reading it back for review."""
        service = StorageService(str(tmp_path / "wulo.db"))

        saved_session = service.save_session(
            {
                "child_id": "child-ayo",
                "child_name": "Ayo",
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
        session_history = service.list_sessions_for_child("child-ayo")

        assert session_detail is not None
        assert session_detail["child"]["name"] == "Ayo"
        assert session_detail["assessment"]["ai_assessment"]["overall_score"] == 84
        assert session_history[0]["overall_score"] == 84
        assert session_history[0]["exercise"]["name"] == "Say the S Sound"

    def test_save_consent_acknowledgement(self, tmp_path: Path):
        """Test pilot consent timestamps persist in app settings."""
        service = StorageService(str(tmp_path / "wulo.db"))

        timestamp = service.save_consent_acknowledgement("2026-03-26T12:00:00+00:00")
        pilot_state = service.get_pilot_state()

        assert timestamp == "2026-03-26T12:00:00+00:00"
        assert pilot_state["consent_timestamp"] == "2026-03-26T12:00:00+00:00"

    def test_save_session_feedback(self, tmp_path: Path):
        """Test therapist feedback can be attached to a saved session."""
        service = StorageService(str(tmp_path / "wulo.db"))

        saved_session = service.save_session(
            {
                "child_id": "child-ayo",
                "child_name": "Ayo",
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
        session_history = service.list_sessions_for_child("child-ayo")

        assert updated_session is not None
        assert updated_session["therapist_feedback"]["rating"] == "up"
        assert updated_session["therapist_feedback"]["note"] == "Child stayed engaged with light prompting."
        assert session_history[0]["therapist_feedback"]["rating"] == "up"