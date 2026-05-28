"""W8 — closed-beta cohort builder.

Deterministic eligibility + selection over a candidate roster. The cohort
itself is signed (SHA-256 over canonical payload) so the safeguarding
reviewer's approval pins an exact roster, no quiet additions.

Eligibility (MVP §11 closed beta):

* Active consent — parental guardian consent on file.
* Age band — 11–18 only (JSS through SS3).
* Year-group ∈ allowed_year_groups.
* Two distinct devices acceptable, but learners flagged ``high_risk`` are
  excluded from the closed beta and routed to a guided cohort instead.
* No prior safeguarding incident in the last 30 days.

Selection: rank-stable by (year_group_order, consent_signed_at,
learner_id). Caps default at 50.
"""

from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone
from typing import Dict, List, Literal, Optional, Tuple
from uuid import uuid4

from pydantic import Field, model_validator

from src.learning.models import ContractModel


BETA_COHORT_FLAG = "LEARNING_BETA_COHORT_V1"
BETA_COHORT_RULE_ID = "w8_beta_cohort_v1"


_YEAR_ORDER = {"jss1": 1, "jss2": 2, "jss3": 3, "ss1": 4, "ss2": 5, "ss3": 6}

ExclusionCode = Literal[
    "no_consent",
    "age_out_of_band",
    "year_group_not_allowed",
    "safeguarding_incident",
    "high_risk_flag",
    "duplicate_learner",
    "cohort_cap_reached",
]


class BetaCohortUnavailableError(RuntimeError):
    """Raised when the beta-cohort kill-switch flag is unset."""


class BetaEnrolmentCandidate(ContractModel):
    learner_id: str = Field(min_length=1)
    tenant_id: str = Field(min_length=1)
    year_group: str = Field(min_length=1)
    age: int = Field(ge=5, le=25)
    consent_on_file: bool = False
    consent_signed_at: Optional[str] = None
    high_risk_flag: bool = False
    safeguarding_incident_30d: bool = False
    guardian_email_redacted: str = Field(min_length=1)
    notes: str = Field(default="", max_length=320)


class BetaEnrolmentDecision(ContractModel):
    learner_id: str = Field(min_length=1)
    eligible: bool
    exclusion_codes: List[ExclusionCode] = Field(default_factory=list)

    @model_validator(mode="after")
    def _consistent(self) -> "BetaEnrolmentDecision":
        if self.eligible and self.exclusion_codes:
            raise ValueError("eligible learners cannot have exclusion codes")
        if not self.eligible and not self.exclusion_codes:
            raise ValueError("ineligible learners must have at least one exclusion code")
        return self


class BetaEnrolment(ContractModel):
    learner_id: str = Field(min_length=1)
    tenant_id: str = Field(min_length=1)
    year_group: str = Field(min_length=1)
    enrolled_at: str = Field(min_length=1)


class BetaCohort(ContractModel):
    cohort_id: str = Field(default_factory=lambda: f"beta-{uuid4().hex[:12]}")
    rule_id: str = BETA_COHORT_RULE_ID
    cap: int = Field(default=50, ge=1, le=500)
    allowed_year_groups: Tuple[str, ...] = Field(default=("jss3", "ss1", "ss2", "ss3"))
    age_min: int = Field(default=11, ge=5, le=25)
    age_max: int = Field(default=18, ge=5, le=25)
    enrolments: List[BetaEnrolment] = Field(default_factory=list)
    decisions: List[BetaEnrolmentDecision] = Field(default_factory=list)
    counts: Dict[str, int] = Field(default_factory=dict)
    generated_at: str = Field(min_length=1)
    safeguarding_signoff: bool = False
    signature: str = Field(min_length=1)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _sign(payload: dict) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


