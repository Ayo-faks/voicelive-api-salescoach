from __future__ import annotations

from flask import Flask
import pytest

from src.learning.api import LearningApi, register_learning_api
from src.learning.tts import service as tts_service
from src.learning.tts.providers.base import TtsProvider, TtsProviderUnavailable
from src.learning.tts.providers.google_cloud import GoogleCloudTtsProvider


class StubTtsProvider(TtsProvider):
    id = "stub"

    def __init__(self, audio: bytes = b"MP3") -> None:
        self.audio = audio
        self.calls = 0

    def synthesize(self, text: str, voice: str, lang: str) -> bytes:
        del text, voice, lang
        self.calls += 1
        return self.audio


class UnavailableTtsProvider(StubTtsProvider):
    def synthesize(self, text: str, voice: str, lang: str) -> bytes:
        del text, voice, lang
        raise TtsProviderUnavailable("offline")


@pytest.fixture(autouse=True)
def clear_tts_state(monkeypatch: pytest.MonkeyPatch):
    tts_service._CACHE.clear()
    tts_service._PROVIDER_SINGLETONS.clear()
    monkeypatch.delenv("LEARNER_TTS_PROVIDER", raising=False)
    monkeypatch.delenv("LEARNER_TTS_VOICE", raising=False)


@pytest.fixture()
def client():
    app = Flask(__name__)
    app.config["TESTING"] = True
    register_learning_api(app, LearningApi())
    return app.test_client()


def test_learning_tts_rejects_empty_text(client) -> None:
    response = client.post("/api/learning/tts", json={"text": "  "})

    assert response.status_code == 400
    assert response.get_json() == {"error": "empty_text"}


def test_learning_tts_rejects_too_long_text(client) -> None:
    response = client.post("/api/learning/tts", json={"text": "x" * 601})

    assert response.status_code == 400
    assert response.get_json() == {"error": "text_too_long"}


def test_learning_tts_returns_503_when_provider_unavailable(client, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(tts_service, "get_provider", lambda: UnavailableTtsProvider())

    response = client.post("/api/learning/tts", json={"text": "Hello"})

    assert response.status_code == 503
    assert response.get_json() == {"error": "tts_unavailable"}


def test_learning_tts_caches_identical_requests(client, monkeypatch: pytest.MonkeyPatch) -> None:
    provider = StubTtsProvider(audio=b"FAKE_MP3")
    monkeypatch.setattr(tts_service, "get_provider", lambda: provider)

    first = client.post("/api/learning/tts", json={"text": "Read this card."})
    second = client.post("/api/learning/tts", json={"text": "Read this card."})

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.data == b"FAKE_MP3"
    assert second.data == b"FAKE_MP3"
    assert first.headers["X-TTS-Cache"] == "miss"
    assert second.headers["X-TTS-Cache"] == "hit"
    assert first.headers["X-TTS-Provider"] == "stub"
    assert second.headers["X-TTS-Provider"] == "stub"
    assert provider.calls == 1


def test_learning_tts_provider_swap_to_google(client, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LEARNER_TTS_PROVIDER", "google")
    monkeypatch.setattr(GoogleCloudTtsProvider, "synthesize", lambda self, text, voice, lang: b"FAKE")

    response = client.post("/api/learning/tts", json={"text": "Hello from the card."})

    assert response.status_code == 200
    assert response.data == b"FAKE"
    assert response.headers["X-TTS-Provider"] == "google"


def test_learning_tts_records_voice_ttfa(monkeypatch: pytest.MonkeyPatch) -> None:
    api = LearningApi()
    app = Flask(__name__)
    app.config["TESTING"] = True
    register_learning_api(app, api)
    monkeypatch.setattr(tts_service, "get_provider", lambda: StubTtsProvider(audio=b"MP3"))
    client = app.test_client()

    ok = client.post("/api/learning/tts", json={"text": "Read this aloud."})
    assert ok.status_code == 200

    monkeypatch.setattr(tts_service, "get_provider", lambda: UnavailableTtsProvider())
    failed = client.post("/api/learning/tts", json={"text": "Now fail."})
    assert failed.status_code == 503

    voice = api.observability.metrics_snapshot()["voice"]
    assert voice["ttfa_counts"]["success"] == 1.0
    assert voice["ttfa_counts"]["error"] == 1.0
    assert voice["ttfa_sample_size"] == 1

