"""Integration tests for therapist practice plan endpoints."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from flask.testing import FlaskClient

import src.app as app_module
from src.services.planning_service import CopilotPlannerTurnResult, PracticePlanningService
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
                "name": "R Warmup",
                "exerciseMetadata": {"targetSound": "r", "difficulty": "medium"},
            },
            {
                "id": "exercise-2",
                "name": "Listening Minimal Pairs",
                "exerciseMetadata": {"targetSound": "r", "difficulty": "medium"},
            },
        ]


class _FakePlannerRuntime:
    def __init__(self):
        self.model = "gpt-5"

    def run_turn(self, *, planner_session_id: str, therapist_prompt: str, planning_context):
        del planning_context
        listening_first = "listening" in therapist_prompt.lower()
        return CopilotPlannerTurnResult(
            planner_session_id=planner_session_id,
            draft={
                "objective": "Increase /r/ confidence.",
                "focus_sound": "r",
                "rationale": "Built from the stored session and therapist note.",
                "estimated_duration_minutes": 12 if "short" in therapist_prompt.lower() else 15,
                "activities": [
                    {
                        "title": "Listening warm-up" if listening_first else "R Warmup",
                        "exercise_id": "exercise-2" if listening_first else "exercise-1",
                        "exercise_name": "Listening Minimal Pairs" if listening_first else "R Warmup",
                        "reason": "Matches the /r/ target.",
                        "target_duration_minutes": 4,
                    }
                ],
                "therapist_cues": ["Use warm praise before correction."],
                "success_criteria": ["One supported accurate /r/ production."],
                "carryover": ["One brief /r/ home task."],
            },
            raw_content="{}",
            tool_calls=2,
        )

    def get_readiness(self, force_refresh: bool = False):
        del force_refresh
        return {
            "ready": True,
            "model": self.model,
            "sdk_installed": True,
            "cli": {"available": True, "authenticated": True},
            "auth": {"github_token_configured": False, "azure_byok_configured": False},
            "reasons": [],
        }


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[FlaskClient]:
    storage_service = StorageService(str(tmp_path / "planner.db"))
    monkeypatch.setattr(app_module, "storage_service", storage_service)
    monkeypatch.setattr(app_module, "scenario_manager", _ScenarioStub())
    monkeypatch.setattr(
        app_module,
        "planning_service",
        PracticePlanningService(storage_service, _ScenarioStub(), planner_runtime=_FakePlannerRuntime()),
    )
    app_module.app.config["TESTING"] = True

    with app_module.app.test_client() as test_client:
        yield test_client


def _bootstrap_therapist(client: FlaskClient) -> dict[str, str]:
    headers = _auth_headers("therapist-1", "therapist@example.com", name="First User")
    response = client.get("/api/auth/session", headers=headers)
    assert response.status_code == 200
    return headers


def _create_session(client: FlaskClient) -> str:
    session = app_module.storage_service.save_session(
        {
            "child_id": "child-ayo",
            "child_name": "Ayo",
            "exercise": {
                "id": "exercise-1",
                "name": "R Warmup",
                "description": "Practice /r/ words",
                "exerciseMetadata": {"targetSound": "r", "difficulty": "medium"},
            },
            "exercise_metadata": {"targetSound": "r", "difficulty": "medium"},
            "ai_assessment": {
                "overall_score": 72,
                "engagement_and_effort": {"willingness_to_retry": 7},
                "practice_suggestions": ["Keep /r/ practice playful."],
            },
            "pronunciation_assessment": {"accuracy_score": 66},
            "transcript": "Child practised /r/ words.",
            "reference_text": "red rabbit",
        }
    )
    return str(session["id"])


def test_therapist_can_create_refine_and_approve_plan(client: FlaskClient):
    headers = _bootstrap_therapist(client)
    session_id = _create_session(client)

    create_response = client.post(
        "/api/plans",
        headers=headers,
        json={
            "child_id": "child-ayo",
            "source_session_id": session_id,
            "message": "Keep this short and playful.",
        },
    )
    assert create_response.status_code == 200
    plan = create_response.get_json()
    assert plan["draft"]["activities"]

    refine_response = client.post(
        f"/api/plans/{plan['id']}/messages",
        headers=headers,
        json={"message": "Lead with a listening task."},
    )
    assert refine_response.status_code == 200
    refined = refine_response.get_json()
    assert refined["conversation"][-1]["role"] == "assistant"

    approve_response = client.post(f"/api/plans/{plan['id']}/approve", headers=headers, json={})
    assert approve_response.status_code == 200
    approved = approve_response.get_json()
    assert approved["status"] == "approved"

    list_response = client.get("/api/children/child-ayo/plans", headers=headers)
    assert list_response.status_code == 200
    listed = list_response.get_json()
    assert len(listed) == 1


def test_non_therapist_cannot_access_planner_endpoints(client: FlaskClient):
    therapist_headers = _bootstrap_therapist(client)
    user_headers = _auth_headers("user-2", "user@example.com", name="Second User")
    client.get("/api/auth/session", headers=user_headers)
    # New signups bootstrap as therapist by policy (see test_auth_roles.py).
    # Demote user-2 to parent so the role guard on /api/plans can be exercised.
    app_module.storage_service.update_user_role("user-2", "parent")
    session_id = _create_session(client)

    response = client.post(
        "/api/plans",
        headers=user_headers,
        json={
            "child_id": "child-ayo",
            "source_session_id": session_id,
        },
    )

    assert therapist_headers["X-MS-CLIENT-PRINCIPAL-ID"] == "therapist-1"
    assert response.status_code == 403
    assert response.get_json() == {"error": "Therapist role required"}