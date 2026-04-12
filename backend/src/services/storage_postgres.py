"""PostgreSQL-backed persistence for Wulo pilot session review."""

from __future__ import annotations

import json
import logging
from contextvars import ContextVar
from datetime import datetime, timedelta, timezone
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
ROLE_THERAPIST = "therapist"
ROLE_PARENT = "parent"
ROLE_ADMIN = "admin"
ROLE_PENDING_THERAPIST = "pending_therapist"
LEGACY_ROLE_USER = "user"
CHILD_RELATIONSHIP_THERAPIST = "therapist"
CHILD_RELATIONSHIP_PARENT = "parent"
MEMORY_DETAIL_FALLBACK: Dict[str, Any] = {}
MEMORY_PROVENANCE_FALLBACK: Dict[str, Any] = {}
WriteResult = TypeVar("WriteResult")
REQUEST_USER_ID: ContextVar[Optional[str]] = ContextVar("postgres_request_user_id", default=None)
REQUEST_USER_ROLE: ContextVar[Optional[str]] = ContextVar("postgres_request_user_role", default=None)
REQUEST_USER_EMAIL: ContextVar[Optional[str]] = ContextVar("postgres_request_user_email", default=None)
INVITATION_EXPIRATION_DAYS = 7
WORKSPACE_ROLE_OWNER = "owner"
WORKSPACE_ROLE_ADMIN = "admin"
WORKSPACE_ROLE_THERAPIST = "therapist"
WORKSPACE_ROLE_PARENT = "parent"


