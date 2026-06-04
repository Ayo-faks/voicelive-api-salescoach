"""Track B / B3 — staging load + stress driver (DARK / SUSPENDED).

B3 spins up N concurrent synthetic sessions against a **non-prod** staging stack,
ramps until a component bends, and records per-component stress signals to the
durable sink. It deliberately stops at the dark→live boundary: per the signed plan
it crosses into shared infrastructure, so it is **suspended** behind its own
go-live gate (mirroring the increment-7 cron).

What this module ships *now* (so it's ready the moment the gate opens):

* The **mandatory notifier → sink pre-flight check**. In any synthetic/load run the
  safeguarding notifier MUST be a capture sink — a synthetic disclosure must NEVER
  page a real human. :meth:`B3Driver.preflight` is a pure, fully test-covered gate
  that refuses to pass unless (1) the target is a confirmed non-prod environment,
  (2) the notifier is capture-only with **no** real channel (email/SMS/pager/Teams)
  configured, (3) the B3 flags are set, (4) a named operator owns the run, and
  (5) output is captured to a sink, not a human-paging channel.
* A ``suspend()`` teardown that disarms the driver in one action.
* An in-process, concurrency-real ramp that reuses the **B1** persona population and
  the **B2** :class:`~src.learning.eval.population_scorer.PopulationScorer`, feeding
  the same durable sink + drift detector as Track A. The "real staging stack" is an
  injected handler seam — no live infrastructure is touched here.

:meth:`B3Driver.run` is **suspended**: it raises unless the pre-flight gate passes
*and* an operator explicitly passes ``force=True`` (the go-live action). With the
default in-process handler that path is a safe scaled simulation; pointing it at a
real stack is a separate, gated operator decision.

New file only. Reuses the B1/B2/Track-A contracts; edits nothing.
"""

from __future__ import annotations

import os
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Mapping, Optional, Tuple

from src.learning.eval.personas import Persona, default_personas
from src.learning.eval.population_scorer import (
    PopulationScorer,
    population_fixture_handler,
)

# Per-feature kill-switch. The driver only ever runs when this *and*
# ``AGENT_MESH_ENABLED`` are truthy — checked inside the pre-flight gate.
B3_DRIVER_FLAG = "AGENT_MESH_B3_DRIVER_V1"
MESH_ENABLED_FLAG = "AGENT_MESH_ENABLED"

# Sink kinds B3 writes under.
SINK_KIND_STRESS = "b3_stress"
SINK_KIND_CAPTURE = "b3_safeguarding_capture"

# Environments that are acceptable load targets; anything carrying a prod token is
# rejected even if it also matches a non-prod word (e.g. "prod-staging").
NON_PROD_ENVIRONMENTS = frozenset(
    {"staging", "stage", "load", "loadtest", "perf", "dev", "test", "sandbox", "qa"}
)
PROD_TOKENS = frozenset({"prod", "production", "live"})

# Channels that would page a real human. The whole point of the pre-flight check
# is to guarantee none of these is wired during a synthetic run.
REAL_NOTIFIER_CHANNELS = frozenset(
    {"email", "sms", "pager", "phone", "teams", "slack", "webhook", "oncall"}
)

_TRUTHY = frozenset({"1", "true", "yes", "on", "enabled"})


def _flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in _TRUTHY


def b3_driver_enabled() -> bool:
    """Whether B3 is opt-in enabled for this process (mesh + B3 flag)."""
    return _flag(MESH_ENABLED_FLAG) and _flag(B3_DRIVER_FLAG)


# --------------------------------------------------------------------------- #
# Safeguarding notifier abstraction + mandatory capture sink.
# --------------------------------------------------------------------------- #
class SafeguardingNotifier:
    """A channel a synthetic safeguarding disclosure could be routed to.

    Production wires a :class:`HumanPagingNotifier`. A synthetic/load run MUST
    swap that for a :class:`CaptureSinkNotifier` — the pre-flight check enforces
    it. ``channels()`` lists any real human-paging channels; capture-only means
    the tuple is empty.
    """

    def channels(self) -> Tuple[str, ...]:  # pragma: no cover - abstract default
        return ()

    @property
    def is_capture_only(self) -> bool:
        return not self.channels()

    def notify(self, disclosure: Mapping[str, Any]) -> None:  # pragma: no cover
        raise NotImplementedError


