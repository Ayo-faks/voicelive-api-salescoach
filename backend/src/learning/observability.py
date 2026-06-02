"""Feature flags, counters, and spans for Pathfinder Learn."""

from __future__ import annotations

import os
import threading
from collections import defaultdict
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any, Dict, Iterator, Mapping, Optional, Tuple

try:  # pragma: no cover - exercised when deployment deps are installed
    from opentelemetry import trace
except ImportError:  # pragma: no cover - graceful local fallback
    trace = None  # type: ignore[assignment]

try:  # pragma: no cover - exercised when deployment deps are installed
    from opentelemetry import metrics as otel_metrics
except ImportError:  # pragma: no cover - graceful local fallback
    otel_metrics = None  # type: ignore[assignment]

try:  # pragma: no cover - current unit venv may not include prometheus_client
    from prometheus_client import (
        CONTENT_TYPE_LATEST,
        CollectorRegistry,
        Counter,
        Histogram,
        generate_latest,
    )
except ImportError:  # pragma: no cover - fallback renderer is covered in tests
    CONTENT_TYPE_LATEST = "text/plain; version=0.0.4; charset=utf-8"
    CollectorRegistry = None  # type: ignore[assignment]
    Counter = None  # type: ignore[assignment]
    Histogram = None  # type: ignore[assignment]
    generate_latest = None  # type: ignore[assignment]


OBSERVABILITY_FLAG_ENV = "PATHFINDER_LEARN_OBSERVABILITY_ENABLED"
PROMETHEUS_FLAG_ENV = "PATHFINDER_LEARN_PROMETHEUS_ENABLED"
OTEL_FLAG_ENV = "PATHFINDER_LEARN_OTEL_ENABLED"

_TRUE_VALUES = {"1", "true", "yes", "on"}
_FALSE_VALUES = {"0", "false", "no", "off"}


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    normalised = raw.strip().lower()
    if normalised in _TRUE_VALUES:
        return True
    if normalised in _FALSE_VALUES:
        return False
    return default


@dataclass(frozen=True)
class LearningFeatureFlags:
    observability_enabled: bool = True
    prometheus_enabled: bool = True
    otel_enabled: bool = True

    @classmethod
    def from_env(cls) -> "LearningFeatureFlags":
        observability_enabled = _env_bool(OBSERVABILITY_FLAG_ENV, True)
        return cls(
            observability_enabled=observability_enabled,
            prometheus_enabled=observability_enabled and _env_bool(PROMETHEUS_FLAG_ENV, True),
            otel_enabled=observability_enabled and _env_bool(OTEL_FLAG_ENV, True),
        )

    def as_dict(self) -> Dict[str, bool]:
        return {
            "observability_enabled": self.observability_enabled,
            "prometheus_enabled": self.prometheus_enabled,
            "otel_enabled": self.otel_enabled,
        }


