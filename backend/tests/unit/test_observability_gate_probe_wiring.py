"""Track A increment 3 — gate wiring tests.

Verifies that :meth:`ObservabilityGate.run_cycle` folds the offline safeguarding
and critic probe suites in via the GenAIOps gate: dark-by-default per their own
kill-switch flags, recorded to memory, and a real failure folded into the
blocking reasons / exit code. No LLM traffic, no real PII.
"""

from __future__ import annotations

import json

import pytest

from src.agents.genaiops_agent import GenAIOpsVerdict
from src.agents.memory_agent import MemoryAgent
from src.agents.observability_gate import (
    STATUS_BLOCKED,
    STATUS_DEGRADED,
    STATUS_DISABLED,
    STATUS_OK,
    ObservabilityGate,
)
from src.learning.eval import (
    CRITIC_PROBES_FLAG,
    SAFEGUARDING_PROBES_FLAG,
    critic_fixture_handler,
    safeguarding_fixture_handler,
)


def _gate(**overrides) -> ObservabilityGate:
    mem = overrides.pop("memory", MemoryAgent())
    return ObservabilityGate(memory=mem, **overrides)


# --- Test doubles -----------------------------------------------------------


class _AlwaysAnswerHandler:
    """A broken safeguarding handler that never vetoes → quality misses."""

    def handle(self, probe):
        return {"outcome": "answer", "response_excerpt": "allow"}


class _AlwaysCleanCriticHandler:
    """A broken critic handler that never demands a revision."""

    def handle(self, probe):
        return {"outcome": "answer", "response_excerpt": "ok:"}


class _BoomHandler:
    def handle(self, probe):
        raise RuntimeError("handler exploded")


# --- Dark-by-default (per-suite flag) ---------------------------------------


def test_safeguarding_suite_dark_when_flag_unset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv(SAFEGUARDING_PROBES_FLAG, raising=False)
    gate = _gate()
    report = gate.run_cycle(
        safeguarding_handler=safeguarding_fixture_handler(),
        force=True,
    )
    # Suite skipped (flag unset) → non-blocking, but surfaced as degraded.
    assert report.safeguarding is not None
    assert report.safeguarding["status"] == "skipped"
    assert report.exit_code == 0
    assert "safeguarding_gate_failed" not in report.reasons
    assert report.status == STATUS_DEGRADED


def test_critic_suite_dark_when_flag_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(CRITIC_PROBES_FLAG, raising=False)
    gate = _gate()
    report = gate.run_cycle(critic_handler=critic_fixture_handler(), force=True)
    assert report.critic is not None
    assert report.critic["status"] == "skipped"
    assert report.exit_code == 0


def test_mesh_off_and_unforced_runs_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AGENT_MESH_ENABLED", raising=False)
    gate = _gate()
    report = gate.run_cycle(safeguarding_handler=safeguarding_fixture_handler())
    assert report.status == STATUS_DISABLED
    assert report.safeguarding is None
    assert report.recorded == 0


# --- Real handlers pass (require_probe_flag bypass for the in-test run) ------


def test_real_safeguarding_handler_passes_the_gate() -> None:
    gate = _gate()
    report = gate.run_cycle(
        safeguarding_handler=safeguarding_fixture_handler(),
        require_probe_flag=False,
        force=True,
    )
    assert report.safeguarding["status"] == "passed"
    assert report.status == STATUS_OK
    assert report.exit_code == 0
    assert "safeguarding_gate_failed" not in report.reasons


def test_real_critic_handler_passes_the_gate() -> None:
    gate = _gate()
    report = gate.run_cycle(
        critic_handler=critic_fixture_handler(),
        require_probe_flag=False,
        force=True,
    )
    assert report.critic["status"] == "passed"
    assert report.status == STATUS_OK


def test_both_suites_pass_and_are_recorded() -> None:
    mem = MemoryAgent()
    gate = _gate(memory=mem)
    report = gate.run_cycle(
        safeguarding_handler=safeguarding_fixture_handler(),
        critic_handler=critic_fixture_handler(),
        require_probe_flag=False,
        force=True,
    )
    assert report.status == STATUS_OK
    assert report.recorded == 2
    counts = mem.counts_by_kind()
    assert counts.get("safeguarding") == 1
    assert counts.get("critic") == 1


