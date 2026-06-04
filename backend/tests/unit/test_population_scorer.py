"""Track B / B1 + B2 — synthetic population model + outcome scorer tests."""

from __future__ import annotations

import pytest

from src.learning.eval.personas import (
    SYNTHETIC_PERSONAS_FLAG,
    Persona,
    PersonaTurn,
    SyntheticPersonasUnavailableError,
    default_personas,
)
from src.learning.eval.population_scorer import (
    POPULATION_SCORER_FLAG,
    ABComparison,
    PopulationReport,
    PopulationScorer,
    PopulationScorerUnavailableError,
    population_fixture_handler,
)
from src.agents.durable_sink import InMemoryDurableSink
from src.agents.drift_detector import DriftDetector


# ----------------------------- B1: personas --------------------------------- #

@pytest.fixture(autouse=True)
def _clear(monkeypatch):
    monkeypatch.delenv(SYNTHETIC_PERSONAS_FLAG, raising=False)
    monkeypatch.delenv(POPULATION_SCORER_FLAG, raising=False)
    yield


def test_personas_dark_by_default():
    with pytest.raises(SyntheticPersonasUnavailableError):
        default_personas()


def test_personas_flag_bypass_returns_all_archetypes():
    population = default_personas(require_flag=False)
    archetypes = {p.archetype for p in population}
    assert archetypes == {
        "curious_on_topic",
        "off_topic_drifter",
        "frustrated_repeater",
        "consent_edge",
        "safeguarding_probe",
    }
    # every turn carries a ground-truth label
    assert all(t.expected_outcome for p in population for t in p.turns)


def test_personas_replicas_scale_population():
    one = default_personas(require_flag=False, replicas=1)
    three = default_personas(require_flag=False, replicas=3)
    assert len(three) == len(one) * 3
    assert len({p.persona_id for p in three}) == len(three)  # unique ids


def test_replicas_must_be_positive():
    with pytest.raises(ValueError):
        default_personas(require_flag=False, replicas=0)


# ----------------------------- B2: scorer ----------------------------------- #

def test_scorer_dark_by_default():
    personas = default_personas(require_flag=False)
    with pytest.raises(PopulationScorerUnavailableError):
        PopulationScorer().score(personas, population_fixture_handler())


def test_fixture_handler_scores_perfect_on_ground_truth(monkeypatch):
    monkeypatch.setenv(POPULATION_SCORER_FLAG, "1")
    personas = default_personas(require_flag=False)
    report = PopulationScorer().score(personas, population_fixture_handler())

    assert isinstance(report, PopulationReport)
    assert report.persona_count == len(personas)
    assert report.mismatches == ()
    assert report.overall.accuracy == 1.0
    assert report.overall.precision == 1.0
    assert report.overall.recall == 1.0
    assert report.overall.false_positive_rate == 0.0
    # per-agent slices exist for each surface the population exercises
    assert {"tutor", "safeguarding", "consent", "session"} <= set(report.per_agent)


def test_scorer_feeds_durable_sink_and_drift(monkeypatch):
    monkeypatch.setenv(POPULATION_SCORER_FLAG, "1")
    personas = default_personas(require_flag=False, replicas=3)
    sink = InMemoryDurableSink()

    report = PopulationScorer().score(personas, population_fixture_handler(), sink=sink)

    turn_total = sum(len(p.turns) for p in personas)
    assert report.recorded == turn_total
    assert len(sink) == turn_total
    # drift detector can read the population verdicts from the sink without error
    signal = DriftDetector(kind="population", min_samples=1).assess(sink, force=True)
    assert signal.metric == "veto_rate"
    assert 0.0 <= signal.observed <= 1.0


def test_regressed_handler_drops_recall_and_raises_false_positives(monkeypatch):
    monkeypatch.setenv(POPULATION_SCORER_FLAG, "1")
    personas = default_personas(require_flag=False)

    class _Regressed:
        """Always answers: never intervenes, and over-answers benign turns."""

        def handle(self, turn: PersonaTurn):
            # invert: refuse the benign citation turns, allow everything else
            if turn.expected_outcome == "citation":
                return {"outcome": "refusal"}
            return {"outcome": "answer"}

    report = PopulationScorer().score(personas, _Regressed())

    assert report.mismatches  # the regression is detected
    # safeguarding/consent/session interventions were missed → recall < 1
    assert report.overall.recall < 1.0
    # the curious-on-topic citations were wrongly refused → false positives
    assert report.overall.false_positive_rate > 0.0


def test_ab_harness_compares_versions(monkeypatch):
    monkeypatch.setenv(POPULATION_SCORER_FLAG, "1")
    personas = default_personas(require_flag=False)

    class _Worse:
        def handle(self, turn: PersonaTurn):
            return {"outcome": "answer"}  # never intervenes

    comparison = PopulationScorer().compare(
        personas, population_fixture_handler(), _Worse()
    )

    assert isinstance(comparison, ABComparison)
    # version A (good) beats version B (worse) on recall → delta negative
    assert comparison.delta["recall"] < 0.0
    assert comparison.report_a.overall.recall > comparison.report_b.overall.recall
    assert comparison.as_dict()["delta"]["recall"] < 0.0


def test_report_is_json_serialisable(monkeypatch):
    import json

    monkeypatch.setenv(POPULATION_SCORER_FLAG, "1")
    personas = default_personas(require_flag=False)
    report = PopulationScorer().score(personas, population_fixture_handler())
    json.dumps(report.as_dict())  # must not raise
