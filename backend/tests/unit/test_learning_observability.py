from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List

import pytest
from flask import Flask

from src.learning.api import ITEM_BANK_PATH, LearningApi, register_learning_api
from src.learning.diagnostic import load_item_bank
from src.learning.observability import LearningFeatureFlags, LearningObservability
from src.learning.observability_kql import DurableMetricsReader


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


def test_llm_cost_metric_accumulates_spend():
    meter = _FakeMeter()
    observability = _enabled_observability(meter)
    observability.record_llm_turn(latency_ms=500, tokens=100, cost_gbp=0.002, outcome="success")
    observability.record_llm_turn(latency_ms=600, tokens=120, cost_gbp=0.003, outcome="success")
    observability.record_llm_turn(latency_ms=None, tokens=None, cost_gbp=None, outcome="error")

    cost_adds = meter.counters["pathfinder_learning_llm_cost_gbp_total"].adds
    assert cost_adds == [
        (0.002, {"outcome": "success"}),
        (0.003, {"outcome": "success"}),
    ]
    snap = observability.metrics_snapshot()
    assert snap["llm"]["cost_gbp_total"] == pytest.approx(0.005)


def test_decision_and_planner_signals_aggregate_and_emit():
    meter = _FakeMeter()
    observability = _enabled_observability(meter)
    observability.record_decision("approved", "success")
    observability.record_decision("edited_approved", "success")
    observability.record_decision("rejected", "success")
    observability.record_decision("approved", "error")  # errors are not counted
    observability.record_planner_run(tool_calls=2, budget=5)
    observability.record_planner_run(tool_calls=7, budget=5)

    snap = observability.metrics_snapshot()
    decisions = snap["decisions"]
    assert decisions["total"] == 3.0
    assert decisions["approval_rate"] == pytest.approx(1 / 3)
    assert decisions["override_rate"] == pytest.approx(2 / 3)
    planner = snap["planner"]
    assert planner["runs"] == 2.0
    assert planner["breaches"] == 1.0
    assert planner["breach_rate"] == pytest.approx(0.5)
    assert planner["avg_tool_calls"] == pytest.approx(4.5)
    assert meter.counters["pathfinder_learning_planner_runs_total"].adds == [
        (1, {"outcome": "within_budget"}),
        (1, {"outcome": "budget_exceeded"}),
    ]


def test_voice_ttfa_metric_aggregates_and_emits_histogram():
    meter = _FakeMeter()
    observability = _enabled_observability(meter)
    observability.record_voice_ttfa(latency_ms=600, outcome="success")
    observability.record_voice_ttfa(latency_ms=1400, outcome="success")
    observability.record_voice_ttfa(latency_ms=None, outcome="error")

    snap = observability.metrics_snapshot()
    voice = snap["voice"]
    assert voice["ttfa_total"] == 3.0
    assert voice["ttfa_counts"]["success"] == 2.0
    assert voice["ttfa_counts"]["error"] == 1.0
    assert voice["ttfa_error_rate"] == 1 / 3
    assert voice["ttfa_sample_size"] == 2
    assert voice["ttfa_ms_p95"] >= 600
    # Only successful turns with a latency are observed on the histogram.
    assert meter.histograms["pathfinder_learning_voice_ttfa_ms"].observations == [600, 1400]


def test_voice_ttfa_tile_appears_on_dashboard():
    observability = _enabled_observability()
    observability.record_voice_ttfa(latency_ms=700, outcome="success")
    client = _client(_learning_api(observability))

    response = client.get("/api/learning/observability/dashboard")
    assert response.status_code == 200
    body = response.get_json()
    voice_tile = next(
        tile
        for section in body["sections"]
        for tile in section["tiles"]
        if tile["id"] == "voice-ttfa-p95"
    )
    assert voice_tile["source"] == "live"
    assert voice_tile["status"] in {"ok", "warn", "crit"}