class CaptureSinkNotifier(SafeguardingNotifier):
    """Routes every synthetic disclosure to a durable sink — never to a human."""

    def __init__(self, sink: Any) -> None:
        self._sink = sink
        self._captured = 0

    def channels(self) -> Tuple[str, ...]:
        return ()

    @property
    def captured(self) -> int:
        return self._captured

    def notify(self, disclosure: Mapping[str, Any]) -> None:
        record = dict(disclosure)
        record["paged_human"] = False
        record["synthetic"] = True
        try:
            self._sink.record_verdict(SINK_KIND_CAPTURE, record)
        except Exception:  # noqa: BLE001 - capture must never break a run
            pass
        self._captured += 1


class HumanPagingNotifier(SafeguardingNotifier):
    """Stand-in for the PRODUCTION notifier.

    Exists so the pre-flight check has something concrete to reject: an instance
    of this must NEVER drive a synthetic run. ``notify`` refuses outright.
    """

    def __init__(self, channels: Tuple[str, ...]) -> None:
        self._channels = tuple(channels)

    def channels(self) -> Tuple[str, ...]:
        return self._channels

    def notify(self, disclosure: Mapping[str, Any]) -> None:  # pragma: no cover
        raise RuntimeError("HumanPagingNotifier must not run during a synthetic load")


# --------------------------------------------------------------------------- #
# Pre-flight gate.
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class GateCheck:
    name: str
    passed: bool
    detail: str

    def as_dict(self) -> Dict[str, Any]:
        return {"name": self.name, "passed": self.passed, "detail": self.detail}


@dataclass(frozen=True)
class PreflightResult:
    checks: Tuple[GateCheck, ...]

    @property
    def passed(self) -> bool:
        return bool(self.checks) and all(c.passed for c in self.checks)

    @property
    def failures(self) -> Tuple[GateCheck, ...]:
        return tuple(c for c in self.checks if not c.passed)

    def as_dict(self) -> Dict[str, Any]:
        return {
            "passed": self.passed,
            "checks": [c.as_dict() for c in self.checks],
            "failures": [c.name for c in self.failures],
        }


class B3SuspendedError(RuntimeError):
    """Raised when a suspended driver is asked to run."""


class B3PreflightError(RuntimeError):
    """Raised when :meth:`B3Driver.run` is called but the gate did not pass."""

    def __init__(self, result: PreflightResult) -> None:
        self.result = result
        names = ", ".join(c.name for c in result.failures) or "unknown"
        super().__init__(f"B3 pre-flight gate failed: {names}")


def _is_non_prod(environment: str) -> bool:
    env = (environment or "").strip().lower()
    if not env:
        return False
    tokens = set(env.replace("/", "-").replace("_", "-").split("-"))
    if tokens & PROD_TOKENS:
        return False
    return bool(tokens & NON_PROD_ENVIRONMENTS)


# --------------------------------------------------------------------------- #
# Stress instrumentation.
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class LoadSample:
    """One ramp step's observed load."""

    sessions: int
    concurrency: int
    turns: int
    sink_records: int
    elapsed_s: float

    @property
    def throughput(self) -> float:
        return round(self.turns / self.elapsed_s, 4) if self.elapsed_s > 0 else 0.0


@dataclass(frozen=True)
class ComponentReading:
    component: str
    healthy: bool
    value: float
    limit: float

    def as_dict(self) -> Dict[str, Any]:
        return {
            "component": self.component,
            "healthy": self.healthy,
            "value": self.value,
            "limit": self.limit,
        }


ComponentProbe = Callable[[LoadSample], ComponentReading]


def make_capacity_probe(component: str, limit: float) -> ComponentProbe:
    """A probe that bends once ``sessions`` exceeds ``limit``."""

    def _probe(sample: LoadSample) -> ComponentReading:
        return ComponentReading(
            component=component,
            healthy=sample.sessions <= limit,
            value=float(sample.sessions),
            limit=float(limit),
        )

    return _probe


def _healthy_probe(component: str) -> ComponentProbe:
    def _probe(sample: LoadSample) -> ComponentReading:
        return ComponentReading(component, True, float(sample.sessions), float("inf"))

    return _probe


