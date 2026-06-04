"""Phase 4 tests: MemoryAgent bounded in-process outcome recorder."""

from __future__ import annotations

import json
from dataclasses import dataclass

import pytest

from src.agents.memory_agent import MemoryAgent, MemoryRecord


@dataclass
class _Outcome:
    status: str

    def as_dict(self):
        return {"status": self.status}


def test_record_uses_as_dict_payload() -> None:
    agent = MemoryAgent()
    record = agent.record("critique", _Outcome("warn"))
    assert isinstance(record, MemoryRecord)
    assert record.kind == "critique"
    assert record.seq == 1
    assert record.payload == {"status": "warn"}
    assert len(agent) == 1


def test_record_accepts_mapping_and_primitive() -> None:
    agent = MemoryAgent()
    m = agent.record("verdict", {"allowed": True})
    p = agent.record("note", 42)
    assert m.payload == {"allowed": True}
    assert p.payload == {"value": "42"}


def test_record_is_defensive_against_bad_as_dict() -> None:
    class _Bad:
        def as_dict(self):
            raise RuntimeError("nope")

    agent = MemoryAgent()
    rec = agent.record("bad", _Bad())
    # Falls back to a best-effort repr, never raises.
    assert "value" in rec.payload


def test_buffer_is_bounded_and_drops_oldest() -> None:
    agent = MemoryAgent(capacity=3)
    for i in range(5):
        agent.record("e", {"i": i})
    assert len(agent) == 3
    seqs = [r.payload["i"] for r in agent.recent(limit=10)]
    assert seqs == [2, 3, 4]  # oldest two dropped


def test_recent_filters_by_kind_and_limit() -> None:
    agent = MemoryAgent()
    agent.record("a", {"n": 1})
    agent.record("b", {"n": 2})
    agent.record("a", {"n": 3})
    a_only = agent.recent(limit=10, kind="a")
    assert [r.payload["n"] for r in a_only] == [1, 3]
    assert agent.recent(limit=1)[0].payload["n"] == 3
    assert agent.recent(limit=0) == []


def test_query_with_predicate_and_bad_predicate() -> None:
    agent = MemoryAgent()
    agent.record("a", {"n": 1})
    agent.record("a", {"n": 5})
    hits = agent.query(lambda r: r.payload.get("n", 0) > 3)
    assert [r.payload["n"] for r in hits] == [5]

    # A predicate that raises must not crash the read.
    def _boom(_r):
        raise ValueError("bad")

    assert agent.query(_boom) == []


def test_counts_by_kind() -> None:
    agent = MemoryAgent()
    agent.record("a", {})
    agent.record("a", {})
    agent.record("b", {})
    assert agent.counts_by_kind() == {"a": 2, "b": 1}


def test_clear_empties_buffer_but_keeps_sequence() -> None:
    agent = MemoryAgent()
    agent.record("a", {})
    agent.clear()
    assert len(agent) == 0
    nxt = agent.record("a", {})
    assert nxt.seq == 2  # sequence is monotonic across clears


def test_capacity_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MEMORY_AGENT_CAPACITY", "2")
    agent = MemoryAgent()
    for i in range(4):
        agent.record("e", {"i": i})
    assert len(agent) == 2


def test_record_as_dict_serialisable() -> None:
    agent = MemoryAgent()
    rec = agent.record("a", {"x": 1}, tags={"req": "abc"})
    payload = rec.as_dict()
    json.dumps(payload)
    assert payload["tags"] == {"req": "abc"}


def test_recent_returns_copies_not_internal_list() -> None:
    agent = MemoryAgent()
    agent.record("a", {})
    out = agent.recent()
    out.clear()
    assert len(agent) == 1  # mutating the result didn't touch the buffer


def test_tool_allow_list_enforced() -> None:
    agent = MemoryAgent()
    with pytest.raises(PermissionError):
        agent.ensure_tool_allowed("delete_memory")
    agent.ensure_tool_allowed("record_outcome")
    agent.ensure_tool_allowed("read_memory")
