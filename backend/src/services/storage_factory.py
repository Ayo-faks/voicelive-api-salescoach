"""Create the configured storage backend for the application."""

from __future__ import annotations

import logging
import os
from typing import Any, Mapping

from src.bootstrap_storage import bootstrap_storage
from src.services.postgres_migrations import run_postgres_migrations
from src.services.storage import StorageService
from src.services.storage_postgres import PostgresStorageService

logger = logging.getLogger(__name__)

AZURE_RUNTIME_MARKERS = (
    "CONTAINER_APP_NAME",
    "CONTAINER_APP_REVISION",
    "CONTAINER_APP_ENV_DNS_SUFFIX",
    "WEBSITE_SITE_NAME",
    "WEBSITE_HOSTNAME",
    "IDENTITY_ENDPOINT",
)


def _is_azure_hosted_environment() -> bool:
    return any(str(os.environ.get(marker, "")).strip() for marker in AZURE_RUNTIME_MARKERS)


def _parse_allowed_environments(value: Any) -> set[str]:
    text = str(value or "")
    return {item.strip() for item in text.split(",") if item.strip()}


def should_run_postgres_startup_migrations(app_config: Mapping[str, Any]) -> bool:
    if not bool(app_config.get("database_run_migrations_on_startup", True)):
        return False

    if not _is_azure_hosted_environment():
        return True

    allowed_environments = _parse_allowed_environments(app_config.get("database_migration_allowed_environments"))
    deployment_environment_name = str(app_config.get("deployment_environment_name") or "").strip()
    if deployment_environment_name and deployment_environment_name in allowed_environments:
        return True

    logger.warning(
        "Skipping PostgreSQL startup migrations in Azure environment '%s'; allowed environments=%s",
        deployment_environment_name or "unknown",
        sorted(allowed_environments),
    )
    return False


def create_storage_service(app_config: Mapping[str, Any]) -> Any:
    """Create the configured storage service.

    SQLite remains the default backend during the migration window.
    Production (Azure-hosted) environments must use PostgreSQL.
    """

    backend = str(app_config.get("database_backend") or "sqlite").strip().lower()

    if backend == "sqlite" and _is_azure_hosted_environment():
        raise RuntimeError(
            "SQLite is not supported in production environments. "
            "Set DATABASE_BACKEND=postgres and provide DATABASE_URL."
        )

    if backend == "sqlite":
        bootstrap_storage(
            str(app_config["storage_path"]),
            str(app_config["bootstrap_storage_seed_path"]),
        )
        return StorageService(str(app_config["storage_path"]))

    if backend == "postgres":
        database_url = str(app_config.get("database_url") or "").strip()
        database_admin_url = str(app_config.get("database_admin_url") or database_url).strip()
        if not database_url:
            raise RuntimeError("DATABASE_URL is required when DATABASE_BACKEND=postgres")
        if should_run_postgres_startup_migrations(app_config):
            run_postgres_migrations(database_admin_url, database_url)
        return PostgresStorageService(database_url, allow_system_bypass=(database_url == database_admin_url))

    raise RuntimeError(f"Unsupported DATABASE_BACKEND: {backend}")