def default_component_probes() -> Tuple[ComponentProbe, ...]:
    """Healthy-by-default probes for the components the plan names.

    Real staging limits are injected at go-live; the in-process default never
    bends so a dry run completes cleanly.
    """

    return (
        _healthy_probe("websocket_concurrency"),
        _healthy_probe("token_volume"),
        _healthy_probe("db_write_throughput"),
        _healthy_probe("sink_ingest_rate"),
        _healthy_probe("latency"),
    )


@dataclass(frozen=True)
class RampStepReport:
    step: int
    sample: LoadSample
    readings: Tuple[ComponentReading, ...]

    @property
    def bent(self) -> Tuple[ComponentReading, ...]:
        return tuple(r for r in self.readings if not r.healthy)

    def as_dict(self) -> Dict[str, Any]:
        return {
            "step": self.step,
            "sessions": self.sample.sessions,
            "throughput": self.sample.throughput,
            "sink_records": self.sample.sink_records,
            "readings": [r.as_dict() for r in self.readings],
        }


@dataclass(frozen=True)
class B3RunReport:
    environment: str
    operator: str
    steps: Tuple[RampStepReport, ...]
    first_bend: Optional[str] = None
    peak_sessions: int = 0

    def as_dict(self) -> Dict[str, Any]:
        return {
            "environment": self.environment,
            "operator": self.operator,
            "first_bend": self.first_bend,
            "peak_sessions": self.peak_sessions,
            "steps": [s.as_dict() for s in self.steps],
        }


# --------------------------------------------------------------------------- #
# Driver config + driver.
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class B3Config:
    environment: str
    operator: str
    notifier: SafeguardingNotifier
    sink: Any
    target_sessions: int = 2000
    max_sessions: int = 20000
    ramp_step: int = 2000
    concurrency: int = 64
    drift_detector: Any = None
    component_probes: Tuple[ComponentProbe, ...] = field(
        default_factory=default_component_probes
    )


