"""Server-side drainer for the ``learning_offline_queue``.

The offline queue was previously write-only: :meth:`RalphXAPISink._queue_failed`
enqueued xAPI emissions that failed to reach Ralph, but nothing on the server
ever drained them back out. This module closes that gap with a Postgres-only
durable-retry loop — no Temporal, no new infra class (see
``pathfinder-docs/06-architecture-contract.md``).

Design
------
* **Bounded retry** — each event carries an ``attempts`` counter. Once it hits
  ``OFFLINE_QUEUE_MAX_ATTEMPTS`` (default 5) the event is dead-lettered to
  ``manual_review`` instead of being retried forever.
* **Exponential backoff** — an event is only retried once ``updated_at`` is
  older than ``base * 2**(attempts-1)`` seconds (capped), so a flapping
  upstream is not hammered.
* **Replay registry** — ``event_type`` maps to a handler. Unknown event types
  are dead-lettered immediately rather than silently dropped.
* **RLS** — the drainer runs without a request context, so
  ``PostgresStorageService`` sets ``app.system_bypass_rls='on'`` automatically
  and the queries are cross-tenant (mirroring ``expire_due_student_facts``).

Run surfaces
------------
* One-shot ``python -m src.learning.offline_queue_dispatcher`` for an Azure
  Container Apps Job on a cron schedule (the durable surface).
* Optional in-process :class:`OfflineQueueDrainWorker` (``threading.Timer``)
  gated by ``OFFLINE_QUEUE_DRAIN_ENABLED`` for local/dev parity.
"""

from __future__ import annotations

import logging
import os
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Mapping, Optional

from src.learning.repository import LearningRepository
from src.learning.xapi import RalphXAPISink, XAPIStatement, build_ralph_sink_from_env

LOGGER = logging.getLogger(__name__)

DEFAULT_MAX_ATTEMPTS = 5
DEFAULT_BATCH_SIZE = 100
DEFAULT_BACKOFF_BASE_SECONDS = 60.0
DEFAULT_BACKOFF_CAP_SECONDS = 3600.0
DEFAULT_INTERVAL_SECONDS = 5 * 60


class ReplaySkipped(Exception):
    """Raised by a handler when an event cannot be replayed *right now*.

    Unlike returning ``False`` (a genuine failure that consumes a retry
    attempt), a skip leaves the event untouched — no attempt is counted and no
    error is recorded. Used, for example, when the Ralph endpoint is not
    configured so there is nothing to replay against.
    """


# A handler returns ``True`` on success, ``False`` on a failure that should
# consume a retry attempt, or raises :class:`ReplaySkipped` to leave the event
# untouched.
ReplayHandler = Callable[[Mapping[str, Any]], bool]


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _parse_iso(value: Any) -> Optional[datetime]:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


@dataclass
class DrainResult:
    """Summary of a single drain pass, for structured logging / job health."""

    inspected: int = 0
    replayed: int = 0
    failed: int = 0
    dead_lettered: int = 0
    skipped: int = 0


class XapiReplayHandler:
    """Re-deliver a buffered xAPI statement to Ralph.

    The sink is built with ``repository=None`` so a *replay* failure does not
    re-enqueue a duplicate row — the drainer owns the queue state transitions.
    """

    def __init__(self, sink: Optional[RalphXAPISink] = None) -> None:
        self._sink = sink if sink is not None else build_ralph_sink_from_env(repository=None)

    def __call__(self, payload: Mapping[str, Any]) -> bool:
        if self._sink.offline or self._sink.endpoint is None:
            raise ReplaySkipped("ralph endpoint not configured")
        raw = payload.get("statement")
        if not isinstance(raw, Mapping):
            # Malformed payload can never succeed — treat as a hard failure so
            # it is dead-lettered for operator triage rather than skipped.
            return False
        statement = XAPIStatement.model_validate(dict(raw))
        return self._sink._deliver(statement) == "ralph_synced"


def default_replay_registry() -> Dict[str, ReplayHandler]:
    """Return the built-in ``event_type`` -> handler registry."""

    return {"xapi_statement.retry": XapiReplayHandler()}


