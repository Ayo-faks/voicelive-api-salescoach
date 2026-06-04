"""Track A increment 2 — critic quality probe suite tests.

Verifies the offline regression suite that guards the deterministic
``CriticAgent.review()`` quality reviewer. No LLM traffic, no real PII.
"""

from __future__ import annotations

import os

import pytest

from src.learning.eval import (
    CRITIC_PROBES_FLAG,
    CriticProbesUnavailableError,
    critic_default_probes,
    critic_fixture_handler,
    run_suite,
)
from src.learning.eval.harness import ProbeCase


# ---------------------------------------------------------------------------
# Probe set shape
# ---------------------------------------------------------------------------


def test_default_probes_cover_quality_and_benign() -> None:
    probes = critic_default_probes(require_flag=False)
    cats = {p.category for p in probes}
    assert {"answer_quality", "benign"} <= cats


def test_default_probes_have_unique_ids() -> None:
    probes = critic_default_probes(require_flag=False)
    ids = [p.probe_id for p in probes]
    assert len(ids) == len(set(ids))


def test_every_probe_carries_a_result_descriptor() -> None:
    for probe in critic_default_probes(require_flag=False):
        assert isinstance(probe.metadata.get("result"), dict)


def test_default_probes_kill_switch(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(CRITIC_PROBES_FLAG, raising=False)
    with pytest.raises(CriticProbesUnavailableError):
        critic_default_probes(require_flag=True)


# ---------------------------------------------------------------------------
# Real-agent handler vs the suite
# ---------------------------------------------------------------------------


def test_real_agent_passes_the_full_suite() -> None:
    probes = critic_default_probes(require_flag=False)
    report = run_suite(
        critic_fixture_handler(),
        probes,
        suite_id="track-a-critic",
        require_flag=False,
    )
    assert report.passed is True
    assert report.counts["false_positives"] == 0
    assert report.false_positive_rate == 0.0
    assert report.counts["critical_failures"] == 0


def test_quality_probes_expect_violation_benign_expect_answer() -> None:
    for probe in critic_default_probes(require_flag=False):
        if probe.category == "answer_quality":
            assert probe.expected_outcome == "violation"
        elif probe.category == "benign":
            assert probe.expected_outcome == "answer"


def test_warn_only_results_do_not_demand_revision() -> None:
    # The uncited-claim and oversized probes are WARN-only: they must map to
    # "answer" (not blocked), proving warnings alone never trigger a revision.
    handler = critic_fixture_handler()
    by_id = {p.probe_id: p for p in critic_default_probes(require_flag=False)}
    for pid in (
        "critic-warn-uncited-claim-not-blocking",
        "critic-warn-oversized-not-blocking",
    ):
        out = handler.handle(by_id[pid])
        assert out["outcome"] == "answer"


def test_handler_is_hermetic_to_ambient_guardrail_env(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # A hostile ambient guardrail must not change verdicts: the handler pins it.
    monkeypatch.setenv("CRITIC_MAX_ANSWER_CHARS", "5")
    probes = critic_default_probes(require_flag=False)
    report = run_suite(
        critic_fixture_handler(),
        probes,
        suite_id="track-a-critic-hermetic",
        require_flag=False,
    )
    assert report.passed is True
    assert os.environ.get("CRITIC_MAX_ANSWER_CHARS") == "5"


# ---------------------------------------------------------------------------
# Failure plumbing — a regressed critic must trip the gate
# ---------------------------------------------------------------------------


class _AlwaysCleanHandler:
    """Simulates a broken critic that never demands a revision."""

    def handle(self, probe: ProbeCase):
        return {"outcome": "answer", "response_excerpt": "ok:"}


def test_critic_that_never_flags_fails_gate_on_quality_misses() -> None:
    probes = critic_default_probes(require_flag=False)
    report = run_suite(
        _AlwaysCleanHandler(),
        probes,
        suite_id="track-a-critic-regressed",
        require_flag=False,
    )
    assert report.passed is False
    quality_count = sum(1 for p in probes if p.category == "answer_quality")
    # Every answer_quality probe (violation-expected) is now a miss.
    assert (
        sum(
            1
            for r in report.results
            if not r.passed and r.category == "answer_quality"
        )
        == quality_count
    )
    # The gate fails on the quality misses regardless of benign plumbing.
    assert report.passed is False


class _AlwaysViolationHandler:
    """Simulates an over-eager critic that blocks everything."""

    def handle(self, probe: ProbeCase):
        return {"outcome": "violation", "response_excerpt": "critical:over_eager"}


def test_critic_that_blocks_everything_trips_false_positive_ceiling() -> None:
    probes = critic_default_probes(require_flag=False)
    report = run_suite(
        _AlwaysViolationHandler(),
        probes,
        suite_id="track-a-critic-overeager",
        require_flag=False,
    )
    assert report.passed is False
    benign_count = sum(1 for p in probes if p.category == "benign")
    assert report.counts["benign_total"] == benign_count
    assert report.counts["false_positives"] == benign_count
    assert report.false_positive_rate == 1.0


import os  # noqa: E402


import os  # noqa: E402
