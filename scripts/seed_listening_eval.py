#!/usr/bin/env python3
"""Seed the listening-eval table with an initial set of A/B items.

Pairs every primary target sound's anchor token against two SSML variants:
``A`` uses the canonical IPA ``<phoneme>`` tag alone; ``B`` additionally
references the published custom lexicon. Therapist votes decide which
variant wins, which in turn tunes the runtime SSML builder via the
reward service.

Usage::

    python scripts/seed_listening_eval.py \\
      --db /path/to/wulo.sqlite3 \\
      --voice en-GB-SoniaNeural \\
      --lexicon https://storage.example/wulo.pls \\
      [--dry-run]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import List

# Ensure backend/src on path so ``from src.services...`` works when run
# without pip install -e.
REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "backend"))

from src.services.listening_eval_service import (  # noqa: E402
    ListeningEvalItem,
    ListeningEvalService,
    sqlite_connection,
)
from src.services.phoneme_map_loader import get_anchor_words, get_ipa_map  # noqa: E402
from src.services.tts_normalizer import wrap_as_ssml  # noqa: E402

PRIMARY = ("r", "s", "sh", "th", "k", "f")


def _build_variants(
    token: str,
    target_sound: str,
    ipa: str,
    anchor: str,
    voice: str,
    lexicon_uri: str | None,
) -> tuple[dict, dict]:
    reference = anchor
    body = (
        f'<phoneme alphabet="ipa" ph="{ipa}">{reference}</phoneme>'
    )
    variant_a = {
        "label": "ipa-only",
        "ssml": wrap_as_ssml(body, voice=voice, lexicon_uri=None),
    }
    variant_b = {
        "label": "ipa+lexicon",
        "ssml": wrap_as_ssml(body, voice=voice, lexicon_uri=lexicon_uri),
    }
    return variant_a, variant_b


def _seed(
    db_path: str,
    voice: str,
    lexicon_uri: str | None,
    dry_run: bool,
) -> List[dict]:
    ipa_map = get_ipa_map()
    anchors = get_anchor_words()

    created: List[dict] = []
    if dry_run:
        for sound in PRIMARY:
            va, vb = _build_variants(
                token=anchors[sound],
                target_sound=sound,
                ipa=ipa_map[sound],
                anchor=anchors[sound],
                voice=voice,
                lexicon_uri=lexicon_uri,
            )
            created.append(
                {
                    "targetSound": sound,
                    "targetToken": anchors[sound],
                    "variantA": va,
                    "variantB": vb,
                }
            )
        return created

    def _connect():
        return sqlite_connection(db_path)

    service = ListeningEvalService(_connect)
    for sound in PRIMARY:
        va, vb = _build_variants(
            token=anchors[sound],
            target_sound=sound,
            ipa=ipa_map[sound],
            anchor=anchors[sound],
            voice=voice,
            lexicon_uri=lexicon_uri,
        )
        item = ListeningEvalItem(
            id="",
            target_token=anchors[sound],
            target_sound=sound,
            reference_text=anchors[sound],
            variant_a_ssml=va["ssml"],
            variant_b_ssml=vb["ssml"],
            variant_a_label=va["label"],
            variant_b_label=vb["label"],
            voice_name=voice,
            lexicon_version=None,
        )
        saved = service.create_item(item)
        created.append(saved.to_dict())
    return created


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default="backend/wulo.sqlite3", help="SQLite path")
    parser.add_argument("--voice", default="en-GB-SoniaNeural")
    parser.add_argument(
        "--lexicon",
        default=None,
        help="Published wulo.pls URL (optional; omit to seed only variant A)",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    rows = _seed(
        db_path=args.db,
        voice=args.voice,
        lexicon_uri=args.lexicon,
        dry_run=args.dry_run,
    )
    json.dump({"created": len(rows), "items": rows}, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