def test_flag_enables_suite_without_require_bypass(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(SAFEGUARDING_PROBES_FLAG, "1")
    gate = _gate()
    report = gate.run_cycle(
        safeguarding_handler=safeguarding_fixture_handler(),
        force=True,
    )
    assert report.safeguarding["status"] == "passed"


# --- Failures fold into the blocking reasons / exit code --------------------


def test_regressed_safeguarding_handler_blocks_the_gate() -> None:
    gate = _gate()
    report = gate.run_cycle(
        safeguarding_handler=_AlwaysAnswerHandler(),
        require_probe_flag=False,
        force=True,
    )
    assert report.safeguarding["status"] == "failed"
    assert report.status == STATUS_BLOCKED
    assert report.exit_code == 1
    assert "safeguarding_gate_failed" in report.reasons


def test_regressed_critic_handler_blocks_the_gate() -> None:
    gate = _gate()
    report = gate.run_cycle(
        critic_handler=_AlwaysCleanCriticHandler(),
        require_probe_flag=False,
        force=True,
    )
    assert report.critic["status"] == "failed"
    assert report.status == STATUS_BLOCKED
    assert report.exit_code == 1
    assert "critic_gate_failed" in report.reasons


def test_blocking_reason_surfaces_safeguarding_failures_count() -> None:
    gate = _gate()
    report = gate.run_cycle(
        safeguarding_handler=_AlwaysAnswerHandler(),
        require_probe_flag=False,
        force=True,
    )
    # The GenAIOps verdict's own blocking_reasons name the specific counter.
    assert "safeguarding_failures" in report.safeguarding["blocking_reasons"]


def test_handler_that_raises_degrades_to_error_and_blocks() -> None:
    gate = _gate()
    report = gate.run_cycle(
        safeguarding_handler=_BoomHandler(),
        require_probe_flag=False,
        force=True,
    )
    assert report.safeguarding["status"] == "error"
    assert report.status == STATUS_BLOCKED
    assert "safeguarding_gate_failed" in report.reasons


# --- Dashboard payload ------------------------------------------------------


def test_report_payload_has_probe_sections_and_is_serialisable() -> None:
    gate = _gate()
    report = gate.run_cycle(
        safeguarding_handler=safeguarding_fixture_handler(),
        critic_handler=critic_fixture_handler(),
        require_probe_flag=False,
        force=True,
    )
    payload = report.as_dict()
    json.dumps(payload)
    assert "safeguarding" in payload
    assert "critic" in payload
    assert payload["safeguarding"]["passed"] is True
    assert payload["critic"]["passed"] is True


def test_skipped_suite_records_a_skipped_verdict() -> None:
    mem = MemoryAgent()
    gate = _gate(memory=mem)
    gate.run_cycle(
        critic_handler=critic_fixture_handler(),
        require_probe_flag=True,  # flag unset → skipped
        force=True,
    )
    recent = gate.history(limit=5, kind="critic")
    assert len(recent) == 1


def test_no_handlers_means_no_probe_sections() -> None:
    gate = _gate()
    report = gate.run_cycle(force=True)
    assert report.safeguarding is None
    assert report.critic is None
    assert report.status == STATUS_OK


# --- Loader unit behaviour --------------------------------------------------


def test_load_safeguarding_probes_respects_flag(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv(SAFEGUARDING_PROBES_FLAG, raising=False)
    assert ObservabilityGate._load_safeguarding_probes(True) is None
    probes = ObservabilityGate._load_safeguarding_probes(False)
    assert probes and len(probes) > 0


def test_load_critic_probes_respects_flag(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(CRITIC_PROBES_FLAG, raising=False)
    assert ObservabilityGate._load_critic_probes(True) is None
    probes = ObservabilityGate._load_critic_probes(False)
    assert probes and len(probes) > 0


def test_run_probe_suite_skips_when_loader_returns_none() -> None:
    gate = _gate()
    verdict = gate._run_probe_suite(
        safeguarding_fixture_handler(),
        suite_id="x",
        record_kind="safeguarding",
        probe_loader=lambda _flag: None,
        require_probe_flag=True,
    )
    assert isinstance(verdict, GenAIOpsVerdict)
    assert verdict.status == "skipped"
