"""W6 — career cold-start quiz contract tests."""

from __future__ import annotations

import os

import pytest

from src.learning.career.cold_start import (
    COLD_START_FLAG,
    COLD_START_PRIOR_N,
    LIKERT_MAX,
    LIKERT_MIN,
    QUIZ_ITEMS,
    QUIZ_VERSION,
    RIASEC_FACTORS,
    ColdStartResponse,
    ColdStartUnavailableError,
    blend_mastery_profiles,
    get_quiz,
    score_quiz,
)


def _full_responses(value: int = 3) -> list[ColdStartResponse]:
    return [ColdStartResponse(item_id=it.item_id, likert=value) for it in QUIZ_ITEMS]


# ---------------------------------------------------------------------------
# Quiz shape
# ---------------------------------------------------------------------------


def test_quiz_has_twelve_items() -> None:
    assert len(QUIZ_ITEMS) == 12


def test_quiz_covers_all_riasec_factors_with_two_items_each() -> None:
    counts: dict[str, int] = {f: 0 for f in RIASEC_FACTORS}
    for item in QUIZ_ITEMS:
        counts[item.factor] += 1
    assert all(c == 2 for c in counts.values()), counts


def test_quiz_item_ids_are_unique() -> None:
    ids = [it.item_id for it in QUIZ_ITEMS]
    assert len(ids) == len(set(ids))


def test_quiz_skill_weights_sum_to_one_each_item() -> None:
    for item in QUIZ_ITEMS:
        assert abs(sum(item.skill_weights.values()) - 1.0) < 1e-6, item.item_id


def test_quiz_touches_at_least_eight_distinct_skills() -> None:
    skills: set[str] = set()
    for it in QUIZ_ITEMS:
        skills.update(it.skill_weights)
    assert len(skills) >= 8, skills


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------


def test_score_neutral_midpoint_yields_half() -> None:
    result = score_quiz(
        student_id="stu-1",
        responses=_full_responses(value=3),
        require_flag=False,
    )
    assert result.quiz_version == QUIZ_VERSION
    assert all(0.49 <= v <= 0.51 for v in result.factor_scores.values())
    assert all(0.49 <= v <= 0.51 for v in result.mastery_profile.values())


def test_score_max_likert_yields_one() -> None:
    result = score_quiz(
        student_id="stu-1",
        responses=_full_responses(value=LIKERT_MAX),
        require_flag=False,
    )
    assert all(v == 1.0 for v in result.factor_scores.values())
    assert all(v == 1.0 for v in result.mastery_profile.values())


def test_score_min_likert_yields_zero() -> None:
    result = score_quiz(
        student_id="stu-1",
        responses=_full_responses(value=LIKERT_MIN),
        require_flag=False,
    )
    assert all(v == 0.0 for v in result.factor_scores.values())
    assert all(v == 0.0 for v in result.mastery_profile.values())


def test_score_is_deterministic() -> None:
    r1 = score_quiz(
        student_id="stu-1", responses=_full_responses(value=4), require_flag=False
    )
    r2 = score_quiz(
        student_id="stu-1", responses=_full_responses(value=4), require_flag=False
    )
    assert r1.factor_scores == r2.factor_scores
    assert r1.mastery_profile == r2.mastery_profile


def test_score_rejects_missing_responses() -> None:
    partial = _full_responses(value=3)[:-1]
    with pytest.raises(ValueError, match="missing responses"):
        score_quiz(student_id="stu-1", responses=partial, require_flag=False)


def test_score_rejects_duplicate_responses() -> None:
    bad = _full_responses(value=3) + [
        ColdStartResponse(item_id=QUIZ_ITEMS[0].item_id, likert=4)
    ]
    with pytest.raises(ValueError, match="duplicate response"):
        score_quiz(student_id="stu-1", responses=bad, require_flag=False)


def test_score_rejects_unknown_item() -> None:
    bad = _full_responses(value=3)
    bad[0] = ColdStartResponse(item_id="cs-bogus", likert=3)
    with pytest.raises(ValueError, match="unknown quiz item"):
        score_quiz(student_id="stu-1", responses=bad, require_flag=False)


def test_likert_validation_at_model_layer() -> None:
    with pytest.raises(Exception):
        ColdStartResponse(item_id="cs-r1", likert=6)
    with pytest.raises(Exception):
        ColdStartResponse(item_id="cs-r1", likert=0)


# ---------------------------------------------------------------------------
# Kill switch
# ---------------------------------------------------------------------------


def test_get_quiz_gated_by_flag(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(COLD_START_FLAG, raising=False)
    with pytest.raises(ColdStartUnavailableError):
        get_quiz(require_flag=True)


def test_score_quiz_gated_by_flag(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(COLD_START_FLAG, raising=False)
    with pytest.raises(ColdStartUnavailableError):
        score_quiz(
            student_id="s", responses=_full_responses(value=3), require_flag=True
        )


def test_flag_enabled_unlocks_quiz(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(COLD_START_FLAG, "1")
    items = get_quiz(require_flag=True)
    assert len(items) == 12


# ---------------------------------------------------------------------------
# Blend
# ---------------------------------------------------------------------------


def test_blend_returns_cold_start_when_no_observations() -> None:
    cs = {"algorithms": 0.8, "fraction-operations": 0.6}
    blended = blend_mastery_profiles(
        cold_start=cs, observed={}, observation_counts={}
    )
    assert blended == cs


def test_blend_returns_observed_when_only_observed_present() -> None:
    obs = {"linear-equations": 0.7}
    blended = blend_mastery_profiles(
        cold_start={}, observed=obs, observation_counts={"linear-equations": 5}
    )
    assert blended == {"linear-equations": 0.7}


def test_blend_shrinks_toward_observed_as_count_grows() -> None:
    cs = {"data-handling": 0.3}
    obs = {"data-handling": 0.9}
    low_n = blend_mastery_profiles(
        cold_start=cs, observed=obs, observation_counts={"data-handling": 1}
    )
    high_n = blend_mastery_profiles(
        cold_start=cs, observed=obs, observation_counts={"data-handling": 30}
    )
    assert low_n["data-handling"] < high_n["data-handling"]
    # At n=COLD_START_PRIOR_N the blend is exactly halfway.
    half = blend_mastery_profiles(
        cold_start=cs, observed=obs,
        observation_counts={"data-handling": int(COLD_START_PRIOR_N)},
    )
    assert abs(half["data-handling"] - 0.6) < 1e-4


def test_blend_clips_to_unit_interval() -> None:
    out = blend_mastery_profiles(
        cold_start={"x": 1.5}, observed={}, observation_counts={}
    )
    assert out["x"] == 1.0
    out2 = blend_mastery_profiles(
        cold_start={"x": -0.4}, observed={}, observation_counts={}
    )
    assert out2["x"] == 0.0


def test_blend_output_plugs_into_planner_scope() -> None:
    """Smoke: blended profile shape matches the planner's scope contract."""
    from src.common.labour_market import (
        LabourMarketDataset,
        LabourMarketRecord,
    )
    from src.learning.career.planner import DeterministicCareerPlanner
    from src.learning.models import LabourMarketSignal, Provenance
    from src.learning.planner import PlannerRequest

    cs = score_quiz(
        student_id="stu-1", responses=_full_responses(value=4), require_flag=False
    )
    blended = blend_mastery_profiles(
        cold_start=cs.mastery_profile,
        observed={"linear-equations": 0.95},
        observation_counts={"linear-equations": 4},
    )
    record = LabourMarketRecord(
        pathway_id="p-1",
        title="Test",
        skill_weights={"linear-equations": 0.5, "data-handling": 0.5},
        wage_band=LabourMarketSignal(
            source="t", recency="2026-Q1", confidence=0.7, value={"score": 0.5}
        ),
        demand_trend=LabourMarketSignal(
            source="t", recency="2026-Q1", confidence=0.7, value={"score": 0.6}
        ),
        provenance=[Provenance(source="t", confidence=0.7, evidence_count=1)],
    )
    planner = DeterministicCareerPlanner([record])
    request = PlannerRequest(
        tenant_id="t-1",
        actor_id="stu-1",
        role="student",
        prompt="career",
        lang="en",
        provenance=[Provenance(source="test", confidence=1.0, evidence_count=1)],
        scope={
            "student_id": "stu-1",
            "mastery_profile": blended,
            "career_consent": True,
        },
    )
    result = planner.run_turn(request)
    assert len(result.plan.pathways) == 1
    assert 0.0 <= result.plan.pathways[0].fit_score <= 1.0
