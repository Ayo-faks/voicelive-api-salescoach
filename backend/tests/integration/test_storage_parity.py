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


TIMESTAMP_KEYS = {
    "created_at",
    "updated_at",
    "approved_at",
    "submitted_at",
    "reviewed_at",
    "last_compiled_at",
    "signed_at",
    "archived_at",
    "consented_at",
    "withdrawn_at",
}


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
        normalized = {child_key: _normalize_payload(child_value, child_key) for child_key, child_value in value.items()}
        if {"guardian_email", "guardian_name", "consent_type"}.issubset(normalized):
            normalized["id"] = "<generated-id>"
        return normalized
    if isinstance(value, list):
        return [_normalize_payload(item, key) for item in value]
    if key in TIMESTAMP_KEYS and isinstance(value, str):
        return "<timestamp>"
    return value


def _exercise_storage_backend(service: Any) -> dict[str, Any]:
    service.get_or_create_user("user-1", "first@example.com", "First User", "aad")
    service.get_or_create_user("user-2", "second@example.com", "Second User", "google")
    service.save_consent_acknowledgement("2026-04-05T10:00:00+00:00")
    saved_parental_consent = service.save_parental_consent(
        child_id="child-ayo",
        guardian_name="Parent Example",
        guardian_email="parent@example.com",
        privacy_accepted=True,
        terms_accepted=True,
        ai_notice_accepted=True,
        personal_data_consent_accepted=True,
        special_category_consent_accepted=True,
        parental_responsibility_confirmed=True,
        recorded_by_user_id="user-1",
    )

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

    memory_proposal = service.save_child_memory_proposal(
        {
            "id": "proposal-parity-1",
            "child_id": "child-ayo",
            "category": "effective_cues",
            "memory_type": "inference",
            "status": "pending",
            "statement": "Responds best to a spoken model before imitation.",
            "detail": {"cue": "spoken model"},
            "confidence": 0.8,
            "provenance": {"session_ids": [saved_session["id"]]},
            "author_type": "system",
        }
    )
    memory_item = service.save_child_memory_item(
        {
            "id": "item-parity-1",
            "child_id": "child-ayo",
            "category": "targets",
            "memory_type": "constraint",
            "status": "approved",
            "statement": "Keep /r/ as the active target.",
            "detail": {"target_sound": "r"},
            "confidence": 0.9,
            "provenance": {"session_ids": [saved_session["id"]]},
            "author_type": "therapist",
            "author_user_id": "user-1",
            "source_proposal_id": memory_proposal["id"],
        }
    )
    reviewed_proposal = service.review_child_memory_proposal(
        memory_proposal["id"],
        "approved",
        reviewer_user_id="user-1",
        review_note="Seen repeatedly.",
        approved_item_id=memory_item["id"],
    )
    expired_item = service.update_child_memory_item_status(
        memory_item["id"],
        "expired",
        expires_at="2026-05-01T00:00:00+00:00",
    )
    evidence_link = service.save_child_memory_evidence_link(
        {
            "id": "evidence-parity-1",
            "child_id": "child-ayo",
            "subject_type": "proposal",
            "subject_id": memory_proposal["id"],
            "session_id": saved_session["id"],
            "practice_plan_id": approved_plan["id"],
            "evidence_kind": "session",
            "snippet": "Needed less prompting after the therapist modeled once.",
            "metadata": {"source": "analysis"},
        }
    )
    summary = service.upsert_child_memory_summary(
        "child-ayo",
        {
            "targets": ["Keep /r/ as the active target."],
            "effective_cues": [reviewed_proposal["statement"]],
        },
        summary_text="Active target remains /r/ with strong response to spoken-model cues.",
        source_item_count=1,
    )
    institutional_insights = service.replace_institutional_memory_insights(
        "user-1",
        [
            {
                "id": "institutional-insight-parity-1",
                "insight_type": "recommendation_tuning",
                "status": "active",
                "target_sound": "r",
                "title": "Recommendation tuning input for /r/",
                "summary": "De-identified reviewed outcomes favour phrase practice for /r/ when child-specific memory does not conflict.",
                "detail": {
                    "target_sound": "r",
                    "recommended_exercise_types": ["two_word_phrase"],
                },
                "provenance": {
                    "evidence_basis": "approved_child_memory_and_reviewed_sessions",
                    "deidentified_child_count": 1,
                    "reviewed_session_count": 1,
                    "approved_memory_item_count": 1,
                },
                "source_child_count": 1,
                "source_session_count": 1,
                "source_memory_item_count": 1,
                "created_at": "2026-04-05T10:06:30+00:00",
                "updated_at": "2026-04-05T10:06:30+00:00",
            }
        ]
    )
    recommendation_log = service.save_recommendation_log(
        {
            "id": "recommendation-log-parity-1",
            "child_id": "child-ayo",
            "source_session_id": saved_session["id"],
            "target_sound": "r",
            "therapist_constraints": {
                "note": "Keep it playful.",
                "parsed": {"playful": True},
            },
            "ranking_context": {
                "current_target_sound": "r",
                "approved_memory_item_ids": [memory_item["id"]],
            },
            "rationale": "Matches the active /r/ target and approved memory.",
            "created_by_user_id": "user-1",
            "candidate_count": 1,
            "top_recommendation_score": 78,
            "created_at": "2026-04-05T10:07:00+00:00",
        }
    )
    recommendation_candidates = service.replace_recommendation_candidates(
        recommendation_log["id"],
        [
            {
                "id": "recommendation-candidate-parity-1",
                "rank": 1,
                "exercise_id": "exercise-r",
                "exercise_name": "R Warmup",
                "exercise_description": "Practice /r/ words",
                "exercise_metadata": {"targetSound": "r", "difficulty": "medium", "type": "word_repetition"},
                "score": 78,
                "ranking_factors": {
                    "target_sound_match": {
                        "score": 40,
                        "reason": "matches the active /r/ target",
                        "supporting_memory_item_ids": [memory_item["id"]],
                        "supporting_session_ids": [saved_session["id"]],
                    }
                },
                "rationale": "Matches the active /r/ target and approved memory.",
                "explanation": {
                    "why_recommended": "It stayed aligned with the active /r/ target.",
                    "comparison_to_approved_memory": "This recommendation stays aligned with approved memory.",
                    "evidence_that_could_change_recommendation": "If engagement falls, step back difficulty.",
                    "supporting_memory_items": [],
                    "supporting_sessions": [],
                    "score_summary": "Deterministic score 78",
                },
                "supporting_memory_item_ids": [memory_item["id"]],
                "supporting_session_ids": [saved_session["id"]],
                "created_at": "2026-04-05T10:07:00+00:00",
            }
        ],
    )
    saved_report = service.save_progress_report(
        {
            "id": "report-parity-1",
            "child_id": "child-ayo",
            "workspace_id": None,
            "created_by_user_id": "user-1",
            "audience": "therapist",
            "report_type": "progress_summary",
            "title": "Ayo therapist report",
            "status": "draft",
            "period_start": "2026-04-05T00:00:00+00:00",
            "period_end": "2026-04-05T23:59:59+00:00",
            "included_session_ids": [saved_session["id"]],
            "snapshot": {
                "child_name": "Ayo",
                "session_count": 1,
                "focus_targets": ["r"],
            },
            "sections": [
                {
                    "key": "overview",
                    "title": "Overview",
                    "narrative": "Ayo continues to build /r/ confidence in structured practice.",
                }
            ],
            "redaction_overrides": {},
            "summary_text": "Ayo continues to build /r/ confidence in structured practice.",
        }
    )
    updated_report = service.update_progress_report(
        saved_report["id"],
        {
            "audience": "parent",
            "title": "Ayo family update",
            "period_start": "2026-04-05T00:00:00+00:00",
            "period_end": "2026-04-05T23:59:59+00:00",
            "included_session_ids": [saved_session["id"]],
            "snapshot": {
                "child_name": "Ayo",
                "session_count": 1,
                "focus_targets": ["r"],
            },
            "sections": [
                {
                    "key": "family-wins",
                    "title": "What is going well",
                    "bullets": ["Ayo is sustaining /r/ attempts with support."],
                }
            ],
            "redaction_overrides": {},
            "summary_text": "Ayo is sustaining /r/ attempts with support.",
        },
    )
    approved_report = service.approve_progress_report(saved_report["id"])
    signed_report = service.sign_progress_report(saved_report["id"], "user-1")
    archived_report = service.archive_progress_report(saved_report["id"])
    report_history = service.list_progress_reports_for_child("child-ayo")

    return {
        "pilot_state": service.get_pilot_state(),
        "first_user": service.get_user("user-1"),
        "second_user": service.get_user("user-2"),
        "children": service.list_children(),
        "saved_parental_consent": saved_parental_consent,
        "parental_consent": service.get_parental_consent("child-ayo"),
        "session": service.get_session(saved_session["id"]),
        "feedback_session": feedback_session,
        "session_history": service.list_sessions_for_child("child-ayo"),
        "saved_plan": service.get_practice_plan(saved_plan["id"]),
        "approved_plan": approved_plan,
        "plans": service.list_practice_plans_for_child("child-ayo"),
        "memory_proposal": service.get_child_memory_proposal(memory_proposal["id"]),
        "reviewed_proposal": reviewed_proposal,
        "pending_proposals": service.list_child_memory_proposals("child-ayo", status="pending"),
        "approved_proposals": service.list_child_memory_proposals("child-ayo", status="approved"),
        "memory_item": service.get_child_memory_item(memory_item["id"]),
        "expired_item": expired_item,
        "approved_items": service.list_child_memory_items("child-ayo", status="approved"),
        "expired_items": service.list_child_memory_items("child-ayo", status="expired"),
        "evidence_link": evidence_link,
        "evidence_links": service.list_child_memory_evidence_links("proposal", memory_proposal["id"]),
        "summary": summary,
        "summary_reload": service.get_child_memory_summary("child-ayo"),
        "institutional_insights": institutional_insights,
        "institutional_insights_reload": service.list_institutional_memory_insights(owner_user_id="user-1", status="active"),
        "recommendation_log": service.get_recommendation_log(recommendation_log["id"]),
        "recommendation_history": service.list_recommendation_logs_for_child("child-ayo"),
        "recommendation_candidates": recommendation_candidates,
        "saved_report": saved_report,
        "updated_report": updated_report,
        "approved_report": approved_report,
        "signed_report": signed_report,
        "archived_report": archived_report,
        "report_history": report_history,
    }


