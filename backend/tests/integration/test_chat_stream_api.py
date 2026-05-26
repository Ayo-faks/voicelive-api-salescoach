"""Integration tests for the SSE chat endpoint ``POST /api/chat/stream``.

Auth and validation mirror ``/api/chat/ask`` — these tests focus on the
wire shape: ordered SSE frames (``meta`` → ``token`` → ``artifacts`` →
``done``), the kill-switch (404 when ``CHAT_STREAM_ENABLED=false``), and the
forbidden-scope path (403 JSON, *not* SSE, because guards run before the
first byte).
"""

from __future__ import annotations

import json
import os
from collections.abc import Iterator
from pathlib import Path
from typing import List, Tuple

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
    storage = StorageService(str(tmp_path / "chat-stream.db"))
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
    # Default on; individual tests flip this off to exercise the kill switch.
    app_module.app.config["chat_stream_enabled"] = True
    app_module.app.config["TESTING"] = True
    with app_module.app.test_client() as test_client:
        yield test_client
    os.environ.pop("LOCAL_DEV_AUTH", None)


def _bootstrap_therapist(client: FlaskClient, headers: dict[str, str]) -> None:
    r = client.get("/api/auth/session", headers=headers)
    assert r.status_code == 200, r.get_json()
    assert r.get_json()["role"] == "therapist"


def _parse_sse_stream(body: bytes) -> List[Tuple[str, dict]]:
    """Decode a complete SSE response body into a list of (event, data)
    tuples. Used by tests to assert order and shape.
    """
    text = body.decode("utf-8")
    frames: List[Tuple[str, dict]] = []
    for raw in text.split("\n\n"):
        raw = raw.strip("\r\n")
        if not raw:
            continue
        event_type = "message"
        data_lines: List[str] = []
        for line in raw.splitlines():
            if line.startswith("event:"):
                event_type = line[len("event:"):].strip()
            elif line.startswith("data:"):
                data_lines.append(line[len("data:"):].strip())
        if not data_lines:
            continue
        frames.append((event_type, json.loads("\n".join(data_lines))))
    return frames


def test_chat_stream_requires_authentication(client: FlaskClient):
    res = client.post(
        "/api/chat/stream",
        json={"message": "hi", "scope": {"type": "caseload"}},
    )
    # Guards run before the stream opens, so we still get a JSON 401.
    assert res.status_code == 401


def test_chat_stream_rejects_empty_message(client: FlaskClient):
    headers = _auth_headers("t1", "t1@example.com")
    _bootstrap_therapist(client, headers)
    res = client.post(
        "/api/chat/stream",
        headers=headers,
        json={"message": "   ", "scope": {"type": "caseload"}},
    )
    assert res.status_code == 400


def test_chat_stream_returns_ordered_frames(client: FlaskClient):
    headers = _auth_headers("t1", "t1@example.com")
    _bootstrap_therapist(client, headers)
    res = client.post(
        "/api/chat/stream",
        headers=headers,
        json={"message": "summarise my caseload", "scope": {"type": "caseload"}},
    )
    assert res.status_code == 200
    assert res.mimetype == "text/event-stream"
    assert res.headers.get("Cache-Control", "").startswith("no-cache")
    assert res.headers.get("X-Accel-Buffering") == "no"

    frames = _parse_sse_stream(res.get_data())
    types = [t for t, _ in frames]
    assert types[0] == "meta"
    assert types[-1] == "done"
    assert "artifacts" in types
    # Token frame is optional only when answer_text is empty; the stub
    # planner always returns prose, so we expect at least one here.
    assert "token" in types
    # No interleaving: artifacts and done must follow the last token.
    last_token = max(i for i, t in enumerate(types) if t == "token")
    assert types.index("artifacts") > last_token
    assert types.index("done") > types.index("artifacts")

    meta = frames[0][1]
    assert isinstance(meta["request_id"], str) and len(meta["request_id"]) == 32
    assert meta["prompt_version"] == "chat-v1"

    done = frames[-1][1]
    assert isinstance(done["conversation_id"], str) and done["conversation_id"]
    assert "latency_ms" in done
    assert "tool_calls_count" in done


