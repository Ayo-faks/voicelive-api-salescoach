"""Integration tests for Phase 4 Insights routes and the config flag."""

from __future__ import annotations

from collections.abc import Iterator
import os
from pathlib import Path

import pytest
from flask.testing import FlaskClient

import src.app as app_module
from src.services.storage import StorageService
from src.services.insights_service import InsightsService


def _auth_headers(user_id: str, email: str, name: str = "Test User") -> dict[str, str]:
    return {
        "X-MS-CLIENT-PRINCIPAL-ID": user_id,
        "X-MS-CLIENT-PRINCIPAL-NAME": name,
        "X-MS-CLIENT-PRINCIPAL-EMAIL": email,
        "X-MS-CLIENT-PRINCIPAL-IDP": "aad",
    }


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[FlaskClient]:
    storage = StorageService(str(tmp_path / "insights.db"))
    monkeypatch.setattr(app_module, "storage_service", storage)
    monkeypatch.setattr(
        app_module,
        "insights_service",
        InsightsService(
            storage,
            child_memory_service=None,
            institutional_memory_service=None,
        ),
    )
    monkeypatch.setenv("LOCAL_DEV_AUTH", "false")
    app_module.app.config["TESTING"] = True
    with app_module.app.test_client() as test_client:
        yield test_client
    os.environ.pop("LOCAL_DEV_AUTH", None)


def _bootstrap_therapist(client: FlaskClient, headers: dict[str, str]) -> dict:
    r = client.get("/api/auth/session", headers=headers)
    assert r.status_code == 200, r.get_json()
    body = r.get_json()
    assert body["role"] == "therapist"
    return body


# --- /api/config insights_rail_enabled flag ------------------------------


def test_config_flag_on_by_default_for_therapist(client: FlaskClient):
    headers = _auth_headers("t1", "t1@example.com")
    _bootstrap_therapist(client, headers)
    res = client.get("/api/config", headers=headers)
    assert res.status_code == 200
    body = res.get_json()
    assert body.get("insights_rail_enabled") is True
    assert {
        "status",
        "proxy_enabled",
        "ws_endpoint",
        "storage_ready",
        "telemetry_enabled",
        "image_base_path",
        "planner",
        "insights_rail_enabled",
    }.issubset(body.keys())


def test_config_flag_can_be_disabled_via_env(
    client: FlaskClient, monkeypatch: pytest.MonkeyPatch
):
    headers = _auth_headers("t1", "t1@example.com")
    _bootstrap_therapist(client, headers)
    monkeypatch.setenv("INSIGHTS_RAIL_ENABLED", "0")
    res = client.get("/api/config", headers=headers)
    assert res.status_code == 200
    assert res.get_json().get("insights_rail_enabled") is False


# --- /api/insights/ask ---------------------------------------------------


def test_ask_requires_authentication(client: FlaskClient):
    res = client.post(
        "/api/insights/ask",
        json={"message": "hello", "scope": {"type": "caseload"}},
    )
    assert res.status_code == 401


def test_therapist_can_ask_caseload_scope(client: FlaskClient):
    headers = _auth_headers("t1", "t1@example.com")
    _bootstrap_therapist(client, headers)
    res = client.post(
        "/api/insights/ask",
        headers=headers,
        json={"message": "How is my caseload trending?", "scope": {"type": "caseload"}},
    )
    assert res.status_code == 200, res.get_json()
    body = res.get_json()
    assert "conversation" in body
    assert "assistant_message" in body
    assert body["assistant_message"]["prompt_version"] == "insights-v1"


def test_ask_rejects_unsupported_scope(client: FlaskClient):
    headers = _auth_headers("t1", "t1@example.com")
    _bootstrap_therapist(client, headers)
    res = client.post(
        "/api/insights/ask",
        headers=headers,
        json={"message": "hi", "scope": {"type": "bogus"}},
    )
    assert res.status_code == 400
