"""Insights Agent conversation tables.

Revision ID: 20260422_000022
Revises: 20260421_000021
Create Date: 2026-04-22 00:00:00.000000

Adds ``insight_conversations`` and ``insight_messages`` so the Phase 4
therapist Insights Agent can persist multi-turn chats, citations,
structured visualizations, and a concise tool trace per message.

Columns are kept minimal and vendor-neutral. Prompt/tool versioning and
latency live on the message row so every answer is auditable.
"""
from __future__ import annotations

from alembic import op


revision = "20260422_000022"
down_revision = "20260421_000021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS insight_conversations (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            workspace_id TEXT,
            scope_type TEXT NOT NULL,
            scope_child_id TEXT,
            scope_session_id TEXT,
            scope_report_id TEXT,
            title TEXT,
            prompt_version TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_insight_conversations_user_updated "
        "ON insight_conversations (user_id, updated_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_insight_conversations_scope_child "
        "ON insight_conversations (scope_child_id, updated_at DESC)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS insight_messages (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL REFERENCES insight_conversations(id) ON DELETE CASCADE,
            role TEXT NOT NULL,
            content_text TEXT NOT NULL,
            citations_json TEXT,
            visualizations_json TEXT,
            tool_trace_json TEXT,
            latency_ms INTEGER,
            tool_calls_count INTEGER,
            prompt_version TEXT,
            error_text TEXT,
            created_at TEXT NOT NULL
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_insight_messages_conversation_created "
        "ON insight_messages (conversation_id, created_at)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS insight_messages")
    op.execute("DROP TABLE IF EXISTS insight_conversations")
