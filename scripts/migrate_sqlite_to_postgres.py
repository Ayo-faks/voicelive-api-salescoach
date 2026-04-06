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

TABLES = ("app_settings", "children", "users", "exercises", "sessions", "practice_plans")


def _connect_sqlite(sqlite_path: str) -> sqlite3.Connection:
    connection = sqlite3.connect(sqlite_path)
    connection.row_factory = sqlite3.Row
    return connection


def _connect_postgres(database_url: str) -> psycopg.Connection[Any]:
    return psycopg.connect(database_url, row_factory=dict_row)


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
    rows = sqlite_connection.execute("SELECT id, name, created_at FROM children").fetchall()
    for row in rows:
        postgres_connection.execute(
            """
            INSERT INTO children (id, name, created_at)
            VALUES (%s, %s, %s)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                created_at = excluded.created_at
            """,
            (row["id"], row["name"], row["created_at"]),
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


def collect_counts_sqlite(sqlite_connection: sqlite3.Connection) -> Dict[str, int]:
    return {
        table: sqlite_connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]  # noqa: S608
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
        "exercises": "id",
        "sessions": "id",
        "practice_plans": "id",
    }
    report: Dict[str, Dict[str, List[str]]] = {}
    for table, key_column in sample_columns.items():
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
        _copy_exercises(sqlite_connection, postgres_connection)
        _copy_sessions(sqlite_connection, postgres_connection)
        _copy_practice_plans(sqlite_connection, postgres_connection)
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