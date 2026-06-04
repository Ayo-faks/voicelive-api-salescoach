"""ObservabilityGate — wires the read-only mesh agents into one cycle.

Phase 4 (integration) of the agent mesh. Every prior agent produces a
structured, non-raising verdict; this coordinator is the seam that actually
*runs* them together on a schedule (cron) or in a pipeline (CI gate), records
every outcome into a :class:`~src.agents.memory_agent.MemoryAgent`, and folds
them into a single dashboard-shaped :class:`ObservabilityReport` plus a CI
``exit_code``.

It composes — it does not reimplement:

* :class:`~src.agents.aiops_agent.AIOpsAgent` → operational health snapshot.
* :class:`~src.agents.genaiops_agent.GenAIOpsAgent` → release eval verdict.
* :class:`~src.agents.devops_agent.DevOpsAgent` → staging go / no-go decision
  (which itself folds the two above).
* :class:`~src.agents.migration_agent.MigrationAgent` → schema-change risk.
* :class:`~src.agents.memory_agent.MemoryAgent` → durable-for-the-process record
  of every outcome, so a dashboard can read recent history.

Constraints (consistent with the rest of the mesh):

* **Dark by default.** When ``agent_mesh_enabled()`` is ``False`` and the call
  is not explicitly forced, the gate runs *no* agents and returns a
  ``disabled`` report with ``exit_code == 0`` — so wiring it into a cron or CI
  step is a no-op until the flag is set.
* **Read-only and non-raising.** No deploys, no migrations, no mutations beyond
  the in-process memory buffer. Any agent blow-up degrades to an ``error``
  report rather than crashing the cron/pipeline.
* **One exit code.** ``exit_code`` is ``1`` only when the gate must fail a
  pipeline (a blocked staging deploy, an unapproved destructive migration, or a
  critical ops anomaly); everything else is ``0``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Tuple

from src.agents.aiops_agent import AIOpsAgent
from src.agents.base import agent_mesh_enabled
from src.agents.devops_agent import DevOpsAgent
from src.agents.genaiops_agent import GenAIOpsAgent
from src.agents.memory_agent import MemoryAgent
from src.agents.migration_agent import MigrationAgent

# --- Overall states ---------------------------------------------------------

STATUS_OK = "ok"  # everything consulted is clean
STATUS_DEGRADED = "degraded"  # non-blocking anomalies/warnings observed
STATUS_BLOCKED = "blocked"  # a hard gate failed (CI must fail)
STATUS_DISABLED = "disabled"  # mesh dark — nothing ran
STATUS_ERROR = "error"  # the cycle itself blew up


@dataclass(frozen=True)
class ObservabilityReport:
    """Aggregate outcome of one observability cycle. Never acts.

    ``as_dict`` is the dashboard payload; ``exit_code`` is the CI verdict.
    """

    status: str
    ops: Optional[Dict[str, Any]] = None
    eval: Optional[Dict[str, Any]] = None
    safeguarding: Optional[Dict[str, Any]] = None
    critic: Optional[Dict[str, Any]] = None
    deploy: Optional[Dict[str, Any]] = None
    migration: Optional[Dict[str, Any]] = None
    planners: Optional[Dict[str, Any]] = None
    reasons: Tuple[str, ...] = ()
    recorded: int = 0

    @property
    def healthy(self) -> bool:
        return self.status in (STATUS_OK, STATUS_DISABLED)

    @property
    def gate_passed(self) -> bool:
        """True when a CI pipeline may proceed (anything but a hard block)."""
        return self.status != STATUS_BLOCKED

    @property
    def exit_code(self) -> int:
        return 0 if self.gate_passed else 1

    def as_dict(self) -> Dict[str, Any]:
        return {
            "status": self.status,
            "healthy": self.healthy,
            "gate_passed": self.gate_passed,
            "exit_code": self.exit_code,
            "reasons": list(self.reasons),
            "recorded": self.recorded,
            "ops": self.ops,
            "eval": self.eval,
            "safeguarding": self.safeguarding,
            "critic": self.critic,
            "deploy": self.deploy,
            "migration": self.migration,
            "planners": self.planners,
        }


class ObservabilityGate:
    """Coordinator that runs the read-only agents and aggregates their verdicts.

    Inject agents for testing, or let the gate construct defaults. A single
    :class:`MemoryAgent` is shared so successive cycles accumulate history that
    a dashboard can read via :meth:`history`.
    """

    def __init__(
        self,
        *,
        aiops: Optional[AIOpsAgent] = None,
        genaiops: Optional[GenAIOpsAgent] = None,
        devops: Optional[DevOpsAgent] = None,
        migration: Optional[MigrationAgent] = None,
        memory: Optional[MemoryAgent] = None,
    ) -> None:
        self.aiops = aiops or AIOpsAgent()
        self.genaiops = genaiops or GenAIOpsAgent()
        self.devops = devops or DevOpsAgent()
        self.migration = migration or MigrationAgent()
        # NB: MemoryAgent defines __len__, so an empty one is falsy — use an
        # explicit None check rather than ``or`` to avoid discarding it.
        self.memory = memory if memory is not None else MemoryAgent()

    # -- Public API -----------------------------------------------------

    def run_cycle(
        self,
        *,
        reader: Any = None,
        eval_handler: Any = None,
        safeguarding_handler: Any = None,
        critic_handler: Any = None,
        target_env: Optional[str] = None,
        migration_steps: Optional[Iterable[Any]] = None,
        allow_skipped_eval: bool = False,
        require_probe_flag: bool = True,
        durable_sink: Any = None,
        force: bool = False,
    ) -> ObservabilityReport:
        """Run all available read-only agents once and aggregate. Never raises.

        Every argument is optional — the gate consults only the agents whose
        inputs are supplied, so the same entry point serves a metrics-only cron
        and a full pre-deploy CI gate.

        Parameters
        ----------
        reader:
            A ``DurableMetricsReader``-like object for :class:`AIOpsAgent`.
        eval_handler:
            An eval ``handler`` for :class:`GenAIOpsAgent`. Required to run the
            release eval gate.
        safeguarding_handler:
            An eval ``handler`` driving the offline safeguarding probe suite. When
            supplied, the gate runs that suite through :class:`GenAIOpsAgent` and
            folds a failure into the blocking reasons. Dark per-suite: the suite is
            skipped (non-blocking) when its kill-switch flag is unset.
        critic_handler:
            An eval ``handler`` driving the offline critic quality probe suite,
            same optional/dark semantics as ``safeguarding_handler``.
        target_env:
            Staging environment for the :class:`DevOpsAgent` go/no-go. When set,
            the ops report and eval verdict are folded into a deploy decision.
        migration_steps:
            Proposed migration steps for :class:`MigrationAgent`.
        allow_skipped_eval:
            Passed through to the deploy decision (a skipped eval doesn't block).
        require_probe_flag:
            When True (default), each offline probe suite stays dark unless its
            per-suite kill-switch env flag is set; an unset flag yields a skipped
            (non-blocking) verdict.
        durable_sink:
            An optional :class:`~src.agents.durable_sink.DurableSink`. When
            supplied, every verdict recorded into the in-process
            :class:`MemoryAgent` is *also* mirrored into the sink so history
            survives across runs for the online drift detector. Dark by default:
            pass ``None`` (or let :func:`build_durable_sink` return ``None`` when
            its kill-switch is unset) and the gate behaves exactly as before.
        force:
            Run even when the mesh flag is off (for explicit CI invocations).
        """
        if not force and not agent_mesh_enabled():
            return ObservabilityReport(status=STATUS_DISABLED)

        try:
            return self._run_cycle(
                reader=reader,
                eval_handler=eval_handler,
                safeguarding_handler=safeguarding_handler,
                critic_handler=critic_handler,
                target_env=target_env,
                migration_steps=migration_steps,
                allow_skipped_eval=allow_skipped_eval,
                require_probe_flag=require_probe_flag,
                durable_sink=durable_sink,
            )
        except Exception as exc:  # pragma: no cover - cron/CI must never crash
            return ObservabilityReport(
                status=STATUS_ERROR,
                reasons=(f"{type(exc).__name__}: {exc}",),
            )

    def history(self, *, limit: int = 20, kind: Optional[str] = None) -> List[Dict[str, Any]]:
        """Recent recorded outcomes as dashboard-friendly dicts (newest last)."""
        return [r.as_dict() for r in self.memory.recent(limit=limit, kind=kind)]

    # -- Internals ------------------------------------------------------

    def _run_cycle(
        self,
        *,
        reader: Any,
        eval_handler: Any,
        safeguarding_handler: Any,
        critic_handler: Any,
        target_env: Optional[str],
        migration_steps: Optional[Iterable[Any]],
        allow_skipped_eval: bool,
        require_probe_flag: bool,
        durable_sink: Any,
    ) -> ObservabilityReport:
        recorded = 0
        reasons: List[str] = []

        def _record(kind: str, verdict: Any) -> None:
            """Record into in-process memory and mirror into the durable sink."""
            self.memory.record(kind, verdict)
            if durable_sink is not None:
                durable_sink.record_verdict(kind, verdict)

        # 1. Operational health (cron's bread and butter).
        ops_report = None
        ops_dict: Optional[Dict[str, Any]] = None
        if reader is not None:
            ops_report = self.aiops.read_and_assess(reader)
            if ops_report is not None:
                ops_dict = ops_report.as_dict()
                _record("aiops", ops_report)
                recorded += 1
                if ops_report.severity == "critical":
                    reasons.append("ops_health_critical")

        # 2. Release eval gate.
        eval_verdict = None
        eval_dict: Optional[Dict[str, Any]] = None
        if eval_handler is not None:
            eval_verdict = self.genaiops.evaluate(eval_handler)
            eval_dict = eval_verdict.as_dict()
            _record("genaiops", eval_verdict)
            recorded += 1

        # 2a. Offline safeguarding probe suite (dark per its own flag).
        safeguarding_verdict = None
        safeguarding_dict: Optional[Dict[str, Any]] = None
        if safeguarding_handler is not None:
            safeguarding_verdict = self._run_probe_suite(
                safeguarding_handler,
                suite_id="safeguarding-gate",
                record_kind="safeguarding",
                probe_loader=self._load_safeguarding_probes,
                require_probe_flag=require_probe_flag,
            )
            safeguarding_dict = safeguarding_verdict.as_dict()
            _record("safeguarding", safeguarding_verdict)
            recorded += 1
            if safeguarding_verdict.status == "failed" or safeguarding_verdict.status == "error":
                reasons.append("safeguarding_gate_failed")

        # 2b. Offline critic quality probe suite (dark per its own flag).
        critic_verdict = None
        critic_dict: Optional[Dict[str, Any]] = None
        if critic_handler is not None:
            critic_verdict = self._run_probe_suite(
                critic_handler,
                suite_id="critic-gate",
                record_kind="critic",
                probe_loader=self._load_critic_probes,
                require_probe_flag=require_probe_flag,
            )
            critic_dict = critic_verdict.as_dict()
            _record("critic", critic_verdict)
            recorded += 1
            if critic_verdict.status == "failed" or critic_verdict.status == "error":
                reasons.append("critic_gate_failed")

        # 3. Staging go/no-go folds ops + eval into one decision.
        deploy_dict: Optional[Dict[str, Any]] = None
        if target_env is not None:
            decision = self.devops.evaluate_release(
                target_env=target_env,
                eval_verdict=eval_verdict,
                ops_report=ops_report,
                allow_skipped_eval=allow_skipped_eval,
            )
            deploy_dict = decision.as_dict()
            _record("devops", decision)
            recorded += 1
            if decision.status == "no_go":
                reasons.append("staging_deploy_no_go")
            elif decision.status == "blocked":
                reasons.append("non_staging_target_blocked")

        # 4. Migration risk.
        migration_dict: Optional[Dict[str, Any]] = None
        if migration_steps is not None:
            plan = self.migration.assess(migration_steps)
            migration_dict = plan.as_dict()
            _record("migration", plan)
            recorded += 1
            if plan.destructive:
                reasons.append("destructive_migration")

        status = self._aggregate_status(
            reasons=reasons,
            ops_report=ops_report,
            eval_verdict=eval_verdict,
            probe_verdicts=(safeguarding_verdict, critic_verdict),
        )
        return ObservabilityReport(
            status=status,
            ops=ops_dict,
            eval=eval_dict,
            safeguarding=safeguarding_dict,
            critic=critic_dict,
            deploy=deploy_dict,
            migration=migration_dict,
            reasons=tuple(reasons),
            recorded=recorded,
        )

    @staticmethod
    def _aggregate_status(
        *,
        reasons: List[str],
        ops_report: Any,
        eval_verdict: Any,
        probe_verdicts: Tuple[Any, ...] = (),
    ) -> str:
        # A hard block trumps everything: a no-go deploy, a destructive
        # migration, critical ops, or a failed safety/quality probe suite all
        # fail a CI pipeline.
        blocking = {
            "ops_health_critical",
            "staging_deploy_no_go",
            "non_staging_target_blocked",
            "destructive_migration",
            "safeguarding_gate_failed",
            "critic_gate_failed",
        }
        if any(r in blocking for r in reasons):
            return STATUS_BLOCKED

        # Otherwise surface "degraded" when something non-blocking is off:
        # ops warnings, or an eval/probe suite that didn't cleanly pass
        # (skipped/error but not a hard failure).
        degraded = False
        if ops_report is not None and getattr(ops_report, "severity", "ok") != "ok":
            degraded = True
        if eval_verdict is not None and getattr(eval_verdict, "status", "passed") != "passed":
            degraded = True
        for verdict in probe_verdicts:
            if verdict is not None and getattr(verdict, "status", "passed") != "passed":
                degraded = True
        return STATUS_DEGRADED if degraded else STATUS_OK

    # -- Offline probe-suite wiring -------------------------------------

    def _run_probe_suite(
        self,
        handler: Any,
        *,
        suite_id: str,
        record_kind: str,
        probe_loader: Any,
        require_probe_flag: bool,
    ) -> Any:
        """Run one offline probe suite through the GenAIOps gate.

        Resolves the suite's probes via ``probe_loader`` (gated by the suite's
        own kill-switch flag). An unset flag yields a *skipped* verdict so the
        suite stays dark-by-default and never blocks CI by accident; only a real
        ``failed``/``error`` verdict folds into the blocking reasons. Never
        raises — a bad handler degrades to an error verdict.
        """
        probes = probe_loader(require_probe_flag)
        if probes is None:
            from src.agents.genaiops_agent import GenAIOpsVerdict

            return GenAIOpsVerdict.skipped(
                f"{record_kind} probes unavailable (flag unset)"
            )
        return self.genaiops.evaluate(
            handler,
            probes=probes,
            suite_id=suite_id,
            require_flag=False,
            require_probe_flag=False,
        )

    @staticmethod
    def _load_safeguarding_probes(require_flag: bool) -> Optional[List[Any]]:
        try:
            from src.learning.eval import (
                SafeguardingProbesUnavailableError,
                safeguarding_default_probes,
            )
        except Exception:  # pragma: no cover - defensive import guard
            return None
        try:
            return list(safeguarding_default_probes(require_flag=require_flag))
        except SafeguardingProbesUnavailableError:
            return None

    @staticmethod
    def _load_critic_probes(require_flag: bool) -> Optional[List[Any]]:
        try:
            from src.learning.eval import (
                CriticProbesUnavailableError,
                critic_default_probes,
            )
        except Exception:  # pragma: no cover - defensive import guard
            return None
        try:
            return list(critic_default_probes(require_flag=require_flag))
        except CriticProbesUnavailableError:
            return None


__all__ = [
    "ObservabilityGate",
    "ObservabilityReport",
    "STATUS_OK",
    "STATUS_DEGRADED",
    "STATUS_BLOCKED",
    "STATUS_DISABLED",
    "STATUS_ERROR",
]
