"""PlannerAgent — a 1:1 mesh shim over an existing ``InsightsPlanner``.

The therapist Insights planner (``CopilotInsightsPlanner`` in production,
``StubInsightsPlanner`` in tests) already is a tool-using agent. This shim
wraps any object satisfying the
:class:`~src.services.insights_service.InsightsPlanner` protocol and:

* delegates ``run_turn`` / ``run_turn_stream`` byte-for-byte to the wrapped
  planner (same args, same return value, same exceptions), and
* emits structured ``[agent-mesh]`` start/finish/error log lines.

It adds **no** planning logic. Because it itself satisfies the
``InsightsPlanner`` protocol, it can be passed straight into
``InsightsService(planner=PlannerAgent(...))`` as a drop-in, and the service
behaves identically whether or not the shim is present.
"""

from __future__ import annotations

import time
from typing import Any, Iterator, Mapping, Optional, Sequence, Tuple

from src.agents.base import MeshAgent
from src.services.insights_service import (
    InsightsPlanner,
    InsightsPlannerResult,
    InsightsRequestContext,
    InsightsTool,
)


class PlannerAgent(MeshAgent):
    """Mesh wrapper around an :class:`InsightsPlanner`.

    Delegation is total: every call is forwarded unchanged to ``planner``.
    The only observable difference from calling the wrapped planner directly
    is the additional ``[agent-mesh]`` log lines.
    """

    name = "planner-agent"

    def __init__(
        self,
        planner: InsightsPlanner,
        *,
        name: Optional[str] = None,
        tool_call_budget: Optional[int] = None,
    ) -> None:
        super().__init__(name=name, tool_call_budget=tool_call_budget)
        self.planner = planner

    def run_turn(
        self,
        *,
        system_prompt: str,
        history: Sequence[dict[str, Any]],
        user_message: str,
        tools: Mapping[str, InsightsTool],
        context: InsightsRequestContext,
        tool_call_budget: int,
    ) -> InsightsPlannerResult:
        self.log(
            "run_turn_start",
            request_id=getattr(context, "request_id", None),
            tool_count=len(tools),
            tool_call_budget=tool_call_budget,
        )
        start = time.monotonic()
        try:
            result = self.planner.run_turn(
                system_prompt=system_prompt,
                history=history,
                user_message=user_message,
                tools=tools,
                context=context,
                tool_call_budget=tool_call_budget,
            )
        except Exception as exc:  # noqa: BLE001 - re-raised unchanged
            self.log(
                "run_turn_error",
                request_id=getattr(context, "request_id", None),
                duration_ms=int((time.monotonic() - start) * 1000),
                error_type=type(exc).__name__,
            )
            raise
        self.log(
            "run_turn_end",
            request_id=getattr(context, "request_id", None),
            duration_ms=int((time.monotonic() - start) * 1000),
            tool_calls_count=getattr(result, "tool_calls_count", None),
            had_error=bool(getattr(result, "error_text", None)),
        )
        return result

    def run_turn_stream(
        self,
        *,
        system_prompt: str,
        history: Sequence[dict[str, Any]],
        user_message: str,
        tools: Mapping[str, InsightsTool],
        context: InsightsRequestContext,
        tool_call_budget: int,
    ) -> Iterator[Tuple[str, Any]]:
        self.log(
            "run_turn_stream_start",
            request_id=getattr(context, "request_id", None),
            tool_count=len(tools),
            tool_call_budget=tool_call_budget,
        )
        start = time.monotonic()
        try:
            yield from self.planner.run_turn_stream(
                system_prompt=system_prompt,
                history=history,
                user_message=user_message,
                tools=tools,
                context=context,
                tool_call_budget=tool_call_budget,
            )
        except Exception as exc:  # noqa: BLE001 - re-raised unchanged
            self.log(
                "run_turn_stream_error",
                request_id=getattr(context, "request_id", None),
                duration_ms=int((time.monotonic() - start) * 1000),
                error_type=type(exc).__name__,
            )
            raise
        self.log(
            "run_turn_stream_end",
            request_id=getattr(context, "request_id", None),
            duration_ms=int((time.monotonic() - start) * 1000),
        )


# Static protocol conformance check (no-op at runtime). If ``PlannerAgent``
# ever drifts from the ``InsightsPlanner`` protocol this annotation makes the
# type checker complain at the source.
_PROTOCOL_CHECK: type[InsightsPlanner] = PlannerAgent
