"""Advisor gate for minor-facing career narration."""

from __future__ import annotations

from typing import List, Literal, Union
from uuid import uuid4

from pydantic import Field

from src.learning.models import CareerPlan, LanguageAndProvenanceModel, Provenance


class AdvisorDecision(LanguageAndProvenanceModel):
    decision_id: str = Field(default_factory=lambda: f"advisor-decision-{uuid4().hex[:12]}")
    allowed: bool
    risk_level: Literal["allow", "review", "refuse"]
    reasons: List[str] = Field(default_factory=list)
    typed_refusal: str | None = None
    safe_for_under_16: bool = True


class CareerNarration(LanguageAndProvenanceModel):
    narration_id: str = Field(default_factory=lambda: f"career-narration-{uuid4().hex[:12]}")
    plan_id: str = Field(min_length=1)
    student_id: str = Field(min_length=1)
    audience: Literal["student", "parent", "counsellor"]
    text: str = Field(min_length=1)
    advisor_decision: AdvisorDecision


class CareerRefusal(LanguageAndProvenanceModel):
    refusal_id: str = Field(default_factory=lambda: f"career-refusal-{uuid4().hex[:12]}")
    plan_id: str = Field(min_length=1)
    student_id: str = Field(min_length=1)
    audience: Literal["student", "parent", "counsellor"]
    typed_refusal: str = Field(min_length=1)
    advisor_decision: AdvisorDecision


class OrchestratorAdvisor:
    """Deterministic local stand-in for the Orchestrator + Advisor pattern."""

    unsafe_terms = ("drop out", "guarantee", "hide this", "secret", "loan shark")

    def review(self, plan: CareerPlan, audience: Literal["student", "parent", "counsellor"], student_age: int, prompt: str) -> AdvisorDecision:
        provenance = list(plan.provenance) + [
            Provenance(
                source="OrchestratorAdvisor",
                rule_id="phase_3_minor_career_safety_gate",
                confidence=1.0,
                evidence_count=len(plan.pathways),
            )
        ]
        lowered_prompt = prompt.lower()
        reasons: List[str] = []
        if any(term in lowered_prompt for term in self.unsafe_terms):
            reasons.append("unsafe_or_off_policy_request")
        if audience == "student" and student_age < 16 and plan.requires_counsellor_signoff:
            reasons.append("under_16_requires_counsellor_signoff")
        if not all(pathway.wage_band.source and pathway.demand_trend.source for pathway in plan.pathways):
            reasons.append("ungrounded_pathway_signal")

        if reasons:
            return AdvisorDecision(
                allowed=False,
                risk_level="refuse",
                reasons=reasons,
                typed_refusal="A counsellor must review this career explanation before it is shown to the learner.",
                safe_for_under_16=False,
                lang=plan.lang,
                provenance=provenance,
            )

        return AdvisorDecision(
            allowed=True,
            risk_level="allow",
            reasons=["grounded_age_appropriate_and_no_pii"],
            safe_for_under_16=True,
            lang=plan.lang,
            provenance=provenance,
        )

    def render(
        self,
        plan: CareerPlan,
        audience: Literal["student", "parent", "counsellor"],
        student_age: int,
        prompt: str,
    ) -> Union[CareerNarration, CareerRefusal]:
        decision = self.review(plan, audience, student_age, prompt)
        if not decision.allowed:
            return CareerRefusal(
                plan_id=plan.plan_id,
                student_id=plan.student_id,
                audience=audience,
                typed_refusal=decision.typed_refusal or "Career narration is queued for counsellor review.",
                advisor_decision=decision,
                lang=plan.lang,
                provenance=decision.provenance,
            )
        top_pathway = plan.pathways[0]
        return CareerNarration(
            plan_id=plan.plan_id,
            student_id=plan.student_id,
            audience=audience,
            text=(
                f"{top_pathway.title} is the strongest sourced pathway. "
                f"Wage band source: {top_pathway.wage_band.source}; "
                f"demand source: {top_pathway.demand_trend.source}."
            ),
            advisor_decision=decision,
            lang=plan.lang,
            provenance=decision.provenance,
        )
