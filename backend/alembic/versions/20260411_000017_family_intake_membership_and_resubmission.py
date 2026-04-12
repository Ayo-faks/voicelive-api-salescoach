"""Align family intake RLS with delayed membership and resubmission.

Revision ID: 20260411_000017
Revises: 20260411_000016
Create Date: 2026-04-11 19:45:00.000000
"""

from __future__ import annotations

from alembic import op


revision = "20260411_000017"
down_revision = "20260411_000016"
branch_labels = None
depends_on = None


def _drop_policy(table_name: str, policy_name: str) -> None:
    op.execute(f"DROP POLICY IF EXISTS {policy_name} ON {table_name}")


def upgrade() -> None:
    _drop_policy("child_intake_proposals", "child_intake_proposals_insert_policy")
    _drop_policy("child_intake_proposals", "child_intake_proposals_update_policy")

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
                    FROM family_intake_invitations
                    WHERE family_intake_invitations.id = child_intake_proposals.family_intake_invitation_id
                      AND family_intake_invitations.accepted_by_user_id = current_setting('app.current_user_id', true)
                      AND family_intake_invitations.status = 'accepted'
                      AND family_intake_invitations.workspace_id = child_intake_proposals.workspace_id
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
            OR (
                child_intake_proposals.created_by_user_id = current_setting('app.current_user_id', true)
                AND child_intake_proposals.status = 'rejected'
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
            OR (
                child_intake_proposals.created_by_user_id = current_setting('app.current_user_id', true)
                AND child_intake_proposals.status IN ('submitted', 'rejected')
            )
        )
        """
    )


def downgrade() -> None:
    _drop_policy("child_intake_proposals", "child_intake_proposals_update_policy")
    _drop_policy("child_intake_proposals", "child_intake_proposals_insert_policy")

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