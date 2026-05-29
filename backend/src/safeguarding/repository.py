"""Repository for safeguarding events.

Persists events to Postgres via a lightweight connection callable so we
don't take a hard dependency on the larger ``PostgresStorageService``.
Provides an in-memory fallback for tests and dev (sqlite) deployments.
"""

from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Mapping, Optional, Protocol

from .models import Direction, SafeguardingVerdict, Severity

logger = logging.getLogger(__name__)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class SafeguardingEvent:
    id: str
    user_id: Optional[str]              # learner / child user id
    child_id: Optional[str]
    parent_user_id: Optional[str]       # account owner to notify
    session_id: Optional[str]
    direction: str
    severity: str
    categories: List[str]
    evidence_quote: str
    layer_scores: List[Dict[str, Any]]
    context_window: List[str] = field(default_factory=list)
    rationale: Optional[str] = None
    created_at: str = field(default_factory=_utc_now)
    acknowledged_at: Optional[str] = None
    acknowledged_by: Optional[str] = None
    action_taken: Optional[str] = None
    action_notes: Optional[str] = None

    @classmethod
    def from_verdict(
        cls,
        verdict: SafeguardingVerdict,
        *,
        user_id: Optional[str],
        child_id: Optional[str],
        parent_user_id: Optional[str],
        session_id: Optional[str],
        context_window: Optional[List[str]] = None,
    ) -> "SafeguardingEvent":
        return cls(
            id=str(uuid.uuid4()),
            user_id=user_id,
            child_id=child_id,
            parent_user_id=parent_user_id,
            session_id=session_id,
            direction=verdict.direction.value,
            severity=verdict.severity.value,
            categories=list(verdict.categories),
            evidence_quote=verdict.evidence_quote,
            layer_scores=[s.to_dict() for s in verdict.layer_scores],
            context_window=list(context_window or []),
            rationale=verdict.rationale,
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "user_id": self.user_id,
            "child_id": self.child_id,
            "parent_user_id": self.parent_user_id,
            "session_id": self.session_id,
            "direction": self.direction,
            "severity": self.severity,
            "categories": list(self.categories),
            "evidence_quote": self.evidence_quote,
            "layer_scores": list(self.layer_scores),
            "context_window": list(self.context_window),
            "rationale": self.rationale,
            "created_at": self.created_at,
            "acknowledged_at": self.acknowledged_at,
            "acknowledged_by": self.acknowledged_by,
            "action_taken": self.action_taken,
            "action_notes": self.action_notes,
        }


class SafeguardingRepository(Protocol):
    def insert(self, event: SafeguardingEvent) -> SafeguardingEvent: ...

    def list_recent(
        self,
        *,
        limit: int = 50,
        acknowledged: Optional[bool] = None,
    ) -> List[SafeguardingEvent]: ...

    def get(self, event_id: str) -> Optional[SafeguardingEvent]: ...

    def acknowledge(
        self,
        event_id: str,
        *,
        acknowledged_by: str,
        action_taken: str,
        action_notes: Optional[str],
    ) -> Optional[SafeguardingEvent]: ...


# ---------------------------------------------------------------------------
# In-memory implementation (tests + sqlite dev path)
# ---------------------------------------------------------------------------


class InMemorySafeguardingRepository:
    def __init__(self) -> None:
        self._events: List[SafeguardingEvent] = []

    def insert(self, event: SafeguardingEvent) -> SafeguardingEvent:
        self._events.append(event)
        return event

    def list_recent(
        self,
        *,
        limit: int = 50,
        acknowledged: Optional[bool] = None,
    ) -> List[SafeguardingEvent]:
        rows = list(reversed(self._events))
        if acknowledged is True:
            rows = [e for e in rows if e.acknowledged_at is not None]
        elif acknowledged is False:
            rows = [e for e in rows if e.acknowledged_at is None]
        return rows[:limit]

    def get(self, event_id: str) -> Optional[SafeguardingEvent]:
        for e in self._events:
            if e.id == event_id:
                return e
        return None

    def acknowledge(
        self,
        event_id: str,
        *,
        acknowledged_by: str,
        action_taken: str,
        action_notes: Optional[str],
    ) -> Optional[SafeguardingEvent]:
        event = self.get(event_id)
        if event is None or event.acknowledged_at is not None:
            return event
        event.acknowledged_at = _utc_now()
        event.acknowledged_by = acknowledged_by
        event.action_taken = action_taken
        event.action_notes = action_notes
        return event


