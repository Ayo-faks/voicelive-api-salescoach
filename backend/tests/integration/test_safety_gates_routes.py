"""Integration tests for the MVP safety controls wired through Flask routes.

Covers:
- Global learner-voice kill switch returns 403 on POST /api/agents/create.
- Missing parental consent returns 403 with the missing-field detail.
- Full parental consent allows the create_agent path to proceed.
- /api/config exposes the safety status payload for the frontend.
"""

from __future__ import annotations

from collections.abc import Iterator
import os
from pathlib import Path

import pytest
from flask.testing import FlaskClient

import src.app as app_module
from src.learning.repository import InMemoryLearningRepository
from src.services import safety_gates
from src.services.storage import StorageService


def _auth_headers(user_id: str, email: str, name: str = "Test User") -> dict[str, str]:
    return {
        "X-MS-CLIENT-PRINCIPAL-ID": user_id,
        "X-MS-CLIENT-PRINCIPAL-NAME": name,
        "X-MS-CLIENT-PRINCIPAL-EMAIL": email,
        "X-MS-CLIENT-PRINCIPAL-IDP": "aad",
    }


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[FlaskClient]:
    storage_service = StorageService(str(tmp_path / "safety_routes.db"))
    monkeypatch.setattr(app_module, "storage_service", storage_service)
    monkeypatch.setenv("LOCAL_DEV_AUTH", "false")
    for var in (
        "WULO_LEARNER_VOICE_DISABLED",
        "WULO_REQUIRE_REVIEWED_CONTENT",
        "WULO_ALLOW_UNREVIEWED_CONTENT",
        "IDENTITY_ENDPOINT",
        "WEBSITE_SITE_NAME",
        "CONTAINER_APP_NAME",
    ):
        monkeypatch.delenv(var, raising=False)
    if isinstance(app_module.learning_repository, InMemoryLearningRepository):
        app_module.learning_repository.teacher_classes.clear()
    app_module.app.config["TESTING"] = True
    with app_module.app.test_client() as test_client:
        yield test_client
    os.environ.pop("LOCAL_DEV_AUTH", None)


def _bootstrap_therapist_with_child(
    client: FlaskClient, *, name: str = "Ada"
) -> tuple[dict[str, str], str]:
    therapist_headers = _auth_headers("user-therapist", "therapist@example.com", name="T")
    session = client.get("/api/auth/session", headers=therapist_headers)
    assert session.status_code == 200, session.get_json()
    child = client.post("/api/children", headers=therapist_headers, json={"name": name})
    assert child.status_code in (200, 201), child.get_json()
    return therapist_headers, child.get_json()["id"]


def _grant_full_parental_consent(
    storage_service: StorageService, child_id: str, *, recorded_by_user_id: str
) -> None:
    storage_service.save_parental_consent(
        child_id=child_id,
        guardian_name="Guardian",
        guardian_email="guardian@example.com",
        privacy_accepted=True,
        terms_accepted=True,
        ai_notice_accepted=True,
        personal_data_consent_accepted=True,
        special_category_consent_accepted=True,
        parental_responsibility_confirmed=True,
        recorded_by_user_id=recorded_by_user_id,
    )


def test_config_endpoint_exposes_safety_payload(client: FlaskClient):
    headers = _auth_headers("user-cfg", "cfg@example.com")
    response = client.get("/api/config", headers=headers)
    assert response.status_code == 200
    body = response.get_json()
    assert "safety" in body, body
    safety = body["safety"]
    assert safety["learner_voice_disabled"] is False
    assert "session_turn_cap" in safety
    assert "session_token_cap" in safety
    assert "production_content_review_required" in safety


