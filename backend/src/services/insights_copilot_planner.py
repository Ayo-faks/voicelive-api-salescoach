"""GitHub Copilot SDK adapter for the therapist Insights Agent.

This module provides :class:`CopilotInsightsPlanner`, a production-ready
implementation of the :class:`~src.services.insights_service.InsightsPlanner`
protocol. It mirrors the SDK usage pattern established in
``src.services.planning_service.CopilotPlannerRuntime``:

* ``CopilotClient`` / ``Tool`` / ``ToolResult`` from the ``copilot`` SDK.
* ``skip_permission=True`` on all tools so the therapist never sees a
  per-tool prompt — the InsightsService has already authorized the caller.
* ``on_pre_tool_use`` hook enforces the per-turn ``tool_call_budget``.
* Azure BYOK provider config via
  :func:`src.services.azure_openai_auth.build_copilot_azure_provider_config`.
* Response is expected to be a single JSON object with keys
  ``answer_text`` (required), ``citations`` (optional), and
  ``visualizations`` (optional). Plain-text responses are accepted as a
  fallback and returned verbatim as ``answer_text`` so a misconfigured
  model never produces an error-only turn.

The planner is intentionally stateless — the ``InsightsService`` owns
conversation persistence, scope authorization, and trace sanitisation.
This adapter only translates one planner turn in/out of the Copilot SDK.
"""

from __future__ import annotations

import asyncio
import json
import logging
import queue
import threading
import time
from typing import Any, Dict, Iterator, List, Mapping, Optional, Sequence, Tuple, cast

from src.services.azure_openai_auth import build_copilot_azure_provider_config
from src.services.insights_service import (
    InsightsAuthorizationError,
    InsightsPlannerResult,
    InsightsRequestContext,
    InsightsTool,
)

try:  # pragma: no cover - import guard mirrors planning_service.py
    from copilot import CopilotClient
    from copilot.client import SubprocessConfig
    from copilot.session import PermissionRequestResult
    from copilot.tools import Tool, ToolResult
except ImportError:  # pragma: no cover - exercised only when SDK missing
    CopilotClient = None  # type: ignore[assignment]
    SubprocessConfig = None  # type: ignore[assignment]
    PermissionRequestResult = None  # type: ignore[assignment]
    Tool = None  # type: ignore[assignment]
    ToolResult = None  # type: ignore[assignment]

try:  # pragma: no cover - only required for the streaming path
    from copilot.generated.session_events import AssistantMessageDeltaData
except ImportError:  # pragma: no cover - older SDKs without streaming events
    AssistantMessageDeltaData = None  # type: ignore[assignment]


_STREAM_SENTINEL = object()
_ARTIFACT_EMITTER_TOOL = "emit_artifacts"


logger = logging.getLogger(__name__)

SESSION_PREFIX = "insights-turn"
_MAX_RESULT_CHARS = 8_000
_MAX_TRACE_SUMMARY_CHARS = 200


def _approve_all_permissions(request: Any, invocation: Any) -> Any:
    """Auto-approve tool permission prompts.

    The therapist has already been authorized by :class:`InsightsService`
    before this planner is invoked, and every tool is registered with
    ``skip_permission=True`` — this handler is only a defensive fallback.
    """
    del request, invocation
    if PermissionRequestResult is None:  # pragma: no cover - SDK missing
        return None
    return PermissionRequestResult(kind="approved")


