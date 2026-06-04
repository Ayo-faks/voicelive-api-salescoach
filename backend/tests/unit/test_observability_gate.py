"""Phase 4 (integration) tests: ObservabilityGate wires the read-only agents."""

from __future__ import annotations

import json

import pytest

from src.agents.aiops_agent import AIOpsAgent
from src.agents.devops_agent import DevOpsAgent
from src.agents.genaiops_agent import GenAIOpsAgent
from src.agents.memory_agent import MemoryAgent
from src.agents.migration_agent import MigrationAgent
from src.agents.observability_gate import (
    STATUS_BLOCKED,
    STATUS_DEGRADED,
    STATUS_DISABLED,
    STATUS_OK,
    ObservabilityGate,
    ObservabilityReport,
)


# --- Test doubles -----------------------------------------------------------


class _Reader:
    def __init__(self, snapshot, *, enabled=True):
        self._snapshot = snapshot
        self.enabled = enabled

    def read(self):
        return self._snapshot


_HEALTHY_SNAPSHOT = {
    "requests": {"error_rate": 0.0},
    "citation": {"present_rate": 1.0},
}
_CRITICAL_SNAPSHOT = {
    "requests": {"error_rate": 0.9},  # well past critical
}
_WARN_SNAPSHOT = {
    "citation": {"present_rate": 0.75},  # below warn (0.80), above critical (0.50)
}


def _gate(**overrides) -> ObservabilityGate:
    """A gate with a fresh shared memory so history assertions are isolated."""
    mem = overrides.pop("memory", MemoryAgent())
    return ObservabilityGate(memory=mem, **overrides)


# --- Dark-by-default --------------------------------------------------------


def test_disabled_when_mesh_off_and_not_forced(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AGENT_MESH_ENABLED", raising=False)
    gate = _gate()
    report = gate.run_cycle(reader=_Reader(_CRITICAL_SNAPSHOT))
    assert report.status == STATUS_DISABLED
    assert report.exit_code == 0
    assert report.recorded == 0  # nothing ran


def test_force_runs_even_when_mesh_off(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AGENT_MESH_ENABLED", raising=False)
    gate = _gate()
    report = gate.run_cycle(reader=_Reader(_HEALTHY_SNAPSHOT), force=True)
    assert report.status == STATUS_OK
    assert report.recorded == 1


def test_runs_when_flag_enabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGENT_MESH_ENABLED", "1")
    gate = _gate()
    report = gate.run_cycle(reader=_Reader(_HEALTHY_SNAPSHOT))
    assert report.status == STATUS_OK


# --- Ops health -------------------------------------------------------------


def test_critical_ops_blocks_gate() -> None:
    gate = _gate()
    report = gate.run_cycle(reader=_Reader(_CRITICAL_SNAPSHOT), force=True)
    assert report.status == STATUS_BLOCKED
    assert report.exit_code == 1
    assert "ops_health_critical" in report.reasons


def test_warn_ops_is_degraded_not_blocked() -> None:
    gate = _gate()
    report = gate.run_cycle(reader=_Reader(_WARN_SNAPSHOT), force=True)
    assert report.status == STATUS_DEGRADED
    assert report.exit_code == 0


def test_disabled_reader_records_nothing() -> None:
    gate = _gate()
    report = gate.run_cycle(reader=_Reader(_HEALTHY_SNAPSHOT, enabled=False), force=True)
    assert report.recorded == 0
    assert report.ops is None
    assert report.status == STATUS_OK


# --- Deploy decision folding ------------------------------------------------


def test_staging_target_produces_go_when_clean() -> None:
    gate = _gate()
    report = gate.run_cycle(
        reader=_Reader(_HEALTHY_SNAPSHOT),
        target_env="staging",
        allow_skipped_eval=True,
        force=True,
    )
    assert report.deploy is not None
    assert report.deploy["status"] == "go"
    assert report.status == STATUS_OK


def test_non_staging_target_blocks_gate() -> None:
    gate = _gate()
    report = gate.run_cycle(
        reader=_Reader(_HEALTHY_SNAPSHOT),
        target_env="production",
        force=True,
    )
    assert report.status == STATUS_BLOCKED
    assert report.exit_code == 1
    assert "non_staging_target_blocked" in report.reasons


def test_critical_ops_makes_staging_deploy_no_go() -> None:
    gate = _gate()
    report = gate.run_cycle(
        reader=_Reader(_CRITICAL_SNAPSHOT),
        target_env="staging",
        allow_skipped_eval=True,
        force=True,
    )
    assert report.deploy["status"] == "no_go"
    assert report.status == STATUS_BLOCKED


# --- Migration --------------------------------------------------------------


def test_destructive_migration_blocks_gate() -> None:
    gate = _gate()
    report = gate.run_cycle(
        migration_steps=[{"name": "drop", "statement": "DROP TABLE legacy"}],
        force=True,
    )
    assert report.migration is not None
    assert report.status == STATUS_BLOCKED
    assert "destructive_migration" in report.reasons


def test_safe_migration_is_ok() -> None:
    gate = _gate()
    report = gate.run_cycle(
        migration_steps=[{"name": "add", "statement": "CREATE TABLE t (id int)"}],
        force=True,
    )
    assert report.status == STATUS_OK
    assert report.migration["approved"] is True


# --- Memory wiring + dashboard payload --------------------------------------


def test_outcomes_recorded_into_memory() -> None:
    mem = MemoryAgent()
    gate = _gate(memory=mem)
    gate.run_cycle(
        reader=_Reader(_HEALTHY_SNAPSHOT),
        migration_steps=[{"name": "add", "statement": "CREATE TABLE t (id int)"}],
        force=True,
    )
    counts = mem.counts_by_kind()
    assert counts.get("aiops") == 1
    assert counts.get("migration") == 1


def test_history_returns_recorded_outcomes() -> None:
    gate = _gate()
    gate.run_cycle(reader=_Reader(_HEALTHY_SNAPSHOT), force=True)
    gate.run_cycle(reader=_Reader(_WARN_SNAPSHOT), force=True)
    history = gate.history(limit=10)
    assert len(history) == 2
    assert {h["kind"] for h in history} == {"aiops"}


def test_report_as_dict_is_json_serialisable_and_has_exit_code() -> None:
    gate = _gate()
    report = gate.run_cycle(reader=_Reader(_CRITICAL_SNAPSHOT), force=True)
    payload = report.as_dict()
    json.dumps(payload)
    assert payload["exit_code"] == 1
    assert payload["gate_passed"] is False
    assert payload["status"] == STATUS_BLOCKED


def test_empty_cycle_is_ok_and_records_nothing() -> None:
    gate = _gate()
    report = gate.run_cycle(force=True)
    assert isinstance(report, ObservabilityReport)
    assert report.status == STATUS_OK
    assert report.recorded == 0


def test_cycle_never_raises_on_bad_reader() -> None:
    class _Boom:
        enabled = True

        def read(self):
            raise RuntimeError("kusto down")

    gate = _gate()
    # AIOpsAgent.read_and_assess swallows reader errors → no ops section.
    report = gate.run_cycle(reader=_Boom(), force=True)
    assert report.status == STATUS_OK
    assert report.ops is None
