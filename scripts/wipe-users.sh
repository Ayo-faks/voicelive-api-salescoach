#!/usr/bin/env bash
# Wipe all users + user-generated rows from a wulo database.
# Preserves seed children (child-ayo/noah/zuri) and ALL seeded/reference content.
#
# Usage:
#   scripts/wipe-users.sh --env local|staging|prod [--dry-run] [--yes] [--no-backup]
#
# Prod requires typing "WIPE PROD" to confirm.
# Staging and prod take a pg_dump backup to ./backups/ before wiping (unless --no-backup).

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SQL_PG="$REPO_DIR/backend/scripts/wipe_users.sql"
SQL_SQLITE="$REPO_DIR/backend/scripts/wipe_users_sqlite.sql"
BACKUP_DIR="$REPO_DIR/backups"

ENV=""
DRY_RUN=0
ASSUME_YES=0
DO_BACKUP=1

usage() {
  sed -n '1,12p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)        ENV="${2:-}"; shift 2;;
    --dry-run)    DRY_RUN=1; shift;;
    --yes)        ASSUME_YES=1; shift;;
    --no-backup)  DO_BACKUP=0; shift;;
    -h|--help)    usage;;
    *) echo "Unknown arg: $1" >&2; usage;;
  esac
done

case "$ENV" in
  local|staging|prod) ;;
  *) echo "ERROR: --env must be local|staging|prod" >&2; exit 2;;
esac

azd_env_for() {
  case "$1" in
    staging) echo "salescoach-swe";;
    prod)    echo "salescoach-prod";;
  esac
}

confirm() {
  local prompt="$1" required="${2:-}"
  if [[ $ASSUME_YES -eq 1 && -z "$required" ]]; then
    return 0
  fi
  if [[ -n "$required" ]]; then
    read -r -p "$prompt " reply
    [[ "$reply" == "$required" ]] || { echo "Aborted." >&2; exit 1; }
  else
    read -r -p "$prompt [y/N] " reply
    [[ "$reply" =~ ^[Yy]$ ]] || { echo "Aborted." >&2; exit 1; }
  fi
}

_pysqlite() {
  # $1 = db path, stdin = SQL or "COUNTS" sentinel handled in caller via inline -c
  local db="$1"; shift
  if command -v python3 >/dev/null; then PY=python3
  elif [[ -x /home/ayoola/sen/.venv/bin/python ]]; then PY=/home/ayoola/sen/.venv/bin/python
  else echo "no python interpreter found" >&2; exit 3; fi
  "$PY" - "$db" "$@"
}

wipe_local() {
  local db="$REPO_DIR/data/wulo.db"
  if [[ ! -f "$db" ]]; then
    echo "Local DB not found at $db — nothing to wipe."
    exit 0
  fi
  echo "Target: local SQLite at $db"

  local PY
  if command -v python3 >/dev/null; then PY=python3
  elif [[ -x /home/ayoola/sen/.venv/bin/python ]]; then PY=/home/ayoola/sen/.venv/bin/python
  else echo "no python interpreter for sqlite3 module" >&2; exit 3; fi

  echo
  echo "Pre-wipe counts:"
  "$PY" - "$db" <<'PY'
import sqlite3, sys
con = sqlite3.connect(sys.argv[1])
for t in ("users","children","sessions"):
    print(f"  {t:12} {con.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0]}")
PY
  echo

  if [[ $DRY_RUN -eq 1 ]]; then
    echo "[dry-run] would execute $SQL_SQLITE against $db (against a copy)"
    cp "$db" "/tmp/wulo.dryrun.db"
    "$PY" - "/tmp/wulo.dryrun.db" "$SQL_SQLITE" <<'PY'
import sqlite3, sys, pathlib
db, sql_path = sys.argv[1], sys.argv[2]
con = sqlite3.connect(db); con.execute("PRAGMA foreign_keys = ON")
con.executescript(pathlib.Path(sql_path).read_text())
print("[dry-run] would-be post counts:")
for t in ("users","children","sessions","exercises"):
    print(f"  {t:12} {con.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0]}")
PY
    rm -f /tmp/wulo.dryrun.db
    exit 0
  fi

  confirm "Wipe all users from LOCAL SQLite at $db ?"

  if [[ $DO_BACKUP -eq 1 ]]; then
    mkdir -p "$BACKUP_DIR"
    local snap="$BACKUP_DIR/wulo.local.$(date -u +%Y%m%dT%H%M%SZ).db"
    cp "$db" "$snap"
    echo "Backup written: $snap"
  fi

  "$PY" - "$db" "$SQL_SQLITE" <<'PY'
import sqlite3, sys, pathlib
db, sql_path = sys.argv[1], sys.argv[2]
con = sqlite3.connect(db); con.execute("PRAGMA foreign_keys = ON")
con.executescript(pathlib.Path(sql_path).read_text())
con.commit(); con.close()
print("Wipe executed.")
PY

  echo
  echo "Post-wipe verification:"
  "$PY" - "$db" <<'PY'
import sqlite3, sys
con = sqlite3.connect(sys.argv[1])
for t in ("users","children","sessions","exercises","listening_eval_items","listening_eval_rewards","app_settings","audit_log","insight_conversations","therapist_workspaces"):
    try:
        n = con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        print(f"  {t:30} {n}")
    except Exception:
        pass
print("Children remaining:")
for r in con.execute("SELECT id, name FROM children ORDER BY id").fetchall():
    print(" ", r)
PY
}