def test_config_endpoint_reflects_kill_switch(
    client: FlaskClient, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("WULO_LEARNER_VOICE_DISABLED", "true")
    headers = _auth_headers("user-cfg2", "cfg2@example.com")
    response = client.get("/api/config", headers=headers)
    assert response.status_code == 200
    assert response.get_json()["safety"]["learner_voice_disabled"] is True


def test_create_agent_blocks_when_safety_kill_switch_enabled(
    client: FlaskClient, monkeypatch: pytest.MonkeyPatch
):
    therapist_headers, child_id = _bootstrap_therapist_with_child(client)
    _grant_full_parental_consent(
        app_module.storage_service, child_id, recorded_by_user_id="user-therapist"
    )

    monkeypatch.setenv("WULO_LEARNER_VOICE_DISABLED", "true")

    response = client.post(
        "/api/agents/create",
        headers=therapist_headers,
        json={"scenario_id": "doesnt-matter", "child_id": child_id},
    )
    assert response.status_code == 403, response.get_json()
    body = response.get_json()
    assert body["error"] == "learner_voice_disabled"
    assert body["reason"] == safety_gates.REASON_KILL_SWITCH


def test_create_agent_blocks_when_parental_consent_missing(client: FlaskClient):
    therapist_headers, child_id = _bootstrap_therapist_with_child(client)
    # No parental consent persisted.

    response = client.post(
        "/api/agents/create",
        headers=therapist_headers,
        json={"scenario_id": "doesnt-matter", "child_id": child_id},
    )
    assert response.status_code == 403, response.get_json()
    body = response.get_json()
    assert body["error"] == "missing_consent"
    assert body["reason"] == safety_gates.REASON_MISSING_CONSENT
    # All voice-required fields should be flagged.
    missing = set(body.get("missing") or [])
    assert "special_category_consent_accepted" in missing
    assert "parental_responsibility_confirmed" in missing


def test_create_agent_passes_safety_gate_with_full_consent(client: FlaskClient):
    therapist_headers, child_id = _bootstrap_therapist_with_child(client)
    _grant_full_parental_consent(
        app_module.storage_service, child_id, recorded_by_user_id="user-therapist"
    )

    response = client.post(
        "/api/agents/create",
        headers=therapist_headers,
        json={"scenario_id": "non-existent-scenario", "child_id": child_id},
    )
    # We expect the safety gate to PASS (not 403). The downstream scenario
    # lookup will then return 404. Either 404 or 200 proves we got past the
    # safety guard; what matters is we did not get a 403 from safety.
    assert response.status_code != 403, response.get_json()


def _grant_data_only_partial_consent(
    storage_service: StorageService,
    child_id: str,
    *,
    recorded_by_user_id: str,
    personal_data_consent_accepted: bool = True,
) -> None:
    """Persist data-only consent (no voice fields) with one toggle for the caller."""
    storage_service.save_parental_consent(
        child_id=child_id,
        guardian_name="Guardian",
        guardian_email="guardian@example.com",
        privacy_accepted=True,
        terms_accepted=True,
        ai_notice_accepted=True,
        personal_data_consent_accepted=personal_data_consent_accepted,
        special_category_consent_accepted=False,
        parental_responsibility_confirmed=False,
        recorded_by_user_id=recorded_by_user_id,
    )


def test_child_sessions_read_blocks_when_data_consent_missing(client: FlaskClient):
    therapist_headers, child_id = _bootstrap_therapist_with_child(client)
    # No parental consent persisted at all.

    response = client.get(f"/api/children/{child_id}/sessions", headers=therapist_headers)
    assert response.status_code == 403, response.get_json()
    body = response.get_json()
    assert body["error"] == "missing_consent"
    assert body["reason"] == safety_gates.REASON_MISSING_CONSENT


def test_child_sessions_read_blocks_when_data_consent_revoked(client: FlaskClient):
    therapist_headers, child_id = _bootstrap_therapist_with_child(client)
    _grant_data_only_partial_consent(
        app_module.storage_service,
        child_id,
        recorded_by_user_id="user-therapist",
        personal_data_consent_accepted=False,
    )

    response = client.get(f"/api/children/{child_id}/sessions", headers=therapist_headers)
    assert response.status_code == 403, response.get_json()
    body = response.get_json()
    assert body["error"] == "missing_consent"
    assert "personal_data_consent_accepted" in (body.get("missing") or [])


def test_child_sessions_read_allowed_with_full_consent(client: FlaskClient):
    therapist_headers, child_id = _bootstrap_therapist_with_child(client)
    _grant_full_parental_consent(
        app_module.storage_service, child_id, recorded_by_user_id="user-therapist"
    )

    response = client.get(f"/api/children/{child_id}/sessions", headers=therapist_headers)
    assert response.status_code == 200, response.get_json()
    assert isinstance(response.get_json(), list)


def test_child_reports_list_blocks_when_data_consent_missing(client: FlaskClient):
    therapist_headers, child_id = _bootstrap_therapist_with_child(client)
    # No parental consent persisted — read should fail closed.

    response = client.get(f"/api/children/{child_id}/reports", headers=therapist_headers)
    assert response.status_code == 403, response.get_json()
    body = response.get_json()
    assert body["error"] == "missing_consent"
