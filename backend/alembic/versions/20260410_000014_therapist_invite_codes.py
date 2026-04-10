"""Add therapist_invite_codes table

Revision ID: 20260410_000014
Revises: 20260409_000013
Create Date: 2026-04-10
"""

from alembic import op
import sqlalchemy as sa

revision = "20260410_000014"
down_revision = "20260409_000013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "therapist_invite_codes",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("code", sa.Text, nullable=False, unique=True),
        sa.Column("created_by", sa.Text, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("used_by", sa.Text, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("used_at", sa.Text, nullable=True),
        sa.Column("created_at", sa.Text, nullable=False),
    )


def downgrade() -> None:
    op.drop_table("therapist_invite_codes")