class BetaCohortBuilder:
    """Deterministic cohort selector.

    Operates on the candidate list as a pure function — no IO, no
    randomness, no LLM. Stable ordering by year-group rank, consent
    signed_at (ISO string), then learner_id.
    """

    def __init__(
        self,
        *,
        cap: int = 50,
        allowed_year_groups: Tuple[str, ...] = ("jss3", "ss1", "ss2", "ss3"),
        age_min: int = 11,
        age_max: int = 18,
    ) -> None:
        if cap < 1:
            raise ValueError("cap must be >= 1")
        if age_min > age_max:
            raise ValueError("age_min must be <= age_max")
        self.cap = cap
        self.allowed_year_groups = tuple(allowed_year_groups)
        self.age_min = age_min
        self.age_max = age_max

    def _evaluate(self, c: BetaEnrolmentCandidate) -> BetaEnrolmentDecision:
        codes: List[ExclusionCode] = []
        if not c.consent_on_file:
            codes.append("no_consent")
        if c.age < self.age_min or c.age > self.age_max:
            codes.append("age_out_of_band")
        if c.year_group not in self.allowed_year_groups:
            codes.append("year_group_not_allowed")
        if c.safeguarding_incident_30d:
            codes.append("safeguarding_incident")
        if c.high_risk_flag:
            codes.append("high_risk_flag")
        if codes:
            return BetaEnrolmentDecision(
                learner_id=c.learner_id, eligible=False, exclusion_codes=codes
            )
        return BetaEnrolmentDecision(
            learner_id=c.learner_id, eligible=True, exclusion_codes=[]
        )

    def build(
        self,
        candidates: List[BetaEnrolmentCandidate],
        *,
        require_flag: bool = True,
        safeguarding_signoff: bool = False,
    ) -> BetaCohort:
        if require_flag and not os.environ.get(BETA_COHORT_FLAG):
            raise BetaCohortUnavailableError(
                f"beta cohort gated by {BETA_COHORT_FLAG}; set to enable"
            )
        # Reject duplicate learner_ids deterministically.
        seen: Dict[str, int] = {}
        for c in candidates:
            seen[c.learner_id] = seen.get(c.learner_id, 0) + 1
        decisions: List[BetaEnrolmentDecision] = []
        eligible: List[BetaEnrolmentCandidate] = []
        for c in candidates:
            if seen[c.learner_id] > 1:
                decisions.append(
                    BetaEnrolmentDecision(
                        learner_id=c.learner_id,
                        eligible=False,
                        exclusion_codes=["duplicate_learner"],
                    )
                )
                continue
            dec = self._evaluate(c)
            decisions.append(dec)
            if dec.eligible:
                eligible.append(c)

        # Stable sort: year_group rank, consent_signed_at (empty last), learner_id.
        eligible.sort(
            key=lambda c: (
                _YEAR_ORDER.get(c.year_group.lower(), 99),
                c.consent_signed_at or "9999-99-99",
                c.learner_id,
            )
        )
        enrolments: List[BetaEnrolment] = []
        now = _now()
        for c in eligible[: self.cap]:
            enrolments.append(
                BetaEnrolment(
                    learner_id=c.learner_id,
                    tenant_id=c.tenant_id,
                    year_group=c.year_group,
                    enrolled_at=now,
                )
            )
        # Mark over-cap eligible learners as excluded.
        cap_excluded_ids = {c.learner_id for c in eligible[self.cap :]}
        decisions = [
            (
                BetaEnrolmentDecision(
                    learner_id=d.learner_id,
                    eligible=False,
                    exclusion_codes=["cohort_cap_reached"],
                )
                if d.learner_id in cap_excluded_ids
                else d
            )
            for d in decisions
        ]
        counts: Dict[str, int] = {
            "candidates": len(candidates),
            "eligible": sum(1 for d in decisions if d.eligible),
            "enrolled": len(enrolments),
            "excluded": sum(1 for d in decisions if not d.eligible),
        }
        for d in decisions:
            for code in d.exclusion_codes:
                counts[f"excl_{code}"] = counts.get(f"excl_{code}", 0) + 1
        payload = {
            "rule_id": BETA_COHORT_RULE_ID,
            "cap": self.cap,
            "allowed_year_groups": list(self.allowed_year_groups),
            "age_min": self.age_min,
            "age_max": self.age_max,
            # exclude enrolled_at so signature pins the roster, not the wall-clock
            "enrolment_ids": sorted(e.learner_id for e in enrolments),
            "counts": counts,
        }
        return BetaCohort(
            cap=self.cap,
            allowed_year_groups=self.allowed_year_groups,
            age_min=self.age_min,
            age_max=self.age_max,
            enrolments=enrolments,
            decisions=decisions,
            counts=counts,
            generated_at=now,
            safeguarding_signoff=safeguarding_signoff,
            signature=_sign(payload),
        )
