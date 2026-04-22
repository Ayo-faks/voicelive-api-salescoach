"""Listening-eval tables for therapist A/B voice quality labelling.

Revision ID: 20260421_000020
Revises: 20260416_000019
Create Date: 2026-04-21 00:00:00.000000

These tables feed the RL Stage 0 reward service. Each ``listening_eval_item``
carries two synthesised audio variants (``variant_a``, ``variant_b``) for the
same target token. Therapists vote for the clearer production; the aggregate
preference is the acoustic-quality prior we train on.
"""
from __future__ import annotations

from alembic import op


revision = "20260421_000020"
down_revision = "20260416_000019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
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
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_listening_eval_items_sound "
        "ON listening_eval_items (target_sound, created_at DESC)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS listening_eval_votes (
            id TEXT PRIMARY KEY,
            item_id TEXT NOT NULL REFERENCES listening_eval_items(id) ON DELETE CASCADE,
            therapist_user_id TEXT NOT NULL REFERENCES users(id),
            workspace_id TEXT REFERENCES therapist_workspaces(id),
            preferred_variant TEXT NOT NULL CHECK (preferred_variant IN ('a','b','tie')),
            confidence INTEGER NOT NULL CHECK (confidence BETWEEN 1 AND 5),
            rationale TEXT,
            created_at TEXT NOT NULL
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_listening_eval_votes_item "
        "ON listening_eval_votes (item_id, created_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_listening_eval_votes_therapist "
        "ON listening_eval_votes (therapist_user_id, created_at DESC)"
    )

    # Per-token acoustic-quality prior written by reward_service.py.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS listening_eval_rewards (
            target_token TEXT PRIMARY KEY,
            target_sound TEXT NOT NULL,
            variant_label TEXT NOT NULL,
            reward NUMERIC NOT NULL,
            vote_count INTEGER NOT NULL,
            therapist_count INTEGER NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_listening_eval_rewards_sound "
        "ON listening_eval_rewards (target_sound, reward DESC)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS listening_eval_rewards")
    op.execute("DROP TABLE IF EXISTS listening_eval_votes")
    op.execute("DROP TABLE IF EXISTS listening_eval_items")
