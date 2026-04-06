# ---------------------------------------------------------------------------------------------
#  Copyright (c) Microsoft Corporation. All rights reserved.
#  Licensed under the MIT License. See LICENSE in the project root for license information.
# --------------------------------------------------------------------------------------------

"""Lightweight SQLite persistence for Wulo pilot session review."""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, TypeVar
from uuid import uuid4

from src.config import config
from src.services.blob_backup import backup_to_blob

logger = logging.getLogger(__name__)

DEFAULT_CHILDREN = (
    {"id": "child-ayo", "name": "Ayo"},
    {"id": "child-noah", "name": "Noah"},
    {"id": "child-zuri", "name": "Zuri"},
)
MEMORY_DETAIL_FALLBACK: Dict[str, Any] = {}
MEMORY_PROVENANCE_FALLBACK: Dict[str, Any] = {}
SQLITE_LOCK_RETRY_COUNT = 10
SQLITE_LOCK_RETRY_DELAY_SECONDS = 1.0
SQLITE_LOCK_TIMEOUT_SECONDS = 30.0
WriteResult = TypeVar("WriteResult")


class StorageService:
    """Persist child, exercise, and session records in a local SQLite database."""

    def __init__(self, db_path: str):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        logger.info("StorageService init: db_path=%s", self.db_path)
        self._initialize()
        logger.info("StorageService init complete")

    def _connect(self, journal_mode: str = "DELETE") -> sqlite3.Connection:
        logger.info("SQLite connect: %s (journal=%s)", self.db_path, journal_mode)
        connection = sqlite3.connect(self.db_path, timeout=SQLITE_LOCK_TIMEOUT_SECONDS)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout = 5000")
        connection.execute(f"PRAGMA journal_mode = {journal_mode}")
        connection.execute("PRAGMA foreign_keys = ON")
        logger.info("SQLite connected OK")
        return connection

    def _initialize(self):
        with self._lock:
            for attempt in range(SQLITE_LOCK_RETRY_COUNT):
                try:
                    with self._connect(journal_mode="DELETE") as connection:
                        connection.execute(
                            """CREATE TABLE IF NOT EXISTS app_settings (
                                key TEXT PRIMARY KEY,
                                value TEXT,
                                updated_at TEXT NOT NULL
                            )"""
                        )
                        connection.execute(
                            """CREATE TABLE IF NOT EXISTS children (
                                id TEXT PRIMARY KEY,
                                name TEXT NOT NULL,
                                created_at TEXT NOT NULL
                            )"""
                        )
                        connection.execute(
                            """CREATE TABLE IF NOT EXISTS users (
                                id TEXT PRIMARY KEY,
                                email TEXT,
                                name TEXT,
                                provider TEXT,
                                role TEXT NOT NULL DEFAULT 'user',
                                created_at TEXT NOT NULL
                            )"""
                        )
                        connection.execute(
                            """CREATE TABLE IF NOT EXISTS exercises (
                                id TEXT PRIMARY KEY,
                                name TEXT NOT NULL,
                                description TEXT NOT NULL,
                                metadata_json TEXT NOT NULL,
                                is_custom INTEGER NOT NULL DEFAULT 0,
                                updated_at TEXT NOT NULL
                            )"""
                        )
                        connection.execute(
                            """CREATE TABLE IF NOT EXISTS sessions (
                                id TEXT PRIMARY KEY,
                                child_id TEXT NOT NULL,
                                exercise_id TEXT NOT NULL,
                                timestamp TEXT NOT NULL,
                                ai_assessment_json TEXT,
                                pronunciation_json TEXT,
                                exercise_metadata_json TEXT,
                                transcript TEXT,
                                reference_text TEXT,
                                feedback_rating TEXT,
                                feedback_note TEXT,
                                feedback_submitted_at TEXT,
                                FOREIGN KEY (child_id) REFERENCES children(id),
                                FOREIGN KEY (exercise_id) REFERENCES exercises(id)
                            )"""
                        )
                        connection.execute(
                            """CREATE TABLE IF NOT EXISTS practice_plans (
                                id TEXT PRIMARY KEY,
                                child_id TEXT NOT NULL,
                                source_session_id TEXT,
                                status TEXT NOT NULL,
                                title TEXT NOT NULL,
                                plan_type TEXT NOT NULL,
                                constraints_json TEXT NOT NULL,
                                draft_json TEXT NOT NULL,
                                conversation_json TEXT NOT NULL,
                                planner_session_id TEXT,
                                created_by_user_id TEXT,
                                created_at TEXT NOT NULL,
                                updated_at TEXT NOT NULL,
                                approved_at TEXT,
                                FOREIGN KEY (child_id) REFERENCES children(id),
                                FOREIGN KEY (source_session_id) REFERENCES sessions(id),
                                FOREIGN KEY (created_by_user_id) REFERENCES users(id)
                            )"""
                        )
                        connection.execute(
                            """CREATE TABLE IF NOT EXISTS child_memory_items (
                                id TEXT PRIMARY KEY,
                                child_id TEXT NOT NULL,
                                category TEXT NOT NULL,
                                memory_type TEXT NOT NULL,
                                status TEXT NOT NULL,
                                statement TEXT NOT NULL,
                                detail_json TEXT NOT NULL,
                                confidence REAL,
                                provenance_json TEXT NOT NULL,
                                author_type TEXT NOT NULL,
                                author_user_id TEXT,
                                source_proposal_id TEXT,
                                superseded_by_item_id TEXT,
                                created_at TEXT NOT NULL,
                                updated_at TEXT NOT NULL,
                                reviewed_at TEXT,
                                expires_at TEXT,
                                FOREIGN KEY (child_id) REFERENCES children(id),
                                FOREIGN KEY (author_user_id) REFERENCES users(id)
                            )"""
                        )
                        connection.execute(
                            """CREATE TABLE IF NOT EXISTS child_memory_proposals (
                                id TEXT PRIMARY KEY,
                                child_id TEXT NOT NULL,
                                category TEXT NOT NULL,
                                memory_type TEXT NOT NULL,
                                status TEXT NOT NULL,
                                statement TEXT NOT NULL,
                                detail_json TEXT NOT NULL,
                                confidence REAL,
                                provenance_json TEXT NOT NULL,
                                author_type TEXT NOT NULL,
                                author_user_id TEXT,
                                reviewer_user_id TEXT,
                                review_note TEXT,
                                approved_item_id TEXT,
                                created_at TEXT NOT NULL,
                                updated_at TEXT NOT NULL,
                                reviewed_at TEXT,
                                FOREIGN KEY (child_id) REFERENCES children(id),
                                FOREIGN KEY (author_user_id) REFERENCES users(id),
                                FOREIGN KEY (reviewer_user_id) REFERENCES users(id)
                            )"""
                        )
                        connection.execute(
                            """CREATE TABLE IF NOT EXISTS child_memory_evidence_links (
                                id TEXT PRIMARY KEY,
                                child_id TEXT NOT NULL,
                                subject_type TEXT NOT NULL,
                                subject_id TEXT NOT NULL,
                                session_id TEXT,
                                practice_plan_id TEXT,
                                evidence_kind TEXT NOT NULL,
                                snippet TEXT,
                                metadata_json TEXT NOT NULL,
                                created_at TEXT NOT NULL,
                                FOREIGN KEY (child_id) REFERENCES children(id),
                                FOREIGN KEY (session_id) REFERENCES sessions(id),
                                FOREIGN KEY (practice_plan_id) REFERENCES practice_plans(id)
                            )"""
                        )
                        connection.execute(
                            """CREATE TABLE IF NOT EXISTS child_memory_summaries (
                                child_id TEXT PRIMARY KEY,
                                summary_json TEXT NOT NULL,
                                summary_text TEXT,
                                source_item_count INTEGER NOT NULL DEFAULT 0,
                                last_compiled_at TEXT NOT NULL,
                                updated_at TEXT NOT NULL,
                                FOREIGN KEY (child_id) REFERENCES children(id)
                            )"""
                        )
                        connection.execute(
                            "CREATE INDEX IF NOT EXISTS idx_child_memory_items_child_status ON child_memory_items (child_id, status, updated_at DESC)"
                        )
                        connection.execute(
                            "CREATE INDEX IF NOT EXISTS idx_child_memory_items_child_category ON child_memory_items (child_id, category, updated_at DESC)"
                        )
                        connection.execute(
                            "CREATE INDEX IF NOT EXISTS idx_child_memory_proposals_child_status ON child_memory_proposals (child_id, status, created_at DESC)"
                        )
                        connection.execute(
                            "CREATE INDEX IF NOT EXISTS idx_child_memory_evidence_subject ON child_memory_evidence_links (subject_type, subject_id, created_at DESC)"
                        )
                        self._ensure_institutional_memory_tables(connection)
                        self._ensure_recommendation_tables(connection)
                        self._ensure_migrations(connection)
                        self._seed_children(connection)
                        logger.info("SQLite committing...")
                        connection.commit()
                        logger.info("SQLite init complete")
                    return
                except sqlite3.OperationalError as error:
                    logger.warning("SQLite init attempt %d failed: %s", attempt + 1, error)
                    if "database is locked" not in str(error).lower() or attempt == SQLITE_LOCK_RETRY_COUNT - 1:
                        raise
                    time.sleep(SQLITE_LOCK_RETRY_DELAY_SECONDS)

    def _ensure_migrations(self, connection: sqlite3.Connection):
        self._ensure_column(connection, "users", "email", "TEXT")
        self._ensure_column(connection, "users", "name", "TEXT")
        self._ensure_column(connection, "users", "provider", "TEXT")
        self._ensure_column(connection, "users", "role", "TEXT NOT NULL DEFAULT 'user'")
        self._ensure_column(connection, "users", "created_at", "TEXT")
        self._ensure_column(connection, "sessions", "feedback_rating", "TEXT")
        self._ensure_column(connection, "sessions", "feedback_note", "TEXT")
        self._ensure_column(connection, "sessions", "feedback_submitted_at", "TEXT")
        self._ensure_institutional_memory_tables(connection)
        self._ensure_recommendation_tables(connection)

    def _ensure_institutional_memory_tables(self, connection: sqlite3.Connection):
        connection.execute(
            """CREATE TABLE IF NOT EXISTS institutional_memory_insights (
                id TEXT PRIMARY KEY,
                insight_type TEXT NOT NULL,
                status TEXT NOT NULL,
                target_sound TEXT,
                title TEXT NOT NULL,
                summary TEXT NOT NULL,
                detail_json TEXT NOT NULL,
                provenance_json TEXT NOT NULL,
                source_child_count INTEGER NOT NULL DEFAULT 0,
                source_session_count INTEGER NOT NULL DEFAULT 0,
                source_memory_item_count INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )"""
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_institutional_memory_status_target ON institutional_memory_insights (status, target_sound, updated_at DESC)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_institutional_memory_type_updated ON institutional_memory_insights (insight_type, updated_at DESC)"
        )

    def _ensure_recommendation_tables(self, connection: sqlite3.Connection):
        connection.execute(
            """CREATE TABLE IF NOT EXISTS recommendation_logs (
                id TEXT PRIMARY KEY,
                child_id TEXT NOT NULL,
                source_session_id TEXT,
                target_sound TEXT NOT NULL,
                therapist_constraints_json TEXT NOT NULL,
                ranking_context_json TEXT NOT NULL,
                rationale_text TEXT NOT NULL,
                created_by_user_id TEXT,
                candidate_count INTEGER NOT NULL DEFAULT 0,
                top_recommendation_score REAL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (child_id) REFERENCES children(id),
                FOREIGN KEY (source_session_id) REFERENCES sessions(id),
                FOREIGN KEY (created_by_user_id) REFERENCES users(id)
            )"""
        )
        connection.execute(
            """CREATE TABLE IF NOT EXISTS recommendation_candidates (
                id TEXT PRIMARY KEY,
                recommendation_log_id TEXT NOT NULL,
                rank INTEGER NOT NULL,
                exercise_id TEXT NOT NULL,
                exercise_name TEXT NOT NULL,
                exercise_description TEXT,
                exercise_metadata_json TEXT NOT NULL,
                score REAL NOT NULL,
                ranking_factors_json TEXT NOT NULL,
                rationale_text TEXT NOT NULL,
                explanation_json TEXT NOT NULL,
                supporting_memory_item_ids_json TEXT NOT NULL,
                supporting_session_ids_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (recommendation_log_id) REFERENCES recommendation_logs(id) ON DELETE CASCADE
            )"""
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_recommendation_logs_child_created ON recommendation_logs (child_id, created_at DESC)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_recommendation_candidates_log_rank ON recommendation_candidates (recommendation_log_id, rank ASC)"
        )

    def _ensure_column(self, connection: sqlite3.Connection, table_name: str, column_name: str, definition: str):
        columns = {
            row["name"]
            for row in connection.execute(f"PRAGMA table_info({table_name})").fetchall()
        }
        if column_name in columns:
            return

        connection.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}")

    def _seed_children(self, connection: sqlite3.Connection):
        existing_count = connection.execute("SELECT COUNT(*) FROM children").fetchone()[0]
        if existing_count:
            return

        now = self._utc_now()
        connection.executemany(
            "INSERT INTO children (id, name, created_at) VALUES (?, ?, ?)",
            [(child["id"], child["name"], now) for child in DEFAULT_CHILDREN],
        )

    def _utc_now(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def _loads_json(self, value: Optional[str], fallback: Any) -> Any:
        if not value:
            return fallback

        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return fallback

    def _dumps_json(self, value: Any) -> str:
        return json.dumps(value if value is not None else {}, ensure_ascii=True)

    def _build_feedback_payload(
        self,
        rating: Optional[str],
        note: Optional[str],
        submitted_at: Optional[str],
    ) -> Optional[Dict[str, Any]]:
        if not rating and not note and not submitted_at:
            return None

        return {
            "rating": rating,
            "note": note,
            "submitted_at": submitted_at,
        }

    def _build_practice_plan_payload(self, row: sqlite3.Row) -> Dict[str, Any]:
        return {
            "id": row["id"],
            "child_id": row["child_id"],
            "source_session_id": row["source_session_id"],
            "status": row["status"],
            "title": row["title"],
            "plan_type": row["plan_type"],
            "constraints": self._loads_json(row["constraints_json"], {}),
            "draft": self._loads_json(row["draft_json"], {}),
            "conversation": self._loads_json(row["conversation_json"], []),
            "planner_session_id": row["planner_session_id"],
            "created_by_user_id": row["created_by_user_id"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "approved_at": row["approved_at"],
        }

    def _build_child_memory_item_payload(self, row: sqlite3.Row) -> Dict[str, Any]:
        return {
            "id": row["id"],
            "child_id": row["child_id"],
            "category": row["category"],
            "memory_type": row["memory_type"],
            "status": row["status"],
            "statement": row["statement"],
            "detail": self._loads_json(row["detail_json"], MEMORY_DETAIL_FALLBACK),
            "confidence": row["confidence"],
            "provenance": self._loads_json(row["provenance_json"], MEMORY_PROVENANCE_FALLBACK),
            "author_type": row["author_type"],
            "author_user_id": row["author_user_id"],
            "source_proposal_id": row["source_proposal_id"],
            "superseded_by_item_id": row["superseded_by_item_id"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "reviewed_at": row["reviewed_at"],
            "expires_at": row["expires_at"],
        }

    def _build_child_memory_proposal_payload(self, row: sqlite3.Row) -> Dict[str, Any]:
        return {
            "id": row["id"],
            "child_id": row["child_id"],
            "category": row["category"],
            "memory_type": row["memory_type"],
            "status": row["status"],
            "statement": row["statement"],
            "detail": self._loads_json(row["detail_json"], MEMORY_DETAIL_FALLBACK),
            "confidence": row["confidence"],
            "provenance": self._loads_json(row["provenance_json"], MEMORY_PROVENANCE_FALLBACK),
            "author_type": row["author_type"],
            "author_user_id": row["author_user_id"],
            "reviewer_user_id": row["reviewer_user_id"],
            "review_note": row["review_note"],
            "approved_item_id": row["approved_item_id"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "reviewed_at": row["reviewed_at"],
        }

    def _build_child_memory_evidence_link_payload(self, row: sqlite3.Row) -> Dict[str, Any]:
        return {
            "id": row["id"],
            "child_id": row["child_id"],
            "subject_type": row["subject_type"],
            "subject_id": row["subject_id"],
            "session_id": row["session_id"],
            "practice_plan_id": row["practice_plan_id"],
            "evidence_kind": row["evidence_kind"],
            "snippet": row["snippet"],
            "metadata": self._loads_json(row["metadata_json"], MEMORY_DETAIL_FALLBACK),
            "created_at": row["created_at"],
        }

    def _build_child_memory_summary_payload(self, row: sqlite3.Row) -> Dict[str, Any]:
        return {
            "child_id": row["child_id"],
            "summary": self._loads_json(row["summary_json"], MEMORY_DETAIL_FALLBACK),
            "summary_text": row["summary_text"],
            "source_item_count": row["source_item_count"],
            "last_compiled_at": row["last_compiled_at"],
            "updated_at": row["updated_at"],
        }

    def _build_institutional_memory_insight_payload(self, row: sqlite3.Row) -> Dict[str, Any]:
        return {
            "id": row["id"],
            "insight_type": row["insight_type"],
            "status": row["status"],
            "target_sound": row["target_sound"],
            "title": row["title"],
            "summary": row["summary"],
            "detail": self._loads_json(row["detail_json"], MEMORY_DETAIL_FALLBACK),
            "provenance": self._loads_json(row["provenance_json"], MEMORY_PROVENANCE_FALLBACK),
            "source_child_count": row["source_child_count"],
            "source_session_count": row["source_session_count"],
            "source_memory_item_count": row["source_memory_item_count"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    def _build_recommendation_log_payload(self, row: sqlite3.Row) -> Dict[str, Any]:
        return {
            "id": row["id"],
            "child_id": row["child_id"],
            "source_session_id": row["source_session_id"],
            "target_sound": row["target_sound"],
            "therapist_constraints": self._loads_json(row["therapist_constraints_json"], MEMORY_DETAIL_FALLBACK),
            "ranking_context": self._loads_json(row["ranking_context_json"], MEMORY_DETAIL_FALLBACK),
            "rationale": row["rationale_text"],
            "created_by_user_id": row["created_by_user_id"],
            "candidate_count": row["candidate_count"],
            "top_recommendation_score": row["top_recommendation_score"],
            "created_at": row["created_at"],
        }

    def _build_recommendation_candidate_payload(self, row: sqlite3.Row, *, child_id: Optional[str] = None) -> Dict[str, Any]:
        return {
            "id": row["id"],
            "recommendation_log_id": row["recommendation_log_id"],
            "child_id": child_id,
            "rank": row["rank"],
            "exercise_id": row["exercise_id"],
            "exercise_name": row["exercise_name"],
            "exercise_description": row["exercise_description"],
            "exercise_metadata": self._loads_json(row["exercise_metadata_json"], MEMORY_DETAIL_FALLBACK),
            "score": row["score"],
            "ranking_factors": self._loads_json(row["ranking_factors_json"], MEMORY_DETAIL_FALLBACK),
            "rationale": row["rationale_text"],
            "explanation": self._loads_json(row["explanation_json"], MEMORY_DETAIL_FALLBACK),
            "supporting_memory_item_ids": self._loads_json(row["supporting_memory_item_ids_json"], []),
            "supporting_session_ids": self._loads_json(row["supporting_session_ids_json"], []),
            "created_at": row["created_at"],
        }

    def _execute_write(self, operation: Callable[[sqlite3.Connection], WriteResult]) -> WriteResult:
        with self._lock:
            with self._connect() as connection:
                result = operation(connection)
                connection.commit()
            self._trigger_blob_backup()
            return result

    def _trigger_blob_backup(self) -> None:
        """Best-effort upload of the local database to Azure Blob Storage."""
        try:
            backup_to_blob(
                str(self.db_path),
                account_name=str(config["blob_backup_account_name"]),
                account_key=str(config["blob_backup_account_key"]),
                container=str(config["blob_backup_container"]),
                blob_name=str(config["blob_backup_name"]),
            )
        except Exception as exc:
            logger.warning("Blob backup after write failed: %s", exc)

    def _set_setting(self, key: str, value: Optional[str]):
        def persist_setting(connection: sqlite3.Connection) -> None:
            connection.execute(
                """
                INSERT INTO app_settings (key, value, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = excluded.updated_at
                """,
                (key, value, self._utc_now()),
            )

        self._execute_write(persist_setting)

    def _get_setting(self, key: str) -> Optional[str]:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT value FROM app_settings WHERE key = ?",
                (key,),
            ).fetchone()

        return None if row is None else row["value"]

    def get_pilot_state(self) -> Dict[str, Any]:
        return {
            "consent_timestamp": self._get_setting("consent_timestamp"),
            "roles_enabled": True,
            "therapist_pin_configured": False,
        }

    def get_user(self, user_id: str) -> Optional[Dict[str, Any]]:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT id, email, name, provider, role, created_at FROM users WHERE id = ?",
                (user_id,),
            ).fetchone()

        if row is None:
            return None

        return {
            "id": row["id"],
            "email": row["email"],
            "name": row["name"],
            "provider": row["provider"],
            "role": row["role"],
            "created_at": row["created_at"],
        }

    def get_or_create_user(self, user_id: str, email: str, name: str, provider: str) -> Dict[str, Any]:
        now = self._utc_now()

        def persist_user(connection: sqlite3.Connection) -> Dict[str, Any]:
            existing = connection.execute(
                "SELECT id, email, name, provider, role, created_at FROM users WHERE id = ?",
                (user_id,),
            ).fetchone()

            if existing is not None:
                connection.execute(
                    """
                    UPDATE users
                    SET email = ?, name = ?, provider = ?
                    WHERE id = ?
                    """,
                    (email, name, provider, user_id),
                )
                return {
                    "id": existing["id"],
                    "email": email,
                    "name": name,
                    "provider": provider,
                    "role": existing["role"],
                    "created_at": existing["created_at"],
                }

            user_count = connection.execute("SELECT COUNT(*) FROM users").fetchone()[0]
            role = "therapist" if user_count == 0 else "user"
            connection.execute(
                """
                INSERT INTO users (id, email, name, provider, role, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (user_id, email, name, provider, role, now),
            )
            return {
                "id": user_id,
                "email": email,
                "name": name,
                "provider": provider,
                "role": role,
                "created_at": now,
            }

        return self._execute_write(persist_user)

    def update_user_role(self, user_id: str, role: str) -> Optional[Dict[str, Any]]:
        if role not in {"therapist", "user"}:
            raise ValueError("Unsupported role")

        def persist_role(connection: sqlite3.Connection) -> int:
            cursor = connection.execute(
                "UPDATE users SET role = ? WHERE id = ?",
                (role, user_id),
            )
            return cursor.rowcount

        rowcount = self._execute_write(persist_role)
        if rowcount == 0:
            return None

        return self.get_user(user_id)

    def save_consent_acknowledgement(self, timestamp: Optional[str] = None) -> str:
        consent_timestamp = timestamp or self._utc_now()
        self._set_setting("consent_timestamp", consent_timestamp)
        return consent_timestamp

    def upsert_child(self, child_id: str, child_name: str):
        def persist_child(connection: sqlite3.Connection) -> None:
            connection.execute(
                """
                INSERT INTO children (id, name, created_at)
                VALUES (?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET name = excluded.name
                """,
                (child_id, child_name, self._utc_now()),
            )

        self._execute_write(persist_child)

    def upsert_exercise(
        self,
        exercise_id: str,
        name: str,
        description: str,
        metadata: Dict[str, Any],
        is_custom: bool = False,
    ):
        def persist_exercise(connection: sqlite3.Connection) -> None:
            connection.execute(
                """
                INSERT INTO exercises (id, name, description, metadata_json, is_custom, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    description = excluded.description,
                    metadata_json = excluded.metadata_json,
                    is_custom = excluded.is_custom,
                    updated_at = excluded.updated_at
                """,
                (
                    exercise_id,
                    name,
                    description,
                    self._dumps_json(metadata),
                    1 if is_custom else 0,
                    self._utc_now(),
                ),
            )

        self._execute_write(persist_exercise)

    def list_children(self) -> List[Dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT
                    children.id,
                    children.name,
                    children.created_at,
                    COUNT(sessions.id) AS session_count,
                    MAX(sessions.timestamp) AS last_session_at
                FROM children
                LEFT JOIN sessions ON sessions.child_id = children.id
                GROUP BY children.id, children.name, children.created_at
                ORDER BY children.name COLLATE NOCASE ASC
                """
            ).fetchall()

        return [
            {
                "id": row["id"],
                "name": row["name"],
                "created_at": row["created_at"],
                "session_count": row["session_count"],
                "last_session_at": row["last_session_at"],
            }
            for row in rows
        ]

    def save_session(self, session_payload: Dict[str, Any]) -> Dict[str, Any]:
        child_id = str(session_payload.get("child_id") or DEFAULT_CHILDREN[0]["id"])
        child_name = str(session_payload.get("child_name") or child_id.replace("-", " ").title())
        exercise = dict(session_payload.get("exercise") or {})
        exercise_id = str(session_payload.get("exercise_id") or exercise.get("id") or "unknown-exercise")
        exercise_name = str(exercise.get("name") or "Speech exercise")
        exercise_description = str(exercise.get("description") or "")
        exercise_metadata = dict(session_payload.get("exercise_metadata") or exercise.get("exerciseMetadata") or {})
        session_id = str(session_payload.get("id") or f"session-{uuid4().hex[:12]}")
        timestamp = str(session_payload.get("timestamp") or self._utc_now())

        self.upsert_child(child_id, child_name)
        self.upsert_exercise(
            exercise_id,
            exercise_name,
            exercise_description,
            exercise_metadata,
            bool(exercise.get("is_custom")),
        )

        def persist_session(connection: sqlite3.Connection) -> None:
            connection.execute(
                """
                INSERT INTO sessions (
                    id,
                    child_id,
                    exercise_id,
                    timestamp,
                    ai_assessment_json,
                    pronunciation_json,
                    exercise_metadata_json,
                    transcript,
                    reference_text,
                    feedback_rating,
                    feedback_note,
                    feedback_submitted_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    session_id,
                    child_id,
                    exercise_id,
                    timestamp,
                    self._dumps_json(session_payload.get("ai_assessment")),
                    self._dumps_json(session_payload.get("pronunciation_assessment")),
                    self._dumps_json(exercise_metadata),
                    session_payload.get("transcript"),
                    session_payload.get("reference_text"),
                    None,
                    None,
                    None,
                ),
            )

        self._execute_write(persist_session)

        session = self.get_session(session_id)
        if session is None:
            raise RuntimeError("Session could not be reloaded after save")
        return session

    def list_sessions_for_child(self, child_id: str) -> List[Dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT
                    sessions.id,
                    sessions.timestamp,
                    sessions.ai_assessment_json,
                    sessions.pronunciation_json,
                    sessions.exercise_metadata_json,
                    sessions.feedback_rating,
                    sessions.feedback_note,
                    sessions.feedback_submitted_at,
                    exercises.id AS exercise_id,
                    exercises.name AS exercise_name,
                    exercises.description AS exercise_description,
                    exercises.metadata_json AS exercise_metadata_fallback,
                    exercises.is_custom AS exercise_is_custom
                FROM sessions
                INNER JOIN exercises ON exercises.id = sessions.exercise_id
                WHERE sessions.child_id = ?
                ORDER BY sessions.timestamp DESC
                """,
                (child_id,),
            ).fetchall()

        summaries: List[Dict[str, Any]] = []
        for row in rows:
            ai_assessment = self._loads_json(row["ai_assessment_json"], None)
            pronunciation = self._loads_json(row["pronunciation_json"], None)
            exercise_metadata = self._loads_json(
                row["exercise_metadata_json"],
                self._loads_json(row["exercise_metadata_fallback"], {}),
            )

            summaries.append(
                {
                    "id": row["id"],
                    "timestamp": row["timestamp"],
                    "overall_score": ai_assessment.get("overall_score") if ai_assessment else None,
                    "pronunciation_score": pronunciation.get("pronunciation_score") if pronunciation else None,
                    "accuracy_score": pronunciation.get("accuracy_score") if pronunciation else None,
                    "therapist_notes": ai_assessment.get("therapist_notes") if ai_assessment else None,
                    "therapist_feedback": self._build_feedback_payload(
                        row["feedback_rating"],
                        row["feedback_note"],
                        row["feedback_submitted_at"],
                    ),
                    "exercise_metadata": exercise_metadata,
                    "exercise": {
                        "id": row["exercise_id"],
                        "name": row["exercise_name"],
                        "description": row["exercise_description"],
                        "exerciseMetadata": exercise_metadata,
                        "is_custom": bool(row["exercise_is_custom"]),
                    },
                }
            )

        return summaries

    def get_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT
                    sessions.id,
                    sessions.timestamp,
                    sessions.ai_assessment_json,
                    sessions.pronunciation_json,
                    sessions.exercise_metadata_json,
                    sessions.transcript,
                    sessions.reference_text,
                    sessions.feedback_rating,
                    sessions.feedback_note,
                    sessions.feedback_submitted_at,
                    children.id AS child_id,
                    children.name AS child_name,
                    exercises.id AS exercise_id,
                    exercises.name AS exercise_name,
                    exercises.description AS exercise_description,
                    exercises.metadata_json AS exercise_metadata_fallback,
                    exercises.is_custom AS exercise_is_custom
                FROM sessions
                INNER JOIN children ON children.id = sessions.child_id
                INNER JOIN exercises ON exercises.id = sessions.exercise_id
                WHERE sessions.id = ?
                """,
                (session_id,),
            ).fetchone()

        if row is None:
            return None

        exercise_metadata = self._loads_json(
            row["exercise_metadata_json"],
            self._loads_json(row["exercise_metadata_fallback"], {}),
        )

        return {
            "id": row["id"],
            "timestamp": row["timestamp"],
            "child": {
                "id": row["child_id"],
                "name": row["child_name"],
            },
            "exercise": {
                "id": row["exercise_id"],
                "name": row["exercise_name"],
                "description": row["exercise_description"],
                "exerciseMetadata": exercise_metadata,
                "is_custom": bool(row["exercise_is_custom"]),
            },
            "exercise_metadata": exercise_metadata,
            "assessment": {
                "ai_assessment": self._loads_json(row["ai_assessment_json"], None),
                "pronunciation_assessment": self._loads_json(row["pronunciation_json"], None),
            },
            "therapist_feedback": self._build_feedback_payload(
                row["feedback_rating"],
                row["feedback_note"],
                row["feedback_submitted_at"],
            ),
            "transcript": row["transcript"],
            "reference_text": row["reference_text"],
        }

    def save_session_feedback(self, session_id: str, rating: str, note: Optional[str] = None) -> Optional[Dict[str, Any]]:
        feedback_note = (note or "").strip() or None
        submitted_at = self._utc_now()

        def persist_feedback(connection: sqlite3.Connection) -> int:
            cursor = connection.execute(
                """
                UPDATE sessions
                SET feedback_rating = ?, feedback_note = ?, feedback_submitted_at = ?
                WHERE id = ?
                """,
                (rating, feedback_note, submitted_at, session_id),
            )
            return cursor.rowcount

        rowcount = self._execute_write(persist_feedback)
        if rowcount == 0:
            return None

        return self.get_session(session_id)

    def save_practice_plan(self, plan_payload: Dict[str, Any]) -> Dict[str, Any]:
        plan_id = str(plan_payload.get("id") or f"plan-{uuid4().hex[:12]}")
        child_id = str(plan_payload.get("child_id") or "")
        if not child_id:
            raise ValueError("child_id is required")

        source_session_id = plan_payload.get("source_session_id")
        now = self._utc_now()
        created_at = str(plan_payload.get("created_at") or now)
        updated_at = str(plan_payload.get("updated_at") or now)
        approved_at = plan_payload.get("approved_at")

        def persist_plan(connection: sqlite3.Connection) -> None:
            connection.execute(
                """
                INSERT INTO practice_plans (
                    id,
                    child_id,
                    source_session_id,
                    status,
                    title,
                    plan_type,
                    constraints_json,
                    draft_json,
                    conversation_json,
                    planner_session_id,
                    created_by_user_id,
                    created_at,
                    updated_at,
                    approved_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    child_id = excluded.child_id,
                    source_session_id = excluded.source_session_id,
                    status = excluded.status,
                    title = excluded.title,
                    plan_type = excluded.plan_type,
                    constraints_json = excluded.constraints_json,
                    draft_json = excluded.draft_json,
                    conversation_json = excluded.conversation_json,
                    planner_session_id = excluded.planner_session_id,
                    created_by_user_id = excluded.created_by_user_id,
                    updated_at = excluded.updated_at,
                    approved_at = excluded.approved_at
                """,
                (
                    plan_id,
                    child_id,
                    source_session_id,
                    str(plan_payload.get("status") or "draft"),
                    str(plan_payload.get("title") or "Next session plan"),
                    str(plan_payload.get("plan_type") or "next_session"),
                    self._dumps_json(plan_payload.get("constraints") or {}),
                    self._dumps_json(plan_payload.get("draft") or {}),
                    self._dumps_json(plan_payload.get("conversation") or []),
                    str(plan_payload.get("planner_session_id") or plan_id),
                    plan_payload.get("created_by_user_id"),
                    created_at,
                    updated_at,
                    approved_at,
                ),
            )

        self._execute_write(persist_plan)

        plan = self.get_practice_plan(plan_id)
        if plan is None:
            raise RuntimeError("Practice plan could not be reloaded after save")
        return plan

    def list_practice_plans_for_child(self, child_id: str) -> List[Dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT
                    id,
                    child_id,
                    source_session_id,
                    status,
                    title,
                    plan_type,
                    constraints_json,
                    draft_json,
                    conversation_json,
                    planner_session_id,
                    created_by_user_id,
                    created_at,
                    updated_at,
                    approved_at
                FROM practice_plans
                WHERE child_id = ?
                ORDER BY updated_at DESC, created_at DESC
                """,
                (child_id,),
            ).fetchall()

        return [self._build_practice_plan_payload(row) for row in rows]

    def get_practice_plan(self, plan_id: str) -> Optional[Dict[str, Any]]:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT
                    id,
                    child_id,
                    source_session_id,
                    status,
                    title,
                    plan_type,
                    constraints_json,
                    draft_json,
                    conversation_json,
                    planner_session_id,
                    created_by_user_id,
                    created_at,
                    updated_at,
                    approved_at
                FROM practice_plans
                WHERE id = ?
                """,
                (plan_id,),
            ).fetchone()

        if row is None:
            return None

        return self._build_practice_plan_payload(row)

    def approve_practice_plan(self, plan_id: str) -> Optional[Dict[str, Any]]:
        approved_at = self._utc_now()

        def persist_approval(connection: sqlite3.Connection) -> int:
            cursor = connection.execute(
                """
                UPDATE practice_plans
                SET status = ?, approved_at = ?, updated_at = ?
                WHERE id = ?
                """,
                ("approved", approved_at, approved_at, plan_id),
            )
            return cursor.rowcount

        rowcount = self._execute_write(persist_approval)
        if rowcount == 0:
            return None

        return self.get_practice_plan(plan_id)

    def save_child_memory_item(self, item_payload: Dict[str, Any]) -> Dict[str, Any]:
        item_id = str(item_payload.get("id") or f"memory-item-{uuid4().hex[:12]}")
        child_id = str(item_payload.get("child_id") or "").strip()
        if not child_id:
            raise ValueError("child_id is required")

        now = self._utc_now()
        created_at = str(item_payload.get("created_at") or now)
        updated_at = str(item_payload.get("updated_at") or now)

        def persist_item(connection: sqlite3.Connection) -> None:
            connection.execute(
                """
                INSERT INTO child_memory_items (
                    id,
                    child_id,
                    category,
                    memory_type,
                    status,
                    statement,
                    detail_json,
                    confidence,
                    provenance_json,
                    author_type,
                    author_user_id,
                    source_proposal_id,
                    superseded_by_item_id,
                    created_at,
                    updated_at,
                    reviewed_at,
                    expires_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    child_id = excluded.child_id,
                    category = excluded.category,
                    memory_type = excluded.memory_type,
                    status = excluded.status,
                    statement = excluded.statement,
                    detail_json = excluded.detail_json,
                    confidence = excluded.confidence,
                    provenance_json = excluded.provenance_json,
                    author_type = excluded.author_type,
                    author_user_id = excluded.author_user_id,
                    source_proposal_id = excluded.source_proposal_id,
                    superseded_by_item_id = excluded.superseded_by_item_id,
                    updated_at = excluded.updated_at,
                    reviewed_at = excluded.reviewed_at,
                    expires_at = excluded.expires_at
                """,
                (
                    item_id,
                    child_id,
                    str(item_payload.get("category") or "general"),
                    str(item_payload.get("memory_type") or "fact"),
                    str(item_payload.get("status") or "approved"),
                    str(item_payload.get("statement") or "").strip(),
                    self._dumps_json(item_payload.get("detail") or {}),
                    item_payload.get("confidence"),
                    self._dumps_json(item_payload.get("provenance") or {}),
                    str(item_payload.get("author_type") or "system"),
                    item_payload.get("author_user_id"),
                    item_payload.get("source_proposal_id"),
                    item_payload.get("superseded_by_item_id"),
                    created_at,
                    updated_at,
                    item_payload.get("reviewed_at"),
                    item_payload.get("expires_at"),
                ),
            )

        self._execute_write(persist_item)

        item = self.get_child_memory_item(item_id)
        if item is None:
            raise RuntimeError("Child memory item could not be reloaded after save")
        return item

    def get_child_memory_item(self, item_id: str) -> Optional[Dict[str, Any]]:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT
                    id,
                    child_id,
                    category,
                    memory_type,
                    status,
                    statement,
                    detail_json,
                    confidence,
                    provenance_json,
                    author_type,
                    author_user_id,
                    source_proposal_id,
                    superseded_by_item_id,
                    created_at,
                    updated_at,
                    reviewed_at,
                    expires_at
                FROM child_memory_items
                WHERE id = ?
                """,
                (item_id,),
            ).fetchone()

        if row is None:
            return None

        return self._build_child_memory_item_payload(row)

    def list_child_memory_items(
        self,
        child_id: str,
        status: Optional[str] = None,
        category: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        query = [
            """
            SELECT
                id,
                child_id,
                category,
                memory_type,
                status,
                statement,
                detail_json,
                confidence,
                provenance_json,
                author_type,
                author_user_id,
                source_proposal_id,
                superseded_by_item_id,
                created_at,
                updated_at,
                reviewed_at,
                expires_at
            FROM child_memory_items
            WHERE child_id = ?
            """
        ]
        parameters: List[Any] = [child_id]
        if status:
            query.append("AND status = ?")
            parameters.append(status)
        if category:
            query.append("AND category = ?")
            parameters.append(category)
        query.append("ORDER BY updated_at DESC, created_at DESC")

        with self._connect() as connection:
            rows = connection.execute("\n".join(query), parameters).fetchall()

        return [self._build_child_memory_item_payload(row) for row in rows]

    def update_child_memory_item_status(
        self,
        item_id: str,
        status: str,
        superseded_by_item_id: Optional[str] = None,
        expires_at: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        updated_at = self._utc_now()

        def persist_status(connection: sqlite3.Connection) -> int:
            cursor = connection.execute(
                """
                UPDATE child_memory_items
                SET status = ?, superseded_by_item_id = ?, expires_at = ?, updated_at = ?, reviewed_at = ?
                WHERE id = ?
                """,
                (status, superseded_by_item_id, expires_at, updated_at, updated_at, item_id),
            )
            return cursor.rowcount

        rowcount = self._execute_write(persist_status)
        if rowcount == 0:
            return None

        return self.get_child_memory_item(item_id)

    def save_child_memory_proposal(self, proposal_payload: Dict[str, Any]) -> Dict[str, Any]:
        proposal_id = str(proposal_payload.get("id") or f"memory-proposal-{uuid4().hex[:12]}")
        child_id = str(proposal_payload.get("child_id") or "").strip()
        if not child_id:
            raise ValueError("child_id is required")

        now = self._utc_now()
        created_at = str(proposal_payload.get("created_at") or now)
        updated_at = str(proposal_payload.get("updated_at") or now)

        def persist_proposal(connection: sqlite3.Connection) -> None:
            connection.execute(
                """
                INSERT INTO child_memory_proposals (
                    id,
                    child_id,
                    category,
                    memory_type,
                    status,
                    statement,
                    detail_json,
                    confidence,
                    provenance_json,
                    author_type,
                    author_user_id,
                    reviewer_user_id,
                    review_note,
                    approved_item_id,
                    created_at,
                    updated_at,
                    reviewed_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    child_id = excluded.child_id,
                    category = excluded.category,
                    memory_type = excluded.memory_type,
                    status = excluded.status,
                    statement = excluded.statement,
                    detail_json = excluded.detail_json,
                    confidence = excluded.confidence,
                    provenance_json = excluded.provenance_json,
                    author_type = excluded.author_type,
                    author_user_id = excluded.author_user_id,
                    reviewer_user_id = excluded.reviewer_user_id,
                    review_note = excluded.review_note,
                    approved_item_id = excluded.approved_item_id,
                    updated_at = excluded.updated_at,
                    reviewed_at = excluded.reviewed_at
                """,
                (
                    proposal_id,
                    child_id,
                    str(proposal_payload.get("category") or "general"),
                    str(proposal_payload.get("memory_type") or "fact"),
                    str(proposal_payload.get("status") or "pending"),
                    str(proposal_payload.get("statement") or "").strip(),
                    self._dumps_json(proposal_payload.get("detail") or {}),
                    proposal_payload.get("confidence"),
                    self._dumps_json(proposal_payload.get("provenance") or {}),
                    str(proposal_payload.get("author_type") or "system"),
                    proposal_payload.get("author_user_id"),
                    proposal_payload.get("reviewer_user_id"),
                    proposal_payload.get("review_note"),
                    proposal_payload.get("approved_item_id"),
                    created_at,
                    updated_at,
                    proposal_payload.get("reviewed_at"),
                ),
            )

        self._execute_write(persist_proposal)

        proposal = self.get_child_memory_proposal(proposal_id)
        if proposal is None:
            raise RuntimeError("Child memory proposal could not be reloaded after save")
        return proposal

    def get_child_memory_proposal(self, proposal_id: str) -> Optional[Dict[str, Any]]:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT
                    id,
                    child_id,
                    category,
                    memory_type,
                    status,
                    statement,
                    detail_json,
                    confidence,
                    provenance_json,
                    author_type,
                    author_user_id,
                    reviewer_user_id,
                    review_note,
                    approved_item_id,
                    created_at,
                    updated_at,
                    reviewed_at
                FROM child_memory_proposals
                WHERE id = ?
                """,
                (proposal_id,),
            ).fetchone()

        if row is None:
            return None

        return self._build_child_memory_proposal_payload(row)

    def list_child_memory_proposals(
        self,
        child_id: str,
        status: Optional[str] = None,
        category: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        query = [
            """
            SELECT
                id,
                child_id,
                category,
                memory_type,
                status,
                statement,
                detail_json,
                confidence,
                provenance_json,
                author_type,
                author_user_id,
                reviewer_user_id,
                review_note,
                approved_item_id,
                created_at,
                updated_at,
                reviewed_at
            FROM child_memory_proposals
            WHERE child_id = ?
            """
        ]
        parameters: List[Any] = [child_id]
        if status:
            query.append("AND status = ?")
            parameters.append(status)
        if category:
            query.append("AND category = ?")
            parameters.append(category)
        query.append("ORDER BY updated_at DESC, created_at DESC")

        with self._connect() as connection:
            rows = connection.execute("\n".join(query), parameters).fetchall()

        return [self._build_child_memory_proposal_payload(row) for row in rows]

    def review_child_memory_proposal(
        self,
        proposal_id: str,
        status: str,
        reviewer_user_id: Optional[str] = None,
        review_note: Optional[str] = None,
        approved_item_id: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        reviewed_at = self._utc_now()

        def persist_review(connection: sqlite3.Connection) -> int:
            cursor = connection.execute(
                """
                UPDATE child_memory_proposals
                SET status = ?, reviewer_user_id = ?, review_note = ?, approved_item_id = ?, updated_at = ?, reviewed_at = ?
                WHERE id = ?
                """,
                (status, reviewer_user_id, review_note, approved_item_id, reviewed_at, reviewed_at, proposal_id),
            )
            return cursor.rowcount

        rowcount = self._execute_write(persist_review)
        if rowcount == 0:
            return None

        return self.get_child_memory_proposal(proposal_id)

    def save_child_memory_evidence_link(self, link_payload: Dict[str, Any]) -> Dict[str, Any]:
        link_id = str(link_payload.get("id") or f"memory-evidence-{uuid4().hex[:12]}")
        child_id = str(link_payload.get("child_id") or "").strip()
        if not child_id:
            raise ValueError("child_id is required")

        def persist_link(connection: sqlite3.Connection) -> None:
            connection.execute(
                """
                INSERT INTO child_memory_evidence_links (
                    id,
                    child_id,
                    subject_type,
                    subject_id,
                    session_id,
                    practice_plan_id,
                    evidence_kind,
                    snippet,
                    metadata_json,
                    created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    child_id = excluded.child_id,
                    subject_type = excluded.subject_type,
                    subject_id = excluded.subject_id,
                    session_id = excluded.session_id,
                    practice_plan_id = excluded.practice_plan_id,
                    evidence_kind = excluded.evidence_kind,
                    snippet = excluded.snippet,
                    metadata_json = excluded.metadata_json
                """,
                (
                    link_id,
                    child_id,
                    str(link_payload.get("subject_type") or "proposal"),
                    str(link_payload.get("subject_id") or "").strip(),
                    link_payload.get("session_id"),
                    link_payload.get("practice_plan_id"),
                    str(link_payload.get("evidence_kind") or "session"),
                    link_payload.get("snippet"),
                    self._dumps_json(link_payload.get("metadata") or {}),
                    str(link_payload.get("created_at") or self._utc_now()),
                ),
            )

        self._execute_write(persist_link)

        links = self.list_child_memory_evidence_links(
            str(link_payload.get("subject_type") or "proposal"),
            str(link_payload.get("subject_id") or "").strip(),
        )
        link = next((item for item in links if item["id"] == link_id), None)
        if link is None:
            raise RuntimeError("Child memory evidence link could not be reloaded after save")
        return link

    def list_child_memory_evidence_links(self, subject_type: str, subject_id: str) -> List[Dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT
                    id,
                    child_id,
                    subject_type,
                    subject_id,
                    session_id,
                    practice_plan_id,
                    evidence_kind,
                    snippet,
                    metadata_json,
                    created_at
                FROM child_memory_evidence_links
                WHERE subject_type = ? AND subject_id = ?
                ORDER BY created_at DESC
                """,
                (subject_type, subject_id),
            ).fetchall()

        return [self._build_child_memory_evidence_link_payload(row) for row in rows]

    def upsert_child_memory_summary(
        self,
        child_id: str,
        summary: Dict[str, Any],
        summary_text: Optional[str] = None,
        source_item_count: int = 0,
        last_compiled_at: Optional[str] = None,
    ) -> Dict[str, Any]:
        if not child_id:
            raise ValueError("child_id is required")

        updated_at = self._utc_now()
        compiled_at = str(last_compiled_at or updated_at)

        def persist_summary(connection: sqlite3.Connection) -> None:
            connection.execute(
                """
                INSERT INTO child_memory_summaries (
                    child_id,
                    summary_json,
                    summary_text,
                    source_item_count,
                    last_compiled_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(child_id) DO UPDATE SET
                    summary_json = excluded.summary_json,
                    summary_text = excluded.summary_text,
                    source_item_count = excluded.source_item_count,
                    last_compiled_at = excluded.last_compiled_at,
                    updated_at = excluded.updated_at
                """,
                (
                    child_id,
                    self._dumps_json(summary),
                    summary_text,
                    int(source_item_count),
                    compiled_at,
                    updated_at,
                ),
            )

        self._execute_write(persist_summary)

        saved_summary = self.get_child_memory_summary(child_id)
        if saved_summary is None:
            raise RuntimeError("Child memory summary could not be reloaded after save")
        return saved_summary

    def get_child_memory_summary(self, child_id: str) -> Optional[Dict[str, Any]]:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT
                    child_id,
                    summary_json,
                    summary_text,
                    source_item_count,
                    last_compiled_at,
                    updated_at
                FROM child_memory_summaries
                WHERE child_id = ?
                """,
                (child_id,),
            ).fetchone()

        if row is None:
            return None

        return self._build_child_memory_summary_payload(row)

    def replace_institutional_memory_insights(
        self,
        insights: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        created_at = self._utc_now()

        def persist_insights(connection: sqlite3.Connection) -> None:
            connection.execute("DELETE FROM institutional_memory_insights")
            for insight in insights:
                connection.execute(
                    """
                    INSERT INTO institutional_memory_insights (
                        id,
                        insight_type,
                        status,
                        target_sound,
                        title,
                        summary,
                        detail_json,
                        provenance_json,
                        source_child_count,
                        source_session_count,
                        source_memory_item_count,
                        created_at,
                        updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        str(insight.get("id") or f"institutional-insight-{uuid4().hex[:12]}"),
                        str(insight.get("insight_type") or "reviewed_pattern"),
                        str(insight.get("status") or "active"),
                        str(insight.get("target_sound") or "").strip() or None,
                        str(insight.get("title") or "").strip(),
                        str(insight.get("summary") or "").strip(),
                        self._dumps_json(insight.get("detail") or {}),
                        self._dumps_json(insight.get("provenance") or {}),
                        int(insight.get("source_child_count") or 0),
                        int(insight.get("source_session_count") or 0),
                        int(insight.get("source_memory_item_count") or 0),
                        str(insight.get("created_at") or created_at),
                        str(insight.get("updated_at") or created_at),
                    ),
                )

        self._execute_write(persist_insights)
        return self.list_institutional_memory_insights()

    def list_institutional_memory_insights(
        self,
        *,
        status: Optional[str] = None,
        insight_type: Optional[str] = None,
        target_sound: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        query = [
            """
            SELECT
                id,
                insight_type,
                status,
                target_sound,
                title,
                summary,
                detail_json,
                provenance_json,
                source_child_count,
                source_session_count,
                source_memory_item_count,
                created_at,
                updated_at
            FROM institutional_memory_insights
            WHERE 1 = 1
            """
        ]
        parameters: List[Any] = []
        if status:
            query.append("AND status = ?")
            parameters.append(status)
        if insight_type:
            query.append("AND insight_type = ?")
            parameters.append(insight_type)
        if target_sound:
            query.append("AND target_sound = ?")
            parameters.append(target_sound)
        query.append("ORDER BY updated_at DESC, created_at DESC, title ASC")

        with self._connect() as connection:
            rows = connection.execute("\n".join(query), parameters).fetchall()

        return [self._build_institutional_memory_insight_payload(row) for row in rows]

    def save_recommendation_log(self, log_payload: Dict[str, Any]) -> Dict[str, Any]:
        log_id = str(log_payload.get("id") or f"recommendation-log-{uuid4().hex[:12]}")
        child_id = str(log_payload.get("child_id") or "").strip()
        if not child_id:
            raise ValueError("child_id is required")

        created_at = str(log_payload.get("created_at") or self._utc_now())

        def persist_log(connection: sqlite3.Connection) -> None:
            connection.execute(
                """
                INSERT INTO recommendation_logs (
                    id,
                    child_id,
                    source_session_id,
                    target_sound,
                    therapist_constraints_json,
                    ranking_context_json,
                    rationale_text,
                    created_by_user_id,
                    candidate_count,
                    top_recommendation_score,
                    created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    child_id = excluded.child_id,
                    source_session_id = excluded.source_session_id,
                    target_sound = excluded.target_sound,
                    therapist_constraints_json = excluded.therapist_constraints_json,
                    ranking_context_json = excluded.ranking_context_json,
                    rationale_text = excluded.rationale_text,
                    created_by_user_id = excluded.created_by_user_id,
                    candidate_count = excluded.candidate_count,
                    top_recommendation_score = excluded.top_recommendation_score
                """,
                (
                    log_id,
                    child_id,
                    log_payload.get("source_session_id"),
                    str(log_payload.get("target_sound") or "").strip(),
                    self._dumps_json(log_payload.get("therapist_constraints") or {}),
                    self._dumps_json(log_payload.get("ranking_context") or {}),
                    str(log_payload.get("rationale") or "").strip(),
                    log_payload.get("created_by_user_id"),
                    int(log_payload.get("candidate_count") or 0),
                    log_payload.get("top_recommendation_score"),
                    created_at,
                ),
            )

        self._execute_write(persist_log)
        saved_log = self.get_recommendation_log(log_id)
        if saved_log is None:
            raise RuntimeError("Recommendation log could not be reloaded after save")
        return saved_log

    def get_recommendation_log(self, recommendation_id: str) -> Optional[Dict[str, Any]]:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT
                    id,
                    child_id,
                    source_session_id,
                    target_sound,
                    therapist_constraints_json,
                    ranking_context_json,
                    rationale_text,
                    created_by_user_id,
                    candidate_count,
                    top_recommendation_score,
                    created_at
                FROM recommendation_logs
                WHERE id = ?
                """,
                (recommendation_id,),
            ).fetchone()

        if row is None:
            return None
        return self._build_recommendation_log_payload(row)

    def list_recommendation_logs_for_child(self, child_id: str, limit: int = 10) -> List[Dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT
                    id,
                    child_id,
                    source_session_id,
                    target_sound,
                    therapist_constraints_json,
                    ranking_context_json,
                    rationale_text,
                    created_by_user_id,
                    candidate_count,
                    top_recommendation_score,
                    created_at
                FROM recommendation_logs
                WHERE child_id = ?
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (child_id, max(1, int(limit))),
            ).fetchall()

        return [self._build_recommendation_log_payload(row) for row in rows]

    def replace_recommendation_candidates(
        self,
        recommendation_log_id: str,
        candidates: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        parent_log = self.get_recommendation_log(recommendation_log_id)
        if parent_log is None:
            raise ValueError("Recommendation log not found")

        created_at = self._utc_now()

        def persist_candidates(connection: sqlite3.Connection) -> None:
            connection.execute(
                "DELETE FROM recommendation_candidates WHERE recommendation_log_id = ?",
                (recommendation_log_id,),
            )
            for index, candidate in enumerate(candidates, start=1):
                connection.execute(
                    """
                    INSERT INTO recommendation_candidates (
                        id,
                        recommendation_log_id,
                        rank,
                        exercise_id,
                        exercise_name,
                        exercise_description,
                        exercise_metadata_json,
                        score,
                        ranking_factors_json,
                        rationale_text,
                        explanation_json,
                        supporting_memory_item_ids_json,
                        supporting_session_ids_json,
                        created_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        str(candidate.get("id") or f"recommendation-candidate-{uuid4().hex[:12]}"),
                        recommendation_log_id,
                        int(candidate.get("rank") or index),
                        str(candidate.get("exercise_id") or ""),
                        str(candidate.get("exercise_name") or "Guided practice"),
                        candidate.get("exercise_description"),
                        self._dumps_json(candidate.get("exercise_metadata") or {}),
                        float(candidate.get("score") or 0),
                        self._dumps_json(candidate.get("ranking_factors") or {}),
                        str(candidate.get("rationale") or "").strip(),
                        self._dumps_json(candidate.get("explanation") or {}),
                        self._dumps_json(candidate.get("supporting_memory_item_ids") or []),
                        self._dumps_json(candidate.get("supporting_session_ids") or []),
                        str(candidate.get("created_at") or created_at),
                    ),
                )

        self._execute_write(persist_candidates)
        return self.list_recommendation_candidates(recommendation_log_id, child_id=str(parent_log.get("child_id") or ""))

    def list_recommendation_candidates(
        self,
        recommendation_log_id: str,
        child_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        resolved_child_id = child_id
        if resolved_child_id is None:
            parent_log = self.get_recommendation_log(recommendation_log_id)
            resolved_child_id = None if parent_log is None else str(parent_log.get("child_id") or "")

        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT
                    id,
                    recommendation_log_id,
                    rank,
                    exercise_id,
                    exercise_name,
                    exercise_description,
                    exercise_metadata_json,
                    score,
                    ranking_factors_json,
                    rationale_text,
                    explanation_json,
                    supporting_memory_item_ids_json,
                    supporting_session_ids_json,
                    created_at
                FROM recommendation_candidates
                WHERE recommendation_log_id = ?
                ORDER BY rank ASC, score DESC, exercise_name COLLATE NOCASE ASC
                """,
                (recommendation_log_id,),
            ).fetchall()

        return [
            self._build_recommendation_candidate_payload(row, child_id=resolved_child_id)
            for row in rows
        ]