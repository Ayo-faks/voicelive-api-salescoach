"""Add therapist workspaces and workspace memberships.

Revision ID: 20260409_000010
Revises: 20260408_000009
Create Date: 2026-04-09 10:00:00.000000
"""

from __future__ import annotations

from alembic import op


revision = "20260409_000010"
down_revision = "20260408_000009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS therapist_workspaces (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            owner_user_id TEXT NOT NULL REFERENCES users(id),
            is_personal BOOLEAN NOT NULL DEFAULT false,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS workspace_members (
            workspace_id TEXT NOT NULL REFERENCES therapist_workspaces(id) ON DELETE CASCADE,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            role TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (workspace_id, user_id)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_workspace_members_user_role ON workspace_members (user_id, role, updated_at DESC)"
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_therapist_workspaces_owner_personal ON therapist_workspaces (owner_user_id) WHERE is_personal = true"
    )

    op.execute(
        """
        INSERT INTO therapist_workspaces (id, name, owner_user_id, is_personal, created_at, updated_at)
        SELECT
            'workspace-' || substr(md5(users.id || '-personal'), 1, 12),
            COALESCE(NULLIF(BTRIM(users.name), ''), split_part(users.email, '@', 1), 'Therapist') || ' Workspace',
            users.id,
            true,
            COALESCE(users.created_at, NOW()::text),
            COALESCE(users.created_at, NOW()::text)
        FROM users
        WHERE users.role IN ('therapist', 'admin')
          AND NOT EXISTS (
              SELECT 1
              FROM therapist_workspaces
              WHERE therapist_workspaces.owner_user_id = users.id
                AND therapist_workspaces.is_personal = true
          )
        """
    )
    op.execute(
        """
        INSERT INTO workspace_members (workspace_id, user_id, role, created_at, updated_at)
        SELECT
            therapist_workspaces.id,
            therapist_workspaces.owner_user_id,
            'owner',
            therapist_workspaces.created_at,
            therapist_workspaces.updated_at
        FROM therapist_workspaces
        WHERE therapist_workspaces.is_personal = true
        ON CONFLICT (workspace_id, user_id) DO UPDATE SET
            role = EXCLUDED.role,
            updated_at = EXCLUDED.updated_at
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_therapist_workspaces_owner_personal")
    op.execute("DROP INDEX IF EXISTS idx_workspace_members_user_role")
    op.execute("DROP TABLE IF EXISTS workspace_members")
    op.execute("DROP TABLE IF EXISTS therapist_workspaces")