def test_sqlite_and_postgres_storage_match_api_visible_behavior(
    sqlite_service: StorageService,
    postgres_service: PostgresStorageService,
):
    sqlite_result = _normalize_payload(_exercise_storage_backend(sqlite_service))
    postgres_result = _normalize_payload(_exercise_storage_backend(postgres_service))

    assert postgres_result == sqlite_result


def test_progress_reports_migration_creates_table_and_child_access_policy(postgres_database_url: str):
    with psycopg.connect(postgres_database_url, autocommit=True) as connection:
        connection.execute("DROP SCHEMA IF EXISTS public CASCADE")
        connection.execute("CREATE SCHEMA public")

    run_postgres_migrations(postgres_database_url)

    with psycopg.connect(postgres_database_url) as connection:
        table_row = connection.execute(
            "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'progress_reports'"
        ).fetchone()
        column_rows = connection.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'progress_reports'"
        ).fetchall()
        policy_rows = connection.execute(
            "SELECT policyname, cmd FROM pg_policies WHERE schemaname = 'public' AND tablename = 'progress_reports'"
        ).fetchall()

    assert table_row is not None
    assert table_row[0] is True
    assert table_row[1] is True
    assert {
        "child_id",
        "workspace_id",
        "created_by_user_id",
        "audience",
        "status",
        "included_session_ids_json",
        "snapshot_json",
        "sections_json",
        "summary_text",
        "signed_at",
        "archived_at",
    }.issubset({row[0] for row in column_rows})
    assert ("progress_reports_child_access_policy", "ALL") in policy_rows