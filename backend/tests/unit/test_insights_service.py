"""Unit tests for Phase 4 InsightsService."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Mapping, Sequence

import pytest

from src.services.insights_service import (
    InsightsAuthorizationError,
    InsightsPlannerResult,
    InsightsRequestContext,
    InsightsService,
    InsightsTool,
    StubInsightsPlanner,
)
from src.services.storage import StorageService


def _bootstrap(tmp_path: Path) -> tuple[StorageService, str, str]:
    service = StorageService(str(tmp_path / "insights-service.db"))
    service.get_or_create_user("therapist-1", "t@example.com", "Therapist", "aad")
    child = service.create_child(
        name="Kid A",
        created_by_user_id="therapist-1",
        relationship="therapist",
    )
    return service, "therapist-1", child["id"]


class StaticPlanner:
    """Returns a canned result and records what it received."""

    def __init__(self, result: InsightsPlannerResult) -> None:
        self.result = result
        self.calls: List[Dict[str, Any]] = []

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
        self.calls.append(
            {
                "system_prompt": system_prompt,
                "history_len": len(list(history)),
                "user_message": user_message,
                "tool_names": sorted(tools.keys()),
                "scope": dict(context.scope),
            }
        )
        return self.result


class TestInsightsServiceAsk:
    def test_ask_creates_conversation_and_persists_answer(self, tmp_path: Path) -> None:
        storage, user_id, child_id = _bootstrap(tmp_path)
        planner = StaticPlanner(
            InsightsPlannerResult(
                answer_text="All good.",
                citations=[
                    {"kind": "child", "child_id": child_id, "label": "Kid A"}
                ],
                visualizations=[
                    {
                        "kind": "table",
                        "title": "Recent sessions",
                        "columns": [{"key": "id", "label": "ID"}],
                        "rows": [{"id": "sess-1"}],
                    }
                ],
                tool_trace=[
                    {
                        "name": "list_sessions",
                        "arguments": {"child_id": child_id},
                        "duration_ms": 4,
                        "result_summary": "0 sessions",
                    }
                ],
                tool_calls_count=1,
            )
        )

        svc = InsightsService(storage, planner=planner)
        result = svc.ask(
            user_id=user_id,
            message="Summarise recent sessions",
            scope={"type": "child", "child_id": child_id},
        )

        assert result["assistant_message"]["content_text"] == "All good."
        assert result["tool_calls_count"] == 1
        assert result["assistant_message"]["citations"][0]["child_id"] == child_id
        assert result["assistant_message"]["visualizations"][0]["kind"] == "table"

        # Round-trip through storage.
        conv_id = result["conversation"]["id"]
        fetched = svc.get_conversation(user_id=user_id, conversation_id=conv_id)
        assert fetched is not None
        assert [m["role"] for m in fetched["messages"]] == ["user", "assistant"]

        # Planner was invoked with the expected surface.
        assert planner.calls[0]["user_message"] == "Summarise recent sessions"
        assert planner.calls[0]["scope"]["child_id"] == child_id
        assert "get_child_planning_snapshot" in planner.calls[0]["tool_names"]
        assert "get_child_overview" in planner.calls[0]["tool_names"]

    def test_ask_continues_existing_conversation(self, tmp_path: Path) -> None:
        storage, user_id, child_id = _bootstrap(tmp_path)
        planner = StaticPlanner(InsightsPlannerResult(answer_text="one"))
        svc = InsightsService(storage, planner=planner)

        first = svc.ask(
            user_id=user_id,
            message="First?",
            scope={"type": "child", "child_id": child_id},
        )
        conv_id = first["conversation"]["id"]

        planner.result = InsightsPlannerResult(answer_text="two")
        svc.ask(
            user_id=user_id,
            message="Follow up?",
            scope={"type": "child", "child_id": child_id},
            conversation_id=conv_id,
        )

        messages = storage.list_insight_messages(conv_id)
        assert [m["role"] for m in messages] == ["user", "assistant", "user", "assistant"]
        # Planner was given the prior history on the 2nd turn.
        assert planner.calls[1]["history_len"] == 2

    def test_ask_rejects_child_scope_without_access(self, tmp_path: Path) -> None:
        storage, _user, child_id = _bootstrap(tmp_path)
        # Intruder is a bootstrapped therapist with no link to this child.
        storage.get_or_create_user("intruder", "i@example.com", "Intruder", "aad")
        svc = InsightsService(storage, planner=StaticPlanner(InsightsPlannerResult("x")))

        with pytest.raises(InsightsAuthorizationError):
            svc.ask(
                user_id="intruder",
                message="Tell me everything",
                scope={"type": "child", "child_id": child_id},
            )

    def test_ask_rejects_empty_message(self, tmp_path: Path) -> None:
        storage, user_id, _child_id = _bootstrap(tmp_path)
        svc = InsightsService(storage, planner=StaticPlanner(InsightsPlannerResult("x")))
        with pytest.raises(ValueError):
            svc.ask(user_id=user_id, message="   ", scope={"type": "caseload"})

    def test_ask_rejects_unsupported_scope(self, tmp_path: Path) -> None:
        storage, user_id, _child_id = _bootstrap(tmp_path)
        svc = InsightsService(storage, planner=StaticPlanner(InsightsPlannerResult("x")))
        with pytest.raises(ValueError):
            svc.ask(user_id=user_id, message="hi", scope={"type": "nonsense"})

    def test_ask_drops_invalid_visualizations(self, tmp_path: Path) -> None:
        storage, user_id, child_id = _bootstrap(tmp_path)
        planner = StaticPlanner(
            InsightsPlannerResult(
                answer_text="ok",
                visualizations=[
                    {"kind": "banana"},  # invalid -> dropped
                    {
                        "kind": "table",
                        "title": "t",
                        "columns": [{"key": "k", "label": "L"}],
                        "rows": [{"k": 1}],
                    },
                ],
            )
        )
        svc = InsightsService(storage, planner=planner)
        result = svc.ask(
            user_id=user_id,
            message="Anything",
            scope={"type": "child", "child_id": child_id},
        )
        viz = result["assistant_message"]["visualizations"]
        assert len(viz) == 1
        assert viz[0]["kind"] == "table"


class TestInsightsTools:
    def test_get_child_overview_requires_access(self, tmp_path: Path) -> None:
        storage, _user, child_id = _bootstrap(tmp_path)
        storage.get_or_create_user("intruder", "i@example.com", "Intruder", "aad")
        svc = InsightsService(storage, planner=StaticPlanner(InsightsPlannerResult("x")))
        tool = svc.tools["get_child_overview"]
        ctx = InsightsRequestContext(
            user_id="intruder",
            scope={"type": "caseload"},
            storage_service=storage,
        )
        with pytest.raises(InsightsAuthorizationError):
            tool.handler({"child_id": child_id}, ctx)

    def test_get_child_overview_happy_path(self, tmp_path: Path) -> None:
        storage, user_id, child_id = _bootstrap(tmp_path)
        svc = InsightsService(storage, planner=StaticPlanner(InsightsPlannerResult("x")))
        tool = svc.tools["get_child_overview"]
        ctx = InsightsRequestContext(
            user_id=user_id,
            scope={"type": "child", "child_id": child_id},
            storage_service=storage,
        )
        result = tool.handler({"child_id": child_id}, ctx)
        assert result["id"] == child_id
        assert result["name"] == "Kid A"
        assert result["recent_session_count"] == 0

    def test_get_child_planning_snapshot_happy_path(self, tmp_path: Path) -> None:
        storage, user_id, child_id = _bootstrap(tmp_path)
        svc = InsightsService(storage, planner=StaticPlanner(InsightsPlannerResult("x")))
        tool = svc.tools["get_child_planning_snapshot"]
        ctx = InsightsRequestContext(
            user_id=user_id,
            scope={"type": "child", "child_id": child_id},
            storage_service=storage,
        )

        result = tool.handler({"child_id": child_id}, ctx)

        assert result["child"]["id"] == child_id
        assert result["child"]["name"] == "Kid A"
        assert result["session_summary"]["recent_session_count"] == 0
        assert result["recent_sessions"] == []
        assert result["progress_reports"] == []
        assert result["approved_memory_items"] == []


class TestStubPlanner:
    def test_stub_calls_get_child_overview_on_child_scope(self, tmp_path: Path) -> None:
        storage, user_id, child_id = _bootstrap(tmp_path)
        svc = InsightsService(storage)  # default planner = StubInsightsPlanner
        assert isinstance(svc.planner, StubInsightsPlanner)
        result = svc.ask(
            user_id=user_id,
            message="What's up with Kid A?",
            scope={"type": "child", "child_id": child_id},
        )
        trace = result["assistant_message"]["tool_trace"]
        assert any(entry["name"] == "get_child_overview" for entry in trace)
        assert result["assistant_message"]["citations"][0]["child_id"] == child_id
