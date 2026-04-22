"""Parity test: the canonical JSON phoneme map must stay in lock-step with
the backend :mod:`tts_normalizer` tables and the frontend ``SOUND_TO_IPA``.

If this test fails, edit only ``data/lexicons/phoneme-map.json`` and then
either (a) copy the values by hand into the downstream files or (b) run
``python scripts/codegen_phoneme_map.py`` to regenerate them.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from src.services.phoneme_map_loader import (
    PHONEME_MAP_PATH,
    get_anchor_words,
    get_deprecated_aliases,
    get_ipa_map,
    get_primary_targets,
)
from src.services.tts_normalizer import ANCHOR_WORDS, PHONEME_MAP


def test_backend_phoneme_map_matches_json() -> None:
    assert PHONEME_MAP == get_ipa_map()


def test_backend_anchor_words_cover_primary_targets() -> None:
    anchors = get_anchor_words()
    for primary in get_primary_targets():
        assert primary in anchors, f"primary target {primary!r} missing anchor"
        assert primary in ANCHOR_WORDS


def test_json_declares_deprecated_th_alias() -> None:
    assert get_deprecated_aliases().get("TH") == "dh"


def test_frontend_sound_to_ipa_mirrors_json() -> None:
    repo_root = PHONEME_MAP_PATH.parents[2]
    ts_file = repo_root / "frontend" / "src" / "utils" / "phonemeSsml.ts"
    if not ts_file.is_file():
        pytest.skip("frontend/phonemeSsml.ts not present in this checkout")

    source = ts_file.read_text(encoding="utf-8")
    # Extract the SOUND_TO_IPA block and parse its string-to-string pairs.
    match = re.search(
        r"SOUND_TO_IPA[^{]*\{([^}]+)\}",
        source,
        re.DOTALL,
    )
    assert match is not None, "SOUND_TO_IPA block not found"

    body = match.group(1)
    ts_pairs: dict[str, str] = {}
    for raw in re.finditer(r"([A-Za-z]+)\s*:\s*'([^']+)'", body):
        key, value = raw.group(1), raw.group(2)
        ts_pairs[key] = value

    # Strip any SSML length marks (``ː``) — the canonical map has no length
    # marks; the TS file may apply them at call sites in a later PR.
    def _strip_length(v: str) -> str:
        return v.replace("ː", "")

    json_map = get_ipa_map()
    for key, value in ts_pairs.items():
        assert key in json_map, f"frontend key {key!r} is not in canonical JSON map"
        assert _strip_length(value) == json_map[key], (
            f"frontend SOUND_TO_IPA[{key!r}]={value!r} disagrees with JSON "
            f"map={json_map[key]!r} (length marks stripped)"
        )


def test_canonical_json_is_valid_and_complete() -> None:
    data = json.loads(Path(PHONEME_MAP_PATH).read_text(encoding="utf-8"))
    phonemes = data["phonemes"]
    for key, entry in phonemes.items():
        assert set(entry.keys()) >= {"ipa", "anchor", "pseudo"}
        assert entry["ipa"], f"{key} missing ipa"
        assert "ː" not in entry["ipa"], f"{key} must not carry a length mark"
    for primary in data["primary_targets"]:
        assert primary in phonemes
