#!/usr/bin/env python3
"""Lint that voiceless ``/th/`` and voiced ``/dh/`` are used correctly.

Scans the repository for graphemic phoneme citations and flags:

* ``/TH/`` (uppercase) anywhere outside the phoneme-map docs — deprecated
  legacy spelling; should be rewritten to ``/dh/``.
* ``/th/`` used in contexts where the word is voiced (e.g. *this*, *the*,
  *them*, *these*, *those*, *they*, *there*, *than*, *that*, *then*).
  These should use ``/dh/``.
* ``/dh/`` used in contexts where the word is voiceless (e.g. *think*,
  *thin*, *thumb*, *thick*, *three*). These should use ``/th/``.

Exits non-zero if any violation is found.

Usage::

    python scripts/check_th_voicing.py [paths...]

Defaults to scanning ``data/exercises``, ``data/lexicons``,
``backend/src``, and ``frontend/src`` when no paths are given.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Iterable, List, Tuple

REPO = Path(__file__).resolve().parents[1]

VOICED_WORDS = {
    "this",
    "that",
    "these",
    "those",
    "they",
    "them",
    "there",
    "their",
    "then",
    "than",
    "the",
    "though",
    "thus",
    "thy",
    "thee",
    "smooth",
    "bathe",
    "breathe",
    "father",
    "mother",
    "brother",
    "weather",
    "feather",
}

VOICELESS_WORDS = {
    "think",
    "thin",
    "thing",
    "thumb",
    "thick",
    "three",
    "thirty",
    "thirteen",
    "thousand",
    "thunder",
    "thursday",
    "theatre",
    "theater",
    "theme",
    "theta",
    "thaw",
    "tooth",
    "teeth",
    "math",
    "maths",
    "path",
    "bath",
    "breath",
    "cloth",
    "mouth",
    "north",
    "south",
}

DEFAULT_SCAN_DIRS = (
    "data/exercises",
    "data/lexicons",
    "backend/src",
    "frontend/src",
)

SKIP_FILENAMES = {"check_th_voicing.py", "phoneme-map.json", "tts_normalizer.py"}

# A phoneme citation: /th/ or /TH/ or /dh/ bounded by non-alphanumerics so we
# do not match URL fragments.
TH_CITATION = re.compile(r"(?<![A-Za-z0-9])/([Tt][Hh]|dh)/(?![A-Za-z0-9])")

WORD_CONTEXT = re.compile(r"[A-Za-z]+")


def _iter_files(paths: Iterable[Path]) -> Iterable[Path]:
    text_suffixes = {".py", ".ts", ".tsx", ".js", ".jsx", ".md", ".yml", ".yaml", ".json", ".xml", ".html"}
    for root in paths:
        if not root.exists():
            continue
        if root.is_file():
            yield root
            continue
        for child in root.rglob("*"):
            if not child.is_file():
                continue
            if child.name in SKIP_FILENAMES:
                continue
            if "/node_modules/" in str(child) or "/dist/" in str(child) or "/build/" in str(child):
                continue
            if child.suffix.lower() in text_suffixes:
                yield child


def _nearby_words(line: str, span: Tuple[int, int], radius: int = 40) -> List[str]:
    start = max(0, span[0] - radius)
    end = min(len(line), span[1] + radius)
    return [m.group(0).lower() for m in WORD_CONTEXT.finditer(line[start:end])]


def _check_line(line: str) -> List[str]:
    problems: List[str] = []
    for match in TH_CITATION.finditer(line):
        token = match.group(1)
        nearby = set(_nearby_words(line, match.span()))
        if token.lower() == "th":
            if token == "TH":
                problems.append(
                    "uppercase /TH/ is deprecated; use /dh/ for voiced th"
                )
            if nearby & VOICED_WORDS:
                voiced_hit = sorted(nearby & VOICED_WORDS)
                problems.append(
                    f"voiceless /th/ appears next to voiced word(s) {voiced_hit}; "
                    "consider /dh/"
                )
        elif token == "dh":
            if nearby & VOICELESS_WORDS:
                voiceless_hit = sorted(nearby & VOICELESS_WORDS)
                problems.append(
                    f"voiced /dh/ appears next to voiceless word(s) {voiceless_hit}; "
                    "consider /th/"
                )
    return problems


def main(argv: List[str]) -> int:
    if argv:
        roots = [Path(p).resolve() for p in argv]
    else:
        roots = [REPO / p for p in DEFAULT_SCAN_DIRS]

    violations = 0
    for file_path in _iter_files(roots):
        try:
            content = file_path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for lineno, line in enumerate(content.splitlines(), start=1):
            for problem in _check_line(line):
                violations += 1
                rel = file_path.relative_to(REPO) if REPO in file_path.parents else file_path
                print(f"{rel}:{lineno}: {problem}")

    if violations:
        print(f"\n{violations} voicing issue(s) found", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
