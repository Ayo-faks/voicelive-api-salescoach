"""DurableSink — cross-run persistence for mesh verdicts (Track A, increment 4).

The :class:`~src.agents.memory_agent.MemoryAgent` is deliberately *in-process
only* — a bounded ring buffer that is lost when the process exits. The online
(over-time) half of the eval plan needs verdicts to survive **across runs** so a
drift detector (increment 6) can compare today's veto-rate against history. This
module is that durable seam.

Design rules (consistent with the rest of the mesh):

* **New file, additive.** Imports :mod:`src.learning.observability` to mirror the
  same signals into the existing telemetry pipeline, but **never edits it** — the
  same wrapping discipline the plan mandates for every dirty file.
* **Dark by default.** :func:`build_durable_sink` returns ``None`` unless the
  ``AGENT_MESH_MEMORY_SINK_V1`` kill-switch is set (or ``force=True`` for an
  explicit CI/test invocation), so wiring a sink into the gate is a no-op until
  the flag flips.
* **Non-raising.** A sink is observability plumbing: a bad path, an unserialisable
  payload, or a corrupt history line must degrade to a best-effort no-op, never
  crash the cron/gate that writes to it.
* **No new runtime deps, no PII.** JSON lines on local disk via the stdlib; the
  payloads are the already-privacy-safe verdict dicts the agents emit.
"""

from __future__ import annotations

import abc
import json
import os
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Deque, Dict, List, Mapping, Optional

# Imported but NEVER edited — wrap the dirty observability module via its public
# surface only. Used to mirror durable records into the existing telemetry
# snapshot so the online drift tile is populated from the same source of truth.
from src.learning.observability import (  # noqa: F401  (public re-use only)
    OBSERVABILITY_FLAG_ENV,
    LearningObservability,
)

SINK_FLAG = "AGENT_MESH_MEMORY_SINK_V1"

_TRUTHY = frozenset({"1", "true", "yes", "on", "enabled"})
_DEFAULT_IN_MEMORY_CAPACITY = 2048


def _flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name, "")
    value = raw.strip().lower()
    if not value:
        return default
    return value in _TRUTHY


def durable_sink_enabled() -> bool:
    """Whether the durable mesh sink is opt-in enabled for this process."""
    return _flag(SINK_FLAG, default=False)


@dataclass(frozen=True)
class SinkRecord:
    """A single durably-persisted mesh outcome.

    Mirrors :class:`~src.agents.memory_agent.MemoryRecord` so a drift detector can
    consume either an in-process buffer or a durable sink interchangeably.
    """

    seq: int
    kind: str
    ts: float
    payload: Dict[str, Any] = field(default_factory=dict)
    tags: Dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> Dict[str, Any]:
        return {
            "seq": self.seq,
            "kind": self.kind,
            "ts": self.ts,
            "payload": dict(self.payload),
            "tags": dict(self.tags),
        }

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> "SinkRecord":
        return cls(
            seq=int(data.get("seq", 0)),
            kind=str(data.get("kind", "")),
            ts=float(data.get("ts", 0.0)),
            payload=dict(data.get("payload") or {}),
            tags=dict(data.get("tags") or {}),
        )


def _coerce_payload(outcome: Any) -> Dict[str, Any]:
    """Best-effort, never-raising conversion of a verdict to a JSON-safe dict."""
    if outcome is None:
        return {}
    as_dict = getattr(outcome, "as_dict", None)
    if callable(as_dict):
        try:
            value = as_dict()
            if isinstance(value, Mapping):
                return _json_safe(dict(value))
        except Exception:
            pass
    if isinstance(outcome, Mapping):
        return _json_safe(dict(outcome))
    try:
        return {"value": str(outcome)}
    except Exception:  # pragma: no cover - extremely defensive
        return {"value": "<unrepresentable>"}


def _json_safe(value: Any) -> Any:
    """Recursively coerce a payload into something ``json.dumps`` accepts."""
    if isinstance(value, Mapping):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


