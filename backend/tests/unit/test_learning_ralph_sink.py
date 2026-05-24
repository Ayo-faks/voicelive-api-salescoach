"""Unit tests for the buffered Ralph xAPI emitter (Slice 3 / A3)."""

from __future__ import annotations

import json

import pytest

from src.learning.models import Provenance
from src.learning.repository import InMemoryLearningRepository
from src.learning.xapi import (
    ApprovalEvent,
    InMemoryXAPITransport,
    RalphXAPISink,
    XAPIStatement,
    approval_event_to_xapi,
    build_ralph_sink_from_env,
)


def _approval_statement(plan_id: str = "intervention-plan-abc", actor: str = "teacher-1") -> XAPIStatement:
    event = ApprovalEvent(
        tenant_id="tenant-ralph",
        actor_id=actor,
        plan_id=plan_id,
        action="approved",
        lang="en",
        provenance=[Provenance(source="test")],
    )
    return approval_event_to_xapi(event)


def test_offline_sink_keeps_back_compat_status():
    """`RalphXAPISink(offline=True)` must still report `ralph_queued`."""
    sink = RalphXAPISink(offline=True)
    statement = sink.emit(_approval_statement())
    assert sink.sink_status == "ralph_queued"
    assert sink.statuses[-1]["status"] == "ralph_queued"
    assert statement.id == sink.emitted[-1].id


def test_endpoint_post_marks_synced_and_sends_xapi_headers():
    transport = InMemoryXAPITransport(responses=[(204, b"")])
    sink = RalphXAPISink(
        endpoint="https://ralph.example.test/",
        offline=False,
        auth_token="secret",
        transport=transport,
    )
    sink.emit(_approval_statement())
    assert sink.sink_status == "ralph_synced"
    assert len(transport.calls) == 1
    call = transport.calls[0]
    assert call["url"] == "https://ralph.example.test/xAPI/statements"
    assert call["headers"]["X-Experience-API-Version"] == "1.0.3"
    assert call["headers"]["Authorization"] == "Bearer secret"
    assert call["headers"]["Content-Type"] == "application/json"
    body = json.loads(call["body"].decode("utf-8"))
    assert body["object"]["id"].endswith("/intervention-plan-abc")


def test_explicit_auth_scheme_passes_through():
    transport = InMemoryXAPITransport(responses=[(200, b"")])
    sink = RalphXAPISink(
        endpoint="https://ralph.example.test",
        offline=False,
        auth_token="Basic dXNlcjpwYXNz",
        transport=transport,
    )
    sink.emit(_approval_statement())
    assert transport.calls[0]["headers"]["Authorization"] == "Basic dXNlcjpwYXNz"


def test_failure_enqueues_offline_event_and_marks_failed():
    transport = InMemoryXAPITransport(responses=[(503, b"upstream busy")])
    repo = InMemoryLearningRepository()
    sink = RalphXAPISink(
        endpoint="https://ralph.example.test",
        offline=False,
        transport=transport,
        repository=repo,
    )
    sink.emit(_approval_statement(plan_id="intervention-plan-fail"))
    assert sink.sink_status == "ralph_failed"
    assert len(repo.offline_queue) == 1
    queued = repo.offline_queue[0]
    assert queued["event_type"] == "xapi_statement.retry"
    assert queued["tenant_id"] == "tenant-ralph"
    assert queued["payload"]["statement"]["object"]["id"].endswith("/intervention-plan-fail")
    assert queued["idempotency_key"].startswith("xapi:")


def test_transport_unreachable_records_failure_without_raising():
    transport = InMemoryXAPITransport(responses=[(0, b"connection refused")])
    repo = InMemoryLearningRepository()
    sink = RalphXAPISink(
        endpoint="https://ralph.example.test",
        offline=False,
        transport=transport,
        repository=repo,
    )
    sink.emit(_approval_statement())
    assert sink.sink_status == "ralph_failed"
    assert repo.offline_queue, "unreachable transport should still enqueue for retry"


def test_flush_resyncs_previously_failed_statements():
    transport = InMemoryXAPITransport(responses=[(503, b""), (200, b"")])
    sink = RalphXAPISink(
        endpoint="https://ralph.example.test",
        offline=False,
        transport=transport,
    )
    sink.emit(_approval_statement(plan_id="intervention-plan-retry"))
    assert sink.sink_status == "ralph_failed"

    summary = sink.flush()

    assert summary == {"attempted": 1, "synced": 1, "failed": 0, "queued": 0}
    assert sink.sink_status == "ralph_synced"
    assert sink.statuses[-1]["attempts"] == 2


def test_flush_is_noop_when_offline():
    sink = RalphXAPISink(offline=True)
    sink.emit(_approval_statement())
    sink.emit(_approval_statement(plan_id="another"))
    summary = sink.flush()
    assert summary["attempted"] == 0
    assert summary["queued"] == 2


def test_build_from_env_offline_when_url_missing():
    sink = build_ralph_sink_from_env(env={})
    assert sink.offline is True
    assert sink.endpoint is None


def test_build_from_env_wires_endpoint_token_and_timeout():
    sink = build_ralph_sink_from_env(
        env={
            "RALPH_BASE_URL": "https://ralph.prod.example/",
            "RALPH_AUTH_TOKEN": "tok-123",
            "RALPH_TIMEOUT_SECONDS": "2.5",
        }
    )
    assert sink.offline is False
    assert sink.endpoint == "https://ralph.prod.example"
    assert sink.auth_token == "tok-123"
    assert sink.request_timeout == pytest.approx(2.5)


def test_buffer_eviction_prefers_synced_records():
    transport = InMemoryXAPITransport(default=(200, b""))
    sink = RalphXAPISink(
        endpoint="https://ralph.example.test",
        offline=False,
        transport=transport,
        max_buffer=2,
    )
    sink.emit(_approval_statement(plan_id="p-1"))
    sink.emit(_approval_statement(plan_id="p-2"))
    sink.emit(_approval_statement(plan_id="p-3"))
    assert len(sink.statuses) == 2
    # The oldest synced record (p-1) should be evicted; p-2 and p-3 remain.
    object_ids = [rec["statement"].object["id"] for rec in sink.statuses]
    assert all(obj.endswith(("p-2", "p-3")) for obj in object_ids)
