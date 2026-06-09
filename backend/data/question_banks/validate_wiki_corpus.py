#!/usr/bin/env python3
"""Validate the scraped/authored wiki corpus through the real retriever loader.

Loads every ``data/learning/wiki/*.json`` file with the production
``load_wiki_corpus`` (so it must pass the exact ``WikiNode`` schema +
taxonomy validation the backend enforces), then reports node counts per
subject and year group and how many are retrievable (status approved/frozen).

Run:
    source /home/ayoola/sen/.venv/bin/activate
    python backend/data/question_banks/validate_wiki_corpus.py
"""
from __future__ import annotations

import sys
from collections import Counter, defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from src.learning.rag import load_wiki_corpus  # noqa: E402

WIKI_DIR = REPO_ROOT / "data" / "learning" / "wiki"
RETRIEVABLE = {"approved", "frozen"}


def main() -> int:
    files = sorted(WIKI_DIR.glob("*.json"))
    if not files:
        print("no wiki files found")
        return 1

    per_subject: Counter = Counter()
    per_subject_year: dict = defaultdict(Counter)
    retrievable_per_subject: Counter = Counter()
    total = 0
    errors = 0

    for path in files:
        try:
            corpus = load_wiki_corpus(path)
        except Exception as exc:  # noqa: BLE001
            print(f"FAIL  {path.name}: {exc}")
            errors += 1
            continue
        nodes = corpus.nodes()
        print(f"OK    {path.name}: {len(nodes)} nodes")
        for n in nodes:
            total += 1
            per_subject[n.subject] += 1
            per_subject_year[n.subject][n.year_group or "?"] += 1
            if n.status in RETRIEVABLE:
                retrievable_per_subject[n.subject] += 1

    print("\n== Nodes per subject (retrievable / total) ==")
    for subject in sorted(per_subject):
        years = ", ".join(
            f"{y}:{c}" for y, c in sorted(per_subject_year[subject].items())
        )
        print(
            f"  {subject:22} {retrievable_per_subject[subject]:3}/{per_subject[subject]:<3}"
            f"  [{years}]"
        )
    print(f"\n  TOTAL nodes: {total}  retrievable: {sum(retrievable_per_subject.values())}")
    print(f"  files: {len(files)}  load errors: {errors}")

    # All 12 taxonomy subjects should now have at least one retrievable node.
    from src.learning.taxonomy import SUBJECTS

    empty = [s for s in SUBJECTS if retrievable_per_subject[s] == 0]
    if empty:
        print(f"\n  WARNING — subjects still with zero retrievable nodes: {empty}")
    else:
        print("\n  All 12 subjects have retrievable grounding.")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
