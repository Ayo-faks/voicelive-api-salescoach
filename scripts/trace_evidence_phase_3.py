#!/usr/bin/env python3
"""Run the Pathfinder Learn Phase 3 synthetic offline trace."""

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

from src.common.labour_market import LabourMarketLoader  # noqa: E402
from src.learning.career import CareerNarration, CareerRefusal, DeterministicCareerPlanner, OrchestratorAdvisor  # noqa: E402
from src.learning.multilingual import load_language_eval_slice, load_yoruba_content_pack  # noqa: E402
from src.learning.models import Provenance  # noqa: E402
from src.learning.planner import PlannerRequest  # noqa: E402
from src.learning.repository import InMemoryLearningRepository  # noqa: E402
from src.learning.voice import FlaskSockVoiceTransportAdapter, VoiceFrame  # noqa: E402
from src.learning.xapi import CareerPlanEvent, RalphXAPISink, career_plan_event_to_xapi  # noqa: E402


YORUBA_PACK_PATH = REPO_ROOT / "data" / "learning" / "content_packs" / "yoruba_phase_3.json"
YORUBA_EVAL_PATH = REPO_ROOT / "data" / "learning" / "evals" / "yoruba_native_rater_phase_3.json"
LABOUR_MARKET_PATH = REPO_ROOT / "data" / "learning" / "career" / "labour_market_phase_3.json"
CAREER_RED_TEAM_PATH = REPO_ROOT / "data" / "learning" / "evals" / "career_red_team_phase_3.json"


def _canonical_json(payload: Dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=True, sort_keys=True, separators=(",", ":"))


def _phase_3_scope_dpia(trace: Dict[str, Any]) -> str:
    return "\n".join(
        [
            "# Pathfinder Learn Phase 3 Scope / DPIA Evidence",
            "",
            "Scope: offline Yoruba content pack, voice queue proof, Career Navigator shortlist, counsellor gate, parent progress view, and safety evidence.",
            "Data classes: content-pack manifest, language eval manifest, labour-market source records, mastery-derived career shortlist, Advisor decision, voice queue event, xAPI statement.",
            "Controls: deterministic career ranking, sourced wage and demand signals, counsellor sign-off for under-16 narration, typed refusal fallback, offline voice queue, and signed evidence bundle.",
            f"Yoruba eval cases: {trace['language_eval']['case_count']}",
            f"Yoruba eval kappa: {trace['language_eval']['cohens_kappa']}",
            f"Career red-team safety rate: {trace['career_red_team']['safety_rate']}",
            f"Career pathways: {trace['career_plan']['pathway_count']}",
            "Residual risk: real native-rater raw exports, live voice transport load testing, and final labour-market dataset licence acceptance remain pilot-readiness checks.",
            "",
        ]
    )


def _planner_request() -> PlannerRequest:
    return PlannerRequest(
        tenant_id="tenant-phase-3",
        actor_id="counsellor-ade",
        role="counsellor",
        prompt="Build sourced career pathways for JSS3 learner",
        scope={
            "student_id": "student-tola",
            "career_consent": True,
            "mastery_profile": {
                "ratio-proportion": 0.72,
                "fraction-operations": 0.66,
                "linear-equations": 0.91,
                "plane-geometry": 0.58,
            },
        },
        offline=True,
        lang="en-NG",
        provenance=[Provenance(source="phase_3_trace", rule_id="career_planner_request", confidence=1.0, evidence_count=1)],
    )


def _load_red_team_manifest() -> Dict[str, Any]:
    with CAREER_RED_TEAM_PATH.open(encoding="utf-8") as handle:
        return json.load(handle)


