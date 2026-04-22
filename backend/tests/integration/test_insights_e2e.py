"""End-to-end smoke tests for the therapist Insights Agent.

These tests wire real `StorageService` + `InsightsService` (with the stub
planner) through the full Flask app and cover the therapist journey:

1. Therapist signs in via SWA principal headers.
2. Creates a child via `POST /api/children` (therapist relationship).
3. Asks an insights question with `scope={type:'child', child_id}`.
4. Lists conversations — the new one appears.
5. Fetches the conversation detail — user + assistant messages persisted
   with `prompt_version='insights-v1'`.
6. Cross-scope authorization: a second therapist cannot read the first
   therapist's conversation.

The stub planner is used (no external LLM required) but the fixture
swaps in a real `StorageService`, real `ChildMemoryService`, and real
`InsightsService` so the integration surface is exercised end-to-end.
"""

from __future__ import annotations

from collections.abc import Iterator
import os
from pathlib import Path

import pytest
from flask.testing import FlaskClient

import src.app as app_module
from src.services.child_memory_service import ChildMemoryService
from src.services.insights_service import InsightsService
from src.services.storage import StorageService


def _auth_headers(user_id: str, email: str, name: str = "Test User") -> dict[str, str]:
    return {
        "X-MS-CLIENT-PRINCIPAL-ID": user_id,
        "X-MS-CLIENT-PRINCIPAL-NAME": name,
        "X-MS-CLIENT-PRINCIPAL-EMAIL": email,
        "X-MS-CLIENT-PRINCIPAL-IDP": "aad",
    }


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[FlaskClient]:
    storage = StorageService(str(tmp_path / "insights-e2e.db"))
    child_memory = ChildMemoryService(storage)
    monkeypatch.setattr(app_module, "storage_service", storage)
    monkeypatch.setattr(app_module, "child_memory_service", child_memory)
    monkeypatch.setattr(
        app_module,
        "insights_service",
        InsightsService(
            storage,
            child_memory_service=child_memory,
            institutional_memory_service=None,
        ),
    )
    monkeypatch.setenv("LOCAL_DEV_AUTH", "false")
    app_module.app.config["TESTING"] = True
    with app_module.app.test_client() as test_client:
        yield test_client
    os.environ.pop("LOCAL_DEV_AUTH", None)


def _bootstrap_therapist(client: FlaskClient, headers: dict[str, str]) -> str:
    res = client.get("/api/auth/session", headers=headers)
    assert res.status_code == 200, res.get_json()
    body = res.get_json()
    assert body["role"] == "therapist"
    return body["user_id"]


def _create_child(client: FlaskClient, headers: dict[str, str], name: str) -> str:
    res = client.post("/api/children", headers=headers, json={"name": name})
    assert res.status_code == 201, res.get_json()
    return res.get_json()["id"]


# --- Tests ----------------------------------------------------------------


def test_full_insights_flow_for_child_scope(client: FlaskClient):
    headers = _auth_headers("therapist-e2e-1", "therapist1@example.com", name="Therapist One")
    therapist_id = _bootstrap_therapist(client, headers)
    child_id = _create_child(client, headers, "Ayo E2E")

    # Ask a child-scoped question.
    ask_res = client.post(
        "/api/insights/ask",
        headers=headers,
        json={
            "message": "How is Ayo progressing this month?",
            "scope": {"type": "child", "child_id": child_id},
        },
    )
    assert ask_res.status_code == 200, ask_res.get_json()
    ask_body = ask_res.get_json()
    assert ask_body["conversation"]["scope_type"] == "child"
    assert ask_body["conversation"]["scope_child_id"] == child_id
    assert ask_body["assistant_message"]["prompt_version"] == "insights-v1"
    # Stub planner should have called get_child_overview.
    assert ask_body["tool_calls_count"] >= 1
    conversation_id = ask_body["conversation"]["id"]

    # List conversations — the new one should appear.
    list_res = client.get("/api/insights/conversations", headers=headers)
    assert list_res.status_code == 200
    conversations = list_res.get_json()["conversations"]
    assert any(c["id"] == conversation_id for c in conversations)

    # Fetch the conversation detail — both turns persisted.
    detail_res = client.get(
        f"/api/insights/conversations/{conversation_id}",
        headers=headers,
    )
    assert detail_res.status_code == 200
    detail = detail_res.get_json()
    assert detail["conversation"]["id"] == conversation_id
    roles = [m["role"] for m in detail["messages"]]
    assert roles == ["user", "assistant"]
    assistant_msg = detail["messages"][1]
    assert assistant_msg["prompt_version"] == "insights-v1"
    # The stub planner records a trace entry for the overview call.
    assert isinstance(assistant_msg.get("tool_trace"), list)
    del therapist_id  # bound for clarity; not used further


def test_follow_up_turn_reuses_conversation(client: FlaskClient):
    headers = _auth_headers("therapist-e2e-2", "therapist2@example.com")
    _bootstrap_therapist(client, headers)
    child_id = _create_child(client, headers, "Mia E2E")

    first = client.post(
        "/api/insights/ask",
        headers=headers,
        json={
            "message": "Summary please.",
            "scope": {"type": "child", "child_id": child_id},
        },
    )
    assert first.status_code == 200
    conversation_id = first.get_json()["conversation"]["id"]

    second = client.post(
        "/api/insights/ask",
        headers=headers,
        json={
            "message": "What about last week?",
            "scope": {"type": "child", "child_id": child_id},
            "conversation_id": conversation_id,
        },
    )
    assert second.status_code == 200
    assert second.get_json()["conversation"]["id"] == conversation_id

    detail = client.get(
        f"/api/insights/conversations/{conversation_id}",
        headers=headers,
    )
    assert detail.status_code == 200
    roles = [m["role"] for m in detail.get_json()["messages"]]
    assert roles == ["user", "assistant", "user", "assistant"]


def test_child_scope_denied_when_therapist_has_no_access(client: FlaskClient):
    owner_headers = _auth_headers("therapist-e2e-3", "therapist3@example.com")
    _bootstrap_therapist(client, owner_headers)
    child_id = _create_child(client, owner_headers, "Ren E2E")

    intruder_headers = _auth_headers("therapist-e2e-4", "therapist4@example.com")
    _bootstrap_therapist(client, intruder_headers)

    res = client.post(
        "/api/insights/ask",
        headers=intruder_headers,
        json={
            "message": "Give me insights on this child.",
            "scope": {"type": "child", "child_id": child_id},
        },
    )
    assert res.status_code in (403, 404), res.get_json()


def test_other_therapist_cannot_read_conversation(client: FlaskClient):
    owner_headers = _auth_headers("therapist-e2e-5", "therapist5@example.com")
    _bootstrap_therapist(client, owner_headers)
    child_id = _create_child(client, owner_headers, "Kai E2E")

    ask = client.post(
        "/api/insights/ask",
        headers=owner_headers,
        json={
            "message": "Private question.",
            "scope": {"type": "child", "child_id": child_id},
        },
    )
    assert ask.status_code == 200
    conversation_id = ask.get_json()["conversation"]["id"]

    intruder_headers = _auth_headers("therapist-e2e-6", "therapist6@example.com")
    _bootstrap_therapist(client, intruder_headers)

    res = client.get(
        f"/api/insights/conversations/{conversation_id}",
        headers=intruder_headers,
    )
    # Ownership-gated storage returns None → route responds 404 or 403.
    assert res.status_code in (403, 404)
