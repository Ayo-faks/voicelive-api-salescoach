"""Integration tests for auth headers and role-enforced Flask routes."""

from __future__ import annotations

from collections.abc import Iterator
import os
from pathlib import Path
from types import SimpleNamespace

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
    monkeypatch.setenv("LOCAL_DEV_AUTH", "false")
    app_module.app.config["TESTING"] = True

    with app_module.app.test_client() as test_client:
        yield test_client

    os.environ.pop("LOCAL_DEV_AUTH", None)


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
    assert user_session_response.get_json()["role"] == "parent"
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


def test_parent_can_create_child_and_only_sees_owned_children(client: FlaskClient):
    therapist_headers = _auth_headers("user-1", "first@example.com", name="First User")
    parent_headers = _auth_headers("user-2", "second@example.com", name="Second User")

    client.get("/api/auth/session", headers=therapist_headers)
    client.get("/api/auth/session", headers=parent_headers)

    create_response = client.post(
        "/api/children",
        headers=parent_headers,
        json={"name": "Mila", "notes": "Parent-managed child"},
    )
    parent_children_response = client.get("/api/children", headers=parent_headers)
    therapist_children_response = client.get("/api/children", headers=therapist_headers)

    assert create_response.status_code == 201
    created_child = create_response.get_json()
    assert created_child["name"] == "Mila"
    assert create_response.get_json()["notes"] == "Parent-managed child"

    parent_children = parent_children_response.get_json()
    therapist_children = therapist_children_response.get_json()

    assert parent_children_response.status_code == 200
    assert [child["name"] for child in parent_children] == ["Mila"]
    assert therapist_children_response.status_code == 200
    assert all(child["id"] != created_child["id"] for child in therapist_children)


def test_unlinked_user_cannot_access_other_family_child_routes(client: FlaskClient):
    therapist_headers = _auth_headers("user-1", "first@example.com", name="First User")
    parent_headers = _auth_headers("user-2", "second@example.com", name="Second User")

    client.get("/api/auth/session", headers=therapist_headers)
    client.get("/api/auth/session", headers=parent_headers)

    create_response = client.post(
        "/api/children",
        headers=parent_headers,
        json={"name": "Mila"},
    )
    child_id = create_response.get_json()["id"]

    forbidden_response = client.get(f"/api/children/{child_id}/sessions", headers=therapist_headers)

    assert forbidden_response.status_code == 403
    assert forbidden_response.get_json() == {"error": "Child access required"}


def test_therapist_can_invite_parent_and_parent_can_accept(client: FlaskClient):
    therapist_headers = _auth_headers("user-1", "first@example.com", name="First User")
    parent_headers = _auth_headers("user-2", "second@example.com", name="Second User")

    client.get("/api/auth/session", headers=therapist_headers)
    client.get("/api/auth/session", headers=parent_headers)

    child_response = client.post(
        "/api/children",
        headers=therapist_headers,
        json={"name": "Luca"},
    )
    child_id = child_response.get_json()["id"]

    invite_response = client.post(
        "/api/invitations",
        headers=therapist_headers,
        json={"child_id": child_id, "invited_email": "second@example.com", "relationship": "parent"},
    )

    assert invite_response.status_code == 201
    invitation_id = invite_response.get_json()["id"]

    accept_response = client.post(
        f"/api/invitations/{invitation_id}/accept",
        headers=parent_headers,
    )
    parent_children_response = client.get("/api/children", headers=parent_headers)

    assert accept_response.status_code == 200
    assert accept_response.get_json()["status"] == "accepted"
    assert [child["name"] for child in parent_children_response.get_json()] == ["Luca"]


