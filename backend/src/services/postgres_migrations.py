"""Helpers for applying PostgreSQL schema migrations."""

from __future__ import annotations

from pathlib import Path
from urllib.parse import unquote, urlsplit

from alembic import command
from alembic.config import Config as AlembicConfig
import psycopg
from psycopg import sql


BACKEND_DIR = Path(__file__).resolve().parents[2]
ALEMBIC_INI_PATH = BACKEND_DIR / "alembic.ini"
ALEMBIC_SCRIPT_LOCATION = BACKEND_DIR / "alembic"


def _normalize_alembic_database_url(database_url: str) -> str:
    if database_url.startswith("postgresql://"):
        database_url = database_url.replace("postgresql://", "postgresql+psycopg://", 1)
    # Escape '%' for configparser interpolation
    return database_url.replace("%", "%%")


def _parse_database_url(database_url: str) -> dict[str, str]:
    parsed = urlsplit(database_url)
    return {
        "username": unquote(parsed.username or ""),
        "password": unquote(parsed.password or ""),
        "database": parsed.path.lstrip("/"),
    }


def _seed_default_children(admin_database_url: str) -> None:
    with psycopg.connect(admin_database_url, autocommit=True) as connection:
        connection.execute("SELECT set_config('app.system_bypass_rls', 'on', false)")
        connection.execute(
            """
            INSERT INTO children (id, name, created_at)
            VALUES
                ('child-ayo', 'Ayo', NOW()::text),
                ('child-noah', 'Noah', NOW()::text),
                ('child-zuri', 'Zuri', NOW()::text)
            ON CONFLICT (id) DO NOTHING
            """
        )


def _ensure_runtime_role(admin_database_url: str, runtime_database_url: str) -> None:
    admin_identity = _parse_database_url(admin_database_url)
    runtime_identity = _parse_database_url(runtime_database_url)
    runtime_username = runtime_identity["username"]
    runtime_password = runtime_identity["password"]
    runtime_database = runtime_identity["database"]

    if not runtime_username or not runtime_password or not runtime_database:
        return

    if runtime_identity == admin_identity:
        return

    with psycopg.connect(admin_database_url, autocommit=True) as connection:
        connection.execute(
            sql.SQL(
                """
                DO $$
                BEGIN
                    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = {role_name}) THEN
                        CREATE ROLE {role_identifier}
                        LOGIN
                        PASSWORD {role_password}
                        NOSUPERUSER
                        NOCREATEDB
                        NOCREATEROLE
                        NOINHERIT;
                    ELSE
                        ALTER ROLE {role_identifier}
                        WITH LOGIN PASSWORD {role_password}
                        NOSUPERUSER
                        NOCREATEDB
                        NOCREATEROLE
                        NOINHERIT;
                    END IF;
                END
                $$;
                """
            ).format(
                role_name=sql.Literal(runtime_username),
                role_identifier=sql.Identifier(runtime_username),
                role_password=sql.Literal(runtime_password),
            )
        )
        connection.execute(
            sql.SQL("GRANT CONNECT ON DATABASE {} TO {}").format(
                sql.Identifier(runtime_database),
                sql.Identifier(runtime_username),
            )
        )
        connection.execute(
            sql.SQL("GRANT USAGE ON SCHEMA public TO {}").format(sql.Identifier(runtime_username))
        )
        connection.execute(
            sql.SQL("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {}").format(
                sql.Identifier(runtime_username)
            )
        )
        connection.execute(
            sql.SQL("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {}").format(
                sql.Identifier(runtime_username)
            )
        )
        connection.execute(
            sql.SQL(
                "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {}"
            ).format(sql.Identifier(runtime_username))
        )
        connection.execute(
            sql.SQL("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO {}").format(
                sql.Identifier(runtime_username)
            )
        )


def run_postgres_migrations(database_url: str, runtime_database_url: str | None = None) -> None:
    """Apply Alembic migrations to the configured PostgreSQL database."""
    alembic_config = AlembicConfig(str(ALEMBIC_INI_PATH))
    alembic_config.set_main_option("script_location", str(ALEMBIC_SCRIPT_LOCATION))
    alembic_config.set_main_option("sqlalchemy.url", _normalize_alembic_database_url(database_url))
    command.upgrade(alembic_config, "head")
    _seed_default_children(database_url)
    if runtime_database_url:
        _ensure_runtime_role(database_url, runtime_database_url)