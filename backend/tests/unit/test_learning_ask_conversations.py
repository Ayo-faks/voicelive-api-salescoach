"""Coverage for durable Ask Wulo thread history.

These tests wire a real SQLite ``StorageService`` into ``LearningApi`` and drive
the conversation lifecycle end-to-end: a turn mints a thread, the thread is
listable and resumable, history is learner-scoped, and deletes are honoured.
"""

from __future__ import annotations

import os
import tempfile
from typing import Any, Dict, Iterator

import pytest
from flask import Flask

from src.config import reload_config
from src.learning.api import LearningApi, LearningApiError, register_learning_api
from src.services.storage import StorageService


@pytest.fixture()
def store() -> Iterator[StorageService]:
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    try:
        yield StorageService(path)
    finally:
        os.unlink(path)


@pytest.fixture()
def api(store: StorageService, monkeypatch: pytest.MonkeyPatch) -> Iterator[LearningApi]:
    monkeypatch.setenv("PATHFINDER_ASSISTANT_LLM_ENABLED", "false")
    reload_config()
    instance = LearningApi()
    # The history layer reads ``repository.storage`` and feature-detects the
    # learner-ask methods; attach the real store so persistence runs.
    instance.repository.storage = store  # type: ignore[attr-defined]
    try:
        yield instance
    finally:
        reload_config()


@pytest.fixture()
def client(api: LearningApi) -> Any:
    app = Flask(__name__)
    app.config["TESTING"] = True
    register_learning_api(app, api)
    return app.test_client()


def _ask(client: Any, body: Dict[str, Any]):
    return client.post("/api/learning/assistant/turn", json=body)


def test_turn_persists_and_round_trips_conversation_id(client: Any) -> None:
    first = _ask(
        client, {"user_id": "learner-1", "question": "What should I study next?"}
    )
    assert first.status_code == 200
    conversation_id = first.get_json()["conversation_id"]
    assert conversation_id

    # A follow-up that carries the id extends the same thread.
    second = _ask(
        client,
        {
            "user_id": "learner-1",
            "question": "And after that?",
            "conversation_id": conversation_id,
        },
    )
    assert second.get_json()["conversation_id"] == conversation_id

    listing = client.get(
        "/api/learning/assistant/conversations", query_string={"user_id": "learner-1"}
    )
    conversations = listing.get_json()["conversations"]
    assert len(conversations) == 1
    assert conversations[0]["id"] == conversation_id
    # Title is seeded from the opening question.
    assert "study next" in conversations[0]["title"].lower()


def test_get_conversation_returns_messages_in_order(client: Any) -> None:
    created = _ask(
        client, {"user_id": "learner-1", "question": "Explain fractions"}
    ).get_json()
    conversation_id = created["conversation_id"]

    detail = client.get(
        f"/api/learning/assistant/conversations/{conversation_id}",
        query_string={"user_id": "learner-1"},
    )
    assert detail.status_code == 200
    payload = detail.get_json()
    roles = [m["role"] for m in payload["messages"]]
    assert roles == ["user", "assistant"]
    assert payload["messages"][0]["text"] == "Explain fractions"
    assert payload["messages"][1]["blocks"]


def test_history_is_learner_scoped(client: Any) -> None:
    owned = _ask(
        client, {"user_id": "learner-1", "question": "My private question"}
    ).get_json()["conversation_id"]

    # A different learner cannot read or delete it.
    forbidden = client.get(
        f"/api/learning/assistant/conversations/{owned}",
        query_string={"user_id": "learner-2"},
    )
    assert forbidden.status_code == 404

    other_list = client.get(
        "/api/learning/assistant/conversations", query_string={"user_id": "learner-2"}
    )
    assert other_list.get_json()["conversations"] == []


def test_delete_conversation_removes_it_from_history(client: Any) -> None:
    conversation_id = _ask(
        client, {"user_id": "learner-1", "question": "Throwaway"}
    ).get_json()["conversation_id"]

    deleted = client.delete(
        f"/api/learning/assistant/conversations/{conversation_id}",
        query_string={"user_id": "learner-1"},
    )
    assert deleted.status_code == 200
    assert deleted.get_json()["deleted"] is True

    listing = client.get(
        "/api/learning/assistant/conversations", query_string={"user_id": "learner-1"}
    )
    assert listing.get_json()["conversations"] == []


def test_get_ask_conversation_raises_404_for_unknown_thread(api: LearningApi) -> None:
    with pytest.raises(LearningApiError) as excinfo:
        api.get_ask_conversation("ask-conv-missing", {"user_id": "learner-1"})
    assert excinfo.value.status_code == 404
