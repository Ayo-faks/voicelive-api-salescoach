"""Persist invitation email delivery attempts.

Revision ID: 20260408_000008
Revises: 20260408_000007
Create Date: 2026-04-08 20:10:00.000000
"""

from __future__ import annotations

from alembic import op


revision = "20260408_000008"
down_revision = "20260408_000007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS child_invitation_email_deliveries (
            id TEXT PRIMARY KEY,
            invitation_id TEXT NOT NULL REFERENCES child_invitations(id),
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
        "CREATE INDEX IF NOT EXISTS idx_child_invitation_email_deliveries_invitation_created ON child_invitation_email_deliveries (invitation_id, created_at DESC)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_child_invitation_email_deliveries_invitation_created")
    op.execute("DROP TABLE IF EXISTS child_invitation_email_deliveries")