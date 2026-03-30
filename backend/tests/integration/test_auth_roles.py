"""Integration tests for auth headers and role-enforced Flask routes."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from flask.testing import FlaskClient

import src.app as app_module
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
    """Create a Flask test client backed by an isolated SQLite database."""
    storage_service = StorageService(str(tmp_path / "integration.db"))
    monkeypatch.setattr(app_module, "storage_service", storage_service)
    app_module.app.config["TESTING"] = True

    with app_module.app.test_client() as test_client:
        yield test_client


def test_protected_routes_require_authentication(client: FlaskClient):
    """Anonymous callers should receive 401 on authenticated Flask routes."""
    for route in ["/api/config", "/api/scenarios", "/api/children", "/api/pilot/state"]:
        response = client.get(route)

        assert response.status_code == 401
        assert response.get_json() == {"error": "Authentication required"}


def test_first_user_bootstraps_as_therapist(client: FlaskClient):
    """The first authenticated principal should be auto-promoted to therapist."""
    response = client.get(
        "/api/auth/session",
        headers=_auth_headers("user-1", "first@example.com", name="First User"),
    )

    assert response.status_code == 200
    assert response.get_json() == {
        "authenticated": True,
        "user_id": "user-1",
        "name": "First User",
        "email": "first@example.com",
        "provider": "aad",
        "role": "therapist",
    }


def test_non_therapist_is_forbidden_on_therapist_routes(client: FlaskClient):
    """A non-therapist principal should be blocked from therapist-only endpoints."""
    therapist_headers = _auth_headers("user-1", "first@example.com", name="First User")
    user_headers = _auth_headers("user-2", "second@example.com", name="Second User")

    bootstrap_response = client.get("/api/auth/session", headers=therapist_headers)
    user_session_response = client.get("/api/auth/session", headers=user_headers)
    therapist_route_response = client.get("/api/pilot/state", headers=therapist_headers)
    forbidden_response = client.get("/api/pilot/state", headers=user_headers)

    assert bootstrap_response.status_code == 200
    assert user_session_response.status_code == 200
    assert user_session_response.get_json()["role"] == "user"
    assert therapist_route_response.status_code == 200
    assert forbidden_response.status_code == 403
    assert forbidden_response.get_json() == {"error": "Therapist role required"}


def test_therapist_can_promote_user_and_unlock_therapist_routes(client: FlaskClient):
    """Therapists should be able to promote a user who can then access therapist-only routes."""
    therapist_headers = _auth_headers("user-1", "first@example.com", name="First User")
    user_headers = _auth_headers("user-2", "second@example.com", name="Second User")

    client.get("/api/auth/session", headers=therapist_headers)
    client.get("/api/auth/session", headers=user_headers)

    promote_response = client.post(
        "/api/users/user-2/role",
        headers=therapist_headers,
        json={"role": "therapist"},
    )
    unlocked_response = client.get("/api/children", headers=user_headers)

    assert promote_response.status_code == 200
    assert promote_response.get_json()["role"] == "therapist"
    assert unlocked_response.status_code == 200
    assert isinstance(unlocked_response.get_json(), list)