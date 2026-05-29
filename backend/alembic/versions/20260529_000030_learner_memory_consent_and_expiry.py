"""Learner memory consent + auto-approve/expiry on student facts.

Revision ID: 20260529_000030
Revises: 20260528_000029
Create Date: 2026-05-29 00:30:00.000000
"""

from __future__ import annotations

from alembic import op


revision = "20260529_000030"
down_revision = "20260528_000029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Add expires_at + widen status CHECK on learning_student_facts.
    op.execute("ALTER TABLE learning_student_facts ADD COLUMN IF NOT EXISTS expires_at TEXT")
    op.execute("CREATE INDEX IF NOT EXISTS idx_learning_student_facts_expires_at "
               "ON learning_student_facts (expires_at) WHERE expires_at IS NOT NULL")

    # Widen status CHECK to include 'auto_approved'. Postgres CHECK constraints
    # cannot be ALTERed in place; drop and recreate using the synthesised name.
    op.execute("""
        DO $$
        DECLARE
            chk_name TEXT;
        BEGIN
            SELECT conname INTO chk_name
            FROM pg_constraint
            WHERE conrelid = 'learning_student_facts'::regclass
              AND contype = 'c'
              AND pg_get_constraintdef(oid) LIKE '%status%';
            IF chk_name IS NOT NULL THEN
                EXECUTE format('ALTER TABLE learning_student_facts DROP CONSTRAINT %I', chk_name);
            END IF;
            ALTER TABLE learning_student_facts ADD CONSTRAINT learning_student_facts_status_check
                CHECK (status IN ('draft', 'pending', 'approved', 'edited_approved', 'rejected', 'auto_approved'));
        END$$;
    """)

    # 2. Widen decisions action CHECK likewise.
    op.execute("""
        DO $$
        DECLARE
            chk_name TEXT;
        BEGIN
            SELECT conname INTO chk_name
            FROM pg_constraint
            WHERE conrelid = 'learning_student_fact_decisions'::regclass
              AND contype = 'c'
              AND pg_get_constraintdef(oid) LIKE '%action%';
            IF chk_name IS NOT NULL THEN
                EXECUTE format('ALTER TABLE learning_student_fact_decisions DROP CONSTRAINT %I', chk_name);
            END IF;
            ALTER TABLE learning_student_fact_decisions ADD CONSTRAINT learning_student_fact_decisions_action_check
                CHECK (action IN ('approved', 'edited_approved', 'rejected', 'auto_approved'));
        END$$;
    """)

    # 3. Learner memory consent table (one active row per learner).
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS learner_memory_consent (
            id TEXT PRIMARY KEY,
            learner_user_id TEXT NOT NULL,
            accepted_at TEXT,
            withdrawn_at TEXT,
            policy_version TEXT NOT NULL DEFAULT 'v1',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_learner_memory_consent_learner "
        "ON learner_memory_consent (learner_user_id, updated_at DESC)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS learner_memory_consent")
    op.execute("ALTER TABLE learning_student_facts DROP CONSTRAINT IF EXISTS learning_student_facts_status_check")
    op.execute("ALTER TABLE learning_student_facts ADD CONSTRAINT learning_student_facts_status_check "
               "CHECK (status IN ('draft', 'pending', 'approved', 'edited_approved', 'rejected'))")
    op.execute("ALTER TABLE learning_student_fact_decisions DROP CONSTRAINT IF EXISTS learning_student_fact_decisions_action_check")
    op.execute("ALTER TABLE learning_student_fact_decisions ADD CONSTRAINT learning_student_fact_decisions_action_check "
               "CHECK (action IN ('approved', 'edited_approved', 'rejected'))")
    op.execute("DROP INDEX IF EXISTS idx_learning_student_facts_expires_at")
    op.execute("ALTER TABLE learning_student_facts DROP COLUMN IF EXISTS expires_at")
