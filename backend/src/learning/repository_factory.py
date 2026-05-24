"""Factory for ``LearningRepository`` instances.

Mirrors the pattern in :mod:`src.services.storage_factory`. The Postgres
backend reuses the application's :class:`PostgresStorageService` so RLS
session GUCs (``app.tenant_id``, ``app.class_id``, ``app.user_id``,
``app.role``) set by ``set_request_actor()`` flow through to learning
queries automatically.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Optional

from src.learning.repository import (
    InMemoryLearningRepository,
    LearningPostgresRepository,
    LearningRepository,
)

logger = logging.getLogger(__name__)

ALLOWED_BACKENDS = frozenset({"postgres", "sqlite", "memory"})


def make_repository(
    backend: Optional[str] = None,
    storage_service: Optional[Any] = None,
) -> LearningRepository:
    """Return a ``LearningRepository`` for the requested backend.

    Resolution order:

    * Explicit ``backend`` argument (used by tests).
    * ``LEARNING_REPOSITORY_BACKEND`` env var.
    * ``DATABASE_BACKEND`` env var.
    * ``memory`` (safe default for offline / pilot demos).
    """

    selected = (
        backend
        or os.environ.get("LEARNING_REPOSITORY_BACKEND")
        or os.environ.get("DATABASE_BACKEND")
        or "memory"
    ).strip().lower()

    if selected not in ALLOWED_BACKENDS:
        raise RuntimeError(f"Unsupported learning repository backend: {selected!r}")

    if selected in {"memory", "sqlite"}:
        # SQLite path still routes through the in-memory repository in Phase 1:
        # the persistent learning tables only exist in Postgres (migration
        # 000024). SQLite is retained as a deployment knob, not a learning
        # backend. Logging at info so the cutover is visible in pilot logs.
        if selected == "sqlite":
            logger.info(
                "learning_repository: DATABASE_BACKEND=sqlite — using "
                "InMemoryLearningRepository for the learning context."
            )
        return InMemoryLearningRepository()

    if storage_service is None:
        raise RuntimeError(
            "make_repository(backend='postgres') requires storage_service"
        )
    return LearningPostgresRepository(storage_service)


__all__ = ["make_repository", "ALLOWED_BACKENDS"]
