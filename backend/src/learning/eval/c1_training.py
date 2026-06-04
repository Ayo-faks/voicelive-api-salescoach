"""Track C / C1 — offline training harness + concrete next-best-question policy.

The C1 stub (:mod:`src.learning.eval.c1_policy`) ships with **no**
``NextBestQuestionPolicy`` artifact, so it is permanently dark. This module is the
offline pipeline that *produces* one, per the signed plan's mandatory shape:

    offline-train → batch-score (Track A) → shadow → human-promote

Everything here is **offline and deterministic**. There is no online training and
no live weight update — the trainer fits weights from a labeled corpus once, emits
a JSON artifact, and stops. Loading that artifact into ``LearnedItemSelector`` is
still only a *shadow* until a human calls ``promote()`` behind gate 4.

Contents:

* :class:`WeightedNextBestQuestionPolicy` — a concrete policy that satisfies the
  :class:`~src.learning.eval.c1_policy.NextBestQuestionPolicy` Protocol. It scores
  each candidate from interpretable features (skill mastery gap, evidence
  uncertainty, item-difficulty match to the learner's ability) and re-orders the
  baseline candidate list. It never mutates state and never invents items.
* :func:`train_next_best_question_policy` — an averaged-perceptron fit over the
  pairwise preferences implied by each labeled example. Deterministic.
* :func:`batch_score_policy` — the Track-A go/no-go hook: top-1 accuracy of the
  policy vs the round-robin baseline on a held-out corpus. Gate 4 requires the
  policy to *beat* round-robin here before any human promotion.
* Artifact (de)serialisation + corpus loading.

New file only. Reuses the diagnostic + C1 contracts; edits nothing.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Mapping, Sequence, Tuple

from src.learning.models import DiagnosticItem, MasteryEstimate

# Bump when the feature set or artifact shape changes; the loader refuses a
# mismatched major artifact so a stale policy can never be silently promoted.
POLICY_ARTIFACT_VERSION = "c1-nbq/1"

# Feature order is fixed and part of the artifact contract.
FEATURE_NAMES: Tuple[str, ...] = (
    "mastery_gap",
    "uncertainty",
    "difficulty_match",
)

# Neutral prior used when a candidate's skill has no mastery evidence yet.
_DEFAULT_PROBABILITY = 0.5
_DEFAULT_UNCERTAINTY = 1.0


# --------------------------------------------------------------------------- #
# Feature extraction (shared by trainer, policy, and scorer).
# --------------------------------------------------------------------------- #
def _mastery_fields(estimate: Any) -> Tuple[float, float]:
    """Return ``(probability, uncertainty)`` from a MasteryEstimate or dict."""
    if estimate is None:
        return _DEFAULT_PROBABILITY, _DEFAULT_UNCERTAINTY
    if isinstance(estimate, Mapping):
        prob = float(estimate.get("probability", _DEFAULT_PROBABILITY))
        unc = float(estimate.get("uncertainty", _DEFAULT_UNCERTAINTY))
    else:
        prob = float(getattr(estimate, "probability", _DEFAULT_PROBABILITY))
        unc = float(getattr(estimate, "uncertainty", _DEFAULT_UNCERTAINTY))
    return max(0.0, min(1.0, prob)), max(0.0, min(1.0, unc))


def _ability_from_probability(probability: float) -> float:
    """Logit of the mastery probability, clipped to the item-difficulty range."""
    p = min(max(probability, 1e-3), 1 - 1e-3)
    theta = math.log(p / (1 - p))
    return max(-5.0, min(5.0, theta))


def item_features(
    item: DiagnosticItem,
    prior_mastery: Mapping[str, Any],
) -> Tuple[float, float, float]:
    """Interpretable features for one candidate item given prior mastery.

    * ``mastery_gap``     — ``1 - P(mastery)`` of the item's skill (weak skills win).
    * ``uncertainty``     — evidence uncertainty for that skill (more to learn).
    * ``difficulty_match``— closeness of item difficulty to the learner's ability,
      i.e. items near the ability boundary carry the most information.
    """
    probability, uncertainty = _mastery_fields(prior_mastery.get(item.skill_id))
    mastery_gap = 1.0 - probability
    ability = _ability_from_probability(probability)
    difficulty_match = 1.0 / (1.0 + abs(float(item.difficulty) - ability))
    return (mastery_gap, uncertainty, difficulty_match)


# --------------------------------------------------------------------------- #
# Policy.
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class WeightedNextBestQuestionPolicy:
    """A linear next-best-question policy. Satisfies ``NextBestQuestionPolicy``.

    Pure and stateless: :meth:`rank` re-orders the baseline candidates by a
    weighted feature score (descending), with a deterministic ``item_id``
    tie-break so two equal scores never reorder unpredictably.
    """

    weights: Tuple[float, ...]
    bias: float = 0.0
    version: str = POLICY_ARTIFACT_VERSION
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def score(self, item: DiagnosticItem, prior_mastery: Mapping[str, Any]) -> float:
        feats = item_features(item, prior_mastery)
        return self.bias + sum(w * f for w, f in zip(self.weights, feats))

    def rank(
        self,
        candidates: List[DiagnosticItem],
        prior_mastery: Mapping[str, MasteryEstimate],
    ) -> List[DiagnosticItem]:
        return sorted(
            candidates,
            key=lambda it: (-self.score(it, prior_mastery), it.item_id),
        )

    # -- artifact (de)serialisation ------------------------------------- #
    def to_artifact(self) -> Dict[str, Any]:
        return {
            "version": self.version,
            "feature_names": list(FEATURE_NAMES),
            "weights": [round(w, 6) for w in self.weights],
            "bias": round(self.bias, 6),
            "metadata": dict(self.metadata),
        }

    @classmethod
    def from_artifact(cls, artifact: Mapping[str, Any]) -> "WeightedNextBestQuestionPolicy":
        version = str(artifact.get("version", ""))
        if version.split("/", 1)[0] != POLICY_ARTIFACT_VERSION.split("/", 1)[0]:
            raise ValueError(
                f"unsupported policy artifact version {version!r}; "
                f"expected {POLICY_ARTIFACT_VERSION!r}"
            )
        names = tuple(artifact.get("feature_names", FEATURE_NAMES))
        if names != FEATURE_NAMES:
            raise ValueError(
                f"artifact feature_names {names} do not match {FEATURE_NAMES}"
            )
        weights = tuple(float(w) for w in artifact.get("weights", ()))
        if len(weights) != len(FEATURE_NAMES):
            raise ValueError("artifact weights length does not match feature set")
        return cls(
            weights=weights,
            bias=float(artifact.get("bias", 0.0)),
            version=version or POLICY_ARTIFACT_VERSION,
            metadata=dict(artifact.get("metadata", {})),
        )


# --------------------------------------------------------------------------- #
# Labeled corpus.
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class LabeledExample:
    """One training/eval example.

    * ``candidates``    — the baseline candidate list (order = round-robin baseline).
    * ``prior_mastery`` — skill_id → mastery fields at decision time.
    * ``label``         — the ``item_id`` a reviewer marked as the best next question.
    """

    example_id: str
    candidates: Tuple[DiagnosticItem, ...]
    prior_mastery: Mapping[str, Any]
    label: str

    def feature_rows(self) -> Dict[str, Tuple[float, float, float]]:
        return {it.item_id: item_features(it, self.prior_mastery) for it in self.candidates}


def load_corpus(path: str | Path) -> Tuple[LabeledExample, ...]:
    """Load a labeled corpus JSON file into :class:`LabeledExample` rows."""
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    examples = raw["examples"] if isinstance(raw, Mapping) else raw
    # Synthetic-corpus defaults: every item carries a provenance stamp marking it
    # as reviewer-rule-labeled offline data, never live learner content.
    default_lang = (raw.get("lang") if isinstance(raw, Mapping) else None) or "en"
    default_provenance = [{"source": "c1-nbq-corpus", "confidence": 1.0}]
    out: List[LabeledExample] = []
    for row in examples:
        candidates = tuple(
            DiagnosticItem(
                item_id=c["item_id"],
                skill_id=c["skill_id"],
                prompt=c.get("prompt", c["item_id"]),
                item_type=c.get("item_type", "mcq"),
                difficulty=float(c.get("difficulty", 0.0)),
                lang=c.get("lang", default_lang),
                provenance=c.get("provenance", default_provenance),
            )
            for c in row["candidates"]
        )
        out.append(
            LabeledExample(
                example_id=str(row["example_id"]),
                candidates=candidates,
                prior_mastery=dict(row.get("prior_mastery", {})),
                label=str(row["label"]),
            )
        )
    return tuple(out)


# --------------------------------------------------------------------------- #
# Trainer (offline, deterministic).
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class TrainingReport:
    examples: int
    epochs: int
    train_top1: float
    baseline_top1: float

    @property
    def beats_baseline(self) -> bool:
        return self.train_top1 > self.baseline_top1

    def as_dict(self) -> Dict[str, Any]:
        return {
            "examples": self.examples,
            "epochs": self.epochs,
            "train_top1": round(self.train_top1, 4),
            "baseline_top1": round(self.baseline_top1, 4),
            "beats_baseline": self.beats_baseline,
        }


def _top1(policy: WeightedNextBestQuestionPolicy, example: LabeledExample) -> bool:
    ranked = policy.rank(list(example.candidates), example.prior_mastery)
    return bool(ranked) and ranked[0].item_id == example.label


def _baseline_top1(example: LabeledExample) -> bool:
    # Round-robin baseline picks the first candidate in input order.
    return bool(example.candidates) and example.candidates[0].item_id == example.label


def train_next_best_question_policy(
    corpus: Sequence[LabeledExample],
    *,
    epochs: int = 50,
    learning_rate: float = 0.1,
) -> Tuple[WeightedNextBestQuestionPolicy, TrainingReport]:
    """Fit a linear policy from labeled preferences with an averaged perceptron.

    For each example the labeled item must outscore every other candidate; on a
    violation we nudge the weights toward the label's features and away from the
    offending candidate's. Averaging the weight vector over all updates yields a
    deterministic, stable policy. Offline only — never called at request time.
    """
    if not corpus:
        raise ValueError("cannot train on an empty corpus")

    n = len(FEATURE_NAMES)
    weights = [0.0] * n
    bias = 0.0
    acc_w = [0.0] * n
    acc_b = 0.0
    updates = 0

    for _ in range(epochs):
        for example in corpus:
            rows = example.feature_rows()
            if example.label not in rows:
                continue
            label_feats = rows[example.label]
            label_score = bias + sum(w * f for w, f in zip(weights, label_feats))
            for item in example.candidates:
                if item.item_id == example.label:
                    continue
                feats = rows[item.item_id]
                score = bias + sum(w * f for w, f in zip(weights, feats))
                # Hinge: the label should win by a margin of 1.
                if label_score - score < 1.0:
                    for i in range(n):
                        weights[i] += learning_rate * (label_feats[i] - feats[i])
                    # bias delta is zero (label and rival share the same bias).
            updates += 1
            for i in range(n):
                acc_w[i] += weights[i]
            acc_b += bias

    if updates:
        weights = [w / updates for w in acc_w]
        bias = acc_b / updates

    policy = WeightedNextBestQuestionPolicy(
        weights=tuple(weights),
        bias=bias,
        metadata={
            "trained_on_examples": len(corpus),
            "epochs": epochs,
            "learning_rate": learning_rate,
        },
    )
    train_top1 = sum(_top1(policy, ex) for ex in corpus) / len(corpus)
    baseline_top1 = sum(_baseline_top1(ex) for ex in corpus) / len(corpus)
    report = TrainingReport(
        examples=len(corpus),
        epochs=epochs,
        train_top1=train_top1,
        baseline_top1=baseline_top1,
    )
    return policy, report


# --------------------------------------------------------------------------- #
# Batch scoring (Track-A go/no-go hook).
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class BatchScore:
    examples: int
    policy_top1: float
    baseline_top1: float

    @property
    def beats_baseline(self) -> bool:
        return self.policy_top1 > self.baseline_top1

    def as_dict(self) -> Dict[str, Any]:
        return {
            "examples": self.examples,
            "policy_top1": round(self.policy_top1, 4),
            "baseline_top1": round(self.baseline_top1, 4),
            "beats_baseline": self.beats_baseline,
        }


def batch_score_policy(
    policy: WeightedNextBestQuestionPolicy,
    corpus: Sequence[LabeledExample],
) -> BatchScore:
    """Top-1 accuracy of the policy vs the round-robin baseline on ``corpus``.

    Gate 4's pre-flight requires ``beats_baseline`` to be true on a held-out split
    before any human promotion. This is the Track-A batch-score check.
    """
    if not corpus:
        raise ValueError("cannot score an empty corpus")
    policy_top1 = sum(_top1(policy, ex) for ex in corpus) / len(corpus)
    baseline_top1 = sum(_baseline_top1(ex) for ex in corpus) / len(corpus)
    return BatchScore(
        examples=len(corpus),
        policy_top1=policy_top1,
        baseline_top1=baseline_top1,
    )


# --------------------------------------------------------------------------- #
# Artifact I/O.
# --------------------------------------------------------------------------- #
def save_policy_artifact(
    policy: WeightedNextBestQuestionPolicy,
    path: str | Path,
    *,
    extra_metadata: Mapping[str, Any] | None = None,
) -> Dict[str, Any]:
    """Serialise a trained policy to JSON. Does not promote it — still dark."""
    artifact = policy.to_artifact()
    if extra_metadata:
        artifact["metadata"] = {**artifact.get("metadata", {}), **dict(extra_metadata)}
    Path(path).write_text(json.dumps(artifact, indent=2, sort_keys=True), encoding="utf-8")
    return artifact


def load_policy_artifact(path: str | Path) -> WeightedNextBestQuestionPolicy:
    """Load a trained policy artifact. The caller must still gate ``promote()``."""
    artifact = json.loads(Path(path).read_text(encoding="utf-8"))
    return WeightedNextBestQuestionPolicy.from_artifact(artifact)


__all__ = [
    "POLICY_ARTIFACT_VERSION",
    "FEATURE_NAMES",
    "item_features",
    "WeightedNextBestQuestionPolicy",
    "LabeledExample",
    "load_corpus",
    "TrainingReport",
    "train_next_best_question_policy",
    "BatchScore",
    "batch_score_policy",
    "save_policy_artifact",
    "load_policy_artifact",
]
