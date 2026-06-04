"""Phase 3 tests: GenAIOpsAgent wraps the eval harness as a non-raising gate."""

from __future__ import annotations

from typing import Any, Dict

import pytest

from src.agents.genaiops_agent import (
    GenAIOpsAgent,
    GenAIOpsVerdict,
    STATUS_ERROR,
    STATUS_FAILED,
    STATUS_PASSED,
    STATUS_SKIPPED,
)
from src.learning.eval.harness import EVAL_HARNESS_FLAG
from src.learning.eval.safety_probes import (
    SAFETY_PROBES_FLAG,
    fixture_handler,
)


@pytest.fixture
def gate_flags(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(EVAL_HARNESS_FLAG, "1")
    monkeypatch.setenv(SAFETY_PROBES_FLAG, "1")


def test_passing_handler_yields_passed_verdict(gate_flags: None) -> None:
    agent = GenAIOpsAgent()
    verdict = agent.evaluate(fixture_handler())
    assert verdict.status == STATUS_PASSED
    assert verdict.passed is True
    assert verdict.blocking is False
    assert verdict.pass_rate == 1.0
    assert agent.should_block(verdict) is False


def test_failing_handler_yields_failed_blocking_verdict(gate_flags: None) -> None:
    class _BrokenHandler:
        """Returns 'answer' for every probe — violates crisis/jailbreak/etc."""

        def handle(self, probe: Any) -> Dict[str, Any]:
            return {"outcome": "answer", "response_excerpt": "here you go"}

    agent = GenAIOpsAgent()
    verdict = agent.evaluate(_BrokenHandler())
    assert verdict.status == STATUS_FAILED
    assert verdict.blocking is True
    assert agent.should_block(verdict) is True
    assert verdict.blocking_reasons  # at least one Tier-1 reason


def test_handler_exception_yields_error_verdict(gate_flags: None) -> None:
    class _BoomHandler:
        def handle(self, probe: Any) -> Dict[str, Any]:
            raise RuntimeError("model endpoint down")

    agent = GenAIOpsAgent()
    verdict = agent.evaluate(_BoomHandler())
    assert verdict.status == STATUS_ERROR
    assert verdict.blocking is True
    assert "model endpoint down" in verdict.detail


def test_skipped_when_harness_flag_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(EVAL_HARNESS_FLAG, raising=False)
    monkeypatch.setenv(SAFETY_PROBES_FLAG, "1")
    agent = GenAIOpsAgent()
    verdict = agent.evaluate(fixture_handler())
    assert verdict.status == STATUS_SKIPPED
    # Fail-closed: a skipped gate blocks by default.
    assert agent.should_block(verdict) is True
    # ...unless the caller opts to let an inoperable gate pass.
    assert agent.should_block(verdict, skip_blocks=False) is False


def test_skipped_when_probes_flag_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(EVAL_HARNESS_FLAG, "1")
    monkeypatch.delenv(SAFETY_PROBES_FLAG, raising=False)
    agent = GenAIOpsAgent()
    verdict = agent.evaluate(fixture_handler())
    assert verdict.status == STATUS_SKIPPED


def test_explicit_probes_bypass_probe_flag(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(EVAL_HARNESS_FLAG, "1")
    monkeypatch.delenv(SAFETY_PROBES_FLAG, raising=False)
    # Pass probes explicitly with require_probe_flag=False → gate runs.
    from src.learning.eval.safety_probes import default_probes

    probes = default_probes(require_flag=False)
    agent = GenAIOpsAgent()
    verdict = agent.evaluate(
        fixture_handler(),
        probes=probes,
        require_probe_flag=False,
    )
    assert verdict.status == STATUS_PASSED


def test_verdict_as_dict_is_serialisable(gate_flags: None) -> None:
    import json

    agent = GenAIOpsAgent()
    verdict = agent.evaluate(fixture_handler())
    payload = verdict.as_dict()
    assert payload["status"] == STATUS_PASSED
    assert payload["passed"] is True
    json.dumps(payload)  # must not raise


def test_tool_allow_list_enforced() -> None:
    agent = GenAIOpsAgent()
    with pytest.raises(PermissionError):
        agent.ensure_tool_allowed("delete_probes")
    agent.ensure_tool_allowed("run_eval_suite")


def test_verdict_helpers() -> None:
    skipped = GenAIOpsVerdict.skipped("flag unset")
    errored = GenAIOpsVerdict.errored("boom")
    assert skipped.status == STATUS_SKIPPED and skipped.blocking is True
    assert errored.status == STATUS_ERROR and errored.blocking is True
