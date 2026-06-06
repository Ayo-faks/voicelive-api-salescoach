"""Verify Pathfinder Learn Postgres schema, GUCs, and RLS isolation."""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping, Optional, Sequence
from uuid import uuid4

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from src.learning.repository import LEARNING_RLS_PROTECTED_TABLES  # noqa: E402
from src.services.storage_postgres import PostgresStorageService  # noqa: E402


EXPECTED_ALEMBIC_HEADS = ("20260606_000034",)
REQUIRED_COLUMNS = {
    "learning_intervention_plans": ("parent_plan_id",),
    "learning_skills": (
        "parent_skill_id",
        "prerequisites_json",
        "kc_tags_json",
        "localisations_json",
        "subject",
        "year_group_min",
        "year_group_max",
        "status",
        "provenance_json",
    ),
}


@dataclass(frozen=True)
class VerificationCheck:
    name: str
    ok: bool
    detail: str


@dataclass(frozen=True)
class VerificationReport:
    ok: bool
    checks: list[VerificationCheck]
    mutation_checked: bool

    def as_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["checks"] = [asdict(check) for check in self.checks]
        return payload


def verify_learning_postgres_rls(
    database_url: str,
    *,
    skip_mutation: bool = False,
) -> VerificationReport:
    checks: list[VerificationCheck] = []
    with psycopg.connect(database_url, row_factory=dict_row) as connection:
        checks.append(assess_alembic_heads(_fetch_alembic_versions(connection)))
        checks.append(assess_table_rls(_fetch_table_rls(connection), LEARNING_RLS_PROTECTED_TABLES))
        checks.append(assess_policy_coverage(_fetch_policies(connection), LEARNING_RLS_PROTECTED_TABLES))
        checks.append(assess_required_columns(_fetch_columns(connection), REQUIRED_COLUMNS))

    checks.append(verify_storage_guc_path(database_url))
    if not skip_mutation:
        checks.append(verify_intervention_plan_tenant_isolation(database_url))

    return VerificationReport(
        ok=all(check.ok for check in checks),
        checks=checks,
        mutation_checked=not skip_mutation,
    )


def assess_alembic_heads(rows: Iterable[Mapping[str, Any]]) -> VerificationCheck:
    versions = {str(row["version_num"]) for row in rows}
    missing = sorted(set(EXPECTED_ALEMBIC_HEADS).difference(versions))
    return VerificationCheck(
        name="alembic_head",
        ok=not missing,
        detail="heads=" + ",".join(sorted(versions)) if not missing else "missing=" + ",".join(missing),
    )


def assess_table_rls(
    rows: Iterable[Mapping[str, Any]],
    expected_tables: Sequence[str],
) -> VerificationCheck:
    by_table = {str(row["table_name"]): row for row in rows}
    missing = sorted(set(expected_tables).difference(by_table))
    not_forced = sorted(
        table
        for table, row in by_table.items()
        if table in expected_tables and not (bool(row["rls_enabled"]) and bool(row["rls_forced"]))
    )
    ok = not missing and not not_forced
    details = []
    if missing:
        details.append("missing=" + ",".join(missing))
    if not_forced:
        details.append("not_forced=" + ",".join(not_forced))
    if not details:
        details.append(f"forced_tables={len(expected_tables)}")
    return VerificationCheck(name="forced_rls", ok=ok, detail=";".join(details))


def assess_policy_coverage(
    rows: Iterable[Mapping[str, Any]],
    expected_tables: Sequence[str],
) -> VerificationCheck:
    policy_text_by_table: dict[str, list[str]] = {table: [] for table in expected_tables}
    for row in rows:
        table = str(row["table_name"])
        if table not in policy_text_by_table:
            continue
        policy_text_by_table[table].append(
            " ".join(str(row.get(key) or "") for key in ("policy_name", "qual", "with_check"))
        )

    missing_policy = sorted(table for table, texts in policy_text_by_table.items() if not texts)
    missing_tenant_guard = sorted(
        table
        for table, texts in policy_text_by_table.items()
        if texts and not any("app.tenant_id" in text and "app.system_bypass_rls" in text for text in texts)
    )
    ok = not missing_policy and not missing_tenant_guard
    details = []
    if missing_policy:
        details.append("missing_policy=" + ",".join(missing_policy))
    if missing_tenant_guard:
        details.append("missing_tenant_guard=" + ",".join(missing_tenant_guard))
    if not details:
        details.append(f"covered_tables={len(expected_tables)}")
    return VerificationCheck(name="tenant_policy_coverage", ok=ok, detail=";".join(details))


