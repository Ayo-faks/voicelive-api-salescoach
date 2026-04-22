"""Add `source` discriminator to progress_reports.

Revision ID: 20260421_000021
Revises: 20260421_000020
Create Date: 2026-04-21 12:00:00.000000

Adds a ``source`` column to ``progress_reports`` so the therapist UI can
distinguish pipeline-generated reports from AI-drafted insights (deep research)
and manually authored reports. Existing rows are backfilled to ``'pipeline'``.
"""
from __future__ import annotations

from alembic import op


revision = "20260421_000021"
down_revision = "20260421_000020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE progress_reports ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'pipeline'"
    )
    # Backfill any pre-existing rows defensively; the DEFAULT above already
    # covers rows inserted after the migration but is a no-op for old rows
    # if the column was added without a default on some replicas.
    op.execute(
        "UPDATE progress_reports SET source = 'pipeline' WHERE source IS NULL OR source = ''"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE progress_reports DROP COLUMN IF EXISTS source")
