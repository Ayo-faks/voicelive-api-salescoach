"""Add parental_consents table for per-child guardian consent tracking.

Revision ID: 20260408_000009
Revises: 20260408_000008
Create Date: 2026-04-08 22:00:00.000000
"""

from __future__ import annotations

from alembic import op


revision = "20260408_000009"
down_revision = "20260408_000008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS parental_consents (
            id TEXT PRIMARY KEY,
            child_id TEXT NOT NULL REFERENCES children(id),
            guardian_name TEXT NOT NULL,
            guardian_email TEXT NOT NULL,
            consent_type TEXT NOT NULL DEFAULT 'full',
            privacy_accepted BOOLEAN NOT NULL DEFAULT FALSE,
            terms_accepted BOOLEAN NOT NULL DEFAULT FALSE,
            ai_notice_accepted BOOLEAN NOT NULL DEFAULT FALSE,
            recorded_by_user_id TEXT NOT NULL REFERENCES users(id),
            consented_at TEXT NOT NULL,
            withdrawn_at TEXT
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_parental_consents_child ON parental_consents (child_id)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_parental_consents_child")
    op.execute("DROP TABLE IF EXISTS parental_consents")
