"""Mastery-estimator calibration scorer (offline, deterministic).

The :class:`~src.learning.mastery.BetaBKT` and :class:`~src.learning.mastery.Elo`
estimators each emit a *predicted probability of a correct answer* for the item a
learner is about to attempt. Those probabilities drive every learner's profile,
diagnostic routing, and "needs practice" facts — but until now their probabilistic
outputs were never validated for **calibration** (does "80% likely correct" mean
the learner is right ~80% of the time?).

This module measures that, head-to-head, for any number of estimators:

* **Brier score** — mean squared error of the predicted probability vs the binary
  outcome. Lower is better.
* **Log-loss** — negative log-likelihood with the probability clamped to
  ``[ε, 1−ε]`` (``ε = 1e-12``) so a confident miss never yields ``-inf``.
* **Reliability curve + ECE** — predictions bucketed into ten ``[0,0.1)…[0.9,1.0]``
  bins; the expected calibration error is the support-weighted mean gap between
  each bin's mean predicted probability and its observed correct-frequency.

Design rules (mirroring the rest of ``src/learning/eval``):

* **Pure, offline, deterministic.** No network, no env reads at import, no
  randomness in scoring. The prediction for each item uses the estimator's
  **prior** state *only* (the probability it would have assigned *before* seeing
  the outcome), so the observed ``correct`` flag can never leak into its own
  prediction.
* **Frozen contract results.** ``CalibrationMetrics`` / ``CalibrationReport`` are
  immutable :class:`~src.learning.models.ContractModel` objects exposing
  ``.as_dict()`` for the runner and the dashboard tile.
* **Additive.** Imports the estimators read-only; touches none of their math.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Dict, List, Optional, Sequence, Tuple

from pydantic import ConfigDict, Field

from src.learning.mastery import (
    BetaBKT,
    Elo,
    MasteryEstimator,
    MasteryUpdateInput,
)
from src.learning.models import ContractModel, MasteryEstimate, Provenance

# Log-loss probability clamp: keeps a confident miss finite without materially
# moving a well-calibrated score.
LOG_LOSS_EPSILON = 1e-12

# Reliability-curve resolution: ten equal-width bins over [0, 1].
DEFAULT_RELIABILITY_BINS = 10

# Fixed replay clock. Every estimator update during a replay is stamped with this
# instant so the prior's ``as_of`` always equals "now" — elapsed time is zero, the
# recency decay/inflation rules are an identity, and the score is wall-clock
# independent (hence reproducible in CI).
_REPLAY_NOW = datetime(2025, 1, 1, tzinfo=timezone.utc)

# Provenance/identity scaffolding required by ``MasteryUpdateInput``; values are
# inert labels — no PII, never persisted.
_REPLAY_LANG = "en"
_REPLAY_TENANT = "calibration"
_REPLAY_STUDENT = "calibration"
_REPLAY_SKILL = "calibration"


class CalibrationOutcome(ContractModel):
    """One answered diagnostic item in a replay sequence.

    The dataset/fixture unit: an item's signed difficulty and whether the learner
    got it right. The *prior* is reconstructed during replay, never stored, so a
    single record can feed every estimator fairly from its own running state.
    """

    item_difficulty: float = Field(default=0.0, ge=-5.0, le=5.0)
    correct: bool


class CalibrationEvent(ContractModel):
    """The pure unit :func:`predict_prior_probability` consumes.

    Carries the estimator's ``prior_estimate`` (its state *before* this item), the
    item difficulty, and the observed ``correct`` flag. ``correct`` is present only
    so tests can prove the prediction ignores it — it is **never** read by the
    predictor.
    """

    prior_estimate: Optional[MasteryEstimate] = None
    item_difficulty: float = Field(default=0.0, ge=-5.0, le=5.0)
    correct: bool


class ReliabilityBin(ContractModel):
    """One bucket of the reliability (calibration) curve."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    bin_lower: float = Field(ge=0.0, le=1.0)
    bin_upper: float = Field(ge=0.0, le=1.0)
    mean_predicted: float = Field(ge=0.0, le=1.0)
    observed_frequency: float = Field(ge=0.0, le=1.0)
    count: int = Field(ge=0)

    def as_dict(self) -> Dict[str, object]:
        return {
            "bin_lower": self.bin_lower,
            "bin_upper": self.bin_upper,
            "mean_predicted": self.mean_predicted,
            "observed_frequency": self.observed_frequency,
            "count": self.count,
        }