def assess_required_columns(
    rows: Iterable[Mapping[str, Any]],
    required_columns: Mapping[str, Sequence[str]],
) -> VerificationCheck:
    available = {(str(row["table_name"]), str(row["column_name"])) for row in rows}
    missing = sorted(
        f"{table}.{column}"
        for table, columns in required_columns.items()
        for column in columns
        if (table, column) not in available
    )
    return VerificationCheck(
        name="learning_new_columns",
        ok=not missing,
        detail="ok" if not missing else "missing=" + ",".join(missing),
    )


def verify_storage_guc_path(database_url: str) -> VerificationCheck:
    storage = PostgresStorageService(database_url, allow_system_bypass=True)
    storage.set_request_actor(
        user_id="rls-verifier-user",
        role="teacher",
        email="rls-verifier@example.invalid",
        tenant_id="tenant-rls-verifier",
        class_id="class-rls-verifier",
    )
    try:
        result: dict[str, Any] = {}

        def fetch(connection: Any) -> None:
            result.update(
                dict(
                    connection.execute(
                        """
                        SELECT
                            current_setting('app.user_id', true) AS user_id,
                            current_setting('app.role', true) AS role,
                            current_setting('app.tenant_id', true) AS tenant_id,
                            current_setting('app.class_id', true) AS class_id,
                            current_setting('app.system_bypass_rls', true) AS system_bypass
                        """
                    ).fetchone()
                )
            )

        storage._execute_write(fetch)
    finally:
        storage.clear_request_actor()

    expected = {
        "user_id": "rls-verifier-user",
        "role": "teacher",
        "tenant_id": "tenant-rls-verifier",
        "class_id": "class-rls-verifier",
        "system_bypass": "off",
    }
    mismatched = sorted(key for key, value in expected.items() if result.get(key) != value)
    return VerificationCheck(
        name="storage_guc_path",
        ok=not mismatched,
        detail="ok" if not mismatched else "mismatched=" + ",".join(mismatched),
    )


def verify_intervention_plan_tenant_isolation(database_url: str) -> VerificationCheck:
    tenant_a = f"tenant-rls-a-{uuid4().hex[:8]}"
    tenant_b = f"tenant-rls-b-{uuid4().hex[:8]}"
    plan_a = f"rls-plan-a-{uuid4().hex[:12]}"
    plan_b = f"rls-plan-b-{uuid4().hex[:12]}"
    bad_plan = f"rls-plan-denied-{uuid4().hex[:12]}"
    connection = psycopg.connect(database_url, row_factory=dict_row)
    try:
        _set_rls_gucs(connection, tenant_a)
        _insert_plan(connection, plan_a, tenant_a)

        denied_cross_tenant_insert = False
        connection.execute("SAVEPOINT rls_bad_insert")
        try:
            _insert_plan(connection, bad_plan, tenant_b)
        except Exception:
            denied_cross_tenant_insert = True
            connection.execute("ROLLBACK TO SAVEPOINT rls_bad_insert")
        else:
            connection.execute("ROLLBACK TO SAVEPOINT rls_bad_insert")

        _set_rls_gucs(connection, tenant_b)
        visible_a_from_b = int(
            connection.execute(
                "SELECT count(*) AS total FROM learning_intervention_plans WHERE id = %s",
                (plan_a,),
            ).fetchone()["total"]
        )
        _insert_plan(connection, plan_b, tenant_b)

        _set_rls_gucs(connection, tenant_a)
        visible_rows = connection.execute(
            """
            SELECT id, tenant_id
            FROM learning_intervention_plans
            WHERE id IN (%s, %s)
            ORDER BY id
            """,
            (plan_a, plan_b),
        ).fetchall()
        visible_ids = {str(row["id"]) for row in visible_rows}
        ok = denied_cross_tenant_insert and visible_a_from_b == 0 and visible_ids == {plan_a}
        detail = (
            "ok"
            if ok
            else (
                f"denied_insert={denied_cross_tenant_insert};"
                f"visible_a_from_b={visible_a_from_b};visible_ids={sorted(visible_ids)}"
            )
        )
        return VerificationCheck(name="intervention_plan_tenant_isolation", ok=ok, detail=detail)
    finally:
        connection.rollback()
        connection.close()


