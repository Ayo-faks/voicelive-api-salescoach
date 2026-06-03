"""Integration tests for Pathfinder learner profile + consent audit endpoints."""

from __future__ import annotations

from collections.abc import Iterator
import os
from pathlib import Path

import pytest
from flask.testing import FlaskClient

import src.app as app_module
from src.learning.repository import InMemoryLearningRepository
from src.services.storage import StorageService


def _auth_headers(user_id: str, email: str, name: str = "Learner") -> dict[str, str]:
    return {
        "X-MS-CLIENT-PRINCIPAL-ID": user_id,
        "X-MS-CLIENT-PRINCIPAL-NAME": name,
        "X-MS-CLIENT-PRINCIPAL-EMAIL": email,
        "X-MS-CLIENT-PRINCIPAL-IDP": "aad",
    }


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[FlaskClient]:
    storage_service = StorageService(str(tmp_path / "learner_profile.db"))
    monkeypatch.setattr(app_module, "storage_service", storage_service)
    monkeypatch.setenv("LOCAL_DEV_AUTH", "false")
    monkeypatch.setenv("PATHFINDER_LEARNER_ONBOARDING_ENABLED", "true")
    if isinstance(app_module.learning_repository, InMemoryLearningRepository):
        app_module.learning_repository.teacher_classes.clear()
    app_module.app.config["TESTING"] = True

    with app_module.app.test_client() as test_client:
        yield test_client

    os.environ.pop("LOCAL_DEV_AUTH", None)
    os.environ.pop("PATHFINDER_LEARNER_ONBOARDING_ENABLED", None)


def _bootstrap_learner(client: FlaskClient, user_id: str = "learner-1", email: str = "learner@example.com") -> dict[str, str]:
    headers = _auth_headers(user_id, email)
    session = client.get("/api/auth/session", headers=headers)
    assert session.status_code == 200
    app_module.storage_service.update_user_role(user_id, "learner")
    return headers


# ---------------------------------------------------------------------------
# Flag gating + auth/role guards
# ---------------------------------------------------------------------------


def test_flag_off_returns_404(client: FlaskClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("PATHFINDER_LEARNER_ONBOARDING_ENABLED", "false")
    headers = _bootstrap_learner(client)
    assert client.get("/api/learners/me/profile", headers=headers).status_code == 404
    assert client.patch("/api/learners/me/profile", headers=headers, json={}).status_code == 404
    assert client.post("/api/learners/me/consent", headers=headers, json={}).status_code == 404


def test_anonymous_caller_unauthorised(client: FlaskClient):
    assert client.get("/api/learners/me/profile").status_code == 401
    assert client.patch("/api/learners/me/profile", json={}).status_code == 401
    assert client.post("/api/learners/me/consent", json={}).status_code == 401


def test_non_learner_role_forbidden(client: FlaskClient):
    # Bootstrap user without promoting to learner -> default role therapist.
    headers = _auth_headers("therapist-1", "t@example.com", name="Therapist")
    assert client.get("/api/auth/session", headers=headers).status_code == 200
    assert client.get("/api/learners/me/profile", headers=headers).status_code == 403


# ---------------------------------------------------------------------------
# GET happy path + needs_onboarding lifecycle
# ---------------------------------------------------------------------------


def test_get_profile_initial_state(client: FlaskClient):
    headers = _bootstrap_learner(client)
    response = client.get("/api/learners/me/profile", headers=headers)
    assert response.status_code == 200
    body = response.get_json()
    assert body["profile"] == {}
    assert body["consents"] == {}
    assert body["needs_onboarding"] is True


def test_needs_onboarding_flips_after_required_fields_and_consents(client: FlaskClient):
    headers = _bootstrap_learner(client)
    patch = {
        "display_name": "Ada",
        "exam": "WAEC",
        "year_group": "SS2",
        "age_band": "16-17",
        "locale": "en-NG",
    }
    assert client.patch("/api/learners/me/profile", headers=headers, json=patch).status_code == 200
    # Still needs consents.
    body = client.get("/api/learners/me/profile", headers=headers).get_json()
    assert body["needs_onboarding"] is True

    for kind in ("terms", "privacy"):
        resp = client.post(
            "/api/learners/me/consent",
            headers=headers,
            json={"kind": kind, "version": "v1", "granted": True},
        )
        assert resp.status_code == 200

    body = client.get("/api/learners/me/profile", headers=headers).get_json()
    assert body["needs_onboarding"] is False
    assert set(body["consents"].keys()) == {"terms", "privacy"}


# ---------------------------------------------------------------------------
# PATCH validation
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "patch",
    [
        {"exam": "SAT"},                              # not in ALLOWED_EXAMS
        {"locale": "english"},                         # not BCP-47
        {"subjects": ["s%d" % i for i in range(7)]},   # > MAX_SUBJECTS
        {"guardian_email": "not-an-email"},
        {"age_band": "twenty"},
        {"display_name": "x" * 200},                   # > MAX_DISPLAY_NAME_LEN
    ],
)
def test_patch_rejects_invalid_payloads(client: FlaskClient, patch: dict):
    headers = _bootstrap_learner(client)
    response = client.patch("/api/learners/me/profile", headers=headers, json=patch)
    assert response.status_code == 400
    assert "error" in response.get_json()


def test_patch_persists_cleaned_subjects(client: FlaskClient):
    headers = _bootstrap_learner(client)
    response = client.patch(
        "/api/learners/me/profile",
        headers=headers,
        json={"subjects": ["Maths", " Physics ", "English"]},
    )
    assert response.status_code == 200
    profile = response.get_json()["profile"]
    assert profile["subjects"] == ["Maths", "Physics", "English"]