class CalibrationMetrics(ContractModel):
    """Calibration metrics for a single estimator over a labelled stream."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    estimator: str = Field(min_length=1)
    count: int = Field(ge=0)
    base_rate: float = Field(ge=0.0, le=1.0)
    brier: float = Field(ge=0.0)
    log_loss: float = Field(ge=0.0)
    ece: float = Field(ge=0.0, le=1.0)
    reliability: Tuple[ReliabilityBin, ...] = Field(default_factory=tuple)

    def as_dict(self) -> Dict[str, object]:
        return {
            "estimator": self.estimator,
            "count": self.count,
            "base_rate": self.base_rate,
            "brier": self.brier,
            "log_loss": self.log_loss,
            "ece": self.ece,
            "reliability": [b.as_dict() for b in self.reliability],
        }


class CalibrationThresholds(ContractModel):
    """Pass/fail gate thresholds, applied to the *better* estimator."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    max_brier: float = Field(default=0.25, ge=0.0)
    max_ece: float = Field(default=0.10, ge=0.0, le=1.0)

    def as_dict(self) -> Dict[str, object]:
        return {"max_brier": self.max_brier, "max_ece": self.max_ece}


class CalibrationReport(ContractModel):
    """Head-to-head calibration report with a pass/fail gate bucket."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    metrics: Tuple[CalibrationMetrics, ...] = Field(default_factory=tuple)
    winners: Dict[str, str] = Field(default_factory=dict)
    better_estimator: Optional[str] = None
    thresholds: CalibrationThresholds = Field(default_factory=CalibrationThresholds)
    passed: bool = False
    blocking_reasons: Tuple[str, ...] = Field(default_factory=tuple)

    def as_dict(self) -> Dict[str, object]:
        return {
            "metrics": [m.as_dict() for m in self.metrics],
            "winners": dict(self.winners),
            "better_estimator": self.better_estimator,
            "thresholds": self.thresholds.as_dict(),
            "passed": self.passed,
            "blocking_reasons": list(self.blocking_reasons),
        }


def _estimator_name(estimator: MasteryEstimator) -> str:
    return type(estimator).__name__


def predict_prior_probability(estimator: MasteryEstimator, event: CalibrationEvent) -> float:
    """Probability the estimator assigns to a correct answer from the **prior** only.

    This mirrors the prediction each estimator makes *inside* ``update()`` for the
    item being answered, derived purely from ``event.prior_estimate`` — the
    observed ``event.correct`` is deliberately never read, so the prediction can
    never leak its own outcome.

    * ``BetaBKT``: ``p = a / (a + b)`` from the prior Beta (uninformed prior
      ``a = b = 1`` → ``0.5``).
    * ``Elo``: ``p = 1 / (1 + 10**((difficulty_rating - rating) / 400))`` where
      ``difficulty_rating = 1000 + item_difficulty * 100`` and ``rating`` is the
      prior rating (default ``1000``).
    """
    prior = event.prior_estimate
    if isinstance(estimator, Elo):
        rating = float(prior.rating if prior and prior.kind == "elo" and prior.rating is not None else 1000.0)
        difficulty_rating = 1000.0 + (event.item_difficulty * 100.0)
        return 1.0 / (1.0 + (10.0 ** ((difficulty_rating - rating) / 400.0)))
    if isinstance(estimator, BetaBKT):
        a = float(prior.a if prior and prior.kind == "beta" and prior.a is not None else 1.0)
        b = float(prior.b if prior and prior.kind == "beta" and prior.b is not None else 1.0)
        return a / (a + b)
    raise ValueError(f"unsupported estimator for calibration prediction: {_estimator_name(estimator)}")


def _replay_predictions(
    estimator: MasteryEstimator,
    sequences: Sequence[Sequence[CalibrationOutcome]],
) -> Tuple[List[float], List[int]]:
    """Replay every sequence through one estimator, collecting (prediction, label).

    For each item we predict from the running prior *before* advancing the prior
    with the observed outcome — so no prediction sees its own label. The prior is
    reset to uninformed at the start of every sequence.
    """
    predictions: List[float] = []
    labels: List[int] = []
    for sequence in sequences:
        prior: Optional[MasteryEstimate] = None
        for outcome in sequence:
            event = CalibrationEvent(
                prior_estimate=prior,
                item_difficulty=outcome.item_difficulty,
                correct=outcome.correct,
            )
            predictions.append(predict_prior_probability(estimator, event))
            labels.append(1 if outcome.correct else 0)
            result = estimator.update(
                MasteryUpdateInput(
                    tenant_id=_REPLAY_TENANT,
                    student_id=_REPLAY_STUDENT,
                    skill_id=_REPLAY_SKILL,
                    lang=_REPLAY_LANG,
                    provenance=[Provenance(source="calibration_eval", confidence=1.0, evidence_count=1)],
                    correct=outcome.correct,
                    item_difficulty=outcome.item_difficulty,
                    prior_estimate=prior,
                    now=_REPLAY_NOW,
                )
            )
            prior = result.estimate
    return predictions, labels


def _reliability_bins(
    predictions: Sequence[float],
    labels: Sequence[int],
    n_bins: int = DEFAULT_RELIABILITY_BINS,
) -> Tuple[List[ReliabilityBin], float]:
    """Bucket predictions into ``n_bins`` and return (bins, ECE).

    Bins are ``[0,1/n) … [(n-1)/n, 1.0]`` with the final bin closed at ``1.0``.
    ECE is the support-weighted mean ``|mean_predicted - observed_frequency|``.
    """
    n = len(predictions)
    width = 1.0 / n_bins
    sums_pred = [0.0] * n_bins
    sums_label = [0] * n_bins
    counts = [0] * n_bins
    for p, y in zip(predictions, labels):
        idx = int(p / width)
        if idx >= n_bins:  # p == 1.0 lands in the final, closed bin
            idx = n_bins - 1
        sums_pred[idx] += p
        sums_label[idx] += y
        counts[idx] += 1

    bins: List[ReliabilityBin] = []
    ece = 0.0
    for i in range(n_bins):
        c = counts[i]
        mean_pred = sums_pred[i] / c if c else 0.0
        obs_freq = sums_label[i] / c if c else 0.0
        if c and n:
            ece += (c / n) * abs(mean_pred - obs_freq)
        bins.append(
            ReliabilityBin(
                bin_lower=round(i * width, 10),
                bin_upper=round((i + 1) * width, 10),
                mean_predicted=mean_pred,
                observed_frequency=obs_freq,
                count=c,
            )
        )
    return bins, ece


def compute_calibration_metrics(
    estimator_name: str,
    predictions: Sequence[float],
    labels: Sequence[int],
    *,
    n_bins: int = DEFAULT_RELIABILITY_BINS,
) -> CalibrationMetrics:
    """Brier / log-loss / ECE + reliability curve for one labelled stream."""
    n = len(predictions)
    if n != len(labels):
        raise ValueError("predictions and labels must be the same length")
    if n == 0:
        return CalibrationMetrics(
            estimator=estimator_name,
            count=0,
            base_rate=0.0,
            brier=0.0,
            log_loss=0.0,
            ece=0.0,
            reliability=tuple(),
        )

    brier = sum((p - y) ** 2 for p, y in zip(predictions, labels)) / n
    log_loss = 0.0
    for p, y in zip(predictions, labels):
        clamped = min(max(p, LOG_LOSS_EPSILON), 1.0 - LOG_LOSS_EPSILON)
        log_loss += -(y * math.log(clamped) + (1 - y) * math.log(1.0 - clamped))
    log_loss /= n
    base_rate = sum(labels) / n
    bins, ece = _reliability_bins(predictions, labels, n_bins=n_bins)

    return CalibrationMetrics(
        estimator=estimator_name,
        count=n,
        base_rate=round(base_rate, 6),
        brier=round(brier, 6),
        log_loss=round(log_loss, 6),
        ece=round(ece, 6),
        reliability=tuple(bins),
    )


def _pick_winner(metrics: Sequence[CalibrationMetrics], attr: str) -> str:
    """Name the estimator with the lowest value of ``attr`` (lower is better).

    Returns ``"tie"`` when two or more estimators share the minimum.
    """
    if not metrics:
        return "tie"
    best = min(getattr(m, attr) for m in metrics)
    leaders = [m.estimator for m in metrics if getattr(m, attr) == best]
    return leaders[0] if len(leaders) == 1 else "tie"


def evaluate_predictions(
    named_predictions: Sequence[Tuple[str, Sequence[float], Sequence[int]]],
    *,
    thresholds: Optional[CalibrationThresholds] = None,
    n_bins: int = DEFAULT_RELIABILITY_BINS,
) -> CalibrationReport:
    """Build a head-to-head :class:`CalibrationReport` from labelled prediction streams.

    The gate is applied to the **better** estimator — the one with the lowest
    Brier (ties broken by ECE). The report ``passes`` iff that estimator's
    ``brier <= max_brier`` AND ``ece <= max_ece``.
    """
    thresholds = thresholds or CalibrationThresholds()
    metrics = [
        compute_calibration_metrics(name, preds, labels, n_bins=n_bins) for name, preds, labels in named_predictions
    ]

    winners = {
        "brier": _pick_winner(metrics, "brier"),
        "log_loss": _pick_winner(metrics, "log_loss"),
        "ece": _pick_winner(metrics, "ece"),
    }

    better: Optional[CalibrationMetrics] = None
    if metrics:
        better = min(metrics, key=lambda m: (m.brier, m.ece))

    blocking: List[str] = []
    passed = False
    if better is not None:
        if better.brier > thresholds.max_brier:
            blocking.append(f"{better.estimator}.brier {better.brier:.4f} > {thresholds.max_brier:.2f}")
        if better.ece > thresholds.max_ece:
            blocking.append(f"{better.estimator}.ece {better.ece:.4f} > {thresholds.max_ece:.2f}")
        passed = not blocking

    return CalibrationReport(
        metrics=tuple(metrics),
        winners=winners,
        better_estimator=better.estimator if better is not None else None,
        thresholds=thresholds,
        passed=passed,
        blocking_reasons=tuple(blocking),
    )


def score_calibration(
    sequences: Sequence[Sequence[CalibrationOutcome]],
    estimators: Sequence[MasteryEstimator] = (BetaBKT(), Elo()),
    *,
    thresholds: Optional[CalibrationThresholds] = None,
    n_bins: int = DEFAULT_RELIABILITY_BINS,
) -> CalibrationReport:
    """Replay ``sequences`` through each estimator and grade their calibration.

    Each estimator is replayed independently with its own running prior (reset per
    sequence), predicting every item from the prior *before* the outcome is folded
    in. Deterministic: identical input → identical report.
    """
    named: List[Tuple[str, Sequence[float], Sequence[int]]] = []
    for estimator in estimators:
        preds, labels = _replay_predictions(estimator, sequences)
        named.append((_estimator_name(estimator), preds, labels))
    return evaluate_predictions(named, thresholds=thresholds, n_bins=n_bins)


__all__ = [
    "LOG_LOSS_EPSILON",
    "DEFAULT_RELIABILITY_BINS",
    "CalibrationOutcome",
    "CalibrationEvent",
    "ReliabilityBin",
    "CalibrationMetrics",
    "CalibrationThresholds",
    "CalibrationReport",
    "predict_prior_probability",
    "compute_calibration_metrics",
    "evaluate_predictions",
    "score_calibration",
]
