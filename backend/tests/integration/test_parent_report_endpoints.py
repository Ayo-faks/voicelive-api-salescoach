"""Integration tests for the parent-facing progress report endpoints (P3).

Parents may read only *finalised* (approved/signed) ``audience="parent"`` reports
for children they own. Drafts and therapist-audience reports are never exposed.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from flask.testing import FlaskClient

import src.app as app_module
from src.services.report_service import ProgressReportService
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
    storage_service = StorageService(str(tmp_path / "parent-report-api.db"))
    report_service = ProgressReportService(storage_service)

    monkeypatch.setattr(app_module, "storage_service", storage_service)
    monkeypatch.setattr(app_module, "report_service", report_service)
    app_module.app.config["TESTING"] = True

    with app_module.app.test_client() as test_client:
        yield test_client


def _bootstrap_therapist(client: FlaskClient) -> dict[str, str]:
    headers = _auth_headers("therapist-1", "therapist@example.com", name="First User")
    response = client.get("/api/auth/session", headers=headers)
    assert response.status_code == 200
    return headers


def _create_scoped_child(child_id: str, name: str) -> None:
    app_module.storage_service.create_child(
        name=name,
        created_by_user_id="therapist-1",
        relationship="therapist",
        child_id=child_id,
    )
    app_module.storage_service.save_parental_consent(
        child_id=child_id,
        guardian_name="Guardian",
        guardian_email="guardian@example.com",
        privacy_accepted=True,
        terms_accepted=True,
        ai_notice_accepted=True,
        personal_data_consent_accepted=True,
        special_category_consent_accepted=True,
        parental_responsibility_confirmed=True,
        recorded_by_user_id="therapist-1",
    )


def _seed_sessions(child_id: str) -> None:
    app_module.storage_service.save_session(
        {
            "id": f"{child_id}-session-1",
            "child_id": child_id,
            "child_name": "Ayo",
            "timestamp": "2026-04-06T10:00:00+00:00",
            "exercise": {
                "id": "exercise-source-r",
                "name": "R Warmup",
                "description": "Practice /r/ words",
                "exerciseMetadata": {"targetSound": "r", "difficulty": "medium", "type": "two_word_phrase"},
            },
            "exercise_metadata": {"targetSound": "r", "difficulty": "medium", "type": "two_word_phrase"},
            "ai_assessment": {"overall_score": 80},
            "pronunciation_assessment": {"accuracy_score": 79, "pronunciation_score": 80},
            "transcript": "Child practised /r/ phrases.",
            "reference_text": "red rabbit",
        }
    )


def _link_parent(child_id: str, *, user_id: str = "parent-2", email: str = "parent@example.com") -> dict[str, str]:
    headers = _auth_headers(user_id, email, name="Parent User")
    return headers


def _add_parent_workspace_member(child_id: str, user_id: str) -> None:
    """Reproduce the production parent-link state: a parent is both a
    ``user_children`` parent row *and* a member of the child's workspace
    (exactly what the family-intake approval inserts)."""
    child = app_module.storage_service.get_child(child_id)
    assert child is not None
    workspace_id = child.get("workspace_id")
    if not workspace_id:
        return

    def _write(connection) -> None:
        connection.execute(
            """
            INSERT INTO workspace_members (workspace_id, user_id, role, created_at, updated_at)
            VALUES (?, ?, 'parent', ?, ?)
            ON CONFLICT(workspace_id, user_id) DO NOTHING
            """,
            (workspace_id, user_id, "2026-01-01T00:00:00+00:00", "2026-01-01T00:00:00+00:00"),
        )

    app_module.storage_service._execute_write(_write)


def _register_parent(client: FlaskClient, child_id: str, *, user_id: str = "parent-2", email: str = "parent@example.com") -> dict[str, str]:
    headers = _link_parent(child_id, user_id=user_id, email=email)
    client.get("/api/auth/session", headers=headers)
    app_module.storage_service.update_user_role(user_id, "parent")
    app_module.storage_service.assign_child_to_user(user_id, child_id, "parent")
    _add_parent_workspace_member(child_id, user_id)
    return headers


def _create_parent_report(client: FlaskClient, therapist_headers: dict[str, str], child_id: str) -> str:
    create = client.post(
        f"/api/children/{child_id}/reports",
        headers=therapist_headers,
        json={
            "audience": "parent",
            "title": "Family update",
            "period_start": "2026-04-01T00:00:00+00:00",
            "period_end": "2026-04-07T23:59:59+00:00",
            "included_session_ids": [f"{child_id}-session-1"],
        },
    )
    assert create.status_code == 201, create.get_json()
    return create.get_json()["id"]


def _approve(client: FlaskClient, therapist_headers: dict[str, str], report_id: str) -> None:
    resp = client.post(f"/api/reports/{report_id}/approve", headers=therapist_headers)
    assert resp.status_code == 200, resp.get_json()
    assert resp.get_json()["status"] == "approved"


def test_parent_can_list_and_read_finalised_parent_report(client: FlaskClient):
    therapist_headers = _bootstrap_therapist(client)
    child_id = "child-parent-visible"
    _create_scoped_child(child_id, "Ayo Visible")
    _seed_sessions(child_id)
    report_id = _create_parent_report(client, therapist_headers, child_id)
    _approve(client, therapist_headers, report_id)

    parent_headers = _register_parent(client, child_id)

    list_resp = client.get(f"/api/parent/children/{child_id}/reports", headers=parent_headers)
    assert list_resp.status_code == 200
    reports = list_resp.get_json()
    assert [r["id"] for r in reports] == [report_id]
    assert reports[0]["audience"] == "parent"
    assert reports[0]["status"] == "approved"

    detail_resp = client.get(f"/api/parent/reports/{report_id}", headers=parent_headers)
    assert detail_resp.status_code == 200
    assert detail_resp.get_json()["id"] == report_id


def test_parent_cannot_see_draft_parent_report(client: FlaskClient):
    therapist_headers = _bootstrap_therapist(client)
    child_id = "child-parent-draft"
    _create_scoped_child(child_id, "Ayo Draft")
    _seed_sessions(child_id)
    report_id = _create_parent_report(client, therapist_headers, child_id)
    # NOT approved — remains a draft.

    parent_headers = _register_parent(client, child_id)

    list_resp = client.get(f"/api/parent/children/{child_id}/reports", headers=parent_headers)
    assert list_resp.status_code == 200
    assert list_resp.get_json() == []

    detail_resp = client.get(f"/api/parent/reports/{report_id}", headers=parent_headers)
    assert detail_resp.status_code == 404


def test_parent_cannot_see_therapist_audience_report(client: FlaskClient):
    therapist_headers = _bootstrap_therapist(client)
    child_id = "child-parent-therapist-aud"
    _create_scoped_child(child_id, "Ayo Clinical")
    _seed_sessions(child_id)

    create = client.post(
        f"/api/children/{child_id}/reports",
        headers=therapist_headers,
        json={
            "audience": "therapist",
            "title": "Clinical report",
            "period_start": "2026-04-01T00:00:00+00:00",
            "period_end": "2026-04-07T23:59:59+00:00",
            "included_session_ids": [f"{child_id}-session-1"],
        },
    )
    assert create.status_code == 201
    report_id = create.get_json()["id"]
    _approve(client, therapist_headers, report_id)

    parent_headers = _register_parent(client, child_id)

    list_resp = client.get(f"/api/parent/children/{child_id}/reports", headers=parent_headers)
    assert list_resp.status_code == 200
    assert list_resp.get_json() == []

    detail_resp = client.get(f"/api/parent/reports/{report_id}", headers=parent_headers)
    assert detail_resp.status_code == 404


def test_parent_cannot_access_unowned_childs_reports(client: FlaskClient):
    therapist_headers = _bootstrap_therapist(client)
    child_id = "child-parent-unowned"
    _create_scoped_child(child_id, "Ayo Unowned")
    _seed_sessions(child_id)
    report_id = _create_parent_report(client, therapist_headers, child_id)
    _approve(client, therapist_headers, report_id)

    # A parent who owns a *different* child.
    other_child = "child-other"
    _create_scoped_child(other_child, "Other Kid")
    stranger_headers = _register_parent(client, other_child, user_id="parent-9", email="stranger@example.com")

    list_resp = client.get(f"/api/parent/children/{child_id}/reports", headers=stranger_headers)
    assert list_resp.status_code == 403

    detail_resp = client.get(f"/api/parent/reports/{report_id}", headers=stranger_headers)
    assert detail_resp.status_code == 403


def test_therapist_role_cannot_use_parent_route(client: FlaskClient):
    therapist_headers = _bootstrap_therapist(client)
    child_id = "child-parent-role-gate"
    _create_scoped_child(child_id, "Ayo RoleGate")
    _seed_sessions(child_id)
    report_id = _create_parent_report(client, therapist_headers, child_id)
    _approve(client, therapist_headers, report_id)

    # The owning therapist hits the parent route — wrong role/relationship.
    list_resp = client.get(f"/api/parent/children/{child_id}/reports", headers=therapist_headers)
    assert list_resp.status_code == 403

    detail_resp = client.get(f"/api/parent/reports/{report_id}", headers=therapist_headers)
    assert detail_resp.status_code == 403


def test_parent_route_blocks_when_consent_withdrawn(client: FlaskClient):
    """P7: the parent route is consent-gated (fail-closed) like the therapist route.

    A withdrawn parental consent must close the parent's read access even to an
    already-approved report.
    """
    therapist_headers = _bootstrap_therapist(client)
    child_id = "child-parent-consent"
    _create_scoped_child(child_id, "Ayo Consent")
    _seed_sessions(child_id)
    report_id = _create_parent_report(client, therapist_headers, child_id)
    _approve(client, therapist_headers, report_id)
    parent_headers = _register_parent(client, child_id)

    # With consent in place the parent can read.
    assert client.get(f"/api/parent/children/{child_id}/reports", headers=parent_headers).status_code == 200

    # Withdraw consent → both parent routes fail closed with missing_consent.
    app_module.storage_service.withdraw_parental_consent(child_id)

    list_resp = client.get(f"/api/parent/children/{child_id}/reports", headers=parent_headers)
    assert list_resp.status_code == 403
    assert list_resp.get_json()["error"] == "missing_consent"

    detail_resp = client.get(f"/api/parent/reports/{report_id}", headers=parent_headers)
    assert detail_resp.status_code == 403
    assert detail_resp.get_json()["error"] == "missing_consent"

