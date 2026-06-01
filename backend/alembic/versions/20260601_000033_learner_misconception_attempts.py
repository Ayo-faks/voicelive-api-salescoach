"""Episodic misconception-attempt store for cross-session trap recall.

Revision ID: 20260601_000033
Revises: 20260601_000032
Create Date: 2026-06-01 00:33:00.000000
"""

from __future__ import annotations

from alembic import op


revision = "20260601_000033"
down_revision = "20260601_000032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # One row per misconception code on a wrong attempt. Episodic recall
    # (Phase 5) reads these back, consent-gated, to build cross-session
    # "the X trap caught you" callbacks. Keyed by tenant + learner so it is
    # cross-device for a given student.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS learner_misconception_attempts (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            student_id TEXT NOT NULL,
            item_id TEXT NOT NULL,
            skill_id TEXT NOT NULL,
            misconception_code TEXT NOT NULL,
            topic TEXT,
            occurred_at TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_learner_misconception_attempts_student "
        "ON learner_misconception_attempts (tenant_id, student_id, occurred_at DESC)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS learner_misconception_attempts")
