"""Student fact approval workflow tables.

Revision ID: 20260524_000027
Revises: 20260524_000026
Create Date: 2026-05-24 00:27:00.000000
"""

from __future__ import annotations

from alembic import op


revision = "20260524_000027"
down_revision = "20260524_000026"
branch_labels = None
depends_on = None


LEARNING_STUDENT_FACT_RLS_TABLES = (
    "learning_student_facts",
    "learning_student_fact_decisions",
)

TENANT_ACCESS_SQL = """
    current_setting('app.system_bypass_rls', true) = 'on'
    OR current_setting('app.role', true) IN ('admin', 'district_admin', 'dpo')
    OR current_setting('app.current_user_role', true) = 'admin'
    OR tenant_id = current_setting('app.tenant_id', true)
"""


def _drop_policy(table_name: str, policy_name: str) -> None:
    op.execute(f"DROP POLICY IF EXISTS {policy_name} ON {table_name}")


def _class_policy(table_name: str, class_column: str = "class_id") -> None:
    policy_name = f"{table_name}_tenant_class_policy"
    class_access_sql = f"""
        ({TENANT_ACCESS_SQL})
        AND (
            COALESCE(current_setting('app.class_id', true), '') = ''
            OR {class_column} = current_setting('app.class_id', true)
        )
    """
    _drop_policy(table_name, policy_name)
    op.execute(
        f"""
        CREATE POLICY {policy_name} ON {table_name}
        FOR ALL
        USING ({class_access_sql})
        WITH CHECK ({class_access_sql})
        """
    )


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS learning_student_facts (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            class_id TEXT NOT NULL,
            student_id TEXT NOT NULL,
            created_by_user_id TEXT NOT NULL,
            status TEXT NOT NULL,
            fact_json JSONB NOT NULL,
            lang TEXT NOT NULL,
            provenance_json JSONB NOT NULL DEFAULT '[]'::jsonb,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            approved_at TEXT,
            decided_by TEXT,
            decision_reason TEXT,
            CHECK (status IN ('draft', 'pending', 'approved', 'edited_approved', 'rejected'))
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_learning_student_facts_tenant_class_status "
        "ON learning_student_facts (tenant_id, class_id, status, updated_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_learning_student_facts_tenant_student_status "
        "ON learning_student_facts (tenant_id, student_id, status, updated_at DESC)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS learning_student_fact_decisions (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            class_id TEXT NOT NULL,
            fact_id TEXT NOT NULL REFERENCES learning_student_facts(id),
            actor_id TEXT NOT NULL,
            action TEXT NOT NULL,
            reason TEXT,
            edited_fact_json JSONB,
            xapi_statement_json JSONB NOT NULL,
            created_at TEXT NOT NULL,
            CHECK (action IN ('approved', 'edited_approved', 'rejected'))
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_learning_student_fact_decisions_fact_created "
        "ON learning_student_fact_decisions (tenant_id, fact_id, created_at DESC)"
    )

    for table_name in LEARNING_STUDENT_FACT_RLS_TABLES:
        op.execute(f"ALTER TABLE {table_name} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table_name} FORCE ROW LEVEL SECURITY")
        _class_policy(table_name)


def downgrade() -> None:
    for table_name in reversed(LEARNING_STUDENT_FACT_RLS_TABLES):
        _drop_policy(table_name, f"{table_name}_tenant_class_policy")
        op.execute(f"ALTER TABLE {table_name} NO FORCE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table_name} DISABLE ROW LEVEL SECURITY")
    for table_name in reversed(LEARNING_STUDENT_FACT_RLS_TABLES):
        op.execute(f"DROP TABLE IF EXISTS {table_name}")