"""Track C / C1 next-best-question policy stub — dark-by-default guarantees.

These tests pin the only contract the C1 stub is allowed to have right now: it
must behave *exactly* like the round-robin ``DeterministicItemSelector`` until it
is explicitly, gatedly promoted with a human-loaded policy. The learned path is
shadow-only (proposes, never changes output) until ``promote()``.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Mapping

import pytest

from src.agents.durable_sink import InMemoryDurableSink
from src.learning.diagnostic import DeterministicItemSelector, DiagnosticItemBank
from src.learning.eval.c1_policy import (
    C1_POLICY_FLAG,
    MESH_ENABLED_FLAG,
    SINK_KIND,
    C1DarkError,
    C1Proposal,
    LearnedItemSelector,
    c1_policy_enabled,
)
from src.learning.models import DiagnosticItem, MasteryEstimate, Provenance, Skill


def _provenance() -> List[Provenance]:
    return [Provenance(source="test", rule_id="c1_policy_test")]


def _make_bank() -> DiagnosticItemBank:
    skills = [
        Skill(skill_id="alpha", standard_id="std-1", name="Alpha"),
        Skill(skill_id="beta", standard_id="std-1", name="Beta"),
    ]
    items: List[DiagnosticItem] = []
    for skill in skills:
        for i in range(3):
            items.append(
                DiagnosticItem(
                    item_id=f"{skill.skill_id}-{i}",
                    skill_id=skill.skill_id,
                    prompt=f"{skill.skill_id} Q{i}?",
                    item_type="short_answer",
                    difficulty=float(i - 1),
                    correct_answer="x",
                    lang="en-NG",
                    provenance=_provenance(),
                )
            )
    return DiagnosticItemBank(
        diagnostic_id="diag-c1",
        tenant_id="tenant-a",
        title="C1 Bank",
        skills=skills,
        items=items,
        lang="en-NG",
        provenance=_provenance(),
    )


class _ReversePolicy:
    """A fake human-promoted policy that simply reverses the baseline order."""

    def rank(
        self,
        candidates: List[DiagnosticItem],
        prior_mastery: Mapping[str, MasteryEstimate],
    ) -> List[DiagnosticItem]:
        return list(reversed(candidates))


def _enable(monkeypatch) -> None:
    monkeypatch.setenv(MESH_ENABLED_FLAG, "1")
    monkeypatch.setenv(C1_POLICY_FLAG, "1")


def _ids(items: List[DiagnosticItem]) -> List[str]:
    return [item.item_id for item in items]


# --- dark-by-default ----------------------------------------------------- #
def test_disabled_by_default(monkeypatch) -> None:
    monkeypatch.delenv(MESH_ENABLED_FLAG, raising=False)
    monkeypatch.delenv(C1_POLICY_FLAG, raising=False)
    assert c1_policy_enabled() is False


def test_requires_both_flags(monkeypatch) -> None:
    monkeypatch.setenv(MESH_ENABLED_FLAG, "1")
    monkeypatch.delenv(C1_POLICY_FLAG, raising=False)
    assert c1_policy_enabled() is False
    monkeypatch.delenv(MESH_ENABLED_FLAG, raising=False)
    monkeypatch.setenv(C1_POLICY_FLAG, "1")
    assert c1_policy_enabled() is False


def test_dark_output_matches_round_robin_no_flags(monkeypatch) -> None:
    monkeypatch.delenv(MESH_ENABLED_FLAG, raising=False)
    monkeypatch.delenv(C1_POLICY_FLAG, raising=False)
    bank = _make_bank()
    prior: Mapping[str, MasteryEstimate] = {}

    baseline = DeterministicItemSelector().select_items(bank, prior, limit=4)
    learned = LearnedItemSelector(policy=_ReversePolicy()).select_items(bank, prior, limit=4)

    assert _ids(learned) == _ids(baseline)


def test_dark_even_with_flags_when_not_promoted(monkeypatch) -> None:
    # Flags ON and a policy loaded, but no promote(): still shadow → baseline out.
    _enable(monkeypatch)
    bank = _make_bank()
    prior: Mapping[str, MasteryEstimate] = {}

    baseline = DeterministicItemSelector().select_items(bank, prior, limit=4)
    selector = LearnedItemSelector(policy=_ReversePolicy())
    assert _ids(selector.select_items(bank, prior, limit=4)) == _ids(baseline)


def test_dark_with_flags_but_no_policy(monkeypatch) -> None:
    _enable(monkeypatch)
    bank = _make_bank()
    prior: Mapping[str, MasteryEstimate] = {}

    baseline = DeterministicItemSelector().select_items(bank, prior, limit=4)
    selector = LearnedItemSelector()  # no policy → permanently dark
    assert _ids(selector.select_items(bank, prior, limit=4)) == _ids(baseline)


# --- promote() gate ------------------------------------------------------ #
def test_promote_refused_while_flags_off(monkeypatch) -> None:
    monkeypatch.delenv(MESH_ENABLED_FLAG, raising=False)
    monkeypatch.delenv(C1_POLICY_FLAG, raising=False)
    selector = LearnedItemSelector(policy=_ReversePolicy())
    with pytest.raises(C1DarkError):
        selector.promote()
    assert selector.promoted is False


def test_promote_refused_without_policy(monkeypatch) -> None:
    _enable(monkeypatch)
    selector = LearnedItemSelector()  # no policy loaded
    with pytest.raises(C1DarkError):
        selector.promote()
    assert selector.promoted is False


def test_promote_then_learned_order_wins(monkeypatch) -> None:
    _enable(monkeypatch)
    bank = _make_bank()
    prior: Mapping[str, MasteryEstimate] = {}

    baseline = DeterministicItemSelector().select_items(bank, prior, limit=4)
    selector = LearnedItemSelector(policy=_ReversePolicy())
    selector.promote()
    promoted = selector.select_items(bank, prior, limit=4)

    # Same set of items, but reordered by the policy (reverse of baseline).
    assert set(_ids(promoted)) == set(_ids(baseline))
    assert _ids(promoted) == list(reversed(_ids(baseline)))


def test_suspend_reverts_to_baseline(monkeypatch) -> None:
    _enable(monkeypatch)
    bank = _make_bank()
    prior: Mapping[str, MasteryEstimate] = {}

    baseline = DeterministicItemSelector().select_items(bank, prior, limit=4)
    selector = LearnedItemSelector(policy=_ReversePolicy())
    selector.promote()
    selector.suspend()
    assert _ids(selector.select_items(bank, prior, limit=4)) == _ids(baseline)


# --- shadow proposals ---------------------------------------------------- #
def test_shadow_records_proposal_without_changing_output(monkeypatch) -> None:
    _enable(monkeypatch)
    bank = _make_bank()
    prior: Mapping[str, MasteryEstimate] = {}
    sink = InMemoryDurableSink()

    baseline = DeterministicItemSelector().select_items(bank, prior, limit=4)
    selector = LearnedItemSelector(policy=_ReversePolicy(), sink=sink)
    out = selector.select_items(bank, prior, limit=4)

    # Output unchanged (shadow), but a proposal was recorded for Track A.
    assert _ids(out) == _ids(baseline)
    records = sink.read(kind=SINK_KIND)
    assert len(records) == 1
    assert records[0].payload["diverged"] is True


def test_no_shadow_record_when_dark(monkeypatch) -> None:
    monkeypatch.delenv(MESH_ENABLED_FLAG, raising=False)
    monkeypatch.delenv(C1_POLICY_FLAG, raising=False)
    bank = _make_bank()
    sink = InMemoryDurableSink()

    LearnedItemSelector(policy=_ReversePolicy(), sink=sink).select_items(bank, {}, limit=4)
    assert sink.counts_by_kind().get(SINK_KIND, 0) == 0


def test_propose_never_changes_output_and_reports_divergence(monkeypatch) -> None:
    _enable(monkeypatch)
    bank = _make_bank()
    prior: Mapping[str, MasteryEstimate] = {}

    selector = LearnedItemSelector(policy=_ReversePolicy())
    proposal = selector.propose(bank, prior, limit=4)
    assert isinstance(proposal, C1Proposal)
    assert proposal.engaged is True
    assert proposal.diverged is True
    assert proposal.proposed_order == tuple(reversed(proposal.baseline_order))


def test_propose_without_policy_is_inert(monkeypatch) -> None:
    _enable(monkeypatch)
    bank = _make_bank()
    selector = LearnedItemSelector()
    proposal = selector.propose(bank, {}, limit=4)
    assert proposal.engaged is False
    assert proposal.diverged is False
    assert proposal.baseline_order == proposal.proposed_order


def test_satisfies_selector_protocol_surface() -> None:
    selector = LearnedItemSelector()
    assert selector.offline_fallback_available is True
    assert hasattr(selector, "select_items")
