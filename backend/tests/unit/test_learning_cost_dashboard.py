"""W7 — cost dashboard contract tests."""

from __future__ import annotations

import pytest

from src.learning.eval import (
    COST_DASHBOARD_FLAG,
    CostDashboardUnavailableError,
    CostLedgerEntry,
    build_dashboard_tiles,
)


def _entry(
    *,
    request_id: str = "r",
    tenant_id: str = "t-1",
    learner_id: str | None = "stu-1",
    feature: str = "explanation",
    provider: str = "openai",
    tokens_in: int = 100,
    tokens_out: int = 200,
    micro_usd: int = 1000,
) -> CostLedgerEntry:
    return CostLedgerEntry(
        request_id=request_id,
        tenant_id=tenant_id,
        learner_id=learner_id,
        feature=feature,
        provider=provider,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        micro_usd=micro_usd,
        ts="2026-05-27T10:00:00Z",
    )


# ---------------------------------------------------------------------------
# Rollups
# ---------------------------------------------------------------------------


def test_rollups_sum_to_totals() -> None:
    entries = [
        _entry(request_id="r1", micro_usd=1000),
        _entry(request_id="r2", learner_id="stu-2", micro_usd=2000),
        _entry(request_id="r3", tenant_id="t-2", learner_id="stu-3", micro_usd=3000),
    ]
    dash = build_dashboard_tiles(entries, require_flag=False)
    assert dash.totals.requests == 3
    assert dash.totals.micro_usd == 6000
    assert sum(r.micro_usd for r in dash.rollups_by_tenant) == 6000
    assert sum(r.micro_usd for r in dash.rollups_by_learner) == 6000
    assert sum(r.micro_usd for r in dash.rollups_by_feature) == 6000
    assert sum(r.micro_usd for r in dash.rollups_by_provider) == 6000


def test_rollups_sorted_by_spend_descending() -> None:
    entries = [
        _entry(request_id="r1", feature="explanation", micro_usd=500),
        _entry(request_id="r2", feature="career", micro_usd=2000),
        _entry(request_id="r3", feature="career", micro_usd=2500),
    ]
    dash = build_dashboard_tiles(entries, require_flag=False)
    top = dash.rollups_by_feature[0]
    assert top.key == "career"
    assert top.micro_usd == 4500
    assert dash.rollups_by_feature[1].key == "explanation"


def test_avg_per_request_is_integer_division() -> None:
    entries = [
        _entry(request_id="r1", learner_id="stu-1", micro_usd=1000),
        _entry(request_id="r2", learner_id="stu-1", micro_usd=2001),
    ]
    dash = build_dashboard_tiles(entries, require_flag=False)
    stu1 = next(r for r in dash.rollups_by_learner if r.key == "stu-1")
    assert stu1.requests == 2
    assert stu1.avg_micro_usd_per_request == (1000 + 2001) // 2


def test_learner_id_none_is_skipped_in_learner_rollup() -> None:
    entries = [
        _entry(request_id="r1", learner_id=None, micro_usd=1000),
        _entry(request_id="r2", learner_id="stu-1", micro_usd=2000),
    ]
    dash = build_dashboard_tiles(entries, require_flag=False)
    keys = [r.key for r in dash.rollups_by_learner]
    assert keys == ["stu-1"]
    # But tenant/feature/provider rollups keep all entries.
    assert dash.totals.requests == 2


# ---------------------------------------------------------------------------
# Alerts
# ---------------------------------------------------------------------------


def test_alert_fires_when_learner_exceeds_budget() -> None:
    entries = [_entry(request_id=f"r{i}", micro_usd=200_000) for i in range(5)]
    dash = build_dashboard_tiles(
        entries,
        budget_micro_usd_per_learner_per_term=500_000,
        require_flag=False,
    )
    codes = [a.code for a in dash.alerts]
    assert "learner_budget_exceeded" in codes


def test_concentration_alert_fires_when_one_feature_dominates() -> None:
    entries = [
        _entry(request_id="r1", feature="explanation", micro_usd=9000),
        _entry(request_id="r2", feature="career", micro_usd=1000),
    ]
    dash = build_dashboard_tiles(
        entries,
        budget_micro_usd_per_learner_per_term=10_000_000,
        require_flag=False,
    )
    codes = [a.code for a in dash.alerts]
    assert "feature_cost_concentration" in codes


def test_no_alerts_when_under_budget_and_diversified() -> None:
    entries = [
        _entry(request_id="r1", feature="explanation", micro_usd=1000),
        _entry(request_id="r2", feature="career", micro_usd=900),
        _entry(request_id="r3", feature="diagnostic", micro_usd=800),
    ]
    dash = build_dashboard_tiles(
        entries,
        budget_micro_usd_per_learner_per_term=10_000_000,
        require_flag=False,
    )
    codes = [a.code for a in dash.alerts]
    assert "learner_budget_exceeded" not in codes
    assert "feature_cost_concentration" not in codes


# ---------------------------------------------------------------------------
# Kill switch + edge cases
# ---------------------------------------------------------------------------


def test_dashboard_gated_by_flag(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(COST_DASHBOARD_FLAG, raising=False)
    with pytest.raises(CostDashboardUnavailableError):
        build_dashboard_tiles([_entry()], require_flag=True)


def test_empty_entries_produces_zero_totals() -> None:
    dash = build_dashboard_tiles([], require_flag=False)
    assert dash.totals.requests == 0
    assert dash.totals.micro_usd == 0
    assert dash.alerts == []


def test_negative_micro_usd_rejected_at_model_layer() -> None:
    with pytest.raises(Exception):
        _entry(micro_usd=-1)
