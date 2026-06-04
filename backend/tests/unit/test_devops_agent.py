"""Phase 4 tests: DevOpsAgent staging-only release-readiness aggregator."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Optional, Tuple

import pytest

from src.agents.devops_agent import (
    STATUS_BLOCKED,
    STATUS_GO,
    STATUS_NO_GO,
    DeployDecision,
    DevOpsAgent,
)


@dataclass
class _FakeVerdict:
    status: str
    blocking: bool
    passed: bool = False


@dataclass
class _FakeOpsReport:
    severity: str
    healthy: bool = False
    anomalies: Tuple = ()


def test_non_staging_target_is_blocked() -> None:
    agent = DevOpsAgent()
    decision = agent.evaluate_release(target_env="production")
    assert decision.status == STATUS_BLOCKED
    assert decision.blocked is True
    assert decision.should_deploy is False
    assert "not a staging environment" in decision.reasons[0]


def test_clean_staging_release_is_go() -> None:
    agent = DevOpsAgent()
    decision = agent.evaluate_release(
        target_env="staging",
        eval_verdict=_FakeVerdict(status="passed", blocking=False, passed=True),
        ops_report=_FakeOpsReport(severity="ok", healthy=True),
    )
    assert decision.status == STATUS_GO
    assert decision.go is True
    assert decision.should_deploy is True
    assert decision.reasons == ()


def test_failed_eval_blocks_staging() -> None:
    agent = DevOpsAgent()
    decision = agent.evaluate_release(
        target_env="staging",
        eval_verdict=_FakeVerdict(status="failed", blocking=True),
    )
    assert decision.status == STATUS_NO_GO
    assert any("eval gate" in r for r in decision.reasons)


def test_skipped_eval_blocks_by_default_but_can_be_allowed() -> None:
    agent = DevOpsAgent()
    skipped = _FakeVerdict(status="skipped", blocking=True)

    blocked = agent.evaluate_release(target_env="staging", eval_verdict=skipped)
    assert blocked.status == STATUS_NO_GO

    allowed = agent.evaluate_release(
        target_env="staging", eval_verdict=skipped, allow_skipped_eval=True
    )
    assert allowed.status == STATUS_GO


def test_failed_eval_blocks_even_when_skip_allowed() -> None:
    agent = DevOpsAgent()
    decision = agent.evaluate_release(
        target_env="staging",
        eval_verdict=_FakeVerdict(status="failed", blocking=True),
        allow_skipped_eval=True,
    )
    assert decision.status == STATUS_NO_GO


def test_critical_ops_blocks_but_warn_does_not() -> None:
    agent = DevOpsAgent()
    critical = agent.evaluate_release(
        target_env="staging",
        ops_report=_FakeOpsReport(severity="critical"),
    )
    assert critical.status == STATUS_NO_GO
    assert any("critical" in r for r in critical.reasons)

    warn = agent.evaluate_release(
        target_env="staging",
        ops_report=_FakeOpsReport(severity="warn"),
    )
    assert warn.status == STATUS_GO
    assert warn.checks["ops_health"] == "warn"


def test_missing_inputs_do_not_block_staging() -> None:
    agent = DevOpsAgent()
    decision = agent.evaluate_release(target_env="staging")
    assert decision.status == STATUS_GO
    assert decision.checks["eval_gate"] == "not_run"
    assert decision.checks["ops_health"] == "not_consulted"


def test_target_env_is_normalised() -> None:
    agent = DevOpsAgent()
    decision = agent.evaluate_release(target_env="  STAGING  ")
    assert decision.target_env == "staging"
    assert decision.status == STATUS_GO


def test_custom_staging_set_via_constructor() -> None:
    agent = DevOpsAgent(staging_environments=["qa", "uat"])
    assert agent.is_staging("uat") is True
    assert agent.is_staging("staging") is False
    decision = agent.evaluate_release(target_env="staging")
    assert decision.status == STATUS_BLOCKED


def test_staging_set_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DEVOPS_STAGING_ENVIRONMENTS", "sandbox, test")
    agent = DevOpsAgent()
    assert agent.is_staging("sandbox") is True
    assert agent.is_staging("test") is True
    assert agent.is_staging("staging") is False


def test_unreadable_eval_verdict_blocks_defensively() -> None:
    class _Boom:
        @property
        def status(self):
            raise RuntimeError("nope")

        @property
        def blocking(self):
            raise RuntimeError("nope")

    agent = DevOpsAgent()
    decision = agent.evaluate_release(target_env="staging", eval_verdict=_Boom())
    assert decision.status == STATUS_NO_GO
    assert any("unreadable" in r for r in decision.reasons)


def test_decision_as_dict_is_json_serialisable() -> None:
    agent = DevOpsAgent()
    decision = agent.evaluate_release(
        target_env="staging",
        eval_verdict=_FakeVerdict(status="passed", blocking=False, passed=True),
    )
    payload = decision.as_dict()
    json.dumps(payload)
    assert payload["status"] == STATUS_GO
    assert payload["target_env"] == "staging"


def test_tool_allow_list_excludes_deploy_actions() -> None:
    agent = DevOpsAgent()
    for forbidden in ("deploy", "apply", "rollback", "azd_up"):
        with pytest.raises(PermissionError):
            agent.ensure_tool_allowed(forbidden)
    agent.ensure_tool_allowed("assess_eval_gate")
    agent.ensure_tool_allowed("assess_ops_health")
