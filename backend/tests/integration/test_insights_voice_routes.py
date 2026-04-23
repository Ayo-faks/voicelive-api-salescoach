"""Integration-style coverage for the Insights voice websocket route."""

from __future__ import annotations

import base64
import json
from collections.abc import Iterator
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import ANY, Mock, patch

import pytest
from simple_websocket.errors import ConnectionClosed

import src.app as app_module
import src.services.insights_websocket_handler as handler_module
from src.services.storage import StorageService


def _headers(user_id: str, email: str, *, name: str = "Test User") -> dict[str, str]:
    return {
        "HTTP_X_MS_CLIENT_PRINCIPAL_ID": user_id,
        "HTTP_X_MS_CLIENT_PRINCIPAL_NAME": name,
        "HTTP_X_MS_CLIENT_PRINCIPAL_EMAIL": email,
        "HTTP_X_MS_CLIENT_PRINCIPAL_IDP": "aad",
    }


def _pcm_chunk_base64() -> str:
    raw_pcm = (b"\x00\x00\x10\x00" * 64)
    return base64.b64encode(raw_pcm).decode("ascii")


class FakeWebSocket:
    def __init__(
        self,
        *,
        environ: dict[str, str] | None = None,
        frames: list[str] | None = None,
        close_when_empty: bool = False,
    ) -> None:
        self.environ = environ or {}
        self.frames = list(frames or [])
        self.close_when_empty = close_when_empty
        self.sent: list[str] = []
        self.closed: tuple[object, object] | None = None

    def receive(self, timeout: float | None = None) -> str | None:
        if not self.frames:
            if timeout == 0:
                return None
            if self.close_when_empty:
                raise ConnectionClosed()
            return None
        return self.frames.pop(0)

    def send(self, payload: str) -> None:
        self.sent.append(payload)

    def close(self, reason: object = None, message: object = None) -> None:
        self.closed = (reason, message)


class FakeResponse:
    def __init__(self, *, json_data: dict | None = None, chunks: list[bytes] | None = None) -> None:
        self._json_data = json_data or {}
        self._chunks = chunks or []

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return self._json_data

    def iter_content(self, chunk_size: int = 8192):
        del chunk_size
        yield from self._chunks

    def close(self) -> None:
        return None


class FakeSignal:
    def __init__(self) -> None:
        self._callbacks: list[object] = []

    def connect(self, callback: object) -> None:
        self._callbacks.append(callback)

    def emit(self, event: object) -> None:
        for callback in list(self._callbacks):
            callback(event)


class FakeFuture:
    def get(self) -> None:
        return None


class FakePushStream:
    def __init__(self, *, recognizer: "FakeRecognizer | None" = None) -> None:
        self.recognizer = recognizer
        self.writes: list[bytes] = []
        self.closed = False

    def write(self, chunk: bytes) -> None:
        self.writes.append(chunk)
        if self.recognizer is not None:
            self.recognizer.on_audio_written(chunk)

    def close(self) -> None:
        self.closed = True


class FakeRecognizer:
    def __init__(
        self,
        *,
        partials: list[str] | None = None,
        finals: list[str] | None = None,
        turns: list[tuple[list[str], list[str]]] | None = None,
    ) -> None:
        resolved_turns = turns
        if resolved_turns is None:
            resolved_turns = [(list(partials or []), list(finals or []))]
        self.turns = list(resolved_turns)
        self._buffered_audio = bytearray()
        self.recognizing = FakeSignal()
        self.recognized = FakeSignal()
        self.canceled = FakeSignal()
        self.session_stopped = FakeSignal()

    def start_continuous_recognition_async(self) -> FakeFuture:
        return FakeFuture()

    def stop_continuous_recognition_async(self) -> FakeFuture:
        self.session_stopped.emit(SimpleNamespace())
        return FakeFuture()

    def on_audio_written(self, chunk: bytes) -> None:
        if not chunk:
            return
        if all(byte == 0 for byte in chunk):
            if not self._buffered_audio:
                return
            partials, finals = self.turns.pop(0) if self.turns else ([], [])
            for text in partials:
                self.recognizing.emit(
                    SimpleNamespace(
                        result=SimpleNamespace(
                            reason=handler_module.speechsdk.ResultReason.RecognizingSpeech,
                            text=text,
                        )
                    )
                )
            for text in finals:
                self.recognized.emit(
                    SimpleNamespace(
                        result=SimpleNamespace(
                            reason=handler_module.speechsdk.ResultReason.RecognizedSpeech,
                            text=text,
                        )
                    )
                )
            self._buffered_audio.clear()
            return
        self._buffered_audio.extend(chunk)


