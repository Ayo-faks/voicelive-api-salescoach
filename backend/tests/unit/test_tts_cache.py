"""Tests for the in-memory /api/tts audio cache."""
from __future__ import annotations

from src.services.tts_cache import CacheEntry, TTSCache, build_cache_key


def test_put_and_get_round_trip() -> None:
    cache = TTSCache(max_entries=4, max_bytes=1_000)
    key = build_cache_key(
        voice="en-GB-SoniaNeural",
        language="en-GB",
        lexicon_uri="https://example.test/wulo.pls",
        synthesis_ssml="<speak>hi</speak>",
        synthesis_text=None,
        output_format="mp3",
    )
    cache.put(key, CacheEntry(audio_b64="aaa", mime_format="mp3"))

    result = cache.get(key)
    assert result is not None
    assert result.audio_b64 == "aaa"
    assert cache.hits == 1
    assert cache.misses == 0


def test_cache_key_is_deterministic_and_separates_inputs() -> None:
    k1 = build_cache_key(
        voice="v",
        language="l",
        lexicon_uri="u",
        synthesis_ssml="<s/>",
        synthesis_text=None,
        output_format="o",
    )
    k2 = build_cache_key(
        voice="v",
        language="l",
        lexicon_uri="u",
        synthesis_ssml="<s/>",
        synthesis_text=None,
        output_format="o",
    )
    k3 = build_cache_key(
        voice="v",
        language="l",
        lexicon_uri="u2",
        synthesis_ssml="<s/>",
        synthesis_text=None,
        output_format="o",
    )
    assert k1 == k2
    assert k1 != k3


def test_lru_evicts_oldest_beyond_capacity() -> None:
    cache = TTSCache(max_entries=2, max_bytes=10_000)
    cache.put("a", CacheEntry("1", "mp3"))
    cache.put("b", CacheEntry("2", "mp3"))
    cache.get("a")  # refresh
    cache.put("c", CacheEntry("3", "mp3"))
    assert cache.get("b") is None
    assert cache.get("a") is not None
    assert cache.get("c") is not None


def test_zero_entries_disables_cache() -> None:
    cache = TTSCache(max_entries=0)
    cache.put("k", CacheEntry("1", "mp3"))
    assert cache.get("k") is None
    assert not cache.enabled


def test_oversized_entry_is_not_stored() -> None:
    cache = TTSCache(max_entries=4, max_bytes=2)
    cache.put("k", CacheEntry("too-big", "mp3"))
    assert cache.get("k") is None
