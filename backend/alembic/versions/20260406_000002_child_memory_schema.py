"""Add child memory storage schema."""

from __future__ import annotations

from alembic import op

revision = "20260406_000002"
down_revision = "20260405_000001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS child_memory_items (
            id TEXT PRIMARY KEY,
            child_id TEXT NOT NULL REFERENCES children(id),
            category TEXT NOT NULL,
            memory_type TEXT NOT NULL,
            status TEXT NOT NULL,
            statement TEXT NOT NULL,
            detail_json JSONB NOT NULL,
            confidence DOUBLE PRECISION,
            provenance_json JSONB NOT NULL,
            author_type TEXT NOT NULL,
            author_user_id TEXT REFERENCES users(id),
            source_proposal_id TEXT,
            superseded_by_item_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            reviewed_at TEXT,
            expires_at TEXT
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS child_memory_proposals (
            id TEXT PRIMARY KEY,
            child_id TEXT NOT NULL REFERENCES children(id),
            category TEXT NOT NULL,
            memory_type TEXT NOT NULL,
            status TEXT NOT NULL,
            statement TEXT NOT NULL,
            detail_json JSONB NOT NULL,
            confidence DOUBLE PRECISION,
            provenance_json JSONB NOT NULL,
            author_type TEXT NOT NULL,
            author_user_id TEXT REFERENCES users(id),
            reviewer_user_id TEXT REFERENCES users(id),
            review_note TEXT,
            approved_item_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            reviewed_at TEXT
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS child_memory_evidence_links (
            id TEXT PRIMARY KEY,
            child_id TEXT NOT NULL REFERENCES children(id),
            subject_type TEXT NOT NULL,
            subject_id TEXT NOT NULL,
            session_id TEXT REFERENCES sessions(id),
            practice_plan_id TEXT REFERENCES practice_plans(id),
            evidence_kind TEXT NOT NULL,
            snippet TEXT,
            metadata_json JSONB NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS child_memory_summaries (
            child_id TEXT PRIMARY KEY REFERENCES children(id),
            summary_json JSONB NOT NULL,
            summary_text TEXT,
            source_item_count INTEGER NOT NULL DEFAULT 0,
            last_compiled_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_child_memory_items_child_status ON child_memory_items (child_id, status, updated_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_child_memory_items_child_category ON child_memory_items (child_id, category, updated_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_child_memory_proposals_child_status ON child_memory_proposals (child_id, status, created_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_child_memory_evidence_subject ON child_memory_evidence_links (subject_type, subject_id, created_at DESC)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_child_memory_evidence_subject")
    op.execute("DROP INDEX IF EXISTS idx_child_memory_proposals_child_status")
    op.execute("DROP INDEX IF EXISTS idx_child_memory_items_child_category")
    op.execute("DROP INDEX IF EXISTS idx_child_memory_items_child_status")
    op.execute("DROP TABLE IF EXISTS child_memory_summaries")
    op.execute("DROP TABLE IF EXISTS child_memory_evidence_links")
    op.execute("DROP TABLE IF EXISTS child_memory_proposals")
    op.execute("DROP TABLE IF EXISTS child_memory_items")