from pathlib import Path
import importlib.util

from src.common.labour_market import LabourMarketLoader
from src.learning.career import CareerNarration, CareerRefusal, DeterministicCareerPlanner, OrchestratorAdvisor
from src.learning.multilingual import load_language_eval_slice, load_yoruba_content_pack
from src.learning.models import Provenance
from src.learning.planner import PlannerRequest
from src.learning.repository import InMemoryLearningRepository
from src.learning.voice import FlaskSockVoiceTransportAdapter, VoiceFrame
from src.learning.xapi import CareerPlanEvent, career_plan_event_to_xapi


REPO_ROOT = Path(__file__).resolve().parents[3]
YORUBA_PACK_PATH = REPO_ROOT / "data" / "learning" / "content_packs" / "yoruba_phase_3.json"
YORUBA_EVAL_PATH = REPO_ROOT / "data" / "learning" / "evals" / "yoruba_native_rater_phase_3.json"
LABOUR_MARKET_PATH = REPO_ROOT / "data" / "learning" / "career" / "labour_market_phase_3.json"
TRACE_PATH = REPO_ROOT / "scripts" / "trace_evidence_phase_3.py"


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _request() -> PlannerRequest:
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
        provenance=[Provenance(source="phase_3_test", rule_id="planner_request", confidence=1.0, evidence_count=1)],
    )


def test_phase_3_multilingual_yoruba_pack_and_native_rater_manifest_meet_contract_thresholds():
    pack = load_yoruba_content_pack(YORUBA_PACK_PATH)
    eval_slice = load_language_eval_slice(YORUBA_EVAL_PATH)

    assert pack.lang == "yo-NG"
    assert pack.sha256
    assert pack.provenance[0].source == "pathfinder_phase_3_yoruba_content_pack"
    assert eval_slice.lang == "yo-NG"
    assert eval_slice.case_count >= 200
    assert eval_slice.cohens_kappa >= 0.7
    assert eval_slice.provenance[0].evidence_count == 200


def test_phase_3_career_planner_renders_deterministic_sourced_pathways():
    dataset = LabourMarketLoader().load(LABOUR_MARKET_PATH)
    result = DeterministicCareerPlanner(dataset.records).run_turn(_request())

    assert result.queued is True
    assert result.offline_fallback == "deterministic_career_ranker"
    assert result.plan.student_id == "student-tola"
    assert result.plan.requires_counsellor_signoff is True
    assert result.plan.pathways[0].pathway_id == "data-analyst-ng"
    assert all(pathway.wage_band.source for pathway in result.plan.pathways)
    assert all(pathway.demand_trend.recency for pathway in result.plan.pathways)
    assert result.provenance[-1].rule_id == "phase_3_weighted_mastery_labour_market_ranker"


def test_phase_3_orchestrator_advisor_refuses_under_16_student_narration_but_allows_counsellor_view():
    dataset = LabourMarketLoader().load(LABOUR_MARKET_PATH)
    plan = DeterministicCareerPlanner(dataset.records).run_turn(_request()).plan
    advisor = OrchestratorAdvisor()

    student_result = advisor.render(plan, audience="student", student_age=14, prompt="Explain my career card")
    counsellor_result = advisor.render(
        plan, audience="counsellor", student_age=14, prompt="Explain sourced career card"
    )

    assert isinstance(student_result, CareerRefusal)
    assert student_result.advisor_decision.allowed is False
    assert "under_16_requires_counsellor_signoff" in student_result.advisor_decision.reasons
    assert isinstance(counsellor_result, CareerNarration)
    assert counsellor_result.advisor_decision.allowed is True
    assert "Wage band source" in counsellor_result.text
    assert counsellor_result.provenance


def test_phase_3_multilingual_voice_adapter_queues_yoruba_frame_for_offline_replay():
    repository = InMemoryLearningRepository()
    frame = VoiceFrame(
        tenant_id="tenant-phase-3",
        actor_id="student-tola",
        mode="text",
        payload="Ise wo ni o ba ogbon mi mu",
        lang="yo-NG",
        provenance=[
            Provenance(source="phase_3_voice_test", rule_id="yoruba_text_path", confidence=1.0, evidence_count=1)
        ],
    )

    result = FlaskSockVoiceTransportAdapter().handle_offline_frame(frame, repository)

    assert result.accepted is True
    assert result.queued is True
    assert result.lang == "yo-NG"
    assert result.offline_fallback == "queued_multilingual_voice_frame"
    assert repository.offline_queue[0]["event_type"] == "learning.voice_frame"


def test_phase_3_career_plan_event_is_xapi_expressible_with_lang_and_provenance():
    dataset = LabourMarketLoader().load(LABOUR_MARKET_PATH)
    plan = DeterministicCareerPlanner(dataset.records).run_turn(_request()).plan
    event = CareerPlanEvent(
        tenant_id="tenant-phase-3",
        actor_id="counsellor-ade",
        student_id=plan.student_id,
        plan_id=plan.plan_id,
        pathway_count=len(plan.pathways),
        lang=plan.lang,
        provenance=plan.provenance,
    )

    statement = career_plan_event_to_xapi(event)

    assert statement.verb["id"].endswith("shortlisted-career-pathways")
    assert statement.context["extensions"]["https://pathfinder.learn/extensions/lang"] == "en-NG"
    assert statement.result["extensions"]["https://pathfinder.learn/extensions/pathway_count"] == len(plan.pathways)
    assert statement.result["extensions"]["https://pathfinder.learn/extensions/pathway_count"] >= 3


def test_phase_3_career_multilingual_trace_runs_offline_with_refusal_and_xapi():
    trace_module = load_module(TRACE_PATH, "phase_3_trace")

    trace = trace_module.run_trace()

    assert trace["phase"] == 3
    assert trace["offline"] is True
    assert trace["language_eval"]["case_count"] >= 200
    assert trace["language_eval"]["cohens_kappa"] >= 0.7
    assert trace["career_red_team"]["safety_rate"] >= 0.99
    assert trace["advisor"]["student_result"]["advisor_decision"]["allowed"] is False
    assert trace["advisor"]["counsellor_result"]["advisor_decision"]["allowed"] is True
    assert trace["voice_queue"]["queued"] is True
    assert trace["repository_counts"]["xapi_statements"] == 1
