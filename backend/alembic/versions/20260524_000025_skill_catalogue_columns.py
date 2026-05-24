"""Pathfinder Learn Phase 1 — Skills catalogue columns and search index.

Revision ID: 20260524_000025
Revises: 20260523_000024
Create Date: 2026-05-24 00:00:00.000000

Workstream B1. Extends ``learning_skills`` with the curriculum catalogue
attributes required by the teacher-facing skills library: hierarchy
(``parent_skill_id``), prerequisites, knowledge-component tags,
multilingual labels (``localisations_json``), lifecycle (``status``),
subject and year-group banding, and provenance.

Additive only — existing rows default to ``status='active'`` and empty
JSONB arrays so the migration is safe in the pilot environment which
already has roster data loaded.
"""

from __future__ import annotations

from alembic import op


revision = "20260524_000025"
down_revision = "20260523_000024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE learning_skills
            ADD COLUMN IF NOT EXISTS parent_skill_id TEXT
                REFERENCES learning_skills(id),
            ADD COLUMN IF NOT EXISTS prerequisites_json JSONB NOT NULL DEFAULT '[]'::jsonb,
            ADD COLUMN IF NOT EXISTS kc_tags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
            ADD COLUMN IF NOT EXISTS localisations_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            ADD COLUMN IF NOT EXISTS subject TEXT,
            ADD COLUMN IF NOT EXISTS year_group_min INTEGER,
            ADD COLUMN IF NOT EXISTS year_group_max INTEGER,
            ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'draft', 'archived')),
            ADD COLUMN IF NOT EXISTS provenance_json JSONB NOT NULL DEFAULT '[]'::jsonb
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_learning_skills_tenant_status_subject "
        "ON learning_skills (tenant_id, status, subject, updated_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_learning_skills_parent "
        "ON learning_skills (tenant_id, parent_skill_id) "
        "WHERE parent_skill_id IS NOT NULL"
    )
    # Lightweight ILIKE search index (full FTS deferred to B5 tuning).
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_learning_skills_name_trgm "
        "ON learning_skills (tenant_id, lower(name))"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_learning_skills_name_trgm")
    op.execute("DROP INDEX IF EXISTS idx_learning_skills_parent")
    op.execute("DROP INDEX IF EXISTS idx_learning_skills_tenant_status_subject")
    op.execute(
        """
        ALTER TABLE learning_skills
            DROP COLUMN IF EXISTS provenance_json,
            DROP COLUMN IF EXISTS status,
            DROP COLUMN IF EXISTS year_group_max,
            DROP COLUMN IF EXISTS year_group_min,
            DROP COLUMN IF EXISTS subject,
            DROP COLUMN IF EXISTS localisations_json,
            DROP COLUMN IF EXISTS kc_tags_json,
            DROP COLUMN IF EXISTS prerequisites_json,
            DROP COLUMN IF EXISTS parent_skill_id
        """
    )
