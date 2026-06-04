"""Track B / B3 — staging load/stress driver tests.

Covers the mandatory notifier→sink pre-flight gate, the suspended ``run``
contract, and a forced in-process ramp (no real infrastructure touched).
"""

from __future__ import annotations

import pytest

from src.learning.eval.b3_driver import (
    B3_DRIVER_FLAG,
    MESH_ENABLED_FLAG,
    SINK_KIND_CAPTURE,
    SINK_KIND_STRESS,
    B3Config,
    B3Driver,
    B3PreflightError,
    B3SuspendedError,
    CaptureSinkNotifier,
    HumanPagingNotifier,
    b3_driver_enabled,
    default_component_probes,
    make_capacity_probe,
)
from src.agents.durable_sink import InMemoryDurableSink


@pytest.fixture(autouse=True)
def _clear(monkeypatch):
    monkeypatch.delenv(MESH_ENABLED_FLAG, raising=False)
    monkeypatch.delenv(B3_DRIVER_FLAG, raising=False)
    yield


def _enable(monkeypatch):
    monkeypatch.setenv(MESH_ENABLED_FLAG, "1")
    monkeypatch.setenv(B3_DRIVER_FLAG, "1")


def _config(sink, **overrides):
    base = dict(
        environment="staging",
        operator="ops-alice",
        notifier=CaptureSinkNotifier(sink),
        sink=sink,
        target_sessions=10,
        max_sessions=10,
        ramp_step=10,
        concurrency=4,
    )
    base.update(overrides)
    return B3Config(**base)


# ------------------------------- flags -------------------------------------- #
def test_dark_by_default(monkeypatch):
    assert b3_driver_enabled() is False


def test_enabled_requires_both_flags(monkeypatch):
    monkeypatch.setenv(MESH_ENABLED_FLAG, "1")
    assert b3_driver_enabled() is False
    monkeypatch.setenv(B3_DRIVER_FLAG, "1")
    assert b3_driver_enabled() is True


# ----------------------------- pre-flight gate ------------------------------ #
def test_preflight_passes_with_capture_notifier(monkeypatch):
    _enable(monkeypatch)
    sink = InMemoryDurableSink()
    result = B3Driver().preflight(_config(sink))
    assert result.passed is True
    assert result.failures == ()


def test_preflight_rejects_real_paging_channel(monkeypatch):
    _enable(monkeypatch)
    sink = InMemoryDurableSink()
    cfg = _config(sink, notifier=HumanPagingNotifier(("email", "pager")))
    result = B3Driver().preflight(cfg)
    assert result.passed is False
    names = {c.name for c in result.failures}
    assert "notifier_capture_only" in names


def test_preflight_rejects_production_environment(monkeypatch):
    _enable(monkeypatch)
    sink = InMemoryDurableSink()
    result = B3Driver().preflight(_config(sink, environment="prod-staging"))
    assert result.passed is False
    assert "non_prod_target" in {c.name for c in result.failures}


def test_preflight_rejects_missing_operator(monkeypatch):
    _enable(monkeypatch)
    sink = InMemoryDurableSink()
    result = B3Driver().preflight(_config(sink, operator="  "))
    assert "named_operator" in {c.name for c in result.failures}


def test_preflight_rejects_missing_flags(monkeypatch):
    # flags NOT set
    sink = InMemoryDurableSink()
    result = B3Driver().preflight(_config(sink))
    assert "feature_flags_set" in {c.name for c in result.failures}


def test_preflight_rejects_missing_sink(monkeypatch):
    _enable(monkeypatch)
    sink = InMemoryDurableSink()
    cfg = _config(sink)
    object.__setattr__(cfg, "sink", None)
    result = B3Driver().preflight(cfg)
    assert "output_to_sink" in {c.name for c in result.failures}


# ------------------------------ run contract -------------------------------- #
def test_run_suspended_without_force(monkeypatch):
    _enable(monkeypatch)
    sink = InMemoryDurableSink()
    with pytest.raises(B3SuspendedError):
        B3Driver().run(_config(sink), force=False)


def test_run_raises_preflight_error_when_gate_fails(monkeypatch):
    _enable(monkeypatch)
    sink = InMemoryDurableSink()
    cfg = _config(sink, notifier=HumanPagingNotifier(("teams",)))
    with pytest.raises(B3PreflightError):
        B3Driver().run(cfg, force=True)


def test_run_suspended_after_suspend(monkeypatch):
    _enable(monkeypatch)
    sink = InMemoryDurableSink()
    driver = B3Driver()
    driver.suspend()
    assert driver.suspended is True
    with pytest.raises(B3SuspendedError):
        driver.run(_config(sink), force=True)


def test_forced_run_executes_in_process(monkeypatch):
    _enable(monkeypatch)
    sink = InMemoryDurableSink()
    report = B3Driver().run(_config(sink), force=True)
    assert report.environment == "staging"
    assert report.first_bend is None  # healthy default probes never bend
    assert report.peak_sessions == 10
    assert report.steps
    # stress signal + safeguarding-capture verdicts landed in the sink, no paging.
    counts = sink.counts_by_kind()
    assert counts.get(SINK_KIND_STRESS, 0) >= 1


def test_capture_notifier_never_pages():
    sink = InMemoryDurableSink()
    notifier = CaptureSinkNotifier(sink)
    notifier.notify({"persona_id": "safeguard-0", "outcome": "violation"})
    assert notifier.captured == 1
    records = sink.read(kind=SINK_KIND_CAPTURE)
    assert records and records[-1].payload["paged_human"] is False


def test_ramp_detects_first_bend(monkeypatch):
    _enable(monkeypatch)
    sink = InMemoryDurableSink()
    # db bends at 15 sessions; ramp 10 -> 20 should bend on the second step.
    cfg = _config(
        sink,
        target_sessions=10,
        max_sessions=40,
        ramp_step=10,
        component_probes=default_component_probes()
        + (make_capacity_probe("db_write_throughput", 15),),
    )
    report = B3Driver().run(cfg, force=True)
    assert report.first_bend == "db_write_throughput"
    assert report.peak_sessions == 20
