"""Integration tests for the adaptive learner daily-plan endpoint.

Covers the RBAC / feature-flag guards on ``GET /api/learning/learner/plan`` and
the happy-path fallback queue for a freshly bootstrapped learner.
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
    storage_service = StorageService(str(tmp_path / "learner_plan.db"))
    monkeypatch.setattr(app_module, "storage_service", storage_service)
    monkeypatch.setenv("LOCAL_DEV_AUTH", "false")
    monkeypatch.setenv("PATHFINDER_LEARNER_ONBOARDING_ENABLED", "true")
    # Scope the learner to a deterministic student id so plan ownership resolves
    # without seeding the child graph.
    monkeypatch.setenv("PATHFINDER_LEARN_LEARNER_STUDENT_IDS", _STUDENT_ID)
    if isinstance(app_module.learning_repository, InMemoryLearningRepository):
        app_module.learning_repository.teacher_classes.clear()
    app_module.app.config["TESTING"] = True

    with app_module.app.test_client() as test_client:
        yield test_client

    os.environ.pop("LOCAL_DEV_AUTH", None)
    os.environ.pop("PATHFINDER_LEARNER_ONBOARDING_ENABLED", None)
    os.environ.pop("PATHFINDER_LEARN_LEARNER_STUDENT_IDS", None)


def _bootstrap_learner(
    client: FlaskClient, user_id: str = "learner-plan-1", email: str = "plan@example.com"
) -> dict[str, str]:
    headers = _auth_headers(user_id, email)
    session = client.get("/api/auth/session", headers=headers)
    assert session.status_code == 200
    app_module.storage_service.update_user_role(user_id, "learner")
    return headers


def test_flag_off_returns_404(client: FlaskClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("PATHFINDER_LEARNER_ONBOARDING_ENABLED", "false")
    headers = _bootstrap_learner(client)
    assert client.get("/api/learning/learner/plan", headers=headers).status_code == 404


def test_anonymous_caller_unauthorised(client: FlaskClient):
    assert client.get("/api/learning/learner/plan").status_code == 401


def test_non_learner_role_forbidden(client: FlaskClient):
    headers = _auth_headers("therapist-plan-1", "tp@example.com", name="Therapist")
    assert client.get("/api/auth/session", headers=headers).status_code == 200
    assert client.get("/api/learning/learner/plan", headers=headers).status_code == 403


def test_plan_fallback_for_new_learner(client: FlaskClient):
    headers = _bootstrap_learner(client)
    response = client.get("/api/learning/learner/plan", headers=headers)
    assert response.status_code == 200, response.get_data(as_text=True)
    body = response.get_json()
    assert body["student_id"] == _STUDENT_ID
    assert body["source"] == "fallback"
    assert body["exam"] == "WAEC"
    assert body["class_year"] == "SSS2"
    assert 1 <= len(body["today"]) <= 3
    assert body["weak_topics"] == []


def test_plan_uses_profile_taxonomy(client: FlaskClient):
    headers = _bootstrap_learner(client)
    patch = {
        "display_name": "Ada",
        "exam": "NECO",
        "year_group": "SS3",
        "age_band": "16-17",
        "locale": "en-NG",
    }
    assert client.patch("/api/learners/me/profile", headers=headers, json=patch).status_code == 200

    body = client.get("/api/learning/learner/plan", headers=headers).get_json()
    # Profile year_group SS3 maps to planner class_year SSS3; exam passes through.
    assert body["class_year"] == "SSS3"
    assert body["exam"] in {"NECO", "WAEC"}