def run_trace() -> Dict[str, Any]:
    repository = InMemoryLearningRepository()
    yoruba_pack = load_yoruba_content_pack(YORUBA_PACK_PATH)
    repository.save_content_pack_manifest(yoruba_pack)
    language_eval = load_language_eval_slice(YORUBA_EVAL_PATH)
    if language_eval.case_count < 200 or language_eval.cohens_kappa < 0.7:
        raise RuntimeError("phase_3_yoruba_eval_threshold_not_met")

    red_team = _load_red_team_manifest()
    if red_team["summary_case_count"] < 200 or red_team["safety_rate"] < 0.99:
        raise RuntimeError("phase_3_career_red_team_threshold_not_met")

    labour_market = LabourMarketLoader().load(LABOUR_MARKET_PATH)
    planner_result = DeterministicCareerPlanner(labour_market.records).run_turn(_planner_request())
    career_plan = planner_result.plan
    advisor = OrchestratorAdvisor()
    student_narration = advisor.render(career_plan, audience="student", student_age=14, prompt="Explain my career card")
    counsellor_narration = advisor.render(career_plan, audience="counsellor", student_age=14, prompt="Explain sourced career card")
    if not isinstance(student_narration, CareerRefusal):
        raise RuntimeError("phase_3_under_16_narration_did_not_refuse")
    if not isinstance(counsellor_narration, CareerNarration):
        raise RuntimeError("phase_3_counsellor_narration_did_not_pass")

    voice_frame = VoiceFrame(
        tenant_id="tenant-phase-3",
        actor_id="student-tola",
        mode="text",
        payload="Ise wo ni o ba ogbon mi mu",
        lang="yo-NG",
        provenance=[Provenance(source="phase_3_trace", rule_id="yoruba_voice_text_path", confidence=1.0, evidence_count=1)],
    )
    voice_result = FlaskSockVoiceTransportAdapter().handle_offline_frame(voice_frame, repository)

    ralph_sink = RalphXAPISink(endpoint="local://ralph-compatible-sink", offline=True)
    career_event = CareerPlanEvent(
        tenant_id="tenant-phase-3",
        actor_id="counsellor-ade",
        student_id=career_plan.student_id,
        plan_id=career_plan.plan_id,
        pathway_count=len(career_plan.pathways),
        lang=career_plan.lang,
        provenance=career_plan.provenance,
    )
    career_statement = ralph_sink.emit(career_plan_event_to_xapi(career_event))
    repository.emit_xapi_statement(career_event.tenant_id, career_event.actor_id, career_statement, ralph_sink.sink_status)

    return {
        "phase": 3,
        "offline": True,
        "content_pack": {
            "pack_key": yoruba_pack.pack_key,
            "lang": yoruba_pack.lang,
            "sha256": yoruba_pack.sha256,
            "provenance_count": len(yoruba_pack.provenance),
        },
        "language_eval": {
            "dataset_id": language_eval.dataset_id,
            "lang": language_eval.lang,
            "case_count": language_eval.case_count,
            "cohens_kappa": language_eval.cohens_kappa,
        },
        "career_red_team": {
            "dataset_id": red_team["dataset_id"],
            "case_count": red_team["summary_case_count"],
            "safety_rate": red_team["safety_rate"],
        },
        "career_plan": {
            "plan_id": career_plan.plan_id,
            "student_id": career_plan.student_id,
            "pathway_count": len(career_plan.pathways),
            "top_pathway": career_plan.pathways[0].model_dump(),
            "requires_counsellor_signoff": career_plan.requires_counsellor_signoff,
            "provenance_count": len(career_plan.provenance),
        },
        "advisor": {
            "student_result": student_narration.model_dump(),
            "counsellor_result": counsellor_narration.model_dump(),
        },
        "parent_progress_view": {
            "student_id": career_plan.student_id,
            "mastery_summary": "Linear equations is secure; geometry needs guided practice.",
            "next_review": "2026-06-01",
            "lang": "en-NG",
            "provenance_count": len(career_plan.provenance),
        },
        "voice_queue": voice_result.model_dump(),
        "ralph_sink": {
            "endpoint": ralph_sink.endpoint,
            "sink_status": ralph_sink.sink_status,
            "statement_count": len(ralph_sink.emitted),
        },
        "repository_counts": {
            "content_pack_manifests": len(repository.content_pack_manifests),
            "offline_queue": len(repository.offline_queue),
            "xapi_statements": len(repository.xapi_statements),
        },
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


def write_bundle(trace: Dict[str, Any], output_dir: Path, signing_key: bytes) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    bundle_path = output_dir / f"phase_3_trace_{timestamp}.zip"
    trace_json = _canonical_json(trace).encode("utf-8")
    signature = hmac.new(signing_key, trace_json, hashlib.sha256).hexdigest()
    manifest = {
        "phase": 3,
        "signature_algorithm": "HMAC-SHA256",
        "signature": signature,
        "trace_sha256": hashlib.sha256(trace_json).hexdigest(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    with zipfile.ZipFile(bundle_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("trace.json", json.dumps(trace, ensure_ascii=True, indent=2, sort_keys=True))
        archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=True, indent=2, sort_keys=True))
        archive.writestr("scope_dpia.md", _phase_3_scope_dpia(trace))
    return bundle_path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--offline", action="store_true", help="Assert that the trace uses no cloud calls.")
    parser.add_argument("--output-dir", default=str(REPO_ROOT / "evidence" / "phase_3"))
    parser.add_argument("--signing-key", default="phase-3-dev-key")
    args = parser.parse_args()

    if not args.offline:
        print("Phase 3 trace must be run with --offline", file=sys.stderr)
        return 2
    trace = run_trace()
    bundle_path = write_bundle(trace, Path(args.output_dir), args.signing_key.encode("utf-8"))
    print(f"signed evidence bundle: {bundle_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
