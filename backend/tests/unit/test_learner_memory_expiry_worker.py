"""Unit tests for the learner memory expiry background worker."""

from __future__ import annotations

import time
from typing import Any, Dict

from src.learning.expiry_worker import (
    LearnerMemoryExpiryWorker,
    maybe_start_expiry_worker,
)


class _RecordingRepo:
    def __init__(self) -> None:
        self.calls = 0

    def expire_due_student_facts(self, **_: Any) -> int:
        self.calls += 1
        return 0


def test_run_once_invokes_repository() -> None:
    repo = _RecordingRepo()
    worker = LearnerMemoryExpiryWorker(repo, interval_seconds=60)
    assert worker.run_once() == 0
    assert repo.calls == 1


def test_start_triggers_periodic_sweep() -> None:
    repo = _RecordingRepo()
    worker = LearnerMemoryExpiryWorker(repo, interval_seconds=0.05)
    worker.start()
    try:
        deadline = time.time() + 1.5
        while time.time() < deadline and repo.calls < 2:
            time.sleep(0.05)
    finally:
        worker.stop()
    assert repo.calls >= 1


def test_maybe_start_returns_none_when_flag_disabled() -> None:
    repo = _RecordingRepo()
    env: Dict[str, str] = {}
    assert maybe_start_expiry_worker(repo, env=env) is None
    assert repo.calls == 0


def test_maybe_start_returns_worker_when_flag_enabled() -> None:
    repo = _RecordingRepo()
    env = {"LEARNING_MEMORY_SWEEP_ENABLED": "1", "LEARNING_MEMORY_SWEEP_INTERVAL_SECONDS": "60"}
    worker = maybe_start_expiry_worker(repo, env=env)
    assert worker is not None
    try:
        assert worker.run_once() == 0
        assert repo.calls == 1
    finally:
        worker.stop()
