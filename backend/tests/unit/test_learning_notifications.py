"""Unit tests for W8 — spaced-retrieval Web Push.

Covers:
* In-memory repository CRUD + revoked-then-reupserted reactivation.
* Dispatcher no-op when VAPID is unconfigured.
* Dispatcher revokes endpoint on 404/410.
* Dispatcher marks card failed when all subscriptions error.
* ``mark_card_failed`` flips to ``failed`` after 3 attempts.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, List, Mapping

import pytest

from src.learning.notifications import (
    DispatchResult,
    InMemoryNotificationsRepository,
    PushSubscription,
    RevisionCard,
    VapidConfig,
    dispatch_due_cards,
    load_vapid_config,
)


TENANT = "tenant-tests"
USER = "user-tests"


def _sub(endpoint: str = "https://push.example/a") -> PushSubscription:
    return PushSubscription(
        id="sub-1",
        tenant_id=TENANT,
        user_id=USER,
        endpoint=endpoint,
        p256dh="p256dh-key",
        auth="auth-key",
        user_agent="test-agent",
    )


def _card(card_id: str = "card-1", due_at: str = "2020-01-01T00:00:00+00:00") -> RevisionCard:
    return RevisionCard(
        id=card_id,
        tenant_id=TENANT,
        user_id=USER,
        topic_id="topic-fractions",
        label="Today · 10 minutes after this exercise",
        due_at=due_at,
    )


# ---------------------------------------------------------------------------
# Repo behaviour
# ---------------------------------------------------------------------------


def test_load_vapid_config_defaults_to_unconfigured():
    cfg = load_vapid_config(env={})
    assert cfg.configured is False
    assert cfg.subject == "mailto:notify@wulo.ai"


def test_load_vapid_config_strips_whitespace():
    cfg = load_vapid_config(
        env={
            "VAPID_PUBLIC_KEY": " pub ",
            "VAPID_PRIVATE_KEY": " priv ",
            "VAPID_SUBJECT": " mailto:ops@wulo.ai ",
        }
    )
    assert cfg.configured is True
    assert cfg.public_key == "pub"
    assert cfg.subject == "mailto:ops@wulo.ai"


def test_inmemory_upsert_reactivates_revoked_subscription():
    repo = InMemoryNotificationsRepository()
    sub = _sub()
    repo.upsert_subscription(sub)
    assert len(repo.list_active_subscriptions(TENANT, USER)) == 1

    repo.revoke_subscription(sub.endpoint)
    assert repo.list_active_subscriptions(TENANT, USER) == []

    repo.upsert_subscription(_sub())
    active = repo.list_active_subscriptions(TENANT, USER)
    assert len(active) == 1
    assert active[0].revoked_at is None


def test_inmemory_schedule_and_list_user_cards_sorted_by_due_at():
    repo = InMemoryNotificationsRepository()
    repo.schedule_cards(
        [
            _card("c-late", "2030-06-01T00:00:00+00:00"),
            _card("c-early", "2020-06-01T00:00:00+00:00"),
        ]
    )
    cards = repo.list_user_cards(TENANT, USER)
    assert [c.id for c in cards] == ["c-early", "c-late"]


def test_inmemory_mark_card_failed_promotes_to_failed_after_three_attempts():
    repo = InMemoryNotificationsRepository()
    card = _card()
    repo.schedule_cards([card])
    for _ in range(3):
        repo.mark_card_failed(card.id, error="boom")
    only = repo.list_user_cards(TENANT, USER)[0]
    assert only.status == "failed"
    assert only.attempts == 3
    assert only.last_error == "boom"


# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------


def test_dispatch_due_cards_skips_when_vapid_unconfigured():
    repo = InMemoryNotificationsRepository()
    repo.upsert_subscription(_sub())
    repo.schedule_cards([_card()])

    result = dispatch_due_cards(repo, VapidConfig(public_key="", private_key="", subject=""))

    assert result == DispatchResult(0, 0, 0, 0)
    # Card stays pending so the next cron run picks it up.
    assert repo.list_user_cards(TENANT, USER)[0].status == "pending"


@dataclass
class _FakePushException(Exception):
    status_code: int

    @property
    def response(self) -> Any:
        outer = self

        class _R:
            status_code = outer.status_code

        return _R()


def test_dispatch_due_cards_revokes_endpoint_on_410():
    repo = InMemoryNotificationsRepository()
    repo.upsert_subscription(_sub("https://push.example/gone"))
    repo.schedule_cards([_card()])
    vapid = VapidConfig(public_key="pub", private_key="priv", subject="mailto:x@y")

    def gone_sender(sub_info: Mapping[str, Any], payload: str, cfg: VapidConfig) -> None:
        raise _FakePushException(410)

    result = dispatch_due_cards(repo, vapid, sender=gone_sender)

    assert result.revoked == 1
    assert result.failed == 1  # card itself ended up with no delivery
    assert repo.list_active_subscriptions(TENANT, USER) == []
    assert repo.list_user_cards(TENANT, USER)[0].status == "pending"  # only 1 attempt so far


def test_dispatch_due_cards_marks_card_sent_when_any_subscription_succeeds():
    repo = InMemoryNotificationsRepository()
    repo.upsert_subscription(_sub("https://push.example/ok"))
    repo.schedule_cards([_card()])
    vapid = VapidConfig(public_key="pub", private_key="priv", subject="mailto:x@y")

    sent_payloads: List[str] = []

    def ok_sender(sub_info: Mapping[str, Any], payload: str, cfg: VapidConfig) -> None:
        sent_payloads.append(payload)

    result = dispatch_due_cards(repo, vapid, sender=ok_sender)

    assert result.sent == 1
    assert result.failed == 0
    assert "10 minutes after this exercise" in sent_payloads[0]
    assert repo.list_user_cards(TENANT, USER)[0].status == "sent"


def test_dispatch_due_cards_marks_card_failed_when_no_active_subscriptions():
    repo = InMemoryNotificationsRepository()
    repo.schedule_cards([_card()])
    vapid = VapidConfig(public_key="pub", private_key="priv", subject="mailto:x@y")

    def never_called(sub_info: Mapping[str, Any], payload: str, cfg: VapidConfig) -> None:
        raise AssertionError("sender should not be invoked without active subscriptions")

    result = dispatch_due_cards(repo, vapid, sender=never_called)

    assert result == DispatchResult(inspected=1, sent=0, failed=1, revoked=0)
    only = repo.list_user_cards(TENANT, USER)[0]
    assert only.attempts == 1
    assert only.last_error == "no_active_subscription"


# ---------------------------------------------------------------------------
# LearningApi integration
# ---------------------------------------------------------------------------


def test_learning_api_register_and_list_revision_cards_round_trip():
    pytest.importorskip("flask")
    from flask import Flask

    from src.learning.api import LearningApi, register_learning_api

    api = LearningApi(notifications_repository=InMemoryNotificationsRepository())
    app = Flask(__name__)
    register_learning_api(app, api=api)

    client = app.test_client()

    sub_resp = client.post(
        "/api/learning/notifications/push/subscribe",
        json={
            "user_id": "learner-1",
            "subscription": {
                "endpoint": "https://push.example/sub1",
                "keys": {"p256dh": "p", "auth": "a"},
            },
        },
    )
    assert sub_resp.status_code == 200, sub_resp.get_json()
    assert sub_resp.get_json()["ok"] is True

    schedule_resp = client.post(
        "/api/learning/notifications/revision-cards/schedule",
        json={
            "user_id": "learner-1",
            "cards": [
                {
                    "topic_id": "topic-fractions",
                    "label": "Today · 10 minutes after this exercise",
                    "due_at": "2020-01-01T00:00:00+00:00",
                }
            ],
        },
    )
    assert schedule_resp.status_code == 200
    assert schedule_resp.get_json()["scheduled"] == 1

    list_resp = client.get("/api/learning/notifications/revision-cards?user_id=learner-1")
    cards = list_resp.get_json()["cards"]
    assert len(cards) == 1
    assert cards[0]["topic_id"] == "topic-fractions"
    assert cards[0]["status"] == "pending"


def test_learning_api_vapid_public_key_reports_configured_flag():
    pytest.importorskip("flask")
    from flask import Flask

    from src.learning.api import LearningApi, register_learning_api

    api = LearningApi(
        notifications_repository=InMemoryNotificationsRepository(),
        vapid_config=VapidConfig(public_key="pub-xyz", private_key="priv", subject="mailto:x@y"),
    )
    app = Flask(__name__)
    register_learning_api(app, api=api)

    resp = app.test_client().get("/api/learning/notifications/push/vapid-public-key")
    body = resp.get_json()
    assert body["publicKey"] == "pub-xyz"
    assert body["configured"] is True
