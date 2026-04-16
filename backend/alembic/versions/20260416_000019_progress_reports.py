"""Add progress reports with child-scoped row level security.

Revision ID: 20260416_000019
Revises: 20260411_000018
Create Date: 2026-04-16 10:30:00.000000
"""

from __future__ import annotations

from alembic import op


revision = "20260416_000019"
down_revision = "20260411_000018"
branch_labels = None
depends_on = None


def _drop_policy(table_name: str, policy_name: str) -> None:
    op.execute(f"DROP POLICY IF EXISTS {policy_name} ON {table_name}")


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS progress_reports (
            id TEXT PRIMARY KEY,
            child_id TEXT NOT NULL REFERENCES children(id),
            workspace_id TEXT REFERENCES therapist_workspaces(id),
            created_by_user_id TEXT NOT NULL REFERENCES users(id),
            signed_by_user_id TEXT REFERENCES users(id),
            audience TEXT NOT NULL,
            report_type TEXT NOT NULL,
            title TEXT NOT NULL,
            status TEXT NOT NULL,
            period_start TEXT NOT NULL,
            period_end TEXT NOT NULL,
            included_session_ids_json JSONB NOT NULL,
            snapshot_json JSONB NOT NULL,
            sections_json JSONB NOT NULL,
            redaction_overrides_json JSONB,
            summary_text TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            approved_at TEXT,
            signed_at TEXT,
            archived_at TEXT
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_progress_reports_child_status_created ON progress_reports (child_id, status, created_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_progress_reports_workspace_created ON progress_reports (workspace_id, created_at DESC)"
    )
    op.execute("ALTER TABLE progress_reports ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE progress_reports FORCE ROW LEVEL SECURITY")
    _drop_policy("progress_reports", "progress_reports_child_access_policy")
    op.execute(
        """
        CREATE POLICY progress_reports_child_access_policy ON progress_reports
        FOR ALL
        USING (
            current_setting('app.system_bypass_rls', true) = 'on'
            OR current_setting('app.current_user_role', true) = 'admin'
            OR EXISTS (
                SELECT 1
                FROM user_children
                WHERE user_children.child_id = progress_reports.child_id
                  AND user_children.user_id = current_setting('app.current_user_id', true)
            )
        )
        WITH CHECK (
            current_setting('app.system_bypass_rls', true) = 'on'
            OR current_setting('app.current_user_role', true) = 'admin'
            OR EXISTS (
                SELECT 1
                FROM user_children
                WHERE user_children.child_id = progress_reports.child_id
                  AND user_children.user_id = current_setting('app.current_user_id', true)
            )
        )
        """
    )


def downgrade() -> None:
    _drop_policy("progress_reports", "progress_reports_child_access_policy")
    op.execute("DROP INDEX IF EXISTS idx_progress_reports_workspace_created")
    op.execute("DROP INDEX IF EXISTS idx_progress_reports_child_status_created")
    op.execute("DROP TABLE IF EXISTS progress_reports")
