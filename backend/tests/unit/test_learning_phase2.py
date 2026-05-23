from pathlib import Path
import importlib.util

from src.learning.diagnostic import DiagnosticAnswer, DiagnosticEngine, DeterministicItemSelector, load_item_bank
from src.learning.repository import InMemoryLearningRepository


REPO_ROOT = Path(__file__).resolve().parents[3]
ITEM_BANK_PATH = REPO_ROOT / "data" / "learning" / "jss2_maths_diagnostic_phase_2.json"
TRACE_PATH = REPO_ROOT / "scripts" / "trace_evidence_phase_2.py"


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_phase_2_item_bank_has_jss2_shape_and_required_provenance():
    item_bank = load_item_bank(ITEM_BANK_PATH)

    assert item_bank.diagnostic_id == "jss2-maths-phase-2"
    assert item_bank.lang == "en-NG"
    assert len(item_bank.skills) == 4
    assert len(item_bank.items) == 50
    assert all(item.provenance for item in item_bank.items)


def test_phase_2_selector_balances_the_first_round_across_four_skills():
    item_bank = load_item_bank(ITEM_BANK_PATH)

    selected = DeterministicItemSelector().select_items(item_bank, prior_mastery={}, limit=8)

    assert [item.skill_id for item in selected[:4]] == [
        "ratio-proportion",
        "fraction-operations",
        "linear-equations",
        "plane-geometry",
    ]
    assert len({item.item_id for item in selected}) == 8


def test_phase_2_offline_diagnostic_persists_mastery_xapi_and_pending_plan():
    item_bank = load_item_bank(ITEM_BANK_PATH)
    repository = InMemoryLearningRepository()
    result = DiagnosticEngine(repository).run_offline(
        item_bank=item_bank,
        tenant_id="tenant-phase-2",
        class_id="jss2-blue",
        student_id="student-ade",
        teacher_id="teacher-bola",
        answers=[DiagnosticAnswer(item_id="jss2-linear-007", response_text="5")],
    )

    assert result.session.status == "completed"
    assert len(result.responses) == 50
    assert len(result.mastery_events) == 50
    assert len(result.xapi_statements) == 51
    assert len(repository.student_responses) == 50
    assert len(repository.mastery_events) == 50
    assert len(repository.xapi_statements) == 51
    assert repository.intervention_plans[0]["status"] == "pending"
    assert result.pending_plan.requires_approval is True
    assert sorted(result.pending_plan.target_skill_ids) == sorted(skill.skill_id for skill in item_bank.skills)
    assert len(result.heatmap.cells) == 4
    assert all(cell.provenance for cell in result.heatmap.cells)
    assert any(not response.correct for response in result.responses)


def test_phase_2_heatmap_surfaces_mastery_statuses_with_provenance():
    item_bank = load_item_bank(ITEM_BANK_PATH)
    repository = InMemoryLearningRepository()
    result = DiagnosticEngine(repository).run_offline(
        item_bank=item_bank,
        tenant_id="tenant-phase-2",
        class_id="jss2-blue",
        student_id="student-ade",
        teacher_id="teacher-bola",
        target_item_count=12,
    )

    cell_by_skill = {cell.skill_id: cell for cell in result.heatmap.cells}
    assert set(cell_by_skill) == {"fraction-operations", "linear-equations", "plane-geometry", "ratio-proportion"}
    assert all(cell.status in {"secure", "developing", "needs_support"} for cell in cell_by_skill.values())
    assert all(cell.lang == "en-NG" for cell in cell_by_skill.values())
    assert all(cell.provenance[0].source == "pathfinder_phase_2_fixture" for cell in cell_by_skill.values())


def test_phase_2_trace_runs_offline_with_pending_then_approved_hitl_flow():
    trace_module = load_module(TRACE_PATH, "phase_2_trace")

    trace = trace_module.run_trace()

    assert trace["phase"] == 2
    assert trace["offline"] is True
    assert trace["diagnostic"]["item_count"] == 50
    assert trace["diagnostic"]["response_count"] == 50
    assert trace["pending_plan_before_approval"]["status"] == "pending"
    assert trace["pending_plan_before_approval"]["provenance_footer_count"] >= 1
    assert trace["approval_record"]["action"] == "approved"
    assert trace["repository_counts"]["xapi_statements"] == 52
