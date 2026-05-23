#!/usr/bin/env python3
"""Run the Pathfinder Learn Phase 2 synthetic offline trace."""

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

from src.learning.diagnostic import DiagnosticAnswer, DiagnosticEngine, load_item_bank  # noqa: E402
from src.learning.repository import InMemoryLearningRepository  # noqa: E402
from src.learning.xapi import ApprovalEvent, RalphXAPISink, approval_event_to_xapi  # noqa: E402


ITEM_BANK_PATH = REPO_ROOT / "data" / "learning" / "jss2_maths_diagnostic_phase_2.json"


def _canonical_json(payload: Dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=True, sort_keys=True, separators=(",", ":"))


def _phase_2_scope_dpia(trace: Dict[str, Any]) -> str:
    return "\n".join(
        [
            "# Pathfinder Learn Phase 2 Scope / DPIA Evidence",
            "",
            "Scope: offline JSS2 maths diagnostic, mastery heatmap, cached teacher suggestion, and explicit HITL approval evidence.",
            "Data classes: diagnostic item metadata, student responses, mastery estimates, xAPI statements, heatmap cells, pending plan metadata, and approval audit event.",
            "Controls: deterministic offline item selection, Beta-BKT fallback, repository-mediated persistence, xAPI-compatible events, provenance on every rendered suggestion, and append-only evidence bundle.",
            f"Diagnostic items: {trace['diagnostic']['item_count']}",
            f"Mastery events: {trace['repository_counts']['mastery_events']}",
            f"xAPI statements: {trace['repository_counts']['xapi_statements']}",
            "Residual risk: live classroom roster imports and Ralph delivery acknowledgements remain deployment-time checks.",
            "",
        ]
    )


def run_trace() -> Dict[str, Any]:
    item_bank = load_item_bank(ITEM_BANK_PATH)
    repository = InMemoryLearningRepository()
    diagnostic = DiagnosticEngine(repository).run_offline(
        item_bank=item_bank,
        tenant_id="tenant-phase-2",
        class_id="jss2-blue",
        student_id="student-ade",
        teacher_id="teacher-bola",
        answers=[DiagnosticAnswer(item_id="jss2-linear-007", response_text="5")],
    )
    pending_status = repository.intervention_plans[0]["status"]
    if pending_status != "pending":
        raise RuntimeError("phase_2_plan_was_not_pending_before_hitl_approval")
    if not diagnostic.pending_plan.provenance:
        raise RuntimeError("phase_2_plan_missing_provenance_footer_source")

    ralph_sink = RalphXAPISink(endpoint="local://ralph-compatible-sink", offline=True)
    approval_event = ApprovalEvent(
        tenant_id="tenant-phase-2",
        actor_id="teacher-bola",
        plan_id=diagnostic.pending_plan.plan_id,
        action="approved",
        reason="Teacher approved Phase 2 offline intervention suggestion.",
        lang=diagnostic.pending_plan.lang,
        provenance=diagnostic.pending_plan.provenance,
    )
    approval_statement = ralph_sink.emit(approval_event_to_xapi(approval_event))
    approval_record = repository.record_approval(approval_event, approval_statement)
    repository.emit_xapi_statement(approval_event.tenant_id, approval_event.actor_id, approval_statement, ralph_sink.sink_status)

    return {
        "phase": 2,
        "offline": True,
        "diagnostic": {
            "diagnostic_id": item_bank.diagnostic_id,
            "skill_count": len(item_bank.skills),
            "item_count": len(item_bank.items),
            "session": diagnostic.session.model_dump(),
            "response_count": len(diagnostic.responses),
            "incorrect_response_count": len([response for response in diagnostic.responses if not response.correct]),
        },
        "heatmap": diagnostic.heatmap.model_dump(),
        "pending_plan_before_approval": {
            "status": pending_status,
            "plan": diagnostic.pending_plan.model_dump(),
            "provenance_footer_count": len(diagnostic.pending_plan.provenance),
        },
        "approval_record": approval_record,
        "repository_counts": {
            "student_responses": len(repository.student_responses),
            "mastery_events": len(repository.mastery_events),
            "intervention_plans": len(repository.intervention_plans),
            "approvals": len(repository.approvals),
            "xapi_statements": len(repository.xapi_statements),
        },
        "ralph_sink": {
            "endpoint": ralph_sink.endpoint,
            "sink_status": ralph_sink.sink_status,
            "statement_count": len(ralph_sink.emitted),
        },
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


def write_bundle(trace: Dict[str, Any], output_dir: Path, signing_key: bytes) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    bundle_path = output_dir / f"phase_2_trace_{timestamp}.zip"
    trace_json = _canonical_json(trace).encode("utf-8")
    signature = hmac.new(signing_key, trace_json, hashlib.sha256).hexdigest()
    manifest = {
        "phase": 2,
        "signature_algorithm": "HMAC-SHA256",
        "signature": signature,
        "trace_sha256": hashlib.sha256(trace_json).hexdigest(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    with zipfile.ZipFile(bundle_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("trace.json", json.dumps(trace, ensure_ascii=True, indent=2, sort_keys=True))
        archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=True, indent=2, sort_keys=True))
        archive.writestr("scope_dpia.md", _phase_2_scope_dpia(trace))
    return bundle_path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--offline", action="store_true", help="Assert that the trace uses no cloud calls.")
    parser.add_argument("--output-dir", default=str(REPO_ROOT / "evidence" / "phase_2"))
    parser.add_argument("--signing-key", default="phase-2-dev-key")
    args = parser.parse_args()

    if not args.offline:
        print("Phase 2 trace must be run with --offline", file=sys.stderr)
        return 2
    trace = run_trace()
    bundle_path = write_bundle(trace, Path(args.output_dir), args.signing_key.encode("utf-8"))
    print(f"signed evidence bundle: {bundle_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())