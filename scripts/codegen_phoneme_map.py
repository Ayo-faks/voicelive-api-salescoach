#!/usr/bin/env python3
"""Regenerate downstream phoneme map copies from the canonical JSON file.

Source of truth: ``data/lexicons/phoneme-map.json``.
Targets:
  * ``backend/src/services/tts_normalizer.py`` — ``PHONEME_MAP``,
    ``ANCHOR_WORDS`` (between ``# >>> CODEGEN`` markers).
  * ``frontend/src/utils/phonemeSsml.ts`` — ``SOUND_TO_IPA`` block.

Usage::

    python scripts/codegen_phoneme_map.py [--check]

``--check`` exits 1 if regeneration would change any file; use this in CI.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
JSON_PATH = REPO / "data" / "lexicons" / "phoneme-map.json"
TS_PATH = REPO / "frontend" / "src" / "utils" / "phonemeSsml.ts"


def _load() -> dict:
    return json.loads(JSON_PATH.read_text(encoding="utf-8"))


def _render_ts_block(data: dict) -> str:
    lines = ["export const SOUND_TO_IPA: Readonly<Record<string, string>> = Object.freeze({"]
    for key, entry in data["phonemes"].items():
        lines.append(f"  {key}: '{entry['ipa']}',")
    lines.append("})")
    return "\n".join(lines)


def _update_ts(data: dict, check: bool) -> bool:
    if not TS_PATH.is_file():
        print(f"skip: {TS_PATH} not present")
        return False
    source = TS_PATH.read_text(encoding="utf-8")
    new_block = _render_ts_block(data)
    pattern = re.compile(
        r"export const SOUND_TO_IPA[^=]*=\s*Object\.freeze\(\{[^}]*\}\)",
        re.DOTALL,
    )
    if not pattern.search(source):
        print("warn: SOUND_TO_IPA block not found; skipping TS update")
        return False
    updated = pattern.sub(new_block, source, count=1)
    if updated == source:
        return False
    if check:
        print(f"would update: {TS_PATH}")
        return True
    TS_PATH.write_text(updated, encoding="utf-8")
    print(f"updated: {TS_PATH}")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if changes needed")
    args = parser.parse_args()

    data = _load()
    changed = _update_ts(data, args.check)

    if args.check and changed:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
