"""Unit tests for the server-side offline-queue drainer (durable-retry gap)."""

from __future__ import annotations

from typing import Any, Mapping

from src.learning.models import OfflineQueuedEvent, Provenance
from src.learning.offline_queue_drainer import (
    DEFAULT_BACKOFF_BASE_SECONDS,
    OfflineQueueDrainer,
    ReplaySkipped,
    XapiReplayHandler,
)
from src.learning.repository import InMemoryLearningRepository
from src.learning.xapi import (
    ApprovalEvent,
    InMemoryXAPITransport,
    RalphXAPISink,
    approval_event_to_xapi,
)


def _xapi_statement_dump(plan_id: str = "plan-1") -> dict:
    event = ApprovalEvent(
        tenant_id="tenant-drain",
        actor_id="teacher-1",
        plan_id=plan_id,
        action="approved",
        lang="en",
        provenance=[Provenance(source="test")],
    )
    return approval_event_to_xapi(event).model_dump()


def _seed_event(
    repo: InMemoryLearningRepository,
    *,
    event_type: str = "xapi_statement.retry",
    idempotency_key: str = "xapi:stmt-1",
    tenant_id: str = "tenant-drain",
) -> str:
    record = repo.queue_offline_event(
        OfflineQueuedEvent(
            tenant_id=tenant_id,
            actor_id="xapi-emitter",
            idempotency_key=idempotency_key,
            event_type=event_type,
            payload={"statement": _xapi_statement_dump()},
        )
    )
    return str(record["id"])


def _queue_record(repo: InMemoryLearningRepository, queue_id: str) -> dict:
    return next(item for item in repo.offline_queue if item["id"] == queue_id)


def test_replays_queued_event_on_success():
    repo = InMemoryLearningRepository()
    queue_id = _seed_event(repo)
    drainer = OfflineQueueDrainer(repo, handlers={"xapi_statement.retry": lambda payload: True})

    result = drainer.run_once()

    assert result.replayed == 1
    assert result.inspected == 1
    record = _queue_record(repo, queue_id)
    assert record["status"] == "replayed"
    assert record["replayed_at"] is not None


def test_failure_keeps_event_queued_and_increments_attempts():
    repo = InMemoryLearningRepository()
    queue_id = _seed_event(repo)
    drainer = OfflineQueueDrainer(repo, handlers={"xapi_statement.retry": lambda payload: False})

    result = drainer.run_once()

    assert result.failed == 1
    assert result.dead_lettered == 0
    record = _queue_record(repo, queue_id)
    assert record["status"] == "queued"
    assert record["attempts"] == 1
    assert record["last_error"] == "replay handler reported failure"


def test_reaches_max_attempts_dead_letters():
    repo = InMemoryLearningRepository()
    queue_id = _seed_event(repo)
    drainer = OfflineQueueDrainer(
        repo, handlers={"xapi_statement.retry": lambda payload: False}, max_attempts=1
    )

    result = drainer.run_once()

    assert result.dead_lettered == 1
    assert result.failed == 0
    record = _queue_record(repo, queue_id)
    assert record["status"] == "manual_review"
    assert record["attempts"] == 1


def test_unknown_event_type_dead_letters_immediately():
    repo = InMemoryLearningRepository()
    queue_id = _seed_event(repo, event_type="mystery.event", idempotency_key="x:unknown")
    drainer = OfflineQueueDrainer(repo, handlers={})  # no handlers registered

    result = drainer.run_once()

    assert result.dead_lettered == 1
    record = _queue_record(repo, queue_id)
    assert record["status"] == "manual_review"
    assert "no replay handler" in (record["last_error"] or "")


def test_idempotent_rerun_does_not_reprocess_replayed():
    repo = InMemoryLearningRepository()
    _seed_event(repo)
    drainer = OfflineQueueDrainer(repo, handlers={"xapi_statement.retry": lambda payload: True})

    first = drainer.run_once()
    second = drainer.run_once()

    assert first.replayed == 1
    assert second.inspected == 0
    assert second.replayed == 0


