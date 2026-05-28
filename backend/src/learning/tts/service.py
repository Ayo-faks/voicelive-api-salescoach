from __future__ import annotations

from collections import OrderedDict
import hashlib
import os
import threading

from .providers.azure_speech import AzureSpeechProvider
from .providers.base import TtsProvider, TtsProviderUnavailable
from .providers.google_cloud import GoogleCloudTtsProvider


_DEFAULT_PROVIDER_ID = "azure"
_DEFAULT_VOICE = "en-NG-EzinneNeural"
_CACHE_MAX_ENTRIES = 256
_PROVIDER_LOCK = threading.Lock()
_CACHE_LOCK = threading.Lock()
_PROVIDER_SINGLETONS: dict[str, TtsProvider] = {}
_CACHE: OrderedDict[str, bytes] = OrderedDict()


def _provider_id_from_env() -> str:
    return (os.environ.get("LEARNER_TTS_PROVIDER") or _DEFAULT_PROVIDER_ID).strip().lower() or _DEFAULT_PROVIDER_ID


def get_provider() -> TtsProvider:
    provider_id = _provider_id_from_env()
    with _PROVIDER_LOCK:
        existing = _PROVIDER_SINGLETONS.get(provider_id)
        if existing is not None:
            return existing
        if provider_id == "azure":
            provider: TtsProvider = AzureSpeechProvider()
        elif provider_id == "google":
            provider = GoogleCloudTtsProvider()
        else:
            raise TtsProviderUnavailable(f"unknown tts provider {provider_id!r}")
        _PROVIDER_SINGLETONS[provider_id] = provider
        return provider


def resolve_voice(requested: str | None) -> tuple[str, str]:
    voice = (requested or os.environ.get("LEARNER_TTS_VOICE") or _DEFAULT_VOICE).strip() or _DEFAULT_VOICE
    parts = voice.split("-")
    lang = "-".join(parts[:2]) if len(parts) >= 2 else "en-NG"
    return voice, lang


def synthesize_cached(text: str, voice: str, lang: str) -> tuple[bytes, str]:
    provider = get_provider()
    digest = hashlib.sha256(f"{provider.id}{voice}{lang}{text}".encode("utf-8")).hexdigest()
    with _CACHE_LOCK:
        cached = _CACHE.get(digest)
        if cached is not None:
            _CACHE.move_to_end(digest)
            return cached, "hit"
    audio = provider.synthesize(text, voice, lang)
    with _CACHE_LOCK:
        _CACHE[digest] = audio
        _CACHE.move_to_end(digest)
        while len(_CACHE) > _CACHE_MAX_ENTRIES:
            _CACHE.popitem(last=False)
    return audio, "miss"
