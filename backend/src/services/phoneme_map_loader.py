"""Loader for the canonical phoneme map at ``data/lexicons/phoneme-map.json``.

This module provides the single source of truth for phoneme↔IPA bindings
used by :mod:`src.services.tts_normalizer`, the frontend preview UI
(via a generated TS file), and the scoring rules. The JSON file is the
authoritative artefact; all other copies are derived.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Tuple

__all__ = [
    "PHONEME_MAP_PATH",
    "load_phoneme_map",
    "get_ipa_map",
    "get_anchor_words",
    "get_primary_targets",
    "get_deprecated_aliases",
]


def _default_map_path() -> Path:
    """Walk up from this file to find ``data/lexicons/phoneme-map.json``."""
    here = Path(__file__).resolve()
    for parent in (here.parent, *here.parents):
        candidate = parent / "data" / "lexicons" / "phoneme-map.json"
        if candidate.is_file():
            return candidate
    # Fallback — will raise on load if not present.
    return here.parents[3] / "data" / "lexicons" / "phoneme-map.json"


PHONEME_MAP_PATH: Path = _default_map_path()


@lru_cache(maxsize=1)
def load_phoneme_map(path: Path | None = None) -> Dict[str, object]:
    target = Path(path) if path is not None else PHONEME_MAP_PATH
    with target.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def get_ipa_map() -> Dict[str, str]:
    data = load_phoneme_map()
    phonemes: Dict[str, Dict[str, str]] = data["phonemes"]  # type: ignore[assignment]
    return {key: entry["ipa"] for key, entry in phonemes.items()}


def get_anchor_words() -> Dict[str, str]:
    data = load_phoneme_map()
    phonemes: Dict[str, Dict[str, str]] = data["phonemes"]  # type: ignore[assignment]
    return {key: entry["anchor"] for key, entry in phonemes.items()}


def get_primary_targets() -> List[str]:
    data = load_phoneme_map()
    return list(data.get("primary_targets", []))  # type: ignore[arg-type]


def get_deprecated_aliases() -> Dict[str, str]:
    data = load_phoneme_map()
    return dict(data.get("deprecated_aliases", {}))  # type: ignore[arg-type]


def iter_entries() -> List[Tuple[str, str, str, str]]:
    """Return (key, ipa, anchor, pseudo) tuples."""
    data = load_phoneme_map()
    phonemes: Dict[str, Dict[str, str]] = data["phonemes"]  # type: ignore[assignment]
    return [
        (key, entry["ipa"], entry["anchor"], entry["pseudo"])
        for key, entry in phonemes.items()
    ]
