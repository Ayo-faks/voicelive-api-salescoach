"""Background sweep that expires due learner-memory facts.

Uses ``threading.Timer`` so we do not pull in a new scheduler dependency.
Enabled when ``LEARNING_MEMORY_SWEEP_ENABLED=1`` is set at app startup.
"""

from __future__ import annotations

import logging
import os
import threading
from typing import Optional

from src.learning.repository import LearningRepository

LOGGER = logging.getLogger(__name__)

DEFAULT_INTERVAL_SECONDS = 15 * 60


class LearnerMemoryExpiryWorker:
    def __init__(
        self,
        repository: LearningRepository,
        *,
        interval_seconds: float = DEFAULT_INTERVAL_SECONDS,
    ) -> None:
        self._repository = repository
        self._interval_seconds = max(1.0, float(interval_seconds))
        self._timer: Optional[threading.Timer] = None
        self._lock = threading.Lock()
        self._stopped = False

    def start(self) -> None:
        with self._lock:
            if self._timer is not None or self._stopped:
                return
            self._schedule_locked()

    def stop(self) -> None:
        with self._lock:
            self._stopped = True
            if self._timer is not None:
                self._timer.cancel()
                self._timer = None

    def run_once(self) -> int:
        try:
            return int(self._repository.expire_due_student_facts() or 0)
        except Exception:  # pragma: no cover — best-effort sweep
            LOGGER.exception("learner_memory_expiry_sweep_failed")
            return 0

    def _schedule_locked(self) -> None:
        timer = threading.Timer(self._interval_seconds, self._tick)
        timer.daemon = True
        self._timer = timer
        timer.start()

    def _tick(self) -> None:
        self.run_once()
        with self._lock:
            self._timer = None
            if not self._stopped:
                self._schedule_locked()


def maybe_start_expiry_worker(
    repository: LearningRepository,
    *,
    env: Optional[dict] = None,
) -> Optional[LearnerMemoryExpiryWorker]:
    source = env if env is not None else os.environ
    if str(source.get("LEARNING_MEMORY_SWEEP_ENABLED", "")).strip() not in ("1", "true", "True"):
        return None
    interval_raw = source.get("LEARNING_MEMORY_SWEEP_INTERVAL_SECONDS")
    try:
        interval = float(interval_raw) if interval_raw else DEFAULT_INTERVAL_SECONDS
    except ValueError:
        interval = DEFAULT_INTERVAL_SECONDS
    worker = LearnerMemoryExpiryWorker(repository, interval_seconds=interval)
    worker.start()
    return worker
