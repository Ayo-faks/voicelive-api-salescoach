"""Phase 2 tests: AIOpsAgent is a read-only, non-raising anomaly summariser."""

from __future__ import annotations

from typing import Any, Dict, Optional

import pytest

from src.agents.aiops_agent import (
    AIOpsAgent,
    AIOpsThresholds,
    SEVERITY_CRITICAL,
    SEVERITY_OK,
    SEVERITY_WARN,
)


def _healthy_snapshot() -> Dict[str, Any]:
    return {
        "requests": {"error_rate": 0.01, "total": 100},
        "grounding": {"refusal_rate": 0.05},
        "citation": {"present_rate": 0.95},
        "retry": {"success_rate": 0.9},
        "llm": {"error_rate": 0.01, "avg_cost_per_turn_gbp": 0.005},
    }


def test_healthy_snapshot_reports_ok() -> None:
    agent = AIOpsAgent()
    report = agent.assess_snapshot(_healthy_snapshot())
    assert report.healthy is True
    assert report.severity == SEVERITY_OK
    assert report.observed_metrics == 6
    assert report.anomalies == ()


def test_high_error_rate_flags_critical() -> None:
    agent = AIOpsAgent()
    snap = _healthy_snapshot()
    snap["requests"]["error_rate"] = 0.30  # well past critical (0.15)
    report = agent.assess_snapshot(snap)
    assert report.severity == SEVERITY_CRITICAL
    anomaly = next(f for f in report.anomalies if f.metric == "requests.error_rate")
    assert anomaly.severity == SEVERITY_CRITICAL
    assert anomaly.direction == "high"


def test_low_citation_rate_flags_warn() -> None:
    agent = AIOpsAgent()
    snap = _healthy_snapshot()
    snap["citation"]["present_rate"] = 0.70  # below warn (0.80), above critical (0.50)
    report = agent.assess_snapshot(snap)
    assert report.severity == SEVERITY_WARN
    anomaly = next(f for f in report.anomalies if f.metric == "citation.present_rate")
    assert anomaly.severity == SEVERITY_WARN
    assert anomaly.direction == "low"


def test_overall_severity_is_max_of_findings() -> None:
    agent = AIOpsAgent()
    snap = _healthy_snapshot()
    snap["citation"]["present_rate"] = 0.70  # warn
    snap["llm"]["error_rate"] = 0.5  # critical
    report = agent.assess_snapshot(snap)
    assert report.severity == SEVERITY_CRITICAL


def test_missing_sections_are_skipped_not_errors() -> None:
    agent = AIOpsAgent()
    report = agent.assess_snapshot({"requests": {"error_rate": 0.02}})
    assert report.observed_metrics == 1
    assert report.healthy is True


def test_malformed_values_are_ignored() -> None:
    agent = AIOpsAgent()
    report = agent.assess_snapshot(
        {
            "requests": {"error_rate": "not-a-number"},
            "llm": "not-a-mapping",
        }
    )
    assert report.observed_metrics == 0
    assert report.healthy is True


def test_thresholds_are_overridable_via_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AIOPS_REQUESTS_ERROR_RATE_WARN", "0.001")
    monkeypatch.setenv("AIOPS_REQUESTS_ERROR_RATE_CRITICAL", "0.002")
    agent = AIOpsAgent(thresholds=AIOpsThresholds())
    report = agent.assess_snapshot({"requests": {"error_rate": 0.01}})
    assert report.severity == SEVERITY_CRITICAL


# -- read_and_assess (duck-typed reader) ------------------------------------


class _FakeReader:
    def __init__(self, *, enabled: bool, snapshot: Optional[Dict[str, Any]]) -> None:
        self.enabled = enabled
        self._snapshot = snapshot
        self.reads = 0

    def read(self) -> Optional[Dict[str, Any]]:
        self.reads += 1
        return self._snapshot


def test_read_and_assess_skips_disabled_reader() -> None:
    agent = AIOpsAgent()
    reader = _FakeReader(enabled=False, snapshot=_healthy_snapshot())
    assert agent.read_and_assess(reader) is None
    assert reader.reads == 0


def test_read_and_assess_returns_none_on_empty_snapshot() -> None:
    agent = AIOpsAgent()
    reader = _FakeReader(enabled=True, snapshot=None)
    assert agent.read_and_assess(reader) is None
    assert reader.reads == 1


def test_read_and_assess_evaluates_snapshot() -> None:
    agent = AIOpsAgent()
    reader = _FakeReader(enabled=True, snapshot=_healthy_snapshot())
    report = agent.read_and_assess(reader)
    assert report is not None
    assert report.healthy is True


def test_read_and_assess_swallows_reader_errors() -> None:
    class _BoomReader:
        enabled = True

        def read(self) -> Dict[str, Any]:
            raise RuntimeError("kql down")

    agent = AIOpsAgent()
    assert agent.read_and_assess(_BoomReader()) is None


def test_report_as_dict_is_serialisable() -> None:
    import json

    agent = AIOpsAgent()
    snap = _healthy_snapshot()
    snap["requests"]["error_rate"] = 0.30
    report = agent.assess_snapshot(snap)
    payload = report.as_dict()
    assert payload["severity"] == SEVERITY_CRITICAL
    assert payload["anomaly_count"] >= 1
    json.dumps(payload)  # must not raise


def test_aiops_tool_allow_list_enforced() -> None:
    agent = AIOpsAgent()
    with pytest.raises(PermissionError):
        agent.ensure_tool_allowed("delete_metrics")
    # allowed tool does not raise
    agent.ensure_tool_allowed("read_durable_metrics")
