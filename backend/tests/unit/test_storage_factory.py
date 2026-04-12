"""Tests for configuration-driven storage backend selection."""

from __future__ import annotations

from pathlib import Path

import pytest

import src.services.storage_factory as storage_factory_module
from src.services.storage import StorageService
from src.services.storage_factory import create_storage_service


def test_create_storage_service_defaults_to_sqlite(tmp_path: Path):
    config = {
        "database_backend": "sqlite",
        "storage_path": str(tmp_path / "factory.db"),
        "bootstrap_storage_seed_path": str(tmp_path / "missing-seed.db"),
    }

    service = create_storage_service(config)

    assert isinstance(service, StorageService)


def test_create_storage_service_requires_database_url_for_postgres():
    with pytest.raises(RuntimeError, match="DATABASE_URL is required"):
        create_storage_service(
            {
                "database_backend": "postgres",
                "database_url": "",
                "storage_path": "unused.db",
                "bootstrap_storage_seed_path": "unused-seed.db",
            }
        )


def test_create_storage_service_builds_postgres_backend(monkeypatch: pytest.MonkeyPatch):
    calls: dict[str, str] = {}

    class _FakePostgresStorageService:
        def __init__(self, database_url: str, allow_system_bypass: bool = True):
            self.database_url = database_url
            self.allow_system_bypass = allow_system_bypass

    def _run_postgres_migrations(database_url: str, runtime_database_url: str | None = None) -> None:
        calls["database_url"] = database_url
        calls["runtime_database_url"] = runtime_database_url or ""

    monkeypatch.setattr(storage_factory_module, "run_postgres_migrations", _run_postgres_migrations)
    monkeypatch.setattr(storage_factory_module, "PostgresStorageService", _FakePostgresStorageService)

    service = create_storage_service(
        {
            "database_backend": "postgres",
            "database_url": "postgresql://postgres:postgres@localhost:5432/wulo",
            "database_admin_url": "postgresql://postgres:postgres@localhost:5432/wulo",
            "database_run_migrations_on_startup": True,
            "storage_path": "unused.db",
            "bootstrap_storage_seed_path": "unused-seed.db",
        }
    )

    assert isinstance(service, _FakePostgresStorageService)
    assert calls["database_url"] == "postgresql://postgres:postgres@localhost:5432/wulo"
    assert calls["runtime_database_url"] == "postgresql://postgres:postgres@localhost:5432/wulo"
    assert service.allow_system_bypass is True


def test_create_storage_service_skips_startup_migrations_in_azure_when_env_not_allowed(
    monkeypatch: pytest.MonkeyPatch,
):
    calls: list[str] = []

    class _FakePostgresStorageService:
        def __init__(self, database_url: str, allow_system_bypass: bool = True):
            self.database_url = database_url
            self.allow_system_bypass = allow_system_bypass

    monkeypatch.setattr(
        storage_factory_module,
        "run_postgres_migrations",
        lambda database_url, runtime_database_url=None: calls.append(database_url),
    )
    monkeypatch.setattr(storage_factory_module, "PostgresStorageService", _FakePostgresStorageService)
    monkeypatch.setenv("CONTAINER_APP_NAME", "voicelab")
    monkeypatch.setenv("AZD_ENV_NAME", "salescoach-prod")

    service = create_storage_service(
        {
            "database_backend": "postgres",
            "database_url": "postgresql://postgres:postgres@localhost:5432/wulo",
            "database_admin_url": "postgresql://postgres:postgres@localhost:5432/wulo",
            "database_run_migrations_on_startup": True,
            "database_migration_allowed_environments": "salescoach-swe",
            "deployment_environment_name": "salescoach-prod",
            "storage_path": "unused.db",
            "bootstrap_storage_seed_path": "unused-seed.db",
        }
    )

    assert isinstance(service, _FakePostgresStorageService)
    assert calls == []


