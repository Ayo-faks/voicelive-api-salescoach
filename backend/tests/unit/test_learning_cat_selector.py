"""Tests for the CAT (catsim) item selector (A2)."""

from __future__ import annotations

from typing import List

import pytest

from src.learning.cat import CAT_MIN_BANK_SIZE, CatsimItemSelector
from src.learning.diagnostic import DiagnosticItemBank
from src.learning.models import DiagnosticItem, MasteryEstimate, Provenance, Skill


def _provenance() -> List[Provenance]:
    return [Provenance(source="test", rule_id="cat_test")]


def _make_bank(item_count: int, skill_count: int = 2) -> DiagnosticItemBank:
    skills = [
        Skill(skill_id=f"skill-{i}", standard_id="std-1", name=f"Skill {i}")
        for i in range(skill_count)
    ]
    items: List[DiagnosticItem] = []
    for i in range(item_count):
        items.append(
            DiagnosticItem(
                item_id=f"item-{i}",
                skill_id=skills[i % skill_count].skill_id,
                prompt=f"Q{i}?",
                item_type="short_answer",
                difficulty=float((i % 5) - 2),
                correct_answer="x",
                lang="en-NG",
                provenance=_provenance(),
            )
        )
    return DiagnosticItemBank(
        diagnostic_id="diag-1",
        tenant_id="tenant-a",
        title="Test Bank",
        skills=skills,
        items=items,
        lang="en-NG",
        provenance=_provenance(),
    )


def test_catsim_selector_falls_back_when_bank_too_small() -> None:
    selector = CatsimItemSelector(min_bank_size=CAT_MIN_BANK_SIZE)
    bank = _make_bank(item_count=4)

    selected = selector.select_items(bank, prior_mastery={}, limit=4)

    assert len(selected) == 4
    assert {item.item_id for item in selected} == {f"item-{i}" for i in range(4)}


def test_catsim_selector_falls_back_when_skill_has_no_items() -> None:
    selector = CatsimItemSelector(min_bank_size=2)
    bank = _make_bank(item_count=12, skill_count=2)
    # Inject a third skill with no items
    extra = Skill(skill_id="skill-orphan", standard_id="std-1", name="Orphan")
    bank = bank.model_copy(update={"skills": list(bank.skills) + [extra]})

    selected = selector.select_items(bank, prior_mastery={}, limit=6)

    assert len(selected) == 6


def test_catsim_selector_returns_capped_count() -> None:
    selector = CatsimItemSelector(min_bank_size=2)
    bank = _make_bank(item_count=15, skill_count=3)

    selected = selector.select_items(bank, prior_mastery={}, limit=8)

    assert len(selected) == 8
    # All items unique
    assert len({item.item_id for item in selected}) == 8


def test_catsim_selector_offline_fallback_available_flag() -> None:
    selector = CatsimItemSelector()
    assert selector.offline_fallback_available is True


def test_catsim_selector_uses_prior_mastery_when_catsim_unavailable() -> None:
    """The deterministic fallback ranks skills by prior probability."""
    selector = CatsimItemSelector(min_bank_size=999)  # force fallback
    bank = _make_bank(item_count=10, skill_count=2)

    prior = {
        "skill-0": MasteryEstimate(
            kind="beta", probability=0.2, uncertainty=0.4, a=2.0, b=8.0
        ),
        "skill-1": MasteryEstimate(
            kind="beta", probability=0.8, uncertainty=0.2, a=8.0, b=2.0
        ),
    }

    selected = selector.select_items(bank, prior_mastery=prior, limit=4)
    assert len(selected) == 4
