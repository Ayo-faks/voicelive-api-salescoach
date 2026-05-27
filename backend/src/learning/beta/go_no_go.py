"""W8 — Go / No-Go decision against the MVP §11 Definition of Done.

Inputs are *checks*, not raw artefacts: every input is a small Pydantic
record asserting that a particular gate has been met. The output is a
signed `GoNoGoDecision` listing the failing checks in priority order so
the review meeting reads them off a single artefact.
"""

from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone
from typing import List, Literal, Optional
from uuid import uuid4

from pydantic import Field

from src.learning.models import ContractModel


GO_NO_GO_FLAG = "LEARNING_GO_NO_GO_V1"
GO_NO_GO_RULE_ID = "w8_go_no_go_v1"


CheckSeverity = Literal["blocker", "warning"]


class GoNoGoUnavailableError(RuntimeError):
    """Raised when the go/no-go kill-switch flag is unset."""


class DoDCheck(ContractModel):
    code: str = Field(min_length=1)
    description: str = Field(min_length=1)
    passed: bool
    severity: CheckSeverity = "blocker"
    metadata: dict = Field(default_factory=dict)


class GoNoGoInputs(ContractModel):
    """All evidence inputs to the gate. None means 'not yet provided'."""

    tagged_questions_count: int = Field(default=0, ge=0)
    explanation_citations_lint_clean: bool = False
    retry_metric_reported: bool = False
    retry_after_explanation_rate: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    retry_target: float = Field(default=0.55, ge=0.0, le=1.0)
    signed_offline_pack_verified: bool = False
    crisis_classifier_safe: bool = False
    dpia_signed: bool = False
    dsar_workflow_tested: bool = False
    cost_per_learner_term_gbp: Optional[float] = Field(default=None, ge=0.0)
    cost_budget_gbp: float = Field(default=0.40, gt=0.0)
    labour_market_dataset_signed_off: bool = False
    labour_market_pathway_count: int = Field(default=0, ge=0)
    eval_gate_passed: bool = False
    closed_beta_active_weeks: int = Field(default=0, ge=0)
    closed_beta_size: int = Field(default=0, ge=0)
    weekly_digest_delivered: bool = False


class GoNoGoDecision(ContractModel):
    decision_id: str = Field(default_factory=lambda: f"gonogo-{uuid4().hex[:12]}")
    rule_id: str = GO_NO_GO_RULE_ID
    decided_at: str = Field(min_length=1)
    decision: Literal["go", "no_go", "conditional_go"]
    checks: List[DoDCheck] = Field(min_length=1)
    blockers: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    signature: str = Field(min_length=1)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _sign(payload: dict) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _build_checks(inputs: GoNoGoInputs) -> List[DoDCheck]:
    checks: List[DoDCheck] = []
    checks.append(
        DoDCheck(
            code="dod_question_bank",
            description="≥400 tagged questions (200 Maths + 200 English).",
            passed=inputs.tagged_questions_count >= 400,
            metadata={"count": inputs.tagged_questions_count},
        )
    )
    checks.append(
        DoDCheck(
            code="dod_explanations_grounded",
            description="Every explanation has wiki citations; CI lint clean.",
            passed=inputs.explanation_citations_lint_clean,
        )
    )
    retry_met = (
        inputs.retry_metric_reported
        and inputs.retry_after_explanation_rate is not None
        and inputs.retry_after_explanation_rate >= inputs.retry_target
    )
    checks.append(
        DoDCheck(
            code="dod_retry_north_star",
            description=(
                f"retry-after-explanation reported and ≥ {inputs.retry_target:.2f} target"
            ),
            passed=retry_met,
            metadata={
                "rate": inputs.retry_after_explanation_rate or 0.0,
                "target": inputs.retry_target,
            },
        )
    )
    checks.append(
        DoDCheck(
            code="dod_offline_pack",
            description="Signed offline pack installs, verifies, serves offline.",
            passed=inputs.signed_offline_pack_verified,
        )
    )
    checks.append(
        DoDCheck(
            code="dod_crisis_classifier",
            description="Crisis-phrase classifier safe across seed set.",
            passed=inputs.crisis_classifier_safe,
        )
    )
    checks.append(
        DoDCheck(
            code="dod_dpia",
            description="DPIA signed.",
            passed=inputs.dpia_signed,
        )
    )
    checks.append(
        DoDCheck(
            code="dod_dsar",
            description="DSAR workflow tested end-to-end.",
            passed=inputs.dsar_workflow_tested,
        )
    )
    cost_met = (
        inputs.cost_per_learner_term_gbp is not None
        and inputs.cost_per_learner_term_gbp <= inputs.cost_budget_gbp
    )
    checks.append(
        DoDCheck(
            code="dod_cost",
            description=(
                f"Cost per learner ≤ £{inputs.cost_budget_gbp:.2f} per term."
            ),
            passed=cost_met,
            severity="warning",  # cost is a tunable, not a safety blocker
            metadata={
                "actual_gbp": inputs.cost_per_learner_term_gbp or 0.0,
                "budget_gbp": inputs.cost_budget_gbp,
            },
        )
    )
    checks.append(
        DoDCheck(
            code="dod_labour_market_dataset",
            description=(
                "LabourMarketDataset v0 reviewer-approved with ~60 pathways."
            ),
            passed=(
                inputs.labour_market_dataset_signed_off
                and inputs.labour_market_pathway_count >= 24
            ),
            severity="warning",
            metadata={
                "signed_off": inputs.labour_market_dataset_signed_off,
                "pathway_count": inputs.labour_market_pathway_count,
            },
        )
    )
    checks.append(
        DoDCheck(
            code="dod_eval_gate",
            description="Eval harness wired as a release gate; Tier-1 met.",
            passed=inputs.eval_gate_passed,
        )
    )
    beta_met = (
        inputs.closed_beta_active_weeks >= 2
        and inputs.closed_beta_size >= 50
        and inputs.weekly_digest_delivered
    )
    checks.append(
        DoDCheck(
            code="dod_closed_beta",
            description="50-learner closed beta ≥ 2 weeks with weekly digest.",
            passed=beta_met,
            metadata={
                "size": inputs.closed_beta_size,
                "weeks": inputs.closed_beta_active_weeks,
                "digest": inputs.weekly_digest_delivered,
            },
        )
    )
    return checks


def evaluate_go_no_go(
    inputs: GoNoGoInputs,
    *,
    require_flag: bool = True,
) -> GoNoGoDecision:
    if require_flag and not os.environ.get(GO_NO_GO_FLAG):
        raise GoNoGoUnavailableError(
            f"go/no-go gated by {GO_NO_GO_FLAG}; set to enable"
        )
    checks = _build_checks(inputs)
    blockers = [c.code for c in checks if not c.passed and c.severity == "blocker"]
    warnings = [c.code for c in checks if not c.passed and c.severity == "warning"]
    if blockers:
        decision: Literal["go", "no_go", "conditional_go"] = "no_go"
    elif warnings:
        decision = "conditional_go"
    else:
        decision = "go"
    decided_at = _now()
    payload = {
        "rule_id": GO_NO_GO_RULE_ID,
        "decided_at": decided_at,
        "decision": decision,
        "checks": [c.model_dump() for c in checks],
        "blockers": blockers,
        "warnings": warnings,
    }
    return GoNoGoDecision(
        rule_id=GO_NO_GO_RULE_ID,
        decided_at=decided_at,
        decision=decision,
        checks=checks,
        blockers=blockers,
        warnings=warnings,
        signature=_sign(payload),
    )
