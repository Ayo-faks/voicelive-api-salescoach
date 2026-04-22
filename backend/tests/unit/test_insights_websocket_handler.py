"""Unit tests for the Insights voice websocket handler."""

from __future__ import annotations

import base64
import json
from types import SimpleNamespace
from unittest.mock import Mock, patch

import src.services.insights_websocket_handler as handler_module
from src.services.insights_websocket_handler import InsightsVoiceHandler


class FakeWebSocket:
    def __init__(self, frames: list[str]) -> None:
        self.frames = list(frames)
        self.sent: list[str] = []
        self.closed: tuple[object, object] | None = None

    def receive(self, timeout: float | None = None) -> str | None:
        del timeout
        if not self.frames:
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
    def __init__(self) -> None:
        self.writes: list[bytes] = []
        self.closed = False

    def write(self, chunk: bytes) -> None:
        self.writes.append(chunk)

    def close(self) -> None:
        self.closed = True


class FakeRecognizer:
    def __init__(self, *, partials: list[str], finals: list[str]) -> None:
        self.partials = partials
        self.finals = finals
        self.started = False
        self.stopped = False
        self.recognizing = FakeSignal()
        self.recognized = FakeSignal()
        self.canceled = FakeSignal()
        self.session_stopped = FakeSignal()

    def start_continuous_recognition_async(self) -> FakeFuture:
        self.started = True
        return FakeFuture()

    def stop_continuous_recognition_async(self) -> FakeFuture:
        self.stopped = True
        for text in self.partials:
            self.recognizing.emit(
                SimpleNamespace(
                    result=SimpleNamespace(
                        reason=handler_module.speechsdk.ResultReason.RecognizingSpeech,
                        text=text,
                    ),
                )
            )
        for text in self.finals:
            self.recognized.emit(
                SimpleNamespace(
                    result=SimpleNamespace(
                        reason=handler_module.speechsdk.ResultReason.RecognizedSpeech,
                        text=text,
                    ),
                )
            )
        self.session_stopped.emit(SimpleNamespace())
        return FakeFuture()


def _parse_events(ws: FakeWebSocket) -> list[dict]:
    return [json.loads(payload.strip()) for payload in ws.sent]


def _pcm_chunk_base64() -> str:
    raw_pcm = (b"\x00\x00\x10\x00" * 64)
    return base64.b64encode(raw_pcm).decode("ascii")


def test_handler_transcribes_audio_and_calls_ask_with_pinned_scope() -> None:
    chunk_b64 = _pcm_chunk_base64()
    raw_pcm = base64.b64decode(chunk_b64)
    ws = FakeWebSocket(
        [
            json.dumps({"type": "noop", "scope": {"type": "caseload"}}),
            json.dumps(
                {
                    "type": "user_audio_chunk",
                    "data": chunk_b64,
                    "scope": {"type": "caseload"},
                    "conversation_id": "conv-override",
                }
            ),
            json.dumps({"type": "user_stop", "scope": {"type": "caseload"}}),
        ]
    )
    ask = Mock(
        return_value={
            "conversation": {"id": "conv-pinned"},
            "assistant_message": {
                "content_text": "Focus on short /t/ phrases.",
                "citations": [{"kind": "session", "label": "Last session"}],
                "visualizations": [],
            },
        }
    )
    insights_service = Mock(ask=ask)
    recognizer = FakeRecognizer(partials=["How is she"], finals=["How is she doing?"])
    push_stream = FakePushStream()

    with patch("src.services.insights_websocket_handler.DefaultAzureCredential"), patch(
        "src.services.insights_websocket_handler.get_bearer_token_provider",
        return_value=lambda: "token-123",
    ), patch.object(
        InsightsVoiceHandler,
        "_create_speech_recognizer",
        return_value=(recognizer, push_stream),
    ), patch(
        "src.services.insights_websocket_handler.requests.post",
        return_value=FakeResponse(chunks=[b"pcm-a", b"pcm-b"]),
    ) as mock_post:
        handler = InsightsVoiceHandler(
            ws,
            insights_service=insights_service,
            storage=Mock(),
            user={"id": "therapist-1", "role": "therapist"},
            scope={"type": "child", "child_id": "child-1"},
            conversation_id="conv-pinned",
        )
        handler.run()

    ask.assert_called_once_with(
        user_id="therapist-1",
        scope={"type": "child", "child_id": "child-1"},
        message="How is she doing?",
        conversation_id="conv-pinned",
    )
    assert mock_post.call_count == 1
    assert recognizer.started is True
    assert recognizer.stopped is True
    assert push_stream.writes == [raw_pcm]
    assert push_stream.closed is True

    events = _parse_events(ws)
    assert [event["type"] for event in events] == [
        "turn.started",
        "turn.partial_transcript",
        "turn.final_transcript",
        "turn.audio_chunk",
        "turn.audio_chunk",
        "turn.completed",
    ]
    assert events[1]["text"] == "How is she"
    assert events[2]["text"] == "How is she doing?"
    assert events[-1]["conversation_id"] == "conv-pinned"
    assert events[-1]["answer_text"] == "Focus on short /t/ phrases."
    assert base64.b64decode(events[3]["data_b64"]) == b"pcm-a"
    assert ws.closed is None


def test_stream_tts_audio_interrupts_mid_playback() -> None:
    ws = FakeWebSocket([json.dumps({"type": "turn.interrupt"})])

    with patch("src.services.insights_websocket_handler.DefaultAzureCredential"), patch(
        "src.services.insights_websocket_handler.get_bearer_token_provider",
        return_value=lambda: "token-123",
    ), patch(
        "src.services.insights_websocket_handler.requests.post",
        return_value=FakeResponse(chunks=[b"pcm-a", b"pcm-b"]),
    ):
        handler = InsightsVoiceHandler(
            ws,
            insights_service=Mock(),
            storage=Mock(),
            user={"id": "therapist-1", "role": "therapist"},
            scope={"type": "child", "child_id": "child-1"},
            conversation_id="conv-pinned",
        )

        handler._stream_tts_audio("Focus on short /t/ phrases.")

    events = _parse_events(ws)
    assert [event["type"] for event in events] == [
        "turn.audio_chunk",
        "turn.interrupted",
    ]
    assert base64.b64decode(events[0]["data_b64"]) == b"pcm-a"


def test_handler_prefers_configured_speech_key_for_auth() -> None:
    ws = FakeWebSocket([])

    with patch("src.services.insights_websocket_handler.DefaultAzureCredential"), patch(
        "src.services.insights_websocket_handler.get_bearer_token_provider",
        return_value=lambda: "token-123",
    ), patch("src.services.insights_websocket_handler.speechsdk.SpeechConfig") as mock_speech_config:
        handler = InsightsVoiceHandler(
            ws,
            insights_service=Mock(),
            storage=Mock(),
            user={"id": "therapist-1", "role": "therapist"},
            scope={"type": "child", "child_id": "child-1"},
            conversation_id="conv-pinned",
        )
        handler.speech_key = "speech-key-123"

        headers = handler._auth_headers()
        handler._create_speech_config()

    assert headers == {"Ocp-Apim-Subscription-Key": "speech-key-123"}
    mock_speech_config.assert_called_once_with(
        subscription="speech-key-123",
        region=handler.region,
        speech_recognition_language=handler.language,
    )