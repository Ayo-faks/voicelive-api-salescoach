"""Add multi-tenant ownership, soft delete, and audit schema.

Revision ID: 20260408_000005
Revises: 20260406_000004
Create Date: 2026-04-08 12:00:00.000000
"""

from __future__ import annotations

from alembic import op


revision = "20260408_000005"
down_revision = "20260406_000004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE children ADD COLUMN IF NOT EXISTS date_of_birth TEXT")
    op.execute("ALTER TABLE children ADD COLUMN IF NOT EXISTS notes TEXT")
    op.execute("ALTER TABLE children ADD COLUMN IF NOT EXISTS deleted_at TEXT")

    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT")
    op.execute("ALTER TABLE users ALTER COLUMN role SET DEFAULT 'parent'")
    op.execute("UPDATE users SET role = 'parent' WHERE role = 'user' OR role IS NULL OR BTRIM(role) = ''")

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS user_children (
            user_id TEXT NOT NULL REFERENCES users(id),
            child_id TEXT NOT NULL REFERENCES children(id),
            relationship TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY (user_id, child_id)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_user_children_child_relationship ON user_children (child_id, relationship, created_at DESC)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS audit_log (
            id TEXT PRIMARY KEY,
            user_id TEXT REFERENCES users(id),
            action TEXT NOT NULL,
            resource_type TEXT NOT NULL,
            resource_id TEXT NOT NULL,
            child_id TEXT REFERENCES children(id),
            metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TEXT NOT NULL
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_audit_log_user_created ON audit_log (user_id, created_at DESC)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_audit_log_child_created ON audit_log (child_id, created_at DESC)")

    op.execute("ALTER TABLE institutional_memory_insights ADD COLUMN IF NOT EXISTS owner_user_id TEXT")
    op.execute(
        """
        UPDATE institutional_memory_insights
        SET owner_user_id = bootstrap_owner.id
        FROM (
            SELECT id
            FROM users
            ORDER BY CASE WHEN role = 'therapist' THEN 0 ELSE 1 END, created_at ASC
            LIMIT 1
        ) AS bootstrap_owner
        WHERE institutional_memory_insights.owner_user_id IS NULL
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_institutional_memory_owner_status_target ON institutional_memory_insights (owner_user_id, status, target_sound, updated_at DESC)"
    )

    op.execute(
        """
        INSERT INTO user_children (user_id, child_id, relationship, created_at)
        SELECT users.id, children.id, 'therapist', COALESCE(users.created_at, NOW()::text)
        FROM users
        CROSS JOIN children
        WHERE users.role = 'therapist' AND children.deleted_at IS NULL
        ON CONFLICT (user_id, child_id) DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_institutional_memory_owner_status_target")
    op.execute("ALTER TABLE institutional_memory_insights DROP COLUMN IF EXISTS owner_user_id")
    op.execute("DROP INDEX IF EXISTS idx_audit_log_child_created")
    op.execute("DROP INDEX IF EXISTS idx_audit_log_user_created")
    op.execute("DROP TABLE IF EXISTS audit_log")
    op.execute("DROP INDEX IF EXISTS idx_user_children_child_relationship")
    op.execute("DROP TABLE IF EXISTS user_children")
    op.execute("ALTER TABLE users ALTER COLUMN role SET DEFAULT 'user'")
    op.execute("UPDATE users SET role = 'user' WHERE role = 'parent'")
    op.execute("ALTER TABLE children DROP COLUMN IF EXISTS deleted_at")
    op.execute("ALTER TABLE children DROP COLUMN IF EXISTS notes")
    op.execute("ALTER TABLE children DROP COLUMN IF EXISTS date_of_birth")
