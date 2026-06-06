"""Mastery-estimator calibration eval runner (offline, deterministic).

Loads a calibration dataset (the committed seeded fixture by default), replays it
through the ``BetaBKT`` and ``Elo`` estimators head-to-head, grades their
calibration against the pass/fail gate, prints the report, and exits non-zero when
the better estimator fails the gate — so this can serve as a blocking CI gate
(mirroring ``scripts/ci_eval_gate.py``'s exit-code convention).

Offline and credential-free: no network, no live model, no env reads beyond the
optional durable-sink history path used by ``--record``.

Examples
--------
    # Grade the committed fixture; exit 1 if the better estimator fails the gate.
    python scripts/calibration_eval.py

    # Grade a specific exported dataset and also light the dashboard tile.
    python scripts/calibration_eval.py --dataset data/calibration/export.json --record
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import List

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.learning.eval.calibration_scorer import (  # noqa: E402
    CalibrationOutcome,
    CalibrationReport,
    score_calibration,
)

DEFAULT_DATASET = (
    Path(__file__).resolve().parents[1] / "src" / "learning" / "eval" / "fixtures" / "calibration_events.json"
)
DEFAULT_OUT = Path("data/calibration/calibration_report.json")

# Durable-sink record kind the observability dashboard reads for the calibration
# tile (see ``_agent_mesh_section`` in ``src/learning/api.py``).
CALIBRATION_SINK_KIND = "calibration"


def _load_sequences(path: Path) -> List[List[CalibrationOutcome]]:
    with path.open("r", encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, dict) or "sequences" not in data:
        raise ValueError(f"calibration dataset must be an object with a 'sequences' key: {path}")
    sequences: List[List[CalibrationOutcome]] = []
    for seq in data["sequences"]:
        sequences.append(
            [
                CalibrationOutcome(
                    item_difficulty=float(item["item_difficulty"]),
                    correct=bool(item["correct"]),
                )
                for item in seq
            ]
        )
    return sequences


def _record_to_sink(report: CalibrationReport) -> bool:
    """Append the report to the durable mesh-history sink (kind ``calibration``).

    Writes directly to ``JsonlDurableSink`` at ``AGENT_MESH_HISTORY_PATH`` (default
    ``/var/lib/agent-mesh/history.jsonl``) so the offline runner can light the
    dashboard tile in dev. Non-raising: any failure degrades to ``False``.
    """
    import os

    from src.agents.durable_sink import JsonlDurableSink

    path = (os.environ.get("AGENT_MESH_HISTORY_PATH") or "/var/lib/agent-mesh/history.jsonl").strip()
    if not path:
        return False
    try:
        sink = JsonlDurableSink(path)
        written = sink.append(CALIBRATION_SINK_KIND, report.as_dict())
        return written is not None
    except Exception:  # pragma: no cover - telemetry must never crash the runner
        return False


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="offline mastery calibration eval")
    parser.add_argument(
        "--dataset",
        type=Path,
        default=DEFAULT_DATASET,
        help="calibration dataset JSON to grade (default: committed fixture)",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=DEFAULT_OUT,
        help="write the calibration report JSON here (default: %(default)s)",
    )
    parser.add_argument(
        "--record",
        action="store_true",
        help="append the report to the durable mesh-history sink (kind 'calibration')"
        " at AGENT_MESH_HISTORY_PATH so the observability dashboard tile refreshes",
    )
    args = parser.parse_args(argv)

    try:
        sequences = _load_sequences(args.dataset)
    except FileNotFoundError:
        print(
            json.dumps(
                {"status": "error", "exit_code": 1, "reasons": ["dataset_missing"], "dataset": str(args.dataset)},
                sort_keys=True,
            )
        )
        print(f"[blocked] calibration dataset not found: {args.dataset}", file=sys.stderr)
        return 1
    except (ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
        print(
            json.dumps(
                {"status": "error", "exit_code": 1, "reasons": ["dataset_malformed"], "dataset": str(args.dataset)},
                sort_keys=True,
            )
        )
        print(f"[blocked] calibration dataset malformed: {args.dataset}: {exc}", file=sys.stderr)
        return 1

    report = score_calibration(sequences)
    payload = report.as_dict()

    if args.out is not None:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        with args.out.open("w", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=2)
            fh.write("\n")

    if args.record:
        if _record_to_sink(report):
            print("[ok] recorded calibration report to durable sink", file=sys.stderr)
        else:
            print("[skip] calibration report not recorded (sink unavailable)", file=sys.stderr)

    print(json.dumps(payload, sort_keys=True))
    better = next((m for m in report.metrics if m.estimator == report.better_estimator), None)
    summary = (
        f"better={report.better_estimator} brier={better.brier if better else 'n/a'} "
        f"ece={better.ece if better else 'n/a'} winners={report.winners} "
        f"passed={report.passed} reasons={list(report.blocking_reasons)}"
    )
    print(summary, file=sys.stderr)
    return 0 if report.passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