def test_agentops_tiles_appear_on_dashboard():
    observability = _enabled_observability()
    observability.record_decision("approved", "success")
    observability.record_decision("rejected", "success")
    observability.record_planner_run(tool_calls=9, budget=5)
    client = _client(_learning_api(observability))

    response = client.get("/api/learning/observability/dashboard")
    assert response.status_code == 200
    body = response.get_json()
    tiles = {
        tile["id"]: tile
        for section in body["sections"]
        for tile in section["tiles"]
    }
    assert tiles["approval-override-rate"]["source"] == "live"
    assert tiles["approval-override-rate"]["status"] in {"ok", "warn", "crit"}
    assert tiles["planner-budget-breaches"]["source"] == "live"
    assert body["raw"]["decisions"]["total"] == 2.0
    assert body["raw"]["planner"]["breaches"] == 1.0


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
    assert section_ids == {"product", "health", "safety-agent", "service-infra", "agent-mesh"}
    tile_ids = {
        tile["id"]
        for section in body["sections"]
        for tile in section["tiles"]
    }
    assert {
        "north-star-retry",
        "api-error-rate",
        "citation-coverage",
        "active-revision",
        "api-health",
        "db-connectivity",
        "mesh-merge-gate",
        "mesh-veto-rate",
        "mesh-veto-drift",
        "mesh-rollback-proposals",
    } <= tile_ids
    for section in body["sections"]:
        for tile in section["tiles"]:
            assert tile["status"] in {"ok", "warn", "crit", "nodata"}
            assert tile["source"] in {"live", "kql", "snapshot", "fixture", "nodata"}


def test_service_infra_section_reports_revision_and_db(monkeypatch):
    monkeypatch.setenv("CONTAINER_APP_REVISION", "voicelab--azd-1780459617")
    monkeypatch.setenv("CONTAINER_APP_REPLICA_NAME", "voicelab--azd-1780459617-abc")
    monkeypatch.setenv("CONTAINER_APP_NAME", "voicelab")
    monkeypatch.delenv("DATABASE_BACKEND", raising=False)
    observability = _enabled_observability()
    client = _client(_learning_api(observability))

    response = client.get("/api/learning/observability/dashboard")
    assert response.status_code == 200
    body = response.get_json()

    infra = next(s for s in body["sections"] if s["id"] == "service-infra")
    tiles = {tile["id"]: tile for tile in infra["tiles"]}

    revision = tiles["active-revision"]
    assert revision["value"] == "voicelab--azd-1780459617"
    assert revision["source"] == "live"
    assert "Deployed 2026" in revision["detail"]

    assert tiles["api-health"]["value"] == "ok"
    assert tiles["api-health"]["status"] == "ok"

    # In-memory backend has no Postgres probe — tile stays ok/live, never 500.
    db = tiles["db-connectivity"]
    assert db["status"] == "ok"
    assert db["source"] == "live"


def test_agent_mesh_section_dark_without_history(monkeypatch, tmp_path):
    # No history file → every mesh tile is nodata and the endpoint never 500s.
    monkeypatch.setenv("AGENT_MESH_HISTORY_PATH", str(tmp_path / "missing.jsonl"))
    observability = _enabled_observability()
    client = _client(_learning_api(observability))

    response = client.get("/api/learning/observability/dashboard")
    assert response.status_code == 200
    body = response.get_json()

    mesh = next(s for s in body["sections"] if s["id"] == "agent-mesh")
    tiles = {tile["id"]: tile for tile in mesh["tiles"]}
    assert set(tiles) == {
        "mesh-merge-gate",
        "mesh-veto-rate",
        "mesh-veto-drift",
        "mesh-rollback-proposals",
        "mesh-tutor-accuracy",
        "mesh-safeguarding-recall",
        "mesh-planner-eval",
    }
    for tile in tiles.values():
        assert tile["status"] == "nodata"
        assert tile["source"] == "nodata"


