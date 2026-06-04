"""Track C / C1 — next-best-question policy STUB (DARK / proposes-only).

C1 is the first (and smallest) Track C phase: a learned *next-best-question*
policy that would eventually replace the round-robin ``DeterministicItemSelector``
at the existing diagnostic / ``cat.py`` fallback seam. Per the signed plan it is
the largest-risk, brain-changing scope, so every phase is **offline-train →
batch-score (Track A) → shadow → human-promote**, each behind its own go-live
gate. **No live/online weight updates, ever.**

This module is that real starting point, deliberately suspended:

* :class:`LearnedItemSelector` satisfies the existing
  :class:`~src.learning.diagnostic.DiagnosticItemSelector` Protocol, so it can
  drop into the same seam the deterministic/catsim selectors use — without
  editing ``diagnostic.py`` or ``cat.py``.
* **Dark by default.** With the flags unset (or no human-promoted policy loaded)
  ``select_items`` returns the round-robin baseline **byte-for-byte**. Behaviour
  is identical to today.
* **Proposes only.** Even with the flag on *and* a policy loaded, the selector
  runs in **shadow**: it computes the learned ordering, records the
  proposal-vs-baseline divergence to the durable sink for Track A to score, and
  STILL returns the baseline. The learned order is only ever returned after an
  explicit :meth:`LearnedItemSelector.promote` go-live action — which itself
  refuses unless the flag is on and a policy has been loaded.
* **No training here.** The policy is an injected, offline-trained, human-promoted
  artifact (``NextBestQuestionPolicy``); there is none in the stub, so the stub is
  permanently dark until one is supplied through the gated process.

Flags: ``AGENT_MESH_ENABLED`` *and* ``LEARNING_C1_POLICY_V1``.

New file only. Reuses the diagnostic Protocol + durable-sink contracts; edits
nothing.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, List, Mapping, Optional, Protocol, Tuple, runtime_checkable

from src.learning.diagnostic import DeterministicItemSelector, DiagnosticItemBank
from src.learning.models import DiagnosticItem, MasteryEstimate

# Per-feature kill-switch. The learned path only ever engages when this *and*
# ``AGENT_MESH_ENABLED`` are truthy — and even then only after ``promote()``.
C1_POLICY_FLAG = "LEARNING_C1_POLICY_V1"
MESH_ENABLED_FLAG = "AGENT_MESH_ENABLED"

# Durable-sink kind the shadow proposals are recorded under.
SINK_KIND = "c1_policy_shadow"

_TRUTHY = frozenset({"1", "true", "yes", "on", "enabled"})


def _flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in _TRUTHY


def c1_policy_enabled() -> bool:
    """Whether C1 is opt-in enabled for this process (mesh + C1 flag)."""
    return _flag(MESH_ENABLED_FLAG) and _flag(C1_POLICY_FLAG)


class C1DarkError(RuntimeError):
    """Raised when the learned path is asked to go live while it must stay dark."""


@runtime_checkable
class NextBestQuestionPolicy(Protocol):
    """An offline-trained, human-promoted ordering policy.

    The stub ships with none. A real policy re-orders the baseline candidate list
    for a stronger next-best question; it never mutates state and never trains
    online — it is produced offline and promoted through the gate.
    """

    def rank(
        self,
        candidates: List[DiagnosticItem],
        prior_mastery: Mapping[str, MasteryEstimate],
    ) -> List[DiagnosticItem]:
        ...


@dataclass(frozen=True)
class C1Proposal:
    """A shadow proposal: what the policy *would* pick vs the live baseline."""

    baseline_order: Tuple[str, ...]
    proposed_order: Tuple[str, ...]
    engaged: bool

    @property
    def diverged(self) -> bool:
        return self.engaged and self.baseline_order != self.proposed_order

    def as_dict(self) -> dict:
        return {
            "baseline_order": list(self.baseline_order),
            "proposed_order": list(self.proposed_order),
            "engaged": self.engaged,
            "diverged": self.diverged,
        }


class LearnedItemSelector:
    """C1 stub selector. Satisfies ``DiagnosticItemSelector``; stays dark."""

    # Mirror the baseline so callers can self-fallback offline exactly as today.
    offline_fallback_available = True

    def __init__(
        self,
        *,
        baseline: Optional[Any] = None,
        policy: Optional[NextBestQuestionPolicy] = None,
        sink: Any = None,
    ) -> None:
        self._baseline = baseline or DeterministicItemSelector()
        self._policy = policy
        self._sink = sink
        self._promoted = False

    @property
    def promoted(self) -> bool:
        return self._promoted

    @property
    def has_policy(self) -> bool:
        return self._policy is not None

    def promote(self) -> None:
        """Go-live action: let the learned order win. Refuses while dark.

        Refuses unless the flag is on AND a human-promoted policy is loaded. This
        is the single, explicit, gated switch from shadow → live. The stub has no
        policy, so this raises — by design.
        """
        if not c1_policy_enabled():
            raise C1DarkError(
                f"C1 is dark; set {MESH_ENABLED_FLAG} and {C1_POLICY_FLAG} to enable"
            )
        if self._policy is None:
            raise C1DarkError("no human-promoted next-best-question policy loaded")
        self._promoted = True

    def suspend(self) -> None:
        """Revert to baseline output in one action."""
        self._promoted = False

    def select_items(
        self,
        item_bank: DiagnosticItemBank,
        prior_mastery: Mapping[str, MasteryEstimate],
        limit: int,
    ) -> List[DiagnosticItem]:
        baseline = self._baseline.select_items(item_bank, prior_mastery, limit)

        # DARK: no flag, no mesh, or no policy → identical to round-robin.
        if not (c1_policy_enabled() and self._policy is not None):
            return baseline

        # SHADOW: compute + record the proposal, but DO NOT change the output…
        proposal = self._build_proposal(baseline, prior_mastery)
        self._record(proposal)

        # …unless an operator has explicitly promoted the policy (go-live).
        if self._promoted:
            return self._apply_policy(baseline, prior_mastery)
        return baseline

    def propose(
        self,
        item_bank: DiagnosticItemBank,
        prior_mastery: Mapping[str, MasteryEstimate],
        limit: int,
    ) -> C1Proposal:
        """Compute the shadow proposal without ever affecting selection output."""
        baseline = self._baseline.select_items(item_bank, prior_mastery, limit)
        return self._build_proposal(baseline, prior_mastery)

    # -- internals -------------------------------------------------------- #
    def _apply_policy(
        self,
        baseline: List[DiagnosticItem],
        prior_mastery: Mapping[str, MasteryEstimate],
    ) -> List[DiagnosticItem]:
        assert self._policy is not None  # guarded by callers
        ranked = self._policy.rank(list(baseline), prior_mastery)
        # Honour the contract: same set, policy only re-orders. Drop any item the
        # policy invented and top up with baseline order to be safe.
        baseline_ids = {item.item_id for item in baseline}
        seen: set[str] = set()
        out: List[DiagnosticItem] = []
        for item in ranked:
            if item.item_id in baseline_ids and item.item_id not in seen:
                out.append(item)
                seen.add(item.item_id)
        for item in baseline:
            if item.item_id not in seen:
                out.append(item)
                seen.add(item.item_id)
        return out

    def _build_proposal(
        self,
        baseline: List[DiagnosticItem],
        prior_mastery: Mapping[str, MasteryEstimate],
    ) -> C1Proposal:
        baseline_order = tuple(item.item_id for item in baseline)
        if self._policy is None:
            return C1Proposal(baseline_order, baseline_order, engaged=False)
        proposed = self._apply_policy(baseline, prior_mastery)
        return C1Proposal(
            baseline_order=baseline_order,
            proposed_order=tuple(item.item_id for item in proposed),
            engaged=True,
        )

    def _record(self, proposal: C1Proposal) -> None:
        if self._sink is None:
            return
        try:
            self._sink.record_verdict(SINK_KIND, proposal.as_dict())
        except Exception:  # noqa: BLE001 - shadow logging must never break selection
            pass


__all__ = [
    "C1_POLICY_FLAG",
    "MESH_ENABLED_FLAG",
    "SINK_KIND",
    "c1_policy_enabled",
    "C1DarkError",
    "NextBestQuestionPolicy",
    "C1Proposal",
    "LearnedItemSelector",
]