def test_create_storage_service_runs_startup_migrations_in_allowed_azure_environment(
    monkeypatch: pytest.MonkeyPatch,
):
    calls: list[str] = []

    class _FakePostgresStorageService:
        def __init__(self, database_url: str, allow_system_bypass: bool = True):
            self.database_url = database_url
            self.allow_system_bypass = allow_system_bypass

    monkeypatch.setattr(
        storage_factory_module,
        "run_postgres_migrations",
        lambda database_url, runtime_database_url=None: calls.append(database_url),
    )
    monkeypatch.setattr(storage_factory_module, "PostgresStorageService", _FakePostgresStorageService)
    monkeypatch.setenv("CONTAINER_APP_NAME", "voicelab")
    monkeypatch.setenv("AZD_ENV_NAME", "salescoach-swe")

    create_storage_service(
        {
            "database_backend": "postgres",
            "database_url": "postgresql://postgres:postgres@localhost:5432/wulo",
            "database_admin_url": "postgresql://postgres:postgres@localhost:5432/wulo",
            "database_run_migrations_on_startup": True,
            "database_migration_allowed_environments": "salescoach-swe,salescoach-dev",
            "deployment_environment_name": "salescoach-swe",
            "storage_path": "unused.db",
            "bootstrap_storage_seed_path": "unused-seed.db",
        }
    )

    assert calls == ["postgresql://postgres:postgres@localhost:5432/wulo"]


def test_create_storage_service_uses_admin_url_for_migrations_and_runtime_url_for_service(
    monkeypatch: pytest.MonkeyPatch,
):
    calls: dict[str, str] = {}

    class _FakePostgresStorageService:
        def __init__(self, database_url: str, allow_system_bypass: bool = True):
            self.database_url = database_url
            self.allow_system_bypass = allow_system_bypass

    def _run_postgres_migrations(database_url: str, runtime_database_url: str | None = None) -> None:
        calls["database_url"] = database_url
        calls["runtime_database_url"] = runtime_database_url or ""

    monkeypatch.setattr(storage_factory_module, "run_postgres_migrations", _run_postgres_migrations)
    monkeypatch.setattr(storage_factory_module, "PostgresStorageService", _FakePostgresStorageService)

    service = create_storage_service(
        {
            "database_backend": "postgres",
            "database_url": "postgresql://wuloapp:runtime@localhost:5432/wulo",
            "database_admin_url": "postgresql://postgres:admin@localhost:5432/wulo",
            "database_run_migrations_on_startup": True,
            "storage_path": "unused.db",
            "bootstrap_storage_seed_path": "unused-seed.db",
        }
    )

    assert service.database_url == "postgresql://wuloapp:runtime@localhost:5432/wulo"
    assert service.allow_system_bypass is False
    assert calls["database_url"] == "postgresql://postgres:admin@localhost:5432/wulo"
    assert calls["runtime_database_url"] == "postgresql://wuloapp:runtime@localhost:5432/wulo"


def test_create_storage_service_rejects_unknown_backend():
    with pytest.raises(RuntimeError, match="Unsupported DATABASE_BACKEND"):
        create_storage_service(
            {
                "database_backend": "unknown",
                "storage_path": "unused.db",
                "bootstrap_storage_seed_path": "unused-seed.db",
            }
        )


def test_create_storage_service_allows_sqlite_in_azure_during_migration_window(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    """SQLite should remain available in Azure until the PostgreSQL cutover completes."""
    monkeypatch.setenv("CONTAINER_APP_NAME", "voicelab")

    service = create_storage_service(
        {
            "database_backend": "sqlite",
            "storage_path": str(tmp_path / "factory.db"),
            "bootstrap_storage_seed_path": str(tmp_path / "missing-seed.db"),
        }
    )

    assert isinstance(service, StorageService)


def test_create_storage_service_allows_sqlite_locally(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """SR-01: SQLite should still work when no Azure markers are present."""
    for marker in storage_factory_module.AZURE_RUNTIME_MARKERS:
        monkeypatch.delenv(marker, raising=False)

    service = create_storage_service(
        {
            "database_backend": "sqlite",
            "storage_path": str(tmp_path / "factory.db"),
            "bootstrap_storage_seed_path": str(tmp_path / "missing-seed.db"),
        }
    )
    assert isinstance(service, StorageService)