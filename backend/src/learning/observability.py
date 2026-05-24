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
    from prometheus_client import CONTENT_TYPE_LATEST, CollectorRegistry, Counter, generate_latest
except ImportError:  # pragma: no cover - fallback renderer is covered in tests
    CONTENT_TYPE_LATEST = "text/plain; version=0.0.4; charset=utf-8"
    CollectorRegistry = None  # type: ignore[assignment]
    Counter = None  # type: ignore[assignment]
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
    }
    metric_descriptions = {
        "requests": "Pathfinder Learn HTTP requests by endpoint, method, and outcome.",
        "decisions": "Pathfinder Learn approval decisions by action and outcome.",
        "xapi": "Pathfinder Learn xAPI emissions by sink status and outcome.",
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
        self._otel_request_counter = self._create_otel_counter("requests")
        self._otel_decision_counter = self._create_otel_counter("decisions")
        self._otel_xapi_counter = self._create_otel_counter("xapi")

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

    def render_prometheus(self) -> Tuple[str, str]:
        if self._registry is not None and generate_latest is not None:
            return generate_latest(self._registry).decode("utf-8"), CONTENT_TYPE_LATEST
        return self._render_fallback(), CONTENT_TYPE_LATEST

    def reset_for_tests(self) -> None:
        with self._lock:
            self._fallback_counts.clear()

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