#!/usr/bin/env python3
"""Deploy-time gate that proves Postgres RLS is active.

Used as an `azd postdeploy` hook. Connects to ``DATABASE_URL`` (or the
explicit ``--database-url`` argument), runs the same RLS check as
:func:`src.services.storage_postgres.assert_postgres_rls_active` against
:data:`src.services.storage_postgres.RLS_PROTECTED_TABLES`, and exits
non-zero with a clear message on any failure so the deployment does not
mark the new revision as healthy.

Usage:

    DATABASE_URL=postgresql://... python scripts/verify_postgres_rls.py

The script intentionally takes no destructive actions and is safe to
re-run. It does **not** require psycopg's ``dict_row`` adapter; the
shared gate function tolerates tuple cursors, so it can run on a stock
``psycopg.connect``.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Optional


def _add_backend_src_to_path() -> None:
    """Allow running as a standalone script (without `pip install -e`)."""
    repo_root = Path(__file__).resolve().parent.parent
    backend_src = repo_root / "backend"
    if str(backend_src) not in sys.path:
        sys.path.insert(0, str(backend_src))


def _resolve_database_url(cli_value: Optional[str]) -> str:
    if cli_value:
        return cli_value.strip()
    for env_var in ("DATABASE_URL", "POSTGRES_DATABASE_URL"):
        value = os.environ.get(env_var, "").strip()
        if value:
            return value
    raise SystemExit(
        "verify_postgres_rls: no database URL configured. "
        "Set DATABASE_URL or pass --database-url."
    )


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Verify Postgres RLS is active for every protected table."
    )
    parser.add_argument(
        "--database-url",
        default=None,
        help="Postgres connection string. Defaults to $DATABASE_URL.",
    )
    parser.add_argument(
        "--max-wait-seconds",
        type=int,
        default=int(os.environ.get("VERIFY_POSTGRES_RLS_MAX_WAIT_SECONDS", "180")),
        help=(
            "Maximum time to wait for the schema and RLS to become ready before "
            "failing. Allows alembic migrations triggered by the new container "
            "revision (DATABASE_RUN_MIGRATIONS_ON_STARTUP=true) to finish. "
            "Default 180s."
        ),
    )
    parser.add_argument(
        "--retry-interval-seconds",
        type=int,
        default=int(os.environ.get("VERIFY_POSTGRES_RLS_RETRY_INTERVAL_SECONDS", "10")),
        help="Seconds between retries while waiting. Default 10s.",
    )
    args = parser.parse_args(argv)

    database_url = _resolve_database_url(args.database_url)

    _add_backend_src_to_path()
    try:
        import psycopg  # type: ignore[import-not-found]
        from src.services.storage_postgres import (  # type: ignore[import-not-found]
            RLS_PROTECTED_TABLES,
            PostgresRlsGateError,
            assert_postgres_rls_active,
        )
    except ImportError as exc:
        print(
            f"verify_postgres_rls: missing required Python package ({exc}). "
            "Run from the backend's Python environment.",
            file=sys.stderr,
        )
        return 2

    print(
        f"verify_postgres_rls: checking RLS on {len(RLS_PROTECTED_TABLES)} table(s)...",
        flush=True,
    )

    import time

    deadline = time.monotonic() + max(0, args.max_wait_seconds)
    interval = max(1, args.retry_interval_seconds)
    attempt = 0
    last_failure: Optional[str] = None

    while True:
        attempt += 1
        try:
            with psycopg.connect(database_url) as connection:
                # System-bypass so the gate query itself isn't blocked by RLS
                # policies that depend on app.current_user_id.
                connection.execute(
                    "SELECT set_config('app.system_bypass_rls', 'on', false)"
                )
                assert_postgres_rls_active(connection)
            break
        except PostgresRlsGateError as exc:
            last_failure = str(exc)
            transient = True
        except Exception as exc:  # noqa: BLE001
            last_failure = f"could not run RLS gate query: {exc}"
            transient = True

        remaining = deadline - time.monotonic()
        if remaining <= 0:
            print(
                f"verify_postgres_rls: FAIL: {last_failure} "
                f"(after {attempt} attempt(s) over ~{args.max_wait_seconds}s)",
                file=sys.stderr,
            )
            return 1
        print(
            f"verify_postgres_rls: not ready yet (attempt {attempt}); "
            f"retrying in {interval}s. Detail: {last_failure}",
            file=sys.stderr,
            flush=True,
        )
        time.sleep(min(interval, max(1, remaining)))

    print("verify_postgres_rls: OK", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
