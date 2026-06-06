"""Tests for the /api/events telemetry sink."""

from __future__ import annotations

import json
import logging
import os

import pytest
from flask.testing import FlaskClient

import src.app as app_module
from src.app import app


def _auth_headers() -> dict[str, str]:
    return {
        "X-MS-CLIENT-PRINCIPAL-ID": "events-user-1",
        "X-MS-CLIENT-PRINCIPAL-NAME": "Events User",
        "X-MS-CLIENT-PRINCIPAL-EMAIL": "events@example.com",
        "X-MS-CLIENT-PRINCIPAL-IDP": "aad",
    }


def _user_payload() -> dict[str, str]:
    return {
        "id": "events-user-1",
        "name": "Events User",
        "email": "events@example.com",
        "provider": "aad",
        "role": "parent",
    }


@pytest.fixture()
def client() -> FlaskClient:
    os.environ["LOCAL_DEV_AUTH"] = "false"
    app.config["TESTING"] = True
    # Reset the in-process rate-limit bucket so each test starts at zero.
    app_module._telemetry_rate_buckets.clear()  # type: ignore[attr-defined]
    return app.test_client()


def _post_event(client: FlaskClient, body: dict, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(app_module, "_get_authenticated_user", lambda: _user_payload())
    return client.post(
        "/api/events",
        data=json.dumps(body),
        content_type="application/json",
        headers=_auth_headers(),
    )


def test_accepts_allowed_event(client, monkeypatch):
    response = _post_event(
        client,
        {"name": "parent_summary_shared", "props": {"channel": "copy"}, "ts": "2026-04-19T00:00:00Z"},
        monkeypatch,
    )
    assert response.status_code == 202
    payload = response.get_json()
    assert payload == {"accepted": True}


def test_drops_unknown_event_with_202(client, monkeypatch):
    response = _post_event(client, {"name": "not_on_the_list"}, monkeypatch)
    assert response.status_code == 202
    payload = response.get_json()
    assert payload == {"accepted": False, "reason": "unknown_event"}


def test_truncates_oversize_props(client, monkeypatch, caplog):
    # ``caplog`` captures via a handler attached to the *root* logger, so the
    # emitting logger must propagate for the record to be seen. Earlier tests in
    # a full-suite run can leave ``pathfinder.telemetry.propagate`` toggled off,
    # which silently drops the record under some orderings. Force propagation for
    # the duration of this test (restoring it afterwards) to make capture
    # deterministic without relaxing the assertion below.
    telemetry_logger = logging.getLogger("pathfinder.telemetry")
    previous_propagate = telemetry_logger.propagate
    telemetry_logger.propagate = True
    huge = {"blob": "x" * 5000}
    try:
        with caplog.at_level(logging.INFO, logger="pathfinder.telemetry"):
            response = _post_event(
                client,
                {"name": "voice_pill_state_changed", "props": huge},
                monkeypatch,
            )
        assert response.status_code == 202
        truncated_records = [
            r for r in caplog.records if getattr(r, "event_props", None) == {"_truncated": True}
        ]
        assert truncated_records, "expected the oversize payload to be replaced with {_truncated: True}"
    finally:
        telemetry_logger.propagate = previous_propagate


def test_rate_limits_after_burst(client, monkeypatch):
    monkeypatch.setattr(app_module, "_TELEMETRY_RATE_LIMIT_MAX_EVENTS", 3)
    # Bucket was cleared in the fixture so the first 3 requests must be accepted.
    for _ in range(3):
        response = _post_event(client, {"name": "trust_badge_clicked"}, monkeypatch)
        assert response.status_code == 202

    blocked = _post_event(client, {"name": "trust_badge_clicked"}, monkeypatch)
    assert blocked.status_code == 429
    assert blocked.get_json() == {"accepted": False, "reason": "rate_limited"}


def test_requires_authentication(client):
    # No monkeypatch — guard should reject because no real auth headers are set.
    response = client.post(
        "/api/events",
        data=json.dumps({"name": "trust_badge_clicked"}),
        content_type="application/json",
    )
    assert response.status_code == 401
