from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List

from flask import Flask

from src.learning.api import ITEM_BANK_PATH, LearningApi, register_learning_api
from src.learning.diagnostic import load_item_bank
from src.learning.observability import LearningFeatureFlags, LearningObservability


class _FakeSpan:
    def __init__(self, name: str) -> None:
        self.name = name
        self.attributes: Dict[str, Any] = {}
        self.exceptions: List[Exception] = []

    def set_attribute(self, key: str, value: Any) -> None:
        self.attributes[key] = value

    def record_exception(self, exc: Exception) -> None:
        self.exceptions.append(exc)


class _FakeSpanContext:
    def __init__(self, span: _FakeSpan) -> None:
        self.span = span

    def __enter__(self) -> _FakeSpan:
        return self.span

    def __exit__(self, *_args: Any) -> None:
        return None


class _FakeTracer:
    def __init__(self) -> None:
        self.spans: List[_FakeSpan] = []

    def start_as_current_span(self, name: str) -> _FakeSpanContext:
        span = _FakeSpan(name)
        self.spans.append(span)
        return _FakeSpanContext(span)


class _FakeMetricCounter:
    def __init__(self, name: str) -> None:
        self.name = name
        self.adds: List[tuple[int, Dict[str, str]]] = []

    def add(self, value: int, attributes: Dict[str, str]) -> None:
        self.adds.append((value, dict(attributes)))


class _FakeHistogram:
    def __init__(self, name: str) -> None:
        self.name = name
        self.observations: List[float] = []

    def record(self, value: float, *_args: Any, **_kwargs: Any) -> None:
        self.observations.append(value)


class _FakeMeter:
    def __init__(self) -> None:
        self.counters: Dict[str, _FakeMetricCounter] = {}
        self.histograms: Dict[str, _FakeHistogram] = {}

    def create_counter(self, name: str, **_kwargs: Any) -> _FakeMetricCounter:
        counter = _FakeMetricCounter(name)
        self.counters[name] = counter
        return counter

    def create_histogram(self, name: str, **_kwargs: Any) -> _FakeHistogram:
        histogram = _FakeHistogram(name)
        self.histograms[name] = histogram
        return histogram



def _learning_api(observability: LearningObservability) -> LearningApi:
    return LearningApi(
        item_bank=load_item_bank(Path(ITEM_BANK_PATH)),
        observability=observability,
    )


def _client(api: LearningApi):
    app = Flask(__name__)
    app.config["TESTING"] = True
    register_learning_api(app, api)
    return app.test_client()


def test_learning_routes_emit_prometheus_counters():
    observability = LearningObservability(
        flags=LearningFeatureFlags(
            observability_enabled=True,
            prometheus_enabled=True,
            otel_enabled=False,
        )
    )
    client = _client(_learning_api(observability))

    response = client.post("/api/learning/diagnostic/start", json={})
    assert response.status_code == 200
    missing = client.post(
        "/api/learning/diagnostic/answer",
        json={"session_id": "missing", "item_id": "x", "response_text": "y"},
    )
    assert missing.status_code == 404

    metrics = client.get("/api/learning/metrics")
    assert metrics.status_code == 200
    text = metrics.get_data(as_text=True)
    assert "pathfinder_learning_requests_total" in text
    assert 'endpoint="start_diagnostic"' in text
    assert 'method="POST"' in text
    assert 'outcome="success"' in text
    assert 'endpoint="answer_diagnostic"' in text
    assert 'outcome="error"' in text


