"""Durable observability backing via Azure Monitor / Log Analytics KQL.

The in-process counters in :mod:`src.learning.observability` reset on every
deploy and only reflect a single replica. For the admin dashboard to show
values that survive deploys and aggregate across replicas, the counter-based
tiles can be backed by the same OpenTelemetry metrics already exported to
Application Insights (the workspace-based ``AppMetrics`` table).

Histogram percentiles (LLM latency, voice TTFA) and the safeguarding ``actioned``
rate are not faithfully reconstructable from exported customMetrics, so those
tiles intentionally remain in-process and are out of scope here.

The reader is best-effort: it never raises and returns ``None`` when Azure
Monitor is not configured or any query fails, so the dashboard degrades to the
in-process snapshot.
"""

from __future__ import annotations

import json
import os
import threading
import time
from datetime import timedelta
from typing import Any, Dict, List, Optional, Sequence, Tuple

RESOURCE_ID_ENV = "APPLICATIONINSIGHTS_RESOURCE_ID"
ENABLED_ENV = "OBSERVABILITY_KQL_ENABLED"
WINDOW_HOURS_ENV = "OBSERVABILITY_KQL_WINDOW_HOURS"
CACHE_SECONDS_ENV = "OBSERVABILITY_KQL_CACHE_SECONDS"

_METRIC_NAMES = (
    "pathfinder_learning_requests_total",
    "pathfinder_learning_llm_turns_total",
    "pathfinder_learning_llm_cost_gbp_total",
    "pathfinder_learning_citation_total",
    "pathfinder_learning_grounding_total",
    "pathfinder_learning_retry_outcomes_total",
)


def _ratio(numerator: float, denominator: float) -> float:
    return float(numerator) / float(denominator) if denominator else 0.0


def _truthy(value: Optional[str]) -> bool:
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


