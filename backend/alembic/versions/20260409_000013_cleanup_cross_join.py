"""Remove stale cross-join user_children links and backfill orphaned children

Revision ID: 20260409_000013
Revises: 20260409_000012
Create Date: 2026-04-09
"""

from alembic import op

revision = "20260409_000013"
down_revision = "20260409_000012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Step 3.1: Remove user_children links where the user is NOT a workspace member
    # of the child's workspace.  Only touches children that have workspace_id set.
    op.execute(
        """
        DELETE FROM user_children
        WHERE id IN (
            SELECT uc.id
            FROM user_children uc
            INNER JOIN children c ON c.id = uc.child_id
            WHERE c.workspace_id IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1
                  FROM workspace_members wm
                  WHERE wm.workspace_id = c.workspace_id
                    AND wm.user_id = uc.user_id
              )
        )
        """
    )

    # Step 3.2: Assign orphaned children (workspace_id IS NULL) to the personal
    # workspace of their first linked therapist.
    op.execute(
        """
        UPDATE children
        SET workspace_id = sub.workspace_id
        FROM (
            SELECT DISTINCT ON (c.id)
                c.id AS child_id,
                tw.id AS workspace_id
            FROM children c
            INNER JOIN user_children uc ON uc.child_id = c.id
            INNER JOIN therapist_workspaces tw
                ON tw.owner_user_id = uc.user_id AND tw.is_personal = TRUE
            WHERE c.workspace_id IS NULL
            ORDER BY c.id, uc.created_at ASC
        ) sub
        WHERE children.id = sub.child_id
        """
    )


def downgrade() -> None:
    # Cannot undo link deletion; pass
    pass
