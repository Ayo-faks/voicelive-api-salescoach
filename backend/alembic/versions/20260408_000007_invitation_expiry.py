"""Add invitation expiry metadata.

Revision ID: 20260408_000007
Revises: 20260408_000006
Create Date: 2026-04-08 19:00:00.000000
"""

from __future__ import annotations

from alembic import op


revision = "20260408_000007"
down_revision = "20260408_000006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE child_invitations ADD COLUMN IF NOT EXISTS expires_at TEXT")
    op.execute(
        """
        UPDATE child_invitations
        SET expires_at = COALESCE(expires_at, (created_at::timestamptz + interval '7 days')::text)
        WHERE expires_at IS NULL
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_child_invitations_status_expiry ON child_invitations (status, expires_at)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_child_invitations_status_expiry")
    op.execute("ALTER TABLE child_invitations DROP COLUMN IF EXISTS expires_at")