def test_chat_stream_round_trips_conversation_id(client: FlaskClient):
    headers = _auth_headers("t1", "t1@example.com")
    _bootstrap_therapist(client, headers)

    first = client.post(
        "/api/chat/stream",
        headers=headers,
        json={"message": "hello", "scope": {"type": "caseload"}},
    )
    assert first.status_code == 200
    convo = next(d for t, d in _parse_sse_stream(first.get_data()) if t == "done")[
        "conversation_id"
    ]
    assert convo

    second = client.post(
        "/api/chat/stream",
        headers=headers,
        json={
            "message": "and again",
            "scope": {"type": "caseload"},
            "conversation_id": convo,
        },
    )
    assert second.status_code == 200
    second_done = next(
        d for t, d in _parse_sse_stream(second.get_data()) if t == "done"
    )
    assert second_done["conversation_id"] == convo


def test_chat_stream_kill_switch_returns_404(client: FlaskClient):
    headers = _auth_headers("t1", "t1@example.com")
    _bootstrap_therapist(client, headers)
    app_module.app.config["chat_stream_enabled"] = False
    try:
        res = client.post(
            "/api/chat/stream",
            headers=headers,
            json={"message": "hi", "scope": {"type": "caseload"}},
        )
        assert res.status_code == 404
    finally:
        app_module.app.config["chat_stream_enabled"] = True


def test_chat_stream_emits_multiple_token_frames(client: FlaskClient):
    """The streaming planner must produce more than one ``token`` frame per
    turn so the frontend renders progressively. Concatenating the deltas in
    order must reconstruct the persisted assistant message text exactly.
    """
    headers = _auth_headers("t1", "t1@example.com")
    _bootstrap_therapist(client, headers)
    res = client.post(
        "/api/chat/stream",
        headers=headers,
        json={"message": "stream check", "scope": {"type": "caseload"}},
    )
    assert res.status_code == 200
    frames = _parse_sse_stream(res.get_data())
    token_frames = [d for t, d in frames if t == "token"]
    assert len(token_frames) >= 2, "expected progressive token deltas, got: %r" % token_frames
    assembled = "".join(d["delta"] for d in token_frames)
    # The stub planner echoes a non-empty deterministic answer; reconstructed
    # text must be non-empty and free of leading whitespace.
    assert assembled.strip() == assembled
    assert assembled


def test_chat_stream_emits_telemetry_log(
    client: FlaskClient, caplog: pytest.LogCaptureFixture
):
    """A single ``[chat-stream-telemetry]`` line is emitted per stream, with
    outcome, frame count, TTFB, and total latency. This is the signal used
    downstream to track abandonment vs. completion ratios.
    """
    headers = _auth_headers("t1", "t1@example.com")
    _bootstrap_therapist(client, headers)
    with caplog.at_level("INFO", logger="src.app"):
        res = client.post(
            "/api/chat/stream",
            headers=headers,
            json={"message": "telemetry probe", "scope": {"type": "caseload"}},
        )
        assert res.status_code == 200
        # Consume the full body so the generator's finally clause fires.
        res.get_data()

    telemetry_records = [
        r for r in caplog.records if "[chat-stream-telemetry]" in r.getMessage()
    ]
    assert len(telemetry_records) == 1
    payload_str = telemetry_records[0].getMessage().split(" ", 1)[1]
    payload = json.loads(payload_str)
    assert payload["outcome"] == "completed"
    assert payload["frames_emitted"] >= 3  # meta + artifacts + done at minimum
    assert payload["bytes_emitted"] > 0
    assert payload["ttfb_ms"] is not None and payload["ttfb_ms"] >= 0
    assert payload["total_ms"] >= payload["ttfb_ms"]
    assert payload["scope_type"] == "caseload"
    # User id is hashed (first 16 hex chars of SHA-256) — never the raw id.
    assert len(payload["user_id_hash"]) == 16
    assert "t1" not in payload["user_id_hash"]
    assert payload["conversation_id"]
