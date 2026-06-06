from __future__ import annotations

from scripts.verify_learning_postgres_rls import (
    EXPECTED_ALEMBIC_HEADS,
    REQUIRED_COLUMNS,
    assess_alembic_heads,
    assess_policy_coverage,
    assess_required_columns,
    assess_table_rls,
)
from src.learning.repository import LEARNING_RLS_PROTECTED_TABLES


def test_assess_table_rls_requires_every_learning_table_forced() -> None:
    rows = [
        {"table_name": table, "rls_enabled": True, "rls_forced": True}
        for table in LEARNING_RLS_PROTECTED_TABLES
    ]

    check = assess_table_rls(rows, LEARNING_RLS_PROTECTED_TABLES)

    assert check.ok is True
    assert check.detail == f"forced_tables={len(LEARNING_RLS_PROTECTED_TABLES)}"


def test_assess_table_rls_reports_missing_and_not_forced_tables() -> None:
    rows = [
        {"table_name": "learning_classes", "rls_enabled": True, "rls_forced": False},
    ]

    check = assess_table_rls(rows, ("learning_classes", "learning_students"))

    assert check.ok is False
    assert "missing=learning_students" in check.detail
    assert "not_forced=learning_classes" in check.detail


def test_assess_policy_coverage_requires_tenant_and_bypass_guards() -> None:
    rows = [
        {
            "table_name": table,
            "policy_name": f"{table}_tenant_policy",
            "qual": "tenant_id = current_setting('app.tenant_id', true) OR current_setting('app.system_bypass_rls', true) = 'on'",
            "with_check": "tenant_id = current_setting('app.tenant_id', true) OR current_setting('app.system_bypass_rls', true) = 'on'",
        }
        for table in LEARNING_RLS_PROTECTED_TABLES
    ]

    check = assess_policy_coverage(rows, LEARNING_RLS_PROTECTED_TABLES)

    assert check.ok is True
    assert check.detail == f"covered_tables={len(LEARNING_RLS_PROTECTED_TABLES)}"


def test_assess_policy_coverage_reports_missing_guards() -> None:
    rows = [
        {
            "table_name": "learning_classes",
            "policy_name": "learning_classes_policy",
            "qual": "tenant_id IS NOT NULL",
            "with_check": "tenant_id IS NOT NULL",
        }
    ]

    check = assess_policy_coverage(rows, ("learning_classes", "learning_students"))

    assert check.ok is False
    assert "missing_policy=learning_students" in check.detail
    assert "missing_tenant_guard=learning_classes" in check.detail


def test_assess_required_columns_covers_recent_learning_migrations() -> None:
    rows = [
        {"table_name": table, "column_name": column}
        for table, columns in REQUIRED_COLUMNS.items()
        for column in columns
    ]

    check = assess_required_columns(rows, REQUIRED_COLUMNS)

    assert check.ok is True
    assert check.detail == "ok"


def test_assess_alembic_heads_requires_latest_learning_head() -> None:
    latest_head = EXPECTED_ALEMBIC_HEADS[-1]
    ok = assess_alembic_heads([{"version_num": latest_head}])
    missing = assess_alembic_heads([{"version_num": "20260523_000024"}])

    assert ok.ok is True
    assert missing.ok is False
    assert latest_head in missing.detail