"""Online drift detection — watches mesh veto-rate history for degradation.

Increment 6 of Track A. The third online piece: it reads the verdict history a
:class:`~src.agents.memory_agent.MemoryAgent` (or the durable sink) already
accumulates and computes whether the **safeguarding veto rate** has drifted away
from a baseline. A drift is a *signal* only — it feeds the rollback adapter,
which in turn emits a human-gated proposal. Nothing here mutates a release.

Hard constraints (consistent with the rest of the mesh):

* **Monitoring only.** Drift detection never blocks, deploys, or rolls back. It
  returns a :class:`DriftSignal`; acting on it is a separate, human-gated step.
  In particular it learns/observes a *baseline*, never the safeguarding decision.
* **Shadow / dark by default.** Behind ``AGENT_MESH_ENABLED`` *and* its own
  ``AGENT_MESH_DRIFT_V1`` kill-switch. When dark (and ``force`` not passed)
  :meth:`assess` returns a ``disabled`` no-drift signal.
* **Non-raising.** Any unreadable history degrades to ``no drift`` (fail-safe —
  never fabricate a drift off data we could not read), never an exception.
* **Dependency-free.** Only stdlib. History sources are duck-typed: a
  ``MemoryAgent`` (``recent``), a durable sink (``read``), or a plain iterable of
  record-likes / mappings.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

from src.agents.base import agent_mesh_enabled

# Per-feature kill-switch. Dark by default; drift assessment only runs when this
# *and* ``AGENT_MESH_ENABLED`` are truthy (or ``force``).
DRIFT_FLAG = "AGENT_MESH_DRIFT_V1"

# Default kind whose veto rate we watch, and the default absolute drift band.
DEFAULT_METRIC = "veto_rate"
DEFAULT_KIND = "safeguarding"
DEFAULT_THRESHOLD = 0.20  # absolute change in veto rate that counts as drift
DEFAULT_MIN_SAMPLES = 8  # below this we lack power → report no drift

_TRUTHY = frozenset({"1", "true", "yes", "on", "enabled"})


def _flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name, "")
    value = raw.strip().lower()
    if not value:
        return default
    return value in _TRUTHY


def drift_detector_enabled() -> bool:
    """Whether the online drift path is opt-in enabled (mesh + feature flag)."""
    return agent_mesh_enabled() and _flag(DRIFT_FLAG, default=False)


@dataclass(frozen=True)
class DriftSignal:
    """Outcome of one drift assessment. Never acts.

    * ``drifted`` is the single boolean a caller branches on.
    * ``disabled`` is ``True`` when the detector was dark or under-powered (too
      few samples); such a signal is always ``drifted=False``.
    """

    drifted: bool
    metric: str = DEFAULT_METRIC
    baseline: float = 0.0
    observed: float = 0.0
    delta: float = 0.0
    threshold: float = DEFAULT_THRESHOLD
    sample_size: int = 0
    baseline_size: int = 0
    disabled: bool = False
    reasons: Tuple[str, ...] = ()

    def as_dict(self) -> Dict[str, Any]:
        return {
            "drifted": self.drifted,
            "metric": self.metric,
            "baseline": self.baseline,
            "observed": self.observed,
            "delta": self.delta,
            "threshold": self.threshold,
            "sample_size": self.sample_size,
            "baseline_size": self.baseline_size,
            "disabled": self.disabled,
            "reasons": list(self.reasons),
        }


def _payload_of(record: Any) -> Mapping[str, Any]:
    """Best-effort extraction of a record's payload mapping. Never raises."""
    payload = getattr(record, "payload", None)
    if isinstance(payload, Mapping):
        return payload
    if isinstance(record, Mapping):
        inner = record.get("payload")
        if isinstance(inner, Mapping):
            return inner
        return record
    as_dict = getattr(record, "as_dict", None)
    if callable(as_dict):
        try:
            value = as_dict()
            if isinstance(value, Mapping):
                inner = value.get("payload")
                return inner if isinstance(inner, Mapping) else value
        except Exception:  # pragma: no cover - defensive
            return {}
    return {}


def _kind_of(record: Any) -> Optional[str]:
    kind = getattr(record, "kind", None)
    if kind is not None:
        return str(kind)
    if isinstance(record, Mapping):
        raw = record.get("kind")
        return str(raw) if raw is not None else None
    return None


def _is_veto(record: Any) -> bool:
    """Whether a safeguarding record represents a veto (``allowed`` falsey)."""
    payload = _payload_of(record)
    if "allowed" in payload:
        return not bool(payload.get("allowed"))
    if "vetoed" in payload:
        return bool(payload.get("vetoed"))
    return False


