#!/usr/bin/env python3
"""Run the Pathfinder Learn Phase 1 synthetic offline trace."""

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
from src.learning.models import ContentPackManifest, MasteryEvent, OfflineQueuedEvent, Provenance, StudentResponse  # noqa: E402
from src.learning.planner import PlannerRequest, StubLearningPlanner  # noqa: E402
from src.learning.repository import (  # noqa: E402
    LEARNING_REQUEST_GUCS,
    LEARNING_RLS_PROTECTED_TABLES,
    InMemoryLearningRepository,
    assert_learning_rls_contract_active,
)
from src.learning.validator import PlanValidator, catalogue_grounding_rule  # noqa: E402
from src.learning.xapi import ApprovalEvent, RalphXAPISink, approval_event_to_xapi, mastery_event_to_xapi  # noqa: E402


def _canonical_json(payload: Dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=True, sort_keys=True, separators=(",", ":"))


def _load_migration_module():
    import importlib
    import importlib.util

    migration_path = BACKEND_ROOT / "alembic" / "versions" / "20260523_000024_learning_foundations.py"
    spec = importlib.util.spec_from_file_location("phase_1_learning_migration", migration_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot_load_phase_1_migration:{migration_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _phase_1_scope_dpia(trace: Dict[str, Any]) -> str:
    return "\n".join(
        [
            "# Pathfinder Learn Phase 1 Scope / DPIA Evidence",
            "",
            "Scope: learning foundation storage only; no student-facing planner UX or Phase 2 diagnostic flow is enabled.",
            "Data classes: tenant, class, student roster metadata, diagnostic responses, mastery events, approvals, xAPI statements, offline queue, and content-pack manifests.",
            "Controls: forced Postgres RLS, request GUCs, idempotency key on offline writes, xAPI-compatible event shape, and append-only evidence bundle.",
            f"Learning RLS tables: {trace['rls_contract']['table_count']}",
            f"Ralph sink status: {trace['ralph_sink']['sink_status']}",
            "Residual risk: live Ralph deployment and real Postgres cross-tenant query require the pilot environment and remain deployment-time checks.",
            "",
        ]
    )


def run_trace() -> Dict[str, Any]:
    migration = _load_migration_module()
    assert tuple(migration.LEARNING_RLS_TABLES) == LEARNING_RLS_PROTECTED_TABLES
    assert_learning_rls_contract_active(tuple(migration.LEARNING_RLS_TABLES))

    provenance = [
        Provenance(
            source="phase_1_synthetic_fixture",
            source_id="fixture-ratio-rls-001",
            rule_id="offline_trace",
            confidence=1.0,
            evidence_count=1,
        )
    ]
    repository = InMemoryLearningRepository()
    ralph_sink = RalphXAPISink(endpoint="local://ralph-compatible-sink", offline=True)

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
    repository.save_student_response(response, idempotency_key="phase-1-response-001")

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
    mastery_statement = ralph_sink.emit(mastery_event_to_xapi(mastery_event))
    repository.save_mastery_event(mastery_event, mastery_statement)
    repository.emit_xapi_statement(response.tenant_id, response.student_id, mastery_statement, ralph_sink.sink_status)

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
        raise RuntimeError(validation.audit_reason or "phase_1_validation_failed")
    plan_record = repository.save_intervention_plan(
        planner_result.plan,
        tenant_id=response.tenant_id,
        actor_id="teacher-amara",
        status="pending",
    )
    approval_event = ApprovalEvent(
        tenant_id=response.tenant_id,
        actor_id="teacher-amara",
        plan_id=planner_result.plan.plan_id,
        action="approved",
        reason="Approved during Phase 1 offline trace.",
        lang=response.lang,
        provenance=provenance,
    )
    approval_statement = ralph_sink.emit(approval_event_to_xapi(approval_event))
    approval_record = repository.record_approval(approval_event, approval_statement)
    repository.emit_xapi_statement(response.tenant_id, approval_event.actor_id, approval_statement, ralph_sink.sink_status)

    queued_event = OfflineQueuedEvent(
        tenant_id=response.tenant_id,
        actor_id=response.student_id,
        idempotency_key="phase-1-offline-001",
        event_type="student_response.sync",
        payload={"response_id": response.response_id},
    )
    queue_record = repository.queue_offline_event(queued_event)
    content_pack = ContentPackManifest(
        tenant_id=response.tenant_id,
        pack_key="nerdc-jss2-maths-foundation",
        version="phase-1-offline-2026.05",
        source_uri="data/learning/content_packs/phase_1_manifest.json",
        sha256="0" * 64,
        payload={"skills": ["ratio"], "diagnostic_items": [response.item_id]},
        lang=response.lang,
        provenance=provenance,
    )
    content_pack_record = repository.save_content_pack_manifest(content_pack)

    same_tenant_rows = repository.list_student_responses_for_tenant("tenant-demo")
    cross_tenant_rows = repository.list_student_responses_for_tenant("tenant-other")
    if not same_tenant_rows or cross_tenant_rows:
        raise RuntimeError("phase_1_cross_tenant_isolation_failed")

    return {
        "phase": 1,
        "offline": True,
        "rls_contract": {
            "table_count": len(LEARNING_RLS_PROTECTED_TABLES),
            "tables": list(LEARNING_RLS_PROTECTED_TABLES),
            "forced_rls_expected": True,
            "request_gucs": list(LEARNING_REQUEST_GUCS),
        },
        "cross_tenant_probe": {
            "same_tenant_rows": len(same_tenant_rows),
            "cross_tenant_rows": len(cross_tenant_rows),
        },
        "response": response.model_dump(),
        "mastery_event": mastery_event.model_dump(),
        "plan_record": plan_record,
        "approval_record": approval_record,
        "offline_queue_record": queue_record,
        "content_pack_record": content_pack_record,
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
    bundle_path = output_dir / f"phase_1_trace_{timestamp}.zip"
    trace_json = _canonical_json(trace).encode("utf-8")
    signature = hmac.new(signing_key, trace_json, hashlib.sha256).hexdigest()
    manifest = {
        "phase": 1,
        "signature_algorithm": "HMAC-SHA256",
        "signature": signature,
        "trace_sha256": hashlib.sha256(trace_json).hexdigest(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    with zipfile.ZipFile(bundle_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("trace.json", json.dumps(trace, ensure_ascii=True, indent=2, sort_keys=True))
        archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=True, indent=2, sort_keys=True))
        archive.writestr("scope_dpia.md", _phase_1_scope_dpia(trace))
    return bundle_path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--offline", action="store_true", help="Assert that the trace uses no cloud calls.")
    parser.add_argument("--output-dir", default=str(REPO_ROOT / "evidence" / "phase_1"))
    parser.add_argument("--signing-key", default="phase-1-dev-key")
    args = parser.parse_args()

    if not args.offline:
        print("Phase 1 trace must be run with --offline", file=sys.stderr)
        return 2
    trace = run_trace()
    bundle_path = write_bundle(trace, Path(args.output_dir), args.signing_key.encode("utf-8"))
    print(f"signed evidence bundle: {bundle_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())