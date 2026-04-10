"""Add workspace_id to child_invitations

Revision ID: 20260409_000012
Revises: 20260409_000011
Create Date: 2026-04-09
"""

from alembic import op
import sqlalchemy as sa

revision = "20260409_000012"
down_revision = "20260409_000011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "child_invitations",
        sa.Column("workspace_id", sa.Text(), nullable=True),
    )
    # Backfill from children table
    op.execute(
        """
        UPDATE child_invitations
        SET workspace_id = children.workspace_id
        FROM children
        WHERE child_invitations.child_id = children.id
          AND children.workspace_id IS NOT NULL
          AND child_invitations.workspace_id IS NULL
        """
    )


def downgrade() -> None:
    op.drop_column("child_invitations", "workspace_id")
