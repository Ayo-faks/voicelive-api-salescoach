"""Unit tests for the online rollback adapter (Track A, increment 5).

The adapter maps a gate report into a rollback *proposal* — action ∈
{hold, rollback}, ``proposal`` always True, never executed. Dark by default
behind ``AGENT_MESH_ENABLED`` + ``AGENT_MESH_ROLLBACK_V1``.
"""

from __future__ import annotations

import pytest

from src.agents.observability_gate import (
    STATUS_BLOCKED,
    STATUS_DEGRADED,
    STATUS_DISABLED,
    STATUS_ERROR,
    STATUS_OK,
    ObservabilityReport,
)
from src.agents.rollback_adapter import (
    ACTION_HOLD,
    ACTION_ROLLBACK,
    ROLLBACK_FLAG,
    RollbackAdapter,
    RollbackDecision,
    rollback_adapter_enabled,
)

MESH_FLAG = "AGENT_MESH_ENABLED"


@pytest.fixture
def enabled(monkeypatch):
    """Turn both kill-switches on for the duration of a test."""
    monkeypatch.setenv(MESH_FLAG, "1")
    monkeypatch.setenv(ROLLBACK_FLAG, "1")
    return None


# --- dark-by-default --------------------------------------------------------

def test_disabled_when_both_flags_unset(monkeypatch):
    monkeypatch.delenv(MESH_FLAG, raising=False)
    monkeypatch.delenv(ROLLBACK_FLAG, raising=False)
    assert rollback_adapter_enabled() is False
    decision = RollbackAdapter().decide(ObservabilityReport(status=STATUS_BLOCKED))
    assert decision.action == ACTION_HOLD
    assert decision.disabled is True
    assert decision.proposal is True
    assert decision.should_rollback is False


def test_disabled_when_only_mesh_flag_set(monkeypatch):
    monkeypatch.setenv(MESH_FLAG, "1")
    monkeypatch.delenv(ROLLBACK_FLAG, raising=False)
    assert rollback_adapter_enabled() is False
    decision = RollbackAdapter().decide(ObservabilityReport(status=STATUS_BLOCKED))
    assert decision.action == ACTION_HOLD
    assert decision.disabled is True


def test_disabled_when_only_feature_flag_set(monkeypatch):
    monkeypatch.delenv(MESH_FLAG, raising=False)
    monkeypatch.setenv(ROLLBACK_FLAG, "1")
    assert rollback_adapter_enabled() is False
    decision = RollbackAdapter().decide(ObservabilityReport(status=STATUS_BLOCKED))
    assert decision.action == ACTION_HOLD
    assert decision.disabled is True


def test_force_evaluates_even_when_dark(monkeypatch):
    monkeypatch.delenv(MESH_FLAG, raising=False)
    monkeypatch.delenv(ROLLBACK_FLAG, raising=False)
    decision = RollbackAdapter().decide(
        ObservabilityReport(status=STATUS_BLOCKED), force=True
    )
    assert decision.action == ACTION_ROLLBACK
    assert decision.disabled is False
    assert decision.should_rollback is True


# --- decision rule (enabled) ------------------------------------------------

def test_blocked_report_proposes_rollback(enabled):
    report = ObservabilityReport(
        status=STATUS_BLOCKED, reasons=("safeguarding_gate_failed",)
    )
    decision = RollbackAdapter().decide(report)
    assert decision.action == ACTION_ROLLBACK
    assert decision.should_rollback is True
    assert decision.disabled is False
    assert "safeguarding_gate_failed" in decision.reasons
    assert decision.gate_status == STATUS_BLOCKED


def test_error_report_proposes_rollback(enabled):
    decision = RollbackAdapter().decide(ObservabilityReport(status=STATUS_ERROR))
    assert decision.action == ACTION_ROLLBACK
    assert decision.should_rollback is True


@pytest.mark.parametrize("status", [STATUS_OK, STATUS_DEGRADED, STATUS_DISABLED])
def test_non_blocking_statuses_hold(enabled, status):
    decision = RollbackAdapter().decide(ObservabilityReport(status=status))
    assert decision.action == ACTION_HOLD
    assert decision.should_rollback is False
    assert decision.holds is True


def test_gate_passed_false_proposes_rollback(enabled):
    # A mapping that says the gate did not pass, even with an unknown status.
    decision = RollbackAdapter().decide({"status": "weird", "gate_passed": False})
    assert decision.action == ACTION_ROLLBACK
    assert decision.should_rollback is True


def test_gate_passed_true_holds(enabled):
    decision = RollbackAdapter().decide({"status": STATUS_OK, "gate_passed": True})
    assert decision.action == ACTION_HOLD


# --- duck-typing / input shapes ---------------------------------------------

def test_accepts_as_dict_payload(enabled):
    report = ObservabilityReport(status=STATUS_BLOCKED, reasons=("x",))
    decision = RollbackAdapter().decide(report.as_dict())
    assert decision.action == ACTION_ROLLBACK
    assert decision.gate_status == STATUS_BLOCKED


def test_reasons_string_is_wrapped(enabled):
    decision = RollbackAdapter().decide({"status": STATUS_BLOCKED, "reasons": "single"})
    assert decision.reasons == ("single",)


# --- non-raising / fail-safe ------------------------------------------------

def test_unreadable_report_holds(enabled):
    decision = RollbackAdapter().decide(object())
    assert decision.action == ACTION_HOLD
    assert decision.should_rollback is False
    assert decision.checks.get("readable") is False


def test_none_report_holds(enabled):
    decision = RollbackAdapter().decide(None)
    assert decision.action == ACTION_HOLD
    assert decision.should_rollback is False


def test_blocked_without_reasons_gets_default_reason(enabled):
    decision = RollbackAdapter().decide(ObservabilityReport(status=STATUS_BLOCKED))
    assert decision.action == ACTION_ROLLBACK
    assert decision.reasons  # non-empty default reason synthesised


# --- proposal invariants ----------------------------------------------------

def test_proposal_always_true_and_serialisable(enabled):
    import json

    for report in (
        ObservabilityReport(status=STATUS_BLOCKED),
        ObservabilityReport(status=STATUS_OK),
        object(),
    ):
        decision = RollbackAdapter().decide(report)
        assert decision.proposal is True
        assert decision.action in (ACTION_HOLD, ACTION_ROLLBACK)
        json.dumps(decision.as_dict())  # must not raise


def test_decision_is_frozen():
    decision = RollbackDecision(action=ACTION_HOLD)
    with pytest.raises(Exception):
        decision.action = ACTION_ROLLBACK  # type: ignore[misc]