def _read_history(source: Any, *, kind: str, limit: int) -> List[Any]:
    """Duck-type a history source into a list of records (oldest → newest).

    Accepts a ``MemoryAgent`` (``recent``), a durable sink (``read``), or any
    iterable of record-likes. Never raises — anything unreadable yields ``[]``.
    """
    # MemoryAgent.recent(limit, *, kind=None) → oldest-first list.
    recent = getattr(source, "recent", None)
    if callable(recent):
        try:
            return list(recent(limit, kind=kind))
        except TypeError:
            try:
                return list(recent(limit))
            except Exception:
                return []
        except Exception:
            return []
    # DurableSink.read(limit, *, kind=None) → list.
    read = getattr(source, "read", None)
    if callable(read):
        try:
            return list(read(limit, kind=kind))
        except TypeError:
            try:
                return list(read(limit))
            except Exception:
                return []
        except Exception:
            return []
    if isinstance(source, Iterable) and not isinstance(source, (str, bytes, Mapping)):
        try:
            return list(source)
        except Exception:
            return []
    return []


class DriftDetector:
    """Computes veto-rate drift over recorded mesh history. Read-only.

    Construct once and call :meth:`assess` with a history source. Drift is the
    absolute change of the recent-window veto rate versus a baseline — either an
    explicit ``baseline`` rate, or the older half of the history when no baseline
    is supplied. Returns a :class:`DriftSignal`; acting on it is human-gated.
    """

    name = "drift-detector"

    def __init__(
        self,
        *,
        kind: str = DEFAULT_KIND,
        threshold: float = DEFAULT_THRESHOLD,
        min_samples: int = DEFAULT_MIN_SAMPLES,
        window: int = 256,
    ) -> None:
        self.kind = kind
        self.threshold = float(threshold)
        self.min_samples = int(min_samples)
        self.window = int(window)

    # -- helpers ------------------------------------------------------------

    @staticmethod
    def veto_rate(records: Sequence[Any]) -> float:
        """Fraction of ``records`` that are vetoes. Empty → 0.0."""
        total = len(records)
        if total == 0:
            return 0.0
        vetoes = sum(1 for r in records if _is_veto(r))
        return vetoes / total

    # -- public API ---------------------------------------------------------

    def assess(
        self,
        source: Any = None,
        *,
        baseline: Optional[float] = None,
        force: bool = False,
    ) -> DriftSignal:
        """Return a drift signal for the veto rate in ``source``.

        * Dark (mesh off or flag unset, ``force`` not set) → ``disabled`` no-drift.
        * Fewer than ``min_samples`` recent records → ``disabled`` no-drift
          (under-powered; never fabricate a signal off thin data).
        * Otherwise drift when ``|observed − baseline| > threshold``.
        """
        if not force and not drift_detector_enabled():
            return DriftSignal(
                drifted=False,
                threshold=self.threshold,
                disabled=True,
                reasons=("drift detector dark — mesh or AGENT_MESH_DRIFT_V1 unset",),
            )

        records = _read_history(source, kind=self.kind, limit=self.window)
        # Keep only the watched kind when records carry a kind tag.
        kept = [r for r in records if (_kind_of(r) in (None, self.kind))]

        if baseline is not None:
            observed_records = kept
            base_rate = float(baseline)
            base_size = 0
        else:
            # Split oldest half = baseline, newest half = observed window.
            half = len(kept) // 2
            baseline_records = kept[:half]
            observed_records = kept[half:]
            base_rate = self.veto_rate(baseline_records)
            base_size = len(baseline_records)

        sample_size = len(observed_records)
        if sample_size < self.min_samples:
            return DriftSignal(
                drifted=False,
                baseline=round(base_rate, 6),
                observed=round(self.veto_rate(observed_records), 6),
                delta=0.0,
                threshold=self.threshold,
                sample_size=sample_size,
                baseline_size=base_size,
                disabled=True,
                reasons=(
                    f"under-powered: {sample_size} samples < min {self.min_samples}",
                ),
            )

        observed = self.veto_rate(observed_records)
        delta = observed - base_rate
        drifted = abs(delta) > self.threshold
        reasons: Tuple[str, ...] = ()
        if drifted:
            direction = "rose" if delta > 0 else "fell"
            reasons = (
                f"{self.kind} {self.metric_label} {direction} by "
                f"{abs(delta):.3f} (> {self.threshold:.3f})",
            )

        return DriftSignal(
            drifted=drifted,
            baseline=round(base_rate, 6),
            observed=round(observed, 6),
            delta=round(delta, 6),
            threshold=self.threshold,
            sample_size=sample_size,
            baseline_size=base_size,
            disabled=False,
            reasons=reasons,
        )

    metric_label = "veto rate"


__all__ = [
    "DRIFT_FLAG",
    "DEFAULT_KIND",
    "DEFAULT_METRIC",
    "DEFAULT_THRESHOLD",
    "DEFAULT_MIN_SAMPLES",
    "DriftDetector",
    "DriftSignal",
    "drift_detector_enabled",
]
