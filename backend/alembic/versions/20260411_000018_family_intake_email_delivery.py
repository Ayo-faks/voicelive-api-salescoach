"""Add family intake invitation email delivery tracking.

Revision ID: 20260411_000018
Revises: 20260411_000017
Create Date: 2026-04-11 21:20:00.000000
"""

from __future__ import annotations

from alembic import op


revision = "20260411_000018"
down_revision = "20260411_000017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS family_intake_invitation_email_deliveries (
            id TEXT PRIMARY KEY,
            invitation_id TEXT NOT NULL REFERENCES family_intake_invitations(id) ON DELETE CASCADE,
            status TEXT NOT NULL,
            attempted BOOLEAN NOT NULL,
            delivered BOOLEAN NOT NULL,
            provider_message_id TEXT,
            error TEXT,
            created_at TEXT NOT NULL
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_family_intake_invite_email_deliveries_invitation_created ON family_intake_invitation_email_deliveries (invitation_id, created_at DESC)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS family_intake_invitation_email_deliveries")