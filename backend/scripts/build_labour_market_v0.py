"""Build the v0 LabourMarketDataset draft JSON from snapshots."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.learning.career.labour_market_etl import (  # noqa: E402
    build_dataset_from_path,
)


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SOURCES = REPO_ROOT / "data" / "learning" / "career" / "sources_v0"
DEFAULT_OUT = REPO_ROOT / "data" / "learning" / "career" / "labour_market_v0_draft.json"


def main() -> int:
    parser = argparse.ArgumentParser(description="Build labour-market dataset v0 draft")
    parser.add_argument("--sources", type=Path, default=DEFAULT_SOURCES)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--dataset-id", default="nigeria-career-labour-market-v0")
    parser.add_argument("--lang", default="en-NG")
    parser.add_argument(
        "--force",
        action="store_true",
        help="bypass LEARNING_LABOUR_MARKET_ETL_V1 kill switch",
    )
    args = parser.parse_args()

    draft = build_dataset_from_path(
        args.sources,
        dataset_id=args.dataset_id,
        lang=args.lang,
        require_flag=not args.force,
    )
    payload = json.loads(draft.model_dump_json())
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    print(
        f"[ok] wrote draft with {len(draft.dataset.records)} pathways -> {args.out}",
        file=sys.stderr,
    )
    print(f"[info] review_state={draft.review_state}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