class _MetricSnapshotStore:
    """Thread-safe in-process aggregate of learning signals for the admin dashboard.

    Mirrors the Prometheus/OTel counters but keeps numeric aggregates that the
    `/api/learning/observability/dashboard` endpoint can read back synchronously,
    so the dashboard renders identically in local dev (no scraper) and in prod
    (where the same events are also exported to Azure Monitor via OTel). No PII is
    stored; only counts, sums, and a bounded latency reservoir.
    """

    _LATENCY_RESERVOIR_MAX = 1000

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.grounding: Dict[str, float] = defaultdict(float)  # grounded/deferred/refused
        self.citation: Dict[str, float] = defaultdict(float)  # present/missing
        self.requests: Dict[str, float] = defaultdict(float)  # success/error
        self.safety_total: float = 0.0
        self.safety_by_severity: Dict[str, float] = defaultdict(float)
        self.safety_actioned: float = 0.0  # events acknowledged at record time
        self.llm_turns: float = 0.0
        self.llm_errors: float = 0.0
        self.llm_tokens_sum: float = 0.0
        self.llm_cost_gbp_sum: float = 0.0
        self._latencies_ms: list[float] = []
        self.retry: Dict[str, float] = defaultdict(float)  # success/fail
        self.retry_by_version: Dict[str, Dict[str, float]] = defaultdict(
            lambda: defaultdict(float)
        )

    def record_request(self, outcome: str) -> None:
        with self._lock:
            self.requests["success" if outcome == "success" else "error"] += 1.0

    def record_grounding(self, decision: str) -> None:
        with self._lock:
            self.grounding[decision] += 1.0

    def record_citation(self, present: bool) -> None:
        with self._lock:
            self.citation["present" if present else "missing"] += 1.0

    def record_safety(self, severity: str, actioned: bool) -> None:
        with self._lock:
            self.safety_total += 1.0
            self.safety_by_severity[severity] += 1.0
            if actioned:
                self.safety_actioned += 1.0

    def record_llm_turn(
        self,
        latency_ms: Optional[float],
        tokens: Optional[float],
        cost_gbp: Optional[float],
        outcome: str,
    ) -> None:
        with self._lock:
            self.llm_turns += 1.0
            if outcome != "success":
                self.llm_errors += 1.0
            if tokens:
                self.llm_tokens_sum += float(tokens)
            if cost_gbp:
                self.llm_cost_gbp_sum += float(cost_gbp)
            if latency_ms is not None and latency_ms >= 0:
                self._latencies_ms.append(float(latency_ms))
                if len(self._latencies_ms) > self._LATENCY_RESERVOIR_MAX:
                    self._latencies_ms = self._latencies_ms[-self._LATENCY_RESERVOIR_MAX :]

    def record_retry(self, outcome: str, explanation_version: str = "unknown") -> None:
        key = "success" if outcome in {"success", "correct", "pass"} else "fail"
        with self._lock:
            self.retry[key] += 1.0
            self.retry_by_version[explanation_version][key] += 1.0

    @staticmethod
    def _percentile(values: list[float], pct: float) -> float:
        if not values:
            return 0.0
        ordered = sorted(values)
        rank = max(0, min(len(ordered) - 1, int(round((pct / 100.0) * (len(ordered) - 1)))))
        return ordered[rank]

    @staticmethod
    def _ratio(numerator: float, denominator: float) -> Optional[float]:
        if denominator <= 0:
            return None
        return numerator / denominator

    def snapshot(self) -> Dict[str, Any]:
        with self._lock:
            grounding = dict(self.grounding)
            citation = dict(self.citation)
            requests = dict(self.requests)
            safety_by_severity = dict(self.safety_by_severity)
            safety_total = self.safety_total
            safety_actioned = self.safety_actioned
            llm_turns = self.llm_turns
            llm_errors = self.llm_errors
            tokens_sum = self.llm_tokens_sum
            cost_sum = self.llm_cost_gbp_sum
            latencies = list(self._latencies_ms)
            retry = dict(self.retry)
            retry_by_version = {k: dict(v) for k, v in self.retry_by_version.items()}

        grounding_total = sum(grounding.values())
        citation_total = sum(citation.values())
        requests_total = sum(requests.values())
        retry_total = retry.get("success", 0.0) + retry.get("fail", 0.0)
        return {
            "requests": {
                "counts": requests,
                "total": requests_total,
                "error_rate": self._ratio(requests.get("error", 0.0), requests_total),
            },
            "grounding": {
                "counts": grounding,
                "total": grounding_total,
                "refusal_rate": self._ratio(grounding.get("refused", 0.0), grounding_total),
                "ground_rate": self._ratio(grounding.get("grounded", 0.0), grounding_total),
            },
            "citation": {
                "counts": citation,
                "total": citation_total,
                "present_rate": self._ratio(citation.get("present", 0.0), citation_total),
            },
            "safety": {
                "total": safety_total,
                "by_severity": safety_by_severity,
                "actioned": safety_actioned,
                "ack_rate": self._ratio(safety_actioned, safety_total),
            },
            "llm": {
                "turns": llm_turns,
                "errors": llm_errors,
                "error_rate": self._ratio(llm_errors, llm_turns),
                "tokens_total": tokens_sum,
                "cost_gbp_total": cost_sum,
                "avg_cost_per_turn_gbp": self._ratio(cost_sum, llm_turns),
                "latency_ms_p50": self._percentile(latencies, 50),
                "latency_ms_p95": self._percentile(latencies, 95),
                "latency_ms_p99": self._percentile(latencies, 99),
                "latency_sample_size": len(latencies),
            },
            "retry": {
                "counts": retry,
                "total": retry_total,
                "success_rate": self._ratio(retry.get("success", 0.0), retry_total),
                "by_version": {
                    version: {
                        **counts,
                        "success_rate": self._ratio(
                            counts.get("success", 0.0),
                            counts.get("success", 0.0) + counts.get("fail", 0.0),
                        ),
                    }
                    for version, counts in retry_by_version.items()
                },
            },
        }

    def reset(self) -> None:
        with self._lock:
            self.grounding.clear()
            self.citation.clear()
            self.requests.clear()
            self.safety_total = 0.0
            self.safety_by_severity.clear()
            self.safety_actioned = 0.0
            self.llm_turns = 0.0
            self.llm_errors = 0.0
            self.llm_tokens_sum = 0.0
            self.llm_cost_gbp_sum = 0.0
            self._latencies_ms.clear()
            self.retry.clear()
            self.retry_by_version.clear()


