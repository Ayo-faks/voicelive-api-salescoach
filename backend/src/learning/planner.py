"""Planner contracts for Pathfinder Learn.

The protocol deliberately mirrors ``InsightsPlanner``: the planner is
stateless, bounded, and persistence stays with the caller.
"""

from __future__ import annotations

from typing import Any, Dict, Generic, List, Optional, Protocol, TypeVar
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, model_validator

from src.learning.models import InterventionPlan, LanguageAndProvenanceModel, Provenance
from src.services.insights_service import DEFAULT_TOOL_CALL_BUDGET, DEFAULT_WALL_CLOCK_BUDGET_SECONDS


TPlan = TypeVar("TPlan")


class PlannerRequest(LanguageAndProvenanceModel):
    request_id: str = Field(default_factory=lambda: f"learning-request-{uuid4().hex[:12]}")
    tenant_id: str = Field(min_length=1)
    actor_id: str = Field(min_length=1)
    role: str = Field(min_length=1)
    prompt: str = Field(min_length=1)
    scope: Dict[str, Any] = Field(default_factory=dict)
    offline: bool = False
    tool_call_budget: int = Field(default=DEFAULT_TOOL_CALL_BUDGET, ge=1)
    wall_clock_budget_seconds: float = Field(default=DEFAULT_WALL_CLOCK_BUDGET_SECONDS, gt=0.0)


class PlannerResult(BaseModel, Generic[TPlan]):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    plan: TPlan
    lang: str = Field(pattern=r"^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$")
    provenance: List[Provenance] = Field(min_length=1)
    tool_calls_count: int = Field(default=0, ge=0)
    queued: bool = False
    offline_fallback: Optional[str] = None
    error_text: Optional[str] = None

    @model_validator(mode="after")
    def queued_results_need_fallback(self) -> "PlannerResult[TPlan]":
        if self.queued and not self.offline_fallback:
            raise ValueError("queued planner results must name the offline fallback")
        return self


class LearningPlanner(Protocol):
    def run_turn(self, request: PlannerRequest) -> PlannerResult[InterventionPlan]: ...


class CareerPlanner(Protocol):
    def run_turn(self, request: PlannerRequest) -> PlannerResult[Any]: ...


class StubLearningPlanner:
    """Deterministic offline planner used by tests and trace evidence."""

    offline_fallback = "deterministic_intervention_stub"

    def run_turn(self, request: PlannerRequest) -> PlannerResult[InterventionPlan]:
        skill_ids = request.scope.get("skill_ids") if isinstance(request.scope, dict) else None
        student_ids = request.scope.get("student_ids") if isinstance(request.scope, dict) else None
        target_skill_ids = [str(value) for value in (skill_ids or ["ratio"])]
        target_student_ids = [str(value) for value in (student_ids or [request.actor_id])]
        provenance = list(request.provenance) + [
            Provenance(
                source="StubLearningPlanner",
                rule_id="offline_deterministic_intervention",
                confidence=1.0,
                evidence_count=len(target_student_ids),
            )
        ]
        plan = InterventionPlan(
            lang=request.lang,
            provenance=provenance,
            target_skill_ids=target_skill_ids,
            target_student_ids=target_student_ids,
            item_types=["reteach", "guided_practice"],
            suggested_resources=["ratio-mini-lesson"],
            rationale="Synthetic Phase 0 intervention generated without a cloud call.",
        )
        return PlannerResult[InterventionPlan](
            plan=plan,
            lang=request.lang,
            provenance=provenance,
            tool_calls_count=0,
            queued=False,
            offline_fallback=self.offline_fallback,
        )