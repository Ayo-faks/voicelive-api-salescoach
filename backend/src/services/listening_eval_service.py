"""Therapist listening-evaluation service.

Backs the staff-only A/B voice quality tool that feeds the RL Stage 0
reward pipeline. Each *item* pairs two SSML variants of the same target
token; therapists pick the clearer production (or ``tie``) and record a
1–5 confidence rating.

The service writes to three tables:

``listening_eval_items``
    Catalogue of A/B comparisons.
``listening_eval_votes``
    Individual therapist votes.
``listening_eval_rewards``
    Aggregated per-token acoustic-quality prior, refreshed by
    :func:`refresh_rewards`. This is what the RL reward service consumes.

Tables are created on first use when running against SQLite (local dev).
Postgres production provisions them via alembic revision
``20260421_000020_listening_eval_tables.py``.
"""
from __future__ import annotations

import sqlite3
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, ContextManager, Dict, Iterable, List, Optional

__all__ = [
    "ListeningEvalItem",
    "ListeningEvalVote",
    "ListeningEvalReward",
    "ListeningEvalService",
    "MIN_THERAPISTS_FOR_REWARD",
    "MIN_VOTES_FOR_REWARD",
]

#: RL Stage 0 gating constants. Rewards are only emitted once the
#: listening-eval corpus hits both thresholds.
MIN_VOTES_FOR_REWARD = 200
MIN_THERAPISTS_FOR_REWARD = 3


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class ListeningEvalItem:
    id: str
    target_token: str
    target_sound: str
    reference_text: str
    variant_a_ssml: str
    variant_b_ssml: str
    variant_a_label: str
    variant_b_label: str
    voice_name: str
    lexicon_version: Optional[str] = None
    created_at: str = ""
    retired_at: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "targetToken": self.target_token,
            "targetSound": self.target_sound,
            "referenceText": self.reference_text,
            "variantA": {"label": self.variant_a_label, "ssml": self.variant_a_ssml},
            "variantB": {"label": self.variant_b_label, "ssml": self.variant_b_ssml},
            "voiceName": self.voice_name,
            "lexiconVersion": self.lexicon_version,
            "createdAt": self.created_at,
            "retiredAt": self.retired_at,
        }


@dataclass
class ListeningEvalVote:
    id: str
    item_id: str
    therapist_user_id: str
    workspace_id: Optional[str]
    preferred_variant: str  # 'a' | 'b' | 'tie'
    confidence: int
    rationale: Optional[str]
    created_at: str


@dataclass
class ListeningEvalReward:
    target_token: str
    target_sound: str
    variant_label: str
    reward: float
    vote_count: int
    therapist_count: int
    updated_at: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "targetToken": self.target_token,
            "targetSound": self.target_sound,
            "variantLabel": self.variant_label,
            "reward": round(self.reward, 6),
            "voteCount": self.vote_count,
            "therapistCount": self.therapist_count,
            "updatedAt": self.updated_at,
        }


ConnectionFactory = Callable[[], ContextManager[sqlite3.Connection]]


