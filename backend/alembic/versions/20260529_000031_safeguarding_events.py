"""Safeguarding events table.

B2C scope: single admin (operator) reviews; no school_id multi-tenancy.
Append-only — UPDATE is permitted only on the acknowledgement columns
via an enforcing trigger.

Revision ID: 20260529_000031
Revises: 20260529_000030
Create Date: 2026-05-29 12:00:00.000000
"""

from __future__ import annotations

from alembic import op


revision = "20260529_000031"
down_revision = "20260529_000030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS safeguarding_events (
            id              TEXT PRIMARY KEY,
            user_id         TEXT,
            child_id        TEXT,
            parent_user_id  TEXT,
            session_id      TEXT,
            direction       TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
            severity        TEXT NOT NULL CHECK (severity IN ('none','low','medium','high','critical')),
            categories      JSONB NOT NULL DEFAULT '[]'::jsonb,
            evidence_quote  TEXT NOT NULL DEFAULT '',
            layer_scores    JSONB NOT NULL DEFAULT '[]'::jsonb,
            context_window  JSONB NOT NULL DEFAULT '[]'::jsonb,
            rationale       TEXT,
            created_at      TEXT NOT NULL,
            acknowledged_at TEXT,
            acknowledged_by TEXT,
            action_taken    TEXT,
            action_notes    TEXT
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_safeguarding_events_created_at "
        "ON safeguarding_events (created_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_safeguarding_events_unack "
        "ON safeguarding_events (created_at DESC) WHERE acknowledged_at IS NULL"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_safeguarding_events_child "
        "ON safeguarding_events (child_id, created_at DESC) WHERE child_id IS NOT NULL"
    )

    # Append-only guard: only acknowledgement columns may be UPDATEd, and
    # only once (acknowledged_at must transition from NULL to non-NULL).
    op.execute(
        """
        CREATE OR REPLACE FUNCTION safeguarding_events_block_mutations()
        RETURNS TRIGGER AS $$
        BEGIN
            IF TG_OP = 'DELETE' THEN
                RAISE EXCEPTION 'safeguarding_events is append-only';
            END IF;
            IF TG_OP = 'UPDATE' THEN
                IF OLD.id IS DISTINCT FROM NEW.id
                   OR OLD.user_id IS DISTINCT FROM NEW.user_id
                   OR OLD.child_id IS DISTINCT FROM NEW.child_id
                   OR OLD.parent_user_id IS DISTINCT FROM NEW.parent_user_id
                   OR OLD.session_id IS DISTINCT FROM NEW.session_id
                   OR OLD.direction IS DISTINCT FROM NEW.direction
                   OR OLD.severity IS DISTINCT FROM NEW.severity
                   OR OLD.categories::text IS DISTINCT FROM NEW.categories::text
                   OR OLD.evidence_quote IS DISTINCT FROM NEW.evidence_quote
                   OR OLD.layer_scores::text IS DISTINCT FROM NEW.layer_scores::text
                   OR OLD.context_window::text IS DISTINCT FROM NEW.context_window::text
                   OR OLD.rationale IS DISTINCT FROM NEW.rationale
                   OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
                    RAISE EXCEPTION 'safeguarding_events: only acknowledgement columns may be updated';
                END IF;
                IF OLD.acknowledged_at IS NOT NULL THEN
                    RAISE EXCEPTION 'safeguarding_events: event already acknowledged';
                END IF;
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute("DROP TRIGGER IF EXISTS safeguarding_events_guard ON safeguarding_events")
    op.execute(
        """
        CREATE TRIGGER safeguarding_events_guard
        BEFORE UPDATE OR DELETE ON safeguarding_events
        FOR EACH ROW EXECUTE FUNCTION safeguarding_events_block_mutations();
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS safeguarding_events_guard ON safeguarding_events")
    op.execute("DROP FUNCTION IF EXISTS safeguarding_events_block_mutations()")
    op.execute("DROP INDEX IF EXISTS idx_safeguarding_events_child")
    op.execute("DROP INDEX IF EXISTS idx_safeguarding_events_unack")
    op.execute("DROP INDEX IF EXISTS idx_safeguarding_events_created_at")
    op.execute("DROP TABLE IF EXISTS safeguarding_events")
