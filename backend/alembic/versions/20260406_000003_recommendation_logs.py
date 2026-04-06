"""Add recommendation logging schema."""

from __future__ import annotations

from alembic import op

revision = "20260406_000003"
down_revision = "20260406_000002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS recommendation_logs (
            id TEXT PRIMARY KEY,
            child_id TEXT NOT NULL REFERENCES children(id),
            source_session_id TEXT REFERENCES sessions(id),
            target_sound TEXT NOT NULL,
            therapist_constraints_json JSONB NOT NULL,
            ranking_context_json JSONB NOT NULL,
            rationale_text TEXT NOT NULL,
            created_by_user_id TEXT REFERENCES users(id),
            candidate_count INTEGER NOT NULL DEFAULT 0,
            top_recommendation_score DOUBLE PRECISION,
            created_at TEXT NOT NULL
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS recommendation_candidates (
            id TEXT PRIMARY KEY,
            recommendation_log_id TEXT NOT NULL REFERENCES recommendation_logs(id) ON DELETE CASCADE,
            rank INTEGER NOT NULL,
            exercise_id TEXT NOT NULL,
            exercise_name TEXT NOT NULL,
            exercise_description TEXT,
            exercise_metadata_json JSONB NOT NULL,
            score DOUBLE PRECISION NOT NULL,
            ranking_factors_json JSONB NOT NULL,
            rationale_text TEXT NOT NULL,
            explanation_json JSONB NOT NULL,
            supporting_memory_item_ids_json JSONB NOT NULL,
            supporting_session_ids_json JSONB NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_recommendation_logs_child_created ON recommendation_logs (child_id, created_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_recommendation_candidates_log_rank ON recommendation_candidates (recommendation_log_id, rank ASC)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_recommendation_candidates_log_rank")
    op.execute("DROP INDEX IF EXISTS idx_recommendation_logs_child_created")
    op.execute("DROP TABLE IF EXISTS recommendation_candidates")
    op.execute("DROP TABLE IF EXISTS recommendation_logs")
