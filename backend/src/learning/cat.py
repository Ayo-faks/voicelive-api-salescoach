"""Computerised Adaptive Testing (CAT) item selector backed by ``catsim``.

Phase 1, Workstream A — A2. Wraps :mod:`catsim` so the existing
``DiagnosticItemSelector`` Protocol stays the only public seam. Falls
back to :class:`DeterministicItemSelector` when:

* ``catsim`` is not installed (offline / SBC build),
* the item bank holds fewer than ``CAT_MIN_BANK_SIZE`` items, OR
* any required skill has zero items.

The fallback is deliberate: the offline pilot environment in West Africa
cannot guarantee the numpy build chain that catsim needs, and the
diagnostic must still emit a valid 50-item assessment.
"""

from __future__ import annotations

import logging
import math
from typing import List, Mapping, Optional

from src.learning.diagnostic import (
    DeterministicItemSelector,
    DiagnosticItemBank,
    DiagnosticItemSelector,
)
from src.learning.models import DiagnosticItem, MasteryEstimate

logger = logging.getLogger(__name__)

CAT_MIN_BANK_SIZE = 12


def _probability_to_theta(probability: float) -> float:
    """Map a BKT/Elo probability in (0, 1) to a logit-scaled ability."""
    p = min(max(probability, 1e-3), 1.0 - 1e-3)
    return math.log(p / (1.0 - p))


def _catsim_available() -> bool:
    try:
        import catsim  # noqa: F401
        import numpy  # noqa: F401
    except Exception:  # pragma: no cover - exercised in CI without catsim
        return False
    return True


class CatsimItemSelector:
    """Item selector that uses catsim's MaxInfo selector when available."""

    # We expose the fallback as available because we self-fallback to
    # DeterministicItemSelector when offline / catsim missing.
    offline_fallback_available = True

    def __init__(
        self,
        *,
        min_bank_size: int = CAT_MIN_BANK_SIZE,
        fallback: Optional[DiagnosticItemSelector] = None,
    ) -> None:
        self.min_bank_size = min_bank_size
        self._fallback = fallback or DeterministicItemSelector()
        self._catsim_ready = _catsim_available()

    @property
    def catsim_ready(self) -> bool:
        return self._catsim_ready

    def select_items(
        self,
        item_bank: DiagnosticItemBank,
        prior_mastery: Mapping[str, MasteryEstimate],
        limit: int,
    ) -> List[DiagnosticItem]:
        if self._should_fallback(item_bank, limit):
            logger.info(
                "catsim_selector: falling back to deterministic "
                "(catsim_ready=%s, bank=%d, min=%d)",
                self._catsim_ready,
                len(item_bank.items),
                self.min_bank_size,
            )
            return self._fallback.select_items(item_bank, prior_mastery, limit)

        return self._select_with_catsim(item_bank, prior_mastery, limit)

    def _should_fallback(self, item_bank: DiagnosticItemBank, limit: int) -> bool:
        if not self._catsim_ready:
            return True
        if len(item_bank.items) < self.min_bank_size:
            return True
        # If any skill has no items, MaxInfo cannot guarantee per-skill coverage
        items_per_skill = {skill.skill_id: 0 for skill in item_bank.skills}
        for item in item_bank.items:
            if item.skill_id in items_per_skill:
                items_per_skill[item.skill_id] += 1
        if any(count == 0 for count in items_per_skill.values()):
            return True
        return False

    def _select_with_catsim(
        self,
        item_bank: DiagnosticItemBank,
        prior_mastery: Mapping[str, MasteryEstimate],
        limit: int,
    ) -> List[DiagnosticItem]:
        import numpy as np
        from catsim.selection import MaxInfoSelector

        items = list(item_bank.items)
        # catsim items: array of [discrimination, difficulty, guessing, upper]
        # We model the offline bank as 2PL with a=1, c=0, d=1.
        params = np.array(
            [[1.0, float(item.difficulty), 0.0, 1.0] for item in items],
            dtype=float,
        )

        # Use the mean of prior_mastery probabilities (skills covered by the
        # bank) as the initial theta. If no prior, start at theta=0.
        relevant = [
            prior_mastery[skill.skill_id].probability
            for skill in item_bank.skills
            if skill.skill_id in prior_mastery
        ]
        theta = _probability_to_theta(sum(relevant) / len(relevant)) if relevant else 0.0

        selector = MaxInfoSelector()
        administered: List[int] = []
        selected: List[DiagnosticItem] = []
        target = min(limit, len(items))

        while len(selected) < target:
            try:
                idx = selector.select(
                    items=params,
                    administered_items=administered,
                    est_theta=theta,
                )
            except Exception:  # pragma: no cover - catsim edge case → fallback
                logger.exception("catsim selector failed; falling back")
                return self._fallback.select_items(item_bank, prior_mastery, limit)
            if idx is None or idx in administered:
                break
            administered.append(int(idx))
            selected.append(items[int(idx)])

        if len(selected) < target:
            # Top up with fallback to honour the contract that the engine
            # always sees min(limit, len(items)) items.
            remaining_ids = {item.item_id for item in selected}
            for item in self._fallback.select_items(item_bank, prior_mastery, limit):
                if item.item_id not in remaining_ids:
                    selected.append(item)
                    remaining_ids.add(item.item_id)
                    if len(selected) >= target:
                        break

        return selected


__all__ = ["CatsimItemSelector", "CAT_MIN_BANK_SIZE"]