class PostgresStorageService:
    """Persist child, exercise, and session records in PostgreSQL."""

    def __init__(self, database_url: str, allow_system_bypass: bool = True):
        self.database_url = database_url
        self.allow_system_bypass = allow_system_bypass
        logger.info("PostgresStorageService init")
        logger.info("PostgresStorageService init complete")

    def _connect(self) -> psycopg.Connection[Any]:
        connection = psycopg.connect(self.database_url, row_factory=dict_row)
        current_user_id = REQUEST_USER_ID.get()
        current_user_role = REQUEST_USER_ROLE.get()
        current_user_email = REQUEST_USER_EMAIL.get()
        system_bypass = "on" if current_user_id is None and self.allow_system_bypass else "off"
        connection.execute(
            """
            SELECT
                set_config('app.current_user_id', %s, false),
                set_config('app.current_user_role', %s, false),
                set_config('app.current_user_email', %s, false),
                set_config('app.system_bypass_rls', %s, false)
            """,
            (
                current_user_id or "",
                current_user_role or "",
                current_user_email or "",
                system_bypass,
            ),
        )
        return connection

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

    def set_request_actor(self, user_id: Optional[str], role: Optional[str], email: Optional[str]) -> None:
        REQUEST_USER_ID.set(str(user_id).strip() or None if user_id is not None else None)
        REQUEST_USER_ROLE.set(str(role).strip().lower() or None if role is not None else None)
        REQUEST_USER_EMAIL.set(str(email).strip().lower() or None if email is not None else None)

    def clear_request_actor(self) -> None:
        REQUEST_USER_ID.set(None)
        REQUEST_USER_ROLE.set(None)
        REQUEST_USER_EMAIL.set(None)

    def _normalize_workspace_member_role(self, role: Any) -> str:
        normalized = str(role or "").strip().lower()
        if normalized in {
            WORKSPACE_ROLE_OWNER,
            WORKSPACE_ROLE_ADMIN,
            WORKSPACE_ROLE_THERAPIST,
            WORKSPACE_ROLE_PARENT,
        }:
            return normalized
        return WORKSPACE_ROLE_PARENT

    def _default_workspace_name(self, display_name: str, email: str) -> str:
        candidate = str(display_name or "").strip() or str(email or "").split("@")[0].strip()
        if not candidate:
            candidate = "Therapist"
        return f"{candidate} Workspace"

    def _build_workspace_payload(self, row: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": row["id"],
            "name": row["name"],
            "owner_user_id": row["owner_user_id"],
            "role": self._normalize_workspace_member_role(row["member_role"]),
            "is_personal": bool(row["is_personal"]),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    def _ensure_personal_workspace_for_user(
        self,
        connection: psycopg.Connection[Any],
        user_id: str,
        display_name: str,
        email: str,
    ) -> None:
        existing = connection.execute(
            """
            SELECT therapist_workspaces.id
            FROM therapist_workspaces
            INNER JOIN workspace_members ON workspace_members.workspace_id = therapist_workspaces.id
            WHERE therapist_workspaces.owner_user_id = %s
              AND therapist_workspaces.is_personal = true
              AND workspace_members.user_id = %s
            LIMIT 1
            """,
            (user_id, user_id),
        ).fetchone()
        if existing is not None:
            # Backfill any children that still have no workspace assigned
            connection.execute(
                """
                UPDATE children SET workspace_id = %s
                WHERE id IN (SELECT child_id FROM user_children WHERE user_id = %s)
                  AND workspace_id IS NULL
                """,
                (existing["id"], user_id),
            )
            return

        now = self._utc_now()
        workspace_id = f"workspace-{uuid4().hex[:12]}"
        workspace_name = self._default_workspace_name(display_name, email)
        connection.execute(
            """
            INSERT INTO therapist_workspaces (id, name, owner_user_id, is_personal, created_at, updated_at)
            VALUES (%s, %s, %s, true, %s, %s)
            """,
            (workspace_id, workspace_name, user_id, now, now),
        )
        connection.execute(
            """
            INSERT INTO workspace_members (workspace_id, user_id, role, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT(workspace_id, user_id) DO UPDATE SET
                role = EXCLUDED.role,
                updated_at = EXCLUDED.updated_at
            """,
            (workspace_id, user_id, WORKSPACE_ROLE_OWNER, now, now),
        )

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

    def _build_invitation_email_delivery_payload(self, row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if row.get("email_delivery_status") is None:
          return None

        return {
            "status": row["email_delivery_status"],
            "attempted": bool(row.get("email_delivery_attempted")),
            "delivered": bool(row.get("email_delivery_delivered")),
            "provider_message_id": row.get("email_delivery_provider_message_id"),
            "error": row.get("email_delivery_error"),
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

    def _build_child_memory_item_payload(self, row: Dict[str, Any]) -> Dict[str, Any]:
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

    def _build_child_memory_proposal_payload(self, row: Dict[str, Any]) -> Dict[str, Any]:
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

    def _build_child_memory_evidence_link_payload(self, row: Dict[str, Any]) -> Dict[str, Any]:
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

    def _build_child_memory_summary_payload(self, row: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "child_id": row["child_id"],
            "summary": self._loads_json(row["summary_json"], MEMORY_DETAIL_FALLBACK),
            "summary_text": row["summary_text"],
            "source_item_count": row["source_item_count"],
            "last_compiled_at": row["last_compiled_at"],
            "updated_at": row["updated_at"],
        }

    def _build_institutional_memory_insight_payload(self, row: Dict[str, Any]) -> Dict[str, Any]:
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

    def _build_recommendation_log_payload(self, row: Dict[str, Any]) -> Dict[str, Any]:
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

    def _build_recommendation_candidate_payload(self, row: Dict[str, Any], *, child_id: Optional[str] = None) -> Dict[str, Any]:
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

    def _build_child_invitation_payload(self, row: Dict[str, Any], *, current_email: Optional[str] = None) -> Dict[str, Any]:
        invited_email = str(row["invited_email"] or "")
        normalized_current_email = str(current_email or "").strip().lower()
        direction = "sent"
        if normalized_current_email and invited_email.lower() == normalized_current_email:
            direction = "incoming"

        payload = {
            "id": row["id"],
            "child_id": row["child_id"],
            "child_name": row["child_name"],
            "invited_email": invited_email,
            "relationship": row["relationship"],
            "status": row["status"],
            "invited_by_user_id": row["invited_by_user_id"],
            "invited_by_name": row["invited_by_name"],
            "accepted_by_user_id": row["accepted_by_user_id"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "responded_at": row["responded_at"],
            "expires_at": row["expires_at"],
            "workspace_id": row.get("workspace_id"),
            "direction": direction,
        }

        email_delivery = self._build_invitation_email_delivery_payload(row)
        if email_delivery is not None:
            payload["email_delivery"] = email_delivery

        return payload

    def _invitation_expiry_timestamp(self, source_timestamp: Optional[str] = None) -> str:
        if source_timestamp:
            try:
                normalized = source_timestamp[:-1] + "+00:00" if source_timestamp.endswith("Z") else source_timestamp
                return (datetime.fromisoformat(normalized) + timedelta(days=INVITATION_EXPIRATION_DAYS)).isoformat()
            except ValueError:
                pass
        return (datetime.now(timezone.utc) + timedelta(days=INVITATION_EXPIRATION_DAYS)).isoformat()

    def _expire_stale_child_invitations(self) -> None:
        now = self._utc_now()

        def persist_expiry(connection: psycopg.Connection[Any]) -> None:
            connection.execute(
                """
                UPDATE child_invitations
                SET status = 'expired', updated_at = %s, responded_at = COALESCE(responded_at, %s)
                WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < %s
                """,
                (now, now, now),
            )

        self._execute_write(persist_expiry)

    def _execute_write(self, operation: Callable[[psycopg.Connection[Any]], WriteResult]) -> WriteResult:
        with self._connect() as connection:
            return operation(connection)

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

    def _normalize_user_role(self, role: Any) -> str:
        normalized = str(role or "").strip().lower()
        if normalized == LEGACY_ROLE_USER:
            return ROLE_PARENT
        if normalized in {ROLE_THERAPIST, ROLE_PARENT, ROLE_ADMIN, ROLE_PENDING_THERAPIST}:
            return normalized
        return ROLE_PARENT

    def _bootstrap_existing_children_for_user(
        self,
        connection: psycopg.Connection[Any],
        user_id: str,
        relationship: str,
    ) -> None:
        existing_child_ids = connection.execute(
            "SELECT id FROM children WHERE deleted_at IS NULL ORDER BY created_at ASC"
        ).fetchall()
        now = self._utc_now()
        for row in existing_child_ids:
            connection.execute(
                """
                INSERT INTO user_children (user_id, child_id, relationship, created_at)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT(user_id, child_id) DO UPDATE SET relationship = excluded.relationship
                """,
                (user_id, row["id"], relationship, now),
            )

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
            "role": self._normalize_user_role(row["role"]),
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
                normalized_role = self._normalize_user_role(existing["role"])
                if normalized_role in {ROLE_THERAPIST, ROLE_ADMIN}:
                    self._ensure_personal_workspace_for_user(connection, user_id, name, email)
                return {
                    "id": existing["id"],
                    "email": email,
                    "name": name,
                    "provider": provider,
                    "role": existing["role"],
                    "created_at": existing["created_at"],
                }

            # If there is a pending invitation for this email, assign parent role.
            # Otherwise, assign pending_therapist until they redeem an invite code.
            has_pending_invitation = connection.execute(
                "SELECT 1 FROM child_invitations WHERE LOWER(invited_email) = LOWER(%s) AND status = 'pending' LIMIT 1",
                (email,),
            ).fetchone() is not None
            role = ROLE_PARENT if has_pending_invitation else ROLE_PENDING_THERAPIST
            connection.execute(
                """
                INSERT INTO users (id, email, name, provider, role, created_at)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (user_id, email, name, provider, role, now),
            )
            if role == ROLE_THERAPIST:
                self._ensure_personal_workspace_for_user(connection, user_id, name, email)
                self._bootstrap_existing_children_for_user(connection, user_id, CHILD_RELATIONSHIP_THERAPIST)
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
        normalized_role = self._normalize_user_role(role)
        if normalized_role not in {ROLE_THERAPIST, ROLE_PARENT, ROLE_ADMIN}:
            raise ValueError("Unsupported role")

        def persist_role(connection: psycopg.Connection[Any]) -> int:
            existing = connection.execute(
                "SELECT id, email, name FROM users WHERE id = %s",
                (user_id,),
            ).fetchone()
            if existing is None:
                return 0

            cursor = connection.execute(
                "UPDATE users SET role = %s WHERE id = %s",
                (normalized_role, user_id),
            )
            if cursor.rowcount > 0 and normalized_role in {ROLE_THERAPIST, ROLE_ADMIN}:
                self._ensure_personal_workspace_for_user(
                    connection,
                    user_id,
                    str(existing["name"] or ""),
                    str(existing["email"] or ""),
                )
            if cursor.rowcount > 0 and normalized_role == ROLE_THERAPIST:
                self._bootstrap_existing_children_for_user(connection, user_id, CHILD_RELATIONSHIP_THERAPIST)
            return cursor.rowcount

        rowcount = self._execute_write(persist_role)
        if rowcount == 0:
            return None

        return self.get_user(user_id)

    def create_invite_code(self, code: str, created_by: str) -> Dict[str, Any]:
        now = self._utc_now()
        invite_id = str(uuid4())

        def persist(connection: psycopg.Connection[Any]) -> Dict[str, Any]:
            connection.execute(
                "INSERT INTO therapist_invite_codes (id, code, created_by, created_at) VALUES (%s, %s, %s, %s)",
                (invite_id, code.upper().strip(), created_by, now),
            )
            return {"id": invite_id, "code": code.upper().strip(), "created_by": created_by, "created_at": now}

        return self._execute_write(persist)

    def claim_invite_code(self, code: str, user_id: str) -> bool:
        """Claim an invite code and upgrade user to therapist. Returns True on success."""
        now = self._utc_now()

        def persist(connection: psycopg.Connection[Any]) -> bool:
            row = connection.execute(
                "SELECT id FROM therapist_invite_codes WHERE UPPER(code) = UPPER(%s) AND used_by IS NULL",
                (code.strip(),),
            ).fetchone()
            if row is None:
                return False
            connection.execute(
                "UPDATE therapist_invite_codes SET used_by = %s, used_at = %s WHERE id = %s",
                (user_id, now, row["id"]),
            )
            user = connection.execute("SELECT name, email FROM users WHERE id = %s", (user_id,)).fetchone()
            connection.execute("UPDATE users SET role = %s WHERE id = %s", (ROLE_THERAPIST, user_id))
            if user is not None:
                self._ensure_personal_workspace_for_user(connection, user_id, str(user["name"] or ""), str(user["email"] or ""))
                self._bootstrap_existing_children_for_user(connection, user_id, CHILD_RELATIONSHIP_THERAPIST)
            return True

        return self._execute_write(persist)

    def list_invite_codes(self, created_by: str) -> List[Dict[str, Any]]:
        def query(connection: psycopg.Connection[Any]) -> List[Dict[str, Any]]:
            rows = connection.execute(
                "SELECT id, code, created_by, used_by, used_at, created_at FROM therapist_invite_codes WHERE created_by = %s ORDER BY created_at DESC",
                (created_by,),
            ).fetchall()
            return [dict(r) for r in rows]

        return self._execute_read(query)

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

    def assign_child_to_user(self, user_id: str, child_id: str, relationship: str) -> None:
        normalized_relationship = str(relationship or "").strip().lower()
        if normalized_relationship not in {CHILD_RELATIONSHIP_PARENT, CHILD_RELATIONSHIP_THERAPIST}:
            raise ValueError("Unsupported child relationship")

        def persist_assignment(connection: psycopg.Connection[Any]) -> None:
            connection.execute(
                """
                INSERT INTO user_children (user_id, child_id, relationship, created_at)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT(user_id, child_id) DO UPDATE SET relationship = excluded.relationship
                """,
                (user_id, child_id, normalized_relationship, self._utc_now()),
            )

        self._execute_write(persist_assignment)

    def create_child(
        self,
        *,
        name: str,
        created_by_user_id: str,
        relationship: str,
        date_of_birth: Optional[str] = None,
        notes: Optional[str] = None,
        child_id: Optional[str] = None,
        workspace_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        normalized_name = str(name or "").strip()
        if not normalized_name:
            raise ValueError("name is required")

        created_child_id = str(child_id or f"child-{uuid4().hex[:12]}")
        created_at = self._utc_now()

        def persist_child(connection: psycopg.Connection[Any]) -> None:
            resolved_workspace_id = workspace_id
            if resolved_workspace_id is None:
                ws_row = connection.execute(
                    """
                    SELECT therapist_workspaces.id
                    FROM workspace_members
                    INNER JOIN therapist_workspaces ON therapist_workspaces.id = workspace_members.workspace_id
                    WHERE workspace_members.user_id = %s
                    ORDER BY
                        CASE workspace_members.role
                            WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'therapist' THEN 2 ELSE 3
                        END,
                        therapist_workspaces.created_at ASC
                    LIMIT 1
                    """,
                    (created_by_user_id,),
                ).fetchone()
                if ws_row is not None:
                    resolved_workspace_id = str(ws_row["id"])

            if resolved_workspace_id is not None:
                membership = connection.execute(
                    "SELECT 1 FROM workspace_members WHERE workspace_id = %s AND user_id = %s",
                    (resolved_workspace_id, created_by_user_id),
                ).fetchone()
                if membership is None:
                    raise ValueError("User is not a member of the specified workspace")

            connection.execute(
                """
                INSERT INTO children (id, name, date_of_birth, notes, deleted_at, created_at, workspace_id)
                VALUES (%s, %s, %s, %s, NULL, %s, %s)
                """,
                (created_child_id, normalized_name, date_of_birth, notes, created_at, resolved_workspace_id),
            )
            connection.execute(
                """
                INSERT INTO user_children (user_id, child_id, relationship, created_at)
                VALUES (%s, %s, %s, %s)
                """,
                (created_by_user_id, created_child_id, relationship, created_at),
            )

        self._execute_write(persist_child)
        child = self.get_child(created_child_id)
        if child is None:
            raise RuntimeError("Child could not be reloaded after creation")
        return child

    def get_child(self, child_id: str, include_deleted: bool = False) -> Optional[Dict[str, Any]]:
        query = [
            """
            SELECT
                children.id,
                children.name,
                children.date_of_birth,
                children.notes,
                children.deleted_at,
                children.created_at,
                children.workspace_id,
                COUNT(sessions.id) AS session_count,
                MAX(sessions.timestamp) AS last_session_at
            FROM children
            LEFT JOIN sessions ON sessions.child_id = children.id
            WHERE children.id = %s
            """
        ]
        parameters: List[Any] = [child_id]
        if not include_deleted:
            query.append("AND children.deleted_at IS NULL")
        query.append(
            "GROUP BY children.id, children.name, children.date_of_birth, children.notes, children.deleted_at, children.created_at, children.workspace_id"
        )

        with self._connect() as connection:
            row = connection.execute("\n".join(query), parameters).fetchone()

        if row is None:
            return None

        return {
            "id": row["id"],
            "name": row["name"],
            "date_of_birth": row["date_of_birth"],
            "notes": row["notes"],
            "deleted_at": row["deleted_at"],
            "created_at": row["created_at"],
            "workspace_id": row["workspace_id"],
            "session_count": row["session_count"],
            "last_session_at": row["last_session_at"],
        }

    def list_children_for_user(
        self, user_id: str, include_deleted: bool = False, workspace_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        user = self.get_user(user_id)
        if user is not None and user.get("role") == ROLE_ADMIN and workspace_id is None:
            return self.list_children(include_deleted=include_deleted)

        query = [
            """
            SELECT
                children.id,
                children.name,
                children.date_of_birth,
                children.notes,
                children.deleted_at,
                children.created_at,
                children.workspace_id,
                COUNT(sessions.id) AS session_count,
                MAX(sessions.timestamp) AS last_session_at
            FROM children
            INNER JOIN user_children ON user_children.child_id = children.id
            LEFT JOIN sessions ON sessions.child_id = children.id
            WHERE user_children.user_id = %s
            """
        ]
        parameters: List[Any] = [user_id]
        if workspace_id is not None:
            query.append("AND children.workspace_id = %s")
            parameters.append(workspace_id)
        if not include_deleted:
            query.append("AND children.deleted_at IS NULL")
        query.append(
            "GROUP BY children.id, children.name, children.date_of_birth, children.notes, children.deleted_at, children.created_at, children.workspace_id"
        )
        query.append("ORDER BY LOWER(children.name) ASC")

        with self._connect() as connection:
            rows = connection.execute("\n".join(query), parameters).fetchall()

        return [
            {
                "id": row["id"],
                "name": row["name"],
                "date_of_birth": row["date_of_birth"],
                "notes": row["notes"],
                "deleted_at": row["deleted_at"],
                "created_at": row["created_at"],
                "workspace_id": row["workspace_id"],
                "session_count": row["session_count"],
                "last_session_at": row["last_session_at"],
            }
            for row in rows
        ]

    def user_has_child_access(
        self,
        user_id: str,
        child_id: str,
        *,
        allowed_relationships: Optional[List[str]] = None,
        include_deleted: bool = False,
    ) -> bool:
        user = self.get_user(user_id)
        if user is not None and user.get("role") == ROLE_ADMIN:
            return self.get_child(child_id, include_deleted=include_deleted) is not None

        with self._connect() as connection:
            child_row = connection.execute(
                "SELECT workspace_id FROM children WHERE id = %s",
                (child_id,),
            ).fetchone()
            if child_row is None:
                return False

            child_workspace_id = child_row["workspace_id"]

            if child_workspace_id is not None:
                ws_member = connection.execute(
                    "SELECT 1 FROM workspace_members WHERE workspace_id = %s AND user_id = %s",
                    (child_workspace_id, user_id),
                ).fetchone()
                if ws_member is None:
                    return False

            query = [
                """
                SELECT 1
                FROM user_children
                INNER JOIN children ON children.id = user_children.child_id
                WHERE user_children.user_id = %s AND user_children.child_id = %s
                """
            ]
            parameters: List[Any] = [user_id, child_id]
            if not include_deleted:
                query.append("AND children.deleted_at IS NULL")
            if allowed_relationships:
                placeholders = ", ".join(["%s"] * len(allowed_relationships))
                query.append(f"AND user_children.relationship IN ({placeholders})")
                parameters.extend(allowed_relationships)

            row = connection.execute("\n".join(query), parameters).fetchone()
        return row is not None

    def get_child_relationship(self, user_id: str, child_id: str) -> Optional[str]:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT relationship FROM user_children WHERE user_id = %s AND child_id = %s",
                (user_id, child_id),
            ).fetchone()
        return None if row is None else str(row["relationship"])

    def list_workspaces_for_user(self, user_id: str) -> List[Dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT
                    therapist_workspaces.id,
                    therapist_workspaces.name,
                    therapist_workspaces.owner_user_id,
                    therapist_workspaces.is_personal,
                    therapist_workspaces.created_at,
                    therapist_workspaces.updated_at,
                    workspace_members.role AS member_role
                FROM workspace_members
                INNER JOIN therapist_workspaces ON therapist_workspaces.id = workspace_members.workspace_id
                WHERE workspace_members.user_id = %s
                ORDER BY therapist_workspaces.is_personal DESC, LOWER(therapist_workspaces.name) ASC
                """,
                (user_id,),
            ).fetchall()
        return [self._build_workspace_payload(row) for row in rows]

    def get_default_workspace_for_user(self, user_id: str) -> Optional[Dict[str, Any]]:
        workspaces = self.list_workspaces_for_user(user_id)
        if not workspaces:
            return None
        personal_workspace = next((workspace for workspace in workspaces if workspace.get("is_personal")), None)
        return personal_workspace or workspaces[0]

    def create_workspace(self, user_id: str, name: Optional[str] = None) -> Dict[str, Any]:
        def persist_workspace(connection: psycopg.Connection[Any]) -> Dict[str, Any]:
            user = connection.execute(
                "SELECT id, email, name, role FROM users WHERE id = %s",
                (user_id,),
            ).fetchone()
            if user is None:
                raise ValueError("User not found")

            normalized_name = str(name or "").strip() or self._default_workspace_name(
                str(user["name"] or ""),
                str(user["email"] or ""),
            )
            now = self._utc_now()

            if self._normalize_user_role(user["role"]) not in {ROLE_THERAPIST, ROLE_ADMIN}:
                raise ValueError("Therapist role required to create a workspace")

            workspace_id = f"workspace-{uuid4().hex[:12]}"
            connection.execute(
                """
                INSERT INTO therapist_workspaces (id, name, owner_user_id, is_personal, created_at, updated_at)
                VALUES (%s, %s, %s, false, %s, %s)
                """,
                (workspace_id, normalized_name, user_id, now, now),
            )
            connection.execute(
                """
                INSERT INTO workspace_members (workspace_id, user_id, role, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (workspace_id, user_id, WORKSPACE_ROLE_OWNER, now, now),
            )

            row = connection.execute(
                """
                SELECT
                    therapist_workspaces.id,
                    therapist_workspaces.name,
                    therapist_workspaces.owner_user_id,
                    therapist_workspaces.is_personal,
                    therapist_workspaces.created_at,
                    therapist_workspaces.updated_at,
                    workspace_members.role AS member_role
                FROM therapist_workspaces
                INNER JOIN workspace_members ON workspace_members.workspace_id = therapist_workspaces.id
                WHERE therapist_workspaces.id = %s AND workspace_members.user_id = %s
                """,
                (workspace_id, user_id),
            ).fetchone()
            if row is None:
                raise RuntimeError("Workspace could not be reloaded after creation")
            return self._build_workspace_payload(row)

        return self._execute_write(persist_workspace)

    def soft_delete_child(self, child_id: str) -> Optional[Dict[str, Any]]:
        deleted_at = self._utc_now()

        def persist_delete(connection: psycopg.Connection[Any]) -> int:
            cursor = connection.execute(
                "UPDATE children SET deleted_at = %s WHERE id = %s AND deleted_at IS NULL",
                (deleted_at, child_id),
            )
            return cursor.rowcount

        rowcount = self._execute_write(persist_delete)
        if rowcount == 0:
            return None
        return self.get_child(child_id, include_deleted=True)

    def log_audit_event(
        self,
        *,
        user_id: Optional[str],
        action: str,
        resource_type: str,
        resource_id: str,
        child_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        event_id = f"audit-{uuid4().hex[:12]}"
        created_at = self._utc_now()

        def persist_event(connection: psycopg.Connection[Any]) -> None:
            connection.execute(
                """
                INSERT INTO audit_log (
                    id,
                    user_id,
                    action,
                    resource_type,
                    resource_id,
                    child_id,
                    metadata_json,
                    created_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    event_id,
                    user_id,
                    action,
                    resource_type,
                    resource_id,
                    child_id,
                    self._dumps_json(metadata or {}),
                    created_at,
                ),
            )

        self._execute_write(persist_event)
        return {
            "id": event_id,
            "user_id": user_id,
            "action": action,
            "resource_type": resource_type,
            "resource_id": resource_id,
            "child_id": child_id,
            "metadata": metadata or {},
            "created_at": created_at,
        }

    def create_child_invitation(
        self,
        *,
        child_id: str,
        invited_email: str,
        relationship: str,
        invited_by_user_id: str,
    ) -> Dict[str, Any]:
        normalized_email = str(invited_email or "").strip().lower()
        normalized_relationship = str(relationship or "").strip().lower()
        if not normalized_email:
            raise ValueError("invited_email is required")
        if normalized_relationship not in {CHILD_RELATIONSHIP_PARENT, CHILD_RELATIONSHIP_THERAPIST}:
            raise ValueError("Unsupported child relationship")

        invitation_id = f"invite-{uuid4().hex[:12]}"
        created_at = self._utc_now()
        expires_at = self._invitation_expiry_timestamp(created_at)

        reused_invitation_id: Optional[str] = None

        def persist_invitation(connection: psycopg.Connection[Any]) -> None:
            nonlocal reused_invitation_id

            # Resolve workspace_id from the child
            child_row = connection.execute(
                "SELECT workspace_id FROM children WHERE id = %s", (child_id,),
            ).fetchone()
            resolved_workspace_id = child_row["workspace_id"] if child_row is not None else None

            connection.execute(
                """
                UPDATE child_invitations
                SET status = 'expired', updated_at = %s, responded_at = COALESCE(responded_at, %s)
                WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < %s
                """,
                (created_at, created_at, created_at),
            )
            existing = connection.execute(
                """
                SELECT id
                FROM child_invitations
                WHERE child_id = %s AND LOWER(invited_email) = %s AND relationship = %s AND status = 'pending'
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (child_id, normalized_email, normalized_relationship),
            ).fetchone()
            if existing is not None:
                reused_invitation_id = str(existing["id"])
                connection.execute(
                    """
                    UPDATE child_invitations
                    SET updated_at = %s, responded_at = NULL, expires_at = %s, workspace_id = %s
                    WHERE id = %s
                    """,
                    (created_at, expires_at, resolved_workspace_id, reused_invitation_id),
                )
                return

            connection.execute(
                """
                INSERT INTO child_invitations (
                    id,
                    child_id,
                    invited_email,
                    relationship,
                    status,
                    invited_by_user_id,
                    accepted_by_user_id,
                    created_at,
                    updated_at,
                    responded_at,
                    expires_at,
                    workspace_id
                )
                VALUES (%s, %s, %s, %s, 'pending', %s, NULL, %s, %s, NULL, %s, %s)
                """,
                (
                    invitation_id,
                    child_id,
                    normalized_email,
                    normalized_relationship,
                    invited_by_user_id,
                    created_at,
                    created_at,
                    expires_at,
                    resolved_workspace_id,
                ),
            )

        self._execute_write(persist_invitation)
        invitation = self.get_child_invitation(reused_invitation_id or invitation_id)
        if invitation is None:
            raise RuntimeError("Invitation could not be reloaded after creation")
        return invitation

    def get_child_invitation(self, invitation_id: str, *, current_email: Optional[str] = None) -> Optional[Dict[str, Any]]:
        self._expire_stale_child_invitations()
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT
                    child_invitations.id,
                    child_invitations.child_id,
                    children.name AS child_name,
                    child_invitations.invited_email,
                    child_invitations.relationship,
                    child_invitations.status,
                    child_invitations.invited_by_user_id,
                    inviter.name AS invited_by_name,
                    child_invitations.accepted_by_user_id,
                    child_invitations.created_at,
                    child_invitations.updated_at,
                    child_invitations.responded_at,
                    child_invitations.expires_at,
                    child_invitations.workspace_id,
                    (
                        SELECT status
                        FROM child_invitation_email_deliveries
                        WHERE invitation_id = child_invitations.id
                        ORDER BY created_at DESC
                        LIMIT 1
                    ) AS email_delivery_status,
                    (
                        SELECT attempted
                        FROM child_invitation_email_deliveries
                        WHERE invitation_id = child_invitations.id
                        ORDER BY created_at DESC
                        LIMIT 1
                    ) AS email_delivery_attempted,
                    (
                        SELECT delivered
                        FROM child_invitation_email_deliveries
                        WHERE invitation_id = child_invitations.id
                        ORDER BY created_at DESC
                        LIMIT 1
                    ) AS email_delivery_delivered,
                    (
                        SELECT provider_message_id
                        FROM child_invitation_email_deliveries
                        WHERE invitation_id = child_invitations.id
                        ORDER BY created_at DESC
                        LIMIT 1
                    ) AS email_delivery_provider_message_id,
                    (
                        SELECT error
                        FROM child_invitation_email_deliveries
                        WHERE invitation_id = child_invitations.id
                        ORDER BY created_at DESC
                        LIMIT 1
                    ) AS email_delivery_error
                FROM child_invitations
                INNER JOIN children ON children.id = child_invitations.child_id
                INNER JOIN users AS inviter ON inviter.id = child_invitations.invited_by_user_id
                WHERE child_invitations.id = %s
                """,
                (invitation_id,),
            ).fetchone()
        if row is None:
            return None
        return self._build_child_invitation_payload(row, current_email=current_email)

    def list_child_invitations_for_user(self, user_id: str, email: str) -> List[Dict[str, Any]]:
        normalized_email = str(email or "").strip().lower()
        self._expire_stale_child_invitations()
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT
                    child_invitations.id,
                    child_invitations.child_id,
                    children.name AS child_name,
                    child_invitations.invited_email,
                    child_invitations.relationship,
                    child_invitations.status,
                    child_invitations.invited_by_user_id,
                    inviter.name AS invited_by_name,
                    child_invitations.accepted_by_user_id,
                    child_invitations.created_at,
                    child_invitations.updated_at,
                    child_invitations.responded_at,
                    child_invitations.expires_at,
                    child_invitations.workspace_id,
                    (
                        SELECT status
                        FROM child_invitation_email_deliveries
                        WHERE invitation_id = child_invitations.id
                        ORDER BY created_at DESC
                        LIMIT 1
                    ) AS email_delivery_status,
                    (
                        SELECT attempted
                        FROM child_invitation_email_deliveries
                        WHERE invitation_id = child_invitations.id
                        ORDER BY created_at DESC
                        LIMIT 1
                    ) AS email_delivery_attempted,
                    (
                        SELECT delivered
                        FROM child_invitation_email_deliveries
                        WHERE invitation_id = child_invitations.id
                        ORDER BY created_at DESC
                        LIMIT 1
                    ) AS email_delivery_delivered,
                    (
                        SELECT provider_message_id
                        FROM child_invitation_email_deliveries
                        WHERE invitation_id = child_invitations.id
                        ORDER BY created_at DESC
                        LIMIT 1
                    ) AS email_delivery_provider_message_id,
                    (
                        SELECT error
                        FROM child_invitation_email_deliveries
                        WHERE invitation_id = child_invitations.id
                        ORDER BY created_at DESC
                        LIMIT 1
                    ) AS email_delivery_error
                FROM child_invitations
                INNER JOIN children ON children.id = child_invitations.child_id
                INNER JOIN users AS inviter ON inviter.id = child_invitations.invited_by_user_id
                WHERE child_invitations.invited_by_user_id = %s OR LOWER(child_invitations.invited_email) = %s
                ORDER BY child_invitations.updated_at DESC, child_invitations.created_at DESC
                """,
                (user_id, normalized_email),
            ).fetchall()
        return [
            self._build_child_invitation_payload(row, current_email=normalized_email)
            for row in rows
        ]

    def respond_to_child_invitation(
        self,
        invitation_id: str,
        *,
        user_id: str,
        user_email: str,
        accept: bool,
    ) -> Optional[Dict[str, Any]]:
        normalized_email = str(user_email or "").strip().lower()
        response_status = "accepted" if accept else "declined"
        responded_at = self._utc_now()

        def persist_response(connection: psycopg.Connection[Any]) -> Optional[str]:
            row = connection.execute(
                """
                SELECT id, child_id, invited_email, relationship, status, expires_at
                FROM child_invitations
                WHERE id = %s
                """,
                (invitation_id,),
            ).fetchone()
            if row is None:
                return None
            if str(row["status"] or "") == "pending" and row["expires_at"] and str(row["expires_at"]) < responded_at:
                connection.execute(
                    "UPDATE child_invitations SET status = 'expired', updated_at = %s, responded_at = COALESCE(responded_at, %s) WHERE id = %s",
                    (responded_at, responded_at, invitation_id),
                )
                raise ValueError("Invitation has expired")
            if str(row["status"] or "") != "pending":
                raise ValueError("Invitation is no longer pending")
            if str(row["invited_email"] or "").strip().lower() != normalized_email:
                raise ValueError("Invitation email does not match the authenticated user")

            connection.execute(
                """
                UPDATE child_invitations
                SET status = %s, accepted_by_user_id = %s, updated_at = %s, responded_at = %s
                WHERE id = %s AND status = 'pending'
                """,
                (
                    response_status,
                    user_id if accept else None,
                    responded_at,
                    responded_at,
                    invitation_id,
                ),
            )
            if accept:
                connection.execute(
                    """
                    INSERT INTO user_children (user_id, child_id, relationship, created_at)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT(user_id, child_id) DO UPDATE SET relationship = excluded.relationship
                    """,
                    (user_id, row["child_id"], row["relationship"], responded_at),
                )

                # Grant workspace membership if the child belongs to a workspace
                child_ws = connection.execute(
                    "SELECT workspace_id FROM children WHERE id = %s",
                    (row["child_id"],),
                ).fetchone()
                if child_ws is not None and child_ws["workspace_id"] is not None:
                    ws_role = WORKSPACE_ROLE_PARENT if row["relationship"] == CHILD_RELATIONSHIP_PARENT else WORKSPACE_ROLE_THERAPIST
                    connection.execute(
                        """
                        INSERT INTO workspace_members (workspace_id, user_id, role, created_at, updated_at)
                        VALUES (%s, %s, %s, %s, %s)
                        ON CONFLICT(workspace_id, user_id) DO NOTHING
                        """,
                        (child_ws["workspace_id"], user_id, ws_role, responded_at, responded_at),
                    )

                # If user is pending_therapist, downgrade to parent on invitation acceptance
                user_row = connection.execute("SELECT role FROM users WHERE id = %s", (user_id,)).fetchone()
                if user_row is not None and user_row["role"] == ROLE_PENDING_THERAPIST:
                    connection.execute("UPDATE users SET role = %s WHERE id = %s", (ROLE_PARENT, user_id))

            return str(row["child_id"])

        child_id = self._execute_write(persist_response)
        if child_id is None:
            return None
        return self.get_child_invitation(invitation_id, current_email=normalized_email)

    def revoke_child_invitation(self, invitation_id: str) -> Optional[Dict[str, Any]]:
        revoked_at = self._utc_now()

        def persist_revoke(connection: psycopg.Connection[Any]) -> int:
            cursor = connection.execute(
                """
                UPDATE child_invitations
                SET status = 'revoked', updated_at = %s, responded_at = %s
                WHERE id = %s AND status = 'pending'
                """,
                (revoked_at, revoked_at, invitation_id),
            )
            return cursor.rowcount

        rowcount = self._execute_write(persist_revoke)
        if rowcount == 0:
            return None
        return self.get_child_invitation(invitation_id)

    def resend_child_invitation(self, invitation_id: str) -> Optional[Dict[str, Any]]:
        resent_at = self._utc_now()
        expires_at = self._invitation_expiry_timestamp(resent_at)

        def persist_resend(connection: psycopg.Connection[Any]) -> int:
            cursor = connection.execute(
                """
                UPDATE child_invitations
                SET status = 'pending',
                    accepted_by_user_id = NULL,
                    updated_at = %s,
                    responded_at = NULL,
                    expires_at = %s
                WHERE id = %s AND status IN ('pending', 'declined', 'revoked', 'expired')
                """,
                (resent_at, expires_at, invitation_id),
            )
            return cursor.rowcount

        rowcount = self._execute_write(persist_resend)
        if rowcount == 0:
            return None
        return self.get_child_invitation(invitation_id)

    def record_child_invitation_email_delivery(
        self,
        invitation_id: str,
        delivery: Dict[str, Any],
    ) -> None:
        delivery_id = f"invite-email-{uuid4().hex[:12]}"
        created_at = self._utc_now()

        def persist_delivery(connection: psycopg.Connection[Any]) -> None:
            connection.execute(
                """
                INSERT INTO child_invitation_email_deliveries (
                    id,
                    invitation_id,
                    status,
                    attempted,
                    delivered,
                    provider_message_id,
                    error,
                    created_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    delivery_id,
                    invitation_id,
                    str(delivery.get("status") or "unknown"),
                    bool(delivery.get("attempted")),
                    bool(delivery.get("delivered")),
                    str(delivery.get("provider_message_id") or "") or None,
                    str(delivery.get("error") or "") or None,
                    created_at,
                ),
            )

        self._execute_write(persist_delivery)

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

    def list_children(self, include_deleted: bool = False) -> List[Dict[str, Any]]:
        with self._connect() as connection:
            query = [
                """
                SELECT
                    children.id,
                    children.name,
                    children.date_of_birth,
                    children.notes,
                    children.deleted_at,
                    children.created_at,
                    children.workspace_id,
                    COUNT(sessions.id) AS session_count,
                    MAX(sessions.timestamp) AS last_session_at
                FROM children
                LEFT JOIN sessions ON sessions.child_id = children.id
                WHERE 1 = 1
                """
            ]
            parameters: List[Any] = []
            if not include_deleted:
                query.append("AND children.deleted_at IS NULL")
            query.append(
                "GROUP BY children.id, children.name, children.date_of_birth, children.notes, children.deleted_at, children.created_at, children.workspace_id"
            )
            query.append("ORDER BY LOWER(children.name) ASC")
            rows = connection.execute("\n".join(query), parameters).fetchall()

        return [
            {
                "id": row["id"],
                "name": row["name"],
                "date_of_birth": row["date_of_birth"],
                "notes": row["notes"],
                "deleted_at": row["deleted_at"],
                "created_at": row["created_at"],
                "workspace_id": row["workspace_id"],
                "session_count": row["session_count"],
                "last_session_at": row["last_session_at"],
            }
            for row in rows
        ]

    def save_session(self, session_payload: Dict[str, Any]) -> Dict[str, Any]:
        child_id = str(session_payload.get("child_id") or "").strip()
        if not child_id:
            raise ValueError("child_id is required")

        child = self.get_child(child_id)
        if child is None:
            raise ValueError("Child not found")

        child_name = str(session_payload.get("child_name") or child.get("name") or child_id.replace("-", " ").title())
        exercise = dict(session_payload.get("exercise") or {})
        exercise_id = str(session_payload.get("exercise_id") or exercise.get("id") or "unknown-exercise")
        exercise_name = str(exercise.get("name") or "Speech exercise")
        exercise_description = str(exercise.get("description") or "")
        exercise_metadata = dict(session_payload.get("exercise_metadata") or exercise.get("exerciseMetadata") or {})
        session_id = str(session_payload.get("id") or f"session-{uuid4().hex[:12]}")
        timestamp = str(session_payload.get("timestamp") or self._utc_now())

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

    def save_child_memory_item(self, item_payload: Dict[str, Any]) -> Dict[str, Any]:
        item_id = str(item_payload.get("id") or f"memory-item-{uuid4().hex[:12]}")
        child_id = str(item_payload.get("child_id") or "").strip()
        if not child_id:
            raise ValueError("child_id is required")

        now = self._utc_now()
        created_at = str(item_payload.get("created_at") or now)
        updated_at = str(item_payload.get("updated_at") or now)

        def persist_item(connection: psycopg.Connection[Any]) -> None:
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
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
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
                WHERE id = %s
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
            WHERE child_id = %s
            """
        ]
        parameters: List[Any] = [child_id]
        if status:
            query.append("AND status = %s")
            parameters.append(status)
        if category:
            query.append("AND category = %s")
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

        def persist_status(connection: psycopg.Connection[Any]) -> int:
            cursor = connection.execute(
                """
                UPDATE child_memory_items
                SET status = %s, superseded_by_item_id = %s, expires_at = %s, updated_at = %s, reviewed_at = %s
                WHERE id = %s
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

        def persist_proposal(connection: psycopg.Connection[Any]) -> None:
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
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
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
                WHERE id = %s
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
            WHERE child_id = %s
            """
        ]
        parameters: List[Any] = [child_id]
        if status:
            query.append("AND status = %s")
            parameters.append(status)
        if category:
            query.append("AND category = %s")
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

        def persist_review(connection: psycopg.Connection[Any]) -> int:
            cursor = connection.execute(
                """
                UPDATE child_memory_proposals
                SET status = %s, reviewer_user_id = %s, review_note = %s, approved_item_id = %s, updated_at = %s, reviewed_at = %s
                WHERE id = %s
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

        subject_type = str(link_payload.get("subject_type") or "proposal")
        subject_id = str(link_payload.get("subject_id") or "").strip()

        def persist_link(connection: psycopg.Connection[Any]) -> None:
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
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
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
                    subject_type,
                    subject_id,
                    link_payload.get("session_id"),
                    link_payload.get("practice_plan_id"),
                    str(link_payload.get("evidence_kind") or "session"),
                    link_payload.get("snippet"),
                    self._dumps_json(link_payload.get("metadata") or {}),
                    str(link_payload.get("created_at") or self._utc_now()),
                ),
            )

        self._execute_write(persist_link)

        links = self.list_child_memory_evidence_links(subject_type, subject_id)
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
                WHERE subject_type = %s AND subject_id = %s
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

        def persist_summary(connection: psycopg.Connection[Any]) -> None:
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
                VALUES (%s, %s, %s, %s, %s, %s)
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
                WHERE child_id = %s
                """,
                (child_id,),
            ).fetchone()

        if row is None:
            return None

        return self._build_child_memory_summary_payload(row)

    def replace_institutional_memory_insights(
        self,
        owner_user_id: str,
        insights: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        created_at = self._utc_now()

        def persist_insights(connection: psycopg.Connection[Any]) -> None:
            connection.execute(
                "DELETE FROM institutional_memory_insights WHERE owner_user_id = %s",
                (owner_user_id,),
            )
            for insight in insights:
                connection.execute(
                    """
                    INSERT INTO institutional_memory_insights (
                        id,
                        owner_user_id,
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
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        str(insight.get("id") or f"institutional-insight-{uuid4().hex[:12]}"),
                        owner_user_id,
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
        return self.list_institutional_memory_insights(owner_user_id=owner_user_id)

    def list_institutional_memory_insights(
        self,
        *,
        owner_user_id: str,
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
            WHERE owner_user_id = %s
            """
        ]
        parameters: List[Any] = [owner_user_id]
        if status:
            query.append("AND status = %s")
            parameters.append(status)
        if insight_type:
            query.append("AND insight_type = %s")
            parameters.append(insight_type)
        if target_sound:
            query.append("AND target_sound = %s")
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

        def persist_log(connection: psycopg.Connection[Any]) -> None:
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
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
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
                WHERE id = %s
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
                WHERE child_id = %s
                ORDER BY created_at DESC
                LIMIT %s
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

        def persist_candidates(connection: psycopg.Connection[Any]) -> None:
            connection.execute(
                "DELETE FROM recommendation_candidates WHERE recommendation_log_id = %s",
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
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
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
                WHERE recommendation_log_id = %s
                ORDER BY rank ASC, score DESC, exercise_name ASC
                """,
                (recommendation_log_id,),
            ).fetchall()

        return [
            self._build_recommendation_candidate_payload(row, child_id=resolved_child_id)
            for row in rows
        ]

    # ------------------------------------------------------------------
    # Parental consent
    # ------------------------------------------------------------------

    def save_parental_consent(
        self,
        *,
        child_id: str,
        guardian_name: str,
        guardian_email: str,
        consent_type: str = "full",
        privacy_accepted: bool = True,
        terms_accepted: bool = True,
        ai_notice_accepted: bool = True,
        recorded_by_user_id: str,
    ) -> Dict[str, Any]:
        consent_id = str(uuid4())
        now = self._utc_now()
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO parental_consents
                        (id, child_id, guardian_name, guardian_email, consent_type,
                         privacy_accepted, terms_accepted, ai_notice_accepted,
                         recorded_by_user_id, consented_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        consent_id, child_id, guardian_name, guardian_email, consent_type,
                        privacy_accepted, terms_accepted, ai_notice_accepted,
                        recorded_by_user_id, now,
                    ),
                )
        return {
            "id": consent_id,
            "child_id": child_id,
            "guardian_name": guardian_name,
            "guardian_email": guardian_email,
            "consent_type": consent_type,
            "privacy_accepted": privacy_accepted,
            "terms_accepted": terms_accepted,
            "ai_notice_accepted": ai_notice_accepted,
            "consented_at": now,
            "withdrawn_at": None,
        }

    def get_parental_consent(self, child_id: str) -> Optional[Dict[str, Any]]:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, child_id, guardian_name, guardian_email, consent_type,
                           privacy_accepted, terms_accepted, ai_notice_accepted,
                           recorded_by_user_id, consented_at, withdrawn_at
                    FROM parental_consents
                    WHERE child_id = %s AND withdrawn_at IS NULL
                    ORDER BY consented_at DESC LIMIT 1
                    """,
                    (child_id,),
                )
                row = cur.fetchone()
        if row is None:
            return None
        return {
            "id": row[0],
            "child_id": row[1],
            "guardian_name": row[2],
            "guardian_email": row[3],
            "consent_type": row[4],
            "privacy_accepted": bool(row[5]),
            "terms_accepted": bool(row[6]),
            "ai_notice_accepted": bool(row[7]),
            "recorded_by_user_id": row[8],
            "consented_at": row[9],
            "withdrawn_at": row[10],
        }

    def withdraw_parental_consent(self, child_id: str) -> bool:
        now = self._utc_now()
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE parental_consents SET withdrawn_at = %s
                    WHERE child_id = %s AND withdrawn_at IS NULL
                    """,
                    (now, child_id),
                )
                return cur.rowcount > 0

    # ------------------------------------------------------------------
    # Data export
    # ------------------------------------------------------------------

    def export_child_data(self, child_id: str) -> Dict[str, Any]:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id, name, created_at FROM children WHERE id = %s",
                    (child_id,),
                )
                child_row = cur.fetchone()
                if child_row is None:
                    return {}

                cur.execute(
                    "SELECT id, scenario_id, started_at, finished_at, transcript, summary_json, created_at FROM sessions WHERE child_id = %s ORDER BY created_at",
                    (child_id,),
                )
                sessions = [
                    {
                        "id": r[0], "scenario_id": r[1], "started_at": r[2],
                        "finished_at": r[3], "transcript": r[4],
                        "summary_json": r[5],
                        "created_at": r[6],
                    }
                    for r in cur.fetchall()
                ]

                cur.execute(
                    "SELECT id, category, content_json, created_at FROM child_memory_items WHERE child_id = %s ORDER BY created_at",
                    (child_id,),
                )
                memory_items = [
                    {
                        "id": r[0], "category": r[1],
                        "content": r[2],
                        "created_at": r[3],
                    }
                    for r in cur.fetchall()
                ]

                cur.execute(
                    "SELECT id, plan_data_json, status, created_at FROM practice_plans WHERE child_id = %s ORDER BY created_at",
                    (child_id,),
                )
                plans = [
                    {
                        "id": r[0], "plan_data": r[1],
                        "status": r[2], "created_at": r[3],
                    }
                    for r in cur.fetchall()
                ]

                cur.execute(
                    "SELECT guardian_name, guardian_email, consented_at, withdrawn_at FROM parental_consents WHERE child_id = %s ORDER BY consented_at DESC LIMIT 1",
                    (child_id,),
                )
                consent_row = cur.fetchone()

        return {
            "child": {"id": child_row[0], "name": child_row[1], "created_at": child_row[2]},
            "sessions": sessions,
            "memory_items": memory_items,
            "practice_plans": plans,
            "parental_consent": {
                "guardian_name": consent_row[0],
                "guardian_email": consent_row[1],
                "consented_at": consent_row[2],
                "withdrawn_at": consent_row[3],
            } if consent_row else None,
            "exported_at": self._utc_now(),
        }

    # ------------------------------------------------------------------
    # Data deletion
    # ------------------------------------------------------------------

    def delete_child_data(self, child_id: str) -> bool:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT id FROM children WHERE id = %s", (child_id,))
                if cur.fetchone() is None:
                    return False
                cur.execute("DELETE FROM parental_consents WHERE child_id = %s", (child_id,))
                cur.execute("DELETE FROM child_memory_items WHERE child_id = %s", (child_id,))
                cur.execute("DELETE FROM child_memory_proposals WHERE child_id = %s", (child_id,))
                cur.execute("DELETE FROM recommendation_candidates WHERE recommendation_log_id IN (SELECT id FROM recommendation_logs WHERE child_id = %s)", (child_id,))
                cur.execute("DELETE FROM recommendation_logs WHERE child_id = %s", (child_id,))
                cur.execute("DELETE FROM practice_plans WHERE child_id = %s", (child_id,))
                cur.execute("DELETE FROM sessions WHERE child_id = %s", (child_id,))
                cur.execute("DELETE FROM child_memory_summaries WHERE child_id = %s", (child_id,))
                cur.execute("DELETE FROM user_children WHERE child_id = %s", (child_id,))
                cur.execute("DELETE FROM children WHERE id = %s", (child_id,))
        return True