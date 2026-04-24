# ---------------------------------------------------------------------------------------------
#  Copyright (c) Microsoft Corporation. All rights reserved.
#  Licensed under the MIT License. See LICENSE in the project root for license information.
# --------------------------------------------------------------------------------------------

"""Lightweight SQLite persistence for Wulo pilot session review."""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import threading
import time
from datetime import datetime, timedelta, timezone
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
ROLE_THERAPIST = "therapist"
ROLE_PARENT = "parent"
ROLE_ADMIN = "admin"
ROLE_PENDING_THERAPIST = "pending_therapist"
LEGACY_ROLE_USER = "user"
CHILD_RELATIONSHIP_THERAPIST = "therapist"
CHILD_RELATIONSHIP_PARENT = "parent"
MEMORY_DETAIL_FALLBACK: Dict[str, Any] = {}
MEMORY_PROVENANCE_FALLBACK: Dict[str, Any] = {}
SQLITE_LOCK_RETRY_COUNT = 10
SQLITE_LOCK_RETRY_DELAY_SECONDS = 1.0
SQLITE_LOCK_TIMEOUT_SECONDS = 30.0
INVITATION_EXPIRATION_DAYS = 7
WORKSPACE_ROLE_OWNER = "owner"
WORKSPACE_ROLE_ADMIN = "admin"
WORKSPACE_ROLE_THERAPIST = "therapist"
WORKSPACE_ROLE_PARENT = "parent"
WriteResult = TypeVar("WriteResult")


