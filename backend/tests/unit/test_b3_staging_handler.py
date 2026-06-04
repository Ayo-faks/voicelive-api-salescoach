"""Track B / B3 — staging HTTP handler tests (no network; injected transport)."""

from __future__ import annotations

import pytest

from src.learning.eval.b3_driver import MESH_ENABLED_FLAG
from src.learning.eval.b3_staging_handler import (
    B3_STAGING_HANDLER_FLAG,
    B3StagingHandlerDarkError,
    B3StagingTargetError,
    StagingHttpTurnHandler,
    b3_staging_handler_enabled,
    build_staging_handler,
)
from src.learning.eval.personas import PersonaTurn


@pytest.fixture(autouse=True)
def _clear(monkeypatch):
    monkeypatch.delenv(MESH_ENABLED_FLAG, raising=False)
    monkeypatch.delenv(B3_STAGING_HANDLER_FLAG, raising=False)
    yield


def _enable(monkeypatch):
    monkeypatch.setenv(MESH_ENABLED_FLAG, "1")
    monkeypatch.setenv(B3_STAGING_HANDLER_FLAG, "1")


def _turn(prompt="hello"):
    return PersonaTurn(prompt=prompt, expected_outcome="answer")


# ------------------------------- flags -------------------------------------- #
def test_dark_by_default(monkeypatch):
    assert b3_staging_handler_enabled() is False


def test_build_raises_when_dark(monkeypatch):
    with pytest.raises(B3StagingHandlerDarkError):
        build_staging_handler("https://staging-sen.wulo.ai", operator="ops-alice")


def test_requires_both_flags(monkeypatch):
    monkeypatch.setenv(MESH_ENABLED_FLAG, "1")
    assert b3_staging_handler_enabled() is False
    with pytest.raises(B3StagingHandlerDarkError):
        build_staging_handler("https://staging-sen.wulo.ai", operator="ops-alice")


# ----------------------------- target guard --------------------------------- #
def test_rejects_prod_target(monkeypatch):
    _enable(monkeypatch)
    with pytest.raises(B3StagingTargetError):
        build_staging_handler("https://app.wulo.ai", operator="ops-alice")


def test_requires_named_operator(monkeypatch):
    _enable(monkeypatch)
    with pytest.raises(B3StagingTargetError):
        build_staging_handler("https://staging-sen.wulo.ai", operator="  ")


def test_requires_base_url(monkeypatch):
    _enable(monkeypatch)
    with pytest.raises(B3StagingTargetError):
        build_staging_handler("", operator="ops-alice")


# ---------------------------- outcome mapping ------------------------------- #
def test_handle_maps_known_outcome(monkeypatch):
    _enable(monkeypatch)
    seen = {}

    def transport(url, body, headers):
        seen["url"] = url
        seen["body"] = body
        return {"outcome": "refusal", "response_excerpt": "I can't help with that"}

    handler = build_staging_handler(
        "https://staging-sen.wulo.ai",
        operator="ops-alice",
        transport=transport,
    )
    result = handler.handle(_turn("test"))
    assert result == {
        "outcome": "refusal",
        "synthetic": True,
        "response_excerpt": "I can't help with that",
    }
    assert seen["url"].endswith("/internal/agent-mesh/score")
    assert seen["body"]["operator"] == "ops-alice"
    assert seen["body"]["synthetic"] is True


def test_handle_normalises_unknown_outcome(monkeypatch):
    _enable(monkeypatch)

    def transport(url, body, headers):
        return {"outcome": "weird-label"}

    handler = build_staging_handler(
        "https://staging-sen.wulo.ai",
        operator="ops-alice",
        transport=transport,
    )
    assert handler.handle(_turn())["outcome"] == "answer"


def test_token_sets_auth_header(monkeypatch):
    _enable(monkeypatch)
    captured = {}

    def transport(url, body, headers):
        captured["headers"] = dict(headers)
        return {"outcome": "answer"}

    handler = build_staging_handler(
        "https://staging-sen.wulo.ai",
        operator="ops-alice",
        token="secret",
        transport=transport,
    )
    handler.handle(_turn())
    assert captured["headers"]["Authorization"] == "Bearer secret"


def test_require_flags_false_allows_offline_construction(monkeypatch):
    # The dark gate can be bypassed only by an explicit opt-out (used by tests),
    # never by env drift.
    handler = StagingHttpTurnHandler(
        "https://staging-sen.wulo.ai",
        operator="ops-alice",
        transport=lambda u, b, h: {"outcome": "answer"},
        require_flags=False,
    )
    assert handler.handle(_turn())["outcome"] == "answer"
