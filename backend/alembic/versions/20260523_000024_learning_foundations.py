"""Pathfinder Learn Phase 1 foundation tables and RLS.

Revision ID: 20260523_000024
Revises: 20260423_000023
Create Date: 2026-05-23 00:00:00.000000

Creates the learning data spine promised by ``docs/architecture-contract.md``:
roster, curriculum catalogue, diagnostic responses, mastery events, approvals,
xAPI statements, offline sync queue, and content-pack manifests.

RLS introduces the Pathfinder Learn GUC names from the contract
(``app.tenant_id``, ``app.class_id``, ``app.user_id``, ``app.role``) while still
honouring the legacy request GUCs used by the retained therapy storage layer.
"""

from __future__ import annotations

from alembic import op


revision = "20260523_000024"
down_revision = "20260423_000023"
branch_labels = None
depends_on = None


LEARNING_RLS_TABLES = (
    "learning_classes",
    "learning_students",
    "learning_teachers",
    "learning_teacher_classes",
    "learning_cohorts",
    "learning_cohort_classes",
    "learning_standards",
    "learning_skills",
    "learning_diagnostic_items",
    "learning_student_responses",
    "learning_mastery_events",
    "learning_intervention_plans",
    "learning_approvals",
    "learning_xapi_statements",
    "learning_offline_queue",
    "learning_content_pack_manifests",
)


TENANT_ACCESS_SQL = """
    current_setting('app.system_bypass_rls', true) = 'on'
    OR current_setting('app.role', true) IN ('admin', 'district_admin', 'dpo')
    OR current_setting('app.current_user_role', true) = 'admin'
    OR tenant_id = current_setting('app.tenant_id', true)
"""


def _drop_policy(table_name: str, policy_name: str) -> None:
    op.execute(f"DROP POLICY IF EXISTS {policy_name} ON {table_name}")


def _enable_forced_rls() -> None:
    for table_name in LEARNING_RLS_TABLES:
        op.execute(f"ALTER TABLE {table_name} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table_name} FORCE ROW LEVEL SECURITY")


def _tenant_policy(table_name: str) -> None:
    policy_name = f"{table_name}_tenant_policy"
    _drop_policy(table_name, policy_name)
    op.execute(
        f"""
        CREATE POLICY {policy_name} ON {table_name}
        FOR ALL
        USING ({TENANT_ACCESS_SQL})
        WITH CHECK ({TENANT_ACCESS_SQL})
        """
    )


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
        CREATE TABLE IF NOT EXISTS learning_classes (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            name TEXT NOT NULL,
            year_group TEXT NOT NULL,
            created_by_user_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_learning_classes_tenant ON learning_classes (tenant_id, updated_at DESC)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS learning_students (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            class_id TEXT NOT NULL REFERENCES learning_classes(id),
            display_name TEXT NOT NULL,
            year_group TEXT,
            career_consent BOOLEAN NOT NULL DEFAULT false,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_learning_students_tenant_class ON learning_students (tenant_id, class_id, updated_at DESC)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS learning_teachers (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            user_id TEXT REFERENCES users(id),
            display_name TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE (tenant_id, user_id)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_learning_teachers_tenant ON learning_teachers (tenant_id, updated_at DESC)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS learning_teacher_classes (
            tenant_id TEXT NOT NULL,
            teacher_id TEXT NOT NULL REFERENCES learning_teachers(id) ON DELETE CASCADE,
            class_id TEXT NOT NULL REFERENCES learning_classes(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL,
            PRIMARY KEY (teacher_id, class_id)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_learning_teacher_classes_tenant_class ON learning_teacher_classes (tenant_id, class_id)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS learning_cohorts (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_learning_cohorts_tenant ON learning_cohorts (tenant_id, updated_at DESC)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS learning_cohort_classes (
            tenant_id TEXT NOT NULL,
            cohort_id TEXT NOT NULL REFERENCES learning_cohorts(id) ON DELETE CASCADE,
            class_id TEXT NOT NULL REFERENCES learning_classes(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL,
            PRIMARY KEY (cohort_id, class_id)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_learning_cohort_classes_tenant_class ON learning_cohort_classes (tenant_id, class_id)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS learning_standards (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            source TEXT NOT NULL,
            name TEXT NOT NULL,
            version TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE (tenant_id, source, version, name)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_learning_standards_tenant ON learning_standards (tenant_id, updated_at DESC)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS learning_skills (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            standard_id TEXT NOT NULL REFERENCES learning_standards(id),
            name TEXT NOT NULL,
            description TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_learning_skills_tenant_standard ON learning_skills (tenant_id, standard_id, updated_at DESC)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS learning_diagnostic_items (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            skill_id TEXT NOT NULL REFERENCES learning_skills(id),
            prompt TEXT NOT NULL,
            item_type TEXT NOT NULL,
            difficulty DOUBLE PRECISION NOT NULL DEFAULT 0,
            correct_answer TEXT,
            lang TEXT NOT NULL,
            provenance_json JSONB NOT NULL DEFAULT '[]'::jsonb,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_learning_diagnostic_items_tenant_skill ON learning_diagnostic_items (tenant_id, skill_id, updated_at DESC)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS learning_student_responses (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            student_id TEXT NOT NULL REFERENCES learning_students(id),
            item_id TEXT NOT NULL REFERENCES learning_diagnostic_items(id),
            skill_id TEXT NOT NULL REFERENCES learning_skills(id),
            response_text TEXT NOT NULL,
            correct BOOLEAN NOT NULL,
            lang TEXT NOT NULL,
            provenance_json JSONB NOT NULL DEFAULT '[]'::jsonb,
            idempotency_key TEXT,
            created_at TEXT NOT NULL,
            UNIQUE (tenant_id, idempotency_key)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_learning_responses_student_created ON learning_student_responses (tenant_id, student_id, created_at DESC)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS learning_mastery_events (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            student_id TEXT NOT NULL REFERENCES learning_students(id),
            skill_id TEXT NOT NULL REFERENCES learning_skills(id),
            response_id TEXT NOT NULL REFERENCES learning_student_responses(id),
            estimate_json JSONB NOT NULL,
            lang TEXT NOT NULL,
            provenance_json JSONB NOT NULL DEFAULT '[]'::jsonb,
            xapi_statement_json JSONB NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_learning_mastery_events_student_skill ON learning_mastery_events (tenant_id, student_id, skill_id, created_at DESC)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS learning_intervention_plans (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            created_by_user_id TEXT NOT NULL,
            status TEXT NOT NULL,
            plan_json JSONB NOT NULL,
            lang TEXT NOT NULL,
            provenance_json JSONB NOT NULL DEFAULT '[]'::jsonb,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            approved_at TEXT,
            CHECK (status IN ('draft', 'pending', 'approved', 'edited_approved', 'rejected'))
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_learning_intervention_plans_tenant_status ON learning_intervention_plans (tenant_id, status, updated_at DESC)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS learning_approvals (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            plan_id TEXT NOT NULL REFERENCES learning_intervention_plans(id),
            actor_id TEXT NOT NULL,
            action TEXT NOT NULL,
            reason TEXT,
            xapi_statement_json JSONB NOT NULL,
            created_at TEXT NOT NULL,
            CHECK (action IN ('approved', 'edited_approved', 'rejected'))
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_learning_approvals_plan_created ON learning_approvals (tenant_id, plan_id, created_at DESC)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS learning_xapi_statements (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            actor_id TEXT NOT NULL,
            verb_id TEXT NOT NULL,
            object_id TEXT NOT NULL,
            statement_json JSONB NOT NULL,
            sink_status TEXT NOT NULL DEFAULT 'audit_ledger',
            created_at TEXT NOT NULL,
            synced_at TEXT,
            CHECK (sink_status IN ('audit_ledger', 'ralph_queued', 'ralph_synced', 'ralph_failed'))
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_learning_xapi_tenant_created ON learning_xapi_statements (tenant_id, created_at DESC)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS learning_offline_queue (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            actor_id TEXT NOT NULL,
            idempotency_key TEXT NOT NULL,
            event_type TEXT NOT NULL,
            payload_json JSONB NOT NULL,
            status TEXT NOT NULL DEFAULT 'queued',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            replayed_at TEXT,
            UNIQUE (tenant_id, idempotency_key),
            CHECK (status IN ('queued', 'replayed', 'failed', 'manual_review'))
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_learning_offline_queue_tenant_status ON learning_offline_queue (tenant_id, status, updated_at DESC)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS learning_content_pack_manifests (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            pack_key TEXT NOT NULL,
            version TEXT NOT NULL,
            source_uri TEXT NOT NULL,
            sha256 TEXT NOT NULL,
            payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TEXT NOT NULL,
            activated_at TEXT,
            UNIQUE (tenant_id, pack_key, version)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_learning_content_packs_tenant_key ON learning_content_pack_manifests (tenant_id, pack_key, created_at DESC)"
    )

    _enable_forced_rls()
    for table_name in LEARNING_RLS_TABLES:
        if table_name == "learning_classes":
            _class_policy(table_name, "id")
        elif table_name in {"learning_students"}:
            _class_policy(table_name)
        else:
            _tenant_policy(table_name)


def downgrade() -> None:
    for table_name in reversed(LEARNING_RLS_TABLES):
        _drop_policy(table_name, f"{table_name}_tenant_policy")
        _drop_policy(table_name, f"{table_name}_tenant_class_policy")
        op.execute(f"ALTER TABLE {table_name} NO FORCE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table_name} DISABLE ROW LEVEL SECURITY")

    for table_name in reversed(LEARNING_RLS_TABLES):
        op.execute(f"DROP TABLE IF EXISTS {table_name}")
