"""Recency-decay behaviour for mastery estimators.

These tests pin the anti-staleness contract: when fresh evidence arrives after a
gap, the point estimate stays roughly stable while uncertainty grows, and the
read-side ``age_adjusted_uncertainty`` helper widens uncertainty purely as a
function of elapsed time.
"""

from datetime import datetime, timedelta, timezone

from src.learning.mastery import BetaBKT, Elo, MasteryUpdateInput
from src.learning.models import MasteryEstimate, Provenance


def provenance(source="test"):
    return [Provenance(source=source, confidence=1.0, evidence_count=1)]


def _input(correct, prior, now, **kwargs):
    return MasteryUpdateInput(
        tenant_id="tenant-1",
        student_id="student-1",
        skill_id="ratio",
        correct=correct,
        prior_estimate=prior,
        lang="en-NG",
        provenance=provenance("diagnostic"),
        now=now,
        **kwargs,
    )


def _build_beta_prior(corrects, base_time):
    estimator = BetaBKT()
    estimate = None
    for offset, correct in enumerate(corrects):
        result = estimator.update(
            _input(correct, estimate, base_time + timedelta(minutes=offset))
        )
        estimate = result.estimate
    return estimate


def test_beta_decay_preserves_probability_but_inflates_uncertainty():
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    # Mixed prior (a>1 and b>1) so the new response has comparable leverage in
    # both branches and the point estimate stays close across the time gap.
    prior = _build_beta_prior([True, True, True, False, True, True], t0)

    # Same new correct response, one applied immediately, one after 90 days.
    fresh = BetaBKT().update(_input(True, prior, t0 + timedelta(minutes=10)))
    stale = BetaBKT().update(_input(True, prior, t0 + timedelta(days=90)))

    # Point estimate stays in the same competence region across the gap...
    assert fresh.estimate.probability > 0.5
    assert stale.estimate.probability > 0.5
    # ...but the stale update is strictly less certain (higher uncertainty),
    # because aged evidence is decayed toward the uninformed prior.
    assert stale.estimate.uncertainty > fresh.estimate.uncertainty
    assert stale.estimate.as_of is not None


def test_beta_decay_step_preserves_evidence_ratio_and_forgets_toward_prior():
    # The decay step preserves the observed success:failure ratio (a-1)/(b-1)
    # while shrinking the pseudo-counts, so the posterior mean drifts back
    # toward the uninformed prior (0.5) as evidence ages — the desired
    # forgetting behaviour, not a frozen mean.
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    prior = _build_beta_prior([True, True, True, False], t0)
    prior_evidence_ratio = (prior.a - 1.0) / (prior.b - 1.0)
    prior_mean = prior.a / (prior.a + prior.b)

    gap = t0 + timedelta(days=45)
    after_correct = BetaBKT().update(_input(True, prior, gap)).estimate
    after_wrong = BetaBKT().update(_input(False, prior, gap)).estimate

    # Recover the decayed (un-incremented) counters: a correct update adds +1 to
    # a, a wrong update adds +1 to b.
    decayed_a = after_wrong.a
    decayed_b = after_correct.b
    decayed_evidence_ratio = (decayed_a - 1.0) / (decayed_b - 1.0)
    decayed_mean = decayed_a / (decayed_a + decayed_b)

    # Observed evidence ratio is preserved exactly through the decay.
    assert abs(decayed_evidence_ratio - prior_evidence_ratio) < 1e-9
    # The mean forgets toward 0.5 (it sat above 0.5, now closer to it).
    assert 0.5 < decayed_mean < prior_mean


def test_beta_decay_pulls_counters_toward_uninformed_prior():
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    prior = _build_beta_prior([True, True, True, True, True], t0)

    stale = BetaBKT().update(
        _input(True, prior, t0 + timedelta(days=30), half_life_days=30.0)
    ).estimate

    # After one half-life the (a-1) excess evidence is roughly halved before the
    # new correct response is folded in, so a is well below prior.a + 1.
    assert stale.a is not None and prior.a is not None
    assert stale.a < prior.a + 1.0


def test_beta_no_decay_when_no_elapsed_time():
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    prior = _build_beta_prior([True, True], t0)

    same_instant = BetaBKT().update(_input(True, prior, t0)).estimate

    # No time passed since prior.as_of (prior built at t0) -> plain increment.
    assert same_instant.a is not None and prior.a is not None
    assert abs(same_instant.a - (prior.a + 1.0)) < 1e-9


def test_elo_idle_time_inflates_deviation():
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    estimator = Elo()
    # Build a confident (low-deviation) prior via repeated responses.
    estimate = None
    for offset in range(8):
        estimate = estimator.update(
            _input(offset % 2 == 0, estimate, t0 + timedelta(minutes=offset))
        ).estimate

    fresh = Elo().update(_input(True, estimate, t0 + timedelta(minutes=30))).estimate
    stale = Elo().update(_input(True, estimate, t0 + timedelta(days=120))).estimate

    assert stale.deviation is not None and fresh.deviation is not None
    assert stale.deviation > fresh.deviation
    assert stale.uncertainty >= fresh.uncertainty


def test_age_adjusted_uncertainty_grows_with_age_and_preserves_probability():
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    estimate = MasteryEstimate(
        kind="beta",
        a=20.0,
        b=2.0,
        probability=20.0 / 22.0,
        uncertainty=0.2,
        as_of=t0.isoformat(),
    )

    same = estimate.age_adjusted_uncertainty(now=t0, half_life_days=30.0)
    aged = estimate.age_adjusted_uncertainty(
        now=t0 + timedelta(days=90), half_life_days=30.0
    )

    assert same == estimate.uncertainty
    assert aged > estimate.uncertainty
    assert aged <= 1.0
    # The stored probability is never mutated by the read-side helper.
    assert estimate.probability == 20.0 / 22.0


def test_age_adjusted_uncertainty_no_as_of_is_noop():
    estimate = MasteryEstimate(
        kind="beta", a=3.0, b=1.0, probability=0.75, uncertainty=0.3, as_of=None
    )
    assert estimate.age_adjusted_uncertainty() == 0.3