def test_backoff_skips_recently_failed_event():
    repo = InMemoryLearningRepository()
    _seed_event(repo)
    drainer = OfflineQueueDrainer(repo, handlers={"xapi_statement.retry": lambda payload: False})

    drainer.run_once()  # first attempt fails, updated_at is "now"
    second = drainer.run_once()  # within the backoff window -> skipped

    assert second.skipped == 1
    assert second.inspected == 0


def test_backoff_allows_retry_after_window_elapses():
    repo = InMemoryLearningRepository()
    queue_id = _seed_event(repo)
    calls = {"n": 0}

    def handler(payload: Mapping[str, Any]) -> bool:
        calls["n"] += 1
        return False

    drainer = OfflineQueueDrainer(repo, handlers={"xapi_statement.retry": handler})
    drainer.run_once()  # attempts -> 1

    # Push updated_at past the first backoff window so the event is due again.
    record = _queue_record(repo, queue_id)
    from datetime import datetime, timedelta, timezone

    old = datetime.now(timezone.utc) - timedelta(seconds=DEFAULT_BACKOFF_BASE_SECONDS + 5)
    record["updated_at"] = old.isoformat()

    second = drainer.run_once()

    assert second.inspected == 1
    assert calls["n"] == 2
    assert record["attempts"] == 2


def test_handler_replay_skipped_leaves_event_untouched():
    repo = InMemoryLearningRepository()
    queue_id = _seed_event(repo)

    def handler(payload: Mapping[str, Any]) -> bool:
        raise ReplaySkipped("ralph endpoint not configured")

    drainer = OfflineQueueDrainer(repo, handlers={"xapi_statement.retry": handler})
    result = drainer.run_once()

    assert result.skipped == 1
    assert result.inspected == 0
    record = _queue_record(repo, queue_id)
    assert record["status"] == "queued"
    assert record["attempts"] == 0


def test_xapi_handler_replays_via_ralph_sink_on_2xx():
    transport = InMemoryXAPITransport(responses=[(204, b"")])
    sink = RalphXAPISink(endpoint="https://ralph.example.test", offline=False, transport=transport)
    handler = XapiReplayHandler(sink=sink)

    ok = handler({"statement": _xapi_statement_dump(plan_id="plan-replay")})

    assert ok is True
    assert len(transport.calls) == 1


def test_xapi_handler_reports_failure_on_non_2xx():
    transport = InMemoryXAPITransport(responses=[(503, b"busy")])
    sink = RalphXAPISink(endpoint="https://ralph.example.test", offline=False, transport=transport)
    handler = XapiReplayHandler(sink=sink)

    ok = handler({"statement": _xapi_statement_dump()})

    assert ok is False


def test_xapi_handler_skips_when_ralph_unconfigured():
    sink = RalphXAPISink(offline=True)
    handler = XapiReplayHandler(sink=sink)

    try:
        handler({"statement": _xapi_statement_dump()})
    except ReplaySkipped:
        pass
    else:  # pragma: no cover
        raise AssertionError("expected ReplaySkipped when ralph endpoint is unconfigured")


def test_end_to_end_seed_enqueue_then_drain():
    """A failed Ralph emission enqueues, then the drainer replays it on retry."""

    repo = InMemoryLearningRepository()
    # First emission fails (503) and enqueues an offline event.
    failing = RalphXAPISink(
        endpoint="https://ralph.example.test",
        offline=False,
        transport=InMemoryXAPITransport(responses=[(503, b"busy")]),
        repository=repo,
    )
    failing.emit(approval_event_to_xapi(
        ApprovalEvent(
            tenant_id="tenant-drain",
            actor_id="teacher-1",
            plan_id="plan-e2e",
            action="approved",
            lang="en",
            provenance=[Provenance(source="test")],
        )
    ))
    assert len(repo.offline_queue) == 1

    # The drainer replays against a now-healthy Ralph (204).
    healthy_sink = RalphXAPISink(
        endpoint="https://ralph.example.test",
        offline=False,
        transport=InMemoryXAPITransport(responses=[(204, b"")]),
    )
    drainer = OfflineQueueDrainer(
        repo, handlers={"xapi_statement.retry": XapiReplayHandler(sink=healthy_sink)}
    )
    result = drainer.run_once()

    assert result.replayed == 1
    assert repo.offline_queue[0]["status"] == "replayed"