def test_decision_and_xapi_counters_increment_for_approvals():
    observability = LearningObservability(
        flags=LearningFeatureFlags(
            observability_enabled=True,
            prometheus_enabled=True,
            otel_enabled=False,
        )
    )
    client = _client(_learning_api(observability))

    intent = client.post(
        "/api/learning/intent",
        json={"prompt": "Create a short ratio intervention for students who need support"},
    )
    assert intent.status_code == 200, intent.get_data(as_text=True)
    plan_id = intent.get_json()["plan"]["plan_id"]

    approved = client.post(f"/api/learning/approvals/{plan_id}/approve", json={})
    assert approved.status_code == 200, approved.get_data(as_text=True)

    text = client.get("/api/learning/metrics").get_data(as_text=True)
    assert "pathfinder_learning_decisions_total" in text
    assert 'action="approved"' in text
    assert "pathfinder_learning_xapi_emissions_total" in text
    assert 'sink_status="ralph_queued"' in text


def test_observability_config_and_prometheus_flag():
    observability = LearningObservability(
        flags=LearningFeatureFlags(
            observability_enabled=True,
            prometheus_enabled=False,
            otel_enabled=True,
        )
    )
    client = _client(_learning_api(observability))

    config = client.get("/api/learning/observability/config")
    assert config.status_code == 200
    body = config.get_json()
    assert body["flags"]["prometheus_enabled"] is False
    assert body["flags"]["otel_enabled"] is True
    assert body["span_namespace"] == "pathfinder.learning"
    assert body["azure_monitor"]["metric_transport"] == "opentelemetry"
    assert body["azure_monitor"]["connection_string_env"] == "APPLICATIONINSIGHTS_CONNECTION_STRING"

    metrics = client.get("/api/learning/metrics")
    assert metrics.status_code == 403


def test_counters_emit_open_telemetry_metrics_when_prometheus_is_disabled():
    meter = _FakeMeter()
    observability = LearningObservability(
        flags=LearningFeatureFlags(
            observability_enabled=True,
            prometheus_enabled=False,
            otel_enabled=True,
        ),
        meter=meter,
    )

    observability.record_request("start_diagnostic", "post", "success")
    observability.record_decision("edited_approved", "success")
    observability.record_xapi("ralph_queued")

    request_counter = meter.counters["pathfinder_learning_requests_total"]
    decision_counter = meter.counters["pathfinder_learning_decisions_total"]
    xapi_counter = meter.counters["pathfinder_learning_xapi_emissions_total"]
    assert request_counter.adds == [
        (1, {"endpoint": "start_diagnostic", "method": "POST", "outcome": "success"})
    ]
    assert decision_counter.adds == [(1, {"action": "edited_approved", "outcome": "success"})]
    assert xapi_counter.adds == [(1, {"sink_status": "ralph_queued", "outcome": "success"})]


def test_learning_routes_start_opentelemetry_spans():
    tracer = _FakeTracer()
    observability = LearningObservability(
        flags=LearningFeatureFlags(
            observability_enabled=True,
            prometheus_enabled=False,
            otel_enabled=True,
        ),
        tracer=tracer,
    )
    client = _client(_learning_api(observability))

    response = client.get("/api/learning/class/mastery")
    assert response.status_code == 200

    assert tracer.spans
    span = tracer.spans[-1]
    assert span.name == "pathfinder.learning.class_mastery"
    assert span.attributes["learning.operation"] == "class_mastery"
    assert span.attributes["http.method"] == "GET"
    assert span.attributes["http.status_code"] == 200
    assert span.attributes["learning.outcome"] == "success"


def _enabled_observability(meter: _FakeMeter | None = None) -> LearningObservability:
    return LearningObservability(
        flags=LearningFeatureFlags(
            observability_enabled=True,
            prometheus_enabled=True,
            otel_enabled=meter is not None,
        ),
        meter=meter,
    )


