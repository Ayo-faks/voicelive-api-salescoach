"""Track A increment 4 — durable sink interface tests.

Verifies the cross-run persistence seam: an abstract :class:`DurableSink`, an
in-memory fake, a JSONL file sink that survives across instances, an
observability-snapshot decorator that wraps the dirty observability module via
its public API only, a dark-by-default factory, and the gate mirroring every
verdict into a supplied sink. No LLM traffic, no real PII.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.agents.durable_sink import (
    SINK_FLAG,
    DurableSink,
    InMemoryDurableSink,
    JsonlDurableSink,
    ObservabilitySnapshotSink,
    SinkRecord,
    build_durable_sink,
    durable_sink_enabled,
)
from src.agents.memory_agent import MemoryAgent
from src.agents.observability_gate import STATUS_OK, ObservabilityGate
from src.learning.eval import critic_fixture_handler, safeguarding_fixture_handler
from src.learning.observability import LearningObservability


class _Verdict:
    """A minimal as_dict()-bearing verdict, like the real agent verdicts."""

    def __init__(self, status: str) -> None:
        self.status = status

    def as_dict(self):
        return {"status": self.status, "passed": self.status == "passed"}


# --- SinkRecord round-trip --------------------------------------------------


def test_sink_record_dict_round_trip() -> None:
    rec = SinkRecord(seq=3, kind="critic", ts=1.5, payload={"a": 1}, tags={"t": "x"})
    restored = SinkRecord.from_dict(rec.as_dict())
    assert restored == rec


def test_sink_record_from_dict_is_defensive_about_missing_keys() -> None:
    rec = SinkRecord.from_dict({})
    assert rec.seq == 0 and rec.kind == "" and rec.payload == {} and rec.tags == {}


# --- InMemoryDurableSink ----------------------------------------------------


def test_in_memory_sink_appends_and_reads_newest_last() -> None:
    sink = InMemoryDurableSink()
    sink.record_verdict("critic", _Verdict("passed"))
    sink.record_verdict("safeguarding", _Verdict("failed"))
    recs = sink.read()
    assert [r.kind for r in recs] == ["critic", "safeguarding"]
    assert recs[-1].payload["status"] == "failed"
    assert len(sink) == 2


def test_in_memory_sink_filters_by_kind_and_counts() -> None:
    sink = InMemoryDurableSink()
    sink.record_verdict("critic", _Verdict("passed"))
    sink.record_verdict("critic", _Verdict("failed"))
    sink.record_verdict("safeguarding", _Verdict("passed"))
    assert len(sink.read(kind="critic")) == 2
    assert sink.counts_by_kind() == {"critic": 2, "safeguarding": 1}


def test_in_memory_sink_limit_zero_returns_empty() -> None:
    sink = InMemoryDurableSink()
    sink.record_verdict("critic", _Verdict("passed"))
    assert sink.read(0) == []


def test_in_memory_sink_is_bounded() -> None:
    sink = InMemoryDurableSink(capacity=2)
    for i in range(5):
        sink.record_verdict("critic", _Verdict(f"v{i}"))
    assert len(sink) == 2


def test_record_verdict_is_non_raising_on_bad_payload() -> None:
    class _Boom:
        def as_dict(self):
            raise RuntimeError("nope")

    sink = InMemoryDurableSink()
    rec = sink.record_verdict("critic", _Boom())  # falls back to str(), never raises
    assert rec is not None
    assert "value" in rec.payload


# --- JsonlDurableSink (cross-process durability) ----------------------------


def test_jsonl_sink_persists_across_instances(tmp_path: Path) -> None:
    path = tmp_path / "sink.jsonl"
    first = JsonlDurableSink(path)
    first.record_verdict("critic", _Verdict("passed"))
    first.record_verdict("safeguarding", _Verdict("failed"))

    # A brand-new instance pointed at the same path reads prior history.
    second = JsonlDurableSink(path)
    recs = second.read()
    assert [r.kind for r in recs] == ["critic", "safeguarding"]
    assert second.counts_by_kind() == {"critic": 1, "safeguarding": 1}
    # And continues the sequence rather than restarting it.
    third = second.record_verdict("critic", _Verdict("passed"))
    assert third.seq == 3


def test_jsonl_sink_lines_are_valid_json(tmp_path: Path) -> None:
    path = tmp_path / "sink.jsonl"
    sink = JsonlDurableSink(path)
    sink.record_verdict("critic", _Verdict("passed"))
    lines = path.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 1
    parsed = json.loads(lines[0])
    assert parsed["kind"] == "critic"
    assert parsed["payload"]["status"] == "passed"


def test_jsonl_sink_skips_corrupt_lines(tmp_path: Path) -> None:
    path = tmp_path / "sink.jsonl"
    sink = JsonlDurableSink(path)
    sink.record_verdict("critic", _Verdict("passed"))
    with path.open("a", encoding="utf-8") as fh:
        fh.write("{not valid json\n")
        fh.write("\n")
    recs = sink.read()
    assert len(recs) == 1  # corrupt + blank lines skipped, never raises


def test_jsonl_sink_read_before_any_write_is_empty(tmp_path: Path) -> None:
    sink = JsonlDurableSink(tmp_path / "missing.jsonl")
    assert sink.read() == []
    assert len(sink) == 0
    assert sink.counts_by_kind() == {}


# --- ObservabilitySnapshotSink (wraps dirty observability, public API only) --


def test_snapshot_sink_attaches_obs_snapshot_tag() -> None:
    inner = InMemoryDurableSink()
    obs = LearningObservability()
    sink = ObservabilitySnapshotSink(inner, obs)
    sink.record_verdict("critic", _Verdict("passed"))
    rec = sink.read()[-1]
    assert "obs_snapshot" in rec.tags
    assert isinstance(rec.tags["obs_snapshot"], dict)
    # Delegation still works through the decorator.
    assert sink.counts_by_kind() == {"critic": 1}
    assert len(sink) == 1


def test_snapshot_sink_survives_a_broken_observability() -> None:
    class _BrokenObs:
        def metrics_snapshot(self):
            raise RuntimeError("telemetry down")

    inner = InMemoryDurableSink()
    sink = ObservabilitySnapshotSink(inner, _BrokenObs())  # type: ignore[arg-type]
    rec = sink.record_verdict("critic", _Verdict("passed"))
    assert rec is not None
    assert "obs_snapshot" not in rec.tags  # stored without the snapshot, no crash


# --- Dark-by-default factory ------------------------------------------------


def test_factory_returns_none_when_flag_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(SINK_FLAG, raising=False)
    assert durable_sink_enabled() is False
    assert build_durable_sink() is None
    assert build_durable_sink("/tmp/whatever.jsonl") is None


def test_factory_force_builds_in_memory_without_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv(SINK_FLAG, raising=False)
    sink = build_durable_sink(force=True)
    assert isinstance(sink, InMemoryDurableSink)


def test_factory_builds_jsonl_with_path_when_flag_set(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv(SINK_FLAG, "1")
    sink = build_durable_sink(tmp_path / "s.jsonl")
    assert isinstance(sink, JsonlDurableSink)


def test_factory_wraps_with_observability_when_supplied(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(SINK_FLAG, "1")
    sink = build_durable_sink(observability=LearningObservability())
    assert isinstance(sink, ObservabilitySnapshotSink)


def test_concrete_sinks_are_durable_sink_instances() -> None:
    assert isinstance(InMemoryDurableSink(), DurableSink)


# --- Gate wiring: verdicts mirrored into the sink ---------------------------


def test_gate_mirrors_every_verdict_into_the_sink() -> None:
    mem = MemoryAgent()
    sink = InMemoryDurableSink()
    gate = ObservabilityGate(memory=mem)
    report = gate.run_cycle(
        safeguarding_handler=safeguarding_fixture_handler(),
        critic_handler=critic_fixture_handler(),
        require_probe_flag=False,
        durable_sink=sink,
        force=True,
    )
    assert report.status == STATUS_OK
    # Same verdicts recorded to both in-process memory and the durable sink.
    assert report.recorded == 2
    assert sink.counts_by_kind() == {"safeguarding": 1, "critic": 1}


def test_gate_without_sink_is_unchanged() -> None:
    gate = ObservabilityGate()
    report = gate.run_cycle(
        critic_handler=critic_fixture_handler(),
        require_probe_flag=False,
        force=True,
    )
    assert report.status == STATUS_OK
    assert report.recorded == 1


def test_gate_sink_accumulates_across_runs() -> None:
    sink = InMemoryDurableSink()
    gate = ObservabilityGate()
    for _ in range(3):
        gate.run_cycle(
            critic_handler=critic_fixture_handler(),
            require_probe_flag=False,
            durable_sink=sink,
            force=True,
        )
    # Cross-run history accrues in the durable sink — the online story.
    assert sink.counts_by_kind() == {"critic": 3}
    assert len(sink) == 3
