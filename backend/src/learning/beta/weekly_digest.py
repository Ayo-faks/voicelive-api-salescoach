"""W8 — weekly digest aggregator.

Pure-function rollup over a list of `LearnerActivity` rows (one per
learner per week). Output is a `WeeklyDigest` Pydantic blob with cohort
totals, the retry-after-explanation north-star tile, top misconceptions,
and a per-learner snapshot pinned to redacted contact metadata.

No LLM traffic. No PII beyond pre-redacted guardian email tokens.
"""

from __future__ import annotations

import hashlib
import json
import os
from collections import Counter
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple
from uuid import uuid4

from pydantic import Field, model_validator

from src.learning.models import ContractModel


WEEKLY_DIGEST_FLAG = "LEARNING_WEEKLY_DIGEST_V1"
WEEKLY_DIGEST_RULE_ID = "w8_weekly_digest_v1"

# North-star target from MVP §3.
RETRY_AFTER_EXPLANATION_TARGET = 0.55


class WeeklyDigestUnavailableError(RuntimeError):
    """Raised when the weekly-digest kill-switch flag is unset."""


class LearnerActivity(ContractModel):
    learner_id: str = Field(min_length=1)
    tenant_id: str = Field(min_length=1)
    year_group: str = Field(min_length=1)
    week_iso: str = Field(min_length=1, pattern=r"^\d{4}-W\d{2}$")
    sessions: int = Field(ge=0)
    minutes_on_task: int = Field(ge=0)
    items_attempted: int = Field(ge=0)
    items_correct: int = Field(ge=0)
    explanations_shown: int = Field(ge=0)
    retries_after_explanation: int = Field(ge=0)
    refusals_no_grounding: int = Field(ge=0)
    crisis_safe_responses: int = Field(ge=0)
    top_misconceptions: Tuple[str, ...] = Field(default_factory=tuple)

    @model_validator(mode="after")
    def _consistent(self) -> "LearnerActivity":
        if self.items_correct > self.items_attempted:
            raise ValueError("items_correct cannot exceed items_attempted")
        if self.retries_after_explanation > self.explanations_shown:
            raise ValueError(
                "retries_after_explanation cannot exceed explanations_shown"
            )
        return self


class LearnerSnapshot(ContractModel):
    learner_id: str = Field(min_length=1)
    year_group: str = Field(min_length=1)
    minutes_on_task: int = Field(ge=0)
    accuracy: float = Field(ge=0.0, le=1.0)
    retry_rate: float = Field(ge=0.0, le=1.0)
    top_misconception: Optional[str] = None


class WeeklyDigest(ContractModel):
    digest_id: str = Field(default_factory=lambda: f"digest-{uuid4().hex[:12]}")
    rule_id: str = WEEKLY_DIGEST_RULE_ID
    week_iso: str = Field(min_length=1, pattern=r"^\d{4}-W\d{2}$")
    generated_at: str = Field(min_length=1)
    cohort_size: int = Field(ge=0)
    active_learners: int = Field(ge=0)
    total_minutes: int = Field(ge=0)
    total_items_attempted: int = Field(ge=0)
    cohort_accuracy: float = Field(ge=0.0, le=1.0)
    retry_after_explanation_rate: float = Field(ge=0.0, le=1.0)
    retry_target: float = Field(ge=0.0, le=1.0)
    meets_retry_target: bool
    refusals_no_grounding: int = Field(ge=0)
    crisis_safe_responses: int = Field(ge=0)
    top_misconceptions: List[Tuple[str, int]] = Field(default_factory=list)
    learner_snapshots: List[LearnerSnapshot] = Field(default_factory=list)
    signature: str = Field(min_length=1)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _sign(payload: dict) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _safe_ratio(num: int, denom: int) -> float:
    return round(num / denom, 4) if denom else 0.0


def build_weekly_digest(
    activities: List[LearnerActivity],
    *,
    week_iso: str,
    cohort_size: int,
    retry_target: float = RETRY_AFTER_EXPLANATION_TARGET,
    require_flag: bool = True,
) -> WeeklyDigest:
    if require_flag and not os.environ.get(WEEKLY_DIGEST_FLAG):
        raise WeeklyDigestUnavailableError(
            f"weekly digest gated by {WEEKLY_DIGEST_FLAG}; set to enable"
        )
    if cohort_size < 0:
        raise ValueError("cohort_size must be >= 0")
    for a in activities:
        if a.week_iso != week_iso:
            raise ValueError(
                f"activity {a.learner_id} week={a.week_iso} != requested {week_iso}"
            )

    active = [a for a in activities if a.sessions > 0]
    total_minutes = sum(a.minutes_on_task for a in activities)
    total_attempted = sum(a.items_attempted for a in activities)
    total_correct = sum(a.items_correct for a in activities)
    total_explanations = sum(a.explanations_shown for a in activities)
    total_retries = sum(a.retries_after_explanation for a in activities)
    refusals = sum(a.refusals_no_grounding for a in activities)
    crisis = sum(a.crisis_safe_responses for a in activities)
    cohort_accuracy = _safe_ratio(total_correct, total_attempted)
    retry_rate = _safe_ratio(total_retries, total_explanations)

    misconception_counter: Counter[str] = Counter()
    for a in activities:
        for code in a.top_misconceptions:
            misconception_counter[code] += 1
    top_misc = misconception_counter.most_common(5)

    snapshots: List[LearnerSnapshot] = []
    for a in sorted(activities, key=lambda x: x.learner_id):
        top = a.top_misconceptions[0] if a.top_misconceptions else None
        snapshots.append(
            LearnerSnapshot(
                learner_id=a.learner_id,
                year_group=a.year_group,
                minutes_on_task=a.minutes_on_task,
                accuracy=_safe_ratio(a.items_correct, a.items_attempted),
                retry_rate=_safe_ratio(
                    a.retries_after_explanation, a.explanations_shown
                ),
                top_misconception=top,
            )
        )
    payload = {
        "rule_id": WEEKLY_DIGEST_RULE_ID,
        "week_iso": week_iso,
        "cohort_size": cohort_size,
        "active_learners": len(active),
        "total_minutes": total_minutes,
        "total_items_attempted": total_attempted,
        "cohort_accuracy": cohort_accuracy,
        "retry_after_explanation_rate": retry_rate,
        "retry_target": retry_target,
        "meets_retry_target": retry_rate >= retry_target,
        "refusals_no_grounding": refusals,
        "crisis_safe_responses": crisis,
        "top_misconceptions": top_misc,
        "learner_snapshots": [s.model_dump() for s in snapshots],
    }
    return WeeklyDigest(
        week_iso=week_iso,
        generated_at=_now(),
        cohort_size=cohort_size,
        active_learners=len(active),
        total_minutes=total_minutes,
        total_items_attempted=total_attempted,
        cohort_accuracy=cohort_accuracy,
        retry_after_explanation_rate=retry_rate,
        retry_target=retry_target,
        meets_retry_target=retry_rate >= retry_target,
        refusals_no_grounding=refusals,
        crisis_safe_responses=crisis,
        top_misconceptions=top_misc,
        learner_snapshots=snapshots,
        signature=_sign(payload),
    )
