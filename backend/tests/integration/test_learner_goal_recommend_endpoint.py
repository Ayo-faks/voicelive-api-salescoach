"""Integration tests for the learner goal-intake endpoint.

Covers the RBAC / dual feature-flag guards on ``POST /api/learning/goals/recommend``,
the happy-path "start here" recommendation blocks, and that a stated goal is
persisted onto the learner profile (Option A soft bias).
"""

from __future__ import annotations

from collections.abc import Iterator
import os
from pathlib import Path

import pytest
from flask.testing import FlaskClient

import src.app as app_module
from src.learning.repository import InMemoryLearningRepository
from src.services.storage import StorageService

_STUDENT_ID = "pilot-jss2-student-001"


def _auth_headers(user_id: str, email: str, name: str = "Learner") -> dict[str, str]:
    return {
        "X-MS-CLIENT-PRINCIPAL-ID": user_id,
        "X-MS-CLIENT-PRINCIPAL-NAME": name,
        "X-MS-CLIENT-PRINCIPAL-EMAIL": email,
        "X-MS-CLIENT-PRINCIPAL-IDP": "aad",
    }


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[FlaskClient]:
    storage_service = StorageService(str(tmp_path / "learner_goals.db"))
    monkeypatch.setattr(app_module, "storage_service", storage_service)
    monkeypatch.setenv("LOCAL_DEV_AUTH", "false")
    monkeypatch.setenv("PATHFINDER_LEARNER_ONBOARDING_ENABLED", "true")
    monkeypatch.setenv("PATHFINDER_GOAL_INTAKE_ENABLED", "true")
    monkeypatch.setenv("PATHFINDER_LEARN_LEARNER_STUDENT_IDS", _STUDENT_ID)
    if isinstance(app_module.learning_repository, InMemoryLearningRepository):
        app_module.learning_repository.teacher_classes.clear()
    app_module.app.config["TESTING"] = True

    with app_module.app.test_client() as test_client:
        yield test_client

    os.environ.pop("LOCAL_DEV_AUTH", None)
    os.environ.pop("PATHFINDER_LEARNER_ONBOARDING_ENABLED", None)
    os.environ.pop("PATHFINDER_GOAL_INTAKE_ENABLED", None)
    os.environ.pop("PATHFINDER_LEARN_LEARNER_STUDENT_IDS", None)


def _bootstrap_learner(
    client: FlaskClient, user_id: str = "learner-goal-1", email: str = "goal@example.com"
) -> dict[str, str]:
    headers = _auth_headers(user_id, email)
    assert client.get("/api/auth/session", headers=headers).status_code == 200
    app_module.storage_service.update_user_role(user_id, "learner")
    return headers


def test_goal_intake_flag_off_returns_404(
    client: FlaskClient, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("PATHFINDER_GOAL_INTAKE_ENABLED", "false")
    headers = _bootstrap_learner(client)
    response = client.post(
        "/api/learning/goals/recommend", headers=headers, json={"subject": "Maths"}
    )
    assert response.status_code == 404


def test_anonymous_caller_unauthorised(client: FlaskClient):
    assert client.post("/api/learning/goals/recommend", json={}).status_code == 401


def test_non_learner_role_forbidden(client: FlaskClient):
    headers = _auth_headers("therapist-goal-1", "tg@example.com", name="Therapist")
    assert client.get("/api/auth/session", headers=headers).status_code == 200
    assert (
        client.post("/api/learning/goals/recommend", headers=headers, json={}).status_code
        == 403
    )


def test_goal_recommend_returns_start_here_blocks(client: FlaskClient):
    headers = _bootstrap_learner(client)
    response = client.post(
        "/api/learning/goals/recommend",
        headers=headers,
        json={"subject": "Maths", "exam": "WAEC", "target_date": "this_term"},
    )
    assert response.status_code == 200, response.get_data(as_text=True)
    body = response.get_json()
    assert body["session_complete"] is True
    kinds = [block["kind"] for block in body["blocks"]]
    assert "prose" in kinds
    assert "plan" in kinds


def test_goal_is_persisted_to_profile(client: FlaskClient):
    headers = _bootstrap_learner(client, user_id="learner-goal-2", email="goal2@example.com")
    client.post(
        "/api/learning/goals/recommend",
        headers=headers,
        json={"subject": "English", "exam": "NECO", "target_date": "this_year"},
    )
    profile = app_module.storage_service.get_learner_profile("learner-goal-2")
    assert profile is not None
    goals = profile.get("goals")
    assert isinstance(goals, list) and len(goals) == 1
    assert goals[0]["subject"] == "English"
    assert goals[0]["exam"] == "NECO"
    assert goals[0]["target_date"] == "this_year"
    assert "created_at" in goals[0]


def test_note_only_goal_is_not_persisted(client: FlaskClient):
    headers = _bootstrap_learner(client, user_id="learner-goal-3", email="goal3@example.com")
    response = client.post(
        "/api/learning/goals/recommend",
        headers=headers,
        json={"note": "just looking around"},
    )
    # Still returns recommendations (from profile defaults) but stores no goal.
    assert response.status_code == 200
    profile = app_module.storage_service.get_learner_profile("learner-goal-3")
    assert (profile or {}).get("goals") in (None, [])


# ---------------------------------------------------------------------------
# Voice onboarding profile orchestrator (apply_learner_profile_from_voice)
# ---------------------------------------------------------------------------


def test_voice_profile_persists_normalised_fields(client: FlaskClient):
    # The bootstrap creates the learner + user row the orchestrator writes to.
    _bootstrap_learner(client, user_id="voice-1", email="voice1@example.com")

    result = app_module.apply_learner_profile_from_voice(
        "voice-1",
        {
            "display_name": "Ada",
            "age_band": "16 to 17",  # loose spoken form
            "exam": "waec",  # lowercase
            "year_group": "ss 2",  # spaced
            "subjects": ["Mathematics", "English"],
            "interests": ["Engineering"],
        },
    )

    profile = result["profile"]
    assert profile["display_name"] == "Ada"
    assert profile["age_band"] == "16-17"
    assert profile["exam"] == "WAEC"
    assert profile["year_group"] == "SS2"
    assert profile["subjects"] == ["Mathematics", "English"]
    assert profile["interests"] == ["Engineering"]


def test_voice_profile_never_writes_consent(client: FlaskClient):
    _bootstrap_learner(client, user_id="voice-2", email="voice2@example.com")

    # Even if a consent-looking field is passed, it must be ignored — consent is
    # not part of the validated profile patch the voice path accepts.
    app_module.apply_learner_profile_from_voice(
        "voice-2", {"display_name": "Bob", "terms": True, "privacy": True}
    )

    consents = app_module.storage_service.latest_consents("voice-2")
    assert consents.get("terms") in (None, {}) or not consents.get("terms", {}).get(
        "granted"
    )


def test_voice_profile_empty_fields_is_noop(client: FlaskClient):
    _bootstrap_learner(client, user_id="voice-3", email="voice3@example.com")
    result = app_module.apply_learner_profile_from_voice("voice-3", {})
    # No fields → returns the standard response without error.
    assert "needs_onboarding" in result