wipe_pg() {
  local azd_env; azd_env="$(azd_env_for "$ENV")"
  echo "Loading azd env: $azd_env"
  # shellcheck disable=SC2046
  eval "$(azd env get-values -e "$azd_env" | grep -E '^(POSTGRES_SERVER_FQDN|POSTGRES_ADMIN_USERNAME|POSTGRES_ADMIN_PASSWORD|POSTGRES_DATABASE_NAME|AZURE_RESOURCE_GROUP)=' | sed 's/^/export /')"

  # azd env occasionally stores the password with a literal backslash escape (e.g. TempPsql\!2026); strip it for psql.
  POSTGRES_ADMIN_PASSWORD="${POSTGRES_ADMIN_PASSWORD//\\!/!}"

  : "${POSTGRES_SERVER_FQDN:?missing in azd env}"
  : "${POSTGRES_ADMIN_USERNAME:?missing in azd env}"
  : "${POSTGRES_DATABASE_NAME:?missing in azd env}"
  if [[ -z "${POSTGRES_ADMIN_PASSWORD:-}" ]]; then
    read -r -s -p "Postgres admin password for $POSTGRES_ADMIN_USERNAME@$POSTGRES_SERVER_FQDN: " POSTGRES_ADMIN_PASSWORD
    echo
  fi

  echo
  echo "Target host:     $POSTGRES_SERVER_FQDN"
  echo "Target database: $POSTGRES_DATABASE_NAME"
  echo "Target env:      $ENV ($azd_env)"
  echo

  command -v psql >/dev/null || { echo "psql not installed" >&2; exit 3; }

  PG_CONN=(--host "$POSTGRES_SERVER_FQDN" --username "$POSTGRES_ADMIN_USERNAME" --dbname "$POSTGRES_DATABASE_NAME" --port 5432)
  export PGPASSWORD="$POSTGRES_ADMIN_PASSWORD"
  export PGSSLMODE="${PGSSLMODE:-require}"

  echo "Pre-wipe counts:"
  psql -v ON_ERROR_STOP=1 "${PG_CONN[@]}" -c "SELECT 'users' AS t, COUNT(*) FROM users UNION ALL SELECT 'children', COUNT(*) FROM children UNION ALL SELECT 'sessions', COUNT(*) FROM sessions UNION ALL SELECT 'learning_student_responses', COUNT(*) FROM learning_student_responses ORDER BY 1;"
  echo

  if [[ $DRY_RUN -eq 1 ]]; then
    echo "[dry-run] wrapping wipe_users.sql in BEGIN/ROLLBACK to show impact without committing"
    {
      echo "BEGIN;"
      cat "$SQL_PG"
      echo "ROLLBACK;"
    } | psql -v ON_ERROR_STOP=1 "${PG_CONN[@]}"
    exit 0
  fi

  if [[ "$ENV" == "prod" ]]; then
    echo "*** PRODUCTION WIPE ***"
    echo "This will delete all users and user-generated rows from sen.wulo.ai."
    confirm "Type exactly 'WIPE PROD' to proceed:" "WIPE PROD"
  else
    confirm "Wipe all users from $ENV ($POSTGRES_SERVER_FQDN) ?"
  fi

  if [[ $DO_BACKUP -eq 1 ]]; then
    mkdir -p "$BACKUP_DIR"
    command -v pg_dump >/dev/null || { echo "pg_dump not installed" >&2; exit 3; }
    local dump="$BACKUP_DIR/wulo.$ENV.$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
    echo "Taking pg_dump backup -> $dump"
    pg_dump "${PG_CONN[@]}" --no-owner --no-privileges | gzip > "$dump"
    echo "Backup size: $(du -h "$dump" | cut -f1)"
  else
    echo "Skipping backup (--no-backup)."
  fi

  echo
  echo "Executing wipe (single transaction)…"
  {
    echo "BEGIN;"
    cat "$SQL_PG"
    echo "COMMIT;"
  } | psql -v ON_ERROR_STOP=1 "${PG_CONN[@]}"

  echo
  echo "Post-wipe verification:"
  psql -v ON_ERROR_STOP=1 "${PG_CONN[@]}" -c "SELECT 'users' AS t, COUNT(*) FROM users UNION ALL SELECT 'children', COUNT(*) FROM children UNION ALL SELECT 'exercises', COUNT(*) FROM exercises UNION ALL SELECT 'learning_skills', COUNT(*) FROM learning_skills UNION ALL SELECT 'learning_diagnostic_items', COUNT(*) FROM learning_diagnostic_items UNION ALL SELECT 'listening_eval_items', COUNT(*) FROM listening_eval_items ORDER BY 1;"
}

case "$ENV" in
  local)        wipe_local;;
  staging|prod) wipe_pg;;
esac