def test_metrics_snapshot_aggregates_new_signals():
    observability = _enabled_observability()
    observability.record_request("practice", "post", "success")
    observability.record_request("practice", "post", "error")
    observability.record_grounding("grounded")
    observability.record_grounding("refused")
    observability.record_citation(True)
    observability.record_citation(False)
    observability.record_safety("critical", "escalated", actioned=True)
    observability.record_llm_turn(latency_ms=400, tokens=250, cost_gbp=0.002, outcome="success")
    observability.record_llm_turn(latency_ms=1200, tokens=500, cost_gbp=0.004, outcome="error")
    observability.record_retry("success", "v2")
    observability.record_retry("fail", "v2")

    snap = observability.metrics_snapshot()
    assert snap["requests"]["error_rate"] == 0.5
    assert snap["grounding"]["refusal_rate"] == 0.5
    assert snap["citation"]["present_rate"] == 0.5
    assert snap["safety"]["total"] == 1.0
    assert snap["safety"]["by_severity"]["critical"] == 1.0
    assert snap["safety"]["ack_rate"] == 1.0
    assert snap["llm"]["turns"] == 2.0
    assert snap["llm"]["error_rate"] == 0.5
    assert snap["llm"]["latency_ms_p95"] >= 400
    assert snap["llm"]["cost_gbp_total"] == 0.006
    assert snap["retry"]["success_rate"] == 0.5
    assert snap["retry"]["by_version"]["v2"]["success_rate"] == 0.5


def test_new_signals_emit_open_telemetry_metrics():
    meter = _FakeMeter()
    observability = _enabled_observability(meter)
    observability.record_grounding("grounded")
    observability.record_citation(True)
    observability.record_safety("high", "logged", actioned=False)
    observability.record_llm_turn(latency_ms=500, tokens=100, cost_gbp=0.001, outcome="success")
    observability.record_retry("success", "v1")

    assert meter.counters["pathfinder_learning_grounding_total"].adds == [
        (1, {"decision": "grounded"})
    ]
    assert meter.counters["pathfinder_learning_citation_total"].adds == [
        (1, {"presence": "present"})
    ]
    assert meter.counters["pathfinder_learning_safety_events_total"].adds == [
        (1, {"severity": "high", "action": "logged"})
    ]
    assert meter.counters["pathfinder_learning_llm_turns_total"].adds == [
        (1, {"outcome": "success"})
    ]
    assert meter.counters["pathfinder_learning_retry_outcomes_total"].adds == [
        (1, {"outcome": "success"})
    ]
    assert meter.histograms["pathfinder_learning_llm_latency_ms"].observations == [500]


def test_observability_dashboard_endpoint_shape():
    observability = _enabled_observability()
    observability.record_request("practice", "post", "success")
    observability.record_request("practice", "post", "error")
    observability.record_retry("success", "v2")
    observability.record_citation(True)
    observability.record_llm_turn(latency_ms=420, tokens=200, cost_gbp=0.002, outcome="success")
    client = _client(_learning_api(observability))

    response = client.get("/api/learning/observability/dashboard")
    assert response.status_code == 200
    body = response.get_json()
    assert body["overall_status"] in {"ok", "warn", "crit", "nodata"}
    section_ids = {section["id"] for section in body["sections"]}
    assert section_ids == {"product", "health", "safety-agent"}
    tile_ids = {
        tile["id"]
        for section in body["sections"]
        for tile in section["tiles"]
    }
    assert {"north-star-retry", "api-error-rate", "citation-coverage"} <= tile_ids
    for section in body["sections"]:
        for tile in section["tiles"]:
            assert tile["status"] in {"ok", "warn", "crit", "nodata"}
            assert tile["source"] in {"live", "fixture", "nodata"}


def test_observability_dashboard_degrades_without_signals():
    observability = _enabled_observability()
    client = _client(_learning_api(observability))

    response = client.get("/api/learning/observability/dashboard")
    assert response.status_code == 200
    body = response.get_json()
    # No live traffic yet — live tiles should report nodata, but the endpoint
    # must still return the full section/tile structure for the dashboard UI.
    assert len(body["sections"]) == 3
    retry_tile = next(
        tile
        for section in body["sections"]
        for tile in section["tiles"]
        if tile["id"] == "north-star-retry"
    )
    assert retry_tile["source"] == "nodata"
