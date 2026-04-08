"""Integration tests for therapist child-memory endpoints."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from flask.testing import FlaskClient

import src.app as app_module
from src.services.child_memory_service import ChildMemoryService
from src.services.storage import StorageService


def _auth_headers(user_id: str, email: str, name: str = "Test User", provider: str = "aad") -> dict[str, str]:
    return {
        "X-MS-CLIENT-PRINCIPAL-ID": user_id,
        "X-MS-CLIENT-PRINCIPAL-NAME": name,
        "X-MS-CLIENT-PRINCIPAL-EMAIL": email,
        "X-MS-CLIENT-PRINCIPAL-IDP": provider,
    }


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[FlaskClient]:
    storage_service = StorageService(str(tmp_path / "child-memory-api.db"))
    child_memory_service = ChildMemoryService(storage_service)

    monkeypatch.setattr(app_module, "storage_service", storage_service)
    monkeypatch.setattr(app_module, "child_memory_service", child_memory_service)
    app_module.app.config["TESTING"] = True

    with app_module.app.test_client() as test_client:
        yield test_client


def _bootstrap_therapist(client: FlaskClient) -> dict[str, str]:
    headers = _auth_headers("therapist-1", "therapist@example.com", name="First User")
    response = client.get("/api/auth/session", headers=headers)
    assert response.status_code == 200
    return headers


def _create_memory_seed() -> str:
    session = app_module.storage_service.save_session(
        {
            "id": "session-child-memory-api-1",
            "child_id": "child-ayo",
            "child_name": "Ayo",
            "exercise": {
                "id": "exercise-r",
                "name": "R Warmup",
                "description": "Practice /r/ words",
                "exerciseMetadata": {"targetSound": "r", "difficulty": "medium"},
            },
            "exercise_metadata": {"targetSound": "r", "difficulty": "medium"},
            "ai_assessment": {
                "overall_score": 74,
                "engagement_and_effort": {"willingness_to_retry": 8},
            },
            "pronunciation_assessment": {"accuracy_score": 63, "pronunciation_score": 65},
            "transcript": "Child practised /r/ words.",
            "reference_text": "red rabbit",
        }
    )
    feedback_session = app_module.storage_service.save_session_feedback(
        session["id"],
        "up",
        "Retry prompts helped today.",
    )
    assert feedback_session is not None
    app_module.child_memory_service.synthesize_session_memory(session["id"])
    proposal = app_module.storage_service.list_child_memory_proposals("child-ayo", status="pending")[0]
    return str(proposal["id"])


def test_therapist_can_read_and_review_child_memory(client: FlaskClient):
    headers = _bootstrap_therapist(client)
    proposal_id = _create_memory_seed()

    proposals_response = client.get(
        "/api/children/child-ayo/memory/proposals?status=pending&include_evidence=true",
        headers=headers,
    )
    assert proposals_response.status_code == 200
    proposals = proposals_response.get_json()
    assert proposals[0]["id"] == proposal_id
    assert proposals[0]["evidence_links"]

    approve_response = client.post(
        f"/api/memory/proposals/{proposal_id}/approve",
        headers=headers,
        json={"note": "Seen across sessions."},
    )
    assert approve_response.status_code == 200
    approved = approve_response.get_json()
    assert approved["proposal"]["status"] == "approved"

    summary_response = client.get("/api/children/child-ayo/memory/summary", headers=headers)
    assert summary_response.status_code == 200
    summary = summary_response.get_json()
    assert summary["source_item_count"] == 2

    items_response = client.get(
        "/api/children/child-ayo/memory/items?include_evidence=true",
        headers=headers,
    )
    assert items_response.status_code == 200
    items = items_response.get_json()
    approved_from_proposal = next(item for item in items if item.get("source_proposal_id") == proposal_id)
    assert approved_from_proposal["evidence_links"]

    evidence_response = client.get(
        f"/api/memory/item/{approved_from_proposal['id']}/evidence",
        headers=headers,
    )
    assert evidence_response.status_code == 200
    assert evidence_response.get_json()


def test_therapist_can_create_manual_child_memory_item(client: FlaskClient):
    headers = _bootstrap_therapist(client)

    response = client.post(
        "/api/children/child-ayo/memory/items",
        headers=headers,
        json={
            "category": "preferences",
            "memory_type": "fact",
            "statement": "Ayo settles faster with short visual models.",
        },
    )

    assert response.status_code == 201
    payload = response.get_json()
    assert payload["item"]["statement"] == "Ayo settles faster with short visual models."
    assert payload["summary"]["source_item_count"] == 1


def test_non_therapist_cannot_access_child_memory_endpoints(client: FlaskClient):
    therapist_headers = _bootstrap_therapist(client)
    user_headers = _auth_headers("user-2", "user@example.com", name="Second User")
    client.get("/api/auth/session", headers=user_headers)

    responses = [
        client.get("/api/children/child-ayo/memory/summary", headers=user_headers),
        client.get("/api/children/child-ayo/memory/items", headers=user_headers),
        client.get("/api/children/child-ayo/memory/proposals", headers=user_headers),
    ]

    assert therapist_headers["X-MS-CLIENT-PRINCIPAL-ID"] == "therapist-1"
    for response in responses:
        assert response.status_code == 403
        assert response.get_json() == {"error": "Therapist role required"}