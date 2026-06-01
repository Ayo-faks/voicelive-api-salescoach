"""Mastery estimator contracts and Phase 0 implementations."""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Optional, Protocol

from pydantic import Field

from src.learning.models import (
    DEFAULT_MASTERY_HALF_LIFE_DAYS,
    LanguageAndProvenanceModel,
    MasteryEstimate,
    Provenance,
    parse_iso_timestamp,
)

# Elo idle volatility: each idle day adds this much standard deviation (in
# rating points) back into the estimate, so confidence fades with time even
# when no new responses arrive. Capped by the 350-point prior deviation.
ELO_IDLE_VOLATILITY_PER_DAY = 20.0


def _elapsed_days(prior_as_of: Optional[str], now: datetime) -> float:
    """Non-negative whole-and-fractional days between a prior estimate and now."""
    start = parse_iso_timestamp(prior_as_of)
    if start is None:
        return 0.0
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return max(0.0, (now - start).total_seconds() / 86400.0)


class MasteryUpdateInput(LanguageAndProvenanceModel):
    tenant_id: str = Field(min_length=1)
    student_id: str = Field(min_length=1)
    skill_id: str = Field(min_length=1)
    correct: bool
    prior_estimate: Optional[MasteryEstimate] = None
    item_difficulty: float = Field(default=0.0, ge=-5.0, le=5.0)
    now: Optional[datetime] = None
    half_life_days: float = Field(default=DEFAULT_MASTERY_HALF_LIFE_DAYS, gt=0.0)


class MasteryUpdateResult(LanguageAndProvenanceModel):
    tenant_id: str = Field(min_length=1)
    student_id: str = Field(min_length=1)
    skill_id: str = Field(min_length=1)
    estimate: MasteryEstimate
    evidence_count: int = Field(ge=1)


class MasteryEstimator(Protocol):
    offline_fallback_available: bool

    def update(self, update_input: MasteryUpdateInput) -> MasteryUpdateResult:
        raise NotImplementedError


class BetaBKT:
    """Small offline Beta-BKT estimator for Phase 0 evidence runs."""

    offline_fallback_available = True

    def update(self, update_input: MasteryUpdateInput) -> MasteryUpdateResult:
        now = update_input.now or datetime.now(timezone.utc)
        prior = update_input.prior_estimate
        a = float(prior.a if prior and prior.kind == "beta" and prior.a is not None else 1.0)
        b = float(prior.b if prior and prior.kind == "beta" and prior.b is not None else 1.0)
        prior_as_of = prior.as_of if prior else None
        elapsed_days = _elapsed_days(prior_as_of, now)
        recency_rule: Optional[str] = None
        if elapsed_days > 0.0:
            # Decay prior evidence toward the uninformed prior (a=b=1) so the
            # estimate forgets stale observations: keeps probability = a/(a+b)
            # roughly stable while inflating variance (uncertainty).
            factor = 0.5 ** (elapsed_days / update_input.half_life_days)
            a = 1.0 + (a - 1.0) * factor
            b = 1.0 + (b - 1.0) * factor
            recency_rule = "beta_recency_decay"
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
                rule_id=recency_rule or "beta_increment_correctness",
                recency=prior_as_of,
                confidence=1.0,
                evidence_count=1,
                metadata={
                    "elapsed_days": round(elapsed_days, 4),
                    "half_life_days": update_input.half_life_days,
                    "recency_decay_applied": elapsed_days > 0.0,
                },
            )
        ]
        return MasteryUpdateResult(
            tenant_id=update_input.tenant_id,
            student_id=update_input.student_id,
            skill_id=update_input.skill_id,
            lang=update_input.lang,
            provenance=provenance,
            estimate=MasteryEstimate(
                kind="beta",
                a=a,
                b=b,
                probability=probability,
                uncertainty=uncertainty,
                as_of=now.isoformat(),
            ),
            evidence_count=1,
        )


class Elo:
    """Alternate estimator behind the same protocol."""

    offline_fallback_available = True

    def __init__(self, k_factor: float = 32.0) -> None:
        self.k_factor = float(k_factor)

    def update(self, update_input: MasteryUpdateInput) -> MasteryUpdateResult:
        now = update_input.now or datetime.now(timezone.utc)
        prior = update_input.prior_estimate
        rating = float(prior.rating if prior and prior.kind == "elo" and prior.rating is not None else 1000.0)
        deviation = float(prior.deviation if prior and prior.kind == "elo" and prior.deviation is not None else 350.0)
        prior_as_of = prior.as_of if prior else None
        elapsed_days = _elapsed_days(prior_as_of, now)
        recency_rule: Optional[str] = None
        if elapsed_days > 0.0:
            # Glicko-style idle inflation: rating confidence (deviation) grows
            # with time away, so a once-confident estimate becomes provisional
            # again and invites re-testing. Capped at the 350-point prior.
            deviation = min(
                350.0,
                math.sqrt(deviation**2 + (ELO_IDLE_VOLATILITY_PER_DAY**2) * elapsed_days),
            )
            recency_rule = "elo_recency_inflation"
        difficulty_rating = 1000.0 + (update_input.item_difficulty * 100.0)
        expected = 1.0 / (1.0 + (10.0 ** ((difficulty_rating - rating) / 400.0)))
        actual = 1.0 if update_input.correct else 0.0
        rating += self.k_factor * (actual - expected)
        deviation = max(50.0, deviation * 0.95)
        probability = 1.0 / (1.0 + (10.0 ** ((difficulty_rating - rating) / 400.0)))
        uncertainty = min(1.0, deviation / 400.0)
        provenance = list(update_input.provenance) + [
            Provenance(
                source="Elo",
                rule_id=recency_rule or "elo_k_factor_update",
                recency=prior_as_of,
                confidence=1.0,
                evidence_count=1,
                metadata={
                    "elapsed_days": round(elapsed_days, 4),
                    "recency_inflation_applied": elapsed_days > 0.0,
                },
            )
        ]
        return MasteryUpdateResult(
            tenant_id=update_input.tenant_id,
            student_id=update_input.student_id,
            skill_id=update_input.skill_id,
            lang=update_input.lang,
            provenance=provenance,
            estimate=MasteryEstimate(
                kind="elo",
                rating=rating,
                deviation=deviation,
                probability=probability,
                uncertainty=uncertainty,
                as_of=now.isoformat(),
            ),
            evidence_count=1,
        )
