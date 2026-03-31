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