"""Learner profile + consent audit (Pathfinder learner onboarding).

Revision ID: 20260528_000029
Revises: 20260527_000028
Create Date: 2026-05-28 00:00:00.000000

Adds:

- ``learner_profiles``: one row per user_id (server-side replacement for the
  ``pathfinder-learner-setup-v1`` localStorage blob).
- ``user_consents``: append-only audit of consent grants/revocations.

Both tables are user-scoped: a learner can only see their own row(s); admins
and DPO see everything. They are *not* tenant/class scoped because the
learner profile is a property of the user account itself, not of any class
membership (see plan §"Profile location").
"""

from __future__ import annotations

from alembic import op


revision = "20260528_000029"
down_revision = "20260527_000028"
branch_labels = None
depends_on = None


USER_ACCESS_SQL = """
    current_setting('app.system_bypass_rls', true) = 'on'
    OR current_setting('app.role', true) IN ('admin', 'district_admin', 'dpo')
    OR current_setting('app.current_user_role', true) = 'admin'
    OR user_id = current_setting('app.user_id', true)
"""


def _drop_policy(table_name: str, policy_name: str) -> None:
    op.execute(f"DROP POLICY IF EXISTS {policy_name} ON {table_name}")


def _user_scoped_policy(table_name: str) -> None:
    policy_name = f"{table_name}_user_policy"
    _drop_policy(table_name, policy_name)
    op.execute(
        f"""
        CREATE POLICY {policy_name} ON {table_name}
        FOR ALL
        USING ({USER_ACCESS_SQL})
        WITH CHECK ({USER_ACCESS_SQL})
        """
    )


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS learner_profiles (
            user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            display_name TEXT,
            exam TEXT,
            year_group TEXT,
            subjects JSONB NOT NULL DEFAULT '[]'::jsonb,
            interests JSONB NOT NULL DEFAULT '[]'::jsonb,
            locale TEXT,
            country TEXT,
            age_band TEXT,
            guardian_email TEXT,
            guardian_relationship TEXT,
            career_consent BOOLEAN NOT NULL DEFAULT false,
            analytics_consent BOOLEAN NOT NULL DEFAULT false,
            tour_seen_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS user_consents (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            kind TEXT NOT NULL,
            version TEXT NOT NULL,
            granted BOOLEAN NOT NULL,
            ip_hash TEXT,
            user_agent TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_user_consents_user_kind "
        "ON user_consents (user_id, kind, created_at DESC)"
    )

    for table in ("learner_profiles", "user_consents"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        _user_scoped_policy(table)


def downgrade() -> None:
    for table in ("user_consents", "learner_profiles"):
        _drop_policy(table, f"{table}_user_policy")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
    op.execute("DROP INDEX IF EXISTS idx_user_consents_user_kind")
    op.execute("DROP TABLE IF EXISTS user_consents")
    op.execute("DROP TABLE IF EXISTS learner_profiles")
