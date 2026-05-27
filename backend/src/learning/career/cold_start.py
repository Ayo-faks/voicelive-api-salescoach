"""W6 — Career cold-start quiz + mastery blend.

A deterministic, 12-item RIASEC-style interest+aptitude quiz that yields a
synthetic mastery_profile usable by the existing
:class:`DeterministicCareerPlanner` when a learner has no observed mastery
yet. When mastery observations exist, :func:`blend_mastery_profiles`
combines them with the cold-start estimate by a confidence-weighted
average (more observations → less weight on the cold-start prior).

Frozen-surface guarantee: this module does NOT modify the planner, the
Advisor, or any UI surface. It only produces a ``Dict[str, float]`` shaped
to drop into ``PlannerRequest.scope["mastery_profile"]``.

Kill switch: ``LEARNING_CAREER_COLD_START_V1``.
"""

from __future__ import annotations

import os
from typing import Dict, Final, List, Mapping, Sequence, Tuple

from pydantic import Field

from src.learning.models import ContractModel, Provenance


COLD_START_FLAG: Final[str] = "LEARNING_CAREER_COLD_START_V1"
QUIZ_VERSION: Final[str] = "cold_start_v1.0.0"
QUIZ_RULE_ID: Final[str] = "w6_career_cold_start_v1"

# RIASEC factors (Holland codes).
RIASEC_FACTORS: Final[Tuple[str, ...]] = (
    "realistic",
    "investigative",
    "artistic",
    "social",
    "enterprising",
    "conventional",
)

# Likert response scale: 1 (strongly disagree) … 5 (strongly agree). The
# blender treats 3 as neutral.
LIKERT_MIN: Final[int] = 1
LIKERT_MAX: Final[int] = 5

# Cold-start prior strength in "equivalent observations". When the learner
# has K observations against a skill_id, the blend weight on the cold-start
# estimate is COLD_START_PRIOR_N / (COLD_START_PRIOR_N + K).
COLD_START_PRIOR_N: Final[float] = 3.0

_TRUTHY: Final[frozenset[str]] = frozenset({"1", "true", "yes", "on", "enabled"})


def cold_start_enabled() -> bool:
    return os.environ.get(COLD_START_FLAG, "").strip().lower() in _TRUTHY


class ColdStartUnavailableError(RuntimeError):
    """Raised when the kill switch is off and ``require_flag=True``."""


class ColdStartItem(ContractModel):
    """A single quiz prompt with RIASEC and skill mappings."""

    item_id: str = Field(min_length=1)
    prompt: str = Field(min_length=1)
    factor: str = Field(min_length=1)
    skill_weights: Dict[str, float] = Field(min_length=1)


class ColdStartResponse(ContractModel):
    item_id: str = Field(min_length=1)
    likert: int = Field(ge=LIKERT_MIN, le=LIKERT_MAX)


class ColdStartResult(ContractModel):
    """Output of scoring a complete quiz submission."""

    student_id: str = Field(min_length=1)
    quiz_version: str = Field(min_length=1)
    factor_scores: Dict[str, float] = Field(min_length=1)
    mastery_profile: Dict[str, float] = Field(min_length=1)
    provenance: List[Provenance] = Field(min_length=1)


def _validate_factor(factor: str) -> str:
    if factor not in RIASEC_FACTORS:
        raise ValueError(f"unknown RIASEC factor: {factor!r}")
    return factor