class OfflineQueueDrainer:
    """Drain ``learning_offline_queue`` with bounded retry + backoff."""

    def __init__(
        self,
        repository: LearningRepository,
        *,
        handlers: Optional[Mapping[str, ReplayHandler]] = None,
        max_attempts: int = DEFAULT_MAX_ATTEMPTS,
        batch_size: int = DEFAULT_BATCH_SIZE,
        backoff_base_seconds: float = DEFAULT_BACKOFF_BASE_SECONDS,
        backoff_cap_seconds: float = DEFAULT_BACKOFF_CAP_SECONDS,
    ) -> None:
        self._repository = repository
        self._handlers: Dict[str, ReplayHandler] = dict(
            handlers if handlers is not None else default_replay_registry()
        )
        self._max_attempts = max(1, int(max_attempts))
        self._batch_size = max(1, int(batch_size))
        self._backoff_base = max(0.0, float(backoff_base_seconds))
        self._backoff_cap = max(0.0, float(backoff_cap_seconds))

    def _backoff_seconds(self, attempts: int) -> float:
        if attempts <= 0:
            return 0.0
        return min(self._backoff_base * (2 ** (attempts - 1)), self._backoff_cap)

    def _is_due(self, record: Mapping[str, Any], now: datetime) -> bool:
        attempts = int(record.get("attempts", 0))
        delay = self._backoff_seconds(attempts)
        if delay <= 0:
            return True
        updated = _parse_iso(record.get("updated_at"))
        if updated is None:
            return True
        return (now - updated).total_seconds() >= delay

    def run_once(self) -> DrainResult:
        result = DrainResult()
        candidates = self._repository.list_replayable_offline_events(
            limit=self._batch_size, max_attempts=self._max_attempts
        )
        now = _utcnow()
        for record in candidates:
            if not self._is_due(record, now):
                result.skipped += 1
                continue

            queue_id = str(record.get("id"))
            event_type = str(record.get("event_type"))
            handler = self._handlers.get(event_type)
            if handler is None:
                # Unknown event type can never succeed; dead-letter immediately
                # (max_attempts=0 forces the manual_review transition).
                self._repository.mark_offline_event_failed(
                    queue_id, error=f"no replay handler for event_type={event_type!r}", max_attempts=0
                )
                result.inspected += 1
                result.dead_lettered += 1
                LOGGER.warning("offline_queue_unknown_event_type id=%s type=%s", queue_id, event_type)
                continue

            result.inspected += 1
            try:
                ok = bool(handler(record.get("payload") or {}))
                error = "" if ok else "replay handler reported failure"
            except ReplaySkipped as exc:
                result.skipped += 1
                result.inspected -= 1
                LOGGER.info("offline_queue_replay_skipped id=%s reason=%s", queue_id, exc)
                continue
            except Exception as exc:  # noqa: BLE001 — any handler error consumes an attempt
                ok = False
                error = f"{type(exc).__name__}: {exc}"
                LOGGER.exception("offline_queue_replay_error id=%s", queue_id)

            if ok:
                self._repository.mark_offline_event_replayed(queue_id)
                result.replayed += 1
                continue

            outcome = self._repository.mark_offline_event_failed(
                queue_id, error=error, max_attempts=self._max_attempts
            )
            if outcome.get("status") == "manual_review":
                result.dead_lettered += 1
                LOGGER.warning(
                    "offline_queue_dead_lettered id=%s attempts=%s", queue_id, outcome.get("attempts")
                )
            else:
                result.failed += 1

        LOGGER.info(
            "offline_queue_drain_complete inspected=%d replayed=%d failed=%d dead_lettered=%d skipped=%d",
            result.inspected,
            result.replayed,
            result.failed,
            result.dead_lettered,
            result.skipped,
        )
        return result


class OfflineQueueDrainWorker:
    """``threading.Timer`` loop that periodically drains the offline queue.

    Mirrors :class:`~src.learning.expiry_worker.LearnerMemoryExpiryWorker` so we
    do not add a new scheduler dependency. The one-shot ACA Job
    (``offline_queue_dispatcher``) is the durable surface; this worker exists for
    local/dev parity.
    """

    def __init__(
        self,
        drainer: OfflineQueueDrainer,
        *,
        interval_seconds: float = DEFAULT_INTERVAL_SECONDS,
    ) -> None:
        self._drainer = drainer
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

    def run_once(self) -> DrainResult:
        try:
            return self._drainer.run_once()
        except Exception:  # pragma: no cover — best-effort drain
            LOGGER.exception("offline_queue_drain_failed")
            return DrainResult()

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


def _int_env(source: Mapping[str, str], key: str, default: int) -> int:
    raw = str(source.get(key, "")).strip()
    try:
        return int(raw) if raw else default
    except ValueError:
        return default


def _float_env(source: Mapping[str, str], key: str, default: float) -> float:
    raw = str(source.get(key, "")).strip()
    try:
        return float(raw) if raw else default
    except ValueError:
        return default


def build_drainer(
    repository: LearningRepository,
    *,
    env: Optional[Mapping[str, str]] = None,
    handlers: Optional[Mapping[str, ReplayHandler]] = None,
) -> OfflineQueueDrainer:
    source = env if env is not None else os.environ
    return OfflineQueueDrainer(
        repository,
        handlers=handlers,
        max_attempts=_int_env(source, "OFFLINE_QUEUE_MAX_ATTEMPTS", DEFAULT_MAX_ATTEMPTS),
        batch_size=_int_env(source, "OFFLINE_QUEUE_BATCH_SIZE", DEFAULT_BATCH_SIZE),
        backoff_base_seconds=_float_env(source, "OFFLINE_QUEUE_BACKOFF_BASE_SECONDS", DEFAULT_BACKOFF_BASE_SECONDS),
        backoff_cap_seconds=_float_env(source, "OFFLINE_QUEUE_BACKOFF_CAP_SECONDS", DEFAULT_BACKOFF_CAP_SECONDS),
    )


def maybe_start_offline_drainer(
    repository: LearningRepository,
    *,
    env: Optional[Mapping[str, str]] = None,
) -> Optional[OfflineQueueDrainWorker]:
    """Start the in-process drain worker when ``OFFLINE_QUEUE_DRAIN_ENABLED`` is set."""

    source = env if env is not None else os.environ
    if str(source.get("OFFLINE_QUEUE_DRAIN_ENABLED", "")).strip() not in ("1", "true", "True"):
        return None
    interval = _float_env(source, "OFFLINE_QUEUE_DRAIN_INTERVAL_SECONDS", DEFAULT_INTERVAL_SECONDS)
    worker = OfflineQueueDrainWorker(build_drainer(repository, env=source), interval_seconds=interval)
    worker.start()
    return worker
