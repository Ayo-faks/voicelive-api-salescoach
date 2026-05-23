"""Mastery estimator contracts and Phase 0 implementations."""

from __future__ import annotations

import math
from typing import Optional, Protocol

from pydantic import Field

from src.learning.models import LanguageAndProvenanceModel, MasteryEstimate, Provenance


class MasteryUpdateInput(LanguageAndProvenanceModel):
    tenant_id: str = Field(min_length=1)
    student_id: str = Field(min_length=1)
    skill_id: str = Field(min_length=1)
    correct: bool
    prior_estimate: Optional[MasteryEstimate] = None
    item_difficulty: float = Field(default=0.0, ge=-5.0, le=5.0)


class MasteryUpdateResult(LanguageAndProvenanceModel):
    tenant_id: str = Field(min_length=1)
    student_id: str = Field(min_length=1)
    skill_id: str = Field(min_length=1)
    estimate: MasteryEstimate
    evidence_count: int = Field(ge=1)


class MasteryEstimator(Protocol):
    offline_fallback_available: bool

    def update(self, update_input: MasteryUpdateInput) -> MasteryUpdateResult: ...


class BetaBKT:
    """Small offline Beta-BKT estimator for Phase 0 evidence runs."""

    offline_fallback_available = True

    def update(self, update_input: MasteryUpdateInput) -> MasteryUpdateResult:
        prior = update_input.prior_estimate
        a = float(prior.a if prior and prior.kind == "beta" and prior.a is not None else 1.0)
        b = float(prior.b if prior and prior.kind == "beta" and prior.b is not None else 1.0)
        if update_input.correct:
            a += 1.0
        else:
            b += 1.0
        probability = a / (a + b)
        variance = (a * b) / (((a + b) ** 2) * (a + b + 1.0))
        uncertainty = min(1.0, math.sqrt(variance) * 4.0)
        provenance = list(update_input.provenance) + [
            Provenance(
                source="BetaBKT",
                rule_id="beta_increment_correctness",
                confidence=1.0,
                evidence_count=1,
            )
        ]
        return MasteryUpdateResult(
            tenant_id=update_input.tenant_id,
            student_id=update_input.student_id,
            skill_id=update_input.skill_id,
            lang=update_input.lang,
            provenance=provenance,
            estimate=MasteryEstimate(kind="beta", a=a, b=b, probability=probability, uncertainty=uncertainty),
            evidence_count=1,
        )


class Elo:
    """Alternate estimator behind the same protocol."""

    offline_fallback_available = True

    def __init__(self, k_factor: float = 32.0) -> None:
        self.k_factor = float(k_factor)

    def update(self, update_input: MasteryUpdateInput) -> MasteryUpdateResult:
        prior = update_input.prior_estimate
        rating = float(prior.rating if prior and prior.kind == "elo" and prior.rating is not None else 1000.0)
        deviation = float(prior.deviation if prior and prior.kind == "elo" and prior.deviation is not None else 350.0)
        difficulty_rating = 1000.0 + (update_input.item_difficulty * 100.0)
        expected = 1.0 / (1.0 + (10.0 ** ((difficulty_rating - rating) / 400.0)))
        actual = 1.0 if update_input.correct else 0.0
        rating += self.k_factor * (actual - expected)
        deviation = max(50.0, deviation * 0.95)
        probability = 1.0 / (1.0 + (10.0 ** ((difficulty_rating - rating) / 400.0)))
        uncertainty = min(1.0, deviation / 400.0)
        provenance = list(update_input.provenance) + [
            Provenance(source="Elo", rule_id="elo_k_factor_update", confidence=1.0, evidence_count=1)
        ]
        return MasteryUpdateResult(
            tenant_id=update_input.tenant_id,
            student_id=update_input.student_id,
            skill_id=update_input.skill_id,
            lang=update_input.lang,
            provenance=provenance,
            estimate=MasteryEstimate(kind="elo", rating=rating, deviation=deviation, probability=probability, uncertainty=uncertainty),
            evidence_count=1,
        )