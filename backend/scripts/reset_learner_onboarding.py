"""Reset a user's Pathfinder learner-onboarding state so the flow re-triggers.

Onboarding only runs once: the session gate flips ``needs_onboarding`` false as
soon as ``users.role`` leaves ``unassigned``, and the learner-profile gate flips
false once the required profile fields + ``terms``/``privacy`` consents exist.
This script rolls those back for a single account so you can re-test the wizard
without creating a brand-new Google/AAD identity.

Modes
-----
``full`` (default)
    Role -> ``unassigned`` AND delete the learner profile + consents. Re-test
    starts at the post-signup role picker (the complete first-run experience).
``wizard``
    Keep the existing ``learner`` role, delete only the profile + consents.
    Re-test jumps straight to the learner onboarding wizard. Use this when the
    role picker already worked and you only want to re-exercise the wizard.

The self-learner child and personal workspace are left intact:
``find_or_create_self_learner`` is idempotent, so choosing "learner" again
reuses them.

Usage
-----
    DATABASE_URL=postgres://... \
        python scripts/reset_learner_onboarding.py --email user@example.com --yes

    # Preview only, no writes:
    python scripts/reset_learner_onboarding.py --email user@example.com --dry-run

Connection string resolution order: ``--database-url`` >
``DATABASE_ADMIN_URL`` > ``DATABASE_URL``. The admin URL is preferred because
it bypasses row-level security, which is required to touch another user's rows.
"""

from __future__ import annotations

import argparse
import os
import sys
from typing import Any, Optional

import psycopg
from psycopg.rows import dict_row

ROLE_UNASSIGNED = "unassigned"
ROLE_LEARNER = "learner"


def _resolve_database_url(explicit: Optional[str]) -> str:
    candidate = (
        explicit
        or os.getenv("DATABASE_ADMIN_URL")
        or os.getenv("DATABASE_URL")
        or ""
    ).strip()
    if not candidate:
        raise SystemExit(
            "No database URL. Pass --database-url or set DATABASE_ADMIN_URL / DATABASE_URL."
        )
    return candidate


def _find_user(
    connection: psycopg.Connection[Any],
    *,
    email: Optional[str],
    user_id: Optional[str],
) -> Optional[dict[str, Any]]:
    if user_id:
        return connection.execute(
            "SELECT id, email, name, provider, role FROM users WHERE id = %s",
            (user_id,),
        ).fetchone()
    return connection.execute(
        "SELECT id, email, name, provider, role FROM users WHERE LOWER(email) = LOWER(%s)",
        (email,),
    ).fetchone()


def _summarise_state(connection: psycopg.Connection[Any], user_id: str) -> dict[str, Any]:
    profile = connection.execute(
        "SELECT user_id, display_name, exam, year_group, age_band, locale FROM learner_profiles WHERE user_id = %s",
        (user_id,),
    ).fetchone()
    consents = connection.execute(
        "SELECT DISTINCT ON (kind) kind, granted FROM user_consents WHERE user_id = %s ORDER BY kind, created_at DESC",
        (user_id,),
    ).fetchall()
    return {"profile": profile, "consents": consents}


def reset_onboarding(
    database_url: str,
    *,
    email: Optional[str],
    user_id: Optional[str],
    mode: str,
    dry_run: bool,
) -> int:
    with psycopg.connect(database_url, row_factory=dict_row, autocommit=False) as connection:
        user = _find_user(connection, email=email, user_id=user_id)
        if user is None:
            target = user_id or email
            print(f"No user found for {target!r}.", file=sys.stderr)
            return 1

        uid = str(user["id"])
        before = _summarise_state(connection, uid)
        print("User:")
        print(f"  id       = {uid}")
        print(f"  email    = {user.get('email')}")
        print(f"  name     = {user.get('name')}")
        print(f"  provider = {user.get('provider')}")
        print(f"  role     = {user.get('role')}")
        print("Current onboarding state:")
        print(f"  learner_profile = {'present' if before['profile'] else 'none'}")
        granted = sorted(
            str(c["kind"]) for c in before["consents"] if c.get("granted")
        )
        print(f"  consents granted = {granted or 'none'}")

        if dry_run:
            print()
            print(f"[dry-run] mode={mode}: would")
            if mode == "full":
                print(f"  - set users.role -> {ROLE_UNASSIGNED}")
            print(f"  - delete learner_profiles row for {uid}")
            print(f"  - delete user_consents rows for {uid}")
            print("No changes written (dry-run).")
            connection.rollback()
            return 0

        consents_deleted = connection.execute(
            "DELETE FROM user_consents WHERE user_id = %s",
            (uid,),
        ).rowcount
        profile_deleted = connection.execute(
            "DELETE FROM learner_profiles WHERE user_id = %s",
            (uid,),
        ).rowcount
        role_changed = 0
        if mode == "full":
            role_changed = connection.execute(
                "UPDATE users SET role = %s WHERE id = %s",
                (ROLE_UNASSIGNED, uid),
            ).rowcount

        connection.commit()

        print()
        print(f"Reset complete (mode={mode}):")
        print(f"  consents deleted = {consents_deleted}")
        print(f"  profile deleted  = {profile_deleted}")
        if mode == "full":
            print(f"  role set to '{ROLE_UNASSIGNED}' = {bool(role_changed)}")
            print("  -> next login starts at the role picker.")
        else:
            print(f"  role kept as '{user.get('role')}'.")
            print("  -> next login goes straight to the learner onboarding wizard.")
        return 0


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--email", help="Email of the account to reset (case-insensitive).")
    target.add_argument("--user-id", help="User id of the account to reset.")
    parser.add_argument(
        "--mode",
        choices=("full", "wizard"),
        default="full",
        help="full: role->unassigned + clear profile/consents (role picker). "
        "wizard: keep learner role, clear profile/consents (wizard only).",
    )
    parser.add_argument(
        "--database-url",
        help="Postgres URL. Defaults to DATABASE_ADMIN_URL or DATABASE_URL.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would change without writing.",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Skip the interactive confirmation prompt.",
    )
    args = parser.parse_args(argv)

    database_url = _resolve_database_url(args.database_url)

    if not args.dry_run and not args.yes:
        who = args.user_id or args.email
        answer = input(f"Reset onboarding (mode={args.mode}) for {who!r}? [y/N] ").strip().lower()
        if answer not in {"y", "yes"}:
            print("Aborted.")
            return 130

    return reset_onboarding(
        database_url,
        email=args.email,
        user_id=args.user_id,
        mode=args.mode,
        dry_run=args.dry_run,
    )


if __name__ == "__main__":
    raise SystemExit(main())
