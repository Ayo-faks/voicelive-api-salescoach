"""Deterministic Career Navigator planner for Phase 3."""

from __future__ import annotations

from typing import Dict, Iterable

from src.common.labour_market import LabourMarketRecord
from src.learning.models import CareerPathway, CareerPathwaySkill, CareerPlan, Provenance
from src.learning.planner import PlannerRequest, PlannerResult


# A skill the learner has actually practised but estimates below this mastery
# probability is treated as a closeable "gap" the pathway depends on.
GAP_MASTERY_THRESHOLD = 0.6
# Neutral prior used when the learner has no estimate for a weighted skill yet.
NEUTRAL_MASTERY_PRIOR = 0.5


class DeterministicCareerPlanner:
    offline_fallback = "deterministic_career_ranker"

    def __init__(self, records: Iterable[LabourMarketRecord]) -> None:
        self.records = list(records)

    def run_turn(self, request: PlannerRequest) -> PlannerResult[CareerPlan]:
        mastery_profile = _normalise_mastery_profile(request.scope.get("mastery_profile", {}))
        student_id = str(request.scope.get("student_id") or request.actor_id)
        career_consent = bool(request.scope.get("career_consent", False))
        ranked_pathways = sorted(
            [self._to_pathway(record, mastery_profile, career_consent) for record in self.records],
            key=lambda pathway: pathway.fit_score,
            reverse=True,
        )
        provenance = list(request.provenance) + [
            Provenance(
                source="DeterministicCareerPlanner",
                rule_id="phase_3_weighted_mastery_labour_market_ranker",
                confidence=1.0,
                evidence_count=len(ranked_pathways),
                metadata={"career_consent": career_consent},
            )
        ]
        plan = CareerPlan(
            student_id=student_id,
            pathways=ranked_pathways,
            requires_counsellor_signoff=True,
            lang=request.lang,
            provenance=provenance,
        )
        return PlannerResult[CareerPlan](
            plan=plan,
            lang=request.lang,
            provenance=provenance,
            tool_calls_count=0,
            queued=request.offline,
            offline_fallback=self.offline_fallback if request.offline else None,
        )

    def _to_pathway(
        self, record: LabourMarketRecord, mastery_profile: Dict[str, float], career_consent: bool
    ) -> CareerPathway:
        mastery_fit = 0.0
        total_weight = sum(record.skill_weights.values()) or 1.0
        skills: list[CareerPathwaySkill] = []
        for skill_id, weight in record.skill_weights.items():
            has_estimate = skill_id in mastery_profile
            mastery = mastery_profile.get(skill_id, NEUTRAL_MASTERY_PRIOR)
            mastery_fit += mastery * weight
            skills.append(
                CareerPathwaySkill(
                    skill_id=skill_id,
                    weight=round(float(weight), 4),
                    mastery=round(float(mastery), 4),
                    is_gap=has_estimate and mastery < GAP_MASTERY_THRESHOLD,
                )
            )
        skills.sort(key=lambda skill: skill.weight, reverse=True)
        demand_value = record.demand_trend.value.get("score", 0.5)
        demand_score = float(demand_value) if isinstance(demand_value, (int, float)) else 0.5
        consent_multiplier = 1.0 if career_consent else 0.75
        fit_score = min(1.0, ((mastery_fit / total_weight) * 0.7 + demand_score * 0.3) * consent_multiplier)
        return CareerPathway(
            pathway_id=record.pathway_id,
            title=record.title,
            fit_score=round(fit_score, 4),
            wage_band=record.wage_band,
            demand_trend=record.demand_trend,
            rationale="Ranked from mastery profile, wage band, demand trend, source recency, and consent state.",
            skills=skills,
        )


def _normalise_mastery_profile(raw_profile: object) -> Dict[str, float]:
    if not isinstance(raw_profile, dict):
        return {}
    profile: Dict[str, float] = {}
    for skill_id, value in raw_profile.items():
        if isinstance(value, dict):
            probability = value.get("probability", 0.5)
        else:
            probability = value
        if isinstance(probability, (int, float)):
            profile[str(skill_id)] = min(1.0, max(0.0, float(probability)))
    return profile
