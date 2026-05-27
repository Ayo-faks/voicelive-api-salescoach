"""Pathfinder W8 — Spaced-retrieval reminders via Web Push.

This module owns:

* Schema-light data types (``RevisionCard``, ``PushSubscription``).
* A storage adapter that talks to ``learning_revision_cards`` /
  ``learning_push_subscriptions`` via the existing Postgres storage service
  (so RLS GUCs set by ``set_request_actor()`` flow through), with an
  in-memory fallback for tests and pilot/offline mode.
* A pure-Python dispatcher that selects due cards and fans out via
  ``pywebpush``. The dispatcher is exposed as ``python -m
  src.learning.notifications`` and intended to run as a Container Apps Job
  on a ``*/5 * * * *`` schedule. It is also safe to invoke from a unit
  test with a fake ``webpush_sender``.

The module deliberately does **not** mutate ``LearningRepository``: it
keeps its own narrow protocol so the existing learning surface stays
stable and the W8 commit is reviewable in isolation.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Iterable, List, Mapping, Optional, Protocol
from uuid import uuid4

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# VAPID configuration
# ---------------------------------------------------------------------------

VAPID_PUBLIC_KEY_ENV = "VAPID_PUBLIC_KEY"
VAPID_PRIVATE_KEY_ENV = "VAPID_PRIVATE_KEY"
VAPID_SUBJECT_ENV = "VAPID_SUBJECT"
DEFAULT_VAPID_SUBJECT = "mailto:notify@wulo.ai"


@dataclass(frozen=True)
class VapidConfig:
    public_key: str
    private_key: str
    subject: str

    @property
    def configured(self) -> bool:
        return bool(self.public_key and self.private_key)


def load_vapid_config(env: Optional[Mapping[str, str]] = None) -> VapidConfig:
    source = env if env is not None else os.environ
    return VapidConfig(
        public_key=(source.get(VAPID_PUBLIC_KEY_ENV) or "").strip(),
        private_key=(source.get(VAPID_PRIVATE_KEY_ENV) or "").strip(),
        subject=(source.get(VAPID_SUBJECT_ENV) or DEFAULT_VAPID_SUBJECT).strip(),
    )


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class RevisionCard:
    id: str
    tenant_id: str
    user_id: str
    topic_id: str
    label: str
    due_at: str
    status: str = "pending"
    payload: Mapping[str, Any] = field(default_factory=dict)
    attempts: int = 0
    last_error: Optional[str] = None
    sent_at: Optional[str] = None
    created_at: str = field(default_factory=_utc_now)
    updated_at: str = field(default_factory=_utc_now)


@dataclass
class PushSubscription:
    id: str
    tenant_id: str
    user_id: str
    endpoint: str
    p256dh: str
    auth: str
    user_agent: Optional[str] = None
    created_at: str = field(default_factory=_utc_now)
    revoked_at: Optional[str] = None

    def as_webpush_dict(self) -> Mapping[str, Any]:
        return {
            "endpoint": self.endpoint,
            "keys": {"p256dh": self.p256dh, "auth": self.auth},
        }


# ---------------------------------------------------------------------------
# Repository protocol + implementations
# ---------------------------------------------------------------------------


class NotificationsRepository(Protocol):
    def upsert_subscription(self, sub: PushSubscription) -> PushSubscription: ...

    def list_active_subscriptions(
        self, tenant_id: str, user_id: str
    ) -> List[PushSubscription]: ...

    def revoke_subscription(self, endpoint: str) -> None: ...

    def schedule_cards(self, cards: Iterable[RevisionCard]) -> List[RevisionCard]: ...

    def list_due_cards(self, *, now_iso: str, limit: int = 100) -> List[RevisionCard]: ...

    def list_user_cards(
        self, tenant_id: str, user_id: str, *, limit: int = 50
    ) -> List[RevisionCard]: ...

    def mark_card_sent(self, card_id: str, *, sent_at: str) -> None: ...

    def mark_card_failed(self, card_id: str, *, error: str) -> None: ...


class InMemoryNotificationsRepository:
    """In-process repository for tests and pilot/offline mode."""

    def __init__(self) -> None:
        self._subscriptions: List[PushSubscription] = []
        self._cards: List[RevisionCard] = []

    def upsert_subscription(self, sub: PushSubscription) -> PushSubscription:
        for index, existing in enumerate(self._subscriptions):
            if existing.endpoint == sub.endpoint:
                # Re-activate if previously revoked and refresh keys.
                refreshed = PushSubscription(
                    id=existing.id,
                    tenant_id=sub.tenant_id,
                    user_id=sub.user_id,
                    endpoint=sub.endpoint,
                    p256dh=sub.p256dh,
                    auth=sub.auth,
                    user_agent=sub.user_agent or existing.user_agent,
                    created_at=existing.created_at,
                    revoked_at=None,
                )
                self._subscriptions[index] = refreshed
                return refreshed
        self._subscriptions.append(sub)
        return sub

    def list_active_subscriptions(
        self, tenant_id: str, user_id: str
    ) -> List[PushSubscription]:
        return [
            s
            for s in self._subscriptions
            if s.tenant_id == tenant_id and s.user_id == user_id and s.revoked_at is None
        ]

    def revoke_subscription(self, endpoint: str) -> None:
        for index, existing in enumerate(self._subscriptions):
            if existing.endpoint == endpoint and existing.revoked_at is None:
                self._subscriptions[index] = PushSubscription(
                    id=existing.id,
                    tenant_id=existing.tenant_id,
                    user_id=existing.user_id,
                    endpoint=existing.endpoint,
                    p256dh=existing.p256dh,
                    auth=existing.auth,
                    user_agent=existing.user_agent,
                    created_at=existing.created_at,
                    revoked_at=_utc_now(),
                )
                return

    def schedule_cards(self, cards: Iterable[RevisionCard]) -> List[RevisionCard]:
        saved: List[RevisionCard] = []
        for card in cards:
            self._cards.append(card)
            saved.append(card)
        return saved

    def list_due_cards(self, *, now_iso: str, limit: int = 100) -> List[RevisionCard]:
        due = [
            c
            for c in self._cards
            if c.status == "pending" and c.due_at <= now_iso
        ]
        due.sort(key=lambda c: c.due_at)
        return due[:limit]

    def list_user_cards(
        self, tenant_id: str, user_id: str, *, limit: int = 50
    ) -> List[RevisionCard]:
        rows = [
            c
            for c in self._cards
            if c.tenant_id == tenant_id and c.user_id == user_id
        ]
        rows.sort(key=lambda c: c.due_at)
        return rows[:limit]

    def mark_card_sent(self, card_id: str, *, sent_at: str) -> None:
        for index, card in enumerate(self._cards):
            if card.id == card_id:
                card.status = "sent"
                card.sent_at = sent_at
                card.updated_at = sent_at
                self._cards[index] = card
                return

    def mark_card_failed(self, card_id: str, *, error: str) -> None:
        for index, card in enumerate(self._cards):
            if card.id == card_id:
                card.attempts += 1
                card.last_error = error
                card.updated_at = _utc_now()
                if card.attempts >= 3:
                    card.status = "failed"
                self._cards[index] = card
                return


class PostgresNotificationsRepository:
    """Postgres-backed repository using the shared storage service."""

    def __init__(self, storage: Any) -> None:
        self.storage = storage

    # ------------------------------------------------------------ subscriptions
    def upsert_subscription(self, sub: PushSubscription) -> PushSubscription:
        created_at = self.storage._utc_now()

        def persist(connection: Any) -> None:
            connection.execute(
                """
                INSERT INTO learning_push_subscriptions (
                    id, tenant_id, user_id, endpoint, p256dh, auth,
                    user_agent, created_at, revoked_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NULL)
                ON CONFLICT (endpoint) DO UPDATE SET
                    p256dh = EXCLUDED.p256dh,
                    auth = EXCLUDED.auth,
                    user_agent = EXCLUDED.user_agent,
                    revoked_at = NULL
                """,
                (
                    sub.id,
                    sub.tenant_id,
                    sub.user_id,
                    sub.endpoint,
                    sub.p256dh,
                    sub.auth,
                    sub.user_agent,
                    created_at,
                ),
            )

        self.storage._execute_write(persist)
        return PushSubscription(
            id=sub.id,
            tenant_id=sub.tenant_id,
            user_id=sub.user_id,
            endpoint=sub.endpoint,
            p256dh=sub.p256dh,
            auth=sub.auth,
            user_agent=sub.user_agent,
            created_at=created_at,
            revoked_at=None,
        )

    def list_active_subscriptions(
        self, tenant_id: str, user_id: str
    ) -> List[PushSubscription]:
        def query(connection: Any):
            cursor = connection.execute(
                """
                SELECT id, tenant_id, user_id, endpoint, p256dh, auth,
                       user_agent, created_at, revoked_at
                FROM learning_push_subscriptions
                WHERE tenant_id = %s AND user_id = %s AND revoked_at IS NULL
                """,
                (tenant_id, user_id),
            )
            return cursor.fetchall()

        rows = self.storage._execute_read(query) or []
        return [_row_to_subscription(r) for r in rows]

    def revoke_subscription(self, endpoint: str) -> None:
        revoked_at = self.storage._utc_now()

        def persist(connection: Any) -> None:
            connection.execute(
                "UPDATE learning_push_subscriptions SET revoked_at = %s "
                "WHERE endpoint = %s AND revoked_at IS NULL",
                (revoked_at, endpoint),
            )

        self.storage._execute_write(persist)

    # --------------------------------------------------------------- cards
    def schedule_cards(self, cards: Iterable[RevisionCard]) -> List[RevisionCard]:
        materialised = list(cards)
        if not materialised:
            return []
        created_at = self.storage._utc_now()

        def persist(connection: Any) -> None:
            for card in materialised:
                connection.execute(
                    """
                    INSERT INTO learning_revision_cards (
                        id, tenant_id, user_id, topic_id, label, due_at,
                        status, payload_json, attempts, last_error, sent_at,
                        created_at, updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 0, NULL, NULL, %s, %s)
                    ON CONFLICT (id) DO NOTHING
                    """,
                    (
                        card.id,
                        card.tenant_id,
                        card.user_id,
                        card.topic_id,
                        card.label,
                        card.due_at,
                        card.status,
                        self.storage._dumps_json(dict(card.payload)),
                        created_at,
                        created_at,
                    ),
                )

        self.storage._execute_write(persist)
        for card in materialised:
            card.created_at = created_at
            card.updated_at = created_at
        return materialised

    def list_due_cards(self, *, now_iso: str, limit: int = 100) -> List[RevisionCard]:
        def query(connection: Any):
            cursor = connection.execute(
                """
                SELECT id, tenant_id, user_id, topic_id, label, due_at,
                       status, payload_json, attempts, last_error, sent_at,
                       created_at, updated_at
                FROM learning_revision_cards
                WHERE status = 'pending' AND due_at <= %s
                ORDER BY due_at ASC
                LIMIT %s
                """,
                (now_iso, limit),
            )
            return cursor.fetchall()

        rows = self.storage._execute_read(query) or []
        return [_row_to_card(r) for r in rows]

    def list_user_cards(
        self, tenant_id: str, user_id: str, *, limit: int = 50
    ) -> List[RevisionCard]:
        def query(connection: Any):
            cursor = connection.execute(
                """
                SELECT id, tenant_id, user_id, topic_id, label, due_at,
                       status, payload_json, attempts, last_error, sent_at,
                       created_at, updated_at
                FROM learning_revision_cards
                WHERE tenant_id = %s AND user_id = %s
                ORDER BY due_at ASC
                LIMIT %s
                """,
                (tenant_id, user_id, limit),
            )
            return cursor.fetchall()

        rows = self.storage._execute_read(query) or []
        return [_row_to_card(r) for r in rows]

    def mark_card_sent(self, card_id: str, *, sent_at: str) -> None:
        def persist(connection: Any) -> None:
            connection.execute(
                "UPDATE learning_revision_cards SET status = 'sent', sent_at = %s, "
                "updated_at = %s WHERE id = %s",
                (sent_at, sent_at, card_id),
            )

        self.storage._execute_write(persist)

    def mark_card_failed(self, card_id: str, *, error: str) -> None:
        updated_at = self.storage._utc_now()

        def persist(connection: Any) -> None:
            connection.execute(
                """
                UPDATE learning_revision_cards
                SET attempts = attempts + 1,
                    last_error = %s,
                    status = CASE WHEN attempts + 1 >= 3 THEN 'failed' ELSE status END,
                    updated_at = %s
                WHERE id = %s
                """,
                (error, updated_at, card_id),
            )

        self.storage._execute_write(persist)


def _row_to_subscription(row: Any) -> PushSubscription:
    keys = ("id", "tenant_id", "user_id", "endpoint", "p256dh", "auth",
            "user_agent", "created_at", "revoked_at")
    if isinstance(row, Mapping):
        data = {k: row.get(k) for k in keys}
    else:
        data = dict(zip(keys, row))
    return PushSubscription(**data)


def _row_to_card(row: Any) -> RevisionCard:
    keys = ("id", "tenant_id", "user_id", "topic_id", "label", "due_at",
            "status", "payload_json", "attempts", "last_error", "sent_at",
            "created_at", "updated_at")
    if isinstance(row, Mapping):
        data = {k: row.get(k) for k in keys}
    else:
        data = dict(zip(keys, row))
    payload = data.pop("payload_json", None) or {}
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except json.JSONDecodeError:
            payload = {}
    data["payload"] = payload
    return RevisionCard(**data)


# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------


WebPushSender = Callable[[Mapping[str, Any], str, VapidConfig], None]


def _default_webpush_sender(subscription_info: Mapping[str, Any], payload: str, vapid: VapidConfig) -> None:
    # Imported lazily so the module is importable when pywebpush is absent
    # (e.g., in CI for the InMemory tests).
    from pywebpush import webpush  # type: ignore

    webpush(
        subscription_info=dict(subscription_info),
        data=payload,
        vapid_private_key=vapid.private_key,
        vapid_claims={"sub": vapid.subject},
    )


@dataclass
class DispatchResult:
    inspected: int
    sent: int
    failed: int
    revoked: int


def dispatch_due_cards(
    repo: NotificationsRepository,
    vapid: VapidConfig,
    *,
    now_iso: Optional[str] = None,
    limit: int = 100,
    sender: WebPushSender = _default_webpush_sender,
) -> DispatchResult:
    """Send pushes for any cards whose ``due_at`` has elapsed.

    Side effects:

    * Marks cards ``sent`` on success / ``failed`` after 3 attempts.
    * Revokes subscriptions that the push service rejects with 404 / 410.

    The sender is injectable so unit tests can avoid a real network call.
    """

    if not vapid.configured:
        logger.warning("dispatch_due_cards: VAPID keys not configured; skipping")
        return DispatchResult(0, 0, 0, 0)

    when = now_iso or _utc_now()
    due_cards = repo.list_due_cards(now_iso=when, limit=limit)
    sent = 0
    failed = 0
    revoked = 0

    for card in due_cards:
        subs = repo.list_active_subscriptions(card.tenant_id, card.user_id)
        if not subs:
            repo.mark_card_failed(card.id, error="no_active_subscription")
            failed += 1
            continue

        payload = json.dumps(
            {
                "title": "Time for a quick check-in",
                "body": card.label,
                "topic_id": card.topic_id,
                "card_id": card.id,
                "url": f"/practice/{card.topic_id}",
            }
        )

        delivered_any = False
        for sub in subs:
            try:
                sender(sub.as_webpush_dict(), payload, vapid)
                delivered_any = True
            except Exception as exc:  # pywebpush surfaces 4xx as WebPushException
                status = _extract_status_code(exc)
                if status in (404, 410):
                    repo.revoke_subscription(sub.endpoint)
                    revoked += 1
                else:
                    logger.exception("webpush_send_failed endpoint=%s", sub.endpoint)

        if delivered_any:
            repo.mark_card_sent(card.id, sent_at=_utc_now())
            sent += 1
        else:
            repo.mark_card_failed(card.id, error="all_subscriptions_failed")
            failed += 1

    return DispatchResult(inspected=len(due_cards), sent=sent, failed=failed, revoked=revoked)


def _extract_status_code(exc: BaseException) -> Optional[int]:
    response = getattr(exc, "response", None)
    return getattr(response, "status_code", None)


__all__ = [
    "DispatchResult",
    "InMemoryNotificationsRepository",
    "NotificationsRepository",
    "PostgresNotificationsRepository",
    "PushSubscription",
    "RevisionCard",
    "VapidConfig",
    "dispatch_due_cards",
    "load_vapid_config",
]