def test_invitation_create_attempts_email_delivery(client: FlaskClient, monkeypatch: pytest.MonkeyPatch):
    therapist_headers = _auth_headers("user-1", "first@example.com", name="First User")
    delivery_calls: list[dict[str, str | None]] = []

    class FakeEmailService:
        def send_invitation_email(self, **kwargs):
            delivery_calls.append(kwargs)
            return SimpleNamespace(
                status="sent",
                attempted=True,
                delivered=True,
                provider_message_id="acs-message-1",
                error=None,
            )

    monkeypatch.setattr(app_module, "email_service", FakeEmailService())

    client.get("/api/auth/session", headers=therapist_headers)

    child_response = client.post(
        "/api/children",
        headers=therapist_headers,
        json={"name": "Luca"},
    )
    child_id = child_response.get_json()["id"]

    invite_response = client.post(
        "/api/invitations",
        headers=therapist_headers,
        json={"child_id": child_id, "invited_email": "second@example.com", "relationship": "parent"},
    )

    assert invite_response.status_code == 201
    assert len(delivery_calls) == 1
    assert delivery_calls[0]["recipient_email"] == "second@example.com"
    assert invite_response.get_json()["email_delivery"] == {
        "status": "sent",
        "attempted": True,
        "delivered": True,
        "provider_message_id": "acs-message-1",
    }

    invitation_list_response = client.get("/api/invitations", headers=therapist_headers)

    assert invitation_list_response.status_code == 200
    assert invitation_list_response.get_json()[0]["email_delivery"] == {
        "status": "sent",
        "attempted": True,
        "delivered": True,
        "provider_message_id": "acs-message-1",
        "error": None,
    }


def test_invitation_email_failure_does_not_block_resend(client: FlaskClient, monkeypatch: pytest.MonkeyPatch):
    therapist_headers = _auth_headers("user-1", "first@example.com", name="First User")

    class FailingEmailService:
        def send_invitation_email(self, **kwargs):
            return SimpleNamespace(
                status="failed",
                attempted=True,
                delivered=False,
                provider_message_id=None,
                error="ACS unavailable",
            )

    monkeypatch.setattr(app_module, "email_service", FailingEmailService())

    client.get("/api/auth/session", headers=therapist_headers)

    child_response = client.post(
        "/api/children",
        headers=therapist_headers,
        json={"name": "Luca"},
    )
    child_id = child_response.get_json()["id"]

    invite_response = client.post(
        "/api/invitations",
        headers=therapist_headers,
        json={"child_id": child_id, "invited_email": "second@example.com", "relationship": "parent"},
    )
    invitation_id = invite_response.get_json()["id"]

    resend_response = client.post(
        f"/api/invitations/{invitation_id}/resend",
        headers=therapist_headers,
    )

    assert invite_response.status_code == 201
    assert invite_response.get_json()["email_delivery"] == {
        "status": "failed",
        "attempted": True,
        "delivered": False,
        "error": "ACS unavailable",
    }
    assert resend_response.status_code == 200
    assert resend_response.get_json()["status"] == "pending"
    assert resend_response.get_json()["email_delivery"] == {
        "status": "failed",
        "attempted": True,
        "delivered": False,
        "error": "ACS unavailable",
    }

    invitation_list_response = client.get("/api/invitations", headers=therapist_headers)

    assert invitation_list_response.status_code == 200
    assert invitation_list_response.get_json()[0]["email_delivery"] == {
        "status": "failed",
        "attempted": True,
        "delivered": False,
        "provider_message_id": None,
        "error": "ACS unavailable",
    }


