"""Unit tests for the online drift detector (Track A, increment 6).

Computes the safeguarding veto-rate drift over recorded history and returns a
monitoring-only :class:`DriftSignal`. Dark by default behind
``AGENT_MESH_ENABLED`` + ``AGENT_MESH_DRIFT_V1``.
"""

from __future__ import annotations

import pytest

from src.agents.drift_detector import (
    DEFAULT_MIN_SAMPLES,
    DRIFT_FLAG,
    DriftDetector,
    DriftSignal,
    drift_detector_enabled,
)
from src.agents.memory_agent import MemoryAgent

MESH_FLAG = "AGENT_MESH_ENABLED"


@pytest.fixture
def enabled(monkeypatch):
    monkeypatch.setenv(MESH_FLAG, "1")
    monkeypatch.setenv(DRIFT_FLAG, "1")
    return None


class _Verdict:
    """Minimal safeguarding-verdict double recordable by MemoryAgent."""

    def __init__(self, allowed: bool):
        self.allowed = allowed

    def as_dict(self):
        return {"allowed": self.allowed, "reason": "ok" if self.allowed else "veto"}


def _memory_with(pattern):
    """Build a MemoryAgent recording safeguarding verdicts for a bool pattern."""
    mem = MemoryAgent(capacity=512)
    for allowed in pattern:
        mem.record("safeguarding", _Verdict(allowed))
    return mem


# --- dark-by-default --------------------------------------------------------

def test_disabled_when_flags_unset(monkeypatch):
    monkeypatch.delenv(MESH_FLAG, raising=False)
    monkeypatch.delenv(DRIFT_FLAG, raising=False)
    assert drift_detector_enabled() is False
    mem = _memory_with([True] * 10 + [False] * 10)
    signal = DriftDetector().assess(mem)
    assert signal.drifted is False
    assert signal.disabled is True


def test_disabled_when_only_one_flag(monkeypatch):
    monkeypatch.setenv(MESH_FLAG, "1")
    monkeypatch.delenv(DRIFT_FLAG, raising=False)
    assert drift_detector_enabled() is False
    signal = DriftDetector().assess(_memory_with([True, False] * 10))
    assert signal.disabled is True
    assert signal.drifted is False


def test_force_evaluates_when_dark(monkeypatch):
    monkeypatch.delenv(MESH_FLAG, raising=False)
    monkeypatch.delenv(DRIFT_FLAG, raising=False)
    # baseline all-allow, observed all-veto → big drift.
    mem = _memory_with([True] * 12 + [False] * 12)
    signal = DriftDetector().assess(mem, force=True)
    assert signal.disabled is False
    assert signal.drifted is True
    assert signal.delta > 0


# --- detection rule (enabled) -----------------------------------------------

def test_detects_rising_veto_rate(enabled):
    # First half all allowed (rate 0.0), second half all vetoed (rate 1.0).
    mem = _memory_with([True] * 12 + [False] * 12)
    signal = DriftDetector(threshold=0.2).assess(mem)
    assert signal.drifted is True
    assert signal.baseline == pytest.approx(0.0)
    assert signal.observed == pytest.approx(1.0)
    assert signal.delta == pytest.approx(1.0)
    assert signal.reasons


def test_detects_falling_veto_rate(enabled):
    mem = _memory_with([False] * 12 + [True] * 12)
    signal = DriftDetector(threshold=0.2).assess(mem)
    assert signal.drifted is True
    assert signal.delta < 0


def test_stable_rate_no_drift(enabled):
    # Even split throughout → baseline ≈ observed → no drift.
    mem = _memory_with([True, False] * 12)
    signal = DriftDetector(threshold=0.2).assess(mem)
    assert signal.drifted is False


def test_explicit_baseline(enabled):
    # All vetoes vs an explicit low baseline → drift.
    mem = _memory_with([False] * 12)
    signal = DriftDetector(threshold=0.2).assess(mem, baseline=0.05)
    assert signal.drifted is True
    assert signal.baseline == pytest.approx(0.05)
    assert signal.observed == pytest.approx(1.0)


def test_threshold_respected(enabled):
    # delta 1.0 but threshold above it → no drift.
    mem = _memory_with([True] * 12 + [False] * 12)
    signal = DriftDetector(threshold=2.0).assess(mem)
    assert signal.drifted is False


# --- under-powered / fail-safe ----------------------------------------------

def test_under_powered_history_is_disabled(enabled):
    mem = _memory_with([True, False, True])  # < DEFAULT_MIN_SAMPLES observed
    signal = DriftDetector().assess(mem)
    assert signal.disabled is True
    assert signal.drifted is False
    assert signal.sample_size < DEFAULT_MIN_SAMPLES


def test_unreadable_source_no_drift(enabled):
    signal = DriftDetector().assess(object())
    assert signal.drifted is False
    # empty history → under-powered → disabled
    assert signal.sample_size == 0


def test_none_source_no_drift(enabled):
    signal = DriftDetector().assess(None)
    assert signal.drifted is False


# --- input shapes -----------------------------------------------------------

def test_accepts_list_of_dicts(enabled):
    records = [{"kind": "safeguarding", "payload": {"allowed": True}}] * 12 + [
        {"kind": "safeguarding", "payload": {"allowed": False}}
    ] * 12
    signal = DriftDetector(threshold=0.2).assess(records)
    assert signal.drifted is True


def test_veto_rate_helper():
    det = DriftDetector()
    assert det.veto_rate([]) == 0.0
    recs = [{"payload": {"allowed": False}}, {"payload": {"allowed": True}}]
    assert det.veto_rate(recs) == pytest.approx(0.5)


# --- proposal/serialisation invariants --------------------------------------

def test_signal_serialisable(enabled):
    import json

    signal = DriftDetector().assess(_memory_with([True] * 12 + [False] * 12))
    json.dumps(signal.as_dict())


def test_signal_is_frozen():
    signal = DriftSignal(drifted=False)
    with pytest.raises(Exception):
        signal.drifted = True  # type: ignore[misc]
