"""Learner Ask Wulo conversation tables.

Revision ID: 20260607_000035
Revises: 20260606_000034
Create Date: 2026-06-07 00:00:00.000000

Adds ``learner_ask_conversations`` and ``learner_ask_messages`` so the learner
"Ask Wulo Academy" assistant can persist multi-turn threads server-side and
expose a browsable, resumable history. Each conversation is scoped to a single
learner (``learner_id``); each message stores the raw user utterance or the rich
assistant block payload (``blocks_json``) so a thread re-renders faithfully.
"""

from __future__ import annotations

from alembic import op


revision = "20260607_000035"
down_revision = "20260606_000034"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS learner_ask_conversations (
            id TEXT PRIMARY KEY,
            learner_id TEXT NOT NULL,
            title TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_learner_ask_conversations_learner_updated "
        "ON learner_ask_conversations (learner_id, updated_at DESC)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS learner_ask_messages (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL REFERENCES learner_ask_conversations(id) ON DELETE CASCADE,
            role TEXT NOT NULL,
            text TEXT,
            blocks_json TEXT,
            session_complete INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_learner_ask_messages_conversation_created "
        "ON learner_ask_messages (conversation_id, created_at)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS learner_ask_messages")
    op.execute("DROP TABLE IF EXISTS learner_ask_conversations")
