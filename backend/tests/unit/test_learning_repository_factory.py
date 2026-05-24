"""Tests for the learning repository factory (A1).

Phase 1, Workstream A — Foundations: ensures `make_repository()` returns
the correct backend implementation for each environment variable
configuration and that the Postgres path requires a storage service.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from src.learning.repository import (
    InMemoryLearningRepository,
    LearningPostgresRepository,
)
from src.learning.repository_factory import make_repository


def test_make_repository_defaults_to_memory(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("LEARNING_REPOSITORY_BACKEND", raising=False)
    monkeypatch.delenv("DATABASE_BACKEND", raising=False)

    repo = make_repository()
    assert isinstance(repo, InMemoryLearningRepository)


def test_make_repository_explicit_memory() -> None:
    repo = make_repository(backend="memory")
    assert isinstance(repo, InMemoryLearningRepository)


def test_make_repository_sqlite_falls_back_to_memory(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("LEARNING_REPOSITORY_BACKEND", raising=False)
    monkeypatch.setenv("DATABASE_BACKEND", "sqlite")

    repo = make_repository()
    # Phase 1: learning tables only exist in Postgres; SQLite deployments
    # keep the in-memory repository.
    assert isinstance(repo, InMemoryLearningRepository)


def test_make_repository_postgres_requires_storage() -> None:
    with pytest.raises(RuntimeError, match="storage_service"):
        make_repository(backend="postgres")


def test_make_repository_postgres_returns_pg_repo() -> None:
    storage = MagicMock(name="PostgresStorageService")
    repo = make_repository(backend="postgres", storage_service=storage)
    assert isinstance(repo, LearningPostgresRepository)


def test_make_repository_rejects_unknown_backend() -> None:
    with pytest.raises(RuntimeError, match="Unsupported"):
        make_repository(backend="duckdb")


def test_make_repository_env_var_overrides_database_backend(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LEARNING_REPOSITORY_BACKEND", "memory")
    monkeypatch.setenv("DATABASE_BACKEND", "postgres")

    repo = make_repository()
    assert isinstance(repo, InMemoryLearningRepository)
