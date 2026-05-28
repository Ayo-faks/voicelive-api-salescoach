"""W6 — labour-market ETL v0.

Builds a reviewed ``LabourMarketDataset`` JSON for Nigeria from four open
data sources:

* **ESCO** — European occupation taxonomy → canonical skill weights per
  pathway.
* **ONS** — UK occupational pay benchmarks → reference wage band (used as
  prior when NBS data is sparse).
* **NBS** — Nigerian Bureau of Statistics → primary local wage band.
* **Adzuna NG** — Nigerian job postings → demand-trend signal.

The ETL is **offline by construction**: it takes pre-snapshotted JSON
files in ``data/learning/career/sources/`` and never makes network calls.
Outputs ship in the ``LabourMarketDatasetDraft`` wrapper with
``review_state="pending_two_reviewer_signoff"``; only a draft that two
named reviewers have signed off may be promoted to a
``LabourMarketDataset`` via :meth:`LabourMarketDatasetDraft.promote`.

Kill switch: ``LEARNING_LABOUR_MARKET_ETL_V1``.

Frozen-surface guarantee: the planner already consumes
``LabourMarketDataset`` unchanged. This module only produces the dataset
file; the planner is not modified.
"""

from __future__ import annotations

import json
import os
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Final, List, Literal, Mapping, Optional, Sequence

from pydantic import Field

from src.common.labour_market import LabourMarketDataset, LabourMarketRecord
from src.learning.models import ContractModel, LabourMarketSignal, Provenance


ETL_FLAG: Final[str] = "LEARNING_LABOUR_MARKET_ETL_V1"
ETL_RULE_ID: Final[str] = "w6_labour_market_etl_v0"
SOURCES: Final[frozenset[str]] = frozenset({"esco", "ons", "nbs", "adzuna_ng"})
REVIEW_STATES: Final[frozenset[str]] = frozenset(
    {"pending_two_reviewer_signoff", "approved", "rejected"}
)

_TRUTHY: Final[frozenset[str]] = frozenset({"1", "true", "yes", "on", "enabled"})


def etl_enabled() -> bool:
    return os.environ.get(ETL_FLAG, "").strip().lower() in _TRUTHY


class LabourMarketETLUnavailableError(RuntimeError):
    """Raised when the kill switch is off and ``require_flag=True``."""


class LabourMarketETLValidationError(ValueError):
    """Raised on source-data or merge-logic failures."""


# ---------------------------------------------------------------------------
# Source snapshot schemas (input)
# ---------------------------------------------------------------------------


class ESCOSnapshot(ContractModel):
    pathway_id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    skill_weights: Dict[str, float] = Field(min_length=1)
    recency: str = Field(min_length=1)
    confidence: float = Field(ge=0.0, le=1.0)


class ONSSnapshot(ContractModel):
    pathway_id: str = Field(min_length=1)
    currency: str = Field(min_length=1)
    min_monthly: float = Field(ge=0.0)
    max_monthly: float = Field(ge=0.0)
    recency: str = Field(min_length=1)
    confidence: float = Field(ge=0.0, le=1.0)


class NBSSnapshot(ContractModel):
    pathway_id: str = Field(min_length=1)
    currency: str = Field(min_length=1)
    min_monthly: float = Field(ge=0.0)
    max_monthly: float = Field(ge=0.0)
    recency: str = Field(min_length=1)
    confidence: float = Field(ge=0.0, le=1.0)


class AdzunaSnapshot(ContractModel):
    pathway_id: str = Field(min_length=1)
    posting_count: int = Field(ge=0)
    posting_growth_pct: float = Field(ge=-1.0, le=5.0)
    recency: str = Field(min_length=1)
    confidence: float = Field(ge=0.0, le=1.0)


class SourceBundle(ContractModel):
    """All snapshots that go into one ETL run."""

    esco: List[ESCOSnapshot] = Field(min_length=1)
    ons: List[ONSSnapshot] = Field(default_factory=list)
    nbs: List[NBSSnapshot] = Field(min_length=1)
    adzuna_ng: List[AdzunaSnapshot] = Field(min_length=1)


# ---------------------------------------------------------------------------
# Output: draft + promote contract
# ---------------------------------------------------------------------------


class ReviewerSignoff(ContractModel):
    reviewer_id: str = Field(min_length=1)
    reviewed_at: str = Field(min_length=1)


class LabourMarketDatasetDraft(ContractModel):
    """Reviewable wrapper around ``LabourMarketDataset``.

    A draft is **never** consumed by the planner directly; only
    :meth:`promote` yields a real :class:`LabourMarketDataset` once two
    distinct reviewers have signed off.
    """

    draft_id: str = Field(min_length=1)
    dataset: LabourMarketDataset
    review_state: Literal[
        "pending_two_reviewer_signoff", "approved", "rejected"
    ] = "pending_two_reviewer_signoff"
    signoffs: List[ReviewerSignoff] = Field(default_factory=list)
    generated_at: str = Field(min_length=1)
    etl_rule_id: str = Field(min_length=1)

    def is_promotable(self) -> bool:
        if self.review_state != "approved":
            return False
        reviewer_ids = {s.reviewer_id for s in self.signoffs}
        return len(reviewer_ids) >= 2

    def promote(self) -> LabourMarketDataset:
        if not self.is_promotable():
            raise LabourMarketETLValidationError(
                "draft is not promotable: need review_state='approved' "
                "and ≥2 distinct reviewer signoffs"
            )
        return self.dataset


# ---------------------------------------------------------------------------
# Loaders
# ---------------------------------------------------------------------------


def load_source_bundle(root: Path) -> SourceBundle:
    """Load source snapshots from a directory.

    Expects ``esco.json``, ``ons.json``, ``nbs.json``, ``adzuna_ng.json``.
    Each file is a JSON array of source-shaped records.
    """
    def _load(name: str) -> list:
        path = root / f"{name}.json"
        if not path.exists():
            if name == "ons":
                return []
            raise LabourMarketETLValidationError(f"missing source snapshot: {path}")
        with path.open(encoding="utf-8") as fh:
            data = json.load(fh)
        if not isinstance(data, list):
            raise LabourMarketETLValidationError(
                f"{path} must be a JSON array of records"
            )
        return data

    return SourceBundle(
        esco=[ESCOSnapshot.model_validate(r) for r in _load("esco")],
        ons=[ONSSnapshot.model_validate(r) for r in _load("ons")],
        nbs=[NBSSnapshot.model_validate(r) for r in _load("nbs")],
        adzuna_ng=[AdzunaSnapshot.model_validate(r) for r in _load("adzuna_ng")],
    )


# ---------------------------------------------------------------------------
# Merge
# ---------------------------------------------------------------------------


def _esco_by_pathway(bundle: SourceBundle) -> Dict[str, ESCOSnapshot]:
    by_id: Dict[str, ESCOSnapshot] = {}
    for snap in bundle.esco:
        if snap.pathway_id in by_id:
            raise LabourMarketETLValidationError(
                f"duplicate ESCO record for pathway_id={snap.pathway_id}"
            )
        by_id[snap.pathway_id] = snap
    return by_id


def _index(records: Sequence, attr: str = "pathway_id") -> Dict[str, list]:
    out: Dict[str, list] = defaultdict(list)
    for r in records:
        out[getattr(r, attr)].append(r)
    return out


def _blend_wage(
    nbs: Sequence[NBSSnapshot], ons: Sequence[ONSSnapshot]
) -> LabourMarketSignal:
    if not nbs:
        raise LabourMarketETLValidationError("wage band requires at least one NBS snapshot")
    # NBS dominates (Nigeria); ONS only weights in if NBS confidence is low.
    primary = nbs[0]
    if primary.confidence >= 0.7 or not ons:
        return LabourMarketSignal(
            source="nbs",
            recency=primary.recency,
            confidence=round(primary.confidence, 4),
            value={
                "currency": primary.currency,
                "min_monthly": primary.min_monthly,
                "max_monthly": primary.max_monthly,
            },
        )
    ons_ref = ons[0]
    blended_conf = round(0.6 * primary.confidence + 0.4 * ons_ref.confidence, 4)
    return LabourMarketSignal(
        source="nbs+ons",
        recency=primary.recency,
        confidence=blended_conf,
        value={
            "currency": primary.currency,
            "min_monthly": primary.min_monthly,
            "max_monthly": primary.max_monthly,
            "ons_reference_currency": ons_ref.currency,
            "ons_min_monthly": ons_ref.min_monthly,
            "ons_max_monthly": ons_ref.max_monthly,
        },
    )


def _demand_trend(adzuna: Sequence[AdzunaSnapshot]) -> LabourMarketSignal:
    if not adzuna:
        raise LabourMarketETLValidationError(
            "demand trend requires at least one Adzuna NG snapshot"
        )
    snap = adzuna[0]
    if snap.posting_growth_pct >= 0.10:
        trend = "rising"
    elif snap.posting_growth_pct <= -0.10:
        trend = "falling"
    else:
        trend = "steady"
    # Map growth to a [0, 1] score centred on 0.5 at zero growth.
    score = max(0.0, min(1.0, 0.5 + snap.posting_growth_pct))
    return LabourMarketSignal(
        source="adzuna_ng",
        recency=snap.recency,
        confidence=round(snap.confidence, 4),
        value={
            "trend": trend,
            "score": round(score, 4),
            "posting_count": snap.posting_count,
            "posting_growth_pct": round(snap.posting_growth_pct, 4),
        },
    )


def _build_record(
    pathway_id: str,
    esco: ESCOSnapshot,
    nbs: Sequence[NBSSnapshot],
    ons: Sequence[ONSSnapshot],
    adzuna: Sequence[AdzunaSnapshot],
) -> LabourMarketRecord:
    skill_total = sum(esco.skill_weights.values())
    if skill_total <= 0:
        raise LabourMarketETLValidationError(
            f"{pathway_id}: ESCO skill_weights must sum > 0"
        )
    normalised = {k: round(v / skill_total, 4) for k, v in esco.skill_weights.items()}
    provenance = [
        Provenance(
            source="labour_market_etl",
            rule_id=ETL_RULE_ID,
            confidence=round(
                (esco.confidence + nbs[0].confidence + adzuna[0].confidence) / 3.0, 4
            ),
            evidence_count=1 + 1 + 1 + (1 if ons else 0),
            metadata={
                "esco_recency": esco.recency,
                "nbs_recency": nbs[0].recency,
                "adzuna_recency": adzuna[0].recency,
                "ons_referenced": bool(ons),
            },
        )
    ]
    return LabourMarketRecord(
        pathway_id=pathway_id,
        title=esco.title,
        skill_weights=normalised,
        wage_band=_blend_wage(nbs, ons),
        demand_trend=_demand_trend(adzuna),
        provenance=provenance,
    )


def merge_sources(
    bundle: SourceBundle,
    *,
    dataset_id: str = "nigeria-career-labour-market-v0",
    lang: str = "en-NG",
    require_flag: bool = True,
    generated_at: Optional[datetime] = None,
) -> LabourMarketDatasetDraft:
    """Merge per-source snapshots into a reviewable dataset draft."""
    if require_flag and not etl_enabled():
        raise LabourMarketETLUnavailableError(
            f"{ETL_FLAG} is off; labour-market ETL is gated."
        )

    esco_index = _esco_by_pathway(bundle)
    nbs_index = _index(bundle.nbs)
    ons_index = _index(bundle.ons)
    adzuna_index = _index(bundle.adzuna_ng)

    # ESCO defines the universe of pathway_ids; every ESCO pathway must
    # also have NBS + Adzuna evidence.
    pathway_ids = sorted(esco_index.keys())
    records: List[LabourMarketRecord] = []
    missing: List[str] = []
    for pid in pathway_ids:
        if pid not in nbs_index:
            missing.append(f"{pid}:nbs")
            continue
        if pid not in adzuna_index:
            missing.append(f"{pid}:adzuna_ng")
            continue
        records.append(
            _build_record(
                pid,
                esco_index[pid],
                nbs_index[pid],
                ons_index.get(pid, []),
                adzuna_index[pid],
            )
        )
    if missing:
        raise LabourMarketETLValidationError(
            f"pathways missing required source coverage: {missing}"
        )

    dataset = LabourMarketDataset(
        dataset_id=dataset_id,
        lang=lang,
        records=records,
    )
    when = (generated_at or datetime.now(timezone.utc)).astimezone(timezone.utc)
    draft = LabourMarketDatasetDraft(
        draft_id=f"draft-{dataset_id}",
        dataset=dataset,
        review_state="pending_two_reviewer_signoff",
        signoffs=[],
        generated_at=when.isoformat().replace("+00:00", "Z"),
        etl_rule_id=ETL_RULE_ID,
    )
    return draft


def build_dataset_from_path(
    sources_root: Path,
    *,
    dataset_id: str = "nigeria-career-labour-market-v0",
    lang: str = "en-NG",
    require_flag: bool = True,
) -> LabourMarketDatasetDraft:
    """Convenience: load snapshots from disk and merge."""
    bundle = load_source_bundle(sources_root)
    return merge_sources(
        bundle,
        dataset_id=dataset_id,
        lang=lang,
        require_flag=require_flag,
    )
