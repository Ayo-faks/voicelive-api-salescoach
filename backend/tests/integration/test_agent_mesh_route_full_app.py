"""Full-app integration: the agent-mesh score route inside the real Flask app.

The bare-app e2e (``test_b3_http_route_e2e``) proves the blueprint logic. This
test loads the *production* ``src.app`` so the route runs behind the real
``before_request`` guards (CSRF, per-actor rate limit). Those guards are scoped
to ``/api/`` paths, so an ``/internal/`` route must:

* answer with **no learner auth** (synthetic load has no logged-in user), and
* not be throttled by the mutation rate limiter even under repeated POSTs.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from flask.testing import FlaskClient

import src.app as app_module
from src.learning.agent_mesh_routes import SCORE_PATH
from src.services.storage import StorageService


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[FlaskClient]:
    storage_service = StorageService(str(tmp_path / "mesh.db"))
    monkeypatch.setattr(app_module, "storage_service", storage_service)
    monkeypatch.setenv("AGENT_MESH_ENABLED", "1")
    monkeypatch.setenv("AGENT_MESH_SCORE_ROUTE_V1", "1")
    monkeypatch.delenv("AGENT_MESH_SCORE_TOKEN", raising=False)
    app_module.app.config["TESTING"] = True
    with app_module.app.test_client() as test_client:
        yield test_client


def test_score_route_works_without_auth_inside_full_app(client: FlaskClient) -> None:
    res = client.post(
        SCORE_PATH,
        json={"prompt": "Can you explain how do i simplify a fraction?", "operator": "ayo", "synthetic": True},
    )
    assert res.status_code == 200, res.data
    body = res.get_json()
    assert body["outcome"] == "citation"
    assert body["synthetic"] is True


def test_score_route_not_rate_limited_under_repeated_posts(client: FlaskClient) -> None:
    # The /api/ mutation limiter would trip well before 200 calls; /internal/ is exempt.
    for _ in range(200):
        res = client.post(
            SCORE_PATH,
            json={"prompt": "tell me the capital of France", "operator": "ayo", "synthetic": True},
        )
        assert res.status_code == 200
    assert res.get_json()["outcome"] == "answer"


def test_score_route_dark_when_flag_cleared(client: FlaskClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AGENT_MESH_SCORE_ROUTE_V1", raising=False)
    res = client.post(
        SCORE_PATH,
        json={"prompt": "explain fractions", "operator": "ayo", "synthetic": True},
    )
    assert res.status_code == 404