class ListeningEvalService:
    """Thin repository + aggregator over ``listening_eval_*`` tables.

    The service receives a connection factory producing a context-managed
    SQLite connection (matches the idiom used by :class:`StorageService`).
    All writes commit on context-manager exit; reads use ``Row`` factory
    for dict-style access.
    """

    def __init__(self, connect: ConnectionFactory):
        self._connect = connect
        self._ensure_schema()

    # ------------------------------------------------------------------ #
    # Schema                                                             #
    # ------------------------------------------------------------------ #
    def _ensure_schema(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS listening_eval_items (
                    id TEXT PRIMARY KEY,
                    target_token TEXT NOT NULL,
                    target_sound TEXT NOT NULL,
                    reference_text TEXT NOT NULL,
                    variant_a_ssml TEXT NOT NULL,
                    variant_b_ssml TEXT NOT NULL,
                    variant_a_label TEXT NOT NULL,
                    variant_b_label TEXT NOT NULL,
                    voice_name TEXT NOT NULL,
                    lexicon_version TEXT,
                    created_at TEXT NOT NULL,
                    retired_at TEXT
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS listening_eval_votes (
                    id TEXT PRIMARY KEY,
                    item_id TEXT NOT NULL,
                    therapist_user_id TEXT NOT NULL,
                    workspace_id TEXT,
                    preferred_variant TEXT NOT NULL,
                    confidence INTEGER NOT NULL,
                    rationale TEXT,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (item_id) REFERENCES listening_eval_items(id) ON DELETE CASCADE
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS listening_eval_rewards (
                    target_token TEXT PRIMARY KEY,
                    target_sound TEXT NOT NULL,
                    variant_label TEXT NOT NULL,
                    reward REAL NOT NULL,
                    vote_count INTEGER NOT NULL,
                    therapist_count INTEGER NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )

    # ------------------------------------------------------------------ #
    # Items                                                              #
    # ------------------------------------------------------------------ #
    def create_item(self, item: ListeningEvalItem) -> ListeningEvalItem:
        if not item.id:
            item.id = str(uuid.uuid4())
        if not item.created_at:
            item.created_at = _utc_now_iso()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO listening_eval_items (
                    id, target_token, target_sound, reference_text,
                    variant_a_ssml, variant_b_ssml, variant_a_label, variant_b_label,
                    voice_name, lexicon_version, created_at, retired_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    item.id,
                    item.target_token,
                    item.target_sound,
                    item.reference_text,
                    item.variant_a_ssml,
                    item.variant_b_ssml,
                    item.variant_a_label,
                    item.variant_b_label,
                    item.voice_name,
                    item.lexicon_version,
                    item.created_at,
                    item.retired_at,
                ),
            )
        return item

    def list_active_items(
        self, *, target_sound: Optional[str] = None, limit: int = 50
    ) -> List[ListeningEvalItem]:
        query = (
            "SELECT * FROM listening_eval_items WHERE retired_at IS NULL"
        )
        params: list[Any] = []
        if target_sound:
            query += " AND target_sound = ?"
            params.append(target_sound)
        query += " ORDER BY created_at DESC LIMIT ?"
        params.append(max(1, int(limit)))
        with self._connect() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(query, params).fetchall()
        return [self._row_to_item(row) for row in rows]

    def get_item(self, item_id: str) -> Optional[ListeningEvalItem]:
        with self._connect() as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                "SELECT * FROM listening_eval_items WHERE id = ?", (item_id,)
            ).fetchone()
        return self._row_to_item(row) if row else None

    def retire_item(self, item_id: str) -> bool:
        with self._connect() as conn:
            cursor = conn.execute(
                "UPDATE listening_eval_items SET retired_at = ? "
                "WHERE id = ? AND retired_at IS NULL",
                (_utc_now_iso(), item_id),
            )
            return cursor.rowcount > 0

    # ------------------------------------------------------------------ #
    # Votes                                                              #
    # ------------------------------------------------------------------ #
    def record_vote(
        self,
        *,
        item_id: str,
        therapist_user_id: str,
        preferred_variant: str,
        confidence: int,
        workspace_id: Optional[str] = None,
        rationale: Optional[str] = None,
    ) -> ListeningEvalVote:
        if preferred_variant not in {"a", "b", "tie"}:
            raise ValueError("preferred_variant must be 'a', 'b', or 'tie'")
        if not 1 <= int(confidence) <= 5:
            raise ValueError("confidence must be in [1, 5]")

        vote = ListeningEvalVote(
            id=str(uuid.uuid4()),
            item_id=item_id,
            therapist_user_id=therapist_user_id,
            workspace_id=workspace_id,
            preferred_variant=preferred_variant,
            confidence=int(confidence),
            rationale=(rationale or None),
            created_at=_utc_now_iso(),
        )
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO listening_eval_votes (
                    id, item_id, therapist_user_id, workspace_id,
                    preferred_variant, confidence, rationale, created_at
                ) VALUES (?,?,?,?,?,?,?,?)
                """,
                (
                    vote.id,
                    vote.item_id,
                    vote.therapist_user_id,
                    vote.workspace_id,
                    vote.preferred_variant,
                    vote.confidence,
                    vote.rationale,
                    vote.created_at,
                ),
            )
        return vote

    def list_votes_for_item(self, item_id: str) -> List[ListeningEvalVote]:
        with self._connect() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT * FROM listening_eval_votes WHERE item_id = ? ORDER BY created_at",
                (item_id,),
            ).fetchall()
        return [self._row_to_vote(row) for row in rows]

    def total_vote_stats(self) -> Dict[str, int]:
        """Return ``{"votes": N, "therapists": M}`` across all items."""
        with self._connect() as conn:
            row = conn.execute(
                "SELECT COUNT(*) AS total, "
                "COUNT(DISTINCT therapist_user_id) AS therapists "
                "FROM listening_eval_votes"
            ).fetchone()
        return {
            "votes": int(row[0] if row else 0),
            "therapists": int(row[1] if row else 0),
        }

    # ------------------------------------------------------------------ #
    # Rewards                                                            #
    # ------------------------------------------------------------------ #
    def refresh_rewards(self) -> List[ListeningEvalReward]:
        """Recompute per-token rewards from raw votes.

        Reward formula (bounded in [-1, +1]):

        .. math::

            r(t) = \\frac{\\sum_i c_i \\cdot s_i}{\\sum_i c_i}

        where ``c_i`` is the confidence (1–5) and ``s_i`` is +1/-1/0 for
        votes that prefer variant A / variant B / tie. The winning variant
        label is whichever of ``{a, b, tie}`` attracted the most votes.
        Rewards are only persisted when the global corpus clears the
        :data:`MIN_VOTES_FOR_REWARD` / :data:`MIN_THERAPISTS_FOR_REWARD`
        gates; this keeps the RL pipeline from training on a thin prior.
        """
        stats = self.total_vote_stats()
        if (
            stats["votes"] < MIN_VOTES_FOR_REWARD
            or stats["therapists"] < MIN_THERAPISTS_FOR_REWARD
        ):
            return []

        now = _utc_now_iso()
        rewards: List[ListeningEvalReward] = []
        with self._connect() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT
                    i.target_token, i.target_sound,
                    i.variant_a_label, i.variant_b_label,
                    v.preferred_variant, v.confidence, v.therapist_user_id
                FROM listening_eval_items i
                JOIN listening_eval_votes v ON v.item_id = i.id
                WHERE i.retired_at IS NULL
                """
            ).fetchall()

            by_token: Dict[str, Dict[str, Any]] = {}
            for row in rows:
                token = row["target_token"]
                agg = by_token.setdefault(
                    token,
                    {
                        "target_sound": row["target_sound"],
                        "labels": {"a": row["variant_a_label"], "b": row["variant_b_label"]},
                        "weighted_sum": 0.0,
                        "weight_total": 0.0,
                        "counts": {"a": 0, "b": 0, "tie": 0},
                        "therapists": set(),
                    },
                )
                c = int(row["confidence"])
                preferred = row["preferred_variant"]
                sign = 1 if preferred == "a" else (-1 if preferred == "b" else 0)
                agg["weighted_sum"] += c * sign
                agg["weight_total"] += c
                agg["counts"][preferred] += 1
                agg["therapists"].add(row["therapist_user_id"])

            conn.execute("DELETE FROM listening_eval_rewards")

            for token, agg in by_token.items():
                reward = (
                    agg["weighted_sum"] / agg["weight_total"]
                    if agg["weight_total"]
                    else 0.0
                )
                counts = agg["counts"]
                winning = max(counts.items(), key=lambda kv: kv[1])
                label = (
                    agg["labels"][winning[0]] if winning[0] in ("a", "b") else "tie"
                )
                total_votes = sum(counts.values())
                reward_row = ListeningEvalReward(
                    target_token=token,
                    target_sound=agg["target_sound"],
                    variant_label=label,
                    reward=float(reward),
                    vote_count=int(total_votes),
                    therapist_count=len(agg["therapists"]),
                    updated_at=now,
                )
                rewards.append(reward_row)
                conn.execute(
                    """
                    INSERT INTO listening_eval_rewards (
                        target_token, target_sound, variant_label,
                        reward, vote_count, therapist_count, updated_at
                    ) VALUES (?,?,?,?,?,?,?)
                    """,
                    (
                        reward_row.target_token,
                        reward_row.target_sound,
                        reward_row.variant_label,
                        reward_row.reward,
                        reward_row.vote_count,
                        reward_row.therapist_count,
                        reward_row.updated_at,
                    ),
                )
        return rewards

    def list_rewards(self) -> List[ListeningEvalReward]:
        with self._connect() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT * FROM listening_eval_rewards ORDER BY reward DESC"
            ).fetchall()
        return [
            ListeningEvalReward(
                target_token=r["target_token"],
                target_sound=r["target_sound"],
                variant_label=r["variant_label"],
                reward=float(r["reward"]),
                vote_count=int(r["vote_count"]),
                therapist_count=int(r["therapist_count"]),
                updated_at=r["updated_at"],
            )
            for r in rows
        ]

    # ------------------------------------------------------------------ #
    # CSV export                                                         #
    # ------------------------------------------------------------------ #
    def export_votes_csv(self) -> str:
        import csv
        import io

        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(
            [
                "vote_id",
                "item_id",
                "target_token",
                "target_sound",
                "preferred_variant",
                "preferred_label",
                "confidence",
                "therapist_user_id",
                "workspace_id",
                "rationale",
                "voted_at",
            ]
        )
        with self._connect() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT v.id AS vote_id, v.item_id, i.target_token, i.target_sound,
                       v.preferred_variant, v.confidence, v.therapist_user_id,
                       v.workspace_id, v.rationale, v.created_at,
                       i.variant_a_label, i.variant_b_label
                FROM listening_eval_votes v
                JOIN listening_eval_items i ON i.id = v.item_id
                ORDER BY v.created_at
                """
            ).fetchall()
        for row in rows:
            preferred_label = (
                row["variant_a_label"] if row["preferred_variant"] == "a"
                else row["variant_b_label"] if row["preferred_variant"] == "b"
                else "tie"
            )
            writer.writerow(
                [
                    row["vote_id"],
                    row["item_id"],
                    row["target_token"],
                    row["target_sound"],
                    row["preferred_variant"],
                    preferred_label,
                    row["confidence"],
                    row["therapist_user_id"],
                    row["workspace_id"] or "",
                    row["rationale"] or "",
                    row["created_at"],
                ]
            )
        return buf.getvalue()

    # ------------------------------------------------------------------ #
    # Helpers                                                            #
    # ------------------------------------------------------------------ #
    def _row_to_item(self, row: sqlite3.Row) -> ListeningEvalItem:
        return ListeningEvalItem(
            id=row["id"],
            target_token=row["target_token"],
            target_sound=row["target_sound"],
            reference_text=row["reference_text"],
            variant_a_ssml=row["variant_a_ssml"],
            variant_b_ssml=row["variant_b_ssml"],
            variant_a_label=row["variant_a_label"],
            variant_b_label=row["variant_b_label"],
            voice_name=row["voice_name"],
            lexicon_version=row["lexicon_version"],
            created_at=row["created_at"],
            retired_at=row["retired_at"],
        )

    def _row_to_vote(self, row: sqlite3.Row) -> ListeningEvalVote:
        return ListeningEvalVote(
            id=row["id"],
            item_id=row["item_id"],
            therapist_user_id=row["therapist_user_id"],
            workspace_id=row["workspace_id"],
            preferred_variant=row["preferred_variant"],
            confidence=int(row["confidence"]),
            rationale=row["rationale"],
            created_at=row["created_at"],
        )


# ---------------------------------------------------------------------- #
# DPO / preference-dataset export                                        #
# ---------------------------------------------------------------------- #
def build_dpo_preference_pairs(
    service: ListeningEvalService, *, min_confidence: int = 3
) -> List[Dict[str, Any]]:
    """Convert votes into DPO-style preference rows ``{chosen, rejected, weight}``.

    Ties and low-confidence (<``min_confidence``) votes are skipped — DPO
    needs strict preferences to produce a stable gradient signal.
    """
    pairs: List[Dict[str, Any]] = []
    for item in service.list_active_items(limit=10_000):
        for vote in service.list_votes_for_item(item.id):
            if vote.preferred_variant == "tie":
                continue
            if vote.confidence < min_confidence:
                continue
            if vote.preferred_variant == "a":
                chosen, rejected = item.variant_a_ssml, item.variant_b_ssml
                chosen_label, rejected_label = item.variant_a_label, item.variant_b_label
            else:
                chosen, rejected = item.variant_b_ssml, item.variant_a_ssml
                chosen_label, rejected_label = item.variant_b_label, item.variant_a_label
            pairs.append(
                {
                    "item_id": item.id,
                    "target_token": item.target_token,
                    "target_sound": item.target_sound,
                    "reference_text": item.reference_text,
                    "chosen": chosen,
                    "chosen_label": chosen_label,
                    "rejected": rejected,
                    "rejected_label": rejected_label,
                    "weight": float(vote.confidence) / 5.0,
                    "therapist_user_id": vote.therapist_user_id,
                }
            )
    return pairs


@contextmanager
def sqlite_connection(db_path: str):
    """Convenience: yield a SQLite connection for callers that don't own one."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()
