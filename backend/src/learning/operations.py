"""Pilot operations contracts for Pathfinder Learn Phase 4."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

from pydantic import Field

from src.learning.models import ContractModel, LanguageAndProvenanceModel, Provenance


class PilotMetricSnapshot(LanguageAndProvenanceModel):
    tenant_id: str = Field(min_length=1)
    week: int = Field(ge=1, le=12)
    assigned_diagnostics: int = Field(ge=0)
    completed_diagnostics: int = Field(ge=0)
    suggestions_created: int = Field(ge=0)
    suggestions_approved: int = Field(ge=0)
    suggestions_with_provenance: int = Field(ge=0)
    safety_eval_cases: int = Field(ge=0)
    safety_eval_passed: int = Field(ge=0)
    dsr_requests: int = Field(ge=0)
    dsr_within_sla: int = Field(ge=0)
    active_students: int = Field(ge=1)
    total_cost_gbp: float = Field(ge=0.0)


class PilotKPIReport(LanguageAndProvenanceModel):
    tenant_id: str = Field(min_length=1)
    week_count: int = Field(ge=1)
    diagnostic_completion_rate: float = Field(ge=0.0, le=1.0)
    approved_intervention_rate: float = Field(ge=0.0, le=1.0)
    provenance_coverage: float = Field(ge=0.0, le=1.0)
    safety_rate: float = Field(ge=0.0, le=1.0)
    dsr_turnaround_rate: float = Field(ge=0.0, le=1.0)
    cost_per_student_gbp: float = Field(ge=0.0)
    meets_pilot_thresholds: bool


class CanaryConfig(ContractModel):
    tenant_id: str = Field(min_length=1)
    release_id: str = Field(min_length=1)
    canary_percent: int = Field(ge=1, le=100)
    thresholds: Dict[str, float] = Field(min_length=1)
    rollback_flags: Dict[str, str] = Field(min_length=1)


class CanaryObservation(LanguageAndProvenanceModel):
    tenant_id: str = Field(min_length=1)
    release_id: str = Field(min_length=1)
    unsupported_claim_rate: float = Field(ge=0.0, le=1.0)
    safety_rate: float = Field(ge=0.0, le=1.0)
    p95_latency_ms: int = Field(ge=0)
    cost_per_student_gbp: float = Field(ge=0.0)
    provenance_coverage: float = Field(ge=0.0, le=1.0)


class RollbackDecision(LanguageAndProvenanceModel):
    tenant_id: str = Field(min_length=1)
    release_id: str = Field(min_length=1)
    should_rollback: bool
    triggered_rules: List[str] = Field(default_factory=list)
    flag_changes: Dict[str, str] = Field(default_factory=dict)


class AdversarialProbe(LanguageAndProvenanceModel):
    tenant_id: str = Field(min_length=1)
    week: int = Field(ge=1, le=12)
    probe_id: str = Field(min_length=1)
    category: str = Field(min_length=1)
    prompt: str = Field(min_length=1)
    expected_outcome: str = Field(min_length=1)


def load_metric_snapshots(path: Path, tenant_id: str) -> List[PilotMetricSnapshot]:
    with path.open(encoding="utf-8") as handle:
        payload = json.load(handle)
    snapshots = [PilotMetricSnapshot.model_validate(item) for item in payload["snapshots"]]
    return [snapshot for snapshot in snapshots if snapshot.tenant_id == tenant_id]


def load_canary_inputs(path: Path, tenant_id: str) -> tuple[CanaryConfig, CanaryObservation]:
    with path.open(encoding="utf-8") as handle:
        payload = json.load(handle)
    config = CanaryConfig.model_validate(payload["config"])
    observation = CanaryObservation.model_validate(payload["observation"])
    if config.tenant_id != tenant_id or observation.tenant_id != tenant_id:
        raise ValueError("canary fixture tenant mismatch")
    return config, observation


def load_adversarial_probes(path: Path, tenant_id: str) -> List[AdversarialProbe]:
    with path.open(encoding="utf-8") as handle:
        payload = json.load(handle)
    probes = [AdversarialProbe.model_validate(item) for item in payload["probes"]]
    return [probe for probe in probes if probe.tenant_id == tenant_id]


def compute_kpi_report(snapshots: List[PilotMetricSnapshot], tenant_id: str) -> PilotKPIReport:
    if not snapshots:
        raise ValueError("at least one pilot metric snapshot is required")
    provenance = [
        Provenance(
            source="phase_4_pilot_metrics_fixture",
            rule_id="pilot_kpi_rollup",
            confidence=1.0,
            evidence_count=len(snapshots),
        )
    ]
    diagnostic_completion_rate = _ratio(sum(item.completed_diagnostics for item in snapshots), sum(item.assigned_diagnostics for item in snapshots))
    approved_intervention_rate = _ratio(sum(item.suggestions_approved for item in snapshots), sum(item.suggestions_created for item in snapshots))
    provenance_coverage = _ratio(sum(item.suggestions_with_provenance for item in snapshots), sum(item.suggestions_created for item in snapshots))
    safety_rate = _ratio(sum(item.safety_eval_passed for item in snapshots), sum(item.safety_eval_cases for item in snapshots))
    dsr_turnaround_rate = _ratio(sum(item.dsr_within_sla for item in snapshots), sum(item.dsr_requests for item in snapshots))
    active_students = max(item.active_students for item in snapshots)
    cost_per_student_gbp = round(sum(item.total_cost_gbp for item in snapshots) / active_students, 4)
    meets_thresholds = (
        diagnostic_completion_rate >= 0.85
        and approved_intervention_rate >= 0.6
        and provenance_coverage >= 0.995
        and safety_rate >= 0.99
        and dsr_turnaround_rate >= 0.95
        and cost_per_student_gbp <= 0.8
    )
    return PilotKPIReport(
        tenant_id=tenant_id,
        week_count=len({item.week for item in snapshots}),
        diagnostic_completion_rate=diagnostic_completion_rate,
        approved_intervention_rate=approved_intervention_rate,
        provenance_coverage=provenance_coverage,
        safety_rate=safety_rate,
        dsr_turnaround_rate=dsr_turnaround_rate,
        cost_per_student_gbp=cost_per_student_gbp,
        meets_pilot_thresholds=meets_thresholds,
        lang="en-NG",
        provenance=provenance,
    )


def evaluate_canary(config: CanaryConfig, observation: CanaryObservation) -> RollbackDecision:
    triggered_rules: List[str] = []
    if observation.safety_rate < config.thresholds["safety_rate_min"]:
        triggered_rules.append("safety_rate_min")
    if observation.unsupported_claim_rate > config.thresholds["unsupported_claim_rate_max"]:
        triggered_rules.append("unsupported_claim_rate_max")
    if observation.p95_latency_ms > config.thresholds["p95_latency_ms_max"]:
        triggered_rules.append("p95_latency_ms_max")
    if observation.cost_per_student_gbp > config.thresholds["cost_per_student_gbp_max"]:
        triggered_rules.append("cost_per_student_gbp_max")
    if observation.provenance_coverage < config.thresholds["provenance_coverage_min"]:
        triggered_rules.append("provenance_coverage_min")

    provenance = list(observation.provenance) + [
        Provenance(
            source="phase_4_canary_config",
            rule_id="auto_rollback_guardrail",
            confidence=1.0,
            evidence_count=len(triggered_rules),
        )
    ]
    return RollbackDecision(
        tenant_id=config.tenant_id,
        release_id=config.release_id,
        should_rollback=bool(triggered_rules),
        triggered_rules=triggered_rules,
        flag_changes=config.rollback_flags if triggered_rules else {},
        lang=observation.lang,
        provenance=provenance,
    )


def build_board_report(report: PilotKPIReport, rollback: RollbackDecision) -> str:
    return "\n".join(
        [
            "# Pathfinder Learn Phase 4 Board Pack",
            "",
            f"Tenant: {report.tenant_id}",
            f"Weeks reported: {report.week_count}",
            f"Diagnostic completion: {report.diagnostic_completion_rate:.1%}",
            f"Approved intervention rate: {report.approved_intervention_rate:.1%}",
            f"Provenance coverage: {report.provenance_coverage:.1%}",
            f"Safety rate: {report.safety_rate:.1%}",
            f"DSR turnaround in SLA: {report.dsr_turnaround_rate:.1%}",
            f"Cost per student: GBP {report.cost_per_student_gbp:.2f}",
            f"Canary rollback: {'yes' if rollback.should_rollback else 'no'}",
            "",
        ]
    )


def build_dpo_export(report: PilotKPIReport, rollback: RollbackDecision, probes: List[AdversarialProbe]) -> str:
    return "\n".join(
        [
            "# Pathfinder Learn Phase 4 DPO Export",
            "",
            "Evidence classes: KPI rollup, canary guardrail decision, weekly adversarial probe manifest, cost dashboard, signed trace manifest.",
            f"Tenant: {report.tenant_id}",
            f"DSR turnaround in SLA: {report.dsr_turnaround_rate:.1%}",
            f"Weekly adversarial probes: {len(probes)}",
            f"Rollback flags prepared: {len(rollback.flag_changes)}",
            "Retention: signed bundle retained with pilot evidence and no raw student response text.",
            "",
        ]
    )


def build_cost_dashboard(report: PilotKPIReport, snapshots: List[PilotMetricSnapshot]) -> Dict[str, Any]:
    return {
        "tenant_id": report.tenant_id,
        "cost_per_student_gbp": report.cost_per_student_gbp,
        "total_cost_gbp": round(sum(item.total_cost_gbp for item in snapshots), 2),
        "active_students": max(item.active_students for item in snapshots),
        "weekly_costs": [
            {"week": item.week, "cost_gbp": item.total_cost_gbp, "active_students": item.active_students}
            for item in sorted(snapshots, key=lambda item: item.week)
        ],
    }


def _ratio(numerator: int, denominator: int) -> float:
    if denominator == 0:
        return 1.0
    return round(numerator / denominator, 4)
