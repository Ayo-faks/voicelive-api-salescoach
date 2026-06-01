"""Recency-aware read-side behaviour: selection ordering and heatmap status.

These tests pin the second half of the anti-staleness contract. The estimator
decays uncertainty as evidence ages (covered in
``test_learning_mastery_decay``); here we verify the read paths react to that:

* a stale-but-confident skill is re-surfaced earlier by the deterministic
  selector even though its point estimate still looks secure, and
* ``heatmap_status`` demotes a stale "secure" skill to "developing" without any
  new response.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import List

from src.learning.diagnostic import (
    DeterministicItemSelector,
    DiagnosticItemBank,
    heatmap_status,
    selection_priority,
)
from src.learning.models import DiagnosticItem, MasteryEstimate, Provenance, Skill


def _provenance() -> List[Provenance]:
    return [Provenance(source="test", rule_id="recency_test")]


def _make_bank() -> DiagnosticItemBank:
    skills = [
        Skill(skill_id="fresh", standard_id="std-1", name="Fresh"),
        Skill(skill_id="stale", standard_id="std-1", name="Stale"),
    ]
    items: List[DiagnosticItem] = []
    for skill in skills:
        for i in range(4):
            items.append(
                DiagnosticItem(
                    item_id=f"{skill.skill_id}-{i}",
                    skill_id=skill.skill_id,
                    prompt=f"{skill.skill_id} Q{i}?",
                    item_type="short_answer",
                    difficulty=float(i - 2),
                    correct_answer="x",
                    lang="en-NG",
                    provenance=_provenance(),
                )
            )
    return DiagnosticItemBank(
        diagnostic_id="diag-recency",
        tenant_id="tenant-a",
        title="Recency Bank",
        skills=skills,
        items=items,
        lang="en-NG",
        provenance=_provenance(),
    )


def _secure(probability: float, uncertainty: float, as_of: datetime | None) -> MasteryEstimate:
    return MasteryEstimate(
        kind="beta",
        probability=probability,
        uncertainty=uncertainty,
        a=8.0,
        b=2.0,
        as_of=as_of.isoformat() if as_of else None,
    )


def test_selection_priority_pulls_stale_secure_skill_forward() -> None:
    now = datetime(2026, 6, 1, tzinfo=timezone.utc)
    fresh = _secure(0.85, 0.2, now)
    stale = _secure(0.85, 0.2, now - timedelta(days=120))  # ~4 half-lives old

    # Same point estimate, but the stale skill must sort earlier (lower key).
    assert selection_priority(stale, now) < selection_priority(fresh, now)


def test_deterministic_selector_resurfaces_stale_skill_first() -> None:
    bank = _make_bank()
    now = datetime.now(timezone.utc)
    prior = {
        "fresh": _secure(0.85, 0.2, now),
        "stale": _secure(0.85, 0.2, now - timedelta(days=150)),
    }

    selected = DeterministicItemSelector().select_items(bank, prior, limit=2)

    # Round-robin starts from the highest-priority (lowest key) skill, so the
    # stale skill's first item leads the assessment.
    assert selected[0].skill_id == "stale"


def test_heatmap_status_demotes_stale_secure_estimate() -> None:
    now = datetime(2026, 6, 1, tzinfo=timezone.utc)
    fresh = _secure(0.9, 0.2, now)
    stale = _secure(0.9, 0.2, now - timedelta(days=120))

    assert heatmap_status(fresh, now=now) == "secure"
    assert heatmap_status(stale, now=now) == "developing"


def test_heatmap_status_unchanged_without_as_of() -> None:
    # Back-compat: estimates with no timestamp keep their raw classification.
    secure = _secure(0.9, 0.2, None)
    assert heatmap_status(secure) == "secure"


def test_selection_priority_unknown_skill_is_neutral() -> None:
    assert selection_priority(None) == 0.5
