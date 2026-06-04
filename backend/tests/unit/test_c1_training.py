"""Track C / C1 — offline next-best-question training harness tests."""

from __future__ import annotations

import json

import pytest

from src.learning.eval.c1_training import (
    FEATURE_NAMES,
    POLICY_ARTIFACT_VERSION,
    WeightedNextBestQuestionPolicy,
    batch_score_policy,
    item_features,
    load_corpus,
    load_policy_artifact,
    save_policy_artifact,
    train_next_best_question_policy,
)
from src.learning.models import DiagnosticItem


def _item(item_id, skill_id, difficulty):
    return DiagnosticItem(
        item_id=item_id,
        skill_id=skill_id,
        prompt=f"prompt {item_id}",
        item_type="mcq",
        difficulty=difficulty,
        lang="en",
        provenance=[{"source": "test"}],
    )


def _corpus_doc():
    # Two skills; the labeled item is always the weakest-skill / boundary item,
    # and never first in candidate order, so the round-robin baseline is wrong.
    examples = []
    for i in range(12):
        weak = "maths.fractions"
        strong = "english.grammar"
        examples.append(
            {
                "example_id": f"ex{i:02d}",
                "prior_mastery": {
                    weak: {"kind": "beta", "probability": 0.2, "uncertainty": 0.8},
                    strong: {"kind": "beta", "probability": 0.85, "uncertainty": 0.2},
                },
                "candidates": [
                    {"item_id": f"ex{i:02d}-strong", "skill_id": strong, "difficulty": 1.0},
                    {"item_id": f"ex{i:02d}-weak", "skill_id": weak, "difficulty": -1.0},
                ],
                "label": f"ex{i:02d}-weak",
            }
        )
    return {"schema": "c1-nbq-corpus/1", "examples": examples}


# ------------------------------ features ------------------------------------ #
def test_feature_order_is_stable():
    assert FEATURE_NAMES == ("mastery_gap", "uncertainty", "difficulty_match")


def test_weak_skill_has_higher_gap():
    prior = {
        "weak": {"probability": 0.2, "uncertainty": 0.8},
        "strong": {"probability": 0.9, "uncertainty": 0.1},
    }
    weak = item_features(_item("a", "weak", 0.0), prior)
    strong = item_features(_item("b", "strong", 0.0), prior)
    assert weak[0] > strong[0]  # mastery_gap


def test_missing_mastery_uses_neutral_prior():
    feats = item_features(_item("a", "unknown", 0.0), {})
    assert feats[0] == pytest.approx(0.5)


# ------------------------------ training ------------------------------------ #
def test_train_beats_round_robin(tmp_path):
    path = tmp_path / "corpus.json"
    path.write_text(json.dumps(_corpus_doc()), encoding="utf-8")
    corpus = load_corpus(path)
    policy, report = train_next_best_question_policy(corpus, epochs=30)
    assert report.beats_baseline
    assert report.train_top1 > report.baseline_top1
    score = batch_score_policy(policy, corpus)
    assert score.beats_baseline


def test_train_empty_corpus_raises():
    with pytest.raises(ValueError):
        train_next_best_question_policy([])


# ------------------------------ artifact ------------------------------------ #
def test_artifact_roundtrip(tmp_path):
    policy = WeightedNextBestQuestionPolicy(weights=(6.0, 3.0, 5.0), bias=0.0)
    art_path = tmp_path / "policy.json"
    save_policy_artifact(policy, art_path, extra_metadata={"status": "SHADOW-UNPROMOTED"})
    loaded = load_policy_artifact(art_path)
    assert loaded.weights == policy.weights
    doc = json.loads(art_path.read_text(encoding="utf-8"))
    assert doc["version"] == POLICY_ARTIFACT_VERSION
    assert doc["metadata"]["status"] == "SHADOW-UNPROMOTED"


def test_artifact_rejects_bad_version():
    with pytest.raises(ValueError):
        WeightedNextBestQuestionPolicy.from_artifact(
            {"version": "other/9", "feature_names": list(FEATURE_NAMES), "weights": [1, 2, 3]}
        )


def test_artifact_rejects_wrong_feature_count():
    with pytest.raises(ValueError):
        WeightedNextBestQuestionPolicy.from_artifact(
            {
                "version": POLICY_ARTIFACT_VERSION,
                "feature_names": list(FEATURE_NAMES),
                "weights": [1.0, 2.0],
            }
        )


# ------------------------------ rank ---------------------------------------- #
def test_rank_orders_weak_skill_first():
    policy = WeightedNextBestQuestionPolicy(weights=(6.0, 3.0, 5.0), bias=0.0)
    prior = {
        "weak": {"probability": 0.2, "uncertainty": 0.8},
        "strong": {"probability": 0.9, "uncertainty": 0.1},
    }
    cands = [_item("s", "strong", 1.0), _item("w", "weak", -1.0)]
    ranked = policy.rank(cands, prior)
    assert ranked[0].item_id == "w"


def test_packaged_corpus_trains_and_beats_baseline():
    # The committed corpus must remain trainable and beat round-robin so gate 4's
    # batch-score precondition stays satisfiable.
    from pathlib import Path

    corpus_path = Path(__file__).resolve().parents[2] / "data" / "c1" / "next_best_question_corpus.json"
    if not corpus_path.exists():
        pytest.skip("packaged corpus not present")
    corpus = load_corpus(corpus_path)
    policy, _ = train_next_best_question_policy(corpus[: int(len(corpus) * 0.7)])
    held = batch_score_policy(policy, corpus[int(len(corpus) * 0.7) :])
    assert held.beats_baseline
