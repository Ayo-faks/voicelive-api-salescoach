"""Contract tests — W8 closed-beta cohort builder."""

from __future__ import annotations

import os
from typing import List

import pytest

from src.learning.beta.cohort import (
    BETA_COHORT_FLAG,
    BETA_COHORT_RULE_ID,
    BetaCohort,
    BetaCohortBuilder,
    BetaCohortUnavailableError,
    BetaEnrolmentCandidate,
)


@pytest.fixture(autouse=True)
def _enable_flag(monkeypatch):
    monkeypatch.setenv(BETA_COHORT_FLAG, "1")
    yield


def _cand(
    learner_id: str,
    *,
    year_group: str = "ss1",
    age: int = 14,
    consent: bool = True,
    signed_at: str = "2026-04-01T09:00:00Z",
    high_risk: bool = False,
    incident: bool = False,
    tenant: str = "tnt-1",
) -> BetaEnrolmentCandidate:
    return BetaEnrolmentCandidate(
        learner_id=learner_id,
        tenant_id=tenant,
        year_group=year_group,
        age=age,
        consent_on_file=consent,
        consent_signed_at=signed_at,
        high_risk_flag=high_risk,
        safeguarding_incident_30d=incident,
        guardian_email_redacted="g***@example.com",
    )


def test_kill_switch_blocks_when_flag_unset(monkeypatch):
    monkeypatch.delenv(BETA_COHORT_FLAG, raising=False)
    with pytest.raises(BetaCohortUnavailableError):
        BetaCohortBuilder().build([_cand("a")])


def test_force_flag_disabled_still_builds(monkeypatch):
    monkeypatch.delenv(BETA_COHORT_FLAG, raising=False)
    cohort = BetaCohortBuilder().build([_cand("a")], require_flag=False)
    assert isinstance(cohort, BetaCohort)
    assert cohort.counts["enrolled"] == 1


def test_excludes_no_consent():
    cohort = BetaCohortBuilder().build([_cand("a", consent=False)])
    assert cohort.counts["enrolled"] == 0
    assert "no_consent" in cohort.decisions[0].exclusion_codes


def test_excludes_out_of_age_band():
    cohort = BetaCohortBuilder().build([_cand("a", age=9)])
    assert "age_out_of_band" in cohort.decisions[0].exclusion_codes


def test_excludes_year_group_not_allowed():
    cohort = BetaCohortBuilder().build([_cand("a", year_group="primary4")])
    assert "year_group_not_allowed" in cohort.decisions[0].exclusion_codes


def test_excludes_high_risk_flag():
    cohort = BetaCohortBuilder().build([_cand("a", high_risk=True)])
    assert "high_risk_flag" in cohort.decisions[0].exclusion_codes


def test_excludes_safeguarding_incident():
    cohort = BetaCohortBuilder().build([_cand("a", incident=True)])
    assert "safeguarding_incident" in cohort.decisions[0].exclusion_codes


def test_excludes_duplicate_learners():
    cohort = BetaCohortBuilder().build([_cand("a"), _cand("a")])
    codes = {c for d in cohort.decisions for c in d.exclusion_codes}
    assert "duplicate_learner" in codes
    assert cohort.counts["enrolled"] == 0


def test_cap_default_50_and_overflow_marked_excluded():
    candidates: List[BetaEnrolmentCandidate] = [
        _cand(f"l{i:03d}", signed_at=f"2026-04-01T09:00:{i:02d}Z") for i in range(55)
    ]
    cohort = BetaCohortBuilder().build(candidates)
    assert cohort.counts["enrolled"] == 50
    cap_excluded = [
        d for d in cohort.decisions if "cohort_cap_reached" in d.exclusion_codes
    ]
    assert len(cap_excluded) == 5


def test_custom_cap_respected():
    candidates = [_cand(f"l{i}") for i in range(10)]
    cohort = BetaCohortBuilder(cap=3).build(candidates)
    assert cohort.counts["enrolled"] == 3


def test_deterministic_ordering_by_year_then_consent_then_id():
    candidates = [
        _cand("z", year_group="ss3", signed_at="2026-04-02T00:00:00Z"),
        _cand("a", year_group="jss3", signed_at="2026-04-02T00:00:00Z"),
        _cand("m", year_group="ss1", signed_at="2026-04-01T00:00:00Z"),
        _cand("m2", year_group="ss1", signed_at="2026-04-02T00:00:00Z"),
    ]
    cohort = BetaCohortBuilder(cap=4).build(candidates)
    ids = [e.learner_id for e in cohort.enrolments]
    assert ids == ["a", "m", "m2", "z"]


def test_signature_is_stable_for_same_inputs():
    candidates = [_cand("a"), _cand("b")]
    c1 = BetaCohortBuilder().build(candidates)
    c2 = BetaCohortBuilder().build(candidates)
    # signatures cover roster + counts + config, not timestamps
    assert c1.signature == c2.signature


def test_counts_breakdown_includes_exclusion_codes():
    candidates = [
        _cand("a", consent=False),
        _cand("b", age=9),
        _cand("c"),
    ]
    cohort = BetaCohortBuilder().build(candidates)
    assert cohort.counts["enrolled"] == 1
    assert cohort.counts.get("excl_no_consent") == 1
    assert cohort.counts.get("excl_age_out_of_band") == 1


def test_rule_id_pinned():
    cohort = BetaCohortBuilder().build([_cand("a")])
    assert cohort.rule_id == BETA_COHORT_RULE_ID == "w8_beta_cohort_v1"