def _fetch_alembic_versions(connection: Any) -> list[Mapping[str, Any]]:
    return list(connection.execute("SELECT version_num FROM alembic_version").fetchall())


def _fetch_table_rls(connection: Any) -> list[Mapping[str, Any]]:
    return list(
        connection.execute(
            """
            SELECT
                c.relname AS table_name,
                c.relrowsecurity AS rls_enabled,
                c.relforcerowsecurity AS rls_forced
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = current_schema()
              AND c.relkind = 'r'
              AND c.relname = ANY(%s::text[])
            """,
            (list(LEARNING_RLS_PROTECTED_TABLES),),
        ).fetchall()
    )


def _fetch_policies(connection: Any) -> list[Mapping[str, Any]]:
    return list(
        connection.execute(
            """
            SELECT
                tablename AS table_name,
                policyname AS policy_name,
                qual,
                with_check
            FROM pg_policies
            WHERE schemaname = current_schema()
              AND tablename = ANY(%s::text[])
            """,
            (list(LEARNING_RLS_PROTECTED_TABLES),),
        ).fetchall()
    )


def _fetch_columns(connection: Any) -> list[Mapping[str, Any]]:
    return list(
        connection.execute(
            """
            SELECT table_name, column_name
            FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = ANY(%s::text[])
            """,
            (list(REQUIRED_COLUMNS),),
        ).fetchall()
    )


def _set_rls_gucs(connection: Any, tenant_id: str) -> None:
    connection.execute(
        """
        SELECT
            set_config('app.current_user_id', %s, false),
            set_config('app.current_user_role', %s, false),
            set_config('app.current_user_email', %s, false),
            set_config('app.user_id', %s, false),
            set_config('app.role', %s, false),
            set_config('app.tenant_id', %s, false),
            set_config('app.class_id', %s, false),
            set_config('app.system_bypass_rls', %s, false)
        """,
        (
            "rls-verifier-user",
            "teacher",
            "rls-verifier@example.invalid",
            "rls-verifier-user",
            "teacher",
            tenant_id,
            "class-rls-verifier",
            "off",
        ),
    )


def _insert_plan(connection: Any, plan_id: str, tenant_id: str) -> None:
    now = datetime.now(timezone.utc).isoformat()
    connection.execute(
        """
        INSERT INTO learning_intervention_plans (
            id, tenant_id, created_by_user_id, status, plan_json,
            lang, provenance_json, created_at, updated_at, parent_plan_id
        )
        VALUES (%s, %s, %s, 'pending', %s, 'en-NG', %s, %s, %s, NULL)
        """,
        (
            plan_id,
            tenant_id,
            "rls-verifier-user",
            Jsonb({"plan_id": plan_id, "target_skill_ids": ["rls-skill"], "target_student_ids": ["rls-student"]}),
            Jsonb([{"source": "verify_learning_postgres_rls", "confidence": 1.0, "evidence_count": 1}]),
            now,
            now,
        ),
    )


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL"), help="Postgres DATABASE_URL.")
    parser.add_argument(
        "--skip-mutation",
        action="store_true",
        help="Skip the rollback-only tenant isolation insert/select probe.",
    )
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON output.")
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    if not args.database_url:
        print("DATABASE_URL is required for live Postgres/RLS verification", file=sys.stderr)
        return 2
    report = verify_learning_postgres_rls(args.database_url, skip_mutation=args.skip_mutation)
    if args.json:
        print(json.dumps(report.as_dict(), sort_keys=True))
    else:
        for check in report.checks:
            status = "PASS" if check.ok else "FAIL"
            print(f"[{status}] {check.name}: {check.detail}")
        print(f"overall={'PASS' if report.ok else 'FAIL'}")
    return 0 if report.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())