"""Migrate Wulo data from SQLite to PostgreSQL with an optional parity report."""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

REPO_DIR = Path(__file__).resolve().parents[1]
BACKEND_DIR = REPO_DIR / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from src.services.postgres_migrations import run_postgres_migrations

TABLES = (
    "app_settings",
    "children",
    "users",
    "user_children",
    "child_invitations",
    "audit_log",
    "exercises",
    "sessions",
    "practice_plans",
    "child_memory_items",
    "child_memory_proposals",
    "child_memory_evidence_links",
    "child_memory_summaries",
    "recommendation_logs",
    "recommendation_candidates",
    "institutional_memory_insights",
)


def _sqlite_table_exists(sqlite_connection: sqlite3.Connection, table_name: str) -> bool:
    row = sqlite_connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table_name,),
    ).fetchone()
    return row is not None


def _connect_sqlite(sqlite_path: str) -> sqlite3.Connection:
    connection = sqlite3.connect(sqlite_path)
    connection.row_factory = sqlite3.Row
    return connection


def _connect_postgres(database_url: str) -> psycopg.Connection[Any]:
    return psycopg.connect(database_url, row_factory=dict_row)


def _sqlite_columns(sqlite_connection: sqlite3.Connection, table_name: str) -> set[str]:
    return {
        str(row[1])
        for row in sqlite_connection.execute(f"PRAGMA table_info({table_name})").fetchall()  # noqa: S608
    }


def _loads_json(value: Any, fallback: Any) -> Any:
    if value is None or value == "":
        return fallback
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(str(value))
    except json.JSONDecodeError:
        return fallback


def _copy_app_settings(sqlite_connection: sqlite3.Connection, postgres_connection: psycopg.Connection[Any]) -> None:
    rows = sqlite_connection.execute("SELECT key, value, updated_at FROM app_settings").fetchall()
    for row in rows:
        postgres_connection.execute(
            """
            INSERT INTO app_settings (key, value, updated_at)
            VALUES (%s, %s, %s)
            ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = excluded.updated_at
            """,
            (row["key"], row["value"], row["updated_at"]),
        )


def _copy_children(sqlite_connection: sqlite3.Connection, postgres_connection: psycopg.Connection[Any]) -> None:
    columns = _sqlite_columns(sqlite_connection, "children")
    rows = sqlite_connection.execute("SELECT * FROM children").fetchall()
    for row in rows:
        postgres_connection.execute(
            """
            INSERT INTO children (id, name, date_of_birth, notes, deleted_at, created_at)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                date_of_birth = excluded.date_of_birth,
                notes = excluded.notes,
                deleted_at = excluded.deleted_at,
                created_at = excluded.created_at
            """,
            (
                row["id"],
                row["name"],
                row["date_of_birth"] if "date_of_birth" in columns else None,
                row["notes"] if "notes" in columns else None,
                row["deleted_at"] if "deleted_at" in columns else None,
                row["created_at"],
            ),
        )


def _copy_users(sqlite_connection: sqlite3.Connection, postgres_connection: psycopg.Connection[Any]) -> None:
    rows = sqlite_connection.execute(
        "SELECT id, email, name, provider, role, created_at FROM users"
    ).fetchall()
    for row in rows:
        postgres_connection.execute(
            """
            INSERT INTO users (id, email, name, provider, role, created_at)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT(id) DO UPDATE SET
                email = excluded.email,
                name = excluded.name,
                provider = excluded.provider,
                role = excluded.role,
                created_at = excluded.created_at
            """,
            (row["id"], row["email"], row["name"], row["provider"], row["role"], row["created_at"]),
        )


def _copy_user_children(sqlite_connection: sqlite3.Connection, postgres_connection: psycopg.Connection[Any]) -> None:
    if not _sqlite_table_exists(sqlite_connection, "user_children"):
        return

    rows = sqlite_connection.execute(
        "SELECT user_id, child_id, relationship, created_at FROM user_children"
    ).fetchall()
    for row in rows:
        postgres_connection.execute(
            """
            INSERT INTO user_children (user_id, child_id, relationship, created_at)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT(user_id, child_id) DO UPDATE SET
                relationship = excluded.relationship,
                created_at = excluded.created_at
            """,
            (row["user_id"], row["child_id"], row["relationship"], row["created_at"]),
        )


