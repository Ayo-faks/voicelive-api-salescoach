"""Add child-scoped row level security to parental_consents (P7).

``parental_consents`` stores per-child guardian PII (name, email) but shipped
without row level security, while every sibling child-data table
(``children``, ``progress_reports``, ``user_children`` …) is RLS-forced. This
closes that gap with the same child-access policy ``progress_reports`` uses, so
the table is protected with no behavioural change:

* In-request reads/writes (the consent gate, therapist consent capture) pass via
  the ``user_children`` membership clause — exactly as for progress reports.
* Off-request reads (the safeguarding notifier's parent-email resolver runs on a
  background thread with no request actor) pass via the
  ``app.system_bypass_rls = 'on'`` clause the storage layer sets when there is no
  request user, so guardian-email resolution for alerts is unaffected.

Revision ID: 20260606_000034
Revises: 20260601_000033
Create Date: 2026-06-06 00:00:00.000000
"""

from __future__ import annotations

from alembic import op


revision = "20260606_000034"
down_revision = "20260601_000033"
branch_labels = None
depends_on = None


def _drop_policy(table_name: str, policy_name: str) -> None:
    op.execute(f"DROP POLICY IF EXISTS {policy_name} ON {table_name}")


def upgrade() -> None:
    op.execute("ALTER TABLE parental_consents ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE parental_consents FORCE ROW LEVEL SECURITY")
    _drop_policy("parental_consents", "parental_consents_child_access_policy")
    op.execute(
        """
        CREATE POLICY parental_consents_child_access_policy ON parental_consents
        FOR ALL
        USING (
            current_setting('app.system_bypass_rls', true) = 'on'
            OR current_setting('app.current_user_role', true) = 'admin'
            OR EXISTS (
                SELECT 1
                FROM user_children
                WHERE user_children.child_id = parental_consents.child_id
                  AND user_children.user_id = current_setting('app.current_user_id', true)
            )
        )
        WITH CHECK (
            current_setting('app.system_bypass_rls', true) = 'on'
            OR current_setting('app.current_user_role', true) = 'admin'
            OR EXISTS (
                SELECT 1
                FROM user_children
                WHERE user_children.child_id = parental_consents.child_id
                  AND user_children.user_id = current_setting('app.current_user_id', true)
            )
        )
        """
    )


def downgrade() -> None:
    _drop_policy("parental_consents", "parental_consents_child_access_policy")
    op.execute("ALTER TABLE parental_consents NO FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE parental_consents DISABLE ROW LEVEL SECURITY")
