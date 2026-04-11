"""Add explicit GDPR consent fields to parental_consents.

Revision ID: 20260411_000015
Revises: 20260410_000014
Create Date: 2026-04-11 15:10:00.000000
"""

from __future__ import annotations

from alembic import op


revision = "20260411_000015"
down_revision = "20260410_000014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE parental_consents ADD COLUMN IF NOT EXISTS personal_data_consent_accepted BOOLEAN NOT NULL DEFAULT FALSE"
    )
    op.execute(
        "ALTER TABLE parental_consents ADD COLUMN IF NOT EXISTS special_category_consent_accepted BOOLEAN NOT NULL DEFAULT FALSE"
    )
    op.execute(
        "ALTER TABLE parental_consents ADD COLUMN IF NOT EXISTS parental_responsibility_confirmed BOOLEAN NOT NULL DEFAULT FALSE"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE parental_consents DROP COLUMN IF EXISTS parental_responsibility_confirmed"
    )
    op.execute(
        "ALTER TABLE parental_consents DROP COLUMN IF EXISTS special_category_consent_accepted"
    )
    op.execute(
        "ALTER TABLE parental_consents DROP COLUMN IF EXISTS personal_data_consent_accepted"
    )