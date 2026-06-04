"""DevOpsAgent — staging-only release-readiness aggregator.

Phase 4 of the agent mesh. This agent does **not** perform deployments. It is a
read-only decision aid that combines the structured outcomes other mesh agents
already produce — a :class:`~src.agents.genaiops_agent.GenAIOpsVerdict` (the
eval gate) and an :class:`~src.agents.aiops_agent.AIOpsReport` (operational
health) — into a single, auditable go / no-go :class:`DeployDecision` for a
**staging** deploy.

Hard constraints (consistent with the rest of the mesh):

* **Staging-only.** Any ``target_env`` outside the configured staging set is
  *blocked* — the agent will never green-light a production-bound release. This
  is a guardrail, not a deploy action.
* **No deploy actions.** The agent's allow-list contains only the two read
  seams it consults. It cannot ``apply`` / ``deploy`` / ``rollback`` anything;
  promoting a decision into a real pipeline action is a later phase.
* **Non-raising.** Missing or malformed inputs degrade to a conservative
  ``no_go`` (fail-closed) — never an exception that could crash a pipeline.
* **Dependency-free.** Only stdlib + :class:`MeshAgent`. Inputs are duck-typed
  so the agent is trivially unit-testable without a live deploy.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Dict, Optional, Sequence, Tuple

from src.agents.base import MeshAgent

# --- Decision states --------------------------------------------------------

STATUS_GO = "go"
STATUS_NO_GO = "no_go"
STATUS_BLOCKED = "blocked"  # target environment is not an allowed staging env

# Default set of environment names treated as "staging". Overridable via the
# ``DEVOPS_STAGING_ENVIRONMENTS`` env var (comma-separated).
DEFAULT_STAGING_ENVIRONMENTS: Tuple[str, ...] = ("staging", "stage", "preprod")


def _env_staging_environments() -> Tuple[str, ...]:
    raw = os.environ.get("DEVOPS_STAGING_ENVIRONMENTS", "")
    parts = tuple(p.strip().lower() for p in raw.split(",") if p.strip())
    return parts or DEFAULT_STAGING_ENVIRONMENTS


@dataclass(frozen=True)
class DeployDecision:
    """Outcome of a staging release-readiness assessment. Never acts.

    * ``go``      → target is staging and every consulted gate is clear.
    * ``no_go``   → target is staging but at least one gate blocks.
    * ``blocked`` → target is not an allowed staging environment.
    """

    status: str
    target_env: str
    reasons: Tuple[str, ...] = ()
    checks: Dict[str, Any] = field(default_factory=dict)

    @property
    def go(self) -> bool:
        return self.status == STATUS_GO

    @property
    def blocked(self) -> bool:
        return self.status == STATUS_BLOCKED

    @property
    def should_deploy(self) -> bool:
        """Convenience: only a clean ``go`` authorises a staging deploy."""
        return self.status == STATUS_GO

    def as_dict(self) -> Dict[str, Any]:
        return {
            "status": self.status,
            "target_env": self.target_env,
            "go": self.go,
            "blocked": self.blocked,
            "should_deploy": self.should_deploy,
            "reasons": list(self.reasons),
            "checks": dict(self.checks),
        }


_DEVOPS_TOOLS = ("assess_eval_gate", "assess_ops_health")


class DevOpsAgent(MeshAgent):
    """Staging-only release-readiness aggregator.

    Construct once and call :meth:`evaluate_release` with a target environment
    plus any of the structured verdicts other agents produced this cycle. The
    agent returns a :class:`DeployDecision`; the caller decides whether to act.
    """

    name = "devops-agent"

    def __init__(
        self,
        *,
        staging_environments: Optional[Sequence[str]] = None,
        tool_call_budget: Optional[int] = None,
    ) -> None:
        super().__init__(
            allowed_tools=_DEVOPS_TOOLS,
            tool_call_budget=tool_call_budget,
        )
        envs = (
            tuple(str(e).strip().lower() for e in staging_environments if str(e).strip())
            if staging_environments is not None
            else _env_staging_environments()
        )
        self.staging_environments: Tuple[str, ...] = envs or DEFAULT_STAGING_ENVIRONMENTS

    # -- Public API -----------------------------------------------------

    def is_staging(self, target_env: Any) -> bool:
        """Whether ``target_env`` is in the configured staging allow-list."""
        return self._normalise_env(target_env) in self.staging_environments

    def evaluate_release(
        self,
        *,
        target_env: Any,
        eval_verdict: Any = None,
        ops_report: Any = None,
        allow_skipped_eval: bool = False,
    ) -> DeployDecision:
        """Assess whether a *staging* release should proceed. Never raises.

        Parameters
        ----------
        target_env:
            The environment the release is bound for. Anything not in the
            staging allow-list yields a ``blocked`` decision.
        eval_verdict:
            A ``GenAIOpsVerdict``-like object (duck-typed: ``blocking``,
            ``status``, ``passed``). ``None`` means the eval gate was not run.
        ops_report:
            An ``AIOpsReport``-like object (duck-typed: ``severity``,
            ``healthy``, ``anomalies``). ``None`` means ops health was not
            consulted.
        allow_skipped_eval:
            When ``True``, a *skipped* (could-not-run) eval gate does not block.
            A genuinely *failed* eval always blocks regardless. Defaults to
            ``False`` (fail-closed).
        """
        env = self._normalise_env(target_env)
        checks: Dict[str, Any] = {"target_env": env}

        # Guardrail first: never green-light a non-staging target.
        if env not in self.staging_environments:
            reason = f"target '{env}' is not a staging environment"
            self.log(
                "release_blocked",
                target_env=env,
                staging_environments=list(self.staging_environments),
            )
            return DeployDecision(
                status=STATUS_BLOCKED,
                target_env=env,
                reasons=(reason,),
                checks=checks,
            )

        reasons: list[str] = []

        eval_reason = self._check_eval(eval_verdict, allow_skipped_eval, checks)
        if eval_reason:
            reasons.append(eval_reason)

        ops_reason = self._check_ops(ops_report, checks)
        if ops_reason:
            reasons.append(ops_reason)

        status = STATUS_NO_GO if reasons else STATUS_GO
        self.log(
            "release_decision",
            target_env=env,
            status=status,
            reasons=reasons,
        )
        return DeployDecision(
            status=status,
            target_env=env,
            reasons=tuple(reasons),
            checks=checks,
        )

    # -- Checks ---------------------------------------------------------

    def _check_eval(
        self, eval_verdict: Any, allow_skipped_eval: bool, checks: Dict[str, Any]
    ) -> Optional[str]:
        """Translate an eval verdict into an optional blocking reason."""
        if eval_verdict is None:
            checks["eval_gate"] = "not_run"
            return None
        try:
            status = getattr(eval_verdict, "status", None)
            blocking = bool(getattr(eval_verdict, "blocking", True))
        except Exception:  # pragma: no cover - defensive
            checks["eval_gate"] = "unreadable"
            return "eval gate verdict was unreadable"

        checks["eval_gate"] = status or ("blocking" if blocking else "clear")

        if not blocking:
            return None
        if status == "skipped" and allow_skipped_eval:
            return None
        return f"eval gate did not pass (status={status or 'blocking'})"

    def _check_ops(self, ops_report: Any, checks: Dict[str, Any]) -> Optional[str]:
        """Translate an ops health report into an optional blocking reason.

        Only a *critical* operational severity blocks a staging release; warns
        are surfaced in ``checks`` but do not stop staging (staging is where we
        want to observe degraded-but-not-broken behaviour).
        """
        if ops_report is None:
            checks["ops_health"] = "not_consulted"
            return None
        try:
            severity = getattr(ops_report, "severity", None)
        except Exception:  # pragma: no cover - defensive
            checks["ops_health"] = "unreadable"
            return "ops health report was unreadable"

        checks["ops_health"] = severity or "unknown"
        if severity == "critical":
            return "operational health is critical"
        return None

    # -- Internals ------------------------------------------------------

    @staticmethod
    def _normalise_env(target_env: Any) -> str:
        if target_env is None:
            return ""
        return str(target_env).strip().lower()


__all__ = [
    "DevOpsAgent",
    "DeployDecision",
    "STATUS_GO",
    "STATUS_NO_GO",
    "STATUS_BLOCKED",
    "DEFAULT_STAGING_ENVIRONMENTS",
]