def _copy_child_invitations(sqlite_connection: sqlite3.Connection, postgres_connection: psycopg.Connection[Any]) -> None:
    if not _sqlite_table_exists(sqlite_connection, "child_invitations"):
        return

    rows = sqlite_connection.execute(
        """
        SELECT
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
            expires_at
        FROM child_invitations
        """
    ).fetchall()
    for row in rows:
        postgres_connection.execute(
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
                expires_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT(id) DO UPDATE SET
                child_id = excluded.child_id,
                invited_email = excluded.invited_email,
                relationship = excluded.relationship,
                status = excluded.status,
                invited_by_user_id = excluded.invited_by_user_id,
                accepted_by_user_id = excluded.accepted_by_user_id,
                created_at = excluded.created_at,
                updated_at = excluded.updated_at,
                responded_at = excluded.responded_at,
                expires_at = excluded.expires_at
            """,
            (
                row["id"],
                row["child_id"],
                row["invited_email"],
                row["relationship"],
                row["status"],
                row["invited_by_user_id"],
                row["accepted_by_user_id"],
                row["created_at"],
                row["updated_at"],
                row["responded_at"],
                row["expires_at"],
            ),
        )


def _copy_audit_log(sqlite_connection: sqlite3.Connection, postgres_connection: psycopg.Connection[Any]) -> None:
    if not _sqlite_table_exists(sqlite_connection, "audit_log"):
        return

    rows = sqlite_connection.execute(
        "SELECT id, user_id, action, resource_type, resource_id, child_id, metadata_json, created_at FROM audit_log"
    ).fetchall()
    for row in rows:
        postgres_connection.execute(
            """
            INSERT INTO audit_log (id, user_id, action, resource_type, resource_id, child_id, metadata_json, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT(id) DO UPDATE SET
                user_id = excluded.user_id,
                action = excluded.action,
                resource_type = excluded.resource_type,
                resource_id = excluded.resource_id,
                child_id = excluded.child_id,
                metadata_json = excluded.metadata_json,
                created_at = excluded.created_at
            """,
            (
                row["id"],
                row["user_id"],
                row["action"],
                row["resource_type"],
                row["resource_id"],
                row["child_id"],
                Jsonb(_loads_json(row["metadata_json"], {})),
                row["created_at"],
            ),
        )


def _copy_exercises(sqlite_connection: sqlite3.Connection, postgres_connection: psycopg.Connection[Any]) -> None:
    rows = sqlite_connection.execute(
        "SELECT id, name, description, metadata_json, is_custom, updated_at FROM exercises"
    ).fetchall()
    for row in rows:
        postgres_connection.execute(
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
                row["id"],
                row["name"],
                row["description"],
                Jsonb(_loads_json(row["metadata_json"], {})),
                bool(row["is_custom"]),
                row["updated_at"],
            ),
        )


def _copy_sessions(sqlite_connection: sqlite3.Connection, postgres_connection: psycopg.Connection[Any]) -> None:
    rows = sqlite_connection.execute(
        """
        SELECT
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
        FROM sessions
        """
    ).fetchall()
    for row in rows:
        postgres_connection.execute(
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
            ON CONFLICT(id) DO UPDATE SET
                child_id = excluded.child_id,
                exercise_id = excluded.exercise_id,
                timestamp = excluded.timestamp,
                ai_assessment_json = excluded.ai_assessment_json,
                pronunciation_json = excluded.pronunciation_json,
                exercise_metadata_json = excluded.exercise_metadata_json,
                transcript = excluded.transcript,
                reference_text = excluded.reference_text,
                feedback_rating = excluded.feedback_rating,
                feedback_note = excluded.feedback_note,
                feedback_submitted_at = excluded.feedback_submitted_at
            """,
            (
                row["id"],
                row["child_id"],
                row["exercise_id"],
                row["timestamp"],
                Jsonb(_loads_json(row["ai_assessment_json"], {})),
                Jsonb(_loads_json(row["pronunciation_json"], {})),
                Jsonb(_loads_json(row["exercise_metadata_json"], {})),
                row["transcript"],
                row["reference_text"],
                row["feedback_rating"],
                row["feedback_note"],
                row["feedback_submitted_at"],
            ),
        )


def _copy_practice_plans(sqlite_connection: sqlite3.Connection, postgres_connection: psycopg.Connection[Any]) -> None:
    rows = sqlite_connection.execute(
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
        """
    ).fetchall()
    for row in rows:
        postgres_connection.execute(
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
                created_at = excluded.created_at,
                updated_at = excluded.updated_at,
                approved_at = excluded.approved_at
            """,
            (
                row["id"],
                row["child_id"],
                row["source_session_id"],
                row["status"],
                row["title"],
                row["plan_type"],
                Jsonb(_loads_json(row["constraints_json"], {})),
                Jsonb(_loads_json(row["draft_json"], {})),
                Jsonb(_loads_json(row["conversation_json"], [])),
                row["planner_session_id"],
                row["created_by_user_id"],
                row["created_at"],
                row["updated_at"],
                row["approved_at"],
            ),
        )


def _copy_child_memory_items(
    sqlite_connection: sqlite3.Connection, postgres_connection: psycopg.Connection[Any]
) -> None:
    if not _sqlite_table_exists(sqlite_connection, "child_memory_items"):
        return

    rows = sqlite_connection.execute(
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
        """
    ).fetchall()
    for row in rows:
        postgres_connection.execute(
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
                created_at = excluded.created_at,
                updated_at = excluded.updated_at,
                reviewed_at = excluded.reviewed_at,
                expires_at = excluded.expires_at
            """,
            (
                row["id"],
                row["child_id"],
                row["category"],
                row["memory_type"],
                row["status"],
                row["statement"],
                Jsonb(_loads_json(row["detail_json"], {})),
                row["confidence"],
                Jsonb(_loads_json(row["provenance_json"], {})),
                row["author_type"],
                row["author_user_id"],
                row["source_proposal_id"],
                row["superseded_by_item_id"],
                row["created_at"],
                row["updated_at"],
                row["reviewed_at"],
                row["expires_at"],
            ),
        )


def _copy_child_memory_proposals(
    sqlite_connection: sqlite3.Connection, postgres_connection: psycopg.Connection[Any]
) -> None:
    if not _sqlite_table_exists(sqlite_connection, "child_memory_proposals"):
        return

    rows = sqlite_connection.execute(
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
        """
    ).fetchall()
    for row in rows:
        postgres_connection.execute(
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
                created_at = excluded.created_at,
                updated_at = excluded.updated_at,
                reviewed_at = excluded.reviewed_at
            """,
            (
                row["id"],
                row["child_id"],
                row["category"],
                row["memory_type"],
                row["status"],
                row["statement"],
                Jsonb(_loads_json(row["detail_json"], {})),
                row["confidence"],
                Jsonb(_loads_json(row["provenance_json"], {})),
                row["author_type"],
                row["author_user_id"],
                row["reviewer_user_id"],
                row["review_note"],
                row["approved_item_id"],
                row["created_at"],
                row["updated_at"],
                row["reviewed_at"],
            ),
        )


def _copy_child_memory_evidence_links(
    sqlite_connection: sqlite3.Connection, postgres_connection: psycopg.Connection[Any]
) -> None:
    if not _sqlite_table_exists(sqlite_connection, "child_memory_evidence_links"):
        return

    rows = sqlite_connection.execute(
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
        """
    ).fetchall()
    for row in rows:
        postgres_connection.execute(
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
                metadata_json = excluded.metadata_json,
                created_at = excluded.created_at
            """,
            (
                row["id"],
                row["child_id"],
                row["subject_type"],
                row["subject_id"],
                row["session_id"],
                row["practice_plan_id"],
                row["evidence_kind"],
                row["snippet"],
                Jsonb(_loads_json(row["metadata_json"], {})),
                row["created_at"],
            ),
        )


def _copy_child_memory_summaries(
    sqlite_connection: sqlite3.Connection, postgres_connection: psycopg.Connection[Any]
) -> None:
    if not _sqlite_table_exists(sqlite_connection, "child_memory_summaries"):
        return

    rows = sqlite_connection.execute(
        "SELECT child_id, summary_json, summary_text, source_item_count, last_compiled_at, updated_at FROM child_memory_summaries"
    ).fetchall()
    for row in rows:
        postgres_connection.execute(
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
                row["child_id"],
                Jsonb(_loads_json(row["summary_json"], {})),
                row["summary_text"],
                row["source_item_count"],
                row["last_compiled_at"],
                row["updated_at"],
            ),
        )


