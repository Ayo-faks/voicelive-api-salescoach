"""Regression coverage for Postgres learning repository parity."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Tuple

from src.learning.api import ITEM_BANK_PATH, LearningApi, PILOT_TEACHER_ID, register_learning_api
from src.learning.diagnostic import load_item_bank
from src.learning.models import Provenance
from src.learning.repository import LearningPostgresRepository


class _FakeCursor:
    """Minimal cursor so read paths (``.fetchall()``/``.fetchone()``) work.

    The fake storage has no real tables, so reads return empty results — the
    tests only assert on write shapes and recorded executions.
    """

    rowcount = 0

    def fetchall(self) -> List[Dict[str, Any]]:
        return []

    def fetchone(self) -> None:
        return None


class _FakeConnection:
    def __init__(self) -> None:
        self.executions: List[Tuple[str, Tuple[Any, ...]]] = []

    def execute(self, sql: str, params: Tuple[Any, ...]) -> _FakeCursor:
        self.executions.append((sql, params))
        return _FakeCursor()


class _FakePostgresStorage:
    def __init__(self) -> None:
        self.connection = _FakeConnection()

    def _utc_now(self) -> str:
        return "2026-05-24T12:00:00+00:00"

    def _dumps_json(self, payload: Any) -> str:
        return json.dumps(payload)

    def _execute_write(self, callback) -> None:
        callback(self.connection)


def _postgres_learning_api() -> LearningApi:
    storage = _FakePostgresStorage()
    repository = LearningPostgresRepository(storage)
    api = LearningApi(
        repository=repository,
        item_bank=load_item_bank(Path(ITEM_BANK_PATH)),
    )
    api._fake_storage = storage  # type: ignore[attr-defined]
    return api


def _queue_plan(api: LearningApi) -> Dict[str, Any]:
    return api.submit_intent({"prompt": "Create a short reteach plan"})


def test_postgres_save_intervention_plan_returns_in_memory_shape_for_approval_flow() -> None:
    api = _postgres_learning_api()

    queued = _queue_plan(api)
    plan_id = queued["plan"]["plan_id"]
    pending = api.list_pending_approvals({})
    pending_record = pending["plans"][0]

    assert pending_record["id"] == plan_id
    assert pending_record["created_by_user_id"] == PILOT_TEACHER_ID
    assert pending_record["plan"]["plan_id"] == plan_id
    assert pending_record["lang"] == "en-NG"
    assert pending_record["provenance"]
    assert pending_record["updated_at"] == pending_record["created_at"]

    approved = api.approve_plan(plan_id, {"actor_id": PILOT_TEACHER_ID})
    assert approved["action"] == "approved"


def test_postgres_return_shape_supports_reject_and_edit_approve_consumers() -> None:
    api = _postgres_learning_api()

    reject_plan = _queue_plan(api)["plan"]["plan_id"]
    rejected = api.reject_plan(reject_plan, {"actor_id": PILOT_TEACHER_ID})
    assert rejected["action"] == "rejected"

    edit_plan = _queue_plan(api)["plan"]["plan_id"]
    edited = api.edit_and_approve_plan(
        edit_plan,
        {
            "actor_id": PILOT_TEACHER_ID,
            "edits": {"rationale": "Use the first mini lesson before group practice."},
        },
    )
    assert edited["action"] == "edited_approved"
    assert edited["plan"]["parent_plan_id"] == edit_plan


def test_postgres_save_intervention_plan_persists_parent_plan_id_column() -> None:
    api = _postgres_learning_api()
    queued = _queue_plan(api)
    storage = api._fake_storage  # type: ignore[attr-defined]

    insert_sql, insert_params = next(
        (sql, params)
        for sql, params in storage.connection.executions
        if "INSERT INTO learning_intervention_plans" in sql
    )
    assert "parent_plan_id" in insert_sql
    assert insert_params[-1] == queued["plan"].get("parent_plan_id")


def test_postgres_ensure_learner_voice_score_prerequisites_upserts_fk_rows() -> None:
    storage = _FakePostgresStorage()
    repository = LearningPostgresRepository(storage)

    repository.ensure_learner_voice_score_prerequisites(
        tenant_id="tenant-phase-2",
        class_id="class-ss3-a",
        student_id="child-prod-1",
        skill_id="ss3.physics.measurements.phys_def",
        item_id="physics-mcq-ss3-001",
        prompt="Physics is best described as the study of:",
        item_type="mcq_single",
        difficulty=0.1,
        lang="en-NG",
        provenance=[
            Provenance(
                source="learner_voice_test",
                rule_id="fixture",
                confidence=1.0,
                evidence_count=1,
            )
        ],
        skill_name="Physics definition",
        subject="physics",
        year_group="SSS3",
    )

    executions = storage.connection.executions
    expected_tables = [
        "learning_classes",
        "learning_students",
        "learning_standards",
        "learning_skills",
        "learning_diagnostic_items",
    ]
    assert len(executions) == len(expected_tables)
    for table_name, (sql, _params) in zip(expected_tables, executions):
        assert table_name in sql
    class_params = executions[0][1]
    assert class_params[:4] == (
        "class-ss3-a",
        "tenant-phase-2",
        "Learner Voice SSS3",
        "SSS3",
    )
    student_params = executions[1][1]
    assert student_params[:5] == (
        "child-prod-1",
        "tenant-phase-2",
        "class-ss3-a",
        "Learner child-prod-1",
        "SSS3",
    )
    skill_params = executions[3][1]
    assert skill_params[:5] == (
        "ss3.physics.measurements.phys_def",
        "tenant-phase-2",
        "learner-voice-standard:tenant-phase-2",
        "Physics definition",
        "physics",
    )
    item_params = executions[4][1]
    assert item_params[:8] == (
        "physics-mcq-ss3-001",
        "tenant-phase-2",
        "ss3.physics.measurements.phys_def",
        "Physics is best described as the study of:",
        "mcq_single",
        0.1,
        None,
        "en-NG",
    )
    assert json.loads(item_params[8])[0]["source"] == "learner_voice_test"
