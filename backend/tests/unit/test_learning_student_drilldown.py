"""C1-C3: student drilldown profile + mastery override route + xAPI events."""

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


@pytest.fixture()
def learning_api() -> LearningApi:
    return LearningApi(item_bank=load_item_bank(Path(ITEM_BANK_PATH)))


@pytest.fixture()
def client(learning_api: LearningApi):
    app = Flask(__name__)
    app.config["TESTING"] = True
    register_learning_api(app, learning_api)
    return app.test_client()


def _seed_one_response(client) -> Dict[str, Any]:
    started = client.post("/api/learning/diagnostic/start", json={}).get_json()
    item = started["item"]
    client.post(
        "/api/learning/diagnostic/answer",
        json={
            "session_id": started["session_id"],
            "item_id": item["item_id"],
            "response_text": item["item_id"],  # deliberately wrong
        },
    )
    return item


# ----------------------------------------------------------------------
# C1 — GET /api/learning/students/<student_id>/profile
# ----------------------------------------------------------------------


def test_profile_returns_skills_responses_and_emits_view_event(
    client, learning_api: LearningApi
):
    item = _seed_one_response(client)

    response = client.get(f"/api/learning/students/{PILOT_STUDENT_ID}/profile")
    assert response.status_code == 200, response.get_data(as_text=True)
    body = response.get_json()

    assert body["student_id"] == PILOT_STUDENT_ID
    assert body["tenant_id"] == PILOT_TENANT_ID
    assert len(body["skills"]) >= 1
    skill_row = body["skills"][0]
    assert {"skill_id", "skill_label", "probability", "uncertainty", "status"} <= set(
        skill_row.keys()
    )
    assert body["recent_responses"] and body["recent_responses"][0]["item_id"] == item["item_id"]
    assert body["recent_mastery_events"]
    assert body["gaps"]
    assert body["gaps"][0]["evidence"]
    assert body["voice_fluency"]["status"] == "not_recorded"
    assert body["xapi_id"]

    # xAPI statement was emitted and recorded.
    repo_statements = learning_api.repository.xapi_statements
    profile_statements = [
        s
        for s in repo_statements
        if s["verb_id"] == "https://pathfinder.learn/xapi/verbs/viewed-profile"
    ]
    assert len(profile_statements) == 1
    assert profile_statements[0]["sink_status"] in {"ralph_queued", "ralph_synced"}

    audit = body["audit"]
    assert audit["kind"] == "student_profile_view"


def test_profile_empty_when_no_responses(client):
    response = client.get(f"/api/learning/students/{PILOT_STUDENT_ID}/profile")
    assert response.status_code == 200
    body = response.get_json()
    assert body["skills"] == []
    assert body["strengths"] == []
    assert body["gaps"] == []
    assert body["proposed_student_facts"] == []
    assert body["recent_mastery_events"] == []
    assert body["recent_responses"] == []


def test_profile_surfaces_pending_facts_and_voice_fluency_for_selected_pilot_student(client):
    response = client.get("/api/learning/students/student-001/profile")
    assert response.status_code == 200, response.get_data(as_text=True)
    body = response.get_json()

    assert body["voice_fluency"]["status"] == "available"
    assert body["voice_fluency"]["score"] == pytest.approx(72.0)
    assert body["proposed_student_facts"]
    assert body["proposed_student_facts"][0]["fact"]["value"] == (
        "Needs worked examples before independent ratio practice"
    )


# ----------------------------------------------------------------------
# C2 — POST /api/learning/students/<student_id>/override
# ----------------------------------------------------------------------


def test_override_updates_mastery_and_emits_override_event(
    client, learning_api: LearningApi
):
    _seed_one_response(client)
    skill_id = list(
        learning_api._student_estimates[(PILOT_TENANT_ID, PILOT_STUDENT_ID)].keys()
    )[0]

    response = client.post(
        f"/api/learning/students/{PILOT_STUDENT_ID}/override",
        json={
            "tenant_id": PILOT_TENANT_ID,
            "actor_id": PILOT_TEACHER_ID,
            "skill_id": skill_id,
            "probability": 0.92,
            "uncertainty": 0.05,
            "reason": "Verbal demonstration in class",
        },
    )
    assert response.status_code == 200, response.get_data(as_text=True)
    body = response.get_json()
    assert body["ok"] is True
    assert body["estimate"]["probability"] == pytest.approx(0.92)
    assert body["estimate"]["uncertainty"] == pytest.approx(0.05)
    assert body["estimate"]["kind"] == "beta"
    assert body["status"] == "secure"

    stored = learning_api._student_estimates[(PILOT_TENANT_ID, PILOT_STUDENT_ID)][skill_id]
    assert stored.probability == pytest.approx(0.92)

    override_statements = [
        s
        for s in learning_api.repository.xapi_statements
        if s["verb_id"] == "https://pathfinder.learn/xapi/verbs/overrode-mastery"
    ]
    assert len(override_statements) == 1
    assert override_statements[0]["actor_id"] == PILOT_TEACHER_ID

    audit_kinds = [e["kind"] for e in learning_api._audit_events]
    assert "mastery_override" in audit_kinds


def test_override_rejects_unknown_skill(client):
    response = client.post(
        f"/api/learning/students/{PILOT_STUDENT_ID}/override",
        json={
            "skill_id": "skill-does-not-exist",
            "probability": 0.8,
            "reason": "test",
        },
    )
    assert response.status_code == 404


def test_override_rejects_invalid_probability(client, learning_api: LearningApi):
    _seed_one_response(client)
    skill_id = list(
        learning_api._student_estimates[(PILOT_TENANT_ID, PILOT_STUDENT_ID)].keys()
    )[0]
    response = client.post(
        f"/api/learning/students/{PILOT_STUDENT_ID}/override",
        json={"skill_id": skill_id, "probability": 1.5, "reason": "test"},
    )
    assert response.status_code == 400


def test_override_requires_reason(client, learning_api: LearningApi):
    _seed_one_response(client)
    skill_id = list(
        learning_api._student_estimates[(PILOT_TENANT_ID, PILOT_STUDENT_ID)].keys()
    )[0]
    response = client.post(
        f"/api/learning/students/{PILOT_STUDENT_ID}/override",
        json={"skill_id": skill_id, "probability": 0.7},
    )
    assert response.status_code == 400


# ----------------------------------------------------------------------
# Sink wiring sanity — emit_xapi_statement routes through RalphXAPISink
# ----------------------------------------------------------------------


def test_emit_xapi_routes_through_sink(learning_api: LearningApi):
    sink = learning_api.sink
    before = len(sink.emitted)
    # Drive one diagnostic answer which emits a mastery xAPI statement.
    payload = learning_api.start_diagnostic({})
    learning_api.answer_diagnostic(
        {
            "session_id": payload["session_id"],
            "item_id": payload["item"]["item_id"],
            "response_text": "wrong-answer",
        }
    )
    assert len(sink.emitted) > before
    # Offline default -> queued status, propagated to repo record.
    statuses = {s["sink_status"] for s in learning_api.repository.xapi_statements}
    assert statuses <= {"ralph_queued", "ralph_synced"}
