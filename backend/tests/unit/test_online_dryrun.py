"""Online dry-run proof (Track A, increment 6b, decision D3).

Proves the continuous SHADOW path end to end on deterministic handlers — NO real
traffic, NO PII, NO infra:

    record (gate cycle) → durable sink → drift computation → rollback PROPOSAL

Invariants asserted:

* Shadow runs never set ``exit_code=1`` from blocking *live traffic* (a clean
  cycle exits 0; only a hard probe regression blocks, which is the offline gate's
  job, not live shadow).
* The durable sink accumulates ``N`` cycles of records.
* The drift detector returns a :class:`DriftSignal` (a signal object, never an
  exception).
* The rollback adapter returns a :class:`RollbackDecision` whose ``action`` is in
  ``{hold, rollback}`` and which is a **proposal only** (never executed).
* ``AGENT_MESH_ENABLED`` unset ⇒ the whole loop is a no-op (DISABLED, exit 0, the
  sink is never written).
"""

from __future__ import annotations

import pytest

from src.agents.drift_detector import DRIFT_FLAG, DriftDetector, DriftSignal
from src.agents.durable_sink import InMemoryDurableSink
from src.agents.memory_agent import MemoryAgent
from src.agents.observability_gate import (
    STATUS_BLOCKED,
    STATUS_DISABLED,
    ObservabilityGate,
)
from src.agents.rollback_adapter import (
    ACTION_HOLD,
    ACTION_ROLLBACK,
    ROLLBACK_FLAG,
    RollbackAdapter,
    RollbackDecision,
)
from src.learning.eval import (
    CRITIC_PROBES_FLAG,
    SAFEGUARDING_PROBES_FLAG,
    critic_fixture_handler,
    safeguarding_fixture_handler,
)

MESH_FLAG = "AGENT_MESH_ENABLED"
N_CYCLES = 5


@pytest.fixture
def all_flags(monkeypatch):
    """Enable mesh + both probe suites + drift + rollback for the loop."""
    monkeypatch.setenv(MESH_FLAG, "1")
    monkeypatch.setenv(SAFEGUARDING_PROBES_FLAG, "1")
    monkeypatch.setenv(CRITIC_PROBES_FLAG, "1")
    monkeypatch.setenv(DRIFT_FLAG, "1")
    monkeypatch.setenv(ROLLBACK_FLAG, "1")
    return None


def _run_shadow_loop(n, *, sink, require_probe_flag=False):
    """Run the gate in shadow ``n`` times against deterministic handlers."""
    gate = ObservabilityGate(memory=MemoryAgent(capacity=1024))
    safeguarding = safeguarding_fixture_handler()
    critic = critic_fixture_handler()
    reports = []
    for _ in range(n):
        report = gate.run_cycle(
            safeguarding_handler=safeguarding,
            critic_handler=critic,
            require_probe_flag=require_probe_flag,
            durable_sink=sink,
            force=True,
        )
        reports.append(report)
    return gate, reports


# --- the loop runs and records ----------------------------------------------

def test_shadow_loop_records_to_sink(all_flags):
    sink = InMemoryDurableSink()
    gate, reports = _run_shadow_loop(N_CYCLES, sink=sink)
    # Each clean cycle records safeguarding + critic verdicts.
    assert len(sink) == N_CYCLES * 2
    counts = sink.counts_by_kind()
    assert counts.get("safeguarding") == N_CYCLES
    assert counts.get("critic") == N_CYCLES


def test_shadow_never_exits_nonzero_with_clean_handlers(all_flags):
    sink = InMemoryDurableSink()
    _, reports = _run_shadow_loop(N_CYCLES, sink=sink)
    for report in reports:
        assert report.exit_code == 0
        assert report.status != STATUS_BLOCKED


# --- drift step returns a signal --------------------------------------------

def test_drift_detector_returns_signal_from_loop(all_flags):
    sink = InMemoryDurableSink()
    gate, _ = _run_shadow_loop(N_CYCLES, sink=sink)
    signal = DriftDetector().assess(gate.memory)
    assert isinstance(signal, DriftSignal)


# --- rollback step is a proposal only ---------------------------------------

def test_rollback_proposal_only_from_clean_report(all_flags):
    sink = InMemoryDurableSink()
    _, reports = _run_shadow_loop(N_CYCLES, sink=sink)
    decision = RollbackAdapter().decide(reports[-1])
    assert isinstance(decision, RollbackDecision)
    assert decision.proposal is True
    assert decision.action in (ACTION_HOLD, ACTION_ROLLBACK)


def test_rollback_proposes_rollback_on_blocked_report(all_flags):
    from src.agents.observability_gate import ObservabilityReport

    decision = RollbackAdapter().decide(
        ObservabilityReport(status=STATUS_BLOCKED, reasons=("safeguarding_gate_failed",))
    )
    assert decision.action == ACTION_ROLLBACK
    assert decision.proposal is True  # still a proposal — never executed
    assert decision.should_rollback is True


# --- full pipeline in one flow ----------------------------------------------

def test_end_to_end_record_sink_drift_rollback(all_flags):
    sink = InMemoryDurableSink()
    gate, reports = _run_shadow_loop(N_CYCLES, sink=sink)

    # record → sink
    assert len(sink) > 0
    # sink → drift
    signal = DriftDetector().assess(gate.memory)
    assert isinstance(signal, DriftSignal)
    # report → rollback proposal
    decision = RollbackAdapter().decide(reports[-1])
    assert decision.proposal is True
    assert decision.action in (ACTION_HOLD, ACTION_ROLLBACK)


# --- mesh-off ⇒ no-op --------------------------------------------------------

def test_mesh_disabled_loop_is_noop(monkeypatch):
    monkeypatch.delenv(MESH_FLAG, raising=False)
    monkeypatch.delenv(DRIFT_FLAG, raising=False)
    monkeypatch.delenv(ROLLBACK_FLAG, raising=False)
    sink = InMemoryDurableSink()
    gate = ObservabilityGate(memory=MemoryAgent())
    # force=False here — exercise the real dark-by-default guard.
    for _ in range(N_CYCLES):
        report = gate.run_cycle(
            safeguarding_handler=safeguarding_fixture_handler(),
            critic_handler=critic_fixture_handler(),
            durable_sink=sink,
        )
        assert report.status == STATUS_DISABLED
        assert report.exit_code == 0
    # No-op: nothing recorded, sink untouched.
    assert len(sink) == 0
    assert len(gate.memory) == 0
    # Drift + rollback also stay dark.
    assert DriftDetector().assess(gate.memory).disabled is True
    assert RollbackAdapter().decide(None).disabled is True
