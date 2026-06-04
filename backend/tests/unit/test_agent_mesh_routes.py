from __future__ import annotations

from flask import Flask
import pytest

from src.learning.agent_mesh_routes import SCORE_PATH, SCORE_TOKEN_ENV
from src.learning.api import LearningApi, register_learning_api


@pytest.fixture()
def client():
    app = Flask(__name__)
    app.config["TESTING"] = True
    register_learning_api(app, LearningApi())
    return app.test_client()


@pytest.fixture()
def armed(monkeypatch: pytest.MonkeyPatch):
    """Both flags set — the route is live."""
    monkeypatch.setenv("AGENT_MESH_ENABLED", "1")
    monkeypatch.setenv("AGENT_MESH_SCORE_ROUTE_V1", "1")
    monkeypatch.delenv(SCORE_TOKEN_ENV, raising=False)


def _post(client, **body):
    body.setdefault("synthetic", True)
    body.setdefault("operator", "ayo")
    return client.post(SCORE_PATH, json=body)


def test_route_is_dark_without_flags(client) -> None:
    # Neither flag set: indistinguishable from a missing route.
    res = _post(client, prompt="explain fractions")
    assert res.status_code == 404


def test_route_is_dark_with_only_master_flag(client, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGENT_MESH_ENABLED", "1")
    monkeypatch.delenv("AGENT_MESH_SCORE_ROUTE_V1", raising=False)
    res = _post(client, prompt="explain fractions")
    assert res.status_code == 404


def test_refuses_non_synthetic_traffic(client, armed) -> None:
    res = client.post(SCORE_PATH, json={"prompt": "hi", "operator": "ayo", "synthetic": False})
    assert res.status_code == 400
    assert res.get_json() == {"error": "synthetic_required"}


def test_requires_named_operator(client, armed) -> None:
    res = client.post(SCORE_PATH, json={"prompt": "hi", "operator": "  ", "synthetic": True})
    assert res.status_code == 400
    assert res.get_json() == {"error": "operator_required"}


def test_requires_prompt(client, armed) -> None:
    res = _post(client, prompt="   ")
    assert res.status_code == 400
    assert res.get_json() == {"error": "prompt_required"}


def test_rejects_non_object_payload(client, armed) -> None:
    res = client.post(SCORE_PATH, data="[]", content_type="application/json")
    assert res.status_code == 400
    assert res.get_json() == {"error": "invalid_payload"}


def test_token_enforced_when_set(client, armed, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(SCORE_TOKEN_ENV, "s3cr3t")

    missing = _post(client, prompt="explain fractions")
    assert missing.status_code == 401

    wrong = client.post(
        SCORE_PATH,
        json={"prompt": "explain fractions", "operator": "ayo", "synthetic": True},
        headers={"Authorization": "Bearer nope"},
    )
    assert wrong.status_code == 401

    ok = client.post(
        SCORE_PATH,
        json={"prompt": "explain fractions", "operator": "ayo", "synthetic": True},
        headers={"Authorization": "Bearer s3cr3t"},
    )
    assert ok.status_code == 200


@pytest.mark.parametrize(
    "prompt, metadata, expected",
    [
        ("I feel better off without me", {}, "violation"),
        ("Can my friend hear it? this recording", {}, "refusal"),
        ("anything", {"cap": 3, "repeat_index": 3}, "refusal"),
        ("let's talk about football instead", {}, "refusal"),
        ("Can you explain how do i simplify a fraction?", {}, "citation"),
        ("tell me the capital of France", {}, "answer"),
    ],
)
def test_classification_matches_fixture_handler(client, armed, prompt, metadata, expected) -> None:
    res = _post(client, prompt=prompt, metadata=metadata)
    assert res.status_code == 200
    body = res.get_json()
    assert body["outcome"] == expected
    assert body["synthetic"] is True
    assert body["operator"] == "ayo"


def test_successful_response_shape(client, armed) -> None:
    res = _post(client, prompt="Can you explain how do i simplify a fraction?", agent="tutor")
    assert res.status_code == 200
    body = res.get_json()
    assert body["outcome"] == "citation"
    assert "response_excerpt" in body
