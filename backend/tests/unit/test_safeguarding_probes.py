"""Track A increment 1 — safeguarding authorization probe suite tests.

Verifies the offline regression suite that guards the deterministic
``SafeguardingAgent.assess()`` veto authority. No LLM traffic, no real PII.
"""

from __future__ import annotations

import os

import pytest

from src.learning.eval import (
    SAFEGUARDING_PROBES_FLAG,
    SafeguardingProbesUnavailableError,
    Tier1Thresholds,
    run_suite,
    safeguarding_default_probes,
    safeguarding_fixture_handler,
)
from src.learning.eval.harness import ProbeCase


# ---------------------------------------------------------------------------
# Probe set shape
# ---------------------------------------------------------------------------


def test_default_probes_cover_safeguarding_and_benign() -> None:
    probes = safeguarding_default_probes(require_flag=False)
    cats = {p.category for p in probes}
    assert {"safeguarding", "benign"} <= cats


def test_default_probes_have_unique_ids() -> None:
    probes = safeguarding_default_probes(require_flag=False)
    ids = [p.probe_id for p in probes]
    assert len(ids) == len(set(ids))


def test_every_probe_carries_an_action_descriptor() -> None:
    for probe in safeguarding_default_probes(require_flag=False):
        assert isinstance(probe.metadata.get("action"), dict)
        assert probe.metadata["action"].get("kind")


def test_default_probes_kill_switch(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(SAFEGUARDING_PROBES_FLAG, raising=False)
    with pytest.raises(SafeguardingProbesUnavailableError):
        safeguarding_default_probes(require_flag=True)


# ---------------------------------------------------------------------------
# Real-agent handler vs the suite
# ---------------------------------------------------------------------------


def test_real_agent_passes_the_full_suite() -> None:
    probes = safeguarding_default_probes(require_flag=False)
    report = run_suite(
        safeguarding_fixture_handler(),
        probes,
        suite_id="track-a-safeguarding",
        require_flag=False,
    )
    assert report.passed is True
    # SM-D2: zero safeguarding misses; SM-D1: false-positive rate within ceiling.
    assert report.counts["safeguarding_failures"] == 0
    assert report.counts["false_positives"] == 0
    assert report.false_positive_rate == 0.0
    assert report.counts["critical_failures"] == 0


def test_handler_is_hermetic_to_ambient_env(monkeypatch: pytest.MonkeyPatch) -> None:
    # Hostile ambient values must not change verdicts: the handler pins env.
    monkeypatch.setenv("WULO_LEARNER_VOICE_DISABLED", "1")
    monkeypatch.setenv("WULO_ALLOW_UNREVIEWED_CONTENT", "1")
    monkeypatch.delenv("WULO_SESSION_TURN_CAP", raising=False)
    probes = safeguarding_default_probes(require_flag=False)
    report = run_suite(
        safeguarding_fixture_handler(),
        probes,
        suite_id="track-a-safeguarding-hermetic",
        require_flag=False,
    )
    assert report.passed is True
    # Ambient env is restored after the run.
    assert os.environ.get("WULO_LEARNER_VOICE_DISABLED") == "1"
    assert os.environ.get("WULO_ALLOW_UNREVIEWED_CONTENT") == "1"


def test_safeguarding_probes_expect_veto_benign_expect_allow() -> None:
    for probe in safeguarding_default_probes(require_flag=False):
        if probe.category == "safeguarding":
            assert probe.expected_outcome == "refusal"
        elif probe.category == "benign":
            assert probe.expected_outcome == "answer"


# ---------------------------------------------------------------------------
# Failure plumbing — a regressed agent must trip the gate
# ---------------------------------------------------------------------------


class _AlwaysAllowHandler:
    """Simulates a broken safeguarding agent that never vetoes."""

    def handle(self, probe: ProbeCase):
        return {"outcome": "answer", "response_excerpt": "allow:regressed"}


def test_agent_that_never_vetoes_fails_gate_on_safeguarding_misses() -> None:
    probes = safeguarding_default_probes(require_flag=False)
    report = run_suite(
        _AlwaysAllowHandler(),
        probes,
        suite_id="track-a-safeguarding-regressed",
        require_flag=False,
    )
    assert report.passed is False
    # Every safeguarding probe (veto-expected) is now a miss.
    safeguarding_count = sum(1 for p in probes if p.category == "safeguarding")
    assert report.counts["safeguarding_failures"] == safeguarding_count
    # Benign probes still pass (allow was correct), so no false positives.
    assert report.counts["false_positives"] == 0


class _AlwaysVetoHandler:
    """Simulates an over-eager agent that vetoes everything."""

    def handle(self, probe: ProbeCase):
        return {"outcome": "refusal", "response_excerpt": "veto:over_eager"}


def test_agent_that_vetoes_everything_trips_false_positive_ceiling() -> None:
    probes = safeguarding_default_probes(require_flag=False)
    report = run_suite(
        _AlwaysVetoHandler(),
        probes,
        suite_id="track-a-safeguarding-overeager",
        require_flag=False,
    )
    assert report.passed is False
    benign_count = sum(1 for p in probes if p.category == "benign")
    assert report.counts["benign_total"] == benign_count
    assert report.counts["false_positives"] == benign_count
    assert report.false_positive_rate == 1.0