def test_duplicate_pending_invitation_reuses_existing_invite(client: FlaskClient, monkeypatch: pytest.MonkeyPatch):
    therapist_headers = _auth_headers("user-1", "first@example.com", name="First User")
    delivery_calls: list[dict[str, str | None]] = []

    class FakeEmailService:
        def send_invitation_email(self, **kwargs):
            delivery_calls.append(kwargs)
            return SimpleNamespace(
                status="sent",
                attempted=True,
                delivered=True,
                provider_message_id=f"acs-message-{len(delivery_calls)}",
                error=None,
            )

    monkeypatch.setattr(app_module, "email_service", FakeEmailService())

    client.get("/api/auth/session", headers=therapist_headers)

    child_response = client.post(
        "/api/children",
        headers=therapist_headers,
        json={"name": "Luca"},
    )
    child_id = child_response.get_json()["id"]

    first_invite_response = client.post(
        "/api/invitations",
        headers=therapist_headers,
        json={"child_id": child_id, "invited_email": "second@example.com", "relationship": "parent"},
    )
    second_invite_response = client.post(
        "/api/invitations",
        headers=therapist_headers,
        json={"child_id": child_id, "invited_email": "second@example.com", "relationship": "parent"},
    )

    assert first_invite_response.status_code == 201
    assert second_invite_response.status_code == 201
    assert first_invite_response.get_json()["id"] == second_invite_response.get_json()["id"]
    assert len(delivery_calls) == 2

    invitation_list_response = client.get("/api/invitations", headers=therapist_headers)

    assert invitation_list_response.status_code == 200
    assert len(invitation_list_response.get_json()) == 1
    assert invitation_list_response.get_json()[0]["email_delivery"] == {
        "status": "sent",
        "attempted": True,
        "delivered": True,
        "provider_message_id": "acs-message-2",
        "error": None,
    }


def test_parent_cannot_accept_invitation_for_different_email(client: FlaskClient):
    therapist_headers = _auth_headers("user-1", "first@example.com", name="First User")
    invited_parent_headers = _auth_headers("user-2", "second@example.com", name="Second User")
    wrong_parent_headers = _auth_headers("user-3", "third@example.com", name="Third User")

    client.get("/api/auth/session", headers=therapist_headers)
    client.get("/api/auth/session", headers=invited_parent_headers)
    client.get("/api/auth/session", headers=wrong_parent_headers)

    child_response = client.post(
        "/api/children",
        headers=therapist_headers,
        json={"name": "Luca"},
    )
    child_id = child_response.get_json()["id"]

    invite_response = client.post(
        "/api/invitations",
        headers=therapist_headers,
        json={"child_id": child_id, "invited_email": "second@example.com", "relationship": "parent"},
    )
    invitation_id = invite_response.get_json()["id"]

    wrong_accept_response = client.post(
        f"/api/invitations/{invitation_id}/accept",
        headers=wrong_parent_headers,
    )

    assert wrong_accept_response.status_code == 400
    assert wrong_accept_response.get_json() == {
        "error": "Invitation email does not match the authenticated user"
    }


def test_expired_invitation_cannot_be_accepted_until_resent(client: FlaskClient):
    therapist_headers = _auth_headers("user-1", "first@example.com", name="First User")
    parent_headers = _auth_headers("user-2", "second@example.com", name="Second User")

    client.get("/api/auth/session", headers=therapist_headers)
    client.get("/api/auth/session", headers=parent_headers)

    child_response = client.post(
        "/api/children",
        headers=therapist_headers,
        json={"name": "Luca"},
    )
    child_id = child_response.get_json()["id"]

    invite_response = client.post(
        "/api/invitations",
        headers=therapist_headers,
        json={"child_id": child_id, "invited_email": "second@example.com", "relationship": "parent"},
    )
    invitation_id = invite_response.get_json()["id"]

    app_module.storage_service._execute_write(  # type: ignore[attr-defined]
        lambda connection: connection.execute(
            "UPDATE child_invitations SET expires_at = ?, status = 'pending' WHERE id = ?",
            ("2000-01-01T00:00:00+00:00", invitation_id),
        )
    )

    expired_accept_response = client.post(
        f"/api/invitations/{invitation_id}/accept",
        headers=parent_headers,
    )
    resend_response = client.post(
        f"/api/invitations/{invitation_id}/resend",
        headers=therapist_headers,
    )
    accepted_after_resend_response = client.post(
        f"/api/invitations/{invitation_id}/accept",
        headers=parent_headers,
    )

    assert expired_accept_response.status_code == 400
    assert expired_accept_response.get_json() == {"error": "Invitation has expired"}
    assert resend_response.status_code == 200
    assert resend_response.get_json()["status"] == "pending"
    assert resend_response.get_json()["expires_at"] is not None
    assert accepted_after_resend_response.status_code == 200
    assert accepted_after_resend_response.get_json()["status"] == "accepted"