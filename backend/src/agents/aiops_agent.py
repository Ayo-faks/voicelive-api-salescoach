"""AIOpsAgent — read-only, shadow-mode operational anomaly summariser.

Phase 2 of the agent mesh. This agent consumes a *metrics snapshot* (the shape
produced by ``src.learning.observability_kql.DurableMetricsReader.read``) and
emits structured anomaly findings against configurable thresholds.

It is deliberately constrained:

* **Read-only.** It never mutates state, never calls an LLM, never raises on a
  bad snapshot — it returns a report describing what it saw.
* **Shadow mode.** It only observes and logs (``[agent-mesh]``). It takes no
  remediating action; a later phase can promote findings to alerts/actions.
* **Dependency-free.** Only stdlib + :class:`MeshAgent`. The snapshot is a plain
  ``dict`` so the agent is trivially unit-testable without a live cluster.

Snapshot keys understood (all optional; missing keys are simply skipped):

* ``requests``  → ``error_rate``
* ``grounding`` → ``refusal_rate``
* ``citation``  → ``present_rate`` (low is bad)
* ``retry``     → ``success_rate`` (low is bad)
* ``llm``       → ``error_rate``, ``avg_cost_per_turn_gbp``
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Optional, Tuple

from src.agents.base import MeshAgent

# --- Severities -------------------------------------------------------------

SEVERITY_OK = "ok"
SEVERITY_WARN = "warn"
SEVERITY_CRITICAL = "critical"

_SEVERITY_RANK = {SEVERITY_OK: 0, SEVERITY_WARN: 1, SEVERITY_CRITICAL: 2}


# --- Threshold configuration ------------------------------------------------

# Default-on directionality:
#   "high" metrics are anomalous when they exceed the threshold (error rates).
#   "low" metrics are anomalous when they fall below the threshold (success
#   rates, citation presence).
_HIGH = "high"
_LOW = "low"


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return float(raw)
    except (TypeError, ValueError):
        return default


@dataclass(frozen=True)
class AIOpsThresholds:
    """Warn/critical bounds for each observed metric.

    All values are overridable via environment variables so ops can tune the
    shadow agent without a code change. Directionality is fixed per metric.
    """

    requests_error_rate_warn: float = field(
        default_factory=lambda: _env_float("AIOPS_REQUESTS_ERROR_RATE_WARN", 0.05)
    )
    requests_error_rate_critical: float = field(
        default_factory=lambda: _env_float("AIOPS_REQUESTS_ERROR_RATE_CRITICAL", 0.15)
    )
    grounding_refusal_rate_warn: float = field(
        default_factory=lambda: _env_float("AIOPS_GROUNDING_REFUSAL_RATE_WARN", 0.20)
    )
    grounding_refusal_rate_critical: float = field(
        default_factory=lambda: _env_float("AIOPS_GROUNDING_REFUSAL_RATE_CRITICAL", 0.40)
    )
    citation_present_rate_warn: float = field(
        default_factory=lambda: _env_float("AIOPS_CITATION_PRESENT_RATE_WARN", 0.80)
    )
    citation_present_rate_critical: float = field(
        default_factory=lambda: _env_float("AIOPS_CITATION_PRESENT_RATE_CRITICAL", 0.50)
    )
    retry_success_rate_warn: float = field(
        default_factory=lambda: _env_float("AIOPS_RETRY_SUCCESS_RATE_WARN", 0.70)
    )
    retry_success_rate_critical: float = field(
        default_factory=lambda: _env_float("AIOPS_RETRY_SUCCESS_RATE_CRITICAL", 0.40)
    )
    llm_error_rate_warn: float = field(
        default_factory=lambda: _env_float("AIOPS_LLM_ERROR_RATE_WARN", 0.05)
    )
    llm_error_rate_critical: float = field(
        default_factory=lambda: _env_float("AIOPS_LLM_ERROR_RATE_CRITICAL", 0.15)
    )
    llm_cost_per_turn_gbp_warn: float = field(
        default_factory=lambda: _env_float("AIOPS_LLM_COST_PER_TURN_GBP_WARN", 0.02)
    )
    llm_cost_per_turn_gbp_critical: float = field(
        default_factory=lambda: _env_float("AIOPS_LLM_COST_PER_TURN_GBP_CRITICAL", 0.05)
    )


# --- Findings / report ------------------------------------------------------


@dataclass(frozen=True)
class AIOpsFinding:
    """A single metric evaluated against its warn/critical thresholds."""

    metric: str
    severity: str
    observed: float
    threshold: float
    direction: str
    message: str

    @property
    def is_anomaly(self) -> bool:
        return self.severity != SEVERITY_OK


@dataclass(frozen=True)
class AIOpsReport:
    """Outcome of assessing one metrics snapshot. Never raises; never acts."""

    findings: Tuple[AIOpsFinding, ...]
    severity: str
    observed_metrics: int

    @property
    def anomalies(self) -> Tuple[AIOpsFinding, ...]:
        return tuple(f for f in self.findings if f.is_anomaly)

    @property
    def healthy(self) -> bool:
        return self.severity == SEVERITY_OK

    def as_dict(self) -> Dict[str, Any]:
        return {
            "severity": self.severity,
            "observed_metrics": self.observed_metrics,
            "anomaly_count": len(self.anomalies),
            "findings": [
                {
                    "metric": f.metric,
                    "severity": f.severity,
                    "observed": f.observed,
                    "threshold": f.threshold,
                    "direction": f.direction,
                    "message": f.message,
                }
                for f in self.findings
            ],
        }


_AIOPS_TOOLS = ("read_durable_metrics",)


class AIOpsAgent(MeshAgent):
    """Shadow-mode operational health observer.

    Construct once and call :meth:`assess_snapshot` with a metrics snapshot, or
    :meth:`read_and_assess` with a ``DurableMetricsReader``-like object. The
    agent only ever *describes* anomalies — promotion to alerts/actions is a
    later phase.
    """

    name = "aiops-agent"

    def __init__(
        self,
        *,
        thresholds: Optional[AIOpsThresholds] = None,
        tool_call_budget: Optional[int] = None,
    ) -> None:
        super().__init__(
            allowed_tools=_AIOPS_TOOLS,
            tool_call_budget=tool_call_budget,
        )
        self.thresholds = thresholds or AIOpsThresholds()

    # -- Public API ---------------------------------------------------------

    def read_and_assess(self, reader: Any) -> Optional[AIOpsReport]:
        """Pull a snapshot from a reader (duck-typed) and assess it.

        Returns ``None`` when the reader is disabled or yields no snapshot, so
        callers can no-op cheaply. The reader must expose ``enabled`` and a
        ``read()`` returning an optional ``dict``.
        """

        enabled = getattr(reader, "enabled", True)
        if not enabled:
            self.log("read_skipped", reason="reader_disabled")
            return None

        self.ensure_tool_allowed("read_durable_metrics")
        snapshot: Optional[Mapping[str, Any]]
        try:
            snapshot = reader.read()
        except Exception as exc:  # defensive: never let observability break callers
            self.log("read_error", error=type(exc).__name__)
            return None

        if not snapshot:
            self.log("read_empty")
            return None
        return self.assess_snapshot(snapshot)

    def assess_snapshot(self, snapshot: Mapping[str, Any]) -> AIOpsReport:
        """Evaluate a metrics snapshot into a structured, non-raising report."""

        findings: List[AIOpsFinding] = []
        observed = 0

        for section, key in (
            ("requests", "error_rate"),
            ("grounding", "refusal_rate"),
            ("citation", "present_rate"),
            ("retry", "success_rate"),
            ("llm", "error_rate"),
            ("llm", "avg_cost_per_turn_gbp"),
        ):
            value = self._extract(snapshot, section, key)
            if value is None:
                continue
            observed += 1
            finding = self._evaluate(section, key, value)
            if finding is not None:
                findings.append(finding)

        severity = SEVERITY_OK
        for f in findings:
            if _SEVERITY_RANK[f.severity] > _SEVERITY_RANK[severity]:
                severity = f.severity

        report = AIOpsReport(
            findings=tuple(findings),
            severity=severity,
            observed_metrics=observed,
        )

        # Shadow mode: observe + log, never act.
        self.log(
            "assess",
            severity=severity,
            observed_metrics=observed,
            anomaly_count=len(report.anomalies),
        )
        for f in report.anomalies:
            self.log(
                "anomaly",
                metric=f.metric,
                severity=f.severity,
                observed=f.observed,
                threshold=f.threshold,
            )
        return report

    # -- Internals ----------------------------------------------------------

    @staticmethod
    def _extract(snapshot: Mapping[str, Any], section: str, key: str) -> Optional[float]:
        block = snapshot.get(section)
        if not isinstance(block, Mapping):
            return None
        raw = block.get(key)
        if raw is None:
            return None
        try:
            return float(raw)
        except (TypeError, ValueError):
            return None

    def _evaluate(self, section: str, key: str, value: float) -> Optional[AIOpsFinding]:
        t = self.thresholds
        metric = f"{section}.{key}"

        if section == "requests" and key == "error_rate":
            return self._high(metric, value, t.requests_error_rate_warn, t.requests_error_rate_critical)
        if section == "grounding" and key == "refusal_rate":
            return self._high(metric, value, t.grounding_refusal_rate_warn, t.grounding_refusal_rate_critical)
        if section == "citation" and key == "present_rate":
            return self._low(metric, value, t.citation_present_rate_warn, t.citation_present_rate_critical)
        if section == "retry" and key == "success_rate":
            return self._low(metric, value, t.retry_success_rate_warn, t.retry_success_rate_critical)
        if section == "llm" and key == "error_rate":
            return self._high(metric, value, t.llm_error_rate_warn, t.llm_error_rate_critical)
        if section == "llm" and key == "avg_cost_per_turn_gbp":
            return self._high(metric, value, t.llm_cost_per_turn_gbp_warn, t.llm_cost_per_turn_gbp_critical)
        return None

    @staticmethod
    def _high(metric: str, value: float, warn: float, critical: float) -> AIOpsFinding:
        if value >= critical:
            severity, threshold = SEVERITY_CRITICAL, critical
        elif value >= warn:
            severity, threshold = SEVERITY_WARN, warn
        else:
            severity, threshold = SEVERITY_OK, warn
        message = (
            f"{metric}={value:.4g} within bound (<{warn:.4g})"
            if severity == SEVERITY_OK
            else f"{metric}={value:.4g} exceeded {severity} bound (>={threshold:.4g})"
        )
        return AIOpsFinding(metric, severity, value, threshold, _HIGH, message)

    @staticmethod
    def _low(metric: str, value: float, warn: float, critical: float) -> AIOpsFinding:
        if value <= critical:
            severity, threshold = SEVERITY_CRITICAL, critical
        elif value <= warn:
            severity, threshold = SEVERITY_WARN, warn
        else:
            severity, threshold = SEVERITY_OK, warn
        message = (
            f"{metric}={value:.4g} within bound (>{warn:.4g})"
            if severity == SEVERITY_OK
            else f"{metric}={value:.4g} below {severity} bound (<={threshold:.4g})"
        )
        return AIOpsFinding(metric, severity, value, threshold, _LOW, message)


__all__ = [
    "AIOpsAgent",
    "AIOpsThresholds",
    "AIOpsFinding",
    "AIOpsReport",
    "SEVERITY_OK",
    "SEVERITY_WARN",
    "SEVERITY_CRITICAL",
]
