"""Integration tests for the router wired into ``InsightsService.ask``."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Mapping, Sequence

import pytest

from src.services.insights_service import (
    InsightsPlannerResult,
    InsightsRequestContext,
    InsightsService,
    InsightsTool,
)
from src.services.storage import StorageService
from src.services.turn_router.rules import CHITCHAT_FALLBACK_REPLY
from src.services.turn_router.types import RouterConfig


def _bootstrap(tmp_path: Path) -> tuple[StorageService, str]:
    storage = StorageService(str(tmp_path / "router.db"))
    storage.get_or_create_user("therapist-1", "t@example.com", "Therapist", "aad")
    return storage, "therapist-1"


class _RecordingPlanner:
    def __init__(self) -> None:
        self.calls: List[str] = []

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
        self.calls.append(user_message)
        return InsightsPlannerResult(answer_text=f"planner:{user_message}")


class _StubChitchatHandler:
    name = "chitchat"

    def __init__(self, *, reply: str = "Hi there!", error_text: str | None = None) -> None:
        self.reply = reply
        self.error_text = error_text
        self.calls: List[str] = []

    def handle(
        self,
        *,
        user_message: str,
        history: Sequence[Mapping[str, Any]],
        context: InsightsRequestContext,
    ) -> InsightsPlannerResult:
        self.calls.append(user_message)
        return InsightsPlannerResult(answer_text=self.reply, error_text=self.error_text)


def test_router_disabled_runs_planner_unconditionally(tmp_path: Path) -> None:
    storage, user_id = _bootstrap(tmp_path)
    planner = _RecordingPlanner()
    chitchat = _StubChitchatHandler()
    svc = InsightsService(
        storage,
        planner=planner,
        chitchat_handler=chitchat,
        router_config=RouterConfig(enabled=False),
    )

    result = svc.ask(user_id=user_id, message="hi")

    assert planner.calls == ["hi"]
    assert chitchat.calls == []
    assert result["assistant_message"]["content_text"] == "planner:hi"
    assert result["route"] == "insights"


def test_router_enabled_routes_chitchat_message(tmp_path: Path) -> None:
    storage, user_id = _bootstrap(tmp_path)
    planner = _RecordingPlanner()
    chitchat = _StubChitchatHandler(reply="Hi there!")
    svc = InsightsService(
        storage,
        planner=planner,
        chitchat_handler=chitchat,
        router_config=RouterConfig(enabled=True),
    )

    result = svc.ask(user_id=user_id, message="hi")

    assert chitchat.calls == ["hi"]
    assert planner.calls == []
    assert result["assistant_message"]["content_text"] == "Hi there!"
    assert result["route"] == "chitchat"


def test_router_enabled_routes_data_question_to_planner(tmp_path: Path) -> None:
    storage, user_id = _bootstrap(tmp_path)
    planner = _RecordingPlanner()
    chitchat = _StubChitchatHandler()
    svc = InsightsService(
        storage,
        planner=planner,
        chitchat_handler=chitchat,
        router_config=RouterConfig(enabled=True),
    )

    result = svc.ask(user_id=user_id, message="how did ada do today")

    assert planner.calls == ["how did ada do today"]
    assert chitchat.calls == []
    assert result["route"] == "insights"


def test_router_falls_back_to_planner_when_chitchat_dirty(tmp_path: Path) -> None:
    storage, user_id = _bootstrap(tmp_path)
    planner = _RecordingPlanner()
    chitchat = _StubChitchatHandler(
        reply=CHITCHAT_FALLBACK_REPLY, error_text="chitchat_output_dirty"
    )
    svc = InsightsService(
        storage,
        planner=planner,
        chitchat_handler=chitchat,
        router_config=RouterConfig(enabled=True),
    )

    result = svc.ask(user_id=user_id, message="hi")

    assert chitchat.calls == ["hi"]
    assert planner.calls == ["hi"]
    assert result["assistant_message"]["content_text"] == "planner:hi"
    assert result["route"] == "insights"


def test_router_shadow_mode_classifies_but_always_runs_planner(tmp_path: Path) -> None:
    storage, user_id = _bootstrap(tmp_path)
    planner = _RecordingPlanner()
    chitchat = _StubChitchatHandler()
    svc = InsightsService(
        storage,
        planner=planner,
        chitchat_handler=chitchat,
        router_config=RouterConfig(enabled=True, shadow=True),
    )

    result = svc.ask(user_id=user_id, message="hi")

    assert chitchat.calls == []
    assert planner.calls == ["hi"]
    # decision was still recorded as chitchat by the classifier
    assert result["route"] == "chitchat"


def test_router_enabled_without_chitchat_handler_falls_through_to_planner(
    tmp_path: Path,
) -> None:
    storage, user_id = _bootstrap(tmp_path)
    planner = _RecordingPlanner()
    svc = InsightsService(
        storage,
        planner=planner,
        chitchat_handler=None,
        router_config=RouterConfig(enabled=True),
    )

    result = svc.ask(user_id=user_id, message="hi")

    assert planner.calls == ["hi"]
    assert result["route"] == "insights"  # fallback when no chitchat handler wired
