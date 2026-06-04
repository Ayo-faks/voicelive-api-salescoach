"""End-to-end B3: drive the ramp through the REAL HTTP score route.

Unlike the in-process B3 dry run (which calls ``population_fixture_handler``
directly), this exercises the full go-live chain:

    B3Driver -> StagingHttpTurnHandler -> POST /internal/agent-mesh/score
             -> population_fixture_handler -> JSON outcome -> back to the driver

The HTTP transport is pointed at a Flask ``test_client`` (no sockets) so the
test is hermetic, but every turn really round-trips through the Flask route,
its flag gate, payload validation, and outcome mapping.
"""

from __future__ import annotations

from typing import Any, Mapping

from flask import Flask
import pytest

from src.learning.agent_mesh_routes import SCORE_PATH
from src.learning.api import LearningApi, register_learning_api
from src.learning.eval.b3_driver import B3Config, B3Driver, make_capacity_probe
from src.learning.eval.b3_staging_handler import build_staging_handler
from src.agents.durable_sink import InMemoryDurableSink


class _CaptureOnlyNotifier:
    """Mesh notifier that captures disclosures to a sink and never pages."""

    is_capture_only = True

    def __init__(self, sink: Any) -> None:
        self._sink = sink

    def channels(self):  # noqa: D401 - no real channels
        return ()

    def notify(self, *args: Any, **kwargs: Any) -> None:  # pragma: no cover
        return None


@pytest.fixture()
def app():
    flask_app = Flask(__name__)
    flask_app.config["TESTING"] = True
    register_learning_api(flask_app, LearningApi())
    return flask_app


@pytest.fixture(autouse=True)
def armed(monkeypatch: pytest.MonkeyPatch):
    # Route + handler + driver flags all on.
    monkeypatch.setenv("AGENT_MESH_ENABLED", "1")
    monkeypatch.setenv("AGENT_MESH_SCORE_ROUTE_V1", "1")
    monkeypatch.setenv("AGENT_MESH_B3_STAGING_HANDLER_V1", "1")
    monkeypatch.setenv("AGENT_MESH_B3_DRIVER_V1", "1")
    monkeypatch.delenv("AGENT_MESH_SCORE_TOKEN", raising=False)


def _http_transport(app: Flask):
    """Transport that round-trips each turn through the real Flask route.

    A fresh ``test_client`` per call keeps the ramp's worker threads isolated.
    """

    def _post(url: str, body: Mapping[str, Any], headers: Mapping[str, str]) -> Mapping[str, Any]:
        del url  # path is fixed; host validation already passed in the handler
        res = app.test_client().post(SCORE_PATH, json=dict(body), headers=dict(headers))
        assert res.status_code == 200, f"route returned {res.status_code}: {res.data!r}"
        return res.get_json()

    return _post


def test_b3_ramp_through_real_http_route(app: Flask) -> None:
    sink = InMemoryDurableSink(capacity=100_000)
    handler = build_staging_handler(
        "http://staging-local:8000",
        operator="ayo",
        transport=_http_transport(app),
    )
    driver = B3Driver(handler=handler)

    config = B3Config(
        environment="staging",
        operator="ayo",
        notifier=_CaptureOnlyNotifier(sink),
        sink=sink,
        target_sessions=10,
        max_sessions=40,
        ramp_step=10,
        concurrency=4,
        # Inject a real capacity ceiling so we prove bend-detection works over HTTP.
        component_probes=(make_capacity_probe("db_write_throughput", 20),),
    )

    report = driver.run(config, force=True, require_flags=True)

    # The ramp climbed until the injected ceiling bent at >20 sessions.
    assert report.first_bend == "db_write_throughput"
    assert report.peak_sessions >= 30
    assert len(report.steps) >= 3

    # Every turn really went through the HTTP route and produced a known outcome.
    counts = sink.counts_by_kind()
    assert counts.get("population", 0) > 0

    records = sink.read(limit=100_000, kind="population")
    outcomes = {rec.payload["outcome"] for rec in records}
    assert outcomes  # non-empty
    assert outcomes <= {"answer", "citation", "refusal", "violation"}


def test_b3_http_route_rejects_when_handler_dark(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    # Turn the route dark mid-flight: the handler must surface a loud failure,
    # never a fabricated pass.
    monkeypatch.delenv("AGENT_MESH_SCORE_ROUTE_V1", raising=False)

    from src.learning.eval.b3_staging_handler import B3StagingTargetError

    handler = build_staging_handler(
        "http://staging-local:8000",
        operator="ayo",
        transport=_http_transport_expecting_404(app),
    )
    from src.learning.eval.personas import PersonaTurn

    with pytest.raises(B3StagingTargetError):
        handler.handle(PersonaTurn(prompt="explain fractions", expected_outcome="answer"))


def _http_transport_expecting_404(app: Flask):
    def _post(url: str, body: Mapping[str, Any], headers: Mapping[str, str]) -> Mapping[str, Any]:
        del url
        res = app.test_client().post(SCORE_PATH, json=dict(body), headers=dict(headers))
        # Dark route -> 404; raise so the handler maps it to a loud target error.
        if res.status_code != 200:
            raise OSError(f"route dark: {res.status_code}")
        return res.get_json()

    return _post
