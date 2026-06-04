"""Phase 1 tests: PlannerAgent is a byte-for-byte shim over an InsightsPlanner.

These assert the mesh wrapper changes *nothing* about planner behaviour:
same args forwarded, same return value, same exceptions, and streaming
yields passed through unchanged.
"""

from __future__ import annotations

from typing import Any, Dict, Iterator, List, Mapping, Sequence, Tuple

import pytest

from src.agents.planner_agent import PlannerAgent
from src.services.insights_service import (
    InsightsPlannerResult,
    InsightsRequestContext,
    InsightsTool,
)


class _RecordingPlanner:
    """Captures the kwargs it was called with and returns a fixed result."""

    def __init__(self, result: InsightsPlannerResult) -> None:
        self.result = result
        self.run_turn_calls: List[Dict[str, Any]] = []
        self.stream_calls: List[Dict[str, Any]] = []

    def run_turn(
        self,
        *,
        system_prompt: str,
        history: Sequence[Dict[str, Any]],
        user_message: str,
        tools: Mapping[str, InsightsTool],
        context: InsightsRequestContext,
        tool_call_budget: int,
    ) -> InsightsPlannerResult:
        self.run_turn_calls.append(
            {
                "system_prompt": system_prompt,
                "history": history,
                "user_message": user_message,
                "tools": tools,
                "context": context,
                "tool_call_budget": tool_call_budget,
            }
        )
        return self.result

    def run_turn_stream(
        self,
        *,
        system_prompt: str,
        history: Sequence[Dict[str, Any]],
        user_message: str,
        tools: Mapping[str, InsightsTool],
        context: InsightsRequestContext,
        tool_call_budget: int,
    ) -> Iterator[Tuple[str, Any]]:
        self.stream_calls.append({"user_message": user_message})
        yield ("delta", "hel")
        yield ("delta", "lo")
        yield ("final", self.result)


def _ctx() -> InsightsRequestContext:
    return InsightsRequestContext(
        user_id="therapist-1",
        scope={"type": "child", "child_id": "child-1"},
        storage_service=object(),
        request_id="req-123",
    )


def test_run_turn_delegates_and_returns_same_object() -> None:
    result = InsightsPlannerResult(answer_text="hi", tool_calls_count=2)
    planner = _RecordingPlanner(result)
    agent = PlannerAgent(planner)
    ctx = _ctx()

    out = agent.run_turn(
        system_prompt="sys",
        history=[{"role": "user", "content": "earlier"}],
        user_message="hello",
        tools={},
        context=ctx,
        tool_call_budget=4,
    )

    assert out is result
    assert len(planner.run_turn_calls) == 1
    call = planner.run_turn_calls[0]
    assert call["system_prompt"] == "sys"
    assert call["user_message"] == "hello"
    assert call["tool_call_budget"] == 4
    assert call["context"] is ctx


def test_run_turn_reraises_wrapped_exception() -> None:
    class _Boom(RuntimeError):
        pass

    class _FailingPlanner(_RecordingPlanner):
        def run_turn(self, **kwargs: Any) -> InsightsPlannerResult:  # type: ignore[override]
            raise _Boom("planner failed")

    agent = PlannerAgent(_FailingPlanner(InsightsPlannerResult(answer_text="x")))

    with pytest.raises(_Boom, match="planner failed"):
        agent.run_turn(
            system_prompt="sys",
            history=[],
            user_message="hello",
            tools={},
            context=_ctx(),
            tool_call_budget=4,
        )


def test_run_turn_stream_passes_through_chunks() -> None:
    result = InsightsPlannerResult(answer_text="hello")
    planner = _RecordingPlanner(result)
    agent = PlannerAgent(planner)

    chunks = list(
        agent.run_turn_stream(
            system_prompt="sys",
            history=[],
            user_message="hello",
            tools={},
            context=_ctx(),
            tool_call_budget=4,
        )
    )

    assert chunks == [("delta", "hel"), ("delta", "lo"), ("final", result)]
    assert planner.stream_calls == [{"user_message": "hello"}]


def test_planner_agent_satisfies_insights_planner_protocol() -> None:
    # Duck-typed: the service only needs run_turn / run_turn_stream.
    agent = PlannerAgent(_RecordingPlanner(InsightsPlannerResult(answer_text="x")))
    assert hasattr(agent, "run_turn")
    assert hasattr(agent, "run_turn_stream")
    assert agent.name == "planner-agent"
