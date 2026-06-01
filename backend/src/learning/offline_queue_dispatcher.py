"""``python -m src.learning.offline_queue_dispatcher`` — one-shot queue drainer.

Run as an Azure Container Apps Job on a ``*/5 * * * *`` schedule. Drains the
``learning_offline_queue`` once and exits. Returns a non-zero status when the
pass dead-lettered more events than it replayed, so the run surfaces in
Container Apps revision health.

This is the durable run surface for
:class:`~src.learning.offline_queue_drainer.OfflineQueueDrainer`; the in-process
``OfflineQueueDrainWorker`` (gated by ``OFFLINE_QUEUE_DRAIN_ENABLED``) is the
local/dev parity surface.
"""

from __future__ import annotations

import logging
import os
import sys

from src.learning.offline_queue_drainer import build_drainer

logger = logging.getLogger(__name__)


def main() -> int:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    # Lazy import so unit tests do not need the full app/storage layer.
    from src.app import learning_repository  # type: ignore

    drainer = build_drainer(learning_repository)
    result = drainer.run_once()
    logger.info(
        "offline_queue_dispatch_complete inspected=%d replayed=%d failed=%d dead_lettered=%d skipped=%d",
        result.inspected,
        result.replayed,
        result.failed,
        result.dead_lettered,
        result.skipped,
    )
    return 0 if result.dead_lettered <= result.replayed else 1


if __name__ == "__main__":
    sys.exit(main())
