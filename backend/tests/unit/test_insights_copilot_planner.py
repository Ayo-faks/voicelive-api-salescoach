"""Unit tests for the GitHub Copilot SDK Insights planner adapter."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import pytest

import src.services.insights_copilot_planner as planner_module
from src.services.insights_copilot_planner import (
    CopilotInsightsPlanner,
    build_insights_planner_from_env,
)
from src.services.insights_service import (
    InsightsAuthorizationError,
    InsightsRequestContext,
    InsightsTool,
)


# --- Fake Copilot SDK ------------------------------------------------------


@dataclass
class _FakeInvocation:
    arguments: Dict[str, Any]


class _FakeToolResult:
    def __init__(self, *, text_result_for_llm="", result_type="success", session_log=""):
        self.text_result_for_llm = text_result_for_llm
        self.result_type = result_type
        self.session_log = session_log


class _FakeTool:
    def __init__(self, *, name, description, parameters, skip_permission, handler):
        self.name = name
        self.description = description
        self.parameters = parameters
        self.skip_permission = skip_permission
        self.handler = handler


class _FakePermissionRequestResult:
    def __init__(self, *, kind):
        self.kind = kind


class _FakeSubprocessConfig:
    def __init__(self, cli_path=None, github_token=None):
        self.cli_path = cli_path
        self.github_token = github_token


class _FakeResponseData:
    def __init__(self, content: str):
        self.content = content


class _FakeResponse:
    def __init__(self, content: str):
        self.data = _FakeResponseData(content)


class _FakeSession:
    """Drives the tool handlers the adapter registers, then returns text."""

    def __init__(self, kwargs: Dict[str, Any], planned_tool_calls, response_text: str, planned_deltas=None):
        self.kwargs = kwargs
        self.planned_tool_calls = list(planned_tool_calls or [])
        self.planned_deltas = list(planned_deltas or [])
        self.response_text = response_text
        self.session_id = "sess-fake-1"
        self.tool_results: List[Any] = []
        self._handlers: List[Any] = []

    def on(self, handler):
        self._handlers.append(handler)

        def _unsubscribe():
            if handler in self._handlers:
                self._handlers.remove(handler)

        return _unsubscribe

    def _dispatch(self, data: Any) -> None:
        event = type("FakeEvent", (), {"data": data})()
        for handler in list(self._handlers):
            handler(event)

    async def send_and_wait(self, prompt: str) -> _FakeResponse:
        del prompt
        # Replay any streaming deltas first so handlers see them in order.
        if self.planned_deltas:
            try:
                from copilot.generated.session_events import AssistantMessageDeltaData
            except ImportError:  # pragma: no cover
                AssistantMessageDeltaData = None  # type: ignore[assignment]
            for chunk in self.planned_deltas:
                if AssistantMessageDeltaData is not None:
                    try:
                        data = AssistantMessageDeltaData(
                            delta_content=chunk,
                            message_id="m1",
                            parent_tool_call_id=None,
                        )
                    except TypeError:
                        data = type("Delta", (), {"delta_content": chunk})()
                else:
                    data = type("Delta", (), {"delta_content": chunk})()
                self._dispatch(data)
        tools_by_name = {t.name: t for t in self.kwargs.get("tools", [])}
        pre_hook = self.kwargs.get("hooks", {}).get("on_pre_tool_use")
        for name, args in self.planned_tool_calls:
            if pre_hook is not None:
                decision = await pre_hook({}, {"name": name})
                if decision.get("permissionDecision") != "allow":
                    continue
            tool = tools_by_name.get(name)
            if tool is None:
                continue
            result = tool.handler(_FakeInvocation(arguments=dict(args)))
            self.tool_results.append(result)
        return _FakeResponse(self.response_text)

    async def disconnect(self):
        return None


class _FakeClient:
    last_instance: Optional["_FakeClient"] = None

    def __init__(self, subprocess_config=None, *, planned_tool_calls=None, response_text="", planned_deltas=None):
        self.subprocess_config = subprocess_config
        self.planned_tool_calls = planned_tool_calls or []
        self.response_text = response_text
        self.planned_deltas = planned_deltas or []
        self.started = False
        self.stopped = False
        self.session: Optional[_FakeSession] = None
        _FakeClient.last_instance = self

    async def start(self):
        self.started = True

    async def stop(self):
        self.stopped = True

    async def create_session(self, **kwargs):
        self.session = _FakeSession(
            kwargs,
            self.planned_tool_calls,
            self.response_text,
            planned_deltas=self.planned_deltas,
        )
        return self.session


# --- Fixtures --------------------------------------------------------------


@pytest.fixture
def patch_sdk(monkeypatch):
    """Install fake SDK symbols and return a factory to configure the client."""

    client_config = {"planned_tool_calls": [], "response_text": "", "planned_deltas": []}

    def make_client(subprocess_config=None):
        return _FakeClient(
            subprocess_config,
            planned_tool_calls=client_config["planned_tool_calls"],
            response_text=client_config["response_text"],
            planned_deltas=client_config["planned_deltas"],
        )

    monkeypatch.setattr(planner_module, "CopilotClient", make_client)
    monkeypatch.setattr(planner_module, "SubprocessConfig", _FakeSubprocessConfig)
    monkeypatch.setattr(planner_module, "PermissionRequestResult", _FakePermissionRequestResult)
    monkeypatch.setattr(planner_module, "Tool", _FakeTool)
    monkeypatch.setattr(planner_module, "ToolResult", _FakeToolResult)
    return client_config


class _FakeStorage:
    def user_has_child_access(self, user_id, child_id, *, allowed_relationships=None):
        del user_id, allowed_relationships
        return child_id == "child-1"

    def get_child(self, child_id):
        if child_id == "child-1":
            return {"id": "child-1", "name": "Ayo"}
        return None


def _make_context(scope=None) -> InsightsRequestContext:
    return InsightsRequestContext(
        user_id="therapist-1",
        scope=scope or {"type": "child", "child_id": "child-1"},
        storage_service=_FakeStorage(),
    )


def _overview_tool() -> InsightsTool:
    def handler(args: Dict[str, Any], context: InsightsRequestContext) -> Dict[str, Any]:
        child_id = args.get("child_id")
        if child_id != "child-1":
            raise InsightsAuthorizationError("no access")
        child = context.storage_service.get_child(child_id)
        return {"id": child["id"], "name": child["name"]}

    return InsightsTool(
        name="get_child_overview",
        description="Overview",
        parameters={"type": "object", "properties": {"child_id": {"type": "string"}}, "required": ["child_id"]},
        handler=handler,
    )


def _bad_tool() -> InsightsTool:
    def handler(args, context):
        raise ValueError("bad_args")

    return InsightsTool(
        name="broken",
        description="always fails",
        parameters={"type": "object"},
        handler=handler,
    )


# --- Tests -----------------------------------------------------------------


def test_run_turn_requires_sdk(monkeypatch):
    monkeypatch.setattr(planner_module, "CopilotClient", None)
    monkeypatch.setattr(planner_module, "Tool", None)
    monkeypatch.setattr(planner_module, "ToolResult", None)
    monkeypatch.setattr(planner_module, "PermissionRequestResult", None)
    planner = CopilotInsightsPlanner(settings={})
    with pytest.raises(RuntimeError, match="GitHub Copilot SDK is not installed"):
        planner.run_turn(
            system_prompt="sys",
            history=[],
            user_message="hi",
            tools={},
            context=_make_context(),
            tool_call_budget=4,
        )


def test_run_turn_parses_json_answer(patch_sdk):
    patch_sdk["planned_tool_calls"] = [("get_child_overview", {"child_id": "child-1"})]
    patch_sdk["response_text"] = json.dumps(
        {
            "answer_text": "Ayo is making progress.",
            "citations": [{"kind": "child", "child_id": "child-1", "label": "Ayo"}],
            "visualizations": [],
        }
    )
    planner = CopilotInsightsPlanner(settings={})
    result = planner.run_turn(
        system_prompt="sys",
        history=[],
        user_message="How is Ayo doing?",
        tools={"get_child_overview": _overview_tool()},
        context=_make_context(),
        tool_call_budget=4,
    )
    assert result.answer_text == "Ayo is making progress."
    assert result.citations == [{"kind": "child", "child_id": "child-1", "label": "Ayo"}]
    assert result.tool_calls_count == 1
    assert result.tool_trace[0]["name"] == "get_child_overview"
    assert result.tool_trace[0]["arguments"] == {"child_id": "child-1"}
    assert "result_summary" in result.tool_trace[0]
    assert result.error_text is None


def test_run_turn_strips_markdown_fences(patch_sdk):
    patch_sdk["response_text"] = '```json\n{"answer_text": "Hi"}\n```'
    planner = CopilotInsightsPlanner(settings={})
    result = planner.run_turn(
        system_prompt="sys",
        history=[],
        user_message="hi",
        tools={},
        context=_make_context(),
        tool_call_budget=2,
    )
    assert result.answer_text == "Hi"


def test_run_turn_falls_back_to_plain_text(patch_sdk):
    patch_sdk["response_text"] = "Ayo improved."
    planner = CopilotInsightsPlanner(settings={})
    result = planner.run_turn(
        system_prompt="sys",
        history=[],
        user_message="hi",
        tools={},
        context=_make_context(),
        tool_call_budget=2,
    )
    assert result.answer_text == "Ayo improved."
    assert result.citations == []


def test_tool_call_budget_denies_after_limit(patch_sdk):
    patch_sdk["planned_tool_calls"] = [
        ("get_child_overview", {"child_id": "child-1"}),
        ("get_child_overview", {"child_id": "child-1"}),
        ("get_child_overview", {"child_id": "child-1"}),
    ]
    patch_sdk["response_text"] = json.dumps({"answer_text": "done"})
    planner = CopilotInsightsPlanner(settings={})
    result = planner.run_turn(
        system_prompt="sys",
        history=[],
        user_message="hi",
        tools={"get_child_overview": _overview_tool()},
        context=_make_context(),
        tool_call_budget=2,
    )
    assert result.tool_calls_count == 2
    assert len(result.tool_trace) == 2


def test_tool_authorization_error_traced(patch_sdk):
    patch_sdk["planned_tool_calls"] = [("get_child_overview", {"child_id": "child-OTHER"})]
    patch_sdk["response_text"] = json.dumps({"answer_text": "could not access"})
    planner = CopilotInsightsPlanner(settings={})
    result = planner.run_turn(
        system_prompt="sys",
        history=[],
        user_message="hi",
        tools={"get_child_overview": _overview_tool()},
        context=_make_context(scope={"type": "caseload"}),
        tool_call_budget=4,
    )
    assert result.tool_calls_count == 1
    assert result.tool_trace[0]["error"].startswith("forbidden")


def test_tool_value_error_traced(patch_sdk):
    patch_sdk["planned_tool_calls"] = [("broken", {})]
    patch_sdk["response_text"] = json.dumps({"answer_text": "oops"})
    planner = CopilotInsightsPlanner(settings={})
    result = planner.run_turn(
        system_prompt="sys",
        history=[],
        user_message="hi",
        tools={"broken": _bad_tool()},
        context=_make_context(),
        tool_call_budget=4,
    )
    assert result.tool_trace[0]["error"].startswith("invalid")


def test_sdk_failure_returns_graceful_error(patch_sdk, monkeypatch):
    def failing_client(*args, **kwargs):
        raise RuntimeError("sdk exploded")

    monkeypatch.setattr(planner_module, "CopilotClient", failing_client)
    planner = CopilotInsightsPlanner(settings={})
    result = planner.run_turn(
        system_prompt="sys",
        history=[],
        user_message="hi",
        tools={},
        context=_make_context(),
        tool_call_budget=2,
    )
    assert result.answer_text == "Something went wrong while answering."
    assert result.error_text and result.error_text.startswith("copilot_sdk_error:")


def test_build_insights_planner_from_env_returns_none_without_credentials(monkeypatch):
    monkeypatch.setattr(planner_module, "CopilotClient", _FakeClient)
    monkeypatch.setattr(planner_module, "Tool", _FakeTool)
    monkeypatch.setattr(planner_module, "ToolResult", _FakeToolResult)
    monkeypatch.setattr(
        planner_module,
        "build_copilot_azure_provider_config",
        lambda settings: None,
    )
    assert build_insights_planner_from_env({}) is None


def test_build_insights_planner_from_env_returns_planner_with_token(monkeypatch):
    monkeypatch.setattr(planner_module, "CopilotClient", _FakeClient)
    monkeypatch.setattr(planner_module, "Tool", _FakeTool)
    monkeypatch.setattr(planner_module, "ToolResult", _FakeToolResult)
    monkeypatch.setattr(
        planner_module,
        "build_copilot_azure_provider_config",
        lambda settings: None,
    )
    planner = build_insights_planner_from_env({"copilot_github_token": "ghp_xxx"})
    assert isinstance(planner, CopilotInsightsPlanner)


def test_build_insights_planner_from_env_returns_none_when_sdk_missing(monkeypatch):
    monkeypatch.setattr(planner_module, "CopilotClient", None)
    monkeypatch.setattr(planner_module, "Tool", None)
    monkeypatch.setattr(planner_module, "ToolResult", None)
    assert build_insights_planner_from_env({"copilot_github_token": "x"}) is None


# --- Streaming (run_turn_stream) tests ------------------------------------


def test_run_turn_stream_yields_deltas_then_final(patch_sdk):
    """Deltas arrive via assistant.message_delta events; the typed
    ``emit_artifacts`` tool delivers structured artifacts. The final
    InsightsPlannerResult must use the concatenated deltas as the
    answer text and the tool args as citations / visualizations / etc.
    """
    patch_sdk["planned_deltas"] = ["Ayo ", "is making ", "progress."]
    patch_sdk["planned_tool_calls"] = [
        (
            "emit_artifacts",
            {
                "citations": [
                    {"kind": "child", "child_id": "child-1", "label": "Ayo"}
                ],
                "visualizations": [],
                "ui_specs": [{"kind": "text", "text": "ok"}],
                "action_suggestions": [],
            },
        ),
    ]
    patch_sdk["response_text"] = "ignored when streaming"
    planner = CopilotInsightsPlanner(settings={})

    events = list(
        planner.run_turn_stream(
            system_prompt="sys",
            history=[],
            user_message="How is Ayo?",
            tools={},
            context=_make_context(),
            tool_call_budget=4,
        )
    )

    kinds = [k for k, _ in events]
    assert kinds.count("delta") == 3, kinds
    assert kinds[-1] == "final"
    deltas = [payload for kind, payload in events if kind == "delta"]
    assert deltas == ["Ayo ", "is making ", "progress."]

    final_kind, final = events[-1]
    assert final_kind == "final"
    assert final.answer_text == "Ayo is making progress."
    assert final.citations == [
        {"kind": "child", "child_id": "child-1", "label": "Ayo"}
    ]
    assert final.ui_specs == [{"kind": "text", "text": "ok"}]
    assert final.error_text is None
    # emit_artifacts itself is recorded in the trace but doesn't count
    # against the per-turn tool budget.
    assert final.tool_calls_count == 0
    assert any(t["name"] == "emit_artifacts" for t in final.tool_trace)


def test_run_turn_stream_falls_back_to_final_text_when_no_deltas(patch_sdk):
    """If the SDK doesn't emit any delta events (e.g., older model that
    doesn't stream), the adapter must still yield a single ``delta`` with
    the final assistant content so the user sees a non-empty answer.
    """
    patch_sdk["planned_deltas"] = []
    patch_sdk["planned_tool_calls"] = []
    patch_sdk["response_text"] = "Plain final answer."
    planner = CopilotInsightsPlanner(settings={})

    events = list(
        planner.run_turn_stream(
            system_prompt="sys",
            history=[],
            user_message="hi",
            tools={},
            context=_make_context(),
            tool_call_budget=2,
        )
    )
    deltas = [p for k, p in events if k == "delta"]
    assert deltas == ["Plain final answer."]
    _, final = events[-1]
    assert final.answer_text == "Plain final answer."


def test_run_turn_stream_streaming_kwarg_passed(patch_sdk):
    """The session must be created with ``streaming=True`` and the
    ``emit_artifacts`` tool registered in ``available_tools``.
    """
    patch_sdk["planned_deltas"] = ["ok"]
    patch_sdk["planned_tool_calls"] = []
    patch_sdk["response_text"] = ""
    planner = CopilotInsightsPlanner(settings={})

    list(
        planner.run_turn_stream(
            system_prompt="sys",
            history=[],
            user_message="hi",
            tools={},
            context=_make_context(),
            tool_call_budget=2,
        )
    )

    session = _FakeClient.last_instance.session  # type: ignore[union-attr]
    assert session.kwargs.get("streaming") is True
    assert "emit_artifacts" in session.kwargs.get("available_tools", [])
    assert any(
        getattr(t, "name", None) == "emit_artifacts"
        for t in session.kwargs.get("tools", [])
    )