# ---------------------------------------------------------------------------
# Consent endpoint
# ---------------------------------------------------------------------------


def test_consent_rejects_unknown_kind(client: FlaskClient):
    headers = _bootstrap_learner(client)
    response = client.post(
        "/api/learners/me/consent",
        headers=headers,
        json={"kind": "marketing", "version": "v1", "granted": True},
    )
    assert response.status_code == 400


def test_consent_requires_version_and_boolean(client: FlaskClient):
    headers = _bootstrap_learner(client)
    no_version = client.post(
        "/api/learners/me/consent",
        headers=headers,
        json={"kind": "terms", "granted": True},
    )
    assert no_version.status_code == 400

    bad_granted = client.post(
        "/api/learners/me/consent",
        headers=headers,
        json={"kind": "terms", "version": "v1", "granted": "yes"},
    )
    assert bad_granted.status_code == 400


def test_consent_audit_rows_accumulate(client: FlaskClient):
    headers = _bootstrap_learner(client)
    user_id = "learner-1"
    for version in ("v1", "v2", "v3"):
        client.post(
            "/api/learners/me/consent",
            headers=headers,
            json={"kind": "terms", "version": version, "granted": True},
        )
    latest = app_module.storage_service.latest_consents(user_id)
    assert latest["terms"]["version"] == "v3"


def test_consent_mirrors_career_and_analytics_to_profile(client: FlaskClient):
    headers = _bootstrap_learner(client)
    client.post(
        "/api/learners/me/consent",
        headers=headers,
        json={"kind": "career", "version": "v1", "granted": True},
    )
    client.post(
        "/api/learners/me/consent",
        headers=headers,
        json={"kind": "analytics", "version": "v1", "granted": False},
    )
    body = client.get("/api/learners/me/profile", headers=headers).get_json()
    assert body["profile"]["career_consent"] is True
    assert body["profile"]["analytics_consent"] is False

    # Revoke career -> mirrored false.
    client.post(
        "/api/learners/me/consent",
        headers=headers,
        json={"kind": "career", "version": "v2", "granted": False},
    )
    body = client.get("/api/learners/me/profile", headers=headers).get_json()
    assert body["profile"]["career_consent"] is False


# ---------------------------------------------------------------------------
# Age-tiered guardian email gate
# ---------------------------------------------------------------------------

_REQUIRED_PROFILE_BASE = {
    "display_name": "Ada",
    "exam": "WAEC",
    "year_group": "SS2",
    "locale": "en-NG",
}


def _grant_required_consents(client: FlaskClient, headers: dict[str, str]) -> None:
    for kind in ("terms", "privacy"):
        client.post(
            "/api/learners/me/consent",
            headers=headers,
            json={"kind": kind, "version": "v1", "granted": True},
        )


def test_under_13_needs_onboarding_without_guardian_email(client: FlaskClient):
    """under-13 profile without guardian_email keeps needs_onboarding=True."""
    headers = _bootstrap_learner(client)
    patch = {**_REQUIRED_PROFILE_BASE, "age_band": "under-13"}
    assert client.patch("/api/learners/me/profile", headers=headers, json=patch).status_code == 200
    _grant_required_consents(client, headers)

    body = client.get("/api/learners/me/profile", headers=headers).get_json()
    # All required fields present and consents granted, but guardian_email missing.
    assert body["needs_onboarding"] is True


def test_under_13_onboarding_complete_with_guardian_email(client: FlaskClient):
    """under-13 profile with guardian_email flips needs_onboarding=False."""
    headers = _bootstrap_learner(client)
    patch = {**_REQUIRED_PROFILE_BASE, "age_band": "under-13", "guardian_email": "parent@example.com"}
    assert client.patch("/api/learners/me/profile", headers=headers, json=patch).status_code == 200
    _grant_required_consents(client, headers)

    body = client.get("/api/learners/me/profile", headers=headers).get_json()
    assert body["needs_onboarding"] is False


def test_minor_non_under_13_does_not_require_guardian_email(client: FlaskClient):
    """13-15 and 16-17 profiles do not require guardian_email to finish onboarding."""
    for band in ("13-15", "16-17"):
        headers = _bootstrap_learner(client, user_id=f"learner-{band}", email=f"learner-{band}@example.com")
        patch = {**_REQUIRED_PROFILE_BASE, "age_band": band}
        assert client.patch("/api/learners/me/profile", headers=headers, json=patch).status_code == 200
        _grant_required_consents(client, headers)

        body = client.get("/api/learners/me/profile", headers=headers).get_json()
        assert body["needs_onboarding"] is False, f"Expected onboarding complete for age_band={band}"


def test_adult_age_bands_do_not_require_guardian_email(client: FlaskClient):
    """18-24 and 25-plus profiles do not require guardian_email to finish onboarding."""
    for band in ("18-24", "25-plus"):
        headers = _bootstrap_learner(client, user_id=f"learner-adult-{band}", email=f"adult-{band}@example.com")
        patch = {**_REQUIRED_PROFILE_BASE, "age_band": band}
        assert client.patch("/api/learners/me/profile", headers=headers, json=patch).status_code == 200
        _grant_required_consents(client, headers)

        body = client.get("/api/learners/me/profile", headers=headers).get_json()
        assert body["needs_onboarding"] is False, f"Expected onboarding complete for age_band={band}"
