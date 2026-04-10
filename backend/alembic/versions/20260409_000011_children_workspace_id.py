"""Add workspace_id column to children table.

Revision ID: 20260409_000011
Revises: 20260409_000010
Create Date: 2026-04-09 12:00:00.000000
"""

from __future__ import annotations

from alembic import op


revision = "20260409_000011"
down_revision = "20260409_000010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE children
        ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES therapist_workspaces(id)
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_children_workspace_id ON children (workspace_id) WHERE workspace_id IS NOT NULL"
    )

    # Backfill: assign each existing child to the personal workspace of its
    # first linked therapist user (via user_children with relationship='therapist').
    op.execute(
        """
        UPDATE children
        SET workspace_id = sub.workspace_id
        FROM (
            SELECT DISTINCT ON (uc.child_id)
                uc.child_id,
                tw.id AS workspace_id
            FROM user_children uc
            INNER JOIN therapist_workspaces tw
                ON tw.owner_user_id = uc.user_id AND tw.is_personal = true
            WHERE uc.relationship = 'therapist'
            ORDER BY uc.child_id, uc.created_at ASC
        ) AS sub
        WHERE children.id = sub.child_id
          AND children.workspace_id IS NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_children_workspace_id")
    op.execute("ALTER TABLE children DROP COLUMN IF EXISTS workspace_id")
