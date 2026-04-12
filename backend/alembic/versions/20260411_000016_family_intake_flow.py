"""Add family intake invitations and child intake proposals.

Revision ID: 20260411_000016
Revises: 20260411_000015
Create Date: 2026-04-11 19:10:00.000000
"""

from __future__ import annotations

from alembic import op


revision = "20260411_000016"
down_revision = "20260411_000015"
branch_labels = None
depends_on = None


def _drop_policy(table_name: str, policy_name: str) -> None:
    op.execute(f"DROP POLICY IF EXISTS {policy_name} ON {table_name}")


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS family_intake_invitations (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL REFERENCES therapist_workspaces(id) ON DELETE CASCADE,
            invited_email TEXT NOT NULL,
            invited_by_user_id TEXT NOT NULL REFERENCES users(id),
            status TEXT NOT NULL,
            accepted_by_user_id TEXT REFERENCES users(id),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            responded_at TEXT,
            expires_at TEXT
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_family_intake_invites_email_status ON family_intake_invitations (invited_email, status, updated_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_family_intake_invites_workspace_status ON family_intake_invitations (workspace_id, status, updated_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_family_intake_invites_inviter_status ON family_intake_invitations (invited_by_user_id, status, updated_at DESC)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS child_intake_proposals (
            id TEXT PRIMARY KEY,
            family_intake_invitation_id TEXT NOT NULL REFERENCES family_intake_invitations(id) ON DELETE CASCADE,
            workspace_id TEXT NOT NULL REFERENCES therapist_workspaces(id) ON DELETE CASCADE,
            created_by_user_id TEXT NOT NULL REFERENCES users(id),
            reviewed_by_user_id TEXT REFERENCES users(id),
            final_child_id TEXT REFERENCES children(id),
            child_name TEXT NOT NULL,
            date_of_birth TEXT,
            notes TEXT,
            status TEXT NOT NULL,
            submitted_at TEXT,
            reviewed_at TEXT,
            review_note TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_child_intake_proposals_creator_status ON child_intake_proposals (created_by_user_id, status, updated_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_child_intake_proposals_workspace_status ON child_intake_proposals (workspace_id, status, submitted_at DESC)"
    )

    for table_name in ("family_intake_invitations", "child_intake_proposals"):
        op.execute(f"ALTER TABLE {table_name} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table_name} FORCE ROW LEVEL SECURITY")

    _drop_policy("family_intake_invitations", "family_intake_invitations_select_policy")
    _drop_policy("family_intake_invitations", "family_intake_invitations_insert_policy")
    _drop_policy("family_intake_invitations", "family_intake_invitations_update_policy")
    op.execute(
        """
        CREATE POLICY family_intake_invitations_select_policy ON family_intake_invitations
        FOR SELECT
        USING (
            current_setting('app.system_bypass_rls', true) = 'on'
            OR current_setting('app.current_user_role', true) = 'admin'
            OR invited_by_user_id = current_setting('app.current_user_id', true)
            OR LOWER(invited_email) = LOWER(current_setting('app.current_user_email', true))
            OR EXISTS (
                SELECT 1
                FROM workspace_members
                WHERE workspace_members.workspace_id = family_intake_invitations.workspace_id
                  AND workspace_members.user_id = current_setting('app.current_user_id', true)
                  AND workspace_members.role IN ('owner', 'admin', 'therapist')
            )
        )
        """
    )
    op.execute(
        """
        CREATE POLICY family_intake_invitations_insert_policy ON family_intake_invitations
        FOR INSERT
        WITH CHECK (
            current_setting('app.system_bypass_rls', true) = 'on'
            OR current_setting('app.current_user_role', true) = 'admin'
            OR (
                invited_by_user_id = current_setting('app.current_user_id', true)
                AND EXISTS (
                    SELECT 1
                    FROM workspace_members
                    WHERE workspace_members.workspace_id = family_intake_invitations.workspace_id
                      AND workspace_members.user_id = current_setting('app.current_user_id', true)
                      AND workspace_members.role IN ('owner', 'admin', 'therapist')
                )
            )
        )
        """
    )
    op.execute(
        """
        CREATE POLICY family_intake_invitations_update_policy ON family_intake_invitations
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

    _drop_policy("child_intake_proposals", "child_intake_proposals_select_policy")
    _drop_policy("child_intake_proposals", "child_intake_proposals_insert_policy")
    _drop_policy("child_intake_proposals", "child_intake_proposals_update_policy")
    op.execute(
        """
        CREATE POLICY child_intake_proposals_select_policy ON child_intake_proposals
        FOR SELECT
        USING (
            current_setting('app.system_bypass_rls', true) = 'on'
            OR current_setting('app.current_user_role', true) = 'admin'
            OR created_by_user_id = current_setting('app.current_user_id', true)
            OR EXISTS (
                SELECT 1
                FROM workspace_members
                WHERE workspace_members.workspace_id = child_intake_proposals.workspace_id
                  AND workspace_members.user_id = current_setting('app.current_user_id', true)
                  AND workspace_members.role IN ('owner', 'admin', 'therapist')
            )
        )
        """
    )
    op.execute(
        """
        CREATE POLICY child_intake_proposals_insert_policy ON child_intake_proposals
        FOR INSERT
        WITH CHECK (
            current_setting('app.system_bypass_rls', true) = 'on'
            OR current_setting('app.current_user_role', true) = 'admin'
            OR (
                created_by_user_id = current_setting('app.current_user_id', true)
                AND EXISTS (
                    SELECT 1
                    FROM workspace_members
                    WHERE workspace_members.workspace_id = child_intake_proposals.workspace_id
                      AND workspace_members.user_id = current_setting('app.current_user_id', true)
                )
            )
        )
        """
    )
    op.execute(
        """
        CREATE POLICY child_intake_proposals_update_policy ON child_intake_proposals
        FOR UPDATE
        USING (
            current_setting('app.system_bypass_rls', true) = 'on'
            OR current_setting('app.current_user_role', true) = 'admin'
            OR EXISTS (
                SELECT 1
                FROM workspace_members
                WHERE workspace_members.workspace_id = child_intake_proposals.workspace_id
                  AND workspace_members.user_id = current_setting('app.current_user_id', true)
                  AND workspace_members.role IN ('owner', 'admin', 'therapist')
            )
        )
        WITH CHECK (
            current_setting('app.system_bypass_rls', true) = 'on'
            OR current_setting('app.current_user_role', true) = 'admin'
            OR EXISTS (
                SELECT 1
                FROM workspace_members
                WHERE workspace_members.workspace_id = child_intake_proposals.workspace_id
                  AND workspace_members.user_id = current_setting('app.current_user_id', true)
                  AND workspace_members.role IN ('owner', 'admin', 'therapist')
            )
        )
        """
    )


def downgrade() -> None:
    _drop_policy("child_intake_proposals", "child_intake_proposals_update_policy")
    _drop_policy("child_intake_proposals", "child_intake_proposals_insert_policy")
    _drop_policy("child_intake_proposals", "child_intake_proposals_select_policy")
    _drop_policy("family_intake_invitations", "family_intake_invitations_update_policy")
    _drop_policy("family_intake_invitations", "family_intake_invitations_insert_policy")
    _drop_policy("family_intake_invitations", "family_intake_invitations_select_policy")
    op.execute("DROP TABLE IF EXISTS child_intake_proposals")
    op.execute("DROP TABLE IF EXISTS family_intake_invitations")