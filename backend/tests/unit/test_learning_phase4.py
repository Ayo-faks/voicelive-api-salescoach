from pathlib import Path
import importlib.util

from src.learning.operations import (
    build_cost_dashboard,
    compute_kpi_report,
    evaluate_canary,
    load_adversarial_probes,
    load_canary_inputs,
    load_metric_snapshots,
)


REPO_ROOT = Path(__file__).resolve().parents[3]
OPS_PATH = REPO_ROOT / "data" / "learning" / "ops"
METRICS_PATH = OPS_PATH / "phase_4_pilot_metrics.json"
CANARY_PATH = OPS_PATH / "phase_4_canary.json"
PROBES_PATH = OPS_PATH / "phase_4_weekly_adversarial_probes.json"
TRACE_PATH = REPO_ROOT / "scripts" / "trace_evidence_phase_4.py"


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_phase_4_kpi_report_computes_pilot_contract_metrics():
    snapshots = load_metric_snapshots(METRICS_PATH, "tenant-phase-4")

    report = compute_kpi_report(snapshots, "tenant-phase-4")

    assert report.week_count == 4
    assert report.diagnostic_completion_rate >= 0.85
    assert report.approved_intervention_rate >= 0.6
    assert report.provenance_coverage == 1.0
    assert report.safety_rate >= 0.99
    assert report.dsr_turnaround_rate == 1.0
    assert report.cost_per_student_gbp <= 0.8
    assert report.meets_pilot_thresholds is True
    assert report.provenance[0].rule_id == "pilot_kpi_rollup"


def test_phase_4_canary_triggers_auto_rollback_on_guardrail_regression():
    config, observation = load_canary_inputs(CANARY_PATH, "tenant-phase-4")

    decision = evaluate_canary(config, observation)

    assert decision.should_rollback is True
    assert "safety_rate_min" in decision.triggered_rules
    assert "unsupported_claim_rate_max" in decision.triggered_rules
    assert decision.flag_changes["flag.ai_suggestions.tenant-phase-4"] == "deterministic_only"
    assert decision.provenance[-1].rule_id == "auto_rollback_guardrail"


def test_phase_4_pilot_weekly_adversarial_probe_set_covers_12_weeks():
    probes = load_adversarial_probes(PROBES_PATH, "tenant-phase-4")

    assert len(probes) == 12
    assert {probe.week for probe in probes} == set(range(1, 13))
    assert {"safeguarding", "privacy", "rollback"}.issubset({probe.category for probe in probes})
    assert all(probe.provenance for probe in probes)


def test_phase_4_cost_dashboard_uses_active_students_and_weekly_costs():
    snapshots = load_metric_snapshots(METRICS_PATH, "tenant-phase-4")
    report = compute_kpi_report(snapshots, "tenant-phase-4")

    dashboard = build_cost_dashboard(report, snapshots)

    assert dashboard["active_students"] == 300
    assert dashboard["cost_per_student_gbp"] == report.cost_per_student_gbp
    assert len(dashboard["weekly_costs"]) == 4


def test_phase_4_pilot_trace_runs_offline_with_kpis_dpo_export_and_rollback():
    trace_module = load_module(TRACE_PATH, "phase_4_trace")

    trace = trace_module.run_trace("tenant-phase-4")

    assert trace["phase"] == 4
    assert trace["offline"] is True
    assert trace["kpi_report"]["meets_pilot_thresholds"] is True
    assert trace["canary_decision"]["should_rollback"] is True
    assert trace["weekly_adversarial_probe_count"] == 12
    assert trace["dpo_export"]["contains_raw_student_response_text"] is False
    assert trace["cost_dashboard"]["cost_per_student_gbp"] <= 0.8
