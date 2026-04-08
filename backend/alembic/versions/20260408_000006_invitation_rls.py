"""Add child invitations and request-scoped row level security.

Revision ID: 20260408_000006
Revises: 20260408_000005
Create Date: 2026-04-08 17:30:00.000000
"""

from __future__ import annotations

from alembic import op


revision = "20260408_000006"
down_revision = "20260408_000005"
branch_labels = None
depends_on = None


def _drop_policy(table_name: str, policy_name: str) -> None:
    op.execute(f"DROP POLICY IF EXISTS {policy_name} ON {table_name}")


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS child_invitations (
            id TEXT PRIMARY KEY,
            child_id TEXT NOT NULL REFERENCES children(id),
            invited_email TEXT NOT NULL,
            relationship TEXT NOT NULL,
            status TEXT NOT NULL,
            invited_by_user_id TEXT NOT NULL REFERENCES users(id),
            accepted_by_user_id TEXT REFERENCES users(id),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            responded_at TEXT
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_child_invitations_email_status ON child_invitations (invited_email, status, updated_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_child_invitations_child_status ON child_invitations (child_id, status, updated_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_child_invitations_inviter_status ON child_invitations (invited_by_user_id, status, updated_at DESC)"
    )

    policy_targets = [
        "children",
        "user_children",
        "sessions",
        "practice_plans",
        "child_memory_items",
        "child_memory_proposals",
        "child_memory_evidence_links",
        "child_memory_summaries",
        "recommendation_logs",
        "recommendation_candidates",
        "institutional_memory_insights",
        "audit_log",
        "child_invitations",
    ]
    for table_name in policy_targets:
        op.execute(f"ALTER TABLE {table_name} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table_name} FORCE ROW LEVEL SECURITY")

    _drop_policy("children", "children_select_policy")
    _drop_policy("children", "children_insert_policy")
    _drop_policy("children", "children_update_policy")
    op.execute(
        """
        CREATE POLICY children_select_policy ON children
        FOR SELECT
        USING (
            current_setting('app.system_bypass_rls', true) = 'on'
            OR current_setting('app.current_user_role', true) = 'admin'
            OR EXISTS (
                SELECT 1
                FROM user_children
                WHERE user_children.child_id = children.id
                  AND user_children.user_id = current_setting('app.current_user_id', true)
            )
        )
        """
    )
    op.execute(
        """
        CREATE POLICY children_insert_policy ON children
        FOR INSERT
        WITH CHECK (
            current_setting('app.system_bypass_rls', true) = 'on'
            OR current_setting('app.current_user_role', true) IN ('therapist', 'parent', 'admin')
        )
        """
    )
    op.execute(
        """
        CREATE POLICY children_update_policy ON children
        FOR UPDATE
        USING (
            current_setting('app.system_bypass_rls', true) = 'on'
            OR current_setting('app.current_user_role', true) = 'admin'
            OR EXISTS (
                SELECT 1
                FROM user_children
                WHERE user_children.child_id = children.id
                  AND user_children.user_id = current_setting('app.current_user_id', true)
            )
        )
        WITH CHECK (
            current_setting('app.system_bypass_rls', true) = 'on'
            OR current_setting('app.current_user_role', true) = 'admin'
            OR EXISTS (
                SELECT 1
                FROM user_children
                WHERE user_children.child_id = children.id
                  AND user_children.user_id = current_setting('app.current_user_id', true)
            )
        )
        """
    )

    _drop_policy("user_children", "user_children_select_policy")
    _drop_policy("user_children", "user_children_write_policy")
    op.execute(
        """
        CREATE POLICY user_children_select_policy ON user_children
        FOR SELECT
        USING (
            current_setting('app.system_bypass_rls', true) = 'on'
            OR current_setting('app.current_user_role', true) = 'admin'
            OR user_id = current_setting('app.current_user_id', true)
        )
        """
    )
    op.execute(
        """
        CREATE POLICY user_children_write_policy ON user_children
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

    child_scoped_tables = [
        "sessions",
        "practice_plans",
        "child_memory_items",
        "child_memory_proposals",
        "child_memory_evidence_links",
        "child_memory_summaries",
        "recommendation_logs",
        "audit_log",
    ]
    for table_name in child_scoped_tables:
        _drop_policy(table_name, f"{table_name}_child_access_policy")
        op.execute(
            f"""
            CREATE POLICY {table_name}_child_access_policy ON {table_name}
            FOR ALL
            USING (
                current_setting('app.system_bypass_rls', true) = 'on'
                OR current_setting('app.current_user_role', true) = 'admin'
                OR EXISTS (
                    SELECT 1
                    FROM user_children
                    WHERE user_children.child_id = {table_name}.child_id
                      AND user_children.user_id = current_setting('app.current_user_id', true)
                )
            )
            WITH CHECK (
                current_setting('app.system_bypass_rls', true) = 'on'
                OR current_setting('app.current_user_role', true) = 'admin'
                OR EXISTS (
                    SELECT 1
                    FROM user_children
                    WHERE user_children.child_id = {table_name}.child_id
                      AND user_children.user_id = current_setting('app.current_user_id', true)
                )
            )
            """
        )

    _drop_policy("recommendation_candidates", "recommendation_candidates_child_access_policy")
    op.execute(
        """
        CREATE POLICY recommendation_candidates_child_access_policy ON recommendation_candidates
        FOR ALL
        USING (
            current_setting('app.system_bypass_rls', true) = 'on'
            OR current_setting('app.current_user_role', true) = 'admin'
            OR EXISTS (
                SELECT 1
                FROM recommendation_logs
                INNER JOIN user_children ON user_children.child_id = recommendation_logs.child_id
                WHERE recommendation_logs.id = recommendation_candidates.recommendation_log_id
                  AND user_children.user_id = current_setting('app.current_user_id', true)
            )
        )
        WITH CHECK (
            current_setting('app.system_bypass_rls', true) = 'on'
            OR current_setting('app.current_user_role', true) = 'admin'
            OR EXISTS (
                SELECT 1
                FROM recommendation_logs
                INNER JOIN user_children ON user_children.child_id = recommendation_logs.child_id
                WHERE recommendation_logs.id = recommendation_candidates.recommendation_log_id
                  AND user_children.user_id = current_setting('app.current_user_id', true)
            )
        )
        """
    )

    _drop_policy("institutional_memory_insights", "institutional_memory_owner_policy")
    op.execute(
        """
        CREATE POLICY institutional_memory_owner_policy ON institutional_memory_insights
        FOR ALL
        USING (
            current_setting('app.system_bypass_rls', true) = 'on'
            OR current_setting('app.current_user_role', true) = 'admin'
            OR owner_user_id = current_setting('app.current_user_id', true)
        )
        WITH CHECK (
            current_setting('app.system_bypass_rls', true) = 'on'
            OR current_setting('app.current_user_role', true) = 'admin'
            OR owner_user_id = current_setting('app.current_user_id', true)
        )
        """
    )

    _drop_policy("child_invitations", "child_invitations_select_policy")
    _drop_policy("child_invitations", "child_invitations_insert_policy")
    _drop_policy("child_invitations", "child_invitations_update_policy")
    op.execute(
        """
        CREATE POLICY child_invitations_select_policy ON child_invitations
        FOR SELECT
        USING (
            current_setting('app.system_bypass_rls', true) = 'on'
            OR current_setting('app.current_user_role', true) = 'admin'
            OR invited_by_user_id = current_setting('app.current_user_id', true)
            OR LOWER(invited_email) = LOWER(current_setting('app.current_user_email', true))
        )
        """
    )
    op.execute(
        """
        CREATE POLICY child_invitations_insert_policy ON child_invitations
        FOR INSERT
        WITH CHECK (
            current_setting('app.system_bypass_rls', true) = 'on'
            OR current_setting('app.current_user_role', true) = 'admin'
            OR invited_by_user_id = current_setting('app.current_user_id', true)
        )
        """
    )
    op.execute(
        """
        CREATE POLICY child_invitations_update_policy ON child_invitations
        FOR UPDATE
        USING (
            current_setting('app.system_bypass_rls', true) = 'on'
            OR current_setting('app.current_user_role', true) = 'admin'
            OR invited_by_user_id = current_setting('app.current_user_id', true)
            OR LOWER(invited_email) = LOWER(current_setting('app.current_user_email', true))
        )
        WITH CHECK (
            current_setting('app.system_bypass_rls', true) = 'on'
            OR current_setting('app.current_user_role', true) = 'admin'
            OR invited_by_user_id = current_setting('app.current_user_id', true)
            OR LOWER(invited_email) = LOWER(current_setting('app.current_user_email', true))
        )
        """
    )


def downgrade() -> None:
    for table_name, policies in {
        "children": ["children_select_policy", "children_insert_policy", "children_update_policy"],
        "user_children": ["user_children_select_policy", "user_children_write_policy"],
        "sessions": ["sessions_child_access_policy"],
        "practice_plans": ["practice_plans_child_access_policy"],
        "child_memory_items": ["child_memory_items_child_access_policy"],
        "child_memory_proposals": ["child_memory_proposals_child_access_policy"],
        "child_memory_evidence_links": ["child_memory_evidence_links_child_access_policy"],
        "child_memory_summaries": ["child_memory_summaries_child_access_policy"],
        "recommendation_logs": ["recommendation_logs_child_access_policy"],
        "recommendation_candidates": ["recommendation_candidates_child_access_policy"],
        "institutional_memory_insights": ["institutional_memory_owner_policy"],
        "audit_log": ["audit_log_child_access_policy"],
        "child_invitations": [
            "child_invitations_select_policy",
            "child_invitations_insert_policy",
            "child_invitations_update_policy",
        ],
    }.items():
        for policy_name in policies:
            _drop_policy(table_name, policy_name)
        op.execute(f"ALTER TABLE {table_name} NO FORCE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table_name} DISABLE ROW LEVEL SECURITY")

    op.execute("DROP INDEX IF EXISTS idx_child_invitations_inviter_status")
    op.execute("DROP INDEX IF EXISTS idx_child_invitations_child_status")
    op.execute("DROP INDEX IF EXISTS idx_child_invitations_email_status")
    op.execute("DROP TABLE IF EXISTS child_invitations")
