"""W7 — cost dashboard aggregator.

Consumes per-request cost-ledger entries (already written by the egress
gateway) and produces deterministic rollups + alert flags. Output is
plain JSON-serialisable Pydantic so the dashboard tile and the auto-
rollback module can both consume it.

Cost is tracked in **micro-USD** integers throughout to keep arithmetic
exact. MVP §11 target: <= £0.40 / learner / term equivalent. We carry
the threshold as an explicit input so it can be tuned per cohort.
"""

from __future__ import annotations

import os
from collections import defaultdict
from typing import Dict, Iterable, List, Optional

from pydantic import Field

from src.learning.models import ContractModel


COST_DASHBOARD_FLAG = "LEARNING_COST_DASHBOARD_V1"


class CostDashboardUnavailableError(RuntimeError):
    """Raised when the cost-dashboard kill-switch flag is unset."""


class CostLedgerEntry(ContractModel):
    request_id: str = Field(min_length=1)
    tenant_id: str = Field(min_length=1)
    learner_id: Optional[str] = None
    feature: str = Field(min_length=1)
    provider: str = Field(min_length=1)
    tokens_in: int = Field(ge=0)
    tokens_out: int = Field(ge=0)
    micro_usd: int = Field(ge=0)
    ts: str = Field(min_length=1)


class CostRollup(ContractModel):
    dimension: str = Field(min_length=1)
    key: str = Field(min_length=1)
    requests: int = Field(ge=0)
    tokens_in: int = Field(ge=0)
    tokens_out: int = Field(ge=0)
    micro_usd: int = Field(ge=0)
    avg_micro_usd_per_request: int = Field(ge=0)


class CostAlert(ContractModel):
    severity: str = Field(min_length=1)
    code: str = Field(min_length=1)
    message: str = Field(min_length=1)
    metadata: Dict[str, int] = Field(default_factory=dict)


class CostDashboard(ContractModel):
    rollups_by_tenant: List[CostRollup] = Field(default_factory=list)
    rollups_by_learner: List[CostRollup] = Field(default_factory=list)
    rollups_by_feature: List[CostRollup] = Field(default_factory=list)
    rollups_by_provider: List[CostRollup] = Field(default_factory=list)
    totals: CostRollup
    alerts: List[CostAlert] = Field(default_factory=list)


def _rollup(
    entries: Iterable[CostLedgerEntry],
    dimension: str,
    key_fn,
) -> List[CostRollup]:
    buckets: Dict[str, Dict[str, int]] = defaultdict(
        lambda: {"requests": 0, "tokens_in": 0, "tokens_out": 0, "micro_usd": 0}
    )
    for e in entries:
        key = key_fn(e)
        if key is None:
            continue
        b = buckets[key]
        b["requests"] += 1
        b["tokens_in"] += e.tokens_in
        b["tokens_out"] += e.tokens_out
        b["micro_usd"] += e.micro_usd
    rollups: List[CostRollup] = []
    for key, b in sorted(buckets.items(), key=lambda kv: -kv[1]["micro_usd"]):
        avg = b["micro_usd"] // b["requests"] if b["requests"] else 0
        rollups.append(
            CostRollup(
                dimension=dimension,
                key=key,
                requests=b["requests"],
                tokens_in=b["tokens_in"],
                tokens_out=b["tokens_out"],
                micro_usd=b["micro_usd"],
                avg_micro_usd_per_request=avg,
            )
        )
    return rollups


def build_dashboard_tiles(
    entries: Iterable[CostLedgerEntry],
    *,
    budget_micro_usd_per_learner_per_term: int = 506_000,  # ~£0.40 @ 1.265 USD/GBP
    require_flag: bool = True,
) -> CostDashboard:
    if require_flag and not os.environ.get(COST_DASHBOARD_FLAG):
        raise CostDashboardUnavailableError(
            f"cost dashboard gated by {COST_DASHBOARD_FLAG}; set to enable"
        )
    entry_list = list(entries)

    rollups_tenant = _rollup(entry_list, "tenant", lambda e: e.tenant_id)
    rollups_learner = _rollup(entry_list, "learner", lambda e: e.learner_id)
    rollups_feature = _rollup(entry_list, "feature", lambda e: e.feature)
    rollups_provider = _rollup(entry_list, "provider", lambda e: e.provider)

    total_requests = len(entry_list)
    total_micro = sum(e.micro_usd for e in entry_list)
    totals = CostRollup(
        dimension="all",
        key="all",
        requests=total_requests,
        tokens_in=sum(e.tokens_in for e in entry_list),
        tokens_out=sum(e.tokens_out for e in entry_list),
        micro_usd=total_micro,
        avg_micro_usd_per_request=(total_micro // total_requests) if total_requests else 0,
    )

    alerts: List[CostAlert] = []
    for r in rollups_learner:
        if r.micro_usd > budget_micro_usd_per_learner_per_term:
            alerts.append(
                CostAlert(
                    severity="warn",
                    code="learner_budget_exceeded",
                    message=(
                        f"learner {r.key} micro_usd={r.micro_usd} exceeds "
                        f"budget {budget_micro_usd_per_learner_per_term}"
                    ),
                    metadata={
                        "micro_usd": r.micro_usd,
                        "budget_micro_usd": budget_micro_usd_per_learner_per_term,
                    },
                )
            )
    # Heaviest single feature taking >60% of spend is a smell worth flagging.
    if rollups_feature and totals.micro_usd > 0:
        top = rollups_feature[0]
        share = top.micro_usd / totals.micro_usd
        if share > 0.6:
            alerts.append(
                CostAlert(
                    severity="info",
                    code="feature_cost_concentration",
                    message=(
                        f"feature {top.key} accounts for {share:.0%} of total spend"
                    ),
                    metadata={"micro_usd": top.micro_usd, "total_micro_usd": totals.micro_usd},
                )
            )

    return CostDashboard(
        rollups_by_tenant=rollups_tenant,
        rollups_by_learner=rollups_learner,
        rollups_by_feature=rollups_feature,
        rollups_by_provider=rollups_provider,
        totals=totals,
        alerts=alerts,
    )
