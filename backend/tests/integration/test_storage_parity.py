"""Parity checks between SQLite and PostgreSQL storage backends."""

from __future__ import annotations

import os
from pathlib import Path
import shutil
import socket
import subprocess
import time
from typing import Any
from uuid import uuid4

import pytest

psycopg = pytest.importorskip("psycopg")

from src.services.postgres_migrations import run_postgres_migrations
from src.services.storage import StorageService
from src.services.storage_postgres import PostgresStorageService


TIMESTAMP_KEYS = {"created_at", "updated_at", "approved_at", "submitted_at"}


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _wait_for_postgres(database_url: str, timeout_seconds: float = 30.0) -> None:
    deadline = time.time() + timeout_seconds
    last_error = ""
    while time.time() < deadline:
        try:
            with psycopg.connect(database_url) as connection:
                connection.execute("SELECT 1")
            return
        except psycopg.OperationalError as exc:
            last_error = str(exc)
            time.sleep(0.5)

    pytest.skip(f"PostgreSQL test database did not become ready: {last_error}")


@pytest.fixture(scope="session")
def postgres_database_url() -> str:
    configured_url = os.getenv("POSTGRES_TEST_DATABASE_URL", "").strip()
    if configured_url:
        _wait_for_postgres(configured_url)
        return configured_url

    docker_path = shutil.which("docker")
    if not docker_path:
        pytest.skip("docker is not available for PostgreSQL parity tests")

    port = _find_free_port()
    container_name = f"wulo-postgres-parity-{uuid4().hex[:8]}"
    run_result = subprocess.run(
        [
            docker_path,
            "run",
            "--rm",
            "-d",
            "--name",
            container_name,
            "-e",
            "POSTGRES_DB=wulo",
            "-e",
            "POSTGRES_USER=postgres",
            "-e",
            "POSTGRES_PASSWORD=postgres",
            "-p",
            f"{port}:5432",
            "postgres:16-alpine",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if run_result.returncode != 0:
        pytest.skip(f"docker could not start postgres: {run_result.stderr.strip()}")

    database_url = f"postgresql://postgres:postgres@127.0.0.1:{port}/wulo"
    try:
        _wait_for_postgres(database_url)
        yield database_url
    finally:
        subprocess.run([docker_path, "rm", "-f", container_name], capture_output=True, text=True, check=False)


@pytest.fixture
def sqlite_service(tmp_path: Path) -> StorageService:
    return StorageService(str(tmp_path / "parity.db"))


@pytest.fixture
def postgres_service(postgres_database_url: str) -> PostgresStorageService:
    with psycopg.connect(postgres_database_url, autocommit=True) as connection:
        connection.execute("DROP SCHEMA IF EXISTS public CASCADE")
        connection.execute("CREATE SCHEMA public")

    run_postgres_migrations(postgres_database_url)
    return PostgresStorageService(postgres_database_url)


def _normalize_payload(value: Any, key: str | None = None) -> Any:
    if isinstance(value, dict):
        return {child_key: _normalize_payload(child_value, child_key) for child_key, child_value in value.items()}
    if isinstance(value, list):
        return [_normalize_payload(item, key) for item in value]
    if key in TIMESTAMP_KEYS and isinstance(value, str):
        return "<timestamp>"
    return value


def _exercise_storage_backend(service: Any) -> dict[str, Any]:
    service.get_or_create_user("user-1", "first@example.com", "First User", "aad")
    service.get_or_create_user("user-2", "second@example.com", "Second User", "google")
    service.save_consent_acknowledgement("2026-04-05T10:00:00+00:00")

    saved_session = service.save_session(
        {
            "id": "session-parity-1",
            "child_id": "child-ayo",
            "child_name": "Ayo",
            "timestamp": "2026-04-05T10:05:00+00:00",
            "exercise": {
                "id": "exercise-r",
                "name": "R Warmup",
                "description": "Practice /r/ words",
                "exerciseMetadata": {"targetSound": "r", "difficulty": "medium"},
            },
            "exercise_metadata": {"targetSound": "r", "difficulty": "medium"},
            "ai_assessment": {
                "overall_score": 72,
                "therapist_notes": "Improving with a listening model.",
            },
            "pronunciation_assessment": {
                "accuracy_score": 66,
                "pronunciation_score": 67,
            },
            "transcript": "Child practised /r/ words.",
            "reference_text": "red rabbit",
        }
    )

    feedback_session = service.save_session_feedback(
        saved_session["id"],
        "up",
        "Child stayed engaged with minimal prompting.",
    )
    saved_plan = service.save_practice_plan(
        {
            "id": "plan-parity-1",
            "child_id": "child-ayo",
            "source_session_id": saved_session["id"],
            "status": "draft",
            "title": "Next session plan for Ayo",
            "plan_type": "next_session",
            "constraints": {"therapist_message": "Keep it playful."},
            "draft": {"objective": "Increase /r/ confidence."},
            "conversation": [
                {"role": "user", "content": "Keep it playful."},
                {"role": "assistant", "content": "Plan drafted."},
            ],
            "planner_session_id": "practice-planner-plan-parity-1",
            "created_by_user_id": "user-1",
            "created_at": "2026-04-05T10:06:00+00:00",
            "updated_at": "2026-04-05T10:06:00+00:00",
        }
    )
    approved_plan = service.approve_practice_plan(saved_plan["id"])

    return {
        "pilot_state": service.get_pilot_state(),
        "first_user": service.get_user("user-1"),
        "second_user": service.get_user("user-2"),
        "children": service.list_children(),
        "session": service.get_session(saved_session["id"]),
        "feedback_session": feedback_session,
        "session_history": service.list_sessions_for_child("child-ayo"),
        "saved_plan": service.get_practice_plan(saved_plan["id"]),
        "approved_plan": approved_plan,
        "plans": service.list_practice_plans_for_child("child-ayo"),
    }


def test_sqlite_and_postgres_storage_match_api_visible_behavior(
    sqlite_service: StorageService,
    postgres_service: PostgresStorageService,
):
    sqlite_result = _normalize_payload(_exercise_storage_backend(sqlite_service))
    postgres_result = _normalize_payload(_exercise_storage_backend(postgres_service))

    assert postgres_result == sqlite_result