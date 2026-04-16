"""Integration tests for therapist progress report endpoints."""

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
    storage_service = StorageService(str(tmp_path / "report-api.db"))
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


def _seed_report_context(child_id: str) -> None:
    app_module.storage_service.save_session(
        {
            "id": "session-api-report-2",
            "child_id": child_id,
            "child_name": "Ayo",
            "timestamp": "2026-03-31T10:00:00+00:00",
            "exercise": {
                "id": "exercise-source-r-listening",
                "name": "R Listening Warmup",
                "description": "Practice /r/ listening contrasts",
                "exerciseMetadata": {"targetSound": "r", "difficulty": "easy", "type": "listening_minimal_pairs"},
            },
            "exercise_metadata": {"targetSound": "r", "difficulty": "easy", "type": "listening_minimal_pairs"},
            "ai_assessment": {"overall_score": 73},
            "pronunciation_assessment": {"accuracy_score": 71, "pronunciation_score": 72},
            "transcript": "Child listened for /r/ contrasts.",
            "reference_text": "red and wed",
        }
    )
    app_module.storage_service.save_session(
        {
            "id": "session-api-report-1",
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


def test_therapist_can_create_update_and_advance_reports(client: FlaskClient):
    headers = _bootstrap_therapist(client)
    child_id = "child-report-scope"
    _create_scoped_child(child_id, "Ayo Scoped")
    _seed_report_context(child_id)

    create_response = client.post(
        f"/api/children/{child_id}/reports",
        headers=headers,
        json={
            "audience": "therapist",
            "title": "Ayo therapist report",
            "period_start": "2026-04-01T00:00:00+00:00",
            "period_end": "2026-04-07T23:59:59+00:00",
            "included_session_ids": ["session-api-report-1"],
        },
    )
    assert create_response.status_code == 201
    created = create_response.get_json()
    assert created["status"] == "draft"
    assert created["audience"] == "therapist"
    assert created["snapshot"]["session_count"] == 1
    assert created["included_session_ids"] == ["session-api-report-1"]

    list_response = client.get(f"/api/children/{child_id}/reports?limit=5", headers=headers)
    assert list_response.status_code == 200
    report_history = list_response.get_json()
    assert report_history[0]["id"] == created["id"]

    update_response = client.post(
        f"/api/reports/{created['id']}/update",
        headers=headers,
        json={
            "audience": "school",
            "title": "Ayo school update",
            "period_start": "2026-03-31T00:00:00+00:00",
            "period_end": "2026-04-07T23:59:59+00:00",
            "included_session_ids": ["session-api-report-2", "session-api-report-1"],
            "redaction_overrides": {
                "hide_summary_text": True,
                "hide_session_list": True,
                "hidden_section_keys": ["school-impact"],
            },
        },
    )
    assert update_response.status_code == 200
    updated = update_response.get_json()
    assert updated["title"] == "Ayo school update"
    assert updated["audience"] == "school"
    assert updated["snapshot"]["session_count"] == 2
    assert any(section["key"] == "classroom-support" for section in updated["sections"])
    assert updated["redaction_overrides"]["hide_session_list"] is True

    export_response = client.get(f"/api/reports/{created['id']}/export?format=html", headers=headers)
    assert export_response.status_code == 200
    assert export_response.mimetype == "text/html"
    export_html = export_response.get_data(as_text=True)
    assert "Ayo school update" in export_html
    assert "Print or save as PDF" in export_html
    assert "R Warmup" in export_html
    assert "Executive summary" not in export_html
    assert "Included sessions" not in export_html
    assert "School participation impact" not in export_html
    assert "Suggested classroom supports" in export_html

    pdf_export_response = client.get(f"/api/reports/{created['id']}/export?format=pdf", headers=headers)
    assert pdf_export_response.status_code == 200
    assert pdf_export_response.mimetype == "application/pdf"
    assert pdf_export_response.get_data().startswith(b"%PDF")

    invalid_export_response = client.get(f"/api/reports/{created['id']}/export?format=docx", headers=headers)
    assert invalid_export_response.status_code == 400
    assert invalid_export_response.get_json() == {"error": "format must be html or pdf"}

    approve_response = client.post(f"/api/reports/{created['id']}/approve", headers=headers)
    assert approve_response.status_code == 200
    approved = approve_response.get_json()
    assert approved["status"] == "approved"

    sign_response = client.post(f"/api/reports/{created['id']}/sign", headers=headers)
    assert sign_response.status_code == 200
    signed = sign_response.get_json()
    assert signed["status"] == "signed"

    detail_response = client.get(f"/api/reports/{created['id']}", headers=headers)
    assert detail_response.status_code == 200
    detail = detail_response.get_json()
    assert detail["signed_by_user_id"] == "therapist-1"


def test_parent_and_unscoped_therapist_cannot_access_report_endpoints(client: FlaskClient):
    _bootstrap_therapist(client)
    child_id = "child-report-private"
    _create_scoped_child(child_id, "Ayo Private")
    _seed_report_context(child_id)

    create_response = client.post(
        f"/api/children/{child_id}/reports",
        headers=_auth_headers("therapist-1", "therapist@example.com", name="First User"),
        json={
            "audience": "therapist",
            "title": "Private therapist report",
            "period_start": "2026-03-31T00:00:00+00:00",
            "period_end": "2026-04-07T23:59:59+00:00",
            "included_session_ids": ["session-api-report-2", "session-api-report-1"],
        },
    )
    assert create_response.status_code == 201
    report_id = create_response.get_json()["id"]

    parent_headers = _auth_headers("parent-2", "parent@example.com", name="Parent User")
    client.get("/api/auth/session", headers=parent_headers)
    app_module.storage_service.update_user_role("parent-2", "parent")
    app_module.storage_service.assign_child_to_user("parent-2", child_id, "parent")

    parent_detail_response = client.get(f"/api/reports/{report_id}", headers=parent_headers)
    assert parent_detail_response.status_code == 403
    assert parent_detail_response.get_json() == {"error": "Therapist role required"}

    parent_export_response = client.get(f"/api/reports/{report_id}/export?format=html", headers=parent_headers)
    assert parent_export_response.status_code == 403
    assert parent_export_response.get_json() == {"error": "Therapist role required"}

    therapist_two_headers = _auth_headers("therapist-2", "other-therapist@example.com", name="Other Therapist")
    client.get("/api/auth/session", headers=therapist_two_headers)

    list_response = client.get(f"/api/children/{child_id}/reports", headers=therapist_two_headers)
    assert list_response.status_code == 403
    assert list_response.get_json() == {"error": "Child access required"}

    detail_response = client.get(f"/api/reports/{report_id}", headers=therapist_two_headers)
    assert detail_response.status_code == 403
    assert detail_response.get_json() == {"error": "Child access required"}

    export_response = client.get(f"/api/reports/{report_id}/export?format=html", headers=therapist_two_headers)
    assert export_response.status_code == 403
    assert export_response.get_json() == {"error": "Child access required"}

    update_response = client.post(
        f"/api/reports/{report_id}/update",
        headers=therapist_two_headers,
        json={"title": "Unauthorized change"},
    )
    assert update_response.status_code == 403
    assert update_response.get_json() == {"error": "Child access required"}
