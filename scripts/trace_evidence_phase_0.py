#!/usr/bin/env python3
"""Run the Pathfinder Learn Phase 0 synthetic offline trace."""

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

from src.learning.mastery import BetaBKT, MasteryUpdateInput  # noqa: E402
from src.learning.models import MasteryEvent, Provenance, StudentResponse  # noqa: E402
from src.learning.planner import PlannerRequest, StubLearningPlanner  # noqa: E402
from src.learning.validator import PlanValidator, catalogue_grounding_rule  # noqa: E402
from src.learning.xapi import AuditLedgerXAPISink, mastery_event_to_xapi  # noqa: E402


def _canonical_json(payload: Dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=True, sort_keys=True, separators=(",", ":"))


def run_trace() -> Dict[str, Any]:
    provenance = [
        Provenance(
            source="phase_0_synthetic_fixture",
            source_id="fixture-ratio-001",
            rule_id="offline_trace",
            confidence=1.0,
            evidence_count=1,
        )
    ]
    response = StudentResponse(
        tenant_id="tenant-demo",
        student_id="student-dami",
        item_id="item-ratio-001",
        skill_id="ratio",
        response_text="2:3",
        correct=True,
        lang="en-NG",
        provenance=provenance,
    )
    mastery_result = BetaBKT().update(
        MasteryUpdateInput(
            tenant_id=response.tenant_id,
            student_id=response.student_id,
            skill_id=response.skill_id,
            correct=response.correct,
            lang=response.lang,
            provenance=response.provenance,
        )
    )
    mastery_event = MasteryEvent(
        tenant_id=response.tenant_id,
        student_id=response.student_id,
        skill_id=response.skill_id,
        response_id=response.response_id,
        estimate=mastery_result.estimate,
        lang=response.lang,
        provenance=mastery_result.provenance,
    )
    xapi_statement = mastery_event_to_xapi(mastery_event)
    emitted = AuditLedgerXAPISink().emit(xapi_statement)

    planner_result = StubLearningPlanner().run_turn(
        PlannerRequest(
            tenant_id=response.tenant_id,
            actor_id="teacher-amara",
            role="teacher",
            prompt="Suggest an intervention for the current ratio gap.",
            scope={"skill_ids": [response.skill_id], "student_ids": [response.student_id]},
            offline=True,
            lang=response.lang,
            provenance=provenance,
        )
    )
    validation = PlanValidator([catalogue_grounding_rule(["ratio"])]).validate(planner_result.plan)
    if not validation.ok:
        raise RuntimeError(validation.audit_reason or "phase_0_validation_failed")

    return {
        "phase": 0,
        "offline": True,
        "response": response.model_dump(),
        "mastery": mastery_result.model_dump(),
        "planner_result": planner_result.model_dump(),
        "validation": {"ok": validation.ok, "audit_reason": validation.audit_reason},
        "xapi_statement": emitted.model_dump(),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


def write_bundle(trace: Dict[str, Any], output_dir: Path, signing_key: bytes) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    bundle_path = output_dir / f"phase_0_trace_{timestamp}.zip"
    trace_json = _canonical_json(trace).encode("utf-8")
    signature = hmac.new(signing_key, trace_json, hashlib.sha256).hexdigest()
    manifest = {
        "phase": 0,
        "signature_algorithm": "HMAC-SHA256",
        "signature": signature,
        "trace_sha256": hashlib.sha256(trace_json).hexdigest(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    with zipfile.ZipFile(bundle_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("trace.json", json.dumps(trace, ensure_ascii=True, indent=2, sort_keys=True))
        archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=True, indent=2, sort_keys=True))
    return bundle_path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--offline", action="store_true", help="Assert that the trace uses no cloud calls.")
    parser.add_argument("--output-dir", default=str(REPO_ROOT / "evidence" / "phase_0"))
    parser.add_argument("--signing-key", default="phase-0-dev-key")
    args = parser.parse_args()

    if not args.offline:
        print("Phase 0 trace must be run with --offline", file=sys.stderr)
        return 2
    trace = run_trace()
    bundle_path = write_bundle(trace, Path(args.output_dir), args.signing_key.encode("utf-8"))
    print(f"signed evidence bundle: {bundle_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())