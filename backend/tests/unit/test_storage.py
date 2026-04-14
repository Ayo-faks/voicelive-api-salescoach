"""Tests for the SQLite-backed storage service."""

from pathlib import Path
import sqlite3

from src.services.storage import StorageService
from src.services.storage_postgres import PostgresStorageService


class TestStorageService:
    """Test cases for persistence and therapist review records."""

    def test_legacy_children_table_is_migrated_with_workspace_id(self, tmp_path: Path):
        """Test older SQLite databases missing children.workspace_id still load child lists."""
        db_path = tmp_path / "legacy-children.db"

        with sqlite3.connect(db_path) as connection:
            connection.execute(
                """CREATE TABLE children (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    date_of_birth TEXT,
                    notes TEXT,
                    deleted_at TEXT,
                    created_at TEXT NOT NULL
                )"""
            )
            connection.execute(
                """CREATE TABLE users (
                    id TEXT PRIMARY KEY,
                    email TEXT,
                    name TEXT,
                    provider TEXT,
                    role TEXT NOT NULL DEFAULT 'parent',
                    created_at TEXT NOT NULL
                )"""
            )
            connection.execute(
                """CREATE TABLE user_children (
                    user_id TEXT NOT NULL,
                    child_id TEXT NOT NULL,
                    relationship TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (user_id, child_id)
                )"""
            )
            connection.execute(
                "INSERT INTO users (id, email, name, provider, role, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                ("therapist-1", "therapist@example.com", "Therapist", "aad", "therapist", "2026-04-11T00:00:00+00:00"),
            )
            connection.execute(
                "INSERT INTO children (id, name, created_at) VALUES (?, ?, ?)",
                ("child-legacy", "Legacy Child", "2026-04-11T00:00:00+00:00"),
            )
            connection.execute(
                "INSERT INTO user_children (user_id, child_id, relationship, created_at) VALUES (?, ?, ?, ?)",
                ("therapist-1", "child-legacy", "therapist", "2026-04-11T00:00:00+00:00"),
            )
            connection.commit()

        service = StorageService(str(db_path))

        children = service.list_children_for_user("therapist-1")

        with sqlite3.connect(db_path) as connection:
            columns = {
                row[1]
                for row in connection.execute("PRAGMA table_info(children)").fetchall()
            }

        assert "workspace_id" in columns
        assert [child["id"] for child in children] == ["child-legacy"]
        assert children[0]["workspace_id"] is not None

    def test_first_user_is_bootstrapped_as_therapist(self, tmp_path: Path):
        """Test locally authenticated users default to therapist when no invite constrains their role."""
        service = StorageService(str(tmp_path / "wulo.db"))

        first_user = service.get_or_create_user("user-1", "first@example.com", "First User", "google")
        second_user = service.get_or_create_user("user-2", "second@example.com", "Second User", "aad")

        assert first_user["role"] == "therapist"
        assert second_user["role"] == "therapist"

    def test_legacy_parental_consents_table_is_migrated_with_gdpr_columns(self, tmp_path: Path):
        """Test older SQLite files gain the newer parental consent columns automatically."""
        db_path = tmp_path / "legacy-parental-consents.db"

        with sqlite3.connect(db_path) as connection:
            connection.execute(
                """CREATE TABLE children (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    date_of_birth TEXT,
                    notes TEXT,
                    deleted_at TEXT,
                    created_at TEXT NOT NULL
                )"""
            )
            connection.execute(
                """CREATE TABLE users (
                    id TEXT PRIMARY KEY,
                    email TEXT,
                    name TEXT,
                    provider TEXT,
                    role TEXT NOT NULL DEFAULT 'parent',
                    created_at TEXT NOT NULL
                )"""
            )
            connection.execute(
                """CREATE TABLE parental_consents (
                    id TEXT PRIMARY KEY,
                    child_id TEXT NOT NULL REFERENCES children(id),
                    guardian_name TEXT NOT NULL,
                    guardian_email TEXT NOT NULL,
                    consent_type TEXT NOT NULL DEFAULT 'full',
                    privacy_accepted BOOLEAN NOT NULL DEFAULT FALSE,
                    terms_accepted BOOLEAN NOT NULL DEFAULT FALSE,
                    ai_notice_accepted BOOLEAN NOT NULL DEFAULT FALSE,
                    recorded_by_user_id TEXT NOT NULL REFERENCES users(id),
                    consented_at TEXT NOT NULL,
                    withdrawn_at TEXT
                )"""
            )
            connection.execute(
                "INSERT INTO children (id, name, created_at) VALUES (?, ?, ?)",
                ("child-legacy", "Legacy Child", "2026-04-14T00:00:00+00:00"),
            )
            connection.execute(
                "INSERT INTO users (id, email, name, provider, role, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (
                    "therapist-legacy",
                    "therapist@example.com",
                    "Therapist",
                    "aad",
                    "therapist",
                    "2026-04-14T00:00:00+00:00",
                ),
            )
            connection.commit()

        service = StorageService(str(db_path))
        saved_consent = service.save_parental_consent(
            child_id="child-legacy",
            guardian_name="Legacy Guardian",
            guardian_email="guardian@example.com",
            privacy_accepted=True,
            terms_accepted=True,
            ai_notice_accepted=True,
            personal_data_consent_accepted=True,
            special_category_consent_accepted=True,
            parental_responsibility_confirmed=True,
            recorded_by_user_id="therapist-legacy",
        )

        with sqlite3.connect(db_path) as connection:
            columns = {
                row[1]
                for row in connection.execute("PRAGMA table_info(parental_consents)").fetchall()
            }

        stored_consent = service.get_parental_consent("child-legacy")

        assert {
            "personal_data_consent_accepted",
            "special_category_consent_accepted",
            "parental_responsibility_confirmed",
        }.issubset(columns)
        assert saved_consent["personal_data_consent_accepted"] is True
        assert stored_consent is not None
        assert stored_consent["guardian_email"] == "guardian@example.com"
        assert stored_consent["special_category_consent_accepted"] is True

    def test_postgres_parental_consent_uses_mapping_rows_and_gdpr_fields(self, monkeypatch):
        """Test the Postgres consent path reads dict rows and keeps the GDPR consent fields."""

        class _FakeCursor:
            def __init__(self):
                self.fetchone_result = {
                    "id": "consent-1",
                    "child_id": "child-ayo",
                    "guardian_name": "Parent Example",
                    "guardian_email": "parent@example.com",
                    "consent_type": "full",
                    "privacy_accepted": True,
                    "terms_accepted": True,
                    "ai_notice_accepted": True,
                    "personal_data_consent_accepted": True,
                    "special_category_consent_accepted": True,
                    "parental_responsibility_confirmed": True,
                    "recorded_by_user_id": "therapist-1",
                    "consented_at": "2026-04-14T00:00:00+00:00",
                    "withdrawn_at": None,
                }
                self.executed: list[tuple[str, tuple[object, ...]]] = []

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def execute(self, query: str, params: tuple[object, ...]):
                self.executed.append((query, params))

            def fetchone(self):
                return self.fetchone_result

        class _FakeConnection:
            def __init__(self):
                self.cursor_instance = _FakeCursor()

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def cursor(self):
                return self.cursor_instance

        fake_connection = _FakeConnection()
        service = PostgresStorageService("postgresql://example")
        monkeypatch.setattr(service, "_connect", lambda: fake_connection)

        saved_consent = service.save_parental_consent(
            child_id="child-ayo",
            guardian_name="Parent Example",
            guardian_email="parent@example.com",
            privacy_accepted=True,
            terms_accepted=True,
            ai_notice_accepted=True,
            personal_data_consent_accepted=True,
            special_category_consent_accepted=True,
            parental_responsibility_confirmed=True,
            recorded_by_user_id="therapist-1",
        )
        loaded_consent = service.get_parental_consent("child-ayo")

        insert_query, insert_params = fake_connection.cursor_instance.executed[0]

        assert "personal_data_consent_accepted" in insert_query
        assert insert_params[8:11] == (True, True, True)
        assert saved_consent["personal_data_consent_accepted"] is True
        assert loaded_consent is not None
        assert loaded_consent["guardian_email"] == "parent@example.com"
        assert loaded_consent["special_category_consent_accepted"] is True
        assert loaded_consent["parental_responsibility_confirmed"] is True

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

    def test_save_and_review_child_memory_proposal(self, tmp_path: Path):
        """Test child memory proposals and approved memory items persist distinctly."""
        service = StorageService(str(tmp_path / "wulo.db"))
        service.get_or_create_user("therapist-1", "therapist@example.com", "Therapist", "aad")

        proposal = service.save_child_memory_proposal(
            {
                "id": "proposal-1",
                "child_id": "child-ayo",
                "category": "effective_cues",
                "memory_type": "inference",
                "status": "pending",
                "statement": "Responds better when the cue includes a spoken model first.",
                "detail": {"cue": "spoken model"},
                "confidence": 0.78,
                "provenance": {"session_ids": ["session-1"]},
                "author_type": "system",
            }
        )

        approved_item = service.save_child_memory_item(
            {
                "id": "item-1",
                "child_id": "child-ayo",
                "category": "effective_cues",
                "memory_type": "fact",
                "status": "approved",
                "statement": proposal["statement"],
                "detail": proposal["detail"],
                "confidence": proposal["confidence"],
                "provenance": proposal["provenance"],
                "author_type": "therapist",
                "author_user_id": "therapist-1",
                "source_proposal_id": proposal["id"],
            }
        )

        reviewed_proposal = service.review_child_memory_proposal(
            proposal["id"],
            "approved",
            reviewer_user_id="therapist-1",
            review_note="Observed across two sessions.",
            approved_item_id=approved_item["id"],
        )

        pending_proposals = service.list_child_memory_proposals("child-ayo", status="pending")
        approved_proposals = service.list_child_memory_proposals("child-ayo", status="approved")
        approved_items = service.list_child_memory_items("child-ayo", status="approved")

        assert proposal["status"] == "pending"
        assert reviewed_proposal is not None
        assert reviewed_proposal["status"] == "approved"
        assert reviewed_proposal["approved_item_id"] == approved_item["id"]
        assert pending_proposals == []
        assert approved_proposals[0]["id"] == proposal["id"]
        assert approved_items[0]["source_proposal_id"] == proposal["id"]

    def test_save_child_memory_evidence_summary_and_status_updates(self, tmp_path: Path):
        """Test evidence links, summary upsert, and item status transitions round-trip."""
        service = StorageService(str(tmp_path / "wulo.db"))
        service.get_or_create_user("therapist-1", "therapist@example.com", "Therapist", "aad")

        saved_session = service.save_session(
            {
                "id": "session-memory-1",
                "child_id": "child-ayo",
                "child_name": "Ayo",
                "exercise": {
                    "id": "exercise-r",
                    "name": "R Warmup",
                    "description": "Practice /r/ words",
                    "exerciseMetadata": {"targetSound": "r"},
                },
                "exercise_metadata": {"targetSound": "r"},
                "ai_assessment": {"overall_score": 75},
                "pronunciation_assessment": {"accuracy_score": 71, "pronunciation_score": 72},
            }
        )

        item = service.save_child_memory_item(
            {
                "id": "item-2",
                "child_id": "child-ayo",
                "category": "targets",
                "memory_type": "constraint",
                "status": "approved",
                "statement": "Keep /r/ as the primary target for the next block.",
                "detail": {"target_sound": "r"},
                "confidence": 0.92,
                "provenance": {"source": "therapist"},
                "author_type": "therapist",
                "author_user_id": "therapist-1",
            }
        )

        evidence_link = service.save_child_memory_evidence_link(
            {
                "id": "evidence-1",
                "child_id": "child-ayo",
                "subject_type": "item",
                "subject_id": item["id"],
                "session_id": saved_session["id"],
                "evidence_kind": "session",
                "snippet": "Child maintained accuracy with direct modeling.",
                "metadata": {"source_field": "assessment.ai_assessment"},
            }
        )

        summary = service.upsert_child_memory_summary(
            "child-ayo",
            {
                "targets": [item["statement"]],
                "effective_cues": [],
            },
            summary_text="Primary target remains /r/ with strong response to direct modeling.",
            source_item_count=1,
        )
        expired_item = service.update_child_memory_item_status(
            item["id"],
            "expired",
            expires_at="2026-05-01T00:00:00+00:00",
        )

        saved_links = service.list_child_memory_evidence_links("item", item["id"])
        reloaded_summary = service.get_child_memory_summary("child-ayo")

        assert evidence_link["session_id"] == saved_session["id"]
        assert saved_links[0]["id"] == evidence_link["id"]
        assert summary["summary"]["targets"] == [item["statement"]]
        assert reloaded_summary is not None
        assert reloaded_summary["source_item_count"] == 1
        assert expired_item is not None
        assert expired_item["status"] == "expired"
        assert expired_item["expires_at"] == "2026-05-01T00:00:00+00:00"