def test_agent_mesh_section_reads_durable_history(monkeypatch, tmp_path):
    import json as _json

    history = tmp_path / "history.jsonl"
    rows = [
        {"seq": 1, "kind": "genaiops", "ts": 1.0,
         "payload": {"passed": False, "pass_rate": 0.82, "blocking_reasons": ["tier1_breach"]}, "tags": {}},
        {"seq": 2, "kind": "migration", "ts": 2.0, "payload": {"destructive": True}, "tags": {}},
    ]
    # A run of safeguarding checks, two of which veto (allowed == False).
    for i in range(10):
        rows.append({
            "seq": 3 + i, "kind": "safeguarding", "ts": 3.0 + i,
            "payload": {"allowed": i >= 2}, "tags": {},
        })
    history.write_text("\n".join(_json.dumps(r) for r in rows) + "\n", encoding="utf-8")

    monkeypatch.setenv("AGENT_MESH_HISTORY_PATH", str(history))
    observability = _enabled_observability()
    client = _client(_learning_api(observability))

    response = client.get("/api/learning/observability/dashboard")
    assert response.status_code == 200
    body = response.get_json()

    mesh = next(s for s in body["sections"] if s["id"] == "agent-mesh")
    tiles = {tile["id"]: tile for tile in mesh["tiles"]}

    # Failing eval verdict → crit, kql-badged.
    assert tiles["mesh-merge-gate"]["status"] == "crit"
    assert tiles["mesh-merge-gate"]["source"] == "kql"

    # 2 vetoes / 10 checks = 20% → above the 10% target → crit.
    assert tiles["mesh-veto-rate"]["value"] == "20.0%"
    assert tiles["mesh-veto-rate"]["status"] == "crit"

    # 1 migration proposal recorded, none auto-executed.
    assert tiles["mesh-rollback-proposals"]["value"] == "1"
    assert "0 auto-executed" in tiles["mesh-rollback-proposals"]["detail"]


def test_agent_mesh_section_reads_agent_eval_history(monkeypatch, tmp_path):
    import json as _json

    history = tmp_path / "history.jsonl"
    rows = [
        {
            "seq": 1,
            "kind": "agent_eval",
            "ts": 1.0,
            "payload": {
                "status": "degraded",
                "eval": {"accuracy": 0.75, "accuracy_floor": 0.85, "support": 8},
                "safeguarding": {
                    "recall": 1.0,
                    "recall_floor": 1.0,
                    "false_positive_rate": 0.0,
                    "critical_false_negatives": 0,
                },
                "planners": {
                    "A1_insights": {"passed": True},
                    "A8_planning": {"passed": True},
                    "passed": True,
                },
            },
            "tags": {},
        },
    ]
    history.write_text("\n".join(_json.dumps(r) for r in rows) + "\n", encoding="utf-8")

    monkeypatch.setenv("AGENT_MESH_HISTORY_PATH", str(history))
    observability = _enabled_observability()
    client = _client(_learning_api(observability))

    response = client.get("/api/learning/observability/dashboard")
    assert response.status_code == 200
    body = response.get_json()

    mesh = next(s for s in body["sections"] if s["id"] == "agent-mesh")
    tiles = {tile["id"]: tile for tile in mesh["tiles"]}

    # Tutor accuracy below its 85% floor → crit, kql-badged.
    assert tiles["mesh-tutor-accuracy"]["value"] == "75.0%"
    assert tiles["mesh-tutor-accuracy"]["status"] == "crit"
    assert tiles["mesh-tutor-accuracy"]["source"] == "kql"

    # Perfect recall, no critical misses → ok.
    assert tiles["mesh-safeguarding-recall"]["value"] == "100.0%"
    assert tiles["mesh-safeguarding-recall"]["status"] == "ok"
    assert tiles["mesh-safeguarding-recall"]["source"] == "kql"

    # Both planners pass → ok.
    assert tiles["mesh-planner-eval"]["value"] == "pass"
    assert tiles["mesh-planner-eval"]["status"] == "ok"
    assert tiles["mesh-planner-eval"]["source"] == "kql"