# ---------------------------------------------------------------------------
# Postgres implementation
# ---------------------------------------------------------------------------


ConnectionFactory = Callable[[], Any]


class PostgresSafeguardingRepository:
    """Persist events using a psycopg connection factory.

    ``connection_factory`` should return a new psycopg connection per call
    (mirroring ``PostgresStorageService._connect``) so RLS GUCs flow
    through. The repository does not own the pool.
    """

    def __init__(self, connection_factory: ConnectionFactory):
        self._connect = connection_factory

    def insert(self, event: SafeguardingEvent) -> SafeguardingEvent:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO safeguarding_events (
                        id, user_id, child_id, parent_user_id, session_id,
                        direction, severity, categories, evidence_quote,
                        layer_scores, context_window, rationale, created_at
                    ) VALUES (
                        %s, %s, %s, %s, %s,
                        %s, %s, %s, %s,
                        %s, %s, %s, %s
                    )
                    """,
                    (
                        event.id,
                        event.user_id,
                        event.child_id,
                        event.parent_user_id,
                        event.session_id,
                        event.direction,
                        event.severity,
                        json.dumps(event.categories),
                        event.evidence_quote,
                        json.dumps(event.layer_scores),
                        json.dumps(event.context_window),
                        event.rationale,
                        event.created_at,
                    ),
                )
            conn.commit()
        return event

    def list_recent(
        self,
        *,
        limit: int = 50,
        acknowledged: Optional[bool] = None,
    ) -> List[SafeguardingEvent]:
        clauses = []
        params: List[Any] = []
        if acknowledged is True:
            clauses.append("acknowledged_at IS NOT NULL")
        elif acknowledged is False:
            clauses.append("acknowledged_at IS NULL")
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        params.append(int(limit))
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    SELECT * FROM safeguarding_events
                    {where}
                    ORDER BY created_at DESC
                    LIMIT %s
                    """,
                    tuple(params),
                )
                rows = cur.fetchall()
        return [_row_to_event(r) for r in rows]

    def get(self, event_id: str) -> Optional[SafeguardingEvent]:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM safeguarding_events WHERE id = %s", (event_id,))
                row = cur.fetchone()
        return _row_to_event(row) if row else None

    def acknowledge(
        self,
        event_id: str,
        *,
        acknowledged_by: str,
        action_taken: str,
        action_notes: Optional[str],
    ) -> Optional[SafeguardingEvent]:
        now = _utc_now()
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE safeguarding_events
                    SET acknowledged_at = %s,
                        acknowledged_by = %s,
                        action_taken = %s,
                        action_notes = %s
                    WHERE id = %s AND acknowledged_at IS NULL
                    RETURNING *
                    """,
                    (now, acknowledged_by, action_taken, action_notes, event_id),
                )
                row = cur.fetchone()
            conn.commit()
        return _row_to_event(row) if row else self.get(event_id)


def _row_to_event(row: Mapping[str, Any]) -> SafeguardingEvent:
    def _json_list(value: Any) -> List[Any]:
        if value is None:
            return []
        if isinstance(value, (list, tuple)):
            return list(value)
        try:
            parsed = json.loads(value) if isinstance(value, (str, bytes)) else value
        except (TypeError, json.JSONDecodeError):
            return []
        return list(parsed) if isinstance(parsed, list) else []

    return SafeguardingEvent(
        id=str(row["id"]),
        user_id=row.get("user_id"),
        child_id=row.get("child_id"),
        parent_user_id=row.get("parent_user_id"),
        session_id=row.get("session_id"),
        direction=str(row.get("direction") or "inbound"),
        severity=str(row.get("severity") or Severity.NONE.value),
        categories=[str(c) for c in _json_list(row.get("categories"))],
        evidence_quote=str(row.get("evidence_quote") or ""),
        layer_scores=[dict(s) if isinstance(s, dict) else s for s in _json_list(row.get("layer_scores"))],
        context_window=[str(c) for c in _json_list(row.get("context_window"))],
        rationale=row.get("rationale"),
        created_at=str(row.get("created_at") or _utc_now()),
        acknowledged_at=row.get("acknowledged_at"),
        acknowledged_by=row.get("acknowledged_by"),
        action_taken=row.get("action_taken"),
        action_notes=row.get("action_notes"),
    )
