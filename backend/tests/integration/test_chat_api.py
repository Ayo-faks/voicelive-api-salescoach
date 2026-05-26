"""Integration tests for the text-mode chat endpoint ``POST /api/chat/ask``.

The endpoint is a thin flat-envelope wrapper around the same
``InsightsService.ask`` call used by the voice-mode routes, so the bulk of
behaviour is tested in ``test_insights_routes.py``. These tests cover the
wrapper concerns: auth, shape of the flat envelope, error mapping, and
conversation_id round-trip.
"""

from __future__ import annotations

from collections.abc import Iterator
import os
from pathlib import Path
from typing import Any, Dict

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
    storage = StorageService(str(tmp_path / "chat.db"))
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


# --- /api/chat/ask -------------------------------------------------------


def test_chat_ask_requires_authentication(client: FlaskClient):
    res = client.post(
        "/api/chat/ask",
        json={"message": "hello", "scope": {"type": "caseload"}},
    )
    assert res.status_code == 401


def test_chat_ask_rejects_empty_message(client: FlaskClient):
    headers = _auth_headers("t1", "t1@example.com")
    _bootstrap_therapist(client, headers)
    res = client.post("/api/chat/ask", headers=headers, json={"message": "   "})
    assert res.status_code == 400
    assert "message" in (res.get_json() or {}).get("error", "")


def test_chat_ask_rejects_non_object_scope(client: FlaskClient):
    headers = _auth_headers("t1", "t1@example.com")
    _bootstrap_therapist(client, headers)
    res = client.post(
        "/api/chat/ask",
        headers=headers,
        json={"message": "hi", "scope": "caseload"},
    )
    assert res.status_code == 400


def test_chat_ask_rejects_unsupported_scope(client: FlaskClient):
    headers = _auth_headers("t1", "t1@example.com")
    _bootstrap_therapist(client, headers)
    res = client.post(
        "/api/chat/ask",
        headers=headers,
        json={"message": "hi", "scope": {"type": "bogus"}},
    )
    assert res.status_code == 400


def test_chat_ask_returns_flat_envelope(client: FlaskClient):
    headers = _auth_headers("t1", "t1@example.com")
    _bootstrap_therapist(client, headers)
    res = client.post(
        "/api/chat/ask",
        headers=headers,
        json={"message": "How is my caseload trending?", "scope": {"type": "caseload"}},
    )
    assert res.status_code == 200, res.get_json()
    body: Dict[str, Any] = res.get_json()
    # Flat shape — no nested ``conversation`` / ``assistant_message`` wrappers.
    expected_keys = {
        "conversation_id",
        "request_id",
        "answer_text",
        "citations",
        "visualizations",
        "ui_specs",
        "action_suggestions",
        "route",
        "cached",
        "latency_ms",
        "tool_calls_count",
        "error_text",
    }
    assert expected_keys.issubset(body.keys())
    assert isinstance(body["conversation_id"], str) and body["conversation_id"]
    assert isinstance(body["request_id"], str) and len(body["request_id"]) == 32
    assert isinstance(body["citations"], list)
    assert isinstance(body["visualizations"], list)
    assert isinstance(body["ui_specs"], list)
    assert isinstance(body["action_suggestions"], list)
    assert body["route"] in {"insights", "chitchat", "cached"}


def test_chat_ask_round_trips_conversation_id(client: FlaskClient):
    headers = _auth_headers("t1", "t1@example.com")
    _bootstrap_therapist(client, headers)
    first = client.post(
        "/api/chat/ask",
        headers=headers,
        json={"message": "hi", "scope": {"type": "caseload"}},
    )
    assert first.status_code == 200
    convo = first.get_json()["conversation_id"]
    assert convo

    second = client.post(
        "/api/chat/ask",
        headers=headers,
        json={
            "message": "and again",
            "scope": {"type": "caseload"},
            "conversation_id": convo,
        },
    )
    assert second.status_code == 200
    assert second.get_json()["conversation_id"] == convo


def test_chat_ask_maps_authorization_error_to_403(
    client: FlaskClient, monkeypatch: pytest.MonkeyPatch
):
    headers = _auth_headers("t1", "t1@example.com")
    _bootstrap_therapist(client, headers)

    from src.services.insights_service import InsightsAuthorizationError

    def _boom(**_kw):
        raise InsightsAuthorizationError("not allowed")

    monkeypatch.setattr(app_module.insights_service, "ask", _boom)
    res = client.post(
        "/api/chat/ask",
        headers=headers,
        json={"message": "hi", "scope": {"type": "caseload"}},
    )
    assert res.status_code == 403


def test_chat_ask_maps_planner_exception_to_500(
    client: FlaskClient, monkeypatch: pytest.MonkeyPatch
):
    headers = _auth_headers("t1", "t1@example.com")
    _bootstrap_therapist(client, headers)

    def _boom(**_kw):
        raise RuntimeError("planner exploded")

    monkeypatch.setattr(app_module.insights_service, "ask", _boom)
    res = client.post(
        "/api/chat/ask",
        headers=headers,
        json={"message": "hi", "scope": {"type": "caseload"}},
    )
    assert res.status_code == 500
    body = res.get_json()
    assert body["error"] == "planner_failed"
    assert body["error_text"] == "planner exploded"
    assert isinstance(body.get("request_id"), str) and body["request_id"]
