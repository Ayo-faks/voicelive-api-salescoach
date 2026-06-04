"""MemoryAgent — bounded in-process recorder of mesh outcomes.

Phase 4 of the agent mesh. The other agents already produce structured,
serialisable verdicts (``SafeguardingVerdict``, ``Critique``,
``OrchestratedTurn``, ``AIOpsReport``, ``GenAIOpsVerdict``). The MemoryAgent
collects those outcomes into a bounded, append-only ring buffer so the mesh
has a queryable short-term trail — useful for an observability endpoint, a
post-incident replay, or feeding a CriticAgent retrospective.

Design rules (consistent with the rest of the mesh):

* **In-process only.** No database, no network, no disk. This is short-term
  working memory, not durable storage. Promotion to a real store
  (Postgres / App Insights) is a later phase and would live behind the same
  ``AGENT_MESH_ENABLED`` flag.
* **Bounded.** A fixed-capacity ``deque`` drops the oldest record once full,
  so an always-on recorder can never grow unbounded.
* **Non-raising and defensive.** ``record`` accepts any object: dataclasses
  with ``as_dict``, mappings, or primitives. A bad payload is stored as a
  best-effort string, never an exception.
* **Read-only consumers.** ``recent`` / ``query`` return copies; callers
  cannot mutate the buffer through them.
"""

from __future__ import annotations

import os
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Callable, Deque, Dict, List, Mapping, Optional

from src.agents.base import MeshAgent

DEFAULT_CAPACITY = 256


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return default
    return value if value > 0 else default


@dataclass(frozen=True)
class MemoryRecord:
    """A single recorded mesh outcome."""

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


_MEMORY_TOOLS = ("record_outcome", "read_memory")


class MemoryAgent(MeshAgent):
    """Bounded, append-only recorder of structured mesh outcomes."""

    name = "memory-agent"

    def __init__(
        self,
        *,
        capacity: Optional[int] = None,
        tool_call_budget: Optional[int] = None,
    ) -> None:
        super().__init__(
            allowed_tools=_MEMORY_TOOLS,
            tool_call_budget=tool_call_budget,
        )
        self.capacity = capacity if capacity and capacity > 0 else _env_int(
            "MEMORY_AGENT_CAPACITY", DEFAULT_CAPACITY
        )
        self._buffer: Deque[MemoryRecord] = deque(maxlen=self.capacity)
        self._seq = 0

    # -- Write --------------------------------------------------------------

    def record(
        self,
        kind: str,
        outcome: Any,
        *,
        tags: Optional[Mapping[str, Any]] = None,
    ) -> MemoryRecord:
        """Append an outcome to memory; returns the stored record.

        ``outcome`` may be a dataclass exposing ``as_dict()``, a mapping, or
        any primitive. The conversion is defensive and never raises.
        """

        self.ensure_tool_allowed("record_outcome")
        payload = self._coerce_payload(outcome)
        self._seq += 1
        record = MemoryRecord(
            seq=self._seq,
            kind=str(kind),
            ts=time.time(),
            payload=payload,
            tags=dict(tags or {}),
        )
        self._buffer.append(record)
        self.log(
            "record",
            kind=record.kind,
            seq=record.seq,
            size=len(self._buffer),
        )
        return record

    # -- Read (all return copies) ------------------------------------------

    def recent(self, limit: int = 20, *, kind: Optional[str] = None) -> List[MemoryRecord]:
        """Return up to ``limit`` most-recent records, newest last.

        Optionally filter by ``kind``.
        """

        self.ensure_tool_allowed("read_memory")
        items = [r for r in self._buffer if kind is None or r.kind == kind]
        if limit <= 0:
            return []
        return list(items[-limit:])

    def query(self, predicate: Callable[[MemoryRecord], bool]) -> List[MemoryRecord]:
        """Return all records matching ``predicate`` (oldest first)."""

        self.ensure_tool_allowed("read_memory")
        out: List[MemoryRecord] = []
        for record in self._buffer:
            try:
                if predicate(record):
                    out.append(record)
            except Exception:  # a bad predicate must not crash a read
                continue
        return out

    def counts_by_kind(self) -> Dict[str, int]:
        """Aggregate count of records grouped by ``kind``."""

        self.ensure_tool_allowed("read_memory")
        out: Dict[str, int] = {}
        for record in self._buffer:
            out[record.kind] = out.get(record.kind, 0) + 1
        return out

    def __len__(self) -> int:
        return len(self._buffer)

    def clear(self) -> None:
        """Drop all records (sequence counter is preserved)."""

        self._buffer.clear()
        self.log("clear")

    # -- Internals ----------------------------------------------------------

    @staticmethod
    def _coerce_payload(outcome: Any) -> Dict[str, Any]:
        if outcome is None:
            return {}
        as_dict = getattr(outcome, "as_dict", None)
        if callable(as_dict):
            try:
                value = as_dict()
                if isinstance(value, Mapping):
                    return dict(value)
            except Exception:
                pass
        if isinstance(outcome, Mapping):
            return dict(outcome)
        return {"value": MemoryAgent._safe_repr(outcome)}

    @staticmethod
    def _safe_repr(value: Any) -> str:
        try:
            return str(value)
        except Exception:  # pragma: no cover - extremely defensive
            return "<unrepresentable>"


__all__ = [
    "MemoryAgent",
    "MemoryRecord",
    "DEFAULT_CAPACITY",
]