def _copy_recommendation_logs(
    sqlite_connection: sqlite3.Connection, postgres_connection: psycopg.Connection[Any]
) -> None:
    if not _sqlite_table_exists(sqlite_connection, "recommendation_logs"):
        return

    rows = sqlite_connection.execute(
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
        """
    ).fetchall()
    for row in rows:
        postgres_connection.execute(
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
                top_recommendation_score = excluded.top_recommendation_score,
                created_at = excluded.created_at
            """,
            (
                row["id"],
                row["child_id"],
                row["source_session_id"],
                row["target_sound"],
                Jsonb(_loads_json(row["therapist_constraints_json"], {})),
                Jsonb(_loads_json(row["ranking_context_json"], {})),
                row["rationale_text"],
                row["created_by_user_id"],
                row["candidate_count"],
                row["top_recommendation_score"],
                row["created_at"],
            ),
        )


def _copy_recommendation_candidates(
    sqlite_connection: sqlite3.Connection, postgres_connection: psycopg.Connection[Any]
) -> None:
    if not _sqlite_table_exists(sqlite_connection, "recommendation_candidates"):
        return

    rows = sqlite_connection.execute(
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
        """
    ).fetchall()
    for row in rows:
        postgres_connection.execute(
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
            ON CONFLICT(id) DO UPDATE SET
                recommendation_log_id = excluded.recommendation_log_id,
                rank = excluded.rank,
                exercise_id = excluded.exercise_id,
                exercise_name = excluded.exercise_name,
                exercise_description = excluded.exercise_description,
                exercise_metadata_json = excluded.exercise_metadata_json,
                score = excluded.score,
                ranking_factors_json = excluded.ranking_factors_json,
                rationale_text = excluded.rationale_text,
                explanation_json = excluded.explanation_json,
                supporting_memory_item_ids_json = excluded.supporting_memory_item_ids_json,
                supporting_session_ids_json = excluded.supporting_session_ids_json,
                created_at = excluded.created_at
            """,
            (
                row["id"],
                row["recommendation_log_id"],
                row["rank"],
                row["exercise_id"],
                row["exercise_name"],
                row["exercise_description"],
                Jsonb(_loads_json(row["exercise_metadata_json"], {})),
                row["score"],
                Jsonb(_loads_json(row["ranking_factors_json"], {})),
                row["rationale_text"],
                Jsonb(_loads_json(row["explanation_json"], {})),
                Jsonb(_loads_json(row["supporting_memory_item_ids_json"], [])),
                Jsonb(_loads_json(row["supporting_session_ids_json"], [])),
                row["created_at"],
            ),
        )


