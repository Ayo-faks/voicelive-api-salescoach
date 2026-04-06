"""PostgreSQL-backed persistence for Wulo pilot session review."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, TypeVar
from uuid import uuid4

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

logger = logging.getLogger(__name__)

DEFAULT_CHILDREN = (
    {"id": "child-ayo", "name": "Ayo"},
    {"id": "child-noah", "name": "Noah"},
    {"id": "child-zuri", "name": "Zuri"},
)
WriteResult = TypeVar("WriteResult")


class PostgresStorageService:
    """Persist child, exercise, and session records in PostgreSQL."""

    def __init__(self, database_url: str):
        self.database_url = database_url
        logger.info("PostgresStorageService init")
        self._seed_children()
        logger.info("PostgresStorageService init complete")

    def _connect(self) -> psycopg.Connection[Any]:
        return psycopg.connect(self.database_url, row_factory=dict_row)

    def _utc_now(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def _loads_json(self, value: Any, fallback: Any) -> Any:
        if value is None or value == "":
            return fallback
        if isinstance(value, (dict, list)):
            return value
        try:
            return json.loads(str(value))
        except json.JSONDecodeError:
            return fallback

    def _dumps_json(self, value: Any) -> Jsonb:
        return Jsonb(value if value is not None else {})

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

    def _build_practice_plan_payload(self, row: Dict[str, Any]) -> Dict[str, Any]:
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

    def _execute_write(self, operation: Callable[[psycopg.Connection[Any]], WriteResult]) -> WriteResult:
        with self._connect() as connection:
            return operation(connection)

    def _seed_children(self) -> None:
        with self._connect() as connection:
            existing_count = connection.execute("SELECT COUNT(*) AS count FROM children").fetchone()["count"]
            if existing_count:
                return

            now = self._utc_now()
            with connection.cursor() as cursor:
                cursor.executemany(
                    "INSERT INTO children (id, name, created_at) VALUES (%s, %s, %s)",
                    [(child["id"], child["name"], now) for child in DEFAULT_CHILDREN],
                )

    def _set_setting(self, key: str, value: Optional[str]) -> None:
        def persist_setting(connection: psycopg.Connection[Any]) -> None:
            connection.execute(
                """
                INSERT INTO app_settings (key, value, updated_at)
                VALUES (%s, %s, %s)
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
                "SELECT value FROM app_settings WHERE key = %s",
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
                "SELECT id, email, name, provider, role, created_at FROM users WHERE id = %s",
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

        def persist_user(connection: psycopg.Connection[Any]) -> Dict[str, Any]:
            existing = connection.execute(
                "SELECT id, email, name, provider, role, created_at FROM users WHERE id = %s",
                (user_id,),
            ).fetchone()

            if existing is not None:
                connection.execute(
                    """
                    UPDATE users
                    SET email = %s, name = %s, provider = %s
                    WHERE id = %s
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

            user_count = connection.execute("SELECT COUNT(*) AS count FROM users").fetchone()["count"]
            role = "therapist" if user_count == 0 else "user"
            connection.execute(
                """
                INSERT INTO users (id, email, name, provider, role, created_at)
                VALUES (%s, %s, %s, %s, %s, %s)
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

        def persist_role(connection: psycopg.Connection[Any]) -> int:
            cursor = connection.execute(
                "UPDATE users SET role = %s WHERE id = %s",
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

    def upsert_child(self, child_id: str, child_name: str) -> None:
        def persist_child(connection: psycopg.Connection[Any]) -> None:
            connection.execute(
                """
                INSERT INTO children (id, name, created_at)
                VALUES (%s, %s, %s)
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
    ) -> None:
        def persist_exercise(connection: psycopg.Connection[Any]) -> None:
            connection.execute(
                """
                INSERT INTO exercises (id, name, description, metadata_json, is_custom, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s)
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
                    bool(is_custom),
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
                ORDER BY LOWER(children.name) ASC
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

        def persist_session(connection: psycopg.Connection[Any]) -> None:
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
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
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
                WHERE sessions.child_id = %s
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
                WHERE sessions.id = %s
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

        def persist_feedback(connection: psycopg.Connection[Any]) -> int:
            cursor = connection.execute(
                """
                UPDATE sessions
                SET feedback_rating = %s, feedback_note = %s, feedback_submitted_at = %s
                WHERE id = %s
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

        def persist_plan(connection: psycopg.Connection[Any]) -> None:
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
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
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
                WHERE child_id = %s
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
                WHERE id = %s
                """,
                (plan_id,),
            ).fetchone()

        if row is None:
            return None

        return self._build_practice_plan_payload(row)

    def approve_practice_plan(self, plan_id: str) -> Optional[Dict[str, Any]]:
        approved_at = self._utc_now()

        def persist_approval(connection: psycopg.Connection[Any]) -> int:
            cursor = connection.execute(
                """
                UPDATE practice_plans
                SET status = %s, approved_at = %s, updated_at = %s
                WHERE id = %s
                """,
                ("approved", approved_at, approved_at, plan_id),
            )
            return cursor.rowcount

        rowcount = self._execute_write(persist_approval)
        if rowcount == 0:
            return None

        return self.get_practice_plan(plan_id)