# Two prompts per RIASEC factor (12 items total). Each prompt maps to one
# or more skill_ids drawn from the existing Pathfinder catalogue
# (linear-equations, ratio-proportion, fraction-operations, plane-geometry,
# algorithms, computer-basics, data-handling, composition, grammar-syntax,
# vocabulary, reading-comprehension, scientific-method, online-safety).
_ITEMS_RAW: Tuple[Tuple[str, str, str, Dict[str, float]], ...] = (
    ("cs-r1", "I enjoy building or repairing physical things.", "realistic",
     {"plane-geometry": 0.6, "ratio-proportion": 0.4}),
    ("cs-r2", "I would rather work outdoors with my hands than at a desk.", "realistic",
     {"plane-geometry": 0.5, "scientific-method": 0.5}),
    ("cs-i1", "I like solving puzzles and figuring out how things work.", "investigative",
     {"algorithms": 0.5, "linear-equations": 0.3, "scientific-method": 0.2}),
    ("cs-i2", "I enjoy science experiments and asking 'why?'", "investigative",
     {"scientific-method": 0.6, "data-handling": 0.4}),
    ("cs-a1", "I like writing stories, drawing, or making music.", "artistic",
     {"composition": 0.6, "vocabulary": 0.4}),
    ("cs-a2", "I notice details others miss in pictures, songs, or stories.", "artistic",
     {"reading-comprehension": 0.5, "composition": 0.5}),
    ("cs-s1", "I like teaching or explaining things to friends.", "social",
     {"reading-comprehension": 0.5, "grammar-syntax": 0.5}),
    ("cs-s2", "I feel good when I help someone solve a problem.", "social",
     {"reading-comprehension": 0.6, "vocabulary": 0.4}),
    ("cs-e1", "I like leading a team or organising an event.", "enterprising",
     {"composition": 0.4, "ratio-proportion": 0.3, "grammar-syntax": 0.3}),
    ("cs-e2", "I would enjoy running my own small business one day.", "enterprising",
     {"ratio-proportion": 0.5, "fraction-operations": 0.5}),
    ("cs-c1", "I like keeping things organised and tidy.", "conventional",
     {"data-handling": 0.6, "fraction-operations": 0.4}),
    ("cs-c2", "I am careful with details, lists, and step-by-step work.", "conventional",
     {"data-handling": 0.5, "computer-basics": 0.5}),
)


def _build_quiz() -> Tuple[ColdStartItem, ...]:
    items: List[ColdStartItem] = []
    for item_id, prompt, factor, weights in _ITEMS_RAW:
        _validate_factor(factor)
        total = sum(weights.values())
        if abs(total - 1.0) > 1e-6:
            raise ValueError(
                f"skill_weights for {item_id} must sum to 1.0 (got {total})"
            )
        items.append(
            ColdStartItem(
                item_id=item_id,
                prompt=prompt,
                factor=factor,
                skill_weights=dict(weights),
            )
        )
    return tuple(items)


QUIZ_ITEMS: Final[Tuple[ColdStartItem, ...]] = _build_quiz()
_ITEMS_BY_ID: Final[Dict[str, ColdStartItem]] = {it.item_id: it for it in QUIZ_ITEMS}


def get_quiz(*, require_flag: bool = True) -> Tuple[ColdStartItem, ...]:
    """Return the canonical cold-start quiz.

    Gated by ``LEARNING_CAREER_COLD_START_V1`` unless ``require_flag=False``.
    """
    if require_flag and not cold_start_enabled():
        raise ColdStartUnavailableError(
            f"{COLD_START_FLAG} is off; cold-start quiz is not available."
        )
    return QUIZ_ITEMS


def _likert_to_unit(value: int) -> float:
    """Map Likert {1..5} → unit interval centred on 0.5.

    1 → 0.0, 2 → 0.25, 3 → 0.5, 4 → 0.75, 5 → 1.0.
    """
    if not LIKERT_MIN <= value <= LIKERT_MAX:
        raise ValueError(f"Likert response out of range: {value}")
    return (value - LIKERT_MIN) / (LIKERT_MAX - LIKERT_MIN)


