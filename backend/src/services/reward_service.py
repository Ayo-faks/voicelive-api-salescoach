"""RL Stage 0 reward service.

Exposes the listening-eval acoustic-quality prior as a callable that the
fine-tuning pipeline can consume. Stage 0 is deliberately offline: we
read aggregated rewards from the ``listening_eval_rewards`` table,
produced by :meth:`ListeningEvalService.refresh_rewards`.

Gating
------

Rewards are only served once the global corpus clears
:data:`~src.services.listening_eval_service.MIN_VOTES_FOR_REWARD` and
:data:`~src.services.listening_eval_service.MIN_THERAPISTS_FOR_REWARD`.
Until then, :meth:`RewardService.get_reward` returns ``None`` and the
pipeline should fall back to SFT without preference weighting.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Iterable, Mapping, Optional

from src.services.listening_eval_service import (
    MIN_THERAPISTS_FOR_REWARD,
    MIN_VOTES_FOR_REWARD,
    ListeningEvalReward,
    ListeningEvalService,
)

__all__ = ["RewardSnapshot", "RewardService"]


@dataclass(frozen=True)
class RewardSnapshot:
    gated: bool
    gate_reason: Optional[str]
    votes: int
    therapists: int
    rewards_by_token: Mapping[str, ListeningEvalReward]

    def get(self, target_token: str) -> Optional[float]:
        if self.gated:
            return None
        entry = self.rewards_by_token.get(target_token)
        return entry.reward if entry is not None else None


class RewardService:
    """Read-side projection over aggregated listening-eval rewards."""

    def __init__(self, listening_eval: ListeningEvalService):
        self._listening_eval = listening_eval

    def snapshot(self) -> RewardSnapshot:
        stats = self._listening_eval.total_vote_stats()
        gated = False
        gate_reason: Optional[str] = None
        if stats["votes"] < MIN_VOTES_FOR_REWARD:
            gated = True
            gate_reason = (
                f"need ≥{MIN_VOTES_FOR_REWARD} votes, have {stats['votes']}"
            )
        elif stats["therapists"] < MIN_THERAPISTS_FOR_REWARD:
            gated = True
            gate_reason = (
                f"need ≥{MIN_THERAPISTS_FOR_REWARD} distinct therapists, "
                f"have {stats['therapists']}"
            )

        rewards = self._listening_eval.list_rewards() if not gated else []
        return RewardSnapshot(
            gated=gated,
            gate_reason=gate_reason,
            votes=stats["votes"],
            therapists=stats["therapists"],
            rewards_by_token={r.target_token: r for r in rewards},
        )

    def get_reward(self, target_token: str) -> Optional[float]:
        """Return the scalar reward for ``target_token`` or ``None`` when gated."""
        return self.snapshot().get(target_token)

    def rewards_for_tokens(
        self, target_tokens: Iterable[str]
    ) -> Dict[str, Optional[float]]:
        snapshot = self.snapshot()
        return {token: snapshot.get(token) for token in target_tokens}
