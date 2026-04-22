"""Small LRU cache for ``/api/tts`` audio responses.

Synthesising a fixed phoneme, anchor word or drill token is deterministic
for a given (voice, language, lexicon-version, payload-shape) tuple, so we
keep a process-local LRU to skip the round-trip to Azure Speech when the
child or therapist asks for the same preview repeatedly.

The cache is intentionally tiny (by default 128 entries / ~8 MiB) and
purely in-memory — it is safe to disable under memory pressure by setting
``TTS_CACHE_MAX_ENTRIES=0`` in the environment.
"""
from __future__ import annotations

import hashlib
import os
import threading
from collections import OrderedDict
from dataclasses import dataclass
from typing import Optional, Tuple

__all__ = ["TTSCache", "get_default_cache", "build_cache_key"]


def _int_env(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


@dataclass(frozen=True)
class CacheEntry:
    audio_b64: str
    mime_format: str


class TTSCache:
    def __init__(self, max_entries: int = 128, max_bytes: int = 8 * 1024 * 1024) -> None:
        self._max_entries = max(0, int(max_entries))
        self._max_bytes = max(0, int(max_bytes))
        self._store: "OrderedDict[str, CacheEntry]" = OrderedDict()
        self._total_bytes = 0
        self._lock = threading.Lock()
        self.hits = 0
        self.misses = 0

    @property
    def enabled(self) -> bool:
        return self._max_entries > 0

    def get(self, key: str) -> Optional[CacheEntry]:
        if not self.enabled:
            return None
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                self.misses += 1
                return None
            self._store.move_to_end(key)
            self.hits += 1
            return entry

    def put(self, key: str, entry: CacheEntry) -> None:
        if not self.enabled:
            return
        with self._lock:
            # Size in bytes ≈ length of base64 payload (ascii, one byte each).
            size = len(entry.audio_b64)
            if self._max_bytes and size > self._max_bytes:
                return  # single-entry too big to cache
            if key in self._store:
                self._total_bytes -= len(self._store[key].audio_b64)
                del self._store[key]
            self._store[key] = entry
            self._total_bytes += size
            while self._store and (
                len(self._store) > self._max_entries
                or (self._max_bytes and self._total_bytes > self._max_bytes)
            ):
                _, evicted = self._store.popitem(last=False)
                self._total_bytes -= len(evicted.audio_b64)

    def stats(self) -> Tuple[int, int, int, int]:
        with self._lock:
            return (
                len(self._store),
                self._total_bytes,
                self.hits,
                self.misses,
            )

    def clear(self) -> None:
        with self._lock:
            self._store.clear()
            self._total_bytes = 0
            self.hits = 0
            self.misses = 0


def build_cache_key(
    *,
    voice: str,
    language: str,
    lexicon_uri: str,
    synthesis_ssml: Optional[str],
    synthesis_text: Optional[str],
    output_format: str,
) -> str:
    hasher = hashlib.sha256()
    for field in (voice, language, lexicon_uri, output_format):
        hasher.update(field.encode("utf-8", "replace"))
        hasher.update(b"\x00")
    hasher.update(b"ssml\x00")
    hasher.update((synthesis_ssml or "").encode("utf-8", "replace"))
    hasher.update(b"\x00text\x00")
    hasher.update((synthesis_text or "").encode("utf-8", "replace"))
    return hasher.hexdigest()


_DEFAULT_CACHE: Optional[TTSCache] = None
_DEFAULT_LOCK = threading.Lock()


def get_default_cache() -> TTSCache:
    global _DEFAULT_CACHE
    if _DEFAULT_CACHE is None:
        with _DEFAULT_LOCK:
            if _DEFAULT_CACHE is None:
                _DEFAULT_CACHE = TTSCache(
                    max_entries=_int_env("TTS_CACHE_MAX_ENTRIES", 128),
                    max_bytes=_int_env("TTS_CACHE_MAX_BYTES", 8 * 1024 * 1024),
                )
    return _DEFAULT_CACHE