class DurableSink(abc.ABC):
    """Append-only, cross-run store of mesh verdicts.

    Concrete sinks must be **non-raising** on write and read. ``record_verdict``
    is the convenience entry point the gate uses; it coerces any agent verdict
    into a JSON-safe :class:`SinkRecord`.
    """

    @abc.abstractmethod
    def append(
        self,
        kind: str,
        payload: Mapping[str, Any],
        *,
        tags: Optional[Mapping[str, Any]] = None,
    ) -> Optional[SinkRecord]:
        """Persist one record; return it, or ``None`` if the write was dropped."""

    @abc.abstractmethod
    def read(self, limit: int = 50, *, kind: Optional[str] = None) -> List[SinkRecord]:
        """Return up to ``limit`` most-recent records (newest last)."""

    @abc.abstractmethod
    def counts_by_kind(self) -> Dict[str, int]:
        """Aggregate record count grouped by ``kind`` across all history."""

    @abc.abstractmethod
    def __len__(self) -> int:  # total durable records
        ...

    def record_verdict(
        self,
        kind: str,
        verdict: Any,
        *,
        tags: Optional[Mapping[str, Any]] = None,
    ) -> Optional[SinkRecord]:
        """Coerce ``verdict`` to a JSON-safe payload and append it. Never raises."""
        try:
            payload = _coerce_payload(verdict)
            return self.append(str(kind), payload, tags=tags)
        except Exception:  # pragma: no cover - sink must never crash the writer
            return None


class InMemoryDurableSink(DurableSink):
    """A fake, process-local durable sink for tests and the online dry-run.

    Bounded so a long-running dry-run loop cannot grow without limit; behaves
    like a durable store within a single process (survives across many
    ``run_cycle`` calls on the same instance).
    """

    def __init__(self, *, capacity: int = _DEFAULT_IN_MEMORY_CAPACITY) -> None:
        self._lock = threading.Lock()
        self._buffer: Deque[SinkRecord] = deque(
            maxlen=capacity if capacity and capacity > 0 else _DEFAULT_IN_MEMORY_CAPACITY
        )
        self._seq = 0

    def append(
        self,
        kind: str,
        payload: Mapping[str, Any],
        *,
        tags: Optional[Mapping[str, Any]] = None,
    ) -> Optional[SinkRecord]:
        with self._lock:
            self._seq += 1
            record = SinkRecord(
                seq=self._seq,
                kind=str(kind),
                ts=time.time(),
                payload=_json_safe(dict(payload)),
                tags=dict(tags or {}),
            )
            self._buffer.append(record)
            return record

    def read(self, limit: int = 50, *, kind: Optional[str] = None) -> List[SinkRecord]:
        with self._lock:
            items = [r for r in self._buffer if kind is None or r.kind == kind]
        if limit <= 0:
            return []
        return items[-limit:]

    def counts_by_kind(self) -> Dict[str, int]:
        with self._lock:
            out: Dict[str, int] = {}
            for record in self._buffer:
                out[record.kind] = out.get(record.kind, 0) + 1
            return out

    def __len__(self) -> int:
        with self._lock:
            return len(self._buffer)


