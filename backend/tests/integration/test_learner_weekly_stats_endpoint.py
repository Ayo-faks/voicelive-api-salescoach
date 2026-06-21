"""Integration tests for the learner weekly-stats endpoint.

Covers the RBAC / feature-flag guards on ``GET /api/learning/weekly-stats`` and
the honest cold-start empty state for a freshly bootstrapped learner.
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
    storage_service = StorageService(str(tmp_path / "weekly_stats.db"))
    monkeypatch.setattr(app_module, "storage_service", storage_service)
    monkeypatch.setenv("LOCAL_DEV_AUTH", "false")
    monkeypatch.setenv("PATHFINDER_LEARNER_ONBOARDING_ENABLED", "true")
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
    client: FlaskClient,
    user_id: str = "learner-weekly-1",
    email: str = "weekly@example.com",
) -> dict[str, str]:
    headers = _auth_headers(user_id, email)
    session = client.get("/api/auth/session", headers=headers)
    assert session.status_code == 200
    app_module.storage_service.update_user_role(user_id, "learner")
    return headers


def test_flag_off_returns_404(client: FlaskClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("PATHFINDER_LEARNER_ONBOARDING_ENABLED", "false")
    headers = _bootstrap_learner(client)
    assert (
        client.get("/api/learning/weekly-stats", headers=headers).status_code == 404
    )
    assert (
        client.get("/api/learning/mastery-profile", headers=headers).status_code == 404
    )


def test_anonymous_caller_unauthorised(client: FlaskClient):
    assert client.get("/api/learning/weekly-stats").status_code == 401


def test_non_learner_role_forbidden(client: FlaskClient):
    headers = _auth_headers("therapist-weekly-1", "tw@example.com", name="Therapist")
    assert client.get("/api/auth/session", headers=headers).status_code == 200
    assert (
        client.get("/api/learning/weekly-stats", headers=headers).status_code == 403
    )


def test_cold_start_returns_zeroed_stats(client: FlaskClient):
    headers = _bootstrap_learner(client)
    response = client.get("/api/learning/weekly-stats", headers=headers)
    assert response.status_code == 200, response.get_data(as_text=True)
    body = response.get_json()
    assert body == {
        "sessions": {"completed": 0, "target": 5},
        "streak_days": 0,
        "current_mastery_pct": None,
        "mastery_delta_pct": 0.0,
        "mastery_focus_label": "",
    }


def test_mastery_profile_cold_start_returns_empty_profile(client: FlaskClient):
    headers = _bootstrap_learner(client)
    response = client.get("/api/learning/mastery-profile", headers=headers)
    assert response.status_code == 200, response.get_data(as_text=True)
    assert response.get_json() == {
        "has_data": False,
        "session_count": 0,
        "scored_session_count": 0,
        "skills": [],
        "trajectory": [],
    }


def test_foreign_student_id_forbidden(client: FlaskClient):
    headers = _bootstrap_learner(client)
    response = client.get(
        "/api/learning/weekly-stats?student_id=not-my-child", headers=headers
    )
    assert response.status_code == 403
    response = client.get(
        "/api/learning/mastery-profile?student_id=not-my-child", headers=headers
    )
    assert response.status_code == 403


def _bootstrap_parent(
    client: FlaskClient,
    user_id: str = "parent-weekly-1",
    email: str = "parent-weekly@example.com",
) -> dict[str, str]:
    headers = _auth_headers(user_id, email, name="Parent")
    session = client.get("/api/auth/session", headers=headers)
    assert session.status_code == 200
    app_module.storage_service.update_user_role(user_id, "parent")
    return headers


def test_parent_can_read_owned_child_stats(client: FlaskClient):
    """Family-dashboard stat cards: parents read stats for owned children."""
    headers = _bootstrap_parent(client)
    response = client.get(
        f"/api/learning/weekly-stats?student_id={_STUDENT_ID}", headers=headers
    )
    assert response.status_code == 200, response.get_data(as_text=True)
    body = response.get_json()
    assert body["sessions"]["target"] == 5


def test_parent_foreign_child_forbidden(client: FlaskClient):
    headers = _bootstrap_parent(client)
    response = client.get(
        "/api/learning/weekly-stats?student_id=not-my-child", headers=headers
    )
    assert response.status_code == 403


def test_parent_still_forbidden_on_learner_plan(client: FlaskClient):
    """Widening is weekly-stats only; other learner endpoints stay learner-gated."""
    headers = _bootstrap_parent(client)
    assert client.get("/api/learning/learner/plan", headers=headers).status_code == 403