class StorageService:
    """Persist child, exercise, and session records in a local SQLite database."""

    def __init__(self, db_path: str):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        # Background blob-backup coordination. A single daemon thread
        # observes ``_backup_dirty`` and uploads the SQLite file at most
        # once per ``BLOB_BACKUP_MIN_INTERVAL_SECONDS`` so bursty writes
        # coalesce into a single upload and never block the request path.
        self._backup_dirty = threading.Event()
        self._backup_shutdown = threading.Event()
        self._backup_wakeup = threading.Event()
        self._backup_thread: Optional[threading.Thread] = None
        self._backup_thread_lock = threading.Lock()
        try:
            self._backup_min_interval = float(
                os.environ.get("BLOB_BACKUP_MIN_INTERVAL_SECONDS", "30")
            )
        except ValueError:
            self._backup_min_interval = 30.0
        if self._backup_min_interval < 0:
            self._backup_min_interval = 0.0
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
                                date_of_birth TEXT,
                                notes TEXT,
                                deleted_at TEXT,
                                created_at TEXT NOT NULL,
                                workspace_id TEXT,
                                FOREIGN KEY (workspace_id) REFERENCES therapist_workspaces(id)
                            )"""
                        )
                        connection.execute(
                            """CREATE TABLE IF NOT EXISTS users (
                                id TEXT PRIMARY KEY,
                                email TEXT,
                                name TEXT,
                                provider TEXT,
                                role TEXT NOT NULL DEFAULT 'parent',
                                created_at TEXT NOT NULL
                            )"""
                        )
                        self._ensure_workspace_tables(connection)
                        self._ensure_user_children_table(connection)
                        self._ensure_audit_log_table(connection)
                        self._ensure_child_invitations_table(connection)
                        self._ensure_child_invitation_email_deliveries_table(connection)
                        self._ensure_family_intake_invitations_table(connection)
                        self._ensure_child_intake_proposals_table(connection)
                        self._ensure_therapist_invite_codes_table(connection)
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
                        self._ensure_progress_report_table(connection)
                        self._ensure_insight_tables(connection)
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
        self._ensure_column(connection, "children", "date_of_birth", "TEXT")
        self._ensure_column(connection, "children", "notes", "TEXT")
        self._ensure_column(connection, "children", "deleted_at", "TEXT")
        self._ensure_column(connection, "children", "workspace_id", "TEXT REFERENCES therapist_workspaces(id)")
        self._ensure_column(connection, "users", "email", "TEXT")
        self._ensure_column(connection, "users", "name", "TEXT")
        self._ensure_column(connection, "users", "provider", "TEXT")
        self._ensure_column(connection, "users", "role", "TEXT NOT NULL DEFAULT 'parent'")
        self._ensure_column(connection, "users", "created_at", "TEXT")
        self._ensure_workspace_tables(connection)
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_children_workspace_id ON children (workspace_id)"
        )
        self._ensure_column(connection, "sessions", "feedback_rating", "TEXT")
        self._ensure_column(connection, "sessions", "feedback_note", "TEXT")
        self._ensure_column(connection, "sessions", "feedback_submitted_at", "TEXT")
        connection.execute(
            "UPDATE users SET role = ? WHERE role = ? OR role IS NULL OR TRIM(role) = ''",
            (ROLE_PARENT, LEGACY_ROLE_USER),
        )
        self._ensure_user_children_table(connection)
        self._ensure_parental_consents_table(connection)
        self._ensure_audit_log_table(connection)
        self._ensure_column(connection, "users", "ui_state", "TEXT NOT NULL DEFAULT '{}'")
        self._ensure_ui_state_audit_table(connection)
        self._ensure_child_ui_state_table(connection)
        self._ensure_institutional_memory_tables(connection)
        self._ensure_recommendation_tables(connection)
        self._ensure_progress_report_table(connection)
        self._ensure_column(
            connection,
            "progress_reports",
            "source",
            "TEXT NOT NULL DEFAULT 'pipeline'",
        )
        connection.execute(
            "UPDATE progress_reports SET source = 'pipeline' WHERE source IS NULL OR TRIM(source) = ''"
        )
        self._ensure_insight_tables(connection)

    def _ensure_parental_consents_table(self, connection: sqlite3.Connection) -> None:
        connection.execute(
            """CREATE TABLE IF NOT EXISTS parental_consents (
                id TEXT PRIMARY KEY,
                child_id TEXT NOT NULL REFERENCES children(id),
                guardian_name TEXT NOT NULL,
                guardian_email TEXT NOT NULL,
                consent_type TEXT NOT NULL DEFAULT 'full',
                privacy_accepted BOOLEAN NOT NULL DEFAULT FALSE,
                terms_accepted BOOLEAN NOT NULL DEFAULT FALSE,
                ai_notice_accepted BOOLEAN NOT NULL DEFAULT FALSE,
                personal_data_consent_accepted BOOLEAN NOT NULL DEFAULT FALSE,
                special_category_consent_accepted BOOLEAN NOT NULL DEFAULT FALSE,
                parental_responsibility_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
                recorded_by_user_id TEXT NOT NULL REFERENCES users(id),
                consented_at TEXT NOT NULL,
                withdrawn_at TEXT
            )"""
        )
        self._ensure_column(connection, "parental_consents", "consent_type", "TEXT NOT NULL DEFAULT 'full'")
        self._ensure_column(
            connection,
            "parental_consents",
            "personal_data_consent_accepted",
            "BOOLEAN NOT NULL DEFAULT FALSE",
        )
        self._ensure_column(
            connection,
            "parental_consents",
            "special_category_consent_accepted",
            "BOOLEAN NOT NULL DEFAULT FALSE",
        )
        self._ensure_column(
            connection,
            "parental_consents",
            "parental_responsibility_confirmed",
            "BOOLEAN NOT NULL DEFAULT FALSE",
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_parental_consents_child ON parental_consents (child_id)"
        )

    def _ensure_institutional_memory_tables(self, connection: sqlite3.Connection):
        connection.execute(
            """CREATE TABLE IF NOT EXISTS institutional_memory_insights (
                id TEXT PRIMARY KEY,
                owner_user_id TEXT NOT NULL,
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
                updated_at TEXT NOT NULL,
                FOREIGN KEY (owner_user_id) REFERENCES users(id)
            )"""
        )
        self._ensure_column(connection, "institutional_memory_insights", "owner_user_id", "TEXT")
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_institutional_memory_owner_status_target ON institutional_memory_insights (owner_user_id, status, target_sound, updated_at DESC)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_institutional_memory_type_updated ON institutional_memory_insights (insight_type, updated_at DESC)"
        )

    def _ensure_workspace_tables(self, connection: sqlite3.Connection) -> None:
        connection.execute(
            """CREATE TABLE IF NOT EXISTS therapist_workspaces (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                owner_user_id TEXT NOT NULL,
                is_personal INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (owner_user_id) REFERENCES users(id)
            )"""
        )
        connection.execute(
            """CREATE TABLE IF NOT EXISTS workspace_members (
                workspace_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                role TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (workspace_id, user_id),
                FOREIGN KEY (workspace_id) REFERENCES therapist_workspaces(id),
                FOREIGN KEY (user_id) REFERENCES users(id)
            )"""
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_workspace_members_user_role ON workspace_members (user_id, role, updated_at DESC)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_therapist_workspaces_owner_personal ON therapist_workspaces (owner_user_id, is_personal, created_at DESC)"
        )

        eligible_users = connection.execute(
            "SELECT id, name, email FROM users WHERE role IN (?, ?)",
            (ROLE_THERAPIST, ROLE_ADMIN),
        ).fetchall()
        for row in eligible_users:
            self._ensure_personal_workspace_for_user(
                connection,
                str(row["id"]),
                str(row["name"] or ""),
                str(row["email"] or ""),
            )

    def _ensure_user_children_table(self, connection: sqlite3.Connection) -> None:
        connection.execute(
            """CREATE TABLE IF NOT EXISTS user_children (
                user_id TEXT NOT NULL,
                child_id TEXT NOT NULL,
                relationship TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (user_id, child_id),
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (child_id) REFERENCES children(id)
            )"""
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_user_children_child_relationship ON user_children (child_id, relationship, created_at DESC)"
        )

    def _ensure_audit_log_table(self, connection: sqlite3.Connection) -> None:
        connection.execute(
            """CREATE TABLE IF NOT EXISTS audit_log (
                id TEXT PRIMARY KEY,
                user_id TEXT,
                action TEXT NOT NULL,
                resource_type TEXT NOT NULL,
                resource_id TEXT NOT NULL,
                child_id TEXT,
                metadata_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (child_id) REFERENCES children(id)
            )"""
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_audit_log_user_created ON audit_log (user_id, created_at DESC)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_audit_log_child_created ON audit_log (child_id, created_at DESC)"
        )

    def _ensure_ui_state_audit_table(self, connection: sqlite3.Connection) -> None:
        connection.execute(
            """CREATE TABLE IF NOT EXISTS ui_state_audit (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                event TEXT NOT NULL,
                payload_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )"""
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_ui_state_audit_user_created ON ui_state_audit (user_id, created_at DESC)"
        )

    def _ensure_child_ui_state_table(self, connection: sqlite3.Connection) -> None:
        connection.execute(
            """CREATE TABLE IF NOT EXISTS child_ui_state (
                child_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                exercise_type TEXT NOT NULL,
                first_run_at TEXT,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (child_id, user_id, exercise_type),
                FOREIGN KEY (child_id) REFERENCES children(id),
                FOREIGN KEY (user_id) REFERENCES users(id)
            )"""
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_child_ui_state_user ON child_ui_state (user_id, updated_at DESC)"
        )

    def _ensure_child_invitations_table(self, connection: sqlite3.Connection) -> None:
        connection.execute(
            """CREATE TABLE IF NOT EXISTS child_invitations (
                id TEXT PRIMARY KEY,
                child_id TEXT NOT NULL,
                invited_email TEXT NOT NULL,
                relationship TEXT NOT NULL,
                status TEXT NOT NULL,
                invited_by_user_id TEXT NOT NULL,
                accepted_by_user_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                responded_at TEXT,
                expires_at TEXT,
                workspace_id TEXT,
                FOREIGN KEY (child_id) REFERENCES children(id),
                FOREIGN KEY (invited_by_user_id) REFERENCES users(id),
                FOREIGN KEY (accepted_by_user_id) REFERENCES users(id),
                FOREIGN KEY (workspace_id) REFERENCES therapist_workspaces(id)
            )"""
        )
        columns = {
            str(row["name"])
            for row in connection.execute("PRAGMA table_info(child_invitations)").fetchall()
        }
        if "expires_at" not in columns:
            connection.execute("ALTER TABLE child_invitations ADD COLUMN expires_at TEXT")
        if "workspace_id" not in columns:
            connection.execute("ALTER TABLE child_invitations ADD COLUMN workspace_id TEXT REFERENCES therapist_workspaces(id)")
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_child_invitations_email_status ON child_invitations (invited_email, status, updated_at DESC)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_child_invitations_child_status ON child_invitations (child_id, status, updated_at DESC)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_child_invitations_inviter_status ON child_invitations (invited_by_user_id, status, updated_at DESC)"
        )

    def _ensure_child_invitation_email_deliveries_table(self, connection: sqlite3.Connection) -> None:
        connection.execute(
            """CREATE TABLE IF NOT EXISTS child_invitation_email_deliveries (
                id TEXT PRIMARY KEY,
                invitation_id TEXT NOT NULL,
                status TEXT NOT NULL,
                attempted INTEGER NOT NULL,
                delivered INTEGER NOT NULL,
                provider_message_id TEXT,
                error TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (invitation_id) REFERENCES child_invitations(id)
            )"""
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_child_invitation_email_deliveries_invitation_created ON child_invitation_email_deliveries (invitation_id, created_at DESC)"
        )

    def _ensure_family_intake_invitations_table(self, connection: sqlite3.Connection) -> None:
        connection.execute(
            """CREATE TABLE IF NOT EXISTS family_intake_invitations (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL,
                invited_email TEXT NOT NULL,
                invited_by_user_id TEXT NOT NULL,
                status TEXT NOT NULL,
                accepted_by_user_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                responded_at TEXT,
                expires_at TEXT,
                FOREIGN KEY (workspace_id) REFERENCES therapist_workspaces(id),
                FOREIGN KEY (invited_by_user_id) REFERENCES users(id),
                FOREIGN KEY (accepted_by_user_id) REFERENCES users(id)
            )"""
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_family_intake_invites_email_status ON family_intake_invitations (invited_email, status, updated_at DESC)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_family_intake_invites_workspace_status ON family_intake_invitations (workspace_id, status, updated_at DESC)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_family_intake_invites_inviter_status ON family_intake_invitations (invited_by_user_id, status, updated_at DESC)"
        )

    def _ensure_child_intake_proposals_table(self, connection: sqlite3.Connection) -> None:
        connection.execute(
            """CREATE TABLE IF NOT EXISTS child_intake_proposals (
                id TEXT PRIMARY KEY,
                family_intake_invitation_id TEXT NOT NULL,
                workspace_id TEXT NOT NULL,
                created_by_user_id TEXT NOT NULL,
                reviewed_by_user_id TEXT,
                final_child_id TEXT,
                child_name TEXT NOT NULL,
                date_of_birth TEXT,
                notes TEXT,
                status TEXT NOT NULL,
                submitted_at TEXT,
                reviewed_at TEXT,
                review_note TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (family_intake_invitation_id) REFERENCES family_intake_invitations(id),
                FOREIGN KEY (workspace_id) REFERENCES therapist_workspaces(id),
                FOREIGN KEY (created_by_user_id) REFERENCES users(id),
                FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id),
                FOREIGN KEY (final_child_id) REFERENCES children(id)
            )"""
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_child_intake_proposals_creator_status ON child_intake_proposals (created_by_user_id, status, updated_at DESC)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_child_intake_proposals_workspace_status ON child_intake_proposals (workspace_id, status, submitted_at DESC)"
        )

    def _ensure_therapist_invite_codes_table(self, connection: sqlite3.Connection) -> None:
        connection.execute(
            """CREATE TABLE IF NOT EXISTS therapist_invite_codes (
                id TEXT PRIMARY KEY,
                code TEXT NOT NULL UNIQUE,
                created_by TEXT NOT NULL,
                used_by TEXT,
                used_at TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (created_by) REFERENCES users(id),
                FOREIGN KEY (used_by) REFERENCES users(id)
            )"""
        )

    def set_request_actor(self, user_id: Optional[str], role: Optional[str], email: Optional[str]) -> None:
        """SQLite does not require per-request storage context."""

    def clear_request_actor(self) -> None:
        """SQLite does not require per-request storage context."""

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

    def _build_workspace_payload(self, row: sqlite3.Row) -> Dict[str, Any]:
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
        connection: sqlite3.Connection,
        user_id: str,
        display_name: str,
        email: str,
    ) -> None:
        existing = connection.execute(
            """
            SELECT therapist_workspaces.id
            FROM therapist_workspaces
            INNER JOIN workspace_members ON workspace_members.workspace_id = therapist_workspaces.id
            WHERE therapist_workspaces.owner_user_id = ?
              AND therapist_workspaces.is_personal = 1
              AND workspace_members.user_id = ?
            LIMIT 1
            """,
            (user_id, user_id),
        ).fetchone()
        if existing is not None:
            # Backfill any children that still have no workspace assigned
            try:
                connection.execute(
                    """
                    UPDATE children SET workspace_id = ?
                    WHERE id IN (SELECT child_id FROM user_children WHERE user_id = ?)
                      AND workspace_id IS NULL
                    """,
                    (existing["id"], user_id),
                )
            except sqlite3.OperationalError:
                pass  # workspace_id column may not exist yet during migration
            return

        now = self._utc_now()
        workspace_id = f"workspace-{uuid4().hex[:12]}"
        workspace_name = self._default_workspace_name(display_name, email)
        connection.execute(
            """
            INSERT INTO therapist_workspaces (id, name, owner_user_id, is_personal, created_at, updated_at)
            VALUES (?, ?, ?, 1, ?, ?)
            """,
            (workspace_id, workspace_name, user_id, now, now),
        )
        connection.execute(
            """
            INSERT INTO workspace_members (workspace_id, user_id, role, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (workspace_id, user_id, WORKSPACE_ROLE_OWNER, now, now),
        )

    def _build_child_invitation_payload(self, row: sqlite3.Row, *, current_email: Optional[str] = None) -> Dict[str, Any]:
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
            "workspace_id": row["workspace_id"] if "workspace_id" in row.keys() else None,
            "direction": direction,
        }

        if row["email_delivery_status"] is not None:
            payload["email_delivery"] = {
                "status": row["email_delivery_status"],
                "attempted": bool(row["email_delivery_attempted"]),
                "delivered": bool(row["email_delivery_delivered"]),
                "provider_message_id": row["email_delivery_provider_message_id"],
                "error": row["email_delivery_error"],
            }

        return payload

    def _build_family_intake_invitation_payload(self, row: sqlite3.Row, *, current_email: Optional[str] = None) -> Dict[str, Any]:
        invited_email = str(row["invited_email"] or "")
        normalized_current_email = str(current_email or "").strip().lower()
        direction = "sent"
        if normalized_current_email and invited_email.lower() == normalized_current_email:
            direction = "incoming"

        return {
            "id": row["id"],
            "workspace_id": row["workspace_id"],
            "workspace_name": row["workspace_name"],
            "invited_email": invited_email,
            "invited_by_user_id": row["invited_by_user_id"],
            "invited_by_name": row["invited_by_name"],
            "accepted_by_user_id": row["accepted_by_user_id"],
            "status": row["status"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "responded_at": row["responded_at"],
            "expires_at": row["expires_at"],
            "direction": direction,
        }

    def _build_child_intake_proposal_payload(self, row: sqlite3.Row) -> Dict[str, Any]:
        return {
            "id": row["id"],
            "family_intake_invitation_id": row["family_intake_invitation_id"],
            "workspace_id": row["workspace_id"],
            "workspace_name": row["workspace_name"],
            "created_by_user_id": row["created_by_user_id"],
            "created_by_name": row["created_by_name"],
            "reviewed_by_user_id": row["reviewed_by_user_id"],
            "reviewed_by_name": row["reviewed_by_name"],
            "final_child_id": row["final_child_id"],
            "child_name": row["child_name"],
            "date_of_birth": row["date_of_birth"],
            "notes": row["notes"],
            "status": row["status"],
            "submitted_at": row["submitted_at"],
            "reviewed_at": row["reviewed_at"],
            "review_note": row["review_note"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

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

        def persist_expiry(connection: sqlite3.Connection) -> None:
            connection.execute(
                """
                UPDATE child_invitations
                SET status = 'expired', updated_at = ?, responded_at = COALESCE(responded_at, ?)
                WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < ?
                """,
                (now, now, now),
            )

        self._execute_write(persist_expiry)

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

    def _ensure_progress_report_table(self, connection: sqlite3.Connection) -> None:
        connection.execute(
            """CREATE TABLE IF NOT EXISTS progress_reports (
                id TEXT PRIMARY KEY,
                child_id TEXT NOT NULL,
                workspace_id TEXT,
                created_by_user_id TEXT NOT NULL,
                audience TEXT NOT NULL,
                report_type TEXT NOT NULL,
                title TEXT NOT NULL,
                status TEXT NOT NULL,
                period_start TEXT NOT NULL,
                period_end TEXT NOT NULL,
                included_session_ids_json TEXT NOT NULL,
                snapshot_json TEXT NOT NULL,
                sections_json TEXT NOT NULL,
                redaction_overrides_json TEXT,
                summary_text TEXT,
                signed_by_user_id TEXT,
                source TEXT NOT NULL DEFAULT 'pipeline',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                approved_at TEXT,
                signed_at TEXT,
                archived_at TEXT,
                FOREIGN KEY (child_id) REFERENCES children(id),
                FOREIGN KEY (workspace_id) REFERENCES therapist_workspaces(id),
                FOREIGN KEY (created_by_user_id) REFERENCES users(id),
                FOREIGN KEY (signed_by_user_id) REFERENCES users(id)
            )"""
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_progress_reports_child_status_created ON progress_reports (child_id, status, created_at DESC)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_progress_reports_workspace_created ON progress_reports (workspace_id, created_at DESC)"
        )

    def _ensure_insight_tables(self, connection: sqlite3.Connection) -> None:
        """Create the Phase 4 Insights Agent conversation + message tables."""
        connection.execute(
            """CREATE TABLE IF NOT EXISTS insight_conversations (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                workspace_id TEXT,
                scope_type TEXT NOT NULL,
                scope_child_id TEXT,
                scope_session_id TEXT,
                scope_report_id TEXT,
                title TEXT,
                prompt_version TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deleted_at TEXT
            )"""
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_insight_conversations_user_updated "
            "ON insight_conversations (user_id, updated_at DESC)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_insight_conversations_scope_child "
            "ON insight_conversations (scope_child_id, updated_at DESC)"
        )
        connection.execute(
            """CREATE TABLE IF NOT EXISTS insight_messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL REFERENCES insight_conversations(id) ON DELETE CASCADE,
                role TEXT NOT NULL,
                content_text TEXT NOT NULL,
                citations_json TEXT,
                visualizations_json TEXT,
                tool_trace_json TEXT,
                latency_ms INTEGER,
                tool_calls_count INTEGER,
                prompt_version TEXT,
                error_text TEXT,
                created_at TEXT NOT NULL
            )"""
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_insight_messages_conversation_created "
            "ON insight_messages (conversation_id, created_at)"
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

    def _build_progress_report_payload(self, row: sqlite3.Row) -> Dict[str, Any]:
        # ``source`` discriminates pipeline-generated reports from AI-drafted
        # insights (``ai_insight``) or manually authored ones (``manual``).
        # Older SQLite rows may be missing the column on very old DB files,
        # so fall back to ``'pipeline'`` for backwards compatibility.
        try:
            raw_source = row["source"]
        except (IndexError, KeyError):
            raw_source = None
        source = str(raw_source).strip() if raw_source else ""
        return {
            "id": row["id"],
            "child_id": row["child_id"],
            "workspace_id": row["workspace_id"],
            "created_by_user_id": row["created_by_user_id"],
            "audience": row["audience"],
            "report_type": row["report_type"],
            "title": row["title"],
            "status": row["status"],
            "source": source or "pipeline",
            "period_start": row["period_start"],
            "period_end": row["period_end"],
            "included_session_ids": self._loads_json(row["included_session_ids_json"], []),
            "snapshot": self._loads_json(row["snapshot_json"], {}),
            "sections": self._loads_json(row["sections_json"], {}),
            "redaction_overrides": self._loads_json(row["redaction_overrides_json"], {}),
            "summary_text": row["summary_text"],
            "signed_by_user_id": row["signed_by_user_id"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "approved_at": row["approved_at"],
            "signed_at": row["signed_at"],
            "archived_at": row["archived_at"],
        }

    def _execute_write(self, operation: Callable[[sqlite3.Connection], WriteResult]) -> WriteResult:
        with self._lock:
            with self._connect() as connection:
                result = operation(connection)
                connection.commit()
        # Mark the database dirty and wake the background backup worker.
        # The worker debounces uploads so bursty writes coalesce into one
        # backup and never block the request path (previously a sync
        # upload added ~hundreds of ms per write and, worse, ran the
        # aiohttp transport inside the request thread which leaked on
        # 403s).
        self._mark_backup_dirty()
        return result

    def _mark_backup_dirty(self) -> None:
        self._backup_dirty.set()
        self._ensure_backup_worker_started()
        self._backup_wakeup.set()

    def _ensure_backup_worker_started(self) -> None:
        if self._backup_thread is not None and self._backup_thread.is_alive():
            return
        with self._backup_thread_lock:
            if self._backup_thread is not None and self._backup_thread.is_alive():
                return
            if not str(config.get("blob_backup_account_name", "")):
                # No backup target configured; no point starting a worker.
                return
            thread = threading.Thread(
                target=self._backup_worker_loop,
                name="wulo-blob-backup",
                daemon=True,
            )
            self._backup_thread = thread
            thread.start()

    def _backup_worker_loop(self) -> None:
        logger.info(
            "Blob backup worker started (min interval %.1fs)",
            self._backup_min_interval,
        )
        while not self._backup_shutdown.is_set():
            # Wait until a write marks the DB dirty.
            self._backup_wakeup.wait()
            if self._backup_shutdown.is_set():
                break
            self._backup_wakeup.clear()
            # Debounce: let additional writes coalesce before uploading.
            if self._backup_min_interval > 0:
                # Returns True if shutdown signalled during the wait.
                if self._backup_shutdown.wait(self._backup_min_interval):
                    break
            if not self._backup_dirty.is_set():
                continue
            # Clear before running so writes that land during the upload
            # re-arm the flag and trigger a follow-up cycle.
            self._backup_dirty.clear()
            try:
                self._run_blob_backup()
            except Exception as exc:  # pragma: no cover - defensive
                logger.warning("Blob backup worker iteration failed: %s", exc)

    def _run_blob_backup(self) -> None:
        backup_to_blob(
            str(self.db_path),
            account_name=str(config["blob_backup_account_name"]),
            account_key=str(config["blob_backup_account_key"]),
            container=str(config["blob_backup_container"]),
            blob_name=str(config["blob_backup_name"]),
        )

    def shutdown(self) -> None:
        """Flush any pending backup and stop the worker thread."""
        self._backup_shutdown.set()
        self._backup_wakeup.set()
        thread = self._backup_thread
        if thread is not None and thread.is_alive():
            thread.join(timeout=5.0)
        if self._backup_dirty.is_set():
            try:
                self._run_blob_backup()
            except Exception as exc:  # pragma: no cover - defensive
                logger.warning("Final blob backup on shutdown failed: %s", exc)
            finally:
                self._backup_dirty.clear()

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

    def _normalize_user_role(self, role: Any) -> str:
        normalized = str(role or "").strip().lower()
        if normalized == LEGACY_ROLE_USER:
            return ROLE_PARENT
        if normalized in {ROLE_THERAPIST, ROLE_PARENT, ROLE_ADMIN, ROLE_PENDING_THERAPIST}:
            return normalized
        return ROLE_PARENT

    def _bootstrap_existing_children_for_user(
        self,
        connection: sqlite3.Connection,
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
                VALUES (?, ?, ?, ?)
                ON CONFLICT(user_id, child_id) DO UPDATE SET relationship = excluded.relationship
                """,
                (user_id, row["id"], relationship, now),
            )

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
            "role": self._normalize_user_role(row["role"]),
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
                existing_role = self._normalize_user_role(existing["role"])
                resolved_role = ROLE_THERAPIST if existing_role == ROLE_PENDING_THERAPIST else existing_role
                connection.execute(
                    """
                    UPDATE users
                    SET email = ?, name = ?, provider = ?, role = ?
                    WHERE id = ?
                    """,
                    (email, name, provider, resolved_role, user_id),
                )
                if resolved_role in {ROLE_THERAPIST, ROLE_ADMIN}:
                    if resolved_role == ROLE_THERAPIST and existing_role == ROLE_PENDING_THERAPIST:
                        self._bootstrap_existing_children_for_user(connection, user_id, CHILD_RELATIONSHIP_THERAPIST)
                    self._ensure_personal_workspace_for_user(connection, user_id, name, email)
                return {
                    "id": existing["id"],
                    "email": email,
                    "name": name,
                    "provider": provider,
                    "role": resolved_role,
                    "created_at": existing["created_at"],
                }

            # If there is a pending family or child invitation for this email, assign parent role.
            # Otherwise, assign therapist immediately.
            has_pending_invitation = connection.execute(
                "SELECT 1 FROM child_invitations WHERE LOWER(invited_email) = LOWER(?) AND status = 'pending' LIMIT 1",
                (email,),
            ).fetchone() is not None or connection.execute(
                "SELECT 1 FROM family_intake_invitations WHERE LOWER(invited_email) = LOWER(?) AND status = 'pending' LIMIT 1",
                (email,),
            ).fetchone() is not None
            role = ROLE_PARENT if has_pending_invitation else ROLE_THERAPIST
            connection.execute(
                """
                INSERT INTO users (id, email, name, provider, role, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (user_id, email, name, provider, role, now),
            )
            if role == ROLE_THERAPIST:
                self._bootstrap_existing_children_for_user(connection, user_id, CHILD_RELATIONSHIP_THERAPIST)
                self._ensure_personal_workspace_for_user(connection, user_id, name, email)
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

        def persist_role(connection: sqlite3.Connection) -> int:
            existing = connection.execute(
                "SELECT id, name, email FROM users WHERE id = ?",
                (user_id,),
            ).fetchone()
            cursor = connection.execute(
                "UPDATE users SET role = ? WHERE id = ?",
                (normalized_role, user_id),
            )
            if cursor.rowcount > 0 and normalized_role in {ROLE_THERAPIST, ROLE_ADMIN} and existing is not None:
                if normalized_role == ROLE_THERAPIST:
                    self._bootstrap_existing_children_for_user(connection, user_id, CHILD_RELATIONSHIP_THERAPIST)
                self._ensure_personal_workspace_for_user(
                    connection,
                    user_id,
                    str(existing["name"] or ""),
                    str(existing["email"] or ""),
                )
            return cursor.rowcount

        rowcount = self._execute_write(persist_role)
        if rowcount == 0:
            return None

        return self.get_user(user_id)

    def create_invite_code(self, code: str, created_by: str) -> Dict[str, Any]:
        now = self._utc_now()
        invite_id = str(uuid4())

        def persist(connection: sqlite3.Connection) -> Dict[str, Any]:
            connection.execute(
                "INSERT INTO therapist_invite_codes (id, code, created_by, created_at) VALUES (?, ?, ?, ?)",
                (invite_id, code.upper().strip(), created_by, now),
            )
            return {"id": invite_id, "code": code.upper().strip(), "created_by": created_by, "created_at": now}

        return self._execute_write(persist)

    def claim_invite_code(self, code: str, user_id: str) -> bool:
        """Claim an invite code and upgrade user to therapist. Returns True on success."""
        now = self._utc_now()

        def persist(connection: sqlite3.Connection) -> bool:
            row = connection.execute(
                "SELECT id FROM therapist_invite_codes WHERE UPPER(code) = UPPER(?) AND used_by IS NULL",
                (code.strip(),),
            ).fetchone()
            if row is None:
                return False
            connection.execute(
                "UPDATE therapist_invite_codes SET used_by = ?, used_at = ? WHERE id = ?",
                (user_id, now, row["id"]),
            )
            user = connection.execute("SELECT name, email FROM users WHERE id = ?", (user_id,)).fetchone()
            connection.execute("UPDATE users SET role = ? WHERE id = ?", (ROLE_THERAPIST, user_id))
            if user is not None:
                self._ensure_personal_workspace_for_user(connection, user_id, str(user["name"] or ""), str(user["email"] or ""))
                self._bootstrap_existing_children_for_user(connection, user_id, CHILD_RELATIONSHIP_THERAPIST)
            return True

        return self._execute_write(persist)

    def list_invite_codes(self, created_by: str) -> List[Dict[str, Any]]:
        def query(connection: sqlite3.Connection) -> List[Dict[str, Any]]:
            rows = connection.execute(
                "SELECT id, code, created_by, used_by, used_at, created_at FROM therapist_invite_codes WHERE created_by = ? ORDER BY created_at DESC",
                (created_by,),
            ).fetchall()
            return [dict(r) for r in rows]

        return self._execute_read(query)

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

    def assign_child_to_user(self, user_id: str, child_id: str, relationship: str) -> None:
        normalized_relationship = str(relationship or "").strip().lower()
        if normalized_relationship not in {CHILD_RELATIONSHIP_PARENT, CHILD_RELATIONSHIP_THERAPIST}:
            raise ValueError("Unsupported child relationship")

        def persist_assignment(connection: sqlite3.Connection) -> None:
            connection.execute(
                """
                INSERT INTO user_children (user_id, child_id, relationship, created_at)
                VALUES (?, ?, ?, ?)
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

        def persist_child(connection: sqlite3.Connection) -> None:
            # Resolve workspace_id: use explicit value, or fall back to user's default workspace
            resolved_workspace_id = workspace_id
            if resolved_workspace_id is None:
                ws_row = connection.execute(
                    """
                    SELECT therapist_workspaces.id
                    FROM workspace_members
                    INNER JOIN therapist_workspaces ON therapist_workspaces.id = workspace_members.workspace_id
                    WHERE workspace_members.user_id = ?
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
                # Verify the user is a member of the target workspace
                membership = connection.execute(
                    "SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
                    (resolved_workspace_id, created_by_user_id),
                ).fetchone()
                if membership is None:
                    raise ValueError("User is not a member of the specified workspace")

            connection.execute(
                """
                INSERT INTO children (id, name, date_of_birth, notes, deleted_at, created_at, workspace_id)
                VALUES (?, ?, ?, ?, NULL, ?, ?)
                """,
                (created_child_id, normalized_name, date_of_birth, notes, created_at, resolved_workspace_id),
            )
            connection.execute(
                """
                INSERT INTO user_children (user_id, child_id, relationship, created_at)
                VALUES (?, ?, ?, ?)
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
            WHERE children.id = ?
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
            WHERE user_children.user_id = ?
            """
        ]
        parameters: List[Any] = [user_id]
        if workspace_id is not None:
            query.append("AND children.workspace_id = ?")
            parameters.append(workspace_id)
        if not include_deleted:
            query.append("AND children.deleted_at IS NULL")
        query.append(
            "GROUP BY children.id, children.name, children.date_of_birth, children.notes, children.deleted_at, children.created_at, children.workspace_id"
        )
        query.append("ORDER BY children.name COLLATE NOCASE ASC")

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
            # First check: does the child have a workspace_id?
            child_row = connection.execute(
                "SELECT workspace_id FROM children WHERE id = ?",
                (child_id,),
            ).fetchone()
            if child_row is None:
                return False

            child_workspace_id = child_row["workspace_id"]

            if child_workspace_id is not None:
                # Workspace-scoped check: user must be a member of the child's workspace
                # AND have a user_children link with the right relationship
                ws_member = connection.execute(
                    "SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
                    (child_workspace_id, user_id),
                ).fetchone()
                if ws_member is None:
                    return False

            # Relationship check via user_children (always required)
            query = [
                """
                SELECT 1
                FROM user_children
                INNER JOIN children ON children.id = user_children.child_id
                WHERE user_children.user_id = ? AND user_children.child_id = ?
                """
            ]
            parameters: List[Any] = [user_id, child_id]
            if not include_deleted:
                query.append("AND children.deleted_at IS NULL")
            if allowed_relationships:
                placeholders = ", ".join("?" for _ in allowed_relationships)
                query.append(f"AND user_children.relationship IN ({placeholders})")
                parameters.extend(allowed_relationships)

            row = connection.execute("\n".join(query), parameters).fetchone()
        return row is not None

    def get_child_relationship(self, user_id: str, child_id: str) -> Optional[str]:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT relationship FROM user_children WHERE user_id = ? AND child_id = ?",
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
                WHERE workspace_members.user_id = ?
                ORDER BY
                    CASE workspace_members.role
                        WHEN 'owner' THEN 0
                        WHEN 'admin' THEN 1
                        WHEN 'therapist' THEN 2
                        ELSE 3
                    END,
                    therapist_workspaces.created_at ASC
                """,
                (user_id,),
            ).fetchall()
        return [self._build_workspace_payload(row) for row in rows]

    def get_default_workspace_for_user(self, user_id: str) -> Optional[Dict[str, Any]]:
        workspaces = self.list_workspaces_for_user(user_id)
        return workspaces[0] if workspaces else None

    def create_workspace(self, user_id: str, name: Optional[str] = None) -> Dict[str, Any]:
        now = self._utc_now()

        def persist_workspace(connection: sqlite3.Connection) -> Dict[str, Any]:
            user = connection.execute(
                "SELECT id, name, email, role FROM users WHERE id = ?",
                (user_id,),
            ).fetchone()
            if user is None:
                raise ValueError("User not found")

            normalized_name = str(name or "").strip() or self._default_workspace_name(
                str(user["name"] or ""),
                str(user["email"] or ""),
            )

            if self._normalize_user_role(user["role"]) not in {ROLE_THERAPIST, ROLE_ADMIN}:
                raise ValueError("Therapist role required to create a workspace")

            workspace_id = f"workspace-{uuid4().hex[:12]}"
            connection.execute(
                """
                INSERT INTO therapist_workspaces (id, name, owner_user_id, is_personal, created_at, updated_at)
                VALUES (?, ?, ?, 0, ?, ?)
                """,
                (workspace_id, normalized_name, user_id, now, now),
            )
            connection.execute(
                """
                INSERT INTO workspace_members (workspace_id, user_id, role, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
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
                WHERE therapist_workspaces.id = ? AND workspace_members.user_id = ?
                """,
                (workspace_id, user_id),
            ).fetchone()
            if row is None:
                raise RuntimeError("Workspace could not be reloaded after creation")
            return self._build_workspace_payload(row)

        return self._execute_write(persist_workspace)

    def soft_delete_child(self, child_id: str) -> Optional[Dict[str, Any]]:
        deleted_at = self._utc_now()

        def persist_delete(connection: sqlite3.Connection) -> int:
            cursor = connection.execute(
                "UPDATE children SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL",
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

        def persist_event(connection: sqlite3.Connection) -> None:
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
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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

    # ------------------------------------------------------------------
    # UI state (onboarding/guidance persistence — see docs/onboarding/onboarding-plan-v2.md)
    # ------------------------------------------------------------------
    def get_user_ui_state(self, user_id: str) -> Dict[str, Any]:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT ui_state FROM users WHERE id = ?",
                (user_id,),
            ).fetchone()
        if row is None:
            return {}
        raw = row["ui_state"]
        return self._loads_json(raw, {}) if isinstance(raw, str) else (raw or {})

    def patch_user_ui_state(
        self,
        user_id: str,
        patch: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Shallow-merge ``patch`` into ``users.ui_state`` and return the new state.

        Raises ``ValueError("user_not_found")`` if the user row does not exist
        and ``ValueError("ui_state_too_large")`` if the merged blob exceeds the
        size cap enforced by ``schemas.ui_state.validate_merged_size``.
        """
        from src.schemas.ui_state import validate_merged_size  # local import to avoid cycle at module load

        def persist(connection: sqlite3.Connection) -> Dict[str, Any]:
            row = connection.execute(
                "SELECT ui_state FROM users WHERE id = ?",
                (user_id,),
            ).fetchone()
            if row is None:
                raise ValueError("user_not_found")
            current = self._loads_json(row["ui_state"], {}) if isinstance(row["ui_state"], str) else (row["ui_state"] or {})
            if not isinstance(current, dict):
                current = {}
            merged = dict(current)
            merged.update(patch)
            size_errors = validate_merged_size(merged)
            if size_errors:
                raise ValueError("ui_state_too_large")
            connection.execute(
                "UPDATE users SET ui_state = ? WHERE id = ?",
                (self._dumps_json(merged), user_id),
            )
            return merged

        return self._execute_write(persist)

    def reset_user_ui_state(self, user_id: str) -> Dict[str, Any]:
        def persist(connection: sqlite3.Connection) -> Dict[str, Any]:
            row = connection.execute(
                "SELECT id FROM users WHERE id = ?",
                (user_id,),
            ).fetchone()
            if row is None:
                raise ValueError("user_not_found")
            connection.execute(
                "UPDATE users SET ui_state = ? WHERE id = ?",
                ("{}", user_id),
            )
            return {}

        return self._execute_write(persist)

    def log_ui_state_audit(
        self,
        *,
        user_id: str,
        event: str,
        payload: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Append-only UX audit. Payload carries KEY names only, never values."""
        created_at = self._utc_now()

        def persist(connection: sqlite3.Connection) -> None:
            connection.execute(
                """
                INSERT INTO ui_state_audit (user_id, event, payload_json, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (user_id, event, self._dumps_json(payload or {}), created_at),
            )

        self._execute_write(persist)

    def list_ui_state_audit(self, user_id: str, *, limit: int = 50) -> List[Dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT id, user_id, event, payload_json, created_at
                FROM ui_state_audit
                WHERE user_id = ?
                ORDER BY id DESC
                LIMIT ?
                """,
                (user_id, max(1, min(int(limit), 500))),
            ).fetchall()
        return [
            {
                "id": row["id"],
                "user_id": row["user_id"],
                "event": row["event"],
                "payload": self._loads_json(row["payload_json"], {}),
                "created_at": row["created_at"],
            }
            for row in rows
        ]

    def get_child_ui_state(self, child_id: str, user_id: str) -> Dict[str, Any]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT exercise_type, first_run_at, updated_at
                FROM child_ui_state
                WHERE child_id = ? AND user_id = ?
                ORDER BY updated_at DESC
                """,
                (child_id, user_id),
            ).fetchall()
        return {
            "child_id": child_id,
            "user_id": user_id,
            "exercises": [
                {
                    "exercise_type": row["exercise_type"],
                    "first_run_at": row["first_run_at"],
                    "updated_at": row["updated_at"],
                }
                for row in rows
            ],
        }

    def put_child_ui_state_first_run(
        self,
        *,
        child_id: str,
        user_id: str,
        exercise_type: str,
        first_run: bool,
    ) -> Dict[str, Any]:
        """Record or clear the first-run marker for ``(child, user, exercise_type)``."""
        now = self._utc_now()
        first_run_at = now if first_run else None

        def persist(connection: sqlite3.Connection) -> Dict[str, Any]:
            connection.execute(
                """
                INSERT INTO child_ui_state (child_id, user_id, exercise_type, first_run_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(child_id, user_id, exercise_type) DO UPDATE SET
                    first_run_at = excluded.first_run_at,
                    updated_at = excluded.updated_at
                """,
                (child_id, user_id, exercise_type, first_run_at, now),
            )
            row = connection.execute(
                """
                SELECT child_id, user_id, exercise_type, first_run_at, updated_at
                FROM child_ui_state
                WHERE child_id = ? AND user_id = ? AND exercise_type = ?
                """,
                (child_id, user_id, exercise_type),
            ).fetchone()
            assert row is not None
            return {
                "child_id": row["child_id"],
                "user_id": row["user_id"],
                "exercise_type": row["exercise_type"],
                "first_run_at": row["first_run_at"],
                "updated_at": row["updated_at"],
            }

        return self._execute_write(persist)

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

        def persist_invitation(connection: sqlite3.Connection) -> None:
            nonlocal reused_invitation_id

            # Resolve workspace_id from the child
            child_row = connection.execute(
                "SELECT workspace_id FROM children WHERE id = ?", (child_id,),
            ).fetchone()
            resolved_workspace_id = child_row["workspace_id"] if child_row is not None else None

            connection.execute(
                """
                UPDATE child_invitations
                SET status = 'expired', updated_at = ?, responded_at = COALESCE(responded_at, ?)
                WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < ?
                """,
                (created_at, created_at, created_at),
            )
            existing = connection.execute(
                """
                SELECT id
                FROM child_invitations
                WHERE child_id = ? AND LOWER(invited_email) = ? AND relationship = ? AND status = 'pending'
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
                    SET updated_at = ?, responded_at = NULL, expires_at = ?, workspace_id = ?
                    WHERE id = ?
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
                VALUES (?, ?, ?, ?, 'pending', ?, NULL, ?, ?, NULL, ?, ?)
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
                WHERE child_invitations.id = ?
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
                WHERE child_invitations.invited_by_user_id = ? OR LOWER(child_invitations.invited_email) = ?
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

        def persist_response(connection: sqlite3.Connection) -> Optional[str]:
            row = connection.execute(
                """
                SELECT id, child_id, invited_email, relationship, status, expires_at
                FROM child_invitations
                WHERE id = ?
                """,
                (invitation_id,),
            ).fetchone()
            if row is None:
                return None
            if str(row["status"] or "") == "pending" and row["expires_at"] and str(row["expires_at"]) < responded_at:
                connection.execute(
                    "UPDATE child_invitations SET status = 'expired', updated_at = ?, responded_at = COALESCE(responded_at, ?) WHERE id = ?",
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
                SET status = ?, accepted_by_user_id = ?, updated_at = ?, responded_at = ?
                WHERE id = ? AND status = 'pending'
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
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(user_id, child_id) DO UPDATE SET relationship = excluded.relationship
                    """,
                    (user_id, row["child_id"], row["relationship"], responded_at),
                )

                # Grant workspace membership if the child belongs to a workspace
                child_ws = connection.execute(
                    "SELECT workspace_id FROM children WHERE id = ?",
                    (row["child_id"],),
                ).fetchone()
                if child_ws is not None and child_ws["workspace_id"] is not None:
                    ws_role = WORKSPACE_ROLE_PARENT if row["relationship"] == CHILD_RELATIONSHIP_PARENT else WORKSPACE_ROLE_THERAPIST
                    connection.execute(
                        """
                        INSERT INTO workspace_members (workspace_id, user_id, role, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?)
                        ON CONFLICT(workspace_id, user_id) DO NOTHING
                        """,
                        (child_ws["workspace_id"], user_id, ws_role, responded_at, responded_at),
                    )

                # If user is pending_therapist, downgrade to parent on invitation acceptance
                user_row = connection.execute("SELECT role FROM users WHERE id = ?", (user_id,)).fetchone()
                if user_row is not None and user_row["role"] == ROLE_PENDING_THERAPIST:
                    connection.execute("UPDATE users SET role = ? WHERE id = ?", (ROLE_PARENT, user_id))

            return str(row["child_id"])

        child_id = self._execute_write(persist_response)
        if child_id is None:
            return None
        return self.get_child_invitation(invitation_id, current_email=normalized_email)

    def revoke_child_invitation(self, invitation_id: str) -> Optional[Dict[str, Any]]:
        revoked_at = self._utc_now()

        def persist_revoke(connection: sqlite3.Connection) -> int:
            cursor = connection.execute(
                """
                UPDATE child_invitations
                SET status = 'revoked', updated_at = ?, responded_at = ?
                WHERE id = ? AND status = 'pending'
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

        def persist_resend(connection: sqlite3.Connection) -> int:
            cursor = connection.execute(
                """
                UPDATE child_invitations
                SET status = 'pending',
                    accepted_by_user_id = NULL,
                    updated_at = ?,
                    responded_at = NULL,
                    expires_at = ?
                WHERE id = ? AND status IN ('pending', 'declined', 'revoked', 'expired')
                """,
                (resent_at, expires_at, invitation_id),
            )
            return cursor.rowcount

        rowcount = self._execute_write(persist_resend)
        if rowcount == 0:
            return None
        return self.get_child_invitation(invitation_id)

    def create_family_intake_invitation(
        self,
        *,
        invited_email: str,
        invited_by_user_id: str,
        workspace_id: str,
    ) -> Dict[str, Any]:
        normalized_email = str(invited_email or "").strip().lower()
        normalized_workspace_id = str(workspace_id or "").strip()
        if not normalized_email:
            raise ValueError("invited_email is required")
        if not normalized_workspace_id:
            raise ValueError("workspace_id is required")

        invitation_id = f"family-invite-{uuid4().hex[:12]}"
        created_at = self._utc_now()
        expires_at = self._invitation_expiry_timestamp(created_at)
        reused_invitation_id: Optional[str] = None

        def persist_invitation(connection: sqlite3.Connection) -> None:
            nonlocal reused_invitation_id
            workspace_member = connection.execute(
                "SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
                (normalized_workspace_id, invited_by_user_id),
            ).fetchone()
            if workspace_member is None:
                raise ValueError("User is not a member of the specified workspace")

            connection.execute(
                """
                UPDATE family_intake_invitations
                SET status = 'expired', updated_at = ?, responded_at = COALESCE(responded_at, ?)
                WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < ?
                """,
                (created_at, created_at, created_at),
            )
            existing = connection.execute(
                """
                SELECT id
                FROM family_intake_invitations
                WHERE workspace_id = ? AND LOWER(invited_email) = ? AND status = 'pending'
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (normalized_workspace_id, normalized_email),
            ).fetchone()
            if existing is not None:
                reused_invitation_id = str(existing["id"])
                connection.execute(
                    """
                    UPDATE family_intake_invitations
                    SET updated_at = ?, responded_at = NULL, expires_at = ?
                    WHERE id = ?
                    """,
                    (created_at, expires_at, reused_invitation_id),
                )
                return

            connection.execute(
                """
                INSERT INTO family_intake_invitations (
                    id, workspace_id, invited_email, invited_by_user_id, status,
                    accepted_by_user_id, created_at, updated_at, responded_at, expires_at
                )
                VALUES (?, ?, ?, ?, 'pending', NULL, ?, ?, NULL, ?)
                """,
                (
                    invitation_id,
                    normalized_workspace_id,
                    normalized_email,
                    invited_by_user_id,
                    created_at,
                    created_at,
                    expires_at,
                ),
            )

        self._execute_write(persist_invitation)
        invitation = self.get_family_intake_invitation(reused_invitation_id or invitation_id)
        if invitation is None:
            raise RuntimeError("Family intake invitation could not be reloaded after creation")
        return invitation

    def get_family_intake_invitation(self, invitation_id: str, *, current_email: Optional[str] = None) -> Optional[Dict[str, Any]]:
        self._expire_stale_family_intake_invitations()
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT
                    family_intake_invitations.id,
                    family_intake_invitations.workspace_id,
                    therapist_workspaces.name AS workspace_name,
                    family_intake_invitations.invited_email,
                    family_intake_invitations.invited_by_user_id,
                    inviter.name AS invited_by_name,
                    family_intake_invitations.accepted_by_user_id,
                    family_intake_invitations.status,
                    family_intake_invitations.created_at,
                    family_intake_invitations.updated_at,
                    family_intake_invitations.responded_at,
                    family_intake_invitations.expires_at
                FROM family_intake_invitations
                INNER JOIN therapist_workspaces ON therapist_workspaces.id = family_intake_invitations.workspace_id
                INNER JOIN users AS inviter ON inviter.id = family_intake_invitations.invited_by_user_id
                WHERE family_intake_invitations.id = ?
                """,
                (invitation_id,),
            ).fetchone()
        if row is None:
            return None
        return self._build_family_intake_invitation_payload(row, current_email=current_email)

    def list_family_intake_invitations_for_user(self, user_id: str, email: str) -> List[Dict[str, Any]]:
        normalized_email = str(email or "").strip().lower()
        self._expire_stale_family_intake_invitations()
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT
                    family_intake_invitations.id,
                    family_intake_invitations.workspace_id,
                    therapist_workspaces.name AS workspace_name,
                    family_intake_invitations.invited_email,
                    family_intake_invitations.invited_by_user_id,
                    inviter.name AS invited_by_name,
                    family_intake_invitations.accepted_by_user_id,
                    family_intake_invitations.status,
                    family_intake_invitations.created_at,
                    family_intake_invitations.updated_at,
                    family_intake_invitations.responded_at,
                    family_intake_invitations.expires_at
                FROM family_intake_invitations
                INNER JOIN therapist_workspaces ON therapist_workspaces.id = family_intake_invitations.workspace_id
                INNER JOIN users AS inviter ON inviter.id = family_intake_invitations.invited_by_user_id
                WHERE family_intake_invitations.invited_by_user_id = ? OR LOWER(family_intake_invitations.invited_email) = ?
                ORDER BY family_intake_invitations.updated_at DESC, family_intake_invitations.created_at DESC
                """,
                (user_id, normalized_email),
            ).fetchall()
        return [
            self._build_family_intake_invitation_payload(row, current_email=normalized_email)
            for row in rows
        ]

    def respond_to_family_intake_invitation(
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

        def persist_response(connection: sqlite3.Connection) -> Optional[str]:
            row = connection.execute(
                """
                SELECT id, workspace_id, invited_email, status, expires_at
                FROM family_intake_invitations
                WHERE id = ?
                """,
                (invitation_id,),
            ).fetchone()
            if row is None:
                return None
            if str(row["status"] or "") == "pending" and row["expires_at"] and str(row["expires_at"]) < responded_at:
                connection.execute(
                    "UPDATE family_intake_invitations SET status = 'expired', updated_at = ?, responded_at = COALESCE(responded_at, ?) WHERE id = ?",
                    (responded_at, responded_at, invitation_id),
                )
                raise ValueError("Invitation has expired")
            if str(row["status"] or "") != "pending":
                raise ValueError("Invitation is no longer pending")
            if str(row["invited_email"] or "").strip().lower() != normalized_email:
                raise ValueError("Invitation email does not match the authenticated user")

            connection.execute(
                """
                UPDATE family_intake_invitations
                SET status = ?, accepted_by_user_id = ?, updated_at = ?, responded_at = ?
                WHERE id = ? AND status = 'pending'
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
                user_row = connection.execute("SELECT role FROM users WHERE id = ?", (user_id,)).fetchone()
                if user_row is not None and user_row["role"] == ROLE_PENDING_THERAPIST:
                    connection.execute("UPDATE users SET role = ? WHERE id = ?", (ROLE_PARENT, user_id))

            return str(row["workspace_id"])

        workspace_id = self._execute_write(persist_response)
        if workspace_id is None:
            return None
        return self.get_family_intake_invitation(invitation_id, current_email=normalized_email)

    def _expire_stale_family_intake_invitations(self) -> None:
        now = self._utc_now()

        def persist_expiry(connection: sqlite3.Connection) -> None:
            connection.execute(
                """
                UPDATE family_intake_invitations
                SET status = 'expired', updated_at = ?, responded_at = COALESCE(responded_at, ?)
                WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < ?
                """,
                (now, now, now),
            )

        self._execute_write(persist_expiry)

    def create_child_intake_proposals(
        self,
        *,
        family_intake_invitation_id: str,
        created_by_user_id: str,
        proposals: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        if not proposals:
            raise ValueError("At least one child proposal is required")

        proposal_ids: List[str] = []
        created_at = self._utc_now()

        def persist_proposals(connection: sqlite3.Connection) -> None:
            invitation = connection.execute(
                """
                SELECT workspace_id, accepted_by_user_id, status
                FROM family_intake_invitations
                WHERE id = ?
                """,
                (family_intake_invitation_id,),
            ).fetchone()
            if invitation is None:
                raise ValueError("Family intake invitation not found")
            if str(invitation["status"] or "") != "accepted":
                raise ValueError("Family intake invitation must be accepted before submitting children")
            if str(invitation["accepted_by_user_id"] or "") != created_by_user_id:
                raise ValueError("Only the invited parent or guardian can submit child proposals")

            for proposal in proposals:
                child_name = str(proposal.get("child_name") or proposal.get("name") or "").strip()
                if not child_name:
                    raise ValueError("child_name is required for each child proposal")
                proposal_id = f"intake-proposal-{uuid4().hex[:12]}"
                proposal_ids.append(proposal_id)
                connection.execute(
                    """
                    INSERT INTO child_intake_proposals (
                        id, family_intake_invitation_id, workspace_id, created_by_user_id,
                        reviewed_by_user_id, final_child_id, child_name, date_of_birth, notes,
                        status, submitted_at, reviewed_at, review_note, created_at, updated_at
                    )
                    VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, 'submitted', ?, NULL, NULL, ?, ?)
                    """,
                    (
                        proposal_id,
                        family_intake_invitation_id,
                        invitation["workspace_id"],
                        created_by_user_id,
                        child_name,
                        str(proposal.get("date_of_birth") or "").strip() or None,
                        str(proposal.get("notes") or "").strip() or None,
                        created_at,
                        created_at,
                        created_at,
                    ),
                )

        self._execute_write(persist_proposals)
        return [
            proposal
            for proposal_id in proposal_ids
            for proposal in [self.get_child_intake_proposal(proposal_id)]
            if proposal is not None
        ]

    def get_child_intake_proposal(self, proposal_id: str) -> Optional[Dict[str, Any]]:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT
                    child_intake_proposals.id,
                    child_intake_proposals.family_intake_invitation_id,
                    child_intake_proposals.workspace_id,
                    therapist_workspaces.name AS workspace_name,
                    child_intake_proposals.created_by_user_id,
                    creator.name AS created_by_name,
                    child_intake_proposals.reviewed_by_user_id,
                    reviewer.name AS reviewed_by_name,
                    child_intake_proposals.final_child_id,
                    child_intake_proposals.child_name,
                    child_intake_proposals.date_of_birth,
                    child_intake_proposals.notes,
                    child_intake_proposals.status,
                    child_intake_proposals.submitted_at,
                    child_intake_proposals.reviewed_at,
                    child_intake_proposals.review_note,
                    child_intake_proposals.created_at,
                    child_intake_proposals.updated_at
                FROM child_intake_proposals
                INNER JOIN therapist_workspaces ON therapist_workspaces.id = child_intake_proposals.workspace_id
                INNER JOIN users AS creator ON creator.id = child_intake_proposals.created_by_user_id
                LEFT JOIN users AS reviewer ON reviewer.id = child_intake_proposals.reviewed_by_user_id
                WHERE child_intake_proposals.id = ?
                """,
                (proposal_id,),
            ).fetchone()
        if row is None:
            return None
        return self._build_child_intake_proposal_payload(row)

    def list_child_intake_proposals_for_user(self, user_id: str) -> List[Dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT
                    child_intake_proposals.id,
                    child_intake_proposals.family_intake_invitation_id,
                    child_intake_proposals.workspace_id,
                    therapist_workspaces.name AS workspace_name,
                    child_intake_proposals.created_by_user_id,
                    creator.name AS created_by_name,
                    child_intake_proposals.reviewed_by_user_id,
                    reviewer.name AS reviewed_by_name,
                    child_intake_proposals.final_child_id,
                    child_intake_proposals.child_name,
                    child_intake_proposals.date_of_birth,
                    child_intake_proposals.notes,
                    child_intake_proposals.status,
                    child_intake_proposals.submitted_at,
                    child_intake_proposals.reviewed_at,
                    child_intake_proposals.review_note,
                    child_intake_proposals.created_at,
                    child_intake_proposals.updated_at
                FROM child_intake_proposals
                INNER JOIN therapist_workspaces ON therapist_workspaces.id = child_intake_proposals.workspace_id
                INNER JOIN users AS creator ON creator.id = child_intake_proposals.created_by_user_id
                LEFT JOIN users AS reviewer ON reviewer.id = child_intake_proposals.reviewed_by_user_id
                WHERE child_intake_proposals.created_by_user_id = ?
                ORDER BY child_intake_proposals.updated_at DESC, child_intake_proposals.created_at DESC
                """,
                (user_id,),
            ).fetchall()
        return [self._build_child_intake_proposal_payload(row) for row in rows]

    def list_pending_child_intake_proposals(self, *, workspace_id: Optional[str] = None) -> List[Dict[str, Any]]:
        query = [
            """
            SELECT
                child_intake_proposals.id,
                child_intake_proposals.family_intake_invitation_id,
                child_intake_proposals.workspace_id,
                therapist_workspaces.name AS workspace_name,
                child_intake_proposals.created_by_user_id,
                creator.name AS created_by_name,
                child_intake_proposals.reviewed_by_user_id,
                reviewer.name AS reviewed_by_name,
                child_intake_proposals.final_child_id,
                child_intake_proposals.child_name,
                child_intake_proposals.date_of_birth,
                child_intake_proposals.notes,
                child_intake_proposals.status,
                child_intake_proposals.submitted_at,
                child_intake_proposals.reviewed_at,
                child_intake_proposals.review_note,
                child_intake_proposals.created_at,
                child_intake_proposals.updated_at
            FROM child_intake_proposals
            INNER JOIN therapist_workspaces ON therapist_workspaces.id = child_intake_proposals.workspace_id
            INNER JOIN users AS creator ON creator.id = child_intake_proposals.created_by_user_id
            LEFT JOIN users AS reviewer ON reviewer.id = child_intake_proposals.reviewed_by_user_id
            WHERE child_intake_proposals.status = 'submitted'
            """
        ]
        parameters: List[Any] = []
        if workspace_id is not None:
            query.append("AND child_intake_proposals.workspace_id = ?")
            parameters.append(workspace_id)
        query.append("ORDER BY child_intake_proposals.submitted_at DESC, child_intake_proposals.created_at DESC")

        with self._connect() as connection:
            rows = connection.execute("\n".join(query), parameters).fetchall()
        return [self._build_child_intake_proposal_payload(row) for row in rows]

    def approve_child_intake_proposal(
        self,
        proposal_id: str,
        *,
        reviewed_by_user_id: str,
        review_note: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        reviewed_at = self._utc_now()

        def persist_approval(connection: sqlite3.Connection) -> Optional[str]:
            proposal = connection.execute(
                """
                SELECT id, workspace_id, created_by_user_id, child_name, date_of_birth, notes, status
                FROM child_intake_proposals
                WHERE id = ?
                """,
                (proposal_id,),
            ).fetchone()
            if proposal is None:
                return None
            if str(proposal["status"] or "") != "submitted":
                raise ValueError("Proposal is not pending review")

            reviewer_membership = connection.execute(
                "SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
                (proposal["workspace_id"], reviewed_by_user_id),
            ).fetchone()
            if reviewer_membership is None or str(reviewer_membership["role"] or "") not in {
                WORKSPACE_ROLE_OWNER,
                WORKSPACE_ROLE_ADMIN,
                WORKSPACE_ROLE_THERAPIST,
            }:
                raise ValueError("Therapist workspace access required")

            child_id = f"child-{uuid4().hex[:12]}"
            connection.execute(
                """
                INSERT INTO children (id, name, date_of_birth, notes, deleted_at, created_at, workspace_id)
                VALUES (?, ?, ?, ?, NULL, ?, ?)
                """,
                (
                    child_id,
                    proposal["child_name"],
                    proposal["date_of_birth"],
                    proposal["notes"],
                    reviewed_at,
                    proposal["workspace_id"],
                ),
            )
            connection.execute(
                """
                INSERT INTO user_children (user_id, child_id, relationship, created_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(user_id, child_id) DO UPDATE SET relationship = excluded.relationship
                """,
                (reviewed_by_user_id, child_id, CHILD_RELATIONSHIP_THERAPIST, reviewed_at),
            )
            connection.execute(
                """
                INSERT INTO user_children (user_id, child_id, relationship, created_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(user_id, child_id) DO UPDATE SET relationship = excluded.relationship
                """,
                (proposal["created_by_user_id"], child_id, CHILD_RELATIONSHIP_PARENT, reviewed_at),
            )
            connection.execute(
                """
                INSERT INTO workspace_members (workspace_id, user_id, role, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(workspace_id, user_id) DO NOTHING
                """,
                (proposal["workspace_id"], proposal["created_by_user_id"], WORKSPACE_ROLE_PARENT, reviewed_at, reviewed_at),
            )
            connection.execute(
                """
                UPDATE child_intake_proposals
                SET status = 'approved', reviewed_by_user_id = ?, final_child_id = ?, reviewed_at = ?,
                    review_note = ?, updated_at = ?
                WHERE id = ?
                """,
                (reviewed_by_user_id, child_id, reviewed_at, review_note, reviewed_at, proposal_id),
            )
            return child_id

        child_id = self._execute_write(persist_approval)
        if child_id is None:
            return None
        return self.get_child_intake_proposal(proposal_id)

    def reject_child_intake_proposal(
        self,
        proposal_id: str,
        *,
        reviewed_by_user_id: str,
        review_note: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        reviewed_at = self._utc_now()

        def persist_rejection(connection: sqlite3.Connection) -> int:
            proposal = connection.execute(
                "SELECT workspace_id, status FROM child_intake_proposals WHERE id = ?",
                (proposal_id,),
            ).fetchone()
            if proposal is None:
                return 0
            if str(proposal["status"] or "") != "submitted":
                raise ValueError("Proposal is not pending review")
            reviewer_membership = connection.execute(
                "SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
                (proposal["workspace_id"], reviewed_by_user_id),
            ).fetchone()
            if reviewer_membership is None or str(reviewer_membership["role"] or "") not in {
                WORKSPACE_ROLE_OWNER,
                WORKSPACE_ROLE_ADMIN,
                WORKSPACE_ROLE_THERAPIST,
            }:
                raise ValueError("Therapist workspace access required")
            cursor = connection.execute(
                """
                UPDATE child_intake_proposals
                SET status = 'rejected', reviewed_by_user_id = ?, reviewed_at = ?, review_note = ?, updated_at = ?
                WHERE id = ?
                """,
                (reviewed_by_user_id, reviewed_at, review_note, reviewed_at, proposal_id),
            )
            return cursor.rowcount

        rowcount = self._execute_write(persist_rejection)
        if rowcount == 0:
            return None
        return self.get_child_intake_proposal(proposal_id)

    def resubmit_child_intake_proposal(
        self,
        proposal_id: str,
        *,
        created_by_user_id: str,
        child_name: str,
        date_of_birth: Optional[str] = None,
        notes: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        normalized_child_name = str(child_name or "").strip()
        if not normalized_child_name:
            raise ValueError("child_name is required")

        resubmitted_at = self._utc_now()

        def persist_resubmission(connection: sqlite3.Connection) -> int:
            proposal = connection.execute(
                "SELECT created_by_user_id, status FROM child_intake_proposals WHERE id = ?",
                (proposal_id,),
            ).fetchone()
            if proposal is None:
                return 0
            if str(proposal["created_by_user_id"] or "") != created_by_user_id:
                raise ValueError("Only the submitting parent or guardian can edit this proposal")
            if str(proposal["status"] or "") != "rejected":
                raise ValueError("Only rejected proposals can be edited and resubmitted")

            cursor = connection.execute(
                """
                UPDATE child_intake_proposals
                SET child_name = ?,
                    date_of_birth = ?,
                    notes = ?,
                    status = 'submitted',
                    submitted_at = ?,
                    reviewed_by_user_id = NULL,
                    reviewed_at = NULL,
                    review_note = NULL,
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    normalized_child_name,
                    date_of_birth,
                    notes,
                    resubmitted_at,
                    resubmitted_at,
                    proposal_id,
                ),
            )
            return cursor.rowcount

        rowcount = self._execute_write(persist_resubmission)
        if rowcount == 0:
            return None
        return self.get_child_intake_proposal(proposal_id)

    def record_child_invitation_email_delivery(
        self,
        invitation_id: str,
        delivery: Dict[str, Any],
    ) -> None:
        delivery_id = f"invite-email-{uuid4().hex[:12]}"
        created_at = self._utc_now()

        def persist_delivery(connection: sqlite3.Connection) -> None:
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
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    delivery_id,
                    invitation_id,
                    str(delivery.get("status") or "unknown"),
                    1 if bool(delivery.get("attempted")) else 0,
                    1 if bool(delivery.get("delivered")) else 0,
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
            query.append("ORDER BY children.name COLLATE NOCASE ASC")
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

    def save_progress_report(self, report_payload: Dict[str, Any]) -> Dict[str, Any]:
        report_id = str(report_payload.get("id") or f"report-{uuid4().hex[:12]}")
        child_id = str(report_payload.get("child_id") or "").strip()
        workspace_id = str(report_payload.get("workspace_id") or "").strip() or None
        created_by_user_id = str(report_payload.get("created_by_user_id") or "").strip()
        if not child_id:
            raise ValueError("child_id is required")
        if not created_by_user_id:
            raise ValueError("created_by_user_id is required")

        now = self._utc_now()
        created_at = str(report_payload.get("created_at") or now)
        updated_at = str(report_payload.get("updated_at") or now)

        def persist_report(connection: sqlite3.Connection) -> None:
            connection.execute(
                """
                INSERT INTO progress_reports (
                    id,
                    child_id,
                    workspace_id,
                    created_by_user_id,
                    signed_by_user_id,
                    audience,
                    report_type,
                    title,
                    status,
                    source,
                    period_start,
                    period_end,
                    included_session_ids_json,
                    snapshot_json,
                    sections_json,
                    redaction_overrides_json,
                    summary_text,
                    created_at,
                    updated_at,
                    approved_at,
                    signed_at,
                    archived_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    child_id = excluded.child_id,
                    workspace_id = excluded.workspace_id,
                    created_by_user_id = excluded.created_by_user_id,
                    signed_by_user_id = excluded.signed_by_user_id,
                    audience = excluded.audience,
                    report_type = excluded.report_type,
                    title = excluded.title,
                    status = excluded.status,
                    source = excluded.source,
                    period_start = excluded.period_start,
                    period_end = excluded.period_end,
                    included_session_ids_json = excluded.included_session_ids_json,
                    snapshot_json = excluded.snapshot_json,
                    sections_json = excluded.sections_json,
                    redaction_overrides_json = excluded.redaction_overrides_json,
                    summary_text = excluded.summary_text,
                    updated_at = excluded.updated_at,
                    approved_at = excluded.approved_at,
                    signed_at = excluded.signed_at,
                    archived_at = excluded.archived_at
                """,
                (
                    report_id,
                    child_id,
                    workspace_id,
                    created_by_user_id,
                    report_payload.get("signed_by_user_id"),
                    str(report_payload.get("audience") or "therapist"),
                    str(report_payload.get("report_type") or "progress_summary"),
                    str(report_payload.get("title") or "Child progress report"),
                    str(report_payload.get("status") or "draft"),
                    str(report_payload.get("source") or "pipeline"),
                    str(report_payload.get("period_start") or ""),
                    str(report_payload.get("period_end") or ""),
                    self._dumps_json(report_payload.get("included_session_ids") or []),
                    self._dumps_json(report_payload.get("snapshot") or {}),
                    self._dumps_json(report_payload.get("sections") or {}),
                    self._dumps_json(report_payload.get("redaction_overrides") or {}),
                    report_payload.get("summary_text"),
                    created_at,
                    updated_at,
                    report_payload.get("approved_at"),
                    report_payload.get("signed_at"),
                    report_payload.get("archived_at"),
                ),
            )

        self._execute_write(persist_report)

        report = self.get_progress_report(report_id)
        if report is None:
            raise RuntimeError("Progress report could not be reloaded after save")
        return report

    def list_progress_reports_for_child(
        self,
        child_id: str,
        status: Optional[str] = None,
        audience: Optional[str] = None,
        limit: int = 20,
    ) -> List[Dict[str, Any]]:
        query = [
            """
            SELECT
                id,
                child_id,
                workspace_id,
                created_by_user_id,
                signed_by_user_id,
                audience,
                report_type,
                title,
                status,
                source,
                period_start,
                period_end,
                included_session_ids_json,
                snapshot_json,
                sections_json,
                redaction_overrides_json,
                summary_text,
                created_at,
                updated_at,
                approved_at,
                signed_at,
                archived_at
            FROM progress_reports
            WHERE child_id = ?
            """
        ]
        parameters: List[Any] = [child_id]
        if status:
            query.append("AND status = ?")
            parameters.append(status)
        if audience:
            query.append("AND audience = ?")
            parameters.append(audience)
        query.append("ORDER BY created_at DESC")
        query.append("LIMIT ?")
        parameters.append(max(1, int(limit)))

        with self._connect() as connection:
            rows = connection.execute("\n".join(query), parameters).fetchall()

        return [self._build_progress_report_payload(row) for row in rows]

    def get_progress_report(self, report_id: str) -> Optional[Dict[str, Any]]:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT
                    id,
                    child_id,
                    workspace_id,
                    created_by_user_id,
                    signed_by_user_id,
                    audience,
                    report_type,
                    title,
                    status,
                    source,
                    period_start,
                    period_end,
                    included_session_ids_json,
                    snapshot_json,
                    sections_json,
                    redaction_overrides_json,
                    summary_text,
                    created_at,
                    updated_at,
                    approved_at,
                    signed_at,
                    archived_at
                FROM progress_reports
                WHERE id = ?
                """,
                (report_id,),
            ).fetchone()

        if row is None:
            return None

        return self._build_progress_report_payload(row)

    def update_progress_report(self, report_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        updated_at = self._utc_now()

        def persist_update(connection: sqlite3.Connection) -> int:
            cursor = connection.execute(
                """
                UPDATE progress_reports
                SET
                    audience = ?,
                    title = ?,
                    period_start = ?,
                    period_end = ?,
                    included_session_ids_json = ?,
                    snapshot_json = ?,
                    sections_json = ?,
                    redaction_overrides_json = ?,
                    summary_text = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    str(updates.get("audience") or "therapist"),
                    str(updates.get("title") or "Child progress report"),
                    str(updates.get("period_start") or ""),
                    str(updates.get("period_end") or ""),
                    self._dumps_json(updates.get("included_session_ids") or []),
                    self._dumps_json(updates.get("snapshot") or {}),
                    self._dumps_json(updates.get("sections") or {}),
                    self._dumps_json(updates.get("redaction_overrides") or {}),
                    updates.get("summary_text"),
                    updated_at,
                    report_id,
                ),
            )
            return cursor.rowcount

        rowcount = self._execute_write(persist_update)
        if rowcount == 0:
            return None

        return self.get_progress_report(report_id)

    def approve_progress_report(self, report_id: str) -> Optional[Dict[str, Any]]:
        approved_at = self._utc_now()

        def persist_approval(connection: sqlite3.Connection) -> int:
            cursor = connection.execute(
                """
                UPDATE progress_reports
                SET status = ?, approved_at = ?, updated_at = ?
                WHERE id = ?
                """,
                ("approved", approved_at, approved_at, report_id),
            )
            return cursor.rowcount

        rowcount = self._execute_write(persist_approval)
        if rowcount == 0:
            return None

        return self.get_progress_report(report_id)

    def sign_progress_report(self, report_id: str, signed_by_user_id: str) -> Optional[Dict[str, Any]]:
        signed_at = self._utc_now()

        def persist_signature(connection: sqlite3.Connection) -> int:
            cursor = connection.execute(
                """
                UPDATE progress_reports
                SET status = ?, signed_by_user_id = ?, signed_at = ?, updated_at = ?
                WHERE id = ?
                """,
                ("signed", signed_by_user_id, signed_at, signed_at, report_id),
            )
            return cursor.rowcount

        rowcount = self._execute_write(persist_signature)
        if rowcount == 0:
            return None

        return self.get_progress_report(report_id)

    def archive_progress_report(self, report_id: str) -> Optional[Dict[str, Any]]:
        archived_at = self._utc_now()

        def persist_archive(connection: sqlite3.Connection) -> int:
            cursor = connection.execute(
                """
                UPDATE progress_reports
                SET status = ?, archived_at = ?, updated_at = ?
                WHERE id = ?
                """,
                ("archived", archived_at, archived_at, report_id),
            )
            return cursor.rowcount

        rowcount = self._execute_write(persist_archive)
        if rowcount == 0:
            return None

        return self.get_progress_report(report_id)

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
        owner_user_id: str,
        insights: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        created_at = self._utc_now()

        def persist_insights(connection: sqlite3.Connection) -> None:
            connection.execute(
                "DELETE FROM institutional_memory_insights WHERE owner_user_id = ?",
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
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            FROM institutional_memory_insights
            WHERE owner_user_id = ?
            """
        ]
        parameters: List[Any] = [owner_user_id]
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
        privacy_accepted: bool = False,
        terms_accepted: bool = False,
        ai_notice_accepted: bool = False,
        personal_data_consent_accepted: bool = False,
        special_category_consent_accepted: bool = False,
        parental_responsibility_confirmed: bool = False,
        recorded_by_user_id: str,
    ) -> Dict[str, Any]:
        consent_id = str(uuid4())
        now = self._utc_now()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO parental_consents
                    (id, child_id, guardian_name, guardian_email, consent_type,
                     privacy_accepted, terms_accepted, ai_notice_accepted,
                     personal_data_consent_accepted, special_category_consent_accepted,
                     parental_responsibility_confirmed, recorded_by_user_id, consented_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    consent_id, child_id, guardian_name, guardian_email, consent_type,
                    privacy_accepted, terms_accepted, ai_notice_accepted,
                    personal_data_consent_accepted, special_category_consent_accepted,
                    parental_responsibility_confirmed,
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
            "personal_data_consent_accepted": personal_data_consent_accepted,
            "special_category_consent_accepted": special_category_consent_accepted,
            "parental_responsibility_confirmed": parental_responsibility_confirmed,
            "consented_at": now,
            "withdrawn_at": None,
        }

    def get_parental_consent(self, child_id: str) -> Optional[Dict[str, Any]]:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT id, child_id, guardian_name, guardian_email, consent_type,
                      privacy_accepted, terms_accepted, ai_notice_accepted,
                      personal_data_consent_accepted, special_category_consent_accepted,
                      parental_responsibility_confirmed, recorded_by_user_id, consented_at, withdrawn_at
                FROM parental_consents
                WHERE child_id = ? AND withdrawn_at IS NULL
                ORDER BY consented_at DESC LIMIT 1
                """,
                (child_id,),
            ).fetchone()
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
            "personal_data_consent_accepted": bool(row[8]),
            "special_category_consent_accepted": bool(row[9]),
            "parental_responsibility_confirmed": bool(row[10]),
            "recorded_by_user_id": row[11],
            "consented_at": row[12],
            "withdrawn_at": row[13],
        }

    def withdraw_parental_consent(self, child_id: str) -> bool:
        now = self._utc_now()
        with self._connect() as conn:
            cursor = conn.execute(
                """
                UPDATE parental_consents SET withdrawn_at = ?
                WHERE child_id = ? AND withdrawn_at IS NULL
                """,
                (now, child_id),
            )
        return cursor.rowcount > 0

    # ------------------------------------------------------------------
    # Data export
    # ------------------------------------------------------------------

    def export_child_data(self, child_id: str) -> Dict[str, Any]:
        with self._connect() as conn:
            child_row = conn.execute(
                "SELECT id, name, created_at FROM children WHERE id = ?",
                (child_id,),
            ).fetchone()
            if child_row is None:
                return {}

            sessions = [
                {
                    "id": r[0], "scenario_id": r[1], "started_at": r[2],
                    "finished_at": r[3], "transcript": r[4],
                    "summary_json": json.loads(r[5]) if r[5] else None,
                    "created_at": r[6],
                }
                for r in conn.execute(
                    "SELECT id, scenario_id, started_at, finished_at, transcript, summary_json, created_at FROM sessions WHERE child_id = ? ORDER BY created_at",
                    (child_id,),
                ).fetchall()
            ]

            memory_items = [
                {
                    "id": r[0], "category": r[1],
                    "content": json.loads(r[2]) if r[2] else None,
                    "created_at": r[3],
                }
                for r in conn.execute(
                    "SELECT id, category, content_json, created_at FROM child_memory_items WHERE child_id = ? ORDER BY created_at",
                    (child_id,),
                ).fetchall()
            ]

            plans = [
                {
                    "id": r[0], "plan_data": json.loads(r[1]) if r[1] else None,
                    "status": r[2], "created_at": r[3],
                }
                for r in conn.execute(
                    "SELECT id, plan_data_json, status, created_at FROM practice_plans WHERE child_id = ? ORDER BY created_at",
                    (child_id,),
                ).fetchall()
            ]

            consent_row = conn.execute(
                "SELECT guardian_name, guardian_email, consented_at, withdrawn_at FROM parental_consents WHERE child_id = ? ORDER BY consented_at DESC LIMIT 1",
                (child_id,),
            ).fetchone()

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
            child = conn.execute(
                "SELECT id FROM children WHERE id = ?", (child_id,)
            ).fetchone()
            if child is None:
                return False
            conn.execute("DELETE FROM parental_consents WHERE child_id = ?", (child_id,))
            conn.execute("DELETE FROM child_memory_items WHERE child_id = ?", (child_id,))
            conn.execute("DELETE FROM child_memory_proposals WHERE child_id = ?", (child_id,))
            conn.execute("DELETE FROM recommendation_candidates WHERE recommendation_log_id IN (SELECT id FROM recommendation_logs WHERE child_id = ?)", (child_id,))
            conn.execute("DELETE FROM recommendation_logs WHERE child_id = ?", (child_id,))
            conn.execute("DELETE FROM progress_reports WHERE child_id = ?", (child_id,))
            conn.execute("DELETE FROM practice_plans WHERE child_id = ?", (child_id,))
            conn.execute("DELETE FROM sessions WHERE child_id = ?", (child_id,))
            conn.execute("DELETE FROM child_memory_summaries WHERE child_id = ?", (child_id,))
            conn.execute("DELETE FROM user_children WHERE child_id = ?", (child_id,))
            # Cascade insights conversations scoped to this child. Conversation-level
            # delete removes messages via ON DELETE CASCADE.
            conn.execute(
                "DELETE FROM insight_conversations WHERE scope_child_id = ?",
                (child_id,),
            )
            conn.execute("DELETE FROM children WHERE id = ?", (child_id,))
            return True

    # ------------------------------------------------------------------
    # Insights Agent conversations (Phase 4)
    # ------------------------------------------------------------------

    def create_insight_conversation(
        self,
        *,
        user_id: str,
        scope_type: str,
        prompt_version: str,
        workspace_id: Optional[str] = None,
        scope_child_id: Optional[str] = None,
        scope_session_id: Optional[str] = None,
        scope_report_id: Optional[str] = None,
        title: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Create a new insights conversation row and return its payload."""
        conversation_id = f"insight-conv-{uuid4().hex[:12]}"
        now = self._utc_now()
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO insight_conversations (
                    id, user_id, workspace_id, scope_type,
                    scope_child_id, scope_session_id, scope_report_id,
                    title, prompt_version, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    conversation_id,
                    user_id,
                    workspace_id,
                    scope_type,
                    scope_child_id,
                    scope_session_id,
                    scope_report_id,
                    title,
                    prompt_version,
                    now,
                    now,
                ),
            )
        return {
            "id": conversation_id,
            "user_id": user_id,
            "workspace_id": workspace_id,
            "scope_type": scope_type,
            "scope_child_id": scope_child_id,
            "scope_session_id": scope_session_id,
            "scope_report_id": scope_report_id,
            "title": title,
            "prompt_version": prompt_version,
            "created_at": now,
            "updated_at": now,
        }

    def list_insight_conversations_for_user(
        self,
        user_id: str,
        *,
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        clamped_limit = max(1, min(int(limit or 50), 200))
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT id, user_id, workspace_id, scope_type,
                       scope_child_id, scope_session_id, scope_report_id,
                       title, prompt_version, created_at, updated_at
                FROM insight_conversations
                WHERE user_id = ? AND deleted_at IS NULL
                ORDER BY updated_at DESC
                LIMIT ?
                """,
                (user_id, clamped_limit),
            ).fetchall()
        return [dict(row) for row in rows]

    def get_insight_conversation(
        self,
        conversation_id: str,
        *,
        user_id: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT id, user_id, workspace_id, scope_type,
                       scope_child_id, scope_session_id, scope_report_id,
                       title, prompt_version, created_at, updated_at
                FROM insight_conversations
                WHERE id = ? AND deleted_at IS NULL
                """,
                (conversation_id,),
            ).fetchone()
        if row is None:
            return None
        payload = dict(row)
        if user_id is not None and payload.get("user_id") != user_id:
            return None
        return payload

    def list_insight_messages(
        self,
        conversation_id: str,
    ) -> List[Dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT id, conversation_id, role, content_text,
                       citations_json, visualizations_json, tool_trace_json,
                       latency_ms, tool_calls_count, prompt_version,
                       error_text, created_at
                FROM insight_messages
                WHERE conversation_id = ?
                ORDER BY created_at ASC, id ASC
                """,
                (conversation_id,),
            ).fetchall()
        messages: List[Dict[str, Any]] = []
        for row in rows:
            messages.append(
                {
                    "id": row["id"],
                    "conversation_id": row["conversation_id"],
                    "role": row["role"],
                    "content_text": row["content_text"],
                    "citations": self._loads_json(row["citations_json"], []),
                    "visualizations": self._loads_json(row["visualizations_json"], []),
                    "tool_trace": self._loads_json(row["tool_trace_json"], []),
                    "latency_ms": row["latency_ms"],
                    "tool_calls_count": row["tool_calls_count"],
                    "prompt_version": row["prompt_version"],
                    "error_text": row["error_text"],
                    "created_at": row["created_at"],
                }
            )
        return messages

    def append_insight_message(
        self,
        conversation_id: str,
        *,
        role: str,
        content_text: str,
        citations: Optional[List[Dict[str, Any]]] = None,
        visualizations: Optional[List[Dict[str, Any]]] = None,
        tool_trace: Optional[List[Dict[str, Any]]] = None,
        latency_ms: Optional[int] = None,
        tool_calls_count: Optional[int] = None,
        prompt_version: Optional[str] = None,
        error_text: Optional[str] = None,
    ) -> Dict[str, Any]:
        message_id = f"insight-msg-{uuid4().hex[:12]}"
        now = self._utc_now()
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO insight_messages (
                    id, conversation_id, role, content_text,
                    citations_json, visualizations_json, tool_trace_json,
                    latency_ms, tool_calls_count, prompt_version,
                    error_text, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    message_id,
                    conversation_id,
                    role,
                    content_text,
                    self._dumps_json(citations or []),
                    self._dumps_json(visualizations or []),
                    self._dumps_json(tool_trace or []),
                    latency_ms,
                    tool_calls_count,
                    prompt_version,
                    error_text,
                    now,
                ),
            )
            connection.execute(
                "UPDATE insight_conversations SET updated_at = ? WHERE id = ?",
                (now, conversation_id),
            )
        return {
            "id": message_id,
            "conversation_id": conversation_id,
            "role": role,
            "content_text": content_text,
            "citations": list(citations or []),
            "visualizations": list(visualizations or []),
            "tool_trace": list(tool_trace or []),
            "latency_ms": latency_ms,
            "tool_calls_count": tool_calls_count,
            "prompt_version": prompt_version,
            "error_text": error_text,
            "created_at": now,
        }

    def update_insight_conversation_title(
        self,
        conversation_id: str,
        title: str,
    ) -> None:
        with self._connect() as connection:
            connection.execute(
                "UPDATE insight_conversations SET title = ?, updated_at = ? WHERE id = ?",
                (title, self._utc_now(), conversation_id),
            )
        return True