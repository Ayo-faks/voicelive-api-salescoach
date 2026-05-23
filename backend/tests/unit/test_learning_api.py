"""Unit coverage for the F6 `/api/learning/*` HTTP surface.

These tests exercise the route handlers through ``LearningApi`` and through a
Flask ``test_client`` so we cover both the pure logic and the JSON wiring. The
acceptance scenario (start diagnostic → answer one item → mastery cell updates
→ pending plan approved → xAPI ledger records `approved`) is asserted in
``test_diagnostic_to_approval_roundtrip``.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict

import pytest
from flask import Flask

from src.learning.api import (
    ITEM_BANK_PATH,
    LearningApi,
    PILOT_STUDENT_ID,
    PILOT_TEACHER_ID,
    PILOT_TENANT_ID,
    register_learning_api,
)
from src.learning.diagnostic import load_item_bank


def _bank_path() -> Path:
    assert ITEM_BANK_PATH.exists(), f"item bank fixture missing at {ITEM_BANK_PATH}"
    return ITEM_BANK_PATH


@pytest.fixture()
def learning_api() -> LearningApi:
    return LearningApi(item_bank=load_item_bank(_bank_path()))


@pytest.fixture()
def client(learning_api: LearningApi):
    app = Flask(__name__)
    app.config["TESTING"] = True
    register_learning_api(app, learning_api)
    return app.test_client()


def _start(client) -> Dict[str, Any]:
    response = client.post("/api/learning/diagnostic/start", json={})
    assert response.status_code == 200, response.get_data(as_text=True)
    return response.get_json()


def _answer(client, session_id: str, item: Dict[str, Any], text: str):
    response = client.post(
        "/api/learning/diagnostic/answer",
        json={"session_id": session_id, "item_id": item["item_id"], "response_text": text},
    )
    assert response.status_code == 200, response.get_data(as_text=True)
    return response.get_json()


def test_start_diagnostic_returns_first_item(client):
    payload = _start(client)
    assert payload["item"] is not None
    assert payload["items_total"] > 0
    assert payload["items_remaining"] == payload["items_total"] - 1
    assert payload["lang"].startswith("en")


def test_answer_drives_mastery_and_completes(client, learning_api: LearningApi):
    started = _start(client)
    session_id = started["session_id"]
    item = started["item"]
    first_answer = _answer(client, session_id, item, item["item_id"])
    assert first_answer["correct"] is False
    estimate = first_answer["mastery_estimate"]
    assert estimate["kind"] == "beta"
    assert 0.0 <= estimate["probability"] <= 1.0

    mastery = client.get(
        "/api/learning/class/mastery",
        query_string={"tenant_id": PILOT_TENANT_ID},
    ).get_json()
    assert any(cell["skill_id"] == item["skill_id"] for cell in mastery["cells"])

    next_item = first_answer["next_item"]
    while next_item is not None:
        bank_item = next(
            entry for entry in learning_api.item_bank.items if entry.item_id == next_item["item_id"]
        )
        result = _answer(client, session_id, next_item, bank_item.correct_answer or "")
        next_item = result["next_item"]
    assert result["completed"] is True
    assert result["pending_plan"] is not None
    assert result["pending_plan"]["status"] == "pending"
    assert result["completion_xapi"]["verb"]["id"].endswith("completed")


def test_unknown_session_returns_404(client):
    response = client.post(
        "/api/learning/diagnostic/answer",
        json={"session_id": "bogus", "item_id": "x", "response_text": "y"},
    )
    assert response.status_code == 404


def test_diagnostic_to_approval_roundtrip(client, learning_api: LearningApi):
    started = _start(client)
    session_id = started["session_id"]
    current_item = started["item"]
    plan_id = None
    while current_item is not None:
        bank_item = next(
            entry for entry in learning_api.item_bank.items if entry.item_id == current_item["item_id"]
        )
        result = _answer(client, session_id, current_item, bank_item.correct_answer or "")
        current_item = result["next_item"]
        if result["completed"]:
            plan_id = result["pending_plan"]["id"]
    assert plan_id is not None

    pending = client.get("/api/learning/approvals/pending").get_json()
    assert any(record["id"] == plan_id for record in pending["plans"])

    approve = client.post(
        f"/api/learning/approvals/{plan_id}/approve",
        json={"actor_id": PILOT_TEACHER_ID, "reason": "Phase 0 acceptance"},
    )
    assert approve.status_code == 200, approve.get_data(as_text=True)
    decision = approve.get_json()
    assert decision["action"] == "approved"
    assert decision["xapi_statement"]["verb"]["id"].endswith("approved")

    pending_after = client.get("/api/learning/approvals/pending").get_json()
    assert not any(record["id"] == plan_id for record in pending_after["plans"])

    ledger_verbs = [
        record["verb_id"]
        for record in learning_api.repository.xapi_statements
        if record["tenant_id"] == PILOT_TENANT_ID
    ]
    assert any(verb.endswith("approved") for verb in ledger_verbs)

    audit = client.get("/api/learning/audit").get_json()
    assert any(event["kind"] == "plan_approved" for event in audit["events"])


def test_reject_marks_plan_rejected(client, learning_api: LearningApi):
    started = _start(client)
    session_id = started["session_id"]
    current_item = started["item"]
    plan_id = None
    while current_item is not None:
        bank_item = next(
            entry for entry in learning_api.item_bank.items if entry.item_id == current_item["item_id"]
        )
        result = _answer(client, session_id, current_item, bank_item.correct_answer or "")
        current_item = result["next_item"]
        if result["completed"]:
            plan_id = result["pending_plan"]["id"]
    assert plan_id is not None

    rejection = client.post(
        f"/api/learning/approvals/{plan_id}/reject",
        json={"actor_id": PILOT_STUDENT_ID, "reason": "Off topic for this class"},
    )
    assert rejection.status_code == 200, rejection.get_data(as_text=True)
    body = rejection.get_json()
    assert body["action"] == "rejected"


def test_intent_endpoint_returns_validated_plan(client, learning_api: LearningApi):
    payload = client.post(
        "/api/learning/intent",
        json={
            "tenant_id": PILOT_TENANT_ID,
            "actor_id": PILOT_TEACHER_ID,
            "role": "teacher",
            "prompt": "Build a re-teach group for ratio-proportion.",
        },
    ).get_json()
    assert payload["validated"] is True
    plan = payload["plan"]
    assert plan["target_skill_ids"]
    assert plan["lang"].startswith("en")


def test_intent_requires_prompt(client):
    response = client.post("/api/learning/intent", json={})
    assert response.status_code == 400


def test_pilot_kpis_endpoint_returns_fixture_cards(client):
    response = client.get("/api/learning/kpis")
    assert response.status_code == 200
    body = response.get_json()
    assert body["source"] == "fixture"
    assert body["tenant_id"] == "tenant-phase-4"
    assert body["week_count"] >= 1
    cards = body["cards"]
    labels = [card["label"] for card in cards]
    assert labels == [
        "Diagnostic completion",
        "Approved interventions",
        "Provenance coverage",
        "Safety pass rate",
        "DSR SLA",
        "Weekly cost per student",
    ]
    # Provenance must be present for every endpoint per architecture rule.
    assert body["provenance"], "pilot KPI response must carry provenance"
    assert body["report"]["meets_pilot_thresholds"] in (True, False)


def test_pilot_kpis_unknown_tenant_returns_404(client):
    response = client.get("/api/learning/kpis", query_string={"tenant_id": "tenant-missing"})
    assert response.status_code == 404


def test_voice_config_defaults_disabled(client, monkeypatch):
    monkeypatch.delenv("PATHFINDER_VOICE_ENABLED", raising=False)
    response = client.get("/api/learning/voice/config")
    assert response.status_code == 200
    body = response.get_json()
    assert body["enabled"] is False
    assert body["transport"] == "flask-sock"
    assert body["offline_fallback"] == "queued_multilingual_voice_frame"


def test_voice_frame_rejected_when_flag_off(client, monkeypatch):
    monkeypatch.delenv("PATHFINDER_VOICE_ENABLED", raising=False)
    response = client.post(
        "/api/learning/voice/frame",
        json={"mode": "text", "payload": "hello"},
    )
    assert response.status_code == 403


def test_voice_frame_queues_offline_when_enabled(client, learning_api, monkeypatch):
    monkeypatch.setenv("PATHFINDER_VOICE_ENABLED", "1")
    response = client.post(
        "/api/learning/voice/frame",
        json={"mode": "text", "payload": "Bawo ni, how do I solve 3/4 + 1/2?"},
    )
    assert response.status_code == 200, response.get_data(as_text=True)
    body = response.get_json()
    assert body["accepted"] is True
    assert body["queued"] is True
    assert body["offline_fallback"] == "queued_multilingual_voice_frame"
    assert body["transcript"] == "Bawo ni, how do I solve 3/4 + 1/2?"
    assert body["queue_id"].startswith("offline-queue-")
    # provenance carried through
    assert any(p["rule_id"] == "phase_3_voice_offline_queue" for p in body["provenance"])
    # audit ledger recorded the queued frame
    audit = client.get("/api/learning/audit").get_json()
    kinds = [event["kind"] for event in audit["events"]]
    assert "voice_frame_queued" in kinds


def test_voice_frame_invalid_payload_returns_400(client, monkeypatch):
    monkeypatch.setenv("PATHFINDER_VOICE_ENABLED", "1")
    response = client.post(
        "/api/learning/voice/frame",
        json={"mode": "text", "payload": ""},
    )
    assert response.status_code == 400
