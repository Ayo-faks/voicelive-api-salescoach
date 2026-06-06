"""Deterministic generator for the committed calibration fixture.

Reproduces ``src/learning/eval/fixtures/calibration_events.json`` exactly from a
fixed seed. The fixture is a *fair* synthetic dataset: each learner has a latent
ability and each item a signed difficulty, and the outcome is a Bernoulli draw
from the TRUE probability ``logistic(ability - difficulty)``. It never peeks at
any estimator's internal state, so a well-calibrated estimator should recover the
true probabilities while a mis-calibrated one will not.

Usage (offline, no deps beyond the stdlib)::

    python scripts/gen_calibration_fixture.py            # rewrite the fixture
    python scripts/gen_calibration_fixture.py --check    # fail if out of date
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
from pathlib import Path

SEED = 20260606
N_LEARNERS = 40
ITEMS_PER_LEARNER = 25
# Signed difficulty buckets spanning easy/medium/hard. The estimators map
# ``item_difficulty * 100`` onto Elo rating points; the domain is [-5, 5].
DIFFICULTIES = (-2.0, -1.0, 0.0, 1.0, 2.0)

FIXTURE_PATH = (
    Path(__file__).resolve().parents[1] / "src" / "learning" / "eval" / "fixtures" / "calibration_events.json"
)


def _logistic(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


def build_fixture() -> dict:
    rng = random.Random(SEED)
    sequences = []
    total = 0
    correct = 0
    for _ in range(N_LEARNERS):
        ability = rng.gauss(0.0, 1.2)
        seq = []
        for _ in range(ITEMS_PER_LEARNER):
            diff = rng.choice(DIFFICULTIES)
            p_true = _logistic(ability - diff)
            is_correct = rng.random() < p_true
            seq.append({"item_difficulty": diff, "correct": bool(is_correct)})
            total += 1
            correct += int(is_correct)
        sequences.append(seq)

    return {
        "schema": "calibration_events.v1",
        "generated_by": "scripts/gen_calibration_fixture.py",
        "seed": SEED,
        "model": (
            "P(correct) = logistic(ability - difficulty); ability ~ N(0, 1.2); "
            "difficulty in [-2,-1,0,1,2]; outcomes ~ Bernoulli(P_true)"
        ),
        "n_learners": N_LEARNERS,
        "items_per_learner": ITEMS_PER_LEARNER,
        "count": total,
        "base_rate": round(correct / total, 6),
        "sequences": sequences,
    }


def _serialise(fixture: dict) -> str:
    return json.dumps(fixture, indent=2) + "\n"


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="generate the calibration fixture")
    parser.add_argument(
        "--check",
        action="store_true",
        help="exit non-zero if the committed fixture differs from a fresh build",
    )
    args = parser.parse_args(argv)

    fixture = build_fixture()
    rendered = _serialise(fixture)

    if args.check:
        existing = FIXTURE_PATH.read_text(encoding="utf-8") if FIXTURE_PATH.exists() else ""
        if existing != rendered:
            print(f"[stale] {FIXTURE_PATH} is out of date; run gen_calibration_fixture.py", file=sys.stderr)
            return 1
        print(f"[ok] {FIXTURE_PATH} matches the seeded generator", file=sys.stderr)
        return 0

    FIXTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE_PATH.write_text(rendered, encoding="utf-8")
    print(f"[ok] wrote {fixture['count']} events (base_rate {fixture['base_rate']}) to {FIXTURE_PATH}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