class CopilotInsightsPlanner:
    """Run a single InsightsService turn through the GitHub Copilot SDK."""

    def __init__(
        self,
        settings: Mapping[str, Any],
    ) -> None:
        self.settings = dict(settings or {})
        self.model = (
            str(self.settings.get("copilot_insights_model") or "").strip()
            or str(self.settings.get("copilot_planner_model") or "").strip()
            or "gpt-5"
        )
        self.reasoning_effort = str(
            self.settings.get("copilot_insights_reasoning_effort")
            or self.settings.get("copilot_planner_reasoning_effort")
            or "low"
        ).strip()
        self.cli_path = str(self.settings.get("copilot_cli_path") or "").strip()
        self.github_token = str(self.settings.get("copilot_github_token") or "").strip()

    # -- InsightsPlanner protocol ------------------------------------------

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
        self._validate_sdk_available()
        return asyncio.run(
            self._run_turn_async(
                system_prompt=system_prompt,
                history=history,
                user_message=user_message,
                tools=tools,
                context=context,
                tool_call_budget=tool_call_budget,
            )
        )

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
        """Stream a turn through the Copilot SDK with typed artifact channel.

        Prose is yielded as ``("delta", str)`` events as it arrives from the
        SDK. Structured artifacts (citations / visualizations / ui_specs /
        action_suggestions) arrive via a dedicated ``emit_artifacts`` tool
        call that the model is instructed to issue once per turn. A single
        ``("final", InsightsPlannerResult)`` is yielded last.

        The implementation uses Option 1 for the async↔sync bridge: a
        background thread drives ``asyncio.run`` while this generator
        consumes deltas from a ``queue.Queue`` on the Flask worker thread.
        """
        self._validate_sdk_available()
        q: "queue.Queue[Any]" = queue.Queue()
        outbox: Dict[str, Any] = {}

        def _runner() -> None:
            try:
                result = asyncio.run(
                    self._run_turn_async_streaming(
                        system_prompt=system_prompt,
                        history=history,
                        user_message=user_message,
                        tools=tools,
                        context=context,
                        tool_call_budget=tool_call_budget,
                        delta_queue=q,
                    )
                )
                outbox["result"] = result
            except BaseException as exc:  # noqa: BLE001 - re-raised in main thread
                outbox["error"] = exc
            finally:
                q.put(_STREAM_SENTINEL)

        thread = threading.Thread(target=_runner, daemon=True, name="insights-copilot-stream")
        thread.start()
        try:
            while True:
                item = q.get()
                if item is _STREAM_SENTINEL:
                    break
                if isinstance(item, tuple) and item and item[0] == "delta":
                    yield item
        finally:
            thread.join(timeout=5.0)

        result = outbox.get("result")
        if result is None:
            err = outbox.get("error")
            logger.exception(
                "CopilotInsightsPlanner streaming turn failed", exc_info=err
            )
            result = InsightsPlannerResult(
                answer_text="Something went wrong while answering.",
                tool_trace=[],
                tool_calls_count=0,
                error_text=f"copilot_sdk_error: {err}",
            )
        yield ("final", result)


    def _log_timing(
        self,
        *,
        context: InsightsRequestContext,
        planner_started_at: float,
        stage: str,
        **details: Any,
    ) -> None:
        payload: Dict[str, Any] = {
            "stage": stage,
            "request_id": context.request_id,
            "delta_ms": round((time.perf_counter() - planner_started_at) * 1000, 1),
        }
        payload.update(details)
        logger.info(
            "[insights-planner-timing] %s",
            json.dumps(payload, default=str, sort_keys=True, separators=(",", ":")),
        )

    # -- Async implementation ----------------------------------------------

    async def _run_turn_async(
        self,
        *,
        system_prompt: str,
        history: Sequence[Dict[str, Any]],
        user_message: str,
        tools: Mapping[str, InsightsTool],
        context: InsightsRequestContext,
        tool_call_budget: int,
    ) -> InsightsPlannerResult:
        planner_started_at = time.perf_counter()
        trace: List[Dict[str, Any]] = []
        call_state = {"count": 0, "budget": max(1, int(tool_call_budget))}
        tool_names = list(tools.keys())
        self._log_timing(
            context=context,
            planner_started_at=planner_started_at,
            stage="planner_start",
            history_count=len(history),
            tool_count=len(tool_names),
        )

        # pre-tool hook enforces per-turn tool-call budget; the SDK looks at
        # the "permissionDecision" field to decide whether to run the tool.
        async def on_pre_tool_use(input_data: Dict[str, Any], invocation: Dict[str, str]) -> Dict[str, Any]:
            del input_data, invocation
            if call_state["count"] >= call_state["budget"]:
                return {
                    "permissionDecision": "deny",
                    "permissionDecisionReason": "tool_call_budget_exhausted",
                }
            return {"permissionDecision": "allow"}

        sdk_tools = self._build_sdk_tools(
            tools,
            context,
            trace,
            call_state,
            planner_started_at=planner_started_at,
        )
        session_kwargs: Dict[str, Any] = {
            "on_permission_request": _approve_all_permissions,
            "model": self.model,
            "tools": sdk_tools,
            "available_tools": tool_names,
            "system_message": {"mode": "replace", "content": system_prompt},
            "hooks": {"on_pre_tool_use": on_pre_tool_use},
        }
        if self.reasoning_effort:
            session_kwargs["reasoning_effort"] = self.reasoning_effort
        provider = self._build_provider_config()
        if provider is not None:
            session_kwargs["provider"] = provider

        client = None
        session = None
        try:
            client = self._create_client()
            await client.start()
            self._log_timing(
                context=context,
                planner_started_at=planner_started_at,
                stage="client_started",
            )
            session = await client.create_session(**session_kwargs)
            self._log_timing(
                context=context,
                planner_started_at=planner_started_at,
                stage="session_created",
            )
            prompt = self._build_prompt(
                history=history,
                user_message=user_message,
                scope=context.scope,
            )
            self._log_timing(
                context=context,
                planner_started_at=planner_started_at,
                stage="send_and_wait_start",
                prompt_chars=len(prompt),
            )
            response = await session.send_and_wait(prompt)
            self._log_timing(
                context=context,
                planner_started_at=planner_started_at,
                stage="send_and_wait_end",
            )
            raw_text = self._extract_response_text(response)
        except Exception as exc:
            logger.exception("CopilotInsightsPlanner turn failed")
            return InsightsPlannerResult(
                answer_text="Something went wrong while answering.",
                tool_trace=trace,
                tool_calls_count=call_state["count"],
                error_text=f"copilot_sdk_error: {exc}",
            )
        finally:
            if session is not None:
                try:
                    await session.disconnect()
                except Exception:  # pragma: no cover - defensive
                    logger.debug("session.disconnect raised", exc_info=True)
            if client is not None:
                try:
                    await client.stop()
                except Exception:  # pragma: no cover - defensive
                    logger.debug("client.stop raised", exc_info=True)

        parsed = self._parse_response(raw_text)
        return InsightsPlannerResult(
            answer_text=parsed["answer_text"],
            citations=parsed["citations"],
            visualizations=parsed["visualizations"],
            ui_specs=parsed.get("ui_specs", []),
            action_suggestions=parsed.get("action_suggestions", []),
            tool_trace=trace,
            tool_calls_count=call_state["count"],
        )

    async def _run_turn_async_streaming(
        self,
        *,
        system_prompt: str,
        history: Sequence[Dict[str, Any]],
        user_message: str,
        tools: Mapping[str, InsightsTool],
        context: InsightsRequestContext,
        tool_call_budget: int,
        delta_queue: "queue.Queue[Any]",
    ) -> InsightsPlannerResult:
        planner_started_at = time.perf_counter()
        trace: List[Dict[str, Any]] = []
        call_state = {"count": 0, "budget": max(1, int(tool_call_budget))}
        prose_parts: List[str] = []
        captured_artifacts: Dict[str, List[Dict[str, Any]]] = {
            "citations": [],
            "visualizations": [],
            "ui_specs": [],
            "action_suggestions": [],
        }
        tool_names = list(tools.keys()) + [_ARTIFACT_EMITTER_TOOL]
        self._log_timing(
            context=context,
            planner_started_at=planner_started_at,
            stage="planner_stream_start",
            history_count=len(history),
            tool_count=len(tool_names),
        )

        # Pre-tool hook: enforce per-turn budget for real tools, but always
        # allow ``emit_artifacts`` (it's a structural channel, not a real
        # data-access tool).
        async def on_pre_tool_use(input_data: Dict[str, Any], invocation: Dict[str, str]) -> Dict[str, Any]:
            del input_data
            if invocation.get("name") == _ARTIFACT_EMITTER_TOOL:
                return {"permissionDecision": "allow"}
            if call_state["count"] >= call_state["budget"]:
                return {
                    "permissionDecision": "deny",
                    "permissionDecisionReason": "tool_call_budget_exhausted",
                }
            return {"permissionDecision": "allow"}

        sdk_tools = self._build_sdk_tools(
            tools,
            context,
            trace,
            call_state,
            planner_started_at=planner_started_at,
        )
        sdk_tools.append(
            self._build_artifact_emitter_tool(
                captured=captured_artifacts,
                trace=trace,
                context=context,
                planner_started_at=planner_started_at,
            )
        )

        session_kwargs: Dict[str, Any] = {
            "on_permission_request": _approve_all_permissions,
            "model": self.model,
            "tools": sdk_tools,
            "available_tools": tool_names,
            "system_message": {"mode": "replace", "content": system_prompt},
            "hooks": {"on_pre_tool_use": on_pre_tool_use},
            "streaming": True,
        }
        if self.reasoning_effort:
            session_kwargs["reasoning_effort"] = self.reasoning_effort
        provider = self._build_provider_config()
        if provider is not None:
            session_kwargs["provider"] = provider

        def on_event(event: Any) -> None:
            data = getattr(event, "data", None)
            # Tolerate the older SDKs where the delta class isn't exported:
            # match by attribute presence in that case.
            if AssistantMessageDeltaData is not None and isinstance(data, AssistantMessageDeltaData):
                chunk = getattr(data, "delta_content", "") or ""
            else:
                chunk = getattr(data, "delta_content", None) if data is not None else None
                if not isinstance(chunk, str):
                    return
            if chunk:
                prose_parts.append(chunk)
                delta_queue.put(("delta", chunk))

        client = None
        session = None
        unsubscribe = None
        try:
            client = self._create_client()
            await client.start()
            self._log_timing(
                context=context,
                planner_started_at=planner_started_at,
                stage="client_started",
            )
            session = await client.create_session(**session_kwargs)
            unsubscribe = session.on(on_event)
            self._log_timing(
                context=context,
                planner_started_at=planner_started_at,
                stage="session_created",
            )
            prompt = self._build_streaming_prompt(
                history=history,
                user_message=user_message,
                scope=context.scope,
            )
            self._log_timing(
                context=context,
                planner_started_at=planner_started_at,
                stage="send_and_wait_start",
                prompt_chars=len(prompt),
            )
            response = await session.send_and_wait(prompt)
            self._log_timing(
                context=context,
                planner_started_at=planner_started_at,
                stage="send_and_wait_end",
            )
            # If no deltas arrived (model didn't stream), fall back to the
            # final assistant content so the user still sees a non-empty
            # answer. The service layer chunks it before yielding.
            if not prose_parts:
                fallback = self._extract_response_text(response)
                if fallback:
                    prose_parts.append(fallback)
                    delta_queue.put(("delta", fallback))
        finally:
            if unsubscribe is not None:
                try:
                    unsubscribe()
                except Exception:  # pragma: no cover - defensive
                    logger.debug("unsubscribe raised", exc_info=True)
            if session is not None:
                try:
                    await session.disconnect()
                except Exception:  # pragma: no cover - defensive
                    logger.debug("session.disconnect raised", exc_info=True)
            if client is not None:
                try:
                    await client.stop()
                except Exception:  # pragma: no cover - defensive
                    logger.debug("client.stop raised", exc_info=True)

        answer_text = "".join(prose_parts).strip()
        if not answer_text:
            answer_text = "I couldn't produce an answer."
        return InsightsPlannerResult(
            answer_text=answer_text,
            citations=list(captured_artifacts["citations"]),
            visualizations=list(captured_artifacts["visualizations"]),
            ui_specs=list(captured_artifacts["ui_specs"]),
            action_suggestions=list(captured_artifacts["action_suggestions"]),
            tool_trace=trace,
            tool_calls_count=call_state["count"],
        )

    # -- SDK wiring helpers -------------------------------------------------

    def _create_client(self) -> Any:
        if self.cli_path or self.github_token:
            return CopilotClient(
                SubprocessConfig(
                    cli_path=self.cli_path or None,
                    github_token=self.github_token or None,
                )
            )
        return CopilotClient()

    def _build_provider_config(self) -> Optional[Dict[str, Any]]:
        provider = build_copilot_azure_provider_config(self.settings)
        return cast(Optional[Dict[str, Any]], provider)

    def _build_sdk_tools(
        self,
        tools: Mapping[str, InsightsTool],
        context: InsightsRequestContext,
        trace: List[Dict[str, Any]],
        call_state: Dict[str, int],
        *,
        planner_started_at: float,
    ) -> List[Any]:
        sdk_tools: List[Any] = []
        for insight_tool in tools.values():
            sdk_tools.append(
                Tool(
                    name=insight_tool.name,
                    description=insight_tool.description,
                    parameters=insight_tool.parameters,
                    skip_permission=True,
                    handler=self._make_handler(
                        insight_tool,
                        context,
                        trace,
                        call_state,
                        planner_started_at=planner_started_at,
                    ),
                )
            )
        return sdk_tools

    def _make_handler(
        self,
        insight_tool: InsightsTool,
        context: InsightsRequestContext,
        trace: List[Dict[str, Any]],
        call_state: Dict[str, int],
        *,
        planner_started_at: float,
    ):
        def handler(invocation: Any) -> Any:
            args = getattr(invocation, "arguments", None) or {}
            if not isinstance(args, dict):
                args = {}
            call_state["count"] += 1
            started_at = time.perf_counter()
            entry: Dict[str, Any] = {
                "name": insight_tool.name,
                "arguments": dict(args),
            }
            try:
                result = insight_tool.handler(dict(args), context)
            except InsightsAuthorizationError as exc:
                entry["duration_ms"] = int((time.perf_counter() - started_at) * 1000)
                entry["error"] = f"forbidden: {exc}"
                trace.append(entry)
                self._log_timing(
                    context=context,
                    planner_started_at=planner_started_at,
                    stage="tool_completed",
                    tool=insight_tool.name,
                    duration_ms=entry["duration_ms"],
                    status="forbidden",
                )
                return ToolResult(
                    text_result_for_llm=json.dumps({"error": "forbidden"}),
                    result_type="error",
                    session_log=f"{insight_tool.name}: forbidden",
                )
            except ValueError as exc:
                entry["duration_ms"] = int((time.perf_counter() - started_at) * 1000)
                entry["error"] = f"invalid: {exc}"
                trace.append(entry)
                self._log_timing(
                    context=context,
                    planner_started_at=planner_started_at,
                    stage="tool_completed",
                    tool=insight_tool.name,
                    duration_ms=entry["duration_ms"],
                    status="invalid",
                )
                return ToolResult(
                    text_result_for_llm=json.dumps({"error": str(exc)}),
                    result_type="error",
                    session_log=f"{insight_tool.name}: invalid args",
                )
            except Exception as exc:  # pragma: no cover - defensive
                logger.exception("Insights tool %s failed", insight_tool.name)
                entry["duration_ms"] = int((time.perf_counter() - started_at) * 1000)
                entry["error"] = f"tool_error: {exc}"
                trace.append(entry)
                self._log_timing(
                    context=context,
                    planner_started_at=planner_started_at,
                    stage="tool_completed",
                    tool=insight_tool.name,
                    duration_ms=entry["duration_ms"],
                    status="error",
                )
                return ToolResult(
                    text_result_for_llm=json.dumps({"error": "tool_error"}),
                    result_type="error",
                    session_log=f"{insight_tool.name}: error",
                )

            entry["duration_ms"] = int((time.perf_counter() - started_at) * 1000)
            payload_text = self._serialize_tool_result(result)
            entry["result_summary"] = self._summarize_result(result)
            trace.append(entry)
            self._log_timing(
                context=context,
                planner_started_at=planner_started_at,
                stage="tool_completed",
                tool=insight_tool.name,
                duration_ms=entry["duration_ms"],
                status="success",
            )
            return ToolResult(
                text_result_for_llm=payload_text,
                result_type="success",
                session_log=f"{insight_tool.name}: ok",
            )

        return handler

    def _build_artifact_emitter_tool(
        self,
        *,
        captured: Dict[str, List[Dict[str, Any]]],
        trace: List[Dict[str, Any]],
        context: InsightsRequestContext,
        planner_started_at: float,
    ) -> Any:
        """Build the ``emit_artifacts`` Tool used by the streaming path.

        Prose streams via assistant message deltas; this tool is the typed
        channel for citations / visualizations / ui_specs /
        action_suggestions. The model is instructed (in the streaming
        prompt) to call it exactly once per turn.
        """
        parameters = {
            "type": "object",
            "properties": {
                "citations": {
                    "type": "array",
                    "description": "Source citations referenced in the prose.",
                    "items": {"type": "object"},
                },
                "visualizations": {
                    "type": "array",
                    "description": "Chart / table specs (matches insight-service shape).",
                    "items": {"type": "object"},
                },
                "ui_specs": {
                    "type": "array",
                    "description": "Voice-agent UI specs.",
                    "items": {"type": "object"},
                },
                "action_suggestions": {
                    "type": "array",
                    "description": "Proposed actions for the therapist.",
                    "items": {"type": "object"},
                },
            },
        }

        def handler(invocation: Any) -> Any:
            args = getattr(invocation, "arguments", None) or {}
            if not isinstance(args, dict):
                args = {}
            started_at = time.perf_counter()
            for key in ("citations", "visualizations", "ui_specs", "action_suggestions"):
                raw = args.get(key)
                if isinstance(raw, list):
                    captured[key] = [item for item in raw if isinstance(item, dict)]
            entry: Dict[str, Any] = {
                "name": _ARTIFACT_EMITTER_TOOL,
                "arguments": {
                    key: len(args.get(key) or []) for key in (
                        "citations", "visualizations", "ui_specs", "action_suggestions",
                    )
                },
                "duration_ms": int((time.perf_counter() - started_at) * 1000),
                "result_summary": "captured",
            }
            trace.append(entry)
            self._log_timing(
                context=context,
                planner_started_at=planner_started_at,
                stage="tool_completed",
                tool=_ARTIFACT_EMITTER_TOOL,
                duration_ms=entry["duration_ms"],
                status="success",
            )
            return ToolResult(
                text_result_for_llm=json.dumps({"ok": True}),
                result_type="success",
                session_log=f"{_ARTIFACT_EMITTER_TOOL}: ok",
            )

        return Tool(
            name=_ARTIFACT_EMITTER_TOOL,
            description=(
                "Emit structured artifacts (citations, visualizations, "
                "ui_specs, action_suggestions) that accompany the prose "
                "answer. Call this exactly once per turn after the prose "
                "is complete; pass empty arrays for fields you don't use."
            ),
            parameters=parameters,
            skip_permission=True,
            handler=handler,
        )

    # -- Prompt + response shaping -----------------------------------------

    def _build_prompt(
        self,
        *,
        history: Sequence[Dict[str, Any]],
        user_message: str,
        scope: Optional[Mapping[str, Any]] = None,
    ) -> str:
        """Fold prior turns into a single user prompt.

        The Copilot SDK does not expose a native ``messages`` parameter on
        ``send_and_wait``, so we flatten recent history into a single
        message. We keep the last few turns only to stay within context.
        """
        lines: List[str] = []
        if scope:
            scope_type = str(scope.get("type") or "caseload")
            lines.append(
                "Active scope (authoritative — use these exact IDs when "
                "calling tools; never pass names or guessed IDs):"
            )
            lines.append(f"  scope_type: {scope_type}")
            for key in ("child_id", "session_id", "report_id"):
                value = scope.get(key)
                if value:
                    lines.append(f"  {key}: {value}")
            lines.append("")
        recent = list(history or [])[-8:]
        if recent:
            lines.append("Conversation so far (most recent last):")
            for row in recent:
                role = str(row.get("role") or "").strip() or "user"
                text = str(row.get("content_text") or "").strip()
                if not text:
                    continue
                lines.append(f"[{role}] {text}")
            lines.append("")
        lines.append(
            "Return one valid JSON object with keys 'answer_text' (string), "
            "'citations' (optional array of citation objects), "
            "'visualizations' (optional array of visualization specs), "
            "'ui_specs' (optional array of voice-agent UI specs: kinds "
            "text|table|chart|form|confirmation|studentProfile|planDraft), "
            "and 'action_suggestions' (optional array of proposed actions; "
            "each has action_id, action_type, label, risk_level, parameters, "
            "and rationale). Never propose mutations the user did not ask "
            "for. Do not wrap the JSON in markdown fences."
        )
        lines.append("")
        lines.append(f"Therapist question: {user_message}")
        return "\n".join(lines)

    def _build_streaming_prompt(
        self,
        *,
        history: Sequence[Dict[str, Any]],
        user_message: str,
        scope: Optional[Mapping[str, Any]] = None,
    ) -> str:
        """Prompt variant for the typed-channel streaming path.

        Instructs the model to stream natural prose and call
        ``emit_artifacts`` exactly once with any structured data —
        mirroring OpenAI Responses (text delta + function-call delta) and
        Anthropic Messages (text vs input_json content blocks).
        """
        lines: List[str] = []
        if scope:
            scope_type = str(scope.get("type") or "caseload")
            lines.append(
                "Active scope (authoritative — use these exact IDs when "
                "calling tools; never pass names or guessed IDs):"
            )
            lines.append(f"  scope_type: {scope_type}")
            for key in ("child_id", "session_id", "report_id"):
                value = scope.get(key)
                if value:
                    lines.append(f"  {key}: {value}")
            lines.append("")
        recent = list(history or [])[-8:]
        if recent:
            lines.append("Conversation so far (most recent last):")
            for row in recent:
                role = str(row.get("role") or "").strip() or "user"
                text = str(row.get("content_text") or "").strip()
                if not text:
                    continue
                lines.append(f"[{role}] {text}")
            lines.append("")
        lines.append(
            "Write your answer to the therapist as natural prose. Do NOT "
            "wrap the answer in JSON or markdown fences. After the prose "
            "is complete, call the `emit_artifacts` tool EXACTLY ONCE with "
            "any structured data: 'citations' (sources you referenced), "
            "'visualizations' (chart / table specs), 'ui_specs' (voice-"
            "agent UI specs: kinds text|table|chart|form|confirmation|"
            "studentProfile|planDraft), and 'action_suggestions' (proposed "
            "actions with action_id, action_type, label, risk_level, "
            "parameters, rationale). Pass empty arrays for fields you "
            "don't use. Never propose mutations the user did not ask for. "
            "Do not repeat the structured data inline in the prose."
        )
        lines.append("")
        lines.append(f"Therapist question: {user_message}")
        return "\n".join(lines)

    def _extract_response_text(self, response: Any) -> str:
        if response is None:
            raise RuntimeError("Copilot Insights planner returned no response")
        data = getattr(response, "data", None)
        content = getattr(data, "content", None) if data is not None else None
        if content is None:
            content = getattr(response, "content", None)
        text = str(content or "").strip()
        if not text:
            raise RuntimeError("Copilot Insights planner returned an empty response")
        return text

    def _parse_response(self, raw_text: str) -> Dict[str, Any]:
        stripped = raw_text.strip()
        if stripped.startswith("```"):
            stripped = stripped.strip("`")
            if stripped.lower().startswith("json"):
                stripped = stripped[4:].lstrip()
        payload: Any = None
        try:
            payload = json.loads(stripped)
        except json.JSONDecodeError:
            start = stripped.find("{")
            end = stripped.rfind("}")
            if start >= 0 and end > start:
                try:
                    payload = json.loads(stripped[start : end + 1])
                except json.JSONDecodeError:
                    payload = None

        if isinstance(payload, dict):
            answer = str(payload.get("answer_text") or "").strip()
            citations_raw = payload.get("citations")
            visualizations_raw = payload.get("visualizations")
            ui_specs_raw = payload.get("ui_specs")
            actions_raw = payload.get("action_suggestions")
            citations = [c for c in citations_raw if isinstance(c, dict)] if isinstance(citations_raw, list) else []
            visualizations = (
                [v for v in visualizations_raw if isinstance(v, dict)] if isinstance(visualizations_raw, list) else []
            )
            ui_specs = [u for u in ui_specs_raw if isinstance(u, dict)] if isinstance(ui_specs_raw, list) else []
            action_suggestions = [a for a in actions_raw if isinstance(a, dict)] if isinstance(actions_raw, list) else []
            if answer:
                return {
                    "answer_text": answer,
                    "citations": citations,
                    "visualizations": visualizations,
                    "ui_specs": ui_specs,
                    "action_suggestions": action_suggestions,
                }

        # Fallback: treat raw text as plain answer.
        return {
            "answer_text": raw_text.strip(),
            "citations": [],
            "visualizations": [],
            "ui_specs": [],
            "action_suggestions": [],
        }

    def _serialize_tool_result(self, result: Any) -> str:
        try:
            text = json.dumps(result, ensure_ascii=True, default=str)
        except (TypeError, ValueError):
            text = json.dumps({"error": "unserializable_result"})
        if len(text) > _MAX_RESULT_CHARS:
            text = text[:_MAX_RESULT_CHARS] + "…"
        return text

    def _summarize_result(self, result: Any) -> str:
        try:
            summary = json.dumps(result, ensure_ascii=True, default=str)
        except (TypeError, ValueError):
            summary = repr(result)
        if len(summary) > _MAX_TRACE_SUMMARY_CHARS:
            summary = summary[:_MAX_TRACE_SUMMARY_CHARS] + "…"
        return summary

    def _validate_sdk_available(self) -> None:
        if (
            CopilotClient is not None
            and PermissionRequestResult is not None
            and Tool is not None
            and ToolResult is not None
        ):
            return
        raise RuntimeError(
            "GitHub Copilot SDK is not installed. Install 'github-copilot-sdk' "
            "and ensure the Copilot CLI is available to use "
            "CopilotInsightsPlanner."
        )


def build_insights_planner_from_env(
    settings: Mapping[str, Any],
) -> Optional[CopilotInsightsPlanner]:
    """Return a real Copilot planner if the SDK + config are present.

    Returns ``None`` when the SDK import failed or no credential / BYOK
    provider is available, so callers can fall back to the stub planner.
    """
    if CopilotClient is None or Tool is None or ToolResult is None:
        return None
    github_token = str((settings or {}).get("copilot_github_token") or "").strip()
    byok = build_copilot_azure_provider_config(settings)
    if not github_token and not byok:
        return None
    return CopilotInsightsPlanner(settings)
