"""``python -m src.learning.notifications`` — one-shot Web Push dispatcher.

Run as an Azure Container Apps Job on a ``*/5 * * * *`` schedule. Exits with
a non-zero status if VAPID is unconfigured or the run produced more failures
than successes (so the job surfaces in Container Apps revision health).
"""

from __future__ import annotations

import logging
import os
import sys

from src.learning.notifications import (
    PostgresNotificationsRepository,
    dispatch_due_cards,
    load_vapid_config,
)

logger = logging.getLogger(__name__)


def main() -> int:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    vapid = load_vapid_config()
    if not vapid.configured:
        logger.error("VAPID keys not configured; aborting dispatcher run")
        return 2

    # Lazy import so unit tests do not need the storage layer.
    from src.app import learning_storage_service  # type: ignore

    repo = PostgresNotificationsRepository(learning_storage_service)
    result = dispatch_due_cards(repo, vapid)
    logger.info(
        "dispatch_complete inspected=%d sent=%d failed=%d revoked=%d",
        result.inspected,
        result.sent,
        result.failed,
        result.revoked,
    )
    return 0 if result.failed <= result.sent else 1


if __name__ == "__main__":
    sys.exit(main())
