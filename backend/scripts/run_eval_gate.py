"""CLI: run the W7 eval gate against the default safety probes.

Exits 0 on pass, 1 on fail. Used by CI as the release gate. By default
runs the deterministic fixture handler so the gate produces a clean
report even without a backend connection; pass ``--handler real`` to
wire to the FastAPI endpoint (not implemented in this script; CI does it
via a sidecar).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.learning.eval import (  # noqa: E402
    EVAL_HARNESS_FLAG,
    SAFETY_PROBES_FLAG,
    Tier1Thresholds,
    default_probes,
    fixture_handler,
    run_suite,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="W7 eval gate runner")
    parser.add_argument("--suite-id", default="w7-default-safety")
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument(
        "--force",
        action="store_true",
        help="bypass eval harness kill switches (CI dry-runs only)",
    )
    args = parser.parse_args()

    if args.force:
        os.environ[EVAL_HARNESS_FLAG] = "1"
        os.environ[SAFETY_PROBES_FLAG] = "1"

    probes = default_probes(require_flag=not args.force)
    report = run_suite(
        fixture_handler(),
        probes,
        suite_id=args.suite_id,
        thresholds=Tier1Thresholds(),
        require_flag=not args.force,
    )

    payload = json.loads(report.model_dump_json())
    if args.out is not None:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        with args.out.open("w", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=2)
            fh.write("\n")
        print(f"[ok] wrote report -> {args.out}", file=sys.stderr)

    print(
        f"suite={report.suite_id} passed={report.passed} "
        f"pass_rate={report.pass_rate} counts={report.counts}"
    )
    return 0 if report.passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