def score_quiz(
    *,
    student_id: str,
    responses: Sequence[ColdStartResponse],
    require_flag: bool = True,
) -> ColdStartResult:
    """Score a full quiz submission.

    The student must answer EVERY item exactly once; partial or duplicated
    submissions are rejected. Output is a deterministic function of the
    inputs.
    """
    if require_flag and not cold_start_enabled():
        raise ColdStartUnavailableError(
            f"{COLD_START_FLAG} is off; cold-start scoring is not available."
        )
    if not student_id:
        raise ValueError("student_id must be non-empty")

    seen: set[str] = set()
    by_id: Dict[str, ColdStartResponse] = {}
    for r in responses:
        if r.item_id in seen:
            raise ValueError(f"duplicate response for {r.item_id}")
        seen.add(r.item_id)
        if r.item_id not in _ITEMS_BY_ID:
            raise ValueError(f"unknown quiz item: {r.item_id}")
        by_id[r.item_id] = r
    missing = sorted(set(_ITEMS_BY_ID) - seen)
    if missing:
        raise ValueError(f"missing responses for items: {missing}")

    factor_totals: Dict[str, float] = {f: 0.0 for f in RIASEC_FACTORS}
    factor_counts: Dict[str, int] = {f: 0 for f in RIASEC_FACTORS}
    skill_totals: Dict[str, float] = {}
    skill_weight_totals: Dict[str, float] = {}

    for item in QUIZ_ITEMS:
        unit = _likert_to_unit(by_id[item.item_id].likert)
        factor_totals[item.factor] += unit
        factor_counts[item.factor] += 1
        for skill_id, w in item.skill_weights.items():
            skill_totals[skill_id] = skill_totals.get(skill_id, 0.0) + unit * w
            skill_weight_totals[skill_id] = skill_weight_totals.get(skill_id, 0.0) + w

    factor_scores = {
        f: round(factor_totals[f] / factor_counts[f], 4) for f in RIASEC_FACTORS
    }
    mastery_profile = {
        skill_id: round(skill_totals[skill_id] / skill_weight_totals[skill_id], 4)
        for skill_id in skill_totals
    }

    provenance = [
        Provenance(
            source="CareerColdStartQuiz",
            rule_id=QUIZ_RULE_ID,
            confidence=0.6,
            evidence_count=len(QUIZ_ITEMS),
            metadata={"quiz_version": QUIZ_VERSION},
        )
    ]
    return ColdStartResult(
        student_id=student_id,
        quiz_version=QUIZ_VERSION,
        factor_scores=factor_scores,
        mastery_profile=mastery_profile,
        provenance=provenance,
    )


# ---------------------------------------------------------------------------
# Blend with observed mastery
# ---------------------------------------------------------------------------


def blend_mastery_profiles(
    *,
    cold_start: Mapping[str, float],
    observed: Mapping[str, float],
    observation_counts: Mapping[str, int],
    prior_n: float = COLD_START_PRIOR_N,
) -> Dict[str, float]:
    """Confidence-weighted blend of cold-start and observed mastery.

    For each skill, alpha = ``prior_n / (prior_n + n_observed)``. The
    output value is ``alpha * cold_start + (1 - alpha) * observed`` clipped
    to ``[0.0, 1.0]``. Skills appearing only in one input are passed
    through (cold-start) or fully trusted (observed with ≥1 obs).
    """
    if prior_n <= 0:
        raise ValueError("prior_n must be > 0")

    all_skills = set(cold_start) | set(observed)
    blended: Dict[str, float] = {}
    for skill in all_skills:
        cs = cold_start.get(skill)
        obs = observed.get(skill)
        n = max(0, int(observation_counts.get(skill, 0)))
        if cs is None and obs is None:
            continue  # unreachable but defensive
        if cs is None:
            blended[skill] = round(_clip(float(obs)), 4)
            continue
        if obs is None or n == 0:
            blended[skill] = round(_clip(float(cs)), 4)
            continue
        alpha = prior_n / (prior_n + n)
        blended[skill] = round(_clip(alpha * cs + (1.0 - alpha) * obs), 4)
    return blended


def _clip(x: float) -> float:
    if x < 0.0:
        return 0.0
    if x > 1.0:
        return 1.0
    return x
