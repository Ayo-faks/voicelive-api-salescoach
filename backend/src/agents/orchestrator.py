"""MeshOrchestrator — composes SafeguardingAgent gate + PlannerAgent turn.

Phase 4 of the agent mesh. The orchestrator is the first agent that
*coordinates* others rather than wrapping a single service. It runs a
sequence of safeguarding pre-flight checks and only delegates the actual
planner turn when **every** check allows.

Design rules (consistent with the rest of the mesh):

* **Safeguarding is a hard gate.** If any pre-flight action is vetoed, the
  planner is never called and a ``blocked`` :class:`OrchestratedTurn` carrying
  the veto verdict is returned. Fail-closed.
* **Planner errors propagate unchanged.** The orchestrator only owns the
  safeguarding gate; once a turn is authorised the wrapped planner behaves
  exactly as it does today (``PlannerAgent`` already re-raises 1:1). This
  keeps the existing InsightsService error contract intact.
* **Non-raising gate.** The safeguarding stage never raises — a veto is a
  return value, not an exception.
* **Dark by default.** Construction is opt-in; nothing wires this into a
  request path unless ``AGENT_MESH_ENABLED`` is set and a caller chooses to.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Optional, Sequence

from src.agents.base import MeshAgent
from src.agents.safeguarding_agent import SafeguardingAgent, SafeguardingVerdict

STATUS_ALLOWED = "allowed"
STATUS_BLOCKED = "blocked"


@dataclass(frozen=True)
class OrchestratedTurn:
    """Outcome of an orchestrated planner turn.

    * ``allowed`` → every safeguarding check passed; ``result`` holds the
      planner's return value.
    * ``blocked`` → a safeguarding check vetoed; ``verdict`` holds the failing
      verdict and ``result`` is ``None`` (the planner was never invoked).
    """

    status: str
    verdict: Optional[SafeguardingVerdict] = None
    result: Any = None
    checks_run: int = 0
    duration_ms: int = 0

    @property
    def allowed(self) -> bool:
        return self.status == STATUS_ALLOWED

    @property
    def blocked(self) -> bool:
        return self.status == STATUS_BLOCKED

    def as_dict(self) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "status": self.status,
            "allowed": self.allowed,
            "blocked": self.blocked,
            "checks_run": self.checks_run,
            "duration_ms": self.duration_ms,
        }
        if self.verdict is not None:
            payload["verdict"] = {
                "allowed": self.verdict.allowed,
                "reason": self.verdict.reason,
                "detail": self.verdict.detail,
            }
        return payload


_ORCHESTRATOR_TOOLS = ("safeguarding_assess", "planner_run_turn")


class MeshOrchestrator(MeshAgent):
    """Runs safeguarding pre-flight, then delegates an authorised turn."""

    name = "mesh-orchestrator"

    def __init__(
        self,
        *,
        planner: Any,
        safeguarding: SafeguardingAgent,
        tool_call_budget: Optional[int] = None,
    ) -> None:
        super().__init__(
            allowed_tools=_ORCHESTRATOR_TOOLS,
            tool_call_budget=tool_call_budget,
        )
        self.planner = planner
        self.safeguarding = safeguarding

    def preflight(
        self,
        actions: Sequence[Mapping[str, Any]],
    ) -> Optional[SafeguardingVerdict]:
        """Run safeguarding checks; return the first veto, or ``None``.

        Never raises. A returned verdict means the turn must be blocked.
        """

        self.ensure_tool_allowed("safeguarding_assess")
        for action in actions or ():
            verdict = self.safeguarding.assess(action)
            if verdict.vetoed:
                self.log(
                    "preflight_veto",
                    kind=action.get("kind"),
                    reason=verdict.reason,
                )
                return verdict
        return None

    def run_turn(
        self,
        *,
        preflight_actions: Sequence[Mapping[str, Any]] = (),
        system_prompt: str,
        history: Sequence[dict[str, Any]],
        user_message: str,
        tools: Mapping[str, Any],
        context: Any,
        tool_call_budget: int,
    ) -> OrchestratedTurn:
        """Gate then delegate a planner turn.

        If any ``preflight_actions`` veto, returns a ``blocked``
        :class:`OrchestratedTurn` without touching the planner. Otherwise
        delegates to the wrapped planner and returns its result. Planner
        exceptions propagate unchanged.
        """

        actions = list(preflight_actions or ())
        start = time.monotonic()
        self.log(
            "turn_start",
            request_id=getattr(context, "request_id", None),
            preflight_count=len(actions),
        )

        veto = self.preflight(actions)
        if veto is not None:
            duration = int((time.monotonic() - start) * 1000)
            self.log(
                "turn_blocked",
                request_id=getattr(context, "request_id", None),
                reason=veto.reason,
                duration_ms=duration,
            )
            return OrchestratedTurn(
                status=STATUS_BLOCKED,
                verdict=veto,
                checks_run=len(actions),
                duration_ms=duration,
            )

        self.ensure_tool_allowed("planner_run_turn")
        result = self.planner.run_turn(
            system_prompt=system_prompt,
            history=history,
            user_message=user_message,
            tools=tools,
            context=context,
            tool_call_budget=tool_call_budget,
        )
        duration = int((time.monotonic() - start) * 1000)
        self.log(
            "turn_allowed",
            request_id=getattr(context, "request_id", None),
            checks_run=len(actions),
            duration_ms=duration,
        )
        return OrchestratedTurn(
            status=STATUS_ALLOWED,
            result=result,
            checks_run=len(actions),
            duration_ms=duration,
        )


__all__ = [
    "MeshOrchestrator",
    "OrchestratedTurn",
    "STATUS_ALLOWED",
    "STATUS_BLOCKED",
]