def _parse_events(ws: FakeWebSocket) -> list[dict]:
    return [json.loads(payload.strip()) for payload in ws.sent]


@pytest.fixture
def storage(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Iterator[StorageService]:
    storage_service = StorageService(str(tmp_path / "insights-voice.db"))
    monkeypatch.setattr(app_module, "storage_service", storage_service)
    monkeypatch.setattr(app_module, "insights_service", Mock())
    monkeypatch.setenv("LOCAL_DEV_AUTH", "false")
    yield storage_service


def test_insights_voice_ws_closes_4404_when_flag_off(storage: StorageService, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("INSIGHTS_VOICE_MODE", "off")
    ws = FakeWebSocket(environ=_headers("therapist-1", "t1@example.com"))

    app_module.insights_voice_socket(ws)

    assert ws.closed == (4404, None)


def test_insights_voice_ws_closes_4401_when_unauthenticated(
    storage: StorageService, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("INSIGHTS_VOICE_MODE", "push_to_talk")
    ws = FakeWebSocket(environ={})

    app_module.insights_voice_socket(ws)

    assert ws.closed == (4401, "insights_voice_unauthorized")


def test_insights_voice_ws_closes_4403_without_child_access(
    storage: StorageService, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("INSIGHTS_VOICE_MODE", "push_to_talk")
    therapist_a = storage.get_or_create_user("therapist-a", "a@example.com", "A", "aad")
    storage.get_or_create_user("therapist-b", "b@example.com", "B", "aad")
    child = storage.create_child(
        name="Ayo",
        created_by_user_id=therapist_a["id"],
        relationship="therapist",
    )
    ws = FakeWebSocket(
        environ={
            **_headers("therapist-b", "b@example.com"),
            "QUERY_STRING": f"scope_type=child&child_id={child['id']}",
        }
    )

    app_module.insights_voice_socket(ws)

    assert ws.closed == (4403, "insights_voice_forbidden")


def test_insights_voice_ws_closes_4403_for_conversation_hijack(
    storage: StorageService, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("INSIGHTS_VOICE_MODE", "push_to_talk")
    storage.get_or_create_user("therapist-a", "a@example.com", "A", "aad")
    storage.get_or_create_user("therapist-b", "b@example.com", "B", "aad")
    conversation = storage.create_insight_conversation(
        user_id="therapist-a",
        scope_type="caseload",
        prompt_version="insights-v1",
        title="Existing conversation",
    )
    ws = FakeWebSocket(
        environ={
            **_headers("therapist-b", "b@example.com"),
            "QUERY_STRING": f"scope_type=caseload&conversation_id={conversation['id']}",
        }
    )

    app_module.insights_voice_socket(ws)

    assert ws.closed == (4403, "insights_voice_forbidden")


def test_insights_voice_scope_override_attempt_is_ignored(
    storage: StorageService, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("INSIGHTS_VOICE_MODE", "push_to_talk")
    storage.get_or_create_user("therapist-a", "a@example.com", "A", "aad")
    child = storage.create_child(
        name="Ayo",
        created_by_user_id="therapist-a",
        relationship="therapist",
    )
    ask = Mock(
        return_value={
            "conversation": {"id": "conv-1"},
            "assistant_message": {
                "content_text": "Stay with short /t/ phrases.",
                "citations": [],
                "visualizations": [],
            },
        }
    )
    app_module.insights_service = Mock(ask=ask)
    ws = FakeWebSocket(
        environ={
            **_headers("therapist-a", "a@example.com"),
            "QUERY_STRING": f"scope_type=child&child_id={child['id']}",
        },
        frames=[
            json.dumps(
                {
                    "type": "user_audio_chunk",
                    "data": _pcm_chunk_base64(),
                    "scope": {"type": "caseload"},
                    "conversation_id": "hijack-conv",
                }
            ),
            json.dumps(
                {
                    "type": "user_stop",
                    "scope": {"type": "caseload"},
                    "child_id": "other-child",
                }
            ),
        ],
        close_when_empty=True,
    )
    recognizer = FakeRecognizer(partials=["How is she"], finals=["How is she doing?"])
    push_stream = FakePushStream(recognizer=recognizer)

    with patch("src.services.insights_websocket_handler.DefaultAzureCredential"), patch(
        "src.services.insights_websocket_handler.get_bearer_token_provider",
        return_value=lambda: "token-123",
    ), patch.object(
        handler_module.InsightsVoiceHandler,
        "_create_speech_recognizer",
        return_value=(recognizer, push_stream),
    ), patch(
        "src.services.insights_websocket_handler.requests.post",
        return_value=FakeResponse(chunks=[b"pcma"]),
    ) as mock_post:
        app_module.insights_voice_socket(ws)

    ask.assert_called_once_with(
        user_id="therapist-a",
        scope={"type": "child", "child_id": child["id"]},
        message="How is she doing?",
        conversation_id=None,
        request_id=ANY,
    )
    assert mock_post.call_count == 1
    assert push_stream.closed is True
    assert push_stream.writes[0] == base64.b64decode(_pcm_chunk_base64())
    assert all(byte == 0 for byte in push_stream.writes[1])
    assert any(event["type"] == "turn.partial_transcript" for event in _parse_events(ws))
    assert ws.closed == (1000, None)


def test_insights_voice_route_keeps_socket_open_across_two_turns(
    storage: StorageService, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("INSIGHTS_VOICE_MODE", "push_to_talk")
    storage.get_or_create_user("therapist-a", "a@example.com", "A", "aad")
    child = storage.create_child(
        name="Ayo",
        created_by_user_id="therapist-a",
        relationship="therapist",
    )
    ask = Mock(
        side_effect=[
            {
                "conversation": {"id": "conv-1"},
                "assistant_message": {
                    "content_text": "Stay with short /t/ phrases.",
                    "citations": [],
                    "visualizations": [],
                },
            },
            {
                "conversation": {"id": "conv-1"},
                "assistant_message": {
                    "content_text": "Now try a longer sentence.",
                    "citations": [],
                    "visualizations": [],
                },
            },
        ]
    )
    app_module.insights_service = Mock(ask=ask)
    second_chunk = base64.b64encode((b"\x01\x00\x02\x00" * 64)).decode("ascii")
    ws = FakeWebSocket(
        environ={
            **_headers("therapist-a", "a@example.com"),
            "QUERY_STRING": f"scope_type=child&child_id={child['id']}",
        },
        frames=[
            json.dumps({"type": "user_audio_chunk", "data": _pcm_chunk_base64()}),
            json.dumps({"type": "user_stop"}),
            json.dumps({"type": "user_audio_chunk", "data": second_chunk}),
            json.dumps({"type": "user_stop"}),
        ],
        close_when_empty=True,
    )
    recognizer = FakeRecognizer(
        turns=[
            (["How is she"], ["How is she doing?"]),
            (["Try a"], ["Try a longer sentence"]),
        ]
    )
    push_stream = FakePushStream(recognizer=recognizer)

    with patch("src.services.insights_websocket_handler.DefaultAzureCredential"), patch(
        "src.services.insights_websocket_handler.get_bearer_token_provider",
        return_value=lambda: "token-123",
    ), patch.object(
        handler_module.InsightsVoiceHandler,
        "_create_speech_recognizer",
        return_value=(recognizer, push_stream),
    ), patch(
        "src.services.insights_websocket_handler.requests.post",
        side_effect=[FakeResponse(chunks=[b"pcma"]), FakeResponse(chunks=[b"pcmb"])],
    ):
        app_module.insights_voice_socket(ws)

    assert ask.call_count == 2
    events = _parse_events(ws)
    completed_events = [event for event in events if event["type"] == "turn.completed"]
    assert len(completed_events) == 2
    assert [event["answer_text"] for event in completed_events] == [
        "Stay with short /t/ phrases.",
        "Now try a longer sentence.",
    ]
    assert [event["agent_state"] for event in events if event["type"] == "state"] == [
        "listening",
        "thinking",
        "speaking",
        "listening",
        "thinking",
        "speaking",
        "listening",
    ]
    assert push_stream.closed is True
    assert sum(1 for chunk in push_stream.writes if all(byte == 0 for byte in chunk)) == 2
    assert ws.closed == (1000, None)