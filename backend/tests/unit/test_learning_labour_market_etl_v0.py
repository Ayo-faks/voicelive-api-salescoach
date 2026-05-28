"""W6 — labour-market ETL v0 contract tests."""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from src.common.labour_market import LabourMarketDataset
from src.learning.career.labour_market_etl import (
    ETL_FLAG,
    ETL_RULE_ID,
    AdzunaSnapshot,
    ESCOSnapshot,
    LabourMarketDatasetDraft,
    LabourMarketETLUnavailableError,
    LabourMarketETLValidationError,
    NBSSnapshot,
    ONSSnapshot,
    ReviewerSignoff,
    SourceBundle,
    build_dataset_from_path,
    merge_sources,
)


BACKEND_ROOT = Path(__file__).resolve().parents[2]
SOURCES_ROOT = BACKEND_ROOT.parent / "data" / "learning" / "career" / "sources_v0"
DRAFT_PATH = BACKEND_ROOT.parent / "data" / "learning" / "career" / "labour_market_v0_draft.json"


def _bundle_one() -> SourceBundle:
    return SourceBundle(
        esco=[
            ESCOSnapshot(
                pathway_id="p-1",
                title="Test pathway",
                skill_weights={"linear-equations": 0.5, "data-handling": 0.5},
                recency="2026-Q1",
                confidence=0.8,
            )
        ],
        ons=[],
        nbs=[
            NBSSnapshot(
                pathway_id="p-1",
                currency="NGN",
                min_monthly=150000,
                max_monthly=400000,
                recency="2026-Q1",
                confidence=0.75,
            )
        ],
        adzuna_ng=[
            AdzunaSnapshot(
                pathway_id="p-1",
                posting_count=120,
                posting_growth_pct=0.15,
                recency="2026-Q1",
                confidence=0.7,
            )
        ],
    )


# ---------------------------------------------------------------------------
# Merge behaviour
# ---------------------------------------------------------------------------


def test_merge_produces_pending_draft() -> None:
    draft = merge_sources(_bundle_one(), require_flag=False)
    assert isinstance(draft, LabourMarketDatasetDraft)
    assert draft.review_state == "pending_two_reviewer_signoff"
    assert draft.etl_rule_id == ETL_RULE_ID
    assert draft.is_promotable() is False
    assert len(draft.dataset.records) == 1
    rec = draft.dataset.records[0]
    assert rec.pathway_id == "p-1"
    assert abs(sum(rec.skill_weights.values()) - 1.0) < 1e-4
    assert rec.wage_band.source == "nbs"
    assert rec.demand_trend.value["trend"] == "rising"


def test_merge_normalises_skill_weights() -> None:
    bundle = _bundle_one()
    bundle.esco[0].skill_weights = {"a": 2.0, "b": 2.0}
    draft = merge_sources(bundle, require_flag=False)
    rec = draft.dataset.records[0]
    assert rec.skill_weights == {"a": 0.5, "b": 0.5}


def test_merge_uses_ons_reference_when_nbs_confidence_low() -> None:
    bundle = _bundle_one()
    bundle.nbs[0].confidence = 0.5
    bundle.ons = [
        ONSSnapshot(
            pathway_id="p-1",
            currency="GBP",
            min_monthly=2000,
            max_monthly=3000,
            recency="2026-Q1",
            confidence=0.8,
        )
    ]
    draft = merge_sources(bundle, require_flag=False)
    rec = draft.dataset.records[0]
    assert rec.wage_band.source == "nbs+ons"
    assert "ons_min_monthly" in rec.wage_band.value


def test_merge_classifies_falling_demand() -> None:
    bundle = _bundle_one()
    bundle.adzuna_ng[0].posting_growth_pct = -0.2
    draft = merge_sources(bundle, require_flag=False)
    assert draft.dataset.records[0].demand_trend.value["trend"] == "falling"


def test_merge_classifies_steady_demand() -> None:
    bundle = _bundle_one()
    bundle.adzuna_ng[0].posting_growth_pct = 0.02
    draft = merge_sources(bundle, require_flag=False)
    assert draft.dataset.records[0].demand_trend.value["trend"] == "steady"


def test_merge_rejects_missing_nbs_coverage() -> None:
    bundle = _bundle_one()
    bundle.nbs = [
        NBSSnapshot(
            pathway_id="other",
            currency="NGN",
            min_monthly=100000,
            max_monthly=200000,
            recency="2026-Q1",
            confidence=0.7,
        )
    ]
    with pytest.raises(LabourMarketETLValidationError, match=":nbs"):
        merge_sources(bundle, require_flag=False)


def test_merge_rejects_missing_adzuna_coverage() -> None:
    bundle = _bundle_one()
    bundle.adzuna_ng = [
        AdzunaSnapshot(
            pathway_id="other",
            posting_count=10,
            posting_growth_pct=0.0,
            recency="2026-Q1",
            confidence=0.7,
        )
    ]
    with pytest.raises(LabourMarketETLValidationError, match=":adzuna_ng"):
        merge_sources(bundle, require_flag=False)


def test_merge_rejects_duplicate_esco_rows() -> None:
    bundle = _bundle_one()
    bundle.esco.append(copy.deepcopy(bundle.esco[0]))
    with pytest.raises(LabourMarketETLValidationError, match="duplicate ESCO"):
        merge_sources(bundle, require_flag=False)


# ---------------------------------------------------------------------------
# Reviewer gating
# ---------------------------------------------------------------------------


def test_draft_promotion_requires_two_distinct_reviewers() -> None:
    draft = merge_sources(_bundle_one(), require_flag=False)
    # Not promotable while pending.
    with pytest.raises(LabourMarketETLValidationError):
        draft.promote()
    # Single reviewer is still insufficient even with state flipped.
    draft.review_state = "approved"
    draft.signoffs = [ReviewerSignoff(reviewer_id="alice", reviewed_at="2026-05-27T10:00:00Z")]
    assert not draft.is_promotable()
    # Two distinct reviewers + approved → promote yields a real dataset.
    draft.signoffs = draft.signoffs + [
        ReviewerSignoff(reviewer_id="bob", reviewed_at="2026-05-27T11:00:00Z")
    ]
    assert draft.is_promotable()
    dataset = draft.promote()
    assert isinstance(dataset, LabourMarketDataset)
    assert dataset.records == draft.dataset.records


def test_draft_promotion_rejects_same_reviewer_twice() -> None:
    draft = merge_sources(_bundle_one(), require_flag=False)
    draft.review_state = "approved"
    draft.signoffs = [
        ReviewerSignoff(reviewer_id="alice", reviewed_at="2026-05-27T10:00:00Z"),
        ReviewerSignoff(reviewer_id="alice", reviewed_at="2026-05-27T11:00:00Z"),
    ]
    assert not draft.is_promotable()


# ---------------------------------------------------------------------------
# Kill switch
# ---------------------------------------------------------------------------


def test_merge_gated_by_flag(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(ETL_FLAG, raising=False)
    with pytest.raises(LabourMarketETLUnavailableError):
        merge_sources(_bundle_one(), require_flag=True)


def test_merge_unlocked_with_flag(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(ETL_FLAG, "1")
    draft = merge_sources(_bundle_one(), require_flag=True)
    assert draft.review_state == "pending_two_reviewer_signoff"


# ---------------------------------------------------------------------------
# v0 dataset (real source snapshots)
# ---------------------------------------------------------------------------


@pytest.mark.skipif(
    not (SOURCES_ROOT / "esco.json").exists(),
    reason="v0 source snapshots not present",
)
def test_v0_dataset_builds_from_real_snapshots() -> None:
    draft = build_dataset_from_path(SOURCES_ROOT, require_flag=False)
    assert draft.review_state == "pending_two_reviewer_signoff"
    assert len(draft.dataset.records) >= 20
    # Every record must validate the LabourMarketRecord contract (model_validate happened
    # during merge); also assert pathway-id uniqueness and provenance presence.
    seen = set()
    for r in draft.dataset.records:
        assert r.pathway_id not in seen
        seen.add(r.pathway_id)
        assert len(r.provenance) >= 1
        assert r.wage_band.source in {"nbs", "nbs+ons"}
        assert r.demand_trend.source == "adzuna_ng"


@pytest.mark.skipif(
    not DRAFT_PATH.exists(),
    reason="v0 draft JSON not present",
)
def test_v0_draft_file_round_trips_through_pydantic() -> None:
    payload = json.loads(DRAFT_PATH.read_text(encoding="utf-8"))
    draft = LabourMarketDatasetDraft.model_validate(payload)
    assert draft.review_state == "pending_two_reviewer_signoff"
    assert draft.etl_rule_id == ETL_RULE_ID
    assert draft.dataset.dataset_id == "nigeria-career-labour-market-v0"
    assert len(draft.dataset.records) >= 20


@pytest.mark.skipif(
    not (SOURCES_ROOT / "esco.json").exists(),
    reason="v0 source snapshots not present",
)
def test_v0_dataset_drives_planner_end_to_end() -> None:
    from src.learning.career.planner import DeterministicCareerPlanner
    from src.learning.models import Provenance
    from src.learning.planner import PlannerRequest

    draft = build_dataset_from_path(SOURCES_ROOT, require_flag=False)
    planner = DeterministicCareerPlanner(draft.dataset.records)
    request = PlannerRequest(
        tenant_id="t-1",
        actor_id="stu-1",
        role="student",
        prompt="career",
        lang="en",
        provenance=[Provenance(source="test", confidence=1.0, evidence_count=1)],
        scope={
            "student_id": "stu-1",
            "mastery_profile": {"linear-equations": 0.8, "data-handling": 0.7},
            "career_consent": True,
        },
    )
    result = planner.run_turn(request)
    assert len(result.plan.pathways) == len(draft.dataset.records)
    # Pathways are sorted descending by fit_score.
    scores = [p.fit_score for p in result.plan.pathways]
    assert scores == sorted(scores, reverse=True)