class DurableMetricsReader:
    """Reconstruct counter-based metric subsections from Azure Monitor logs."""

    def __init__(
        self,
        *,
        resource_id: Optional[str] = None,
        window_hours: Optional[float] = None,
        cache_seconds: Optional[float] = None,
        enabled: Optional[bool] = None,
    ) -> None:
        self._resource_id = resource_id if resource_id is not None else os.getenv(RESOURCE_ID_ENV)
        if enabled is None:
            flag = os.getenv(ENABLED_ENV)
            enabled = _truthy(flag) if flag is not None else bool(self._resource_id)
        self._enabled = bool(enabled) and bool(self._resource_id)
        self._window_hours = window_hours if window_hours is not None else _env_float(WINDOW_HOURS_ENV, 24.0)
        self._cache_seconds = (
            cache_seconds if cache_seconds is not None else _env_float(CACHE_SECONDS_ENV, 60.0)
        )
        self._lock = threading.Lock()
        self._cache: Optional[Dict[str, Any]] = None
        self._cache_at: float = 0.0

    @property
    def enabled(self) -> bool:
        return self._enabled

    def read(self) -> Optional[Dict[str, Any]]:
        """Return durable counter subsections, or ``None`` when unavailable."""
        if not self._enabled:
            return None
        now = time.monotonic()
        with self._lock:
            if self._cache is not None and (now - self._cache_at) < self._cache_seconds:
                return self._cache
        try:
            rows = self._fetch_rows()
        except Exception:  # pragma: no cover - best effort, never raises
            return None
        if rows is None:
            return None
        snapshot = self._rows_to_snapshot(rows)
        with self._lock:
            self._cache = snapshot
            self._cache_at = time.monotonic()
        return snapshot

    def _fetch_rows(self) -> Optional[List[Sequence[Any]]]:
        from azure.identity import DefaultAzureCredential
        from azure.monitor.query import LogsQueryClient, LogsQueryStatus

        names = ", ".join(f'"{name}"' for name in _METRIC_NAMES)
        query = (
            "AppMetrics "
            f"| where Name in ({names}) "
            "| extend props = tostring(Properties) "
            "| summarize Value = sum(Sum) by Name, props"
        )
        client = LogsQueryClient(DefaultAzureCredential())
        try:
            response = client.query_resource(
                self._resource_id,
                query,
                timespan=timedelta(hours=self._window_hours),
            )
        finally:
            close = getattr(client, "close", None)
            if callable(close):
                try:
                    close()
                except Exception:  # pragma: no cover - defensive
                    pass
        if getattr(response, "status", None) == LogsQueryStatus.FAILURE:
            return None
        tables = getattr(response, "tables", None) or []
        if not tables:
            return None
        return list(tables[0].rows)

    @staticmethod
    def _rows_to_snapshot(rows: Sequence[Sequence[Any]]) -> Dict[str, Any]:
        # name -> {dimension-tuple-or-label: summed value}
        by_name: Dict[str, List[Tuple[Dict[str, str], float]]] = {}
        for row in rows:
            try:
                name = str(row[0])
                props_raw = row[1]
                value = float(row[2] or 0.0)
            except (IndexError, TypeError, ValueError):
                continue
            props: Dict[str, str] = {}
            if props_raw:
                try:
                    parsed = json.loads(props_raw)
                    if isinstance(parsed, dict):
                        props = {str(k): str(v) for k, v in parsed.items()}
                except (TypeError, ValueError):
                    props = {}
            by_name.setdefault(name, []).append((props, value))

        snapshot: Dict[str, Any] = {}

        requests = _counts_by(by_name.get("pathfinder_learning_requests_total"), "outcome")
        if requests:
            total = sum(requests.values())
            snapshot["requests"] = {
                "counts": requests,
                "total": total,
                "error_rate": _ratio(requests.get("error", 0.0), total),
            }

        citation = _counts_by(by_name.get("pathfinder_learning_citation_total"), "presence")
        if citation:
            total = sum(citation.values())
            snapshot["citation"] = {
                "counts": citation,
                "total": total,
                "present_rate": _ratio(citation.get("present", 0.0), total),
            }

        grounding = _counts_by(by_name.get("pathfinder_learning_grounding_total"), "decision")
        if grounding:
            total = sum(grounding.values())
            snapshot["grounding"] = {
                "counts": grounding,
                "total": total,
                "refusal_rate": _ratio(grounding.get("refused", 0.0), total),
                "ground_rate": _ratio(grounding.get("grounded", 0.0), total),
            }

        retry = _counts_by(by_name.get("pathfinder_learning_retry_outcomes_total"), "outcome")
        if retry:
            total = retry.get("success", 0.0) + retry.get("fail", 0.0)
            snapshot["retry"] = {
                "counts": retry,
                "total": total,
                "success_rate": _ratio(retry.get("success", 0.0), total),
                "by_version": {},
            }

        turns = _counts_by(by_name.get("pathfinder_learning_llm_turns_total"), "outcome")
        cost_rows = by_name.get("pathfinder_learning_llm_cost_gbp_total")
        if turns:
            total_turns = sum(turns.values())
            errors = sum(value for outcome, value in turns.items() if outcome != "success")
            cost_sum = sum(value for _props, value in (cost_rows or []))
            snapshot["llm"] = {
                "turns": total_turns,
                "errors": errors,
                "error_rate": _ratio(errors, total_turns),
                "cost_gbp_total": cost_sum,
                "avg_cost_per_turn_gbp": _ratio(cost_sum, total_turns),
            }

        return snapshot


def _counts_by(
    rows: Optional[Sequence[Tuple[Dict[str, str], float]]], dimension: str
) -> Dict[str, float]:
    if not rows:
        return {}
    counts: Dict[str, float] = {}
    for props, value in rows:
        key = props.get(dimension) or "unknown"
        counts[key] = counts.get(key, 0.0) + float(value)
    return counts


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except (TypeError, ValueError):
        return default


__all__ = ["DurableMetricsReader"]
