"""Bootstrap helpers: build a wired ``SafeguardingService`` from app config.

Kept separate from the realtime modules so the websocket handler can
import a single ``get_safeguarding_service()`` accessor without pulling
the Flask app into the safeguarding package.
"""

from __future__ import annotations

import logging
import os
import threading
from typing import Any, Callable, Mapping, Optional

from .notifier import build_notifier
from .pipeline import build_default_pipeline
from .repository import (
    InMemorySafeguardingRepository,
    PostgresSafeguardingRepository,
    SafeguardingRepository,
)
from .service import SafeguardingService, build_safeguarding_service

logger = logging.getLogger(__name__)


_SERVICE_LOCK = threading.Lock()
_SERVICE: Optional[SafeguardingService] = None


def configure_safeguarding_service(
    *,
    settings: Mapping[str, Any],
    repository: Optional[SafeguardingRepository] = None,
    openai_client_factory: Optional[Callable[[], Any]] = None,
    in_app_inserter: Optional[Callable[[Mapping[str, Any]], None]] = None,
    email_sender: Optional[Callable[[str, str, str, str], None]] = None,
    parent_email_resolver: Optional[Callable[[Optional[str]], Optional[str]]] = None,
) -> SafeguardingService:
    """Build (or rebuild) the process-wide safeguarding service.

    Settings keys consulted (all optional, env-driven):
      * ``database_url`` — for Postgres event store
    """
    global _SERVICE
    pipeline = build_default_pipeline(openai_client_factory=openai_client_factory)

    if repository is None:
        database_url = str(settings.get("database_url") or os.environ.get("DATABASE_URL") or "").strip()
        if database_url and database_url.startswith(("postgres://", "postgresql://")):
            try:
                import psycopg
                from psycopg.rows import dict_row

                def _connect():
                    return psycopg.connect(database_url, row_factory=dict_row)

                repository = PostgresSafeguardingRepository(connection_factory=_connect)
                logger.info("Safeguarding repository: postgres")
            except Exception as exc:  # noqa: BLE001
                logger.warning("Falling back to in-memory safeguarding repository: %s", exc)
                repository = InMemorySafeguardingRepository()
        else:
            logger.info("Safeguarding repository: in-memory (no postgres url)")
            repository = InMemorySafeguardingRepository()

    notifier = build_notifier(
        in_app_inserter=in_app_inserter,
        email_sender=email_sender,
        parent_email_resolver=parent_email_resolver,
    )

    service = build_safeguarding_service(pipeline, repository=repository, notifier=notifier)
    with _SERVICE_LOCK:
        _SERVICE = service
    return service


def get_safeguarding_service() -> Optional[SafeguardingService]:
    """Return the configured service, or ``None`` if not yet initialised."""
    return _SERVICE
