"""Spaced-retrieval revision cards + Web Push subscriptions (W8).

Revision ID: 20260527_000028
Revises: 20260524_000027
Create Date: 2026-05-27 00:28:00.000000
"""

from __future__ import annotations

from alembic import op


revision = "20260527_000028"
down_revision = "20260524_000027"
branch_labels = None
depends_on = None


RLS_TABLES = (
    "learning_revision_cards",
    "learning_push_subscriptions",
)

TENANT_ACCESS_SQL = """
    current_setting('app.system_bypass_rls', true) = 'on'
    OR current_setting('app.role', true) IN ('admin', 'district_admin', 'dpo')
    OR current_setting('app.current_user_role', true) = 'admin'
    OR tenant_id = current_setting('app.tenant_id', true)
"""


def _drop_policy(table_name: str, policy_name: str) -> None:
    op.execute(f"DROP POLICY IF EXISTS {policy_name} ON {table_name}")


def _user_policy(table_name: str) -> None:
    policy_name = f"{table_name}_tenant_user_policy"
    user_access_sql = f"""
        ({TENANT_ACCESS_SQL})
        AND (
            COALESCE(current_setting('app.user_id', true), '') = ''
            OR user_id = current_setting('app.user_id', true)
            OR current_setting('app.role', true) IN ('admin', 'district_admin', 'dpo', 'teacher', 'parent')
        )
    """
    _drop_policy(table_name, policy_name)
    op.execute(
        f"""
        CREATE POLICY {policy_name} ON {table_name}
        FOR ALL
        USING ({user_access_sql})
        WITH CHECK ({user_access_sql})
        """
    )


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS learning_revision_cards (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            topic_id TEXT NOT NULL,
            label TEXT NOT NULL,
            due_at TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            attempts INTEGER NOT NULL DEFAULT 0,
            last_error TEXT,
            sent_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            CHECK (status IN ('pending', 'sent', 'failed', 'cancelled'))
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_revision_cards_due "
        "ON learning_revision_cards (status, due_at) WHERE status = 'pending'"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_revision_cards_user "
        "ON learning_revision_cards (tenant_id, user_id, due_at DESC)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS learning_push_subscriptions (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            endpoint TEXT NOT NULL,
            p256dh TEXT NOT NULL,
            auth TEXT NOT NULL,
            user_agent TEXT,
            created_at TEXT NOT NULL,
            revoked_at TEXT,
            UNIQUE (endpoint)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user "
        "ON learning_push_subscriptions (tenant_id, user_id) WHERE revoked_at IS NULL"
    )

    for table_name in RLS_TABLES:
        op.execute(f"ALTER TABLE {table_name} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table_name} FORCE ROW LEVEL SECURITY")
        _user_policy(table_name)


def downgrade() -> None:
    for table_name in reversed(RLS_TABLES):
        _drop_policy(table_name, f"{table_name}_tenant_user_policy")
        op.execute(f"ALTER TABLE {table_name} NO FORCE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table_name} DISABLE ROW LEVEL SECURITY")
    for table_name in reversed(RLS_TABLES):
        op.execute(f"DROP TABLE IF EXISTS {table_name}")
