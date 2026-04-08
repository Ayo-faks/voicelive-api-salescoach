#!/usr/bin/env python3
"""Enforce data retention policy by soft-deleting stale child profiles.

Identifies children whose most recent session ended more than RETENTION_MONTHS
ago (default: 6) and soft-deletes them.  Children already soft-deleted longer
than PURGE_GRACE_MONTHS ago (default: 1) are hard-deleted via delete_child_data.

Usage:
    # Dry-run (default) — show what would be deleted
    python scripts/enforce_retention.py

    # Actually apply
    python scripts/enforce_retention.py --apply

    # Custom retention period
    python scripts/enforce_retention.py --retention-months 12 --apply

Environment:
    DATABASE_URL or STORAGE_PATH must be set (same as the app).
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Allow importing from backend/src
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from src.config import config as app_config  # noqa: E402
from src.services.storage_factory import create_storage_service  # noqa: E402


def _utcnow() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def main() -> None:
    parser = argparse.ArgumentParser(description="Enforce data retention policy")
    parser.add_argument(
        "--retention-months",
        type=int,
        default=int(app_config.get("data_retention_months", 6)),
        help="Months of inactivity before soft-delete (default: 6)",
    )
    parser.add_argument(
        "--purge-grace-months",
        type=int,
        default=1,
        help="Months after soft-delete before hard-delete (default: 1)",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually apply changes (default is dry-run)",
    )
    args = parser.parse_args()

    storage = create_storage_service(app_config)
    now = datetime.now(timezone.utc)
    retention_cutoff = (now - timedelta(days=args.retention_months * 30)).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )
    purge_cutoff = (now - timedelta(days=args.purge_grace_months * 30)).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )

    mode = "APPLY" if args.apply else "DRY-RUN"
    print(f"[{mode}] Retention policy: {args.retention_months} months")
    print(f"[{mode}] Purge grace period: {args.purge_grace_months} months")
    print(f"[{mode}] Retention cutoff: {retention_cutoff}")
    print(f"[{mode}] Purge cutoff: {purge_cutoff}")
    print()

    # --- Phase 1: Soft-delete stale active children ---
    conn_ctx = storage._connect()
    with conn_ctx as conn:
        placeholder = "%s" if hasattr(storage, "_pool") else "?"

        # Find active children whose latest session is older than cutoff
        stale_query = f"""
            SELECT c.id, c.name,
                   MAX(s.timestamp) AS last_activity
            FROM children c
            LEFT JOIN sessions s ON s.child_id = c.id
            WHERE c.deleted_at IS NULL
            GROUP BY c.id, c.name
            HAVING MAX(s.timestamp) < {placeholder}
               OR MAX(s.timestamp) IS NULL
        """
        cursor = conn.execute(stale_query, (retention_cutoff,))
        stale_children = cursor.fetchall()

        if stale_children:
            print(f"Phase 1: {len(stale_children)} child profile(s) to soft-delete:")
            for row in stale_children:
                child_id = row["id"] if isinstance(row, dict) else row[0]
                child_name = row["name"] if isinstance(row, dict) else row[1]
                last = row["last_activity"] if isinstance(row, dict) else row[2]
                print(f"  - {child_name} ({child_id}) last activity: {last or 'never'}")

                if args.apply:
                    conn.execute(
                        f"UPDATE children SET deleted_at = {placeholder} WHERE id = {placeholder}",
                        (_utcnow(), child_id),
                    )
            if args.apply:
                print(f"  -> Soft-deleted {len(stale_children)} child profile(s).")
        else:
            print("Phase 1: No stale child profiles found.")

        print()

        # --- Phase 2: Hard-delete children soft-deleted past grace period ---
        purge_query = f"""
            SELECT id, name, deleted_at
            FROM children
            WHERE deleted_at IS NOT NULL
              AND deleted_at < {placeholder}
        """
        cursor = conn.execute(purge_query, (purge_cutoff,))
        purgeable = cursor.fetchall()

    if purgeable:
        print(f"Phase 2: {len(purgeable)} child profile(s) to hard-delete (past grace period):")
        for row in purgeable:
            child_id = row["id"] if isinstance(row, dict) else row[0]
            child_name = row["name"] if isinstance(row, dict) else row[1]
            deleted_at = row["deleted_at"] if isinstance(row, dict) else row[2]
            print(f"  - {child_name} ({child_id}) soft-deleted: {deleted_at}")

            if args.apply:
                storage.delete_child_data(child_id)
        if args.apply:
            print(f"  -> Hard-deleted {len(purgeable)} child profile(s) and all associated data.")
    else:
        print("Phase 2: No child profiles past purge grace period.")

    print()
    if not args.apply:
        print("This was a dry-run. Pass --apply to execute.")


if __name__ == "__main__":
    main()
