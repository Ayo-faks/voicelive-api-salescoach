"""Initial PostgreSQL schema for Wulo storage."""

from __future__ import annotations

from alembic import op

revision = "20260405_000001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at TEXT NOT NULL
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS children (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT,
            name TEXT,
            provider TEXT,
            role TEXT NOT NULL DEFAULT 'user',
            created_at TEXT NOT NULL
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS exercises (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL,
            metadata_json JSONB NOT NULL,
            is_custom BOOLEAN NOT NULL DEFAULT FALSE,
            updated_at TEXT NOT NULL
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            child_id TEXT NOT NULL REFERENCES children(id),
            exercise_id TEXT NOT NULL REFERENCES exercises(id),
            timestamp TEXT NOT NULL,
            ai_assessment_json JSONB,
            pronunciation_json JSONB,
            exercise_metadata_json JSONB,
            transcript TEXT,
            reference_text TEXT,
            feedback_rating TEXT,
            feedback_note TEXT,
            feedback_submitted_at TEXT
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS practice_plans (
            id TEXT PRIMARY KEY,
            child_id TEXT NOT NULL REFERENCES children(id),
            source_session_id TEXT REFERENCES sessions(id),
            status TEXT NOT NULL,
            title TEXT NOT NULL,
            plan_type TEXT NOT NULL,
            constraints_json JSONB NOT NULL,
            draft_json JSONB NOT NULL,
            conversation_json JSONB NOT NULL,
            planner_session_id TEXT,
            created_by_user_id TEXT REFERENCES users(id),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            approved_at TEXT
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_sessions_child_timestamp ON sessions (child_id, timestamp DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_practice_plans_child_updated ON practice_plans (child_id, updated_at DESC, created_at DESC)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_practice_plans_child_updated")
    op.execute("DROP INDEX IF EXISTS idx_sessions_child_timestamp")
    op.execute("DROP TABLE IF EXISTS practice_plans")
    op.execute("DROP TABLE IF EXISTS sessions")
    op.execute("DROP TABLE IF EXISTS exercises")
    op.execute("DROP TABLE IF EXISTS users")
    op.execute("DROP TABLE IF EXISTS children")
    op.execute("DROP TABLE IF EXISTS app_settings")