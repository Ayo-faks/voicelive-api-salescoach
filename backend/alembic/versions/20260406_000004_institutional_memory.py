"""Add institutional memory insight storage.

Revision ID: 20260406_000004
Revises: 20260406_000003
Create Date: 2026-04-06 16:00:00.000000
"""

from __future__ import annotations

from alembic import op


revision = "20260406_000004"
down_revision = "20260406_000003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS institutional_memory_insights (
            id TEXT PRIMARY KEY,
            insight_type TEXT NOT NULL,
            status TEXT NOT NULL,
            target_sound TEXT,
            title TEXT NOT NULL,
            summary TEXT NOT NULL,
            detail_json JSONB NOT NULL,
            provenance_json JSONB NOT NULL,
            source_child_count INTEGER NOT NULL DEFAULT 0,
            source_session_count INTEGER NOT NULL DEFAULT 0,
            source_memory_item_count INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_institutional_memory_status_target ON institutional_memory_insights (status, target_sound, updated_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_institutional_memory_type_updated ON institutional_memory_insights (insight_type, updated_at DESC)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_institutional_memory_type_updated")
    op.execute("DROP INDEX IF EXISTS idx_institutional_memory_status_target")
    op.execute("DROP TABLE IF EXISTS institutional_memory_insights")