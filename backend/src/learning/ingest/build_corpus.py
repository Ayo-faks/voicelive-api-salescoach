"""CLI: build per-subject WikiNode seed files from sources + curriculum map.

Usage (run from ``backend/`` with the venv active)::

    python -m src.learning.ingest.build_corpus \
        --notes ../data/learning/curriculum/notes \
        --out   ../data/learning/wiki \
        --subject maths            # optional filter
        --year-group SS3           # optional filter (repeatable)

Pipeline: sources -> chunker -> safety gate -> emit (WikiNode) -> dedupe ->
per-subject seed files. Idempotent: re-running with the same inputs rewrites the
same files. Rejected chunks are logged and counted, never emitted.

This is a BUILD-TIME tool. It is never imported by the request hot path.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Sequence

from pydantic import ValidationError

from .chunker import chunk_block
from .emit import emit_node
from .safety import review_chunk
from .sources import NotesSource

SEED_FILE_PROVENANCE = [
    {
        "source": "pathfinder.ingest",
        "rule_id": "ingest",
        "confidence": 1.0,
        "evidence_count": 1,
    }
]


@dataclass
class BuildReport:
    emitted: int = 0
    rejected_safety: int = 0
    rejected_validation: int = 0
    deduped: int = 0
    per_subject: Dict[str, int] = field(default_factory=lambda: defaultdict(int))
    per_year: Dict[str, int] = field(default_factory=lambda: defaultdict(int))
    rejects: List[str] = field(default_factory=list)

    def summary(self) -> str:
        lines = [
            f"emitted={self.emitted} "
            f"rejected_safety={self.rejected_safety} "
            f"rejected_validation={self.rejected_validation} "
            f"deduped={self.deduped}",
            "per_subject: "
            + ", ".join(f"{k}={v}" for k, v in sorted(self.per_subject.items())),
            "per_year: "
            + ", ".join(f"{k}={v}" for k, v in sorted(self.per_year.items())),
        ]
        if self.rejects:
            lines.append("rejects:")
            lines.extend(f"  - {r}" for r in self.rejects)
        return "\n".join(lines)


def build(
    notes_dir: Path,
    out_dir: Path,
    *,
    only_subject: Optional[str] = None,
    only_years: Optional[Sequence[str]] = None,
    write: bool = True,
) -> BuildReport:
    report = BuildReport()
    years = set(only_years) if only_years else None

    source = NotesSource(notes_dir, only_subject=only_subject)
    # subject -> {node_id -> node payload dict}
    by_subject: Dict[str, Dict[str, dict]] = defaultdict(dict)
    seen_anchors: set = set()

    for block in source.load():
        if years and block.key.year_group not in years:
            continue
        for part, chunk in enumerate(chunk_block(block)):
            verdict = review_chunk(chunk)
            if not verdict.passed:
                report.rejected_safety += 1
                report.rejects.append(
                    f"safety {chunk.key.subject}/{chunk.key.year_group}/"
                    f"{chunk.key.topic}/{chunk.key.subtopic}: "
                    + ", ".join(verdict.reasons)
                )
                continue
            try:
                node = emit_node(chunk, part=part)
            except ValidationError as exc:
                report.rejected_validation += 1
                first = exc.errors()[0] if exc.errors() else {}
                report.rejects.append(
                    f"validation {chunk.key.subject}/{chunk.key.year_group}/"
                    f"{chunk.key.topic}: {first.get('loc')} {first.get('msg')}"
                )
                continue

            node_dict = node.model_dump(mode="json", exclude_none=True)
            nid = node_dict["node_id"]
            subject = node_dict["subject"]
            anchors = tuple(node_dict.get("anchors", []))

            if nid in by_subject[subject] or any(a in seen_anchors for a in anchors):
                report.deduped += 1
                continue

            by_subject[subject][nid] = node_dict
            seen_anchors.update(anchors)
            report.emitted += 1
            report.per_subject[subject] += 1
            report.per_year[node_dict.get("year_group") or "none"] += 1

    if write:
        out_dir.mkdir(parents=True, exist_ok=True)
        for subject, nodes in sorted(by_subject.items()):
            seed = {
                "version": "1.0.0",
                "lang": "en",
                "provenance": SEED_FILE_PROVENANCE,
                "nodes": [nodes[k] for k in sorted(nodes)],
            }
            out_path = out_dir / f"{subject}_curriculum_wiki.json"
            out_path.write_text(
                json.dumps(seed, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )

    return report


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--notes", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--subject", default=None)
    parser.add_argument("--year-group", action="append", default=None)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    report = build(
        args.notes,
        args.out,
        only_subject=args.subject,
        only_years=args.year_group,
        write=not args.dry_run,
    )
    print(report.summary())
    return 0


if __name__ == "__main__":
    sys.exit(main())