def test_observability_dashboard_degrades_without_signals():
    observability = _enabled_observability()
    client = _client(_learning_api(observability))

    response = client.get("/api/learning/observability/dashboard")
    assert response.status_code == 200
    body = response.get_json()
    # No live traffic yet — live tiles should report nodata, but the endpoint
    # must still return the full section/tile structure for the dashboard UI.
    assert len(body["sections"]) == 5
    retry_tile = next(
        tile
        for section in body["sections"]
        for tile in section["tiles"]
        if tile["id"] == "north-star-retry"
    )
    assert retry_tile["source"] == "nodata"


def test_durable_reader_disabled_without_resource_id():
    reader = DurableMetricsReader(resource_id=None)
    assert reader.enabled is False
    assert reader.read() is None


def test_durable_reader_rows_to_snapshot():
    rows = [
        ["pathfinder_learning_requests_total", '{"outcome": "success"}', 90.0],
        ["pathfinder_learning_requests_total", '{"outcome": "error"}', 10.0],
        ["pathfinder_learning_llm_turns_total", '{"outcome": "success"}', 40.0],
        ["pathfinder_learning_llm_turns_total", '{"outcome": "error"}', 5.0],
        ["pathfinder_learning_llm_cost_gbp_total", '{"outcome": "success"}', 1.25],
        ["pathfinder_learning_citation_total", '{"presence": "present"}', 48.0],
        ["pathfinder_learning_citation_total", '{"presence": "missing"}', 2.0],
        ["pathfinder_learning_grounding_total", '{"decision": "grounded"}', 30.0],
        ["pathfinder_learning_grounding_total", '{"decision": "refused"}', 6.0],
        ["pathfinder_learning_retry_outcomes_total", '{"outcome": "success"}', 18.0],
        ["pathfinder_learning_retry_outcomes_total", '{"outcome": "fail"}', 6.0],
    ]
    snap = DurableMetricsReader._rows_to_snapshot(rows)

    assert snap["requests"]["total"] == 100.0
    assert snap["requests"]["error_rate"] == pytest.approx(0.1)
    assert snap["llm"]["turns"] == 45.0
    assert snap["llm"]["errors"] == 5.0
    assert snap["llm"]["cost_gbp_total"] == pytest.approx(1.25)
    assert snap["citation"]["present_rate"] == pytest.approx(0.96)
    assert snap["grounding"]["refusal_rate"] == pytest.approx(6.0 / 36.0)
    assert snap["retry"]["success_rate"] == pytest.approx(0.75)


class _StubDurableReader:
    def __init__(self, snapshot):
        self._snapshot = snapshot

    def read(self):
        return self._snapshot


def test_dashboard_badges_durable_tiles_as_kql():
    observability = _enabled_observability()
    reader = _StubDurableReader(
        {
            "requests": {
                "counts": {"success": 90.0, "error": 10.0},
                "total": 100.0,
                "error_rate": 0.1,
            },
            "retry": {
                "counts": {"success": 18.0, "fail": 6.0},
                "total": 24.0,
                "success_rate": 0.75,
                "by_version": {},
            },
            "llm": {
                "turns": 45.0,
                "errors": 5.0,
                "error_rate": 5.0 / 45.0,
                "cost_gbp_total": 1.25,
                "avg_cost_per_turn_gbp": 1.25 / 45.0,
            },
        }
    )
    api = LearningApi(
        item_bank=load_item_bank(Path(ITEM_BANK_PATH)),
        observability=observability,
        durable_metrics_reader=reader,
    )
    client = _client(api)

    response = client.get("/api/learning/observability/dashboard")
    assert response.status_code == 200
    tiles = {
        tile["id"]: tile
        for section in response.get_json()["sections"]
        for tile in section["tiles"]
    }

    assert tiles["api-error-rate"]["source"] == "kql"
    assert tiles["north-star-retry"]["source"] == "kql"
    assert tiles["llm-error-rate"]["source"] == "kql"
    # Histogram-backed latency stays in-process even when durable data exists.
    assert tiles["llm-latency-p95"]["source"] in {"live", "nodata"}