class JsonlDurableSink(DurableSink):
    """A real durable sink: one JSON object per line, appended to a file.

    Cross-process durable — a fresh instance pointed at the same path reads back
    everything prior runs wrote. Defensive throughout: write failures and corrupt
    lines are swallowed so telemetry can never break the gate.
    """

    def __init__(self, path: os.PathLike[str] | str) -> None:
        self._path = Path(path)
        self._lock = threading.Lock()
        self._seq = self._highest_existing_seq()

    @property
    def path(self) -> Path:
        return self._path

    def _highest_existing_seq(self) -> int:
        highest = 0
        for record in self._iter_records():
            if record.seq > highest:
                highest = record.seq
        return highest

    def append(
        self,
        kind: str,
        payload: Mapping[str, Any],
        *,
        tags: Optional[Mapping[str, Any]] = None,
    ) -> Optional[SinkRecord]:
        with self._lock:
            self._seq += 1
            record = SinkRecord(
                seq=self._seq,
                kind=str(kind),
                ts=time.time(),
                payload=_json_safe(dict(payload)),
                tags=dict(tags or {}),
            )
            try:
                self._path.parent.mkdir(parents=True, exist_ok=True)
                line = json.dumps(record.as_dict(), separators=(",", ":"))
                with self._path.open("a", encoding="utf-8") as handle:
                    handle.write(line + "\n")
            except Exception:  # pragma: no cover - disk/permission failure
                self._seq -= 1
                return None
            return record

    def read(self, limit: int = 50, *, kind: Optional[str] = None) -> List[SinkRecord]:
        records = [
            r for r in self._iter_records() if kind is None or r.kind == kind
        ]
        if limit <= 0:
            return []
        return records[-limit:]

    def counts_by_kind(self) -> Dict[str, int]:
        out: Dict[str, int] = {}
        for record in self._iter_records():
            out[record.kind] = out.get(record.kind, 0) + 1
        return out

    def __len__(self) -> int:
        return sum(1 for _ in self._iter_records())

    def _iter_records(self):
        try:
            with self._path.open("r", encoding="utf-8") as handle:
                for line in handle:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        yield SinkRecord.from_dict(json.loads(line))
                    except Exception:  # corrupt line — skip, never raise
                        continue
        except FileNotFoundError:
            return
        except Exception:  # pragma: no cover - unreadable file
            return


class ObservabilitySnapshotSink(DurableSink):
    """Decorator that enriches each durable record with a telemetry snapshot.

    Wraps any inner :class:`DurableSink` and, on every append, attaches the
    current :meth:`LearningObservability.metrics_snapshot` (privacy-safe counts
    only) under ``tags["obs_snapshot"]`` — so cross-run history carries the live
    counters a drift detector needs. Read-only against observability: it calls a
    single public method and **never edits** the module. Fully non-raising; if
    the snapshot can't be read, the record is stored without it.
    """

    def __init__(self, inner: DurableSink, observability: LearningObservability) -> None:
        self._inner = inner
        self._observability = observability

    def _snapshot(self) -> Optional[Dict[str, Any]]:
        try:
            snap = self._observability.metrics_snapshot()
            if isinstance(snap, Mapping):
                return _json_safe(dict(snap))
        except Exception:  # pragma: no cover - telemetry must never break a write
            return None
        return None

    def append(
        self,
        kind: str,
        payload: Mapping[str, Any],
        *,
        tags: Optional[Mapping[str, Any]] = None,
    ) -> Optional[SinkRecord]:
        merged_tags: Dict[str, Any] = dict(tags or {})
        snapshot = self._snapshot()
        if snapshot is not None:
            merged_tags.setdefault("obs_snapshot", snapshot)
        return self._inner.append(kind, payload, tags=merged_tags)

    def read(self, limit: int = 50, *, kind: Optional[str] = None) -> List[SinkRecord]:
        return self._inner.read(limit, kind=kind)

    def counts_by_kind(self) -> Dict[str, int]:
        return self._inner.counts_by_kind()

    def __len__(self) -> int:
        return len(self._inner)


def build_durable_sink(
    path: Optional[os.PathLike[str] | str] = None,
    *,
    force: bool = False,
    observability: Optional[LearningObservability] = None,
) -> Optional[DurableSink]:
    """Construct a durable sink, honouring the dark-by-default kill-switch.

    Returns ``None`` (no sink) unless ``AGENT_MESH_MEMORY_SINK_V1`` is set or
    ``force=True``. With a ``path`` the sink is the cross-process
    :class:`JsonlDurableSink`; without one it is the process-local
    :class:`InMemoryDurableSink` (used by the online dry-run). When an
    ``observability`` instance is supplied the sink is wrapped so each record
    also carries a telemetry snapshot.
    """
    if not force and not durable_sink_enabled():
        return None
    base: DurableSink = JsonlDurableSink(path) if path is not None else InMemoryDurableSink()
    if observability is not None:
        return ObservabilitySnapshotSink(base, observability)
    return base


__all__ = [
    "SINK_FLAG",
    "SinkRecord",
    "DurableSink",
    "InMemoryDurableSink",
    "JsonlDurableSink",
    "ObservabilitySnapshotSink",
    "durable_sink_enabled",
    "build_durable_sink",
]
