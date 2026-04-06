"""Helpers for applying PostgreSQL schema migrations."""

from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config as AlembicConfig


BACKEND_DIR = Path(__file__).resolve().parents[2]
ALEMBIC_INI_PATH = BACKEND_DIR / "alembic.ini"
ALEMBIC_SCRIPT_LOCATION = BACKEND_DIR / "alembic"


def _normalize_alembic_database_url(database_url: str) -> str:
    if database_url.startswith("postgresql://"):
        return database_url.replace("postgresql://", "postgresql+psycopg://", 1)
    return database_url


def run_postgres_migrations(database_url: str) -> None:
    """Apply Alembic migrations to the configured PostgreSQL database."""
    alembic_config = AlembicConfig(str(ALEMBIC_INI_PATH))
    alembic_config.set_main_option("script_location", str(ALEMBIC_SCRIPT_LOCATION))
    alembic_config.set_main_option("sqlalchemy.url", _normalize_alembic_database_url(database_url))
    command.upgrade(alembic_config, "head")