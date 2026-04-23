"""User + child UI state persistence for the onboarding plan.

Revision ID: 20260423_000023
Revises: 20260422_000022
Create Date: 2026-04-23 00:00:00.000000

Adds the minimum Phase 1 storage for the onboarding/guidance rollout described
in ``docs/onboarding/onboarding-plan-v2.md``:

- ``users.ui_state`` JSONB for ephemeral UI flags (``tours_seen``,
  ``announcements_dismissed``, ``checklist_state``, ``help_mode``,
  ``onboarding_complete``).
- ``ui_state_audit`` append-only table for dismissals/completions/resets. Keys
  only, never values (PII hygiene).
- ``child_ui_state`` normalized per-``(child_id, user_id, exercise_type)``
  first-run flag used by the child mode micro-tutorials.

RLS is enabled on both new tables using the same ``current_setting`` pattern
established in ``20260408_000006_invitation_rls``.
"""
from __future__ import annotations

from alembic import op


revision = "20260423_000023"
down_revision = "20260422_000022"
branch_labels = None
depends_on = None


def _drop_policy(table_name: str, policy_name: str) -> None:
    op.execute(f"DROP POLICY IF EXISTS {policy_name} ON {table_name}")


def upgrade() -> None:
    # ------------------------------------------------------------------
    # users.ui_state column
    # ------------------------------------------------------------------
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS ui_state JSONB NOT NULL DEFAULT '{}'::jsonb"
    )

    # ------------------------------------------------------------------
    # ui_state_audit: append-only key-level audit of UI state mutations
    # ------------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS ui_state_audit (
            id BIGSERIAL PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id),
            event TEXT NOT NULL,
            payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TEXT NOT NULL
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_ui_state_audit_user_created "
        "ON ui_state_audit (user_id, created_at DESC)"
    )

    # ------------------------------------------------------------------
    # child_ui_state: per-(child, therapist, exercise) first-run flag
    # ------------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS child_ui_state (
            child_id TEXT NOT NULL REFERENCES children(id),
            user_id TEXT NOT NULL REFERENCES users(id),
            exercise_type TEXT NOT NULL,
            first_run_at TEXT,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (child_id, user_id, exercise_type)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_child_ui_state_user "
        "ON child_ui_state (user_id, updated_at DESC)"
    )

    # ------------------------------------------------------------------
    # Row-level security (Postgres only; SQLite enforces at application layer)
    # ------------------------------------------------------------------
    for table_name in ("ui_state_audit", "child_ui_state"):
        op.execute(f"ALTER TABLE {table_name} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table_name} FORCE ROW LEVEL SECURITY")

    _drop_policy("ui_state_audit", "ui_state_audit_select_policy")
    op.execute(
        """
        CREATE POLICY ui_state_audit_select_policy ON ui_state_audit
        FOR SELECT
        USING (
            current_setting('app.system_bypass_rls', true) = 'on'
            OR current_setting('app.current_user_role', true) = 'admin'
            OR user_id = current_setting('app.current_user_id', true)
        )
        """
    )
    _drop_policy("ui_state_audit", "ui_state_audit_insert_policy")
    op.execute(
        """
        CREATE POLICY ui_state_audit_insert_policy ON ui_state_audit
        FOR INSERT
        WITH CHECK (
            current_setting('app.system_bypass_rls', true) = 'on'
            OR user_id = current_setting('app.current_user_id', true)
        )
        """
    )

    _drop_policy("child_ui_state", "child_ui_state_select_policy")
    op.execute(
        """
        CREATE POLICY child_ui_state_select_policy ON child_ui_state
        FOR SELECT
        USING (
            current_setting('app.system_bypass_rls', true) = 'on'
            OR current_setting('app.current_user_role', true) = 'admin'
            OR user_id = current_setting('app.current_user_id', true)
        )
        """
    )
    _drop_policy("child_ui_state", "child_ui_state_write_policy")
    op.execute(
        """
        CREATE POLICY child_ui_state_write_policy ON child_ui_state
        FOR ALL
        USING (
            current_setting('app.system_bypass_rls', true) = 'on'
            OR current_setting('app.current_user_role', true) = 'admin'
            OR user_id = current_setting('app.current_user_id', true)
        )
        WITH CHECK (
            current_setting('app.system_bypass_rls', true) = 'on'
            OR current_setting('app.current_user_role', true) = 'admin'
            OR user_id = current_setting('app.current_user_id', true)
        )
        """
    )


def downgrade() -> None:
    _drop_policy("child_ui_state", "child_ui_state_write_policy")
    _drop_policy("child_ui_state", "child_ui_state_select_policy")
    _drop_policy("ui_state_audit", "ui_state_audit_insert_policy")
    _drop_policy("ui_state_audit", "ui_state_audit_select_policy")
    op.execute("DROP INDEX IF EXISTS idx_child_ui_state_user")
    op.execute("DROP TABLE IF EXISTS child_ui_state")
    op.execute("DROP INDEX IF EXISTS idx_ui_state_audit_user_created")
    op.execute("DROP TABLE IF EXISTS ui_state_audit")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS ui_state")
