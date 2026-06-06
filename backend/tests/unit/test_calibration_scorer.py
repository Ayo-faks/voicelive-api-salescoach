"""Unit tests for the mastery-estimator calibration scorer.

Offline and deterministic — exercises the metric math, the no-leakage guarantee
of the prior-only predictor, the pass/fail gate, head-to-head winner selection
(including ties), and end-to-end determinism of :func:`score_calibration`.
"""

from __future__ import annotations

from src.learning.eval.calibration_scorer import (
    CalibrationEvent,
    CalibrationOutcome,
    CalibrationThresholds,
    compute_calibration_metrics,
    evaluate_predictions,
    predict_prior_probability,
    score_calibration,
)
from src.learning.mastery import BetaBKT, Elo
from src.learning.models import MasteryEstimate


# --------------------------------------------------------------------------- #
# predict_prior_probability — derived from the prior only.
# --------------------------------------------------------------------------- #
def test_betabkt_prediction_uses_prior_beta_ratio():
    prior = MasteryEstimate(kind="beta", a=3.0, b=1.0, probability=0.75, uncertainty=0.1)
    event = CalibrationEvent(prior_estimate=prior, item_difficulty=0.0, correct=False)
    assert predict_prior_probability(BetaBKT(), event) == 0.75


def test_betabkt_uninformed_prior_predicts_half():
    event = CalibrationEvent(prior_estimate=None, item_difficulty=0.0, correct=True)
    assert predict_prior_probability(BetaBKT(), event) == 0.5


def test_elo_prediction_matches_expected_score():
    # Default rating 1000, difficulty 0 -> difficulty_rating 1000 -> expected 0.5.
    event = CalibrationEvent(prior_estimate=None, item_difficulty=0.0, correct=True)
    assert abs(predict_prior_probability(Elo(), event) - 0.5) < 1e-12


def test_elo_harder_item_lowers_predicted_probability():
    easy = CalibrationEvent(prior_estimate=None, item_difficulty=-2.0, correct=False)
    hard = CalibrationEvent(prior_estimate=None, item_difficulty=2.0, correct=False)
    assert predict_prior_probability(Elo(), easy) > 0.5 > predict_prior_probability(Elo(), hard)


def test_prediction_ignores_observed_outcome_no_leakage():
    prior = MasteryEstimate(kind="beta", a=2.0, b=2.0, probability=0.5, uncertainty=0.2)
    correct_event = CalibrationEvent(prior_estimate=prior, item_difficulty=0.5, correct=True)
    wrong_event = CalibrationEvent(prior_estimate=prior, item_difficulty=0.5, correct=False)
    assert predict_prior_probability(BetaBKT(), correct_event) == predict_prior_probability(BetaBKT(), wrong_event)

    elo_prior = MasteryEstimate(kind="elo", rating=1100.0, deviation=200.0, probability=0.6, uncertainty=0.5)
    elo_c = CalibrationEvent(prior_estimate=elo_prior, item_difficulty=1.0, correct=True)
    elo_w = CalibrationEvent(prior_estimate=elo_prior, item_difficulty=1.0, correct=False)
    assert predict_prior_probability(Elo(), elo_c) == predict_prior_probability(Elo(), elo_w)


# --------------------------------------------------------------------------- #
# Metric math — perfect vs deliberately mis-calibrated streams.
# --------------------------------------------------------------------------- #
def test_perfect_predictions_score_zero_and_pass():
    # Predictions exactly equal the outcomes -> Brier 0, ECE 0, pass.
    preds = [1.0, 0.0, 1.0, 0.0, 1.0, 0.0]
    labels = [1, 0, 1, 0, 1, 0]
    report = evaluate_predictions([("Perfect", preds, labels)])
    metrics = report.metrics[0]
    assert metrics.brier == 0.0
    assert metrics.ece == 0.0
    assert metrics.log_loss < 1e-6
    assert report.passed is True
    assert report.blocking_reasons == tuple()


def test_miscalibrated_always_high_predictions_fail():
    # Always predict 0.9 while truth is a 50/50 coin flip -> high Brier and ECE.
    preds = [0.9] * 8
    labels = [1, 0, 1, 0, 1, 0, 1, 0]
    report = evaluate_predictions([("Overconfident", preds, labels)])
    metrics = report.metrics[0]
    assert metrics.brier > 0.25
    assert metrics.ece > 0.10
    assert report.passed is False
    assert any("brier" in reason for reason in report.blocking_reasons)
    assert any("ece" in reason for reason in report.blocking_reasons)


def test_base_rate_and_count_reported():
    preds = [0.5, 0.5, 0.5, 0.5]
    labels = [1, 1, 1, 0]
    metrics = compute_calibration_metrics("X", preds, labels)
    assert metrics.count == 4
    assert metrics.base_rate == 0.75


def test_reliability_bins_cover_full_range_and_count_matches():
    preds = [0.05, 0.15, 0.95, 1.0]
    labels = [0, 0, 1, 1]
    metrics = compute_calibration_metrics("X", preds, labels)
    assert len(metrics.reliability) == 10
    assert sum(b.count for b in metrics.reliability) == 4
    # p == 1.0 must land in the final closed bin, not overflow.
    assert metrics.reliability[-1].count == 2


# --------------------------------------------------------------------------- #
# Head-to-head winner selection, including ties.
# --------------------------------------------------------------------------- #
def test_head_to_head_picks_better_estimator():
    good = ([1.0, 0.0, 1.0, 0.0], [1, 0, 1, 0])
    bad = ([0.6, 0.4, 0.6, 0.4], [1, 0, 1, 0])
    report = evaluate_predictions([("Good", *good), ("Bad", *bad)])
    assert report.winners["brier"] == "Good"
    assert report.better_estimator == "Good"
    assert report.passed is True


def test_head_to_head_reports_tie_when_metrics_equal():
    stream = ([0.8, 0.2, 0.8, 0.2], [1, 0, 1, 0])
    report = evaluate_predictions([("A", *stream), ("B", *stream)])
    assert report.winners["brier"] == "tie"
    assert report.winners["ece"] == "tie"
    assert report.winners["log_loss"] == "tie"


# --------------------------------------------------------------------------- #
# End-to-end replay determinism.
# --------------------------------------------------------------------------- #
def _toy_sequences():
    return [
        [
            CalibrationOutcome(item_difficulty=-1.0, correct=True),
            CalibrationOutcome(item_difficulty=0.0, correct=True),
            CalibrationOutcome(item_difficulty=1.0, correct=False),
        ],
        [
            CalibrationOutcome(item_difficulty=0.5, correct=False),
            CalibrationOutcome(item_difficulty=-0.5, correct=True),
        ],
    ]


def test_score_calibration_is_deterministic():
    first = score_calibration(_toy_sequences())
    second = score_calibration(_toy_sequences())
    assert first.as_dict() == second.as_dict()


def test_score_calibration_grades_both_estimators():
    report = score_calibration(_toy_sequences())
    names = {m.estimator for m in report.metrics}
    assert names == {"BetaBKT", "Elo"}
    assert report.better_estimator in names
    for metrics in report.metrics:
        assert metrics.count == 5  # 3 + 2 items across the two sequences


def test_custom_thresholds_are_honoured():
    # Impossible Brier ceiling forces a fail and a populated blocking reason.
    strict = CalibrationThresholds(max_brier=0.0, max_ece=0.0)
    report = score_calibration(_toy_sequences(), thresholds=strict)
    assert report.passed is False
    assert report.blocking_reasons
