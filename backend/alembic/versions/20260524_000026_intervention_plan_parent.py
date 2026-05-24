"""Pathfinder Learn Phase 1 — Intervention plan parent_plan_id.

Revision ID: 20260524_000026
Revises: 20260524_000025
Create Date: 2026-05-24 00:00:00.000000

Workstream A5. Adds ``parent_plan_id`` to ``learning_intervention_plans`` so
edited-and-approved plans link back to the original draft, preserving the
full HITL audit trail (original draft → teacher edits → approved variant).

Additive only — existing rows have NULL ``parent_plan_id`` and behave as
top-level (un-edited) plans.
"""

from __future__ import annotations

from alembic import op


revision = "20260524_000026"
down_revision = "20260524_000025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE learning_intervention_plans
            ADD COLUMN IF NOT EXISTS parent_plan_id TEXT
                REFERENCES learning_intervention_plans(id)
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_learning_intervention_plans_parent "
        "ON learning_intervention_plans (tenant_id, parent_plan_id) "
        "WHERE parent_plan_id IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_learning_intervention_plans_parent")
    op.execute(
        "ALTER TABLE learning_intervention_plans "
        "DROP COLUMN IF EXISTS parent_plan_id"
    )
