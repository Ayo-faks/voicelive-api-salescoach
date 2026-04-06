"""Integration tests for therapist recommendation endpoints."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from flask.testing import FlaskClient

import src.app as app_module
from src.services.child_memory_service import ChildMemoryService
from src.services.recommendation_service import RecommendationService
from src.services.storage import StorageService


def _auth_headers(user_id: str, email: str, name: str = "Test User", provider: str = "aad") -> dict[str, str]:
    return {
        "X-MS-CLIENT-PRINCIPAL-ID": user_id,
        "X-MS-CLIENT-PRINCIPAL-NAME": name,
        "X-MS-CLIENT-PRINCIPAL-EMAIL": email,
        "X-MS-CLIENT-PRINCIPAL-IDP": provider,
    }


class _ScenarioStub:
    def list_scenarios(self):
        return [
            {
                "id": "exercise-1",
                "name": "R Phrase Builder",
                "description": "Move /r/ into phrases.",
                "exerciseMetadata": {
                    "targetSound": "r",
                    "difficulty": "hard",
                    "type": "two_word_phrase",
                },
            },
            {
                "id": "exercise-2",
                "name": "R Listening Pairs",
                "description": "Listen for /r/ contrasts.",
                "exerciseMetadata": {
                    "targetSound": "r",
                    "difficulty": "easy",
                    "type": "listening_minimal_pairs",
                },
            },
        ]


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[FlaskClient]:
    storage_service = StorageService(str(tmp_path / "recommendation-api.db"))
    child_memory_service = ChildMemoryService(storage_service)
    recommendation_service = RecommendationService(storage_service, _ScenarioStub(), child_memory_service)

    monkeypatch.setattr(app_module, "storage_service", storage_service)
    monkeypatch.setattr(app_module, "scenario_manager", _ScenarioStub())
    monkeypatch.setattr(app_module, "child_memory_service", child_memory_service)
    monkeypatch.setattr(app_module, "recommendation_service", recommendation_service)
    app_module.app.config["TESTING"] = True

    with app_module.app.test_client() as test_client:
        yield test_client


def _bootstrap_therapist(client: FlaskClient) -> dict[str, str]:
    headers = _auth_headers("therapist-1", "therapist@example.com", name="First User")
    response = client.get("/api/auth/session", headers=headers)
    assert response.status_code == 200
    return headers


def _seed_recommendation_context() -> str:
    session = app_module.storage_service.save_session(
        {
            "id": "session-api-recommendation-1",
            "child_id": "child-ayo",
            "child_name": "Ayo",
            "exercise": {
                "id": "exercise-source",
                "name": "R Warmup",
                "description": "Practice /r/ words",
                "exerciseMetadata": {"targetSound": "r", "difficulty": "medium", "type": "two_word_phrase"},
            },
            "exercise_metadata": {"targetSound": "r", "difficulty": "medium", "type": "two_word_phrase"},
            "ai_assessment": {
                "overall_score": 80,
                "engagement_and_effort": {"willingness_to_retry": 8},
            },
            "pronunciation_assessment": {"accuracy_score": 79, "pronunciation_score": 80},
            "transcript": "Child practised /r/ phrases.",
            "reference_text": "red rabbit",
        }
    )
    app_module.storage_service.save_session_feedback(
        session["id"],
        "up",
        "Reviewed by therapist and approved as a strong session.",
    )
    app_module.storage_service.save_child_memory_item(
        {
            "id": "memory-target-r",
            "child_id": "child-ayo",
            "category": "targets",
            "memory_type": "constraint",
            "status": "approved",
            "statement": "Keep /r/ as the active target.",
            "detail": {"target_sound": "r"},
            "confidence": 0.91,
            "provenance": {"session_ids": [session["id"]]},
            "author_type": "therapist",
            "author_user_id": "therapist-1",
        }
    )
    app_module.storage_service.save_child_memory_item(
        {
            "id": "memory-cue-r",
            "child_id": "child-ayo",
            "category": "effective_cues",
            "memory_type": "fact",
            "status": "approved",
            "statement": "Phrase practice with a short verbal model works well.",
            "detail": {"cue": "short verbal model"},
            "confidence": 0.84,
            "provenance": {"session_ids": [session["id"]]},
            "author_type": "therapist",
            "author_user_id": "therapist-1",
        }
    )
    return str(session["id"])


def test_therapist_can_generate_list_and_read_recommendations(client: FlaskClient):
    headers = _bootstrap_therapist(client)
    session_id = _seed_recommendation_context()

    create_response = client.post(
        "/api/children/child-ayo/recommendations",
        headers=headers,
        json={
            "source_session_id": session_id,
            "therapist_constraints": "Keep it playful and move into phrase work.",
            "limit": 2,
        },
    )

    assert create_response.status_code == 201
    created = create_response.get_json()
    assert created["top_recommendation"]["exercise_name"] == "R Phrase Builder"
    assert created["candidates"][0]["explanation"]["supporting_memory_items"]
    assert created["candidates"][0]["explanation"]["supporting_sessions"]
    assert created["ranking_context"]["institutional_memory"]["insights"]
    assert "Ayo" not in created["ranking_context"]["institutional_memory"]["summary_text"]

    list_response = client.get("/api/children/child-ayo/recommendations?limit=5", headers=headers)
    assert list_response.status_code == 200
    history = list_response.get_json()
    assert history[0]["id"] == created["id"]
    assert history[0]["top_recommendation"]["exercise_name"] == "R Phrase Builder"

    detail_response = client.get(f"/api/recommendations/{created['id']}", headers=headers)
    assert detail_response.status_code == 200
    detail = detail_response.get_json()
    assert detail["therapist_constraints"]["note"] == "Keep it playful and move into phrase work."
    assert detail["candidates"][0]["rank"] == 1
    assert detail["candidates"][0]["explanation"]["institutional_insights"]


def test_non_therapist_cannot_access_recommendation_endpoints(client: FlaskClient):
    therapist_headers = _bootstrap_therapist(client)
    user_headers = _auth_headers("user-2", "user@example.com", name="Second User")
    client.get("/api/auth/session", headers=user_headers)

    response = client.get("/api/children/child-ayo/recommendations", headers=user_headers)

    assert therapist_headers["X-MS-CLIENT-PRINCIPAL-ID"] == "therapist-1"
    assert response.status_code == 403
    assert response.get_json() == {"error": "Therapist role required"}