class B3Driver:
    """Suspended staging load/stress driver. Ready behind its go-live gate."""

    def __init__(
        self,
        scorer: Optional[PopulationScorer] = None,
        handler: Any = None,
    ) -> None:
        self._scorer = scorer or PopulationScorer()
        # Injected handler == the real staging stack at go-live. Default is the
        # in-process B2 fixture so a dry run touches no infrastructure.
        self._handler = handler or population_fixture_handler()
        self._suspended = False

    def suspend(self) -> None:
        """Disarm the driver in one action; subsequent ``run`` calls refuse."""
        self._suspended = True

    @property
    def suspended(self) -> bool:
        return self._suspended

    def preflight(self, config: B3Config, *, require_flags: bool = True) -> PreflightResult:
        """The mandatory go-live gate. Pure — performs no I/O, never pages."""

        checks: List[GateCheck] = []

        # 1 — confirmed non-prod target.
        non_prod = _is_non_prod(config.environment)
        checks.append(
            GateCheck(
                "non_prod_target",
                non_prod,
                f"environment={config.environment!r} "
                + ("accepted" if non_prod else "is not a confirmed non-prod target"),
            )
        )

        # 2 — notifier is capture-only (MANDATORY): no real human-paging channel.
        notifier = config.notifier
        real = tuple(sorted(set(notifier.channels()) & REAL_NOTIFIER_CHANNELS))
        capture_only = notifier.is_capture_only and not real
        checks.append(
            GateCheck(
                "notifier_capture_only",
                capture_only,
                "capture-only notifier"
                if capture_only
                else f"real channel(s) configured: {', '.join(real) or notifier.channels()}",
            )
        )

        # 3 — B3 flags set (mesh + feature) only in this environment.
        flags_ok = (not require_flags) or b3_driver_enabled()
        checks.append(
            GateCheck(
                "feature_flags_set",
                flags_ok,
                "AGENT_MESH_ENABLED + B3 flag set"
                if flags_ok
                else f"set {MESH_ENABLED_FLAG} and {B3_DRIVER_FLAG} to enable",
            )
        )

        # 4 — a named operator owns the run.
        operator = bool((config.operator or "").strip())
        checks.append(
            GateCheck(
                "named_operator",
                operator,
                f"operator={config.operator!r}" if operator else "no operator named",
            )
        )

        # 5 — output captured to a sink, not a human channel.
        sink_ok = config.sink is not None
        checks.append(
            GateCheck(
                "output_to_sink",
                sink_ok,
                "sink configured" if sink_ok else "no durable sink configured",
            )
        )

        return PreflightResult(tuple(checks))

    def run(
        self,
        config: B3Config,
        *,
        force: bool = False,
        require_flags: bool = True,
    ) -> B3RunReport:
        """Execute the ramp. SUSPENDED: refuses unless gate passes AND ``force``.

        ``force=True`` is the explicit operator go-live action. With the default
        in-process handler this is a safe scaled simulation; pointing the handler
        at a real stack is a separate, gated operator decision.
        """

        if self._suspended:
            raise B3SuspendedError("driver suspended; tear down and re-arm to run")

        result = self.preflight(config, require_flags=require_flags)
        if not result.passed:
            raise B3PreflightError(result)

        if not force:
            raise B3SuspendedError(
                "B3 is suspended; pass force=True only behind the go-live gate"
            )

        return self._execute(config)

    # -- internals -------------------------------------------------------- #
    def _execute(self, config: B3Config) -> B3RunReport:
        steps: List[RampStepReport] = []
        first_bend: Optional[str] = None
        peak = 0
        step_no = 0
        sessions = max(1, config.target_sessions)

        while sessions <= config.max_sessions:
            step_no += 1
            peak = sessions
            sample = self._drive_step(config, sessions)
            readings = tuple(probe(sample) for probe in config.component_probes)
            report = RampStepReport(step_no, sample, readings)
            steps.append(report)
            self._record_stress(config, report)

            bent = report.bent
            if bent:
                first_bend = bent[0].component
                break
            sessions += max(1, config.ramp_step)

        return B3RunReport(
            environment=config.environment,
            operator=config.operator,
            steps=tuple(steps),
            first_bend=first_bend,
            peak_sessions=peak,
        )

    def _drive_step(self, config: B3Config, sessions: int) -> LoadSample:
        """Drive ~``sessions`` synthetic sessions concurrently for one ramp step."""

        # One archetype set == 5 personas; scale replicas to reach the target.
        replicas = max(1, (sessions + 4) // 5)
        population = default_personas(require_flag=False, replicas=replicas)
        chunks = _split(population, max(1, config.concurrency))

        start = time.perf_counter()
        recorded = 0
        turns = 0
        workers = min(len(chunks), max(1, config.concurrency))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [
                pool.submit(
                    self._scorer.score,
                    chunk,
                    self._handler,
                    suite_id="b3",
                    sink=config.sink,
                    require_flag=False,
                )
                for chunk in chunks
            ]
            for fut in futures:
                report = fut.result()
                recorded += report.recorded
                turns += report.turn_count
        elapsed = time.perf_counter() - start

        if config.drift_detector is not None:
            self._feed_drift(config)

        return LoadSample(
            sessions=sessions,
            concurrency=workers,
            turns=turns,
            sink_records=recorded,
            elapsed_s=elapsed,
        )

    @staticmethod
    def _feed_drift(config: B3Config) -> None:
        try:
            config.drift_detector.assess(sink=config.sink)
        except Exception:  # noqa: BLE001 - drift read must never break a run
            pass

    @staticmethod
    def _record_stress(config: B3Config, report: RampStepReport) -> None:
        if config.sink is None:
            return
        try:
            config.sink.record_verdict(SINK_KIND_STRESS, report.as_dict())
        except Exception:  # noqa: BLE001
            pass


def _split(items: Tuple[Persona, ...], parts: int) -> Tuple[Tuple[Persona, ...], ...]:
    parts = max(1, min(parts, len(items) or 1))
    out: List[List[Persona]] = [[] for _ in range(parts)]
    for i, item in enumerate(items):
        out[i % parts].append(item)
    return tuple(tuple(chunk) for chunk in out if chunk)


__all__ = [
    "B3_DRIVER_FLAG",
    "MESH_ENABLED_FLAG",
    "SINK_KIND_STRESS",
    "SINK_KIND_CAPTURE",
    "NON_PROD_ENVIRONMENTS",
    "REAL_NOTIFIER_CHANNELS",
    "b3_driver_enabled",
    "SafeguardingNotifier",
    "CaptureSinkNotifier",
    "HumanPagingNotifier",
    "GateCheck",
    "PreflightResult",
    "B3SuspendedError",
    "B3PreflightError",
    "LoadSample",
    "ComponentReading",
    "ComponentProbe",
    "make_capacity_probe",
    "default_component_probes",
    "RampStepReport",
    "B3RunReport",
    "B3Config",
    "B3Driver",
]