class LearningObservability:
    """Privacy-safe observability for learning routes.

    Labels intentionally use route/operation names and statuses only; no child,
    teacher, tenant, or free-text values are emitted. Counters are emitted both
    as Prometheus scrape output and OpenTelemetry metrics; the existing Azure
    Monitor bootstrap exports the OpenTelemetry metrics when configured.
    """

    metric_names = {
        "requests": "pathfinder_learning_requests_total",
        "decisions": "pathfinder_learning_decisions_total",
        "xapi": "pathfinder_learning_xapi_emissions_total",
        "grounding": "pathfinder_learning_grounding_total",
        "citation": "pathfinder_learning_citation_total",
        "safety": "pathfinder_learning_safety_events_total",
        "llm_turns": "pathfinder_learning_llm_turns_total",
        "retry": "pathfinder_learning_retry_outcomes_total",
    }
    metric_descriptions = {
        "requests": "Pathfinder Learn HTTP requests by endpoint, method, and outcome.",
        "decisions": "Pathfinder Learn approval decisions by action and outcome.",
        "xapi": "Pathfinder Learn xAPI emissions by sink status and outcome.",
        "grounding": "Pathfinder Learn RAG grounding outcomes by decision (grounded/deferred/refused).",
        "citation": "Pathfinder Learn explanation citation presence (present/missing).",
        "safety": "Pathfinder Learn safeguarding/safety events by severity and action.",
        "llm_turns": "Pathfinder Learn LLM turns by outcome.",
        "retry": "Pathfinder Learn retry-after-explanation outcomes by result.",
    }
    histogram_names = {
        "llm_latency": "pathfinder_learning_llm_latency_ms",
    }
    histogram_descriptions = {
        "llm_latency": "Pathfinder Learn LLM turn latency in milliseconds.",
    }

    def __init__(
        self,
        flags: Optional[LearningFeatureFlags] = None,
        *,
        tracer: Optional[Any] = None,
        meter: Optional[Any] = None,
    ) -> None:
        self.flags = flags or LearningFeatureFlags.from_env()
        self._lock = threading.Lock()
        self._fallback_counts: Dict[Tuple[str, Tuple[Tuple[str, str], ...]], float] = defaultdict(float)
        self._tracer = tracer
        if self._tracer is None and trace is not None:
            self._tracer = trace.get_tracer("pathfinder.learning")
        self._meter = meter
        if self._meter is None and self.otel_enabled and otel_metrics is not None:
            self._meter = otel_metrics.get_meter("pathfinder.learning")

        self._registry = CollectorRegistry() if Counter is not None and self.prometheus_enabled else None
        self._request_counter = None
        self._decision_counter = None
        self._xapi_counter = None
        self._grounding_counter = None
        self._citation_counter = None
        self._safety_counter = None
        self._llm_turn_counter = None
        self._retry_counter = None
        self._llm_latency_histogram = None
        if self._registry is not None and Counter is not None:
            self._request_counter = Counter(
                self.metric_names["requests"],
                self.metric_descriptions["requests"],
                ["endpoint", "method", "outcome"],
                registry=self._registry,
            )
            self._decision_counter = Counter(
                self.metric_names["decisions"],
                self.metric_descriptions["decisions"],
                ["action", "outcome"],
                registry=self._registry,
            )
            self._xapi_counter = Counter(
                self.metric_names["xapi"],
                self.metric_descriptions["xapi"],
                ["sink_status", "outcome"],
                registry=self._registry,
            )
            self._grounding_counter = Counter(
                self.metric_names["grounding"],
                self.metric_descriptions["grounding"],
                ["decision"],
                registry=self._registry,
            )
            self._citation_counter = Counter(
                self.metric_names["citation"],
                self.metric_descriptions["citation"],
                ["presence"],
                registry=self._registry,
            )
            self._safety_counter = Counter(
                self.metric_names["safety"],
                self.metric_descriptions["safety"],
                ["severity", "action"],
                registry=self._registry,
            )
            self._llm_turn_counter = Counter(
                self.metric_names["llm_turns"],
                self.metric_descriptions["llm_turns"],
                ["outcome"],
                registry=self._registry,
            )
            self._retry_counter = Counter(
                self.metric_names["retry"],
                self.metric_descriptions["retry"],
                ["outcome"],
                registry=self._registry,
            )
            if Histogram is not None:
                self._llm_latency_histogram = Histogram(
                    self.histogram_names["llm_latency"],
                    self.histogram_descriptions["llm_latency"],
                    buckets=(100, 250, 500, 1000, 2000, 4000, 8000, 16000),
                    registry=self._registry,
                )
        self._otel_request_counter = self._create_otel_counter("requests")
        self._otel_decision_counter = self._create_otel_counter("decisions")
        self._otel_xapi_counter = self._create_otel_counter("xapi")
        self._otel_grounding_counter = self._create_otel_counter("grounding")
        self._otel_citation_counter = self._create_otel_counter("citation")
        self._otel_safety_counter = self._create_otel_counter("safety")
        self._otel_llm_turn_counter = self._create_otel_counter("llm_turns")
        self._otel_retry_counter = self._create_otel_counter("retry")
        self._otel_llm_latency_histogram = self._create_otel_histogram("llm_latency")
        self.snapshot_store = _MetricSnapshotStore()

    @property
    def prometheus_enabled(self) -> bool:
        return self.flags.observability_enabled and self.flags.prometheus_enabled

    @property
    def otel_enabled(self) -> bool:
        return self.flags.observability_enabled and self.flags.otel_enabled

    def config_payload(self) -> Dict[str, Any]:
        return {
            "flags": self.flags.as_dict(),
            "metric_names": self.metric_names,
            "span_namespace": "pathfinder.learning",
            "azure_monitor": {
                "metric_transport": "opentelemetry",
                "connection_string_env": "APPLICATIONINSIGHTS_CONNECTION_STRING",
            },
        }

    @contextmanager
    def start_span(
        self,
        name: str,
        attributes: Optional[Mapping[str, Any]] = None,
    ) -> Iterator[Optional[Any]]:
        if not self.otel_enabled or self._tracer is None:
            yield None
            return
        with self._tracer.start_as_current_span(name) as span:
            for key, value in (attributes or {}).items():
                self._set_span_attribute(span, key, value)
            yield span

    def record_request(self, endpoint: str, method: str, outcome: str) -> None:
        if not self.flags.observability_enabled:
            return
        labels = {
            "endpoint": endpoint,
            "method": method.upper(),
            "outcome": outcome,
        }
        self._record_prometheus(self._request_counter, self.metric_names["requests"], labels)
        self._record_otel(self._otel_request_counter, labels)
        self.snapshot_store.record_request(outcome)

    def record_decision(self, action: str, outcome: str) -> None:
        if not self.flags.observability_enabled:
            return
        labels = {"action": action, "outcome": outcome}
        self._record_prometheus(self._decision_counter, self.metric_names["decisions"], labels)
        self._record_otel(self._otel_decision_counter, labels)

    def record_xapi(self, sink_status: str, outcome: str = "success") -> None:
        if not self.flags.observability_enabled:
            return
        labels = {"sink_status": sink_status, "outcome": outcome}
        self._record_prometheus(self._xapi_counter, self.metric_names["xapi"], labels)
        self._record_otel(self._otel_xapi_counter, labels)

    def record_grounding(self, decision: str) -> None:
        """Record a RAG grounding outcome (grounded/deferred/refused)."""
        if not self.flags.observability_enabled:
            return
        labels = {"decision": decision}
        self._record_prometheus(self._grounding_counter, self.metric_names["grounding"], labels)
        self._record_otel(self._otel_grounding_counter, labels)
        self.snapshot_store.record_grounding(decision)

    def record_citation(self, present: bool) -> None:
        """Record whether a rendered explanation carried a wiki citation."""
        if not self.flags.observability_enabled:
            return
        labels = {"presence": "present" if present else "missing"}
        self._record_prometheus(self._citation_counter, self.metric_names["citation"], labels)
        self._record_otel(self._otel_citation_counter, labels)
        self.snapshot_store.record_citation(present)

    def record_safety(self, severity: str, action: str = "logged", *, actioned: bool = False) -> None:
        """Record a safeguarding/safety event by severity and action taken."""
        if not self.flags.observability_enabled:
            return
        labels = {"severity": severity, "action": action}
        self._record_prometheus(self._safety_counter, self.metric_names["safety"], labels)
        self._record_otel(self._otel_safety_counter, labels)
        self.snapshot_store.record_safety(severity, actioned)

    def record_llm_turn(
        self,
        *,
        latency_ms: Optional[float] = None,
        tokens: Optional[float] = None,
        cost_gbp: Optional[float] = None,
        outcome: str = "success",
    ) -> None:
        """Record an LLM turn's latency, token usage, cost, and outcome."""
        if not self.flags.observability_enabled:
            return
        labels = {"outcome": outcome}
        self._record_prometheus(self._llm_turn_counter, self.metric_names["llm_turns"], labels)
        self._record_otel(self._otel_llm_turn_counter, labels)
        if latency_ms is not None and latency_ms >= 0:
            if self._llm_latency_histogram is not None:
                self._llm_latency_histogram.observe(latency_ms)
            if self._otel_llm_latency_histogram is not None:
                self._otel_llm_latency_histogram.record(latency_ms)
        self.snapshot_store.record_llm_turn(latency_ms, tokens, cost_gbp, outcome)

    def record_retry(self, outcome: str, explanation_version: str = "unknown") -> None:
        """Record a retry-after-explanation outcome (the MVP north-star signal)."""
        if not self.flags.observability_enabled:
            return
        normalised = "success" if outcome in {"success", "correct", "pass"} else "fail"
        labels = {"outcome": normalised}
        self._record_prometheus(self._retry_counter, self.metric_names["retry"], labels)
        self._record_otel(self._otel_retry_counter, labels)
        self.snapshot_store.record_retry(outcome, explanation_version)

    def metrics_snapshot(self) -> Dict[str, Any]:
        """Return the in-process aggregate for the admin observability dashboard."""
        return self.snapshot_store.snapshot()


    def render_prometheus(self) -> Tuple[str, str]:
        if self._registry is not None and generate_latest is not None:
            return generate_latest(self._registry).decode("utf-8"), CONTENT_TYPE_LATEST
        return self._render_fallback(), CONTENT_TYPE_LATEST

    def reset_for_tests(self) -> None:
        with self._lock:
            self._fallback_counts.clear()
        self.snapshot_store.reset()

    @staticmethod
    def _set_span_attribute(span: Any, key: str, value: Any) -> None:
        if value is None:
            return
        if isinstance(value, (str, bool, int, float)):
            span.set_attribute(key, value)
        else:
            span.set_attribute(key, str(value))

    def _create_otel_counter(self, metric_key: str) -> Optional[Any]:
        if not self.otel_enabled or self._meter is None:
            return None
        return self._meter.create_counter(
            self.metric_names[metric_key],
            unit="1",
            description=self.metric_descriptions[metric_key],
        )

    def _create_otel_histogram(self, histogram_key: str) -> Optional[Any]:
        if not self.otel_enabled or self._meter is None:
            return None
        return self._meter.create_histogram(
            self.histogram_names[histogram_key],
            unit="ms",
            description=self.histogram_descriptions[histogram_key],
        )

    def _record_prometheus(
        self,
        counter: Optional[Any],
        metric_name: str,
        labels: Mapping[str, str],
    ) -> None:
        if not self.prometheus_enabled:
            return
        if counter is not None:
            counter.labels(**labels).inc()
            return
        self._increment_fallback(metric_name, labels)

    def _record_otel(self, counter: Optional[Any], labels: Mapping[str, str]) -> None:
        if not self.otel_enabled or counter is None:
            return
        counter.add(1, attributes=dict(labels))

    def _increment_fallback(self, metric_name: str, labels: Mapping[str, str]) -> None:
        label_tuple = tuple(sorted((key, str(value)) for key, value in labels.items()))
        with self._lock:
            self._fallback_counts[(metric_name, label_tuple)] += 1.0

    def _render_fallback(self) -> str:
        lines = []
        for metric_key, metric_name in self.metric_names.items():
            lines.append(f"# HELP {metric_name} {self.metric_descriptions[metric_key]}")
            lines.append(f"# TYPE {metric_name} counter")
            for (name, labels), value in sorted(self._fallback_counts.items()):
                if name != metric_name:
                    continue
                label_text = ",".join(f'{key}="{value}"' for key, value in labels)
                lines.append(f"{name}{{{label_text}}} {value}")
        return "\n".join(lines) + "\n"


__all__ = [
    "LearningFeatureFlags",
    "LearningObservability",
    "OBSERVABILITY_FLAG_ENV",
    "PROMETHEUS_FLAG_ENV",
    "OTEL_FLAG_ENV",
]