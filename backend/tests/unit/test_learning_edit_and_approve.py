"""Tests for the A5 edit-and-approve HITL path."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict

import pytest
from flask import Flask

from src.learning.api import (
    ITEM_BANK_PATH,
    LearningApi,
    PILOT_TEACHER_ID,
    PILOT_TENANT_ID,
    register_learning_api,
)
from src.learning.diagnostic import load_item_bank


@pytest.fixture()
def learning_api() -> LearningApi:
    assert ITEM_BANK_PATH.exists()
    return LearningApi(item_bank=load_item_bank(Path(ITEM_BANK_PATH)))


@pytest.fixture()
def client(learning_api: LearningApi):
    app = Flask(__name__)
    app.config["TESTING"] = True
    register_learning_api(app, learning_api)
    return app.test_client()


def _drive_to_pending_plan(client, learning_api: LearningApi) -> Dict[str, Any]:
    started = client.post("/api/learning/diagnostic/start", json={}).get_json()
    session_id = started["session_id"]
    current = started["item"]
    pending = None
    while current is not None:
        bank_item = next(
            entry for entry in learning_api.item_bank.items
            if entry.item_id == current["item_id"]
        )
        result = client.post(
            "/api/learning/diagnostic/answer",
            json={
                "session_id": session_id,
                "item_id": current["item_id"],
                "response_text": bank_item.correct_answer or "",
            },
        ).get_json()
        current = result["next_item"]
        if result["completed"]:
            pending = result["pending_plan"]
    assert pending is not None
    return pending


def test_edit_and_approve_creates_linked_variant(client, learning_api: LearningApi):
    pending = _drive_to_pending_plan(client, learning_api)
    plan_id = pending["id"]
    original_skills = list(pending["plan"]["target_skill_ids"])

    response = client.post(
        f"/api/learning/approvals/{plan_id}/edit-approve",
        json={
            "actor_id": PILOT_TEACHER_ID,
            "reason": "Trimmed scope for week 1",
            "edits": {
                "rationale": "Focus on the highest-leverage skill only.",
                "target_skill_ids": original_skills[:1],
            },
        },
    )
    assert response.status_code == 200, response.get_data(as_text=True)
    body = response.get_json()
    assert body["action"] == "edited_approved"
    assert body["plan_id"] == plan_id
    assert body["edited_plan_id"] != plan_id
    assert body["plan"]["parent_plan_id"] == plan_id
    assert body["plan"]["target_skill_ids"] == original_skills[:1]
    assert body["plan"]["rationale"] == "Focus on the highest-leverage skill only."
    assert body["xapi_statement"]["verb"]["id"].endswith("edited_approved") or \
        "edited" in body["xapi_statement"]["verb"]["id"]


def test_edit_and_approve_marks_original_edited(client, learning_api: LearningApi):
    pending = _drive_to_pending_plan(client, learning_api)
    plan_id = pending["id"]
    client.post(
        f"/api/learning/approvals/{plan_id}/edit-approve",
        json={"actor_id": PILOT_TEACHER_ID, "edits": {"rationale": "tweaked"}},
    )
    pending_after = client.get("/api/learning/approvals/pending").get_json()
    assert not any(p["id"] == plan_id for p in pending_after["plans"])
    audit = client.get("/api/learning/audit").get_json()
    assert any(event["kind"] == "plan_edited_approved" for event in audit["events"])
    ledger_verbs = [
        record["verb_id"]
        for record in learning_api.repository.xapi_statements
        if record["tenant_id"] == PILOT_TENANT_ID
    ]
    assert any("edited" in verb or "approved" in verb for verb in ledger_verbs)


def test_edit_and_approve_unknown_plan_returns_404(client):
    response = client.post(
        "/api/learning/approvals/does-not-exist/edit-approve",
        json={"actor_id": PILOT_TEACHER_ID, "edits": {}},
    )
    assert response.status_code == 404


def test_edit_and_approve_rejects_already_decided(client, learning_api: LearningApi):
    pending = _drive_to_pending_plan(client, learning_api)
    plan_id = pending["id"]
    # First approve, then attempt to edit.
    client.post(
        f"/api/learning/approvals/{plan_id}/approve",
        json={"actor_id": PILOT_TEACHER_ID},
    )
    response = client.post(
        f"/api/learning/approvals/{plan_id}/edit-approve",
        json={"actor_id": PILOT_TEACHER_ID, "edits": {"rationale": "late edit"}},
    )
    assert response.status_code == 409


def test_edit_and_approve_invalid_edits_returns_400(client, learning_api: LearningApi):
    pending = _drive_to_pending_plan(client, learning_api)
    plan_id = pending["id"]
    response = client.post(
        f"/api/learning/approvals/{plan_id}/edit-approve",
        json={
            "actor_id": PILOT_TEACHER_ID,
            "edits": {"target_skill_ids": []},  # min_length=1 violated
        },
    )
    assert response.status_code == 400


def test_edit_and_approve_rejects_uncatalogued_skill(client, learning_api: LearningApi):
    pending = _drive_to_pending_plan(client, learning_api)
    plan_id = pending["id"]
    response = client.post(
        f"/api/learning/approvals/{plan_id}/edit-approve",
        json={
            "actor_id": PILOT_TEACHER_ID,
            "edits": {"target_skill_ids": ["skill-not-in-catalogue"]},
        },
    )
    # PlanValidator's catalogue_grounding_rule should reject this.
    assert response.status_code == 422
