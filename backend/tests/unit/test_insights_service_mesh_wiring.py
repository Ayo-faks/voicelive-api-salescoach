"""Phase 2 tests: InsightsService planner wiring behind AGENT_MESH_ENABLED.

Flag off (default) → planner is byte-identical to the one passed in.
Flag on → planner is transparently wrapped in PlannerAgent (1:1 delegation).
"""

from __future__ import annotations

from typing import Any, Dict, Sequence

import pytest

from src.agents.planner_agent import PlannerAgent
from src.services.insights_service import (
    InsightsPlannerResult,
    InsightsService,
)


class _DummyPlanner:
    def run_turn(self, **kwargs: Any) -> InsightsPlannerResult:
        return InsightsPlannerResult(answer_text="ok")

    def run_turn_stream(self, **kwargs: Any):  # pragma: no cover - not exercised here
        yield ("final", InsightsPlannerResult(answer_text="ok"))


def test_flag_off_planner_is_unwrapped(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AGENT_MESH_ENABLED", raising=False)
    planner = _DummyPlanner()
    service = InsightsService(storage_service=object(), planner=planner)
    assert service.planner is planner
    assert not isinstance(service.planner, PlannerAgent)


def test_flag_on_planner_is_wrapped(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGENT_MESH_ENABLED", "true")
    planner = _DummyPlanner()
    service = InsightsService(storage_service=object(), planner=planner)
    assert isinstance(service.planner, PlannerAgent)
    # The wrapper still delegates to the original planner.
    assert service.planner.planner is planner


def test_flag_on_wrapped_planner_delegates(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGENT_MESH_ENABLED", "1")
    planner = _DummyPlanner()
    service = InsightsService(storage_service=object(), planner=planner)
    result = service.planner.run_turn(
        system_prompt="s",
        history=[],
        user_message="hi",
        tools={},
        context=None,
        tool_call_budget=4,
    )
    assert result.answer_text == "ok"