def _copy_institutional_memory_insights(
    sqlite_connection: sqlite3.Connection, postgres_connection: psycopg.Connection[Any]
) -> None:
    if not _sqlite_table_exists(sqlite_connection, "institutional_memory_insights"):
        return

    columns = _sqlite_columns(sqlite_connection, "institutional_memory_insights")
    rows = sqlite_connection.execute("SELECT * FROM institutional_memory_insights").fetchall()
    for row in rows:
        postgres_connection.execute(
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
                updated_at,
                owner_user_id
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT(id) DO UPDATE SET
                insight_type = excluded.insight_type,
                status = excluded.status,
                target_sound = excluded.target_sound,
                title = excluded.title,
                summary = excluded.summary,
                detail_json = excluded.detail_json,
                provenance_json = excluded.provenance_json,
                source_child_count = excluded.source_child_count,
                source_session_count = excluded.source_session_count,
                source_memory_item_count = excluded.source_memory_item_count,
                created_at = excluded.created_at,
                updated_at = excluded.updated_at,
                owner_user_id = excluded.owner_user_id
            """,
            (
                row["id"],
                row["insight_type"],
                row["status"],
                row["target_sound"],
                row["title"],
                row["summary"],
                Jsonb(_loads_json(row["detail_json"], {})),
                Jsonb(_loads_json(row["provenance_json"], {})),
                row["source_child_count"],
                row["source_session_count"],
                row["source_memory_item_count"],
                row["created_at"],
                row["updated_at"],
                row["owner_user_id"] if "owner_user_id" in columns else None,
            ),
        )


def collect_counts_sqlite(sqlite_connection: sqlite3.Connection) -> Dict[str, int]:
    return {
        table: (
            sqlite_connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]  # noqa: S608
            if _sqlite_table_exists(sqlite_connection, table)
            else 0
        )
        for table in TABLES
    }


def collect_counts_postgres(postgres_connection: psycopg.Connection[Any]) -> Dict[str, int]:
    return {
        table: postgres_connection.execute(f"SELECT COUNT(*) AS count FROM {table}").fetchone()["count"]  # noqa: S608
        for table in TABLES
    }


def collect_samples(
    sqlite_connection: sqlite3.Connection,
    postgres_connection: psycopg.Connection[Any],
    sample_limit: int,
) -> Dict[str, Dict[str, List[str]]]:
    sample_columns = {
        "app_settings": "key",
        "children": "id",
        "users": "id",
        "user_children": "user_id",
        "child_invitations": "id",
        "audit_log": "id",
        "exercises": "id",
        "sessions": "id",
        "practice_plans": "id",
        "child_memory_items": "id",
        "child_memory_proposals": "id",
        "child_memory_evidence_links": "id",
        "child_memory_summaries": "child_id",
        "recommendation_logs": "id",
        "recommendation_candidates": "id",
        "institutional_memory_insights": "id",
    }
    report: Dict[str, Dict[str, List[str]]] = {}
    for table, key_column in sample_columns.items():
        sqlite_rows = []
        if _sqlite_table_exists(sqlite_connection, table):
            sqlite_rows = sqlite_connection.execute(
                f"SELECT {key_column} FROM {table} ORDER BY {key_column} LIMIT ?",  # noqa: S608
                (sample_limit,),
            ).fetchall()
        postgres_rows = postgres_connection.execute(
            f"SELECT {key_column} FROM {table} ORDER BY {key_column} LIMIT %s",  # noqa: S608
            (sample_limit,),
        ).fetchall()
        report[table] = {
            "sqlite": [str(row[0]) for row in sqlite_rows],
            "postgres": [str(row[key_column]) for row in postgres_rows],
        }
    return report


def migrate(sqlite_path: str, database_url: str) -> Dict[str, Any]:
    run_postgres_migrations(database_url)

    with _connect_sqlite(sqlite_path) as sqlite_connection, _connect_postgres(database_url) as postgres_connection:
        _copy_users(sqlite_connection, postgres_connection)
        _copy_children(sqlite_connection, postgres_connection)
        _copy_user_children(sqlite_connection, postgres_connection)
        _copy_child_invitations(sqlite_connection, postgres_connection)
        _copy_audit_log(sqlite_connection, postgres_connection)
        _copy_exercises(sqlite_connection, postgres_connection)
        _copy_sessions(sqlite_connection, postgres_connection)
        _copy_practice_plans(sqlite_connection, postgres_connection)
        _copy_child_memory_items(sqlite_connection, postgres_connection)
        _copy_child_memory_proposals(sqlite_connection, postgres_connection)
        _copy_child_memory_evidence_links(sqlite_connection, postgres_connection)
        _copy_child_memory_summaries(sqlite_connection, postgres_connection)
        _copy_recommendation_logs(sqlite_connection, postgres_connection)
        _copy_recommendation_candidates(sqlite_connection, postgres_connection)
        _copy_institutional_memory_insights(sqlite_connection, postgres_connection)
        _copy_app_settings(sqlite_connection, postgres_connection)

        return {
            "sqlite_counts": collect_counts_sqlite(sqlite_connection),
            "postgres_counts": collect_counts_postgres(postgres_connection),
        }


def parity_report(sqlite_path: str, database_url: str, sample_limit: int) -> Dict[str, Any]:
    with _connect_sqlite(sqlite_path) as sqlite_connection, _connect_postgres(database_url) as postgres_connection:
        sqlite_counts = collect_counts_sqlite(sqlite_connection)
        postgres_counts = collect_counts_postgres(postgres_connection)
        return {
            "counts_match": sqlite_counts == postgres_counts,
            "sqlite_counts": sqlite_counts,
            "postgres_counts": postgres_counts,
            "samples": collect_samples(sqlite_connection, postgres_connection, sample_limit),
        }


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sqlite-path", required=True)
    parser.add_argument("--database-url", required=True)
    parser.add_argument("--parity-only", action="store_true")
    parser.add_argument("--sample-limit", type=int, default=5)
    return parser.parse_args(list(argv) if argv is not None else None)


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    if args.parity_only:
        report = parity_report(args.sqlite_path, args.database_url, args.sample_limit)
    else:
        migrate(args.sqlite_path, args.database_url)
        report = parity_report(args.sqlite_path, args.database_url, args.sample_limit)

    print(json.dumps(report, indent=2, sort_keys=True))
    return 0 if report.get("counts_match", True) else 1


if __name__ == "__main__":
    raise SystemExit(main())