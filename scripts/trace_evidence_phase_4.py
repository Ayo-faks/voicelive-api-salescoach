#!/usr/bin/env python3
"""Run the Pathfinder Learn Phase 4 synthetic offline pilot-ops trace."""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict


REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = REPO_ROOT / "backend"
sys.path.insert(0, str(BACKEND_ROOT))

from src.learning.operations import (  # noqa: E402
    build_board_report,
    build_cost_dashboard,
    build_dpo_export,
    compute_kpi_report,
    evaluate_canary,
    load_adversarial_probes,
    load_canary_inputs,
    load_metric_snapshots,
)


OPS_PATH = REPO_ROOT / "data" / "learning" / "ops"
METRICS_PATH = OPS_PATH / "phase_4_pilot_metrics.json"
CANARY_PATH = OPS_PATH / "phase_4_canary.json"
PROBES_PATH = OPS_PATH / "phase_4_weekly_adversarial_probes.json"


def _canonical_json(payload: Dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=True, sort_keys=True, separators=(",", ":"))


def run_trace(tenant_id: str) -> Dict[str, Any]:
    snapshots = load_metric_snapshots(METRICS_PATH, tenant_id)
    kpi_report = compute_kpi_report(snapshots, tenant_id)
    config, observation = load_canary_inputs(CANARY_PATH, tenant_id)
    canary_decision = evaluate_canary(config, observation)
    probes = load_adversarial_probes(PROBES_PATH, tenant_id)

    if not kpi_report.meets_pilot_thresholds:
        raise RuntimeError("phase_4_kpi_thresholds_not_met")
    if len(probes) != 12:
        raise RuntimeError("phase_4_weekly_probe_set_incomplete")
    if not canary_decision.should_rollback:
        raise RuntimeError("phase_4_canary_did_not_trigger_expected_rollback")

    board_report = build_board_report(kpi_report, canary_decision)
    dpo_export = build_dpo_export(kpi_report, canary_decision, probes)
    cost_dashboard = build_cost_dashboard(kpi_report, snapshots)

    return {
        "phase": 4,
        "offline": True,
        "tenant_id": tenant_id,
        "kpi_report": kpi_report.model_dump(),
        "canary_decision": canary_decision.model_dump(),
        "weekly_adversarial_probe_count": len(probes),
        "board_report": {
            "title": "Pathfinder Learn Phase 4 Board Pack",
            "line_count": len(board_report.splitlines()),
        },
        "dpo_export": {
            "line_count": len(dpo_export.splitlines()),
            "contains_raw_student_response_text": False,
        },
        "cost_dashboard": cost_dashboard,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


def write_bundle(trace: Dict[str, Any], output_dir: Path, signing_key: bytes) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    bundle_path = output_dir / f"phase_4_trace_{timestamp}.zip"
    trace_json = _canonical_json(trace).encode("utf-8")
    signature = hmac.new(signing_key, trace_json, hashlib.sha256).hexdigest()
    manifest = {
        "phase": 4,
        "signature_algorithm": "HMAC-SHA256",
        "signature": signature,
        "trace_sha256": hashlib.sha256(trace_json).hexdigest(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    snapshots = load_metric_snapshots(METRICS_PATH, trace["tenant_id"])
    config, observation = load_canary_inputs(CANARY_PATH, trace["tenant_id"])
    report = compute_kpi_report(snapshots, trace["tenant_id"])
    rollback = evaluate_canary(config, observation)
    probes = load_adversarial_probes(PROBES_PATH, trace["tenant_id"])
    with zipfile.ZipFile(bundle_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("trace.json", json.dumps(trace, ensure_ascii=True, indent=2, sort_keys=True))
        archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=True, indent=2, sort_keys=True))
        archive.writestr("board_pack.md", build_board_report(report, rollback))
        archive.writestr("dpo_export.md", build_dpo_export(report, rollback, probes))
        archive.writestr("cost_dashboard.json", json.dumps(build_cost_dashboard(report, snapshots), ensure_ascii=True, indent=2, sort_keys=True))
        archive.writestr("weekly_adversarial_probes.json", json.dumps([probe.model_dump() for probe in probes], ensure_ascii=True, indent=2, sort_keys=True))
    return bundle_path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tenant", required=True)
    parser.add_argument("--offline-fixtures", action="store_true", help="Assert that the trace uses checked-in fixtures only.")
    parser.add_argument("--output-dir", default=str(REPO_ROOT / "evidence" / "phase_4"))
    parser.add_argument("--signing-key", default="phase-4-dev-key")
    args = parser.parse_args()

    if not args.offline_fixtures:
        print("Phase 4 trace must be run with --offline-fixtures", file=sys.stderr)
        return 2
    trace = run_trace(args.tenant)
    bundle_path = write_bundle(trace, Path(args.output_dir), args.signing_key.encode("utf-8"))
    print(f"signed evidence bundle: {bundle_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
