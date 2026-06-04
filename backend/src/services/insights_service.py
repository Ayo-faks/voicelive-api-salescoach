"""Phase 4 Insights Agent service.

The :class:`InsightsService` is the therapist-facing ask-your-data surface.
It owns:

* the frozen system prompt + tool-catalog version
* a read-only tool registry with per-call therapist-scope enforcement
* bounded multi-step execution per therapist message (tool-call + wall-clock
  budgets)
* multi-turn conversation persistence (``insight_conversations`` and
  ``insight_messages``)
* the answer payload contract shared with the frontend rail and the
  Phase 2 ``VisualizationBlock``.

The LLM/planner itself is behind a small :class:`InsightsPlanner` protocol so
we can swap the real Copilot SDK adapter (Phase 4b) and the deterministic
stub used in unit tests and local dev without touching the rest of the
service. The service never constructs SQL or mutates data — tools only read.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Iterator, List, Mapping, Optional, Protocol, Sequence, Tuple

from src.services.visualization_service import (
    VisualizationValidationError,
    validate_visualization,
)
from src.services.voice_agent_contracts import (
    sanitize_action_suggestions,
    sanitize_ui_specs,
)

logger = logging.getLogger(__name__)


# --- Public constants -------------------------------------------------------

PROMPT_VERSION = "insights-v1"

# Voice latency win 2026-05-24: previously 6; the planner regularly chained 4+
# serial tool roundtrips at 1–2 s each, dominating end-to-end response time.
# Tighter budget forces it to use ``get_child_planning_snapshot`` plus at most
# one drill-down call.
DEFAULT_TOOL_CALL_BUDGET = 4
DEFAULT_WALL_CLOCK_BUDGET_SECONDS = 20.0

# Identical (user, scope, message) repeats inside this window skip the planner
# entirely. Tune via ``INSIGHTS_ANSWER_CACHE_TTL_SECONDS`` (0 disables).
DEFAULT_ANSWER_CACHE_TTL_SECONDS = 300.0
DEFAULT_ANSWER_CACHE_MAX_ENTRIES = 256


class _AnswerCache:
    """In-memory TTL + LRU cache of :class:`InsightsPlannerResult` payloads.

    Keyed on (prompt_version, user_id, scope, message). Cache is per-process
    and intentionally small — it exists to swallow rapid voice-turn repeats
    (e.g. the user re-asking the same question) so the Copilot planner does
    not pay its ~1.2 s start + multi-second tool roundtrip cost twice.
    """

    def __init__(self, *, ttl_seconds: float, max_entries: int) -> None:
        self.ttl_seconds = max(0.0, float(ttl_seconds))
        self.max_entries = max(1, int(max_entries))
        self._entries: "OrderedDict[str, Tuple[float, InsightsPlannerResult]]" = OrderedDict()
        self._lock = threading.Lock()

    @property
    def enabled(self) -> bool:
        return self.ttl_seconds > 0

    @staticmethod
    def build_key(
        *,
        prompt_version: str,
        user_id: str,
        scope: Mapping[str, Any],
        message: str,
    ) -> str:
        normalized = json.dumps(
            {
                "v": prompt_version,
                "u": user_id,
                "s": scope,
                "m": message.strip().lower(),
            },
            sort_keys=True,
            default=str,
            separators=(",", ":"),
        )
        return hashlib.sha256(normalized.encode("utf-8")).hexdigest()

    def get(self, key: str) -> Optional[InsightsPlannerResult]:
        if not self.enabled:
            return None
        now = time.monotonic()
        with self._lock:
            entry = self._entries.get(key)
            if entry is None:
                return None
            expires_at, payload = entry
            if expires_at <= now:
                self._entries.pop(key, None)
                return None
            self._entries.move_to_end(key)
            return payload

    def put(self, key: str, payload: "InsightsPlannerResult") -> None:
        if not self.enabled:
            return
        expires_at = time.monotonic() + self.ttl_seconds
        with self._lock:
            self._entries[key] = (expires_at, payload)
            self._entries.move_to_end(key)
            while len(self._entries) > self.max_entries:
                self._entries.popitem(last=False)

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()

ALLOWED_SCOPE_TYPES = frozenset({"caseload", "child", "session", "report"})


class InsightsAuthorizationError(PermissionError):
    """Raised when a tool is invoked outside the therapist's access scope."""


class InsightsBudgetExceeded(RuntimeError):
    """Raised when a turn exceeds the tool-call or wall-clock budget."""


# --- Tool registry ----------------------------------------------------------


@dataclass(frozen=True)
class InsightsTool:
    """Declarative metadata + handler for a single read-only insights tool."""

    name: str
    description: str
    parameters: Dict[str, Any]
    # Handler receives the resolved arguments plus the ``InsightsRequestContext``.
    # It MUST raise ``InsightsAuthorizationError`` for forbidden data and
    # ``ValueError`` for validation problems. Return value is serialisable JSON.
    handler: Callable[[Dict[str, Any], "InsightsRequestContext"], Any]


@dataclass
class InsightsRequestContext:
    """Per-turn context passed into each tool handler.

    Holds the therapist user id, the scope the conversation is anchored on,
    the active storage service, and a monotonic deadline so handlers can
    fail-fast if the budget is already exhausted.
    """

    user_id: str
    scope: Dict[str, Any]
    storage_service: Any
    child_memory_service: Optional[Any] = None
    institutional_memory_service: Optional[Any] = None
    deadline_monotonic: Optional[float] = None
    request_id: Optional[str] = None

    def check_deadline(self) -> None:
        if self.deadline_monotonic is None:
            return
        if time.monotonic() >= self.deadline_monotonic:
            raise InsightsBudgetExceeded("wall_clock_budget_exceeded")


# --- Planner protocol -------------------------------------------------------


@dataclass
class InsightsToolCallRecord:
    """A single tool invocation to be persisted as part of the trace."""

    name: str
    arguments: Dict[str, Any]
    result_summary: str
    duration_ms: int
    error: Optional[str] = None


@dataclass
class InsightsPlannerResult:
    """Structured result of a planner turn.

    ``answer_text``, ``citations``, and ``visualizations`` are the
    therapist-visible output; ``tool_trace`` is the auditable record.
    ``ui_specs`` and ``action_suggestions`` are the voice-agent dynamic UI
    and proposed actions surface (validated downstream by
    ``voice_agent_contracts``).
    """

    answer_text: str
    citations: List[Dict[str, Any]] = field(default_factory=list)
    visualizations: List[Dict[str, Any]] = field(default_factory=list)
    tool_trace: List[Dict[str, Any]] = field(default_factory=list)
    tool_calls_count: int = 0
    error_text: Optional[str] = None
    ui_specs: List[Dict[str, Any]] = field(default_factory=list)
    action_suggestions: List[Dict[str, Any]] = field(default_factory=list)


class InsightsPlanner(Protocol):
    """Minimal interface the service needs from any planner implementation."""

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
        raise NotImplementedError

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
        """Streaming variant.

        Yields ``("delta", str)`` for incremental prose chunks (zero or more)
        and finally ``("final", InsightsPlannerResult)`` exactly once. The
        concatenation of all deltas SHOULD equal the final result's
        ``answer_text`` but the service does not enforce this — it persists
        ``answer_text`` from the final result and uses deltas only for the
        wire-format token stream.
        """
        raise NotImplementedError


# --- Default stub planner ---------------------------------------------------


class StubInsightsPlanner:
    """Deterministic planner for unit tests and local development.

    Behaviour:

    * If the scope names a child and ``get_child_overview`` is registered,
      the stub calls it once and echoes the overview summary into its answer.
    * Otherwise the stub returns a short deterministic reply naming the
      scope. This keeps the happy path of persistence + tool-trace exercised
      end-to-end without requiring a live LLM.

    Real deployments should wire a GitHub Copilot SDK adapter in place.
    """

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
        del system_prompt, history  # stub ignores history
        trace: List[Dict[str, Any]] = []
        citations: List[Dict[str, Any]] = []
        visualizations: List[Dict[str, Any]] = []
        tool_calls_count = 0

        scope_child_id = context.scope.get("child_id") if isinstance(context.scope, dict) else None

        if scope_child_id and "get_child_overview" in tools and tool_call_budget > 0:
            start = time.monotonic()
            try:
                result = tools["get_child_overview"].handler({"child_id": scope_child_id}, context)
            except InsightsAuthorizationError as exc:
                trace.append(
                    {
                        "name": "get_child_overview",
                        "arguments": {"child_id": scope_child_id},
                        "duration_ms": int((time.monotonic() - start) * 1000),
                        "error": f"forbidden: {exc}",
                    }
                )
                return InsightsPlannerResult(
                    answer_text="I can't access this child record.",
                    tool_trace=trace,
                    tool_calls_count=1,
                    error_text=str(exc),
                )
            except Exception as exc:  # pragma: no cover - defensive
                trace.append(
                    {
                        "name": "get_child_overview",
                        "arguments": {"child_id": scope_child_id},
                        "duration_ms": int((time.monotonic() - start) * 1000),
                        "error": str(exc),
                    }
                )
                return InsightsPlannerResult(
                    answer_text="I hit an error looking up this child.",
                    tool_trace=trace,
                    tool_calls_count=1,
                    error_text=str(exc),
                )

            duration_ms = int((time.monotonic() - start) * 1000)
            tool_calls_count += 1
            child_name = (result or {}).get("name") or scope_child_id
            trace.append(
                {
                    "name": "get_child_overview",
                    "arguments": {"child_id": scope_child_id},
                    "duration_ms": duration_ms,
                    "result_summary": f"child={child_name}",
                }
            )
            if (result or {}).get("id"):
                citations.append(
                    {
                        "kind": "child",
                        "child_id": result["id"],
                        "label": child_name,
                    }
                )
            answer_text = (
                f"Here's what I have on {child_name}. " f"(Stub planner — the real LLM wiring lands in Phase 4b.)"
            )
            return InsightsPlannerResult(
                answer_text=answer_text,
                citations=citations,
                visualizations=visualizations,
                tool_trace=trace,
                tool_calls_count=tool_calls_count,
            )

        scope_summary = (context.scope.get("type") if isinstance(context.scope, dict) else "caseload") or "caseload"
        return InsightsPlannerResult(
            answer_text=(
                f"(Stub answer for scope '{scope_summary}'.) "
                "The real Insights planner will answer with citations and, "
                "when useful, a chart or table."
            ),
            tool_trace=trace,
            tool_calls_count=tool_calls_count,
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
        """Stub streaming variant: run the turn synchronously then chunk
        the prose so the wire protocol exercises real per-token framing.
        """
        result = self.run_turn(
            system_prompt=system_prompt,
            history=history,
            user_message=user_message,
            tools=tools,
            context=context,
            tool_call_budget=tool_call_budget,
        )
        for chunk in _chunk_prose(result.answer_text):
            yield ("delta", chunk)
        yield ("final", result)


def _chunk_prose(text: str, *, target_chars: int = 24) -> List[str]:
    """Split a string into ~``target_chars`` chunks at whitespace boundaries.

    Used by the streaming stub to emit multiple ``token`` SSE frames per
    turn. Whitespace-aware so chunks stay readable if rendered eagerly.
    """
    if not text:
        return []
    chunks: List[str] = []
    buf = ""
    for token in text.split(" "):
        candidate = (buf + " " + token) if buf else token
        if len(candidate) >= target_chars:
            chunks.append(candidate)
            buf = ""
        else:
            buf = candidate
    if buf:
        chunks.append(buf)
    # Restore inter-chunk spaces so concatenation equals the original text.
    return [c if i == 0 else " " + c.lstrip(" ") for i, c in enumerate(chunks)]


def _maybe_wrap_planner(planner: "InsightsPlanner") -> "InsightsPlanner":
    """Optionally wrap the planner in the agent-mesh ``PlannerAgent`` shim.

    Default-off: when ``AGENT_MESH_ENABLED`` is not truthy the planner is
    returned unchanged, so the planner code path is byte-identical to today.
    When the flag is on, the planner is wrapped in :class:`PlannerAgent`,
    which delegates 1:1 and only adds ``[agent-mesh]`` structured logging.

    Wrapping is best-effort: any import/construction failure falls back to the
    original planner so the flag can never break the insights surface.
    """

    # Local import avoids a module-level cycle: ``planner_agent`` imports the
    # ``InsightsPlanner`` protocol from this module.
    try:
        from src.agents.base import agent_mesh_enabled

        if not agent_mesh_enabled():
            return planner

        from src.agents.planner_agent import PlannerAgent

        wrapped = PlannerAgent(planner)
        logger.info(
            "[agent-mesh] insights planner wrapped underlying=%s",
            type(planner).__name__,
        )
        return wrapped
    except Exception:  # pragma: no cover - defensive: never break insights
        logger.exception("[agent-mesh] planner wrap failed; using planner unwrapped")
        return planner


# --- Service ----------------------------------------------------------------


class InsightsService:
    """Therapist Insights Agent: ask-your-data over therapist-accessible data."""

    PROMPT_VERSION = PROMPT_VERSION

    def __init__(
        self,
        storage_service: Any,
        *,
        child_memory_service: Optional[Any] = None,
        institutional_memory_service: Optional[Any] = None,
        planner: Optional[InsightsPlanner] = None,
        learning_api: Optional[Any] = None,
        tool_call_budget: int = DEFAULT_TOOL_CALL_BUDGET,
        wall_clock_budget_seconds: float = DEFAULT_WALL_CLOCK_BUDGET_SECONDS,
        answer_cache_ttl_seconds: float = DEFAULT_ANSWER_CACHE_TTL_SECONDS,
        answer_cache_max_entries: int = DEFAULT_ANSWER_CACHE_MAX_ENTRIES,
        chitchat_handler: Optional[Any] = None,
        router_config: Optional[Any] = None,
    ) -> None:
        self.storage_service = storage_service
        self.child_memory_service = child_memory_service
        self.institutional_memory_service = institutional_memory_service
        self.learning_api = learning_api
        self.planner: InsightsPlanner = _maybe_wrap_planner(planner or StubInsightsPlanner())
        self.tool_call_budget = max(1, int(tool_call_budget))
        self.wall_clock_budget_seconds = max(1.0, float(wall_clock_budget_seconds))
        self._answer_cache = _AnswerCache(
            ttl_seconds=answer_cache_ttl_seconds,
            max_entries=answer_cache_max_entries,
        )
        self._tools: Dict[str, InsightsTool] = self._build_tools()
        self._router_config = router_config or _load_router_config_from_env()
        self._chitchat_handler = chitchat_handler

    # -- Public API ---------------------------------------------------------

    def list_conversations(self, *, user_id: str, limit: int = 50) -> List[Dict[str, Any]]:
        return self.storage_service.list_insight_conversations_for_user(user_id, limit=limit)

    def get_conversation(
        self,
        *,
        user_id: str,
        conversation_id: str,
    ) -> Optional[Dict[str, Any]]:
        conversation = self.storage_service.get_insight_conversation(conversation_id, user_id=user_id)
        if conversation is None:
            return None
        messages = self.storage_service.list_insight_messages(conversation_id)
        return {"conversation": conversation, "messages": messages}

    def ask(
        self,
        *,
        user_id: str,
        message: str,
        scope: Optional[Mapping[str, Any]] = None,
        conversation_id: Optional[str] = None,
        workspace_id: Optional[str] = None,
        request_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Run one bounded turn and return the updated conversation payload."""

        cleaned_message = (message or "").strip()
        if not cleaned_message:
            raise ValueError("message is required")

        normalized_scope = _normalize_scope(scope)
        self._authorize_scope(user_id=user_id, scope=normalized_scope)

        conversation = self._resolve_conversation(
            user_id=user_id,
            conversation_id=conversation_id,
            scope=normalized_scope,
            workspace_id=workspace_id,
            first_message=cleaned_message,
        )

        history = self.storage_service.list_insight_messages(conversation["id"])

        # Persist the user turn first so the trace is complete even if the
        # planner blows up.
        user_message_row = self.storage_service.append_insight_message(
            conversation["id"],
            role="user",
            content_text=cleaned_message,
            prompt_version=self.PROMPT_VERSION,
        )

        deadline = time.monotonic() + self.wall_clock_budget_seconds
        context = InsightsRequestContext(
            user_id=user_id,
            scope=dict(normalized_scope),
            storage_service=self.storage_service,
            child_memory_service=self.child_memory_service,
            institutional_memory_service=self.institutional_memory_service,
            deadline_monotonic=deadline,
            request_id=request_id,
        )

        cache_key = _AnswerCache.build_key(
            prompt_version=self.PROMPT_VERSION,
            user_id=user_id,
            scope=normalized_scope,
            message=cleaned_message,
        )
        cached_result = self._answer_cache.get(cache_key)
        cache_hit = cached_result is not None

        start = time.monotonic()
        planner_result: InsightsPlannerResult
        route_decision: Optional[Any] = None
        if cache_hit:
            assert cached_result is not None
            planner_result = cached_result
            logger.info(
                "[insights-cache] %s",
                json.dumps(
                    {
                        "event": "hit",
                        "request_id": request_id,
                        "user_id": user_id,
                        "scope_type": normalized_scope.get("type"),
                    },
                    sort_keys=True,
                    separators=(",", ":"),
                ),
            )
        else:
            route_decision, planner_result = self._dispatch_turn(
                cleaned_message=cleaned_message,
                history=history,
                context=context,
                normalized_scope=normalized_scope,
                request_id=request_id,
                user_id=user_id,
            )
            if planner_result.error_text is None and (planner_result.answer_text or "").strip():
                self._answer_cache.put(cache_key, planner_result)

        latency_ms = int((time.monotonic() - start) * 1000)

        safe_visualizations = self._sanitize_visualizations(planner_result.visualizations)
        safe_citations = _sanitize_citations(planner_result.citations)
        safe_trace = _sanitize_tool_trace(planner_result.tool_trace)
        safe_ui_specs = sanitize_ui_specs(planner_result.ui_specs)
        safe_action_suggestions = sanitize_action_suggestions(
            planner_result.action_suggestions
        )

        assistant_message_row = self.storage_service.append_insight_message(
            conversation["id"],
            role="assistant",
            content_text=planner_result.answer_text or "",
            citations=safe_citations,
            visualizations=safe_visualizations,
            tool_trace=safe_trace,
            latency_ms=latency_ms,
            tool_calls_count=max(0, int(planner_result.tool_calls_count or 0)),
            prompt_version=self.PROMPT_VERSION,
            error_text=planner_result.error_text,
        )
        # Voice-agent dynamic UI / proposed actions ride on the returned
        # message dict (ephemeral, not persisted yet). The websocket handler
        # forwards these into ``turn.completed``.
        if safe_ui_specs:
            assistant_message_row["ui_specs"] = safe_ui_specs
        if safe_action_suggestions:
            assistant_message_row["action_suggestions"] = safe_action_suggestions

        return {
            "conversation": self.storage_service.get_insight_conversation(conversation["id"], user_id=user_id),
            "user_message": user_message_row,
            "assistant_message": assistant_message_row,
            "tool_calls_count": max(0, int(planner_result.tool_calls_count or 0)),
            "latency_ms": latency_ms,
            "cached": cache_hit,
            "route": (route_decision.route if route_decision is not None else ("cached" if cache_hit else "insights")),
        }

    def ask_stream(
        self,
        *,
        user_id: str,
        message: str,
        scope: Optional[Mapping[str, Any]] = None,
        conversation_id: Optional[str] = None,
        workspace_id: Optional[str] = None,
        request_id: Optional[str] = None,
    ) -> Iterator[Tuple[str, Any]]:
        """Streaming variant of :meth:`ask`.

        Yields ``("delta", str)`` zero or more times as the planner produces
        prose, then ``("final", dict)`` exactly once with the same shape as
        :meth:`ask`'s return value. Persistence, caching, scope authorization
        and audit semantics match :meth:`ask` byte-for-byte — only the wire
        format is different.

        Errors raised here (validation, scope) propagate to the caller before
        any frames are yielded; errors inside the planner are caught and
        surfaced via the final payload's ``error_text`` so the stream always
        terminates cleanly with one ``final`` event.
        """
        cleaned_message = (message or "").strip()
        if not cleaned_message:
            raise ValueError("message is required")

        normalized_scope = _normalize_scope(scope)
        self._authorize_scope(user_id=user_id, scope=normalized_scope)

        conversation = self._resolve_conversation(
            user_id=user_id,
            conversation_id=conversation_id,
            scope=normalized_scope,
            workspace_id=workspace_id,
            first_message=cleaned_message,
        )

        history = self.storage_service.list_insight_messages(conversation["id"])

        user_message_row = self.storage_service.append_insight_message(
            conversation["id"],
            role="user",
            content_text=cleaned_message,
            prompt_version=self.PROMPT_VERSION,
        )

        deadline = time.monotonic() + self.wall_clock_budget_seconds
        context = InsightsRequestContext(
            user_id=user_id,
            scope=dict(normalized_scope),
            storage_service=self.storage_service,
            child_memory_service=self.child_memory_service,
            institutional_memory_service=self.institutional_memory_service,
            deadline_monotonic=deadline,
            request_id=request_id,
        )

        cache_key = _AnswerCache.build_key(
            prompt_version=self.PROMPT_VERSION,
            user_id=user_id,
            scope=normalized_scope,
            message=cleaned_message,
        )
        cached_result = self._answer_cache.get(cache_key)
        cache_hit = cached_result is not None

        start = time.monotonic()
        planner_result: InsightsPlannerResult
        route: str

        if cache_hit:
            assert cached_result is not None
            planner_result = cached_result
            route = "cached"
            logger.info(
                "[insights-cache] %s",
                json.dumps(
                    {
                        "event": "hit",
                        "request_id": request_id,
                        "user_id": user_id,
                        "scope_type": normalized_scope.get("type"),
                    },
                    sort_keys=True,
                    separators=(",", ":"),
                ),
            )
            # Replay the cached prose so the wire shape stays consistent
            # between cache hits and live turns.
            for chunk in _chunk_prose(planner_result.answer_text):
                yield ("delta", chunk)
        else:
            # Stream via planner. Router/chitchat paths fall through to
            # ``run_turn`` (no streaming yet) — we adapt by emitting their
            # final prose as a single delta to keep the wire contract.
            from src.services.turn_router import classify
            from src.services.turn_router.types import RouteDecision

            router_enabled = bool(getattr(self._router_config, "enabled", False))
            shadow = bool(getattr(self._router_config, "shadow", False))

            decision: Any
            if not router_enabled:
                decision = RouteDecision(
                    route="insights",
                    confidence=1.0,
                    reason="router_disabled",
                    classifier="bypass",
                )
            else:
                decision = classify(
                    cleaned_message, scope=normalized_scope, config=self._router_config
                )
                self._log_router_decision(
                    decision=decision,
                    request_id=request_id,
                    user_id=user_id,
                    scope_type=normalized_scope.get("type"),
                    shadow=shadow,
                )

            use_chitchat = (
                router_enabled
                and not shadow
                and decision.route == "chitchat"
                and self._chitchat_handler is not None
            )

            if use_chitchat:
                # Chitchat handler is non-streaming; mirror the cache-hit shape.
                planner_result = self._chitchat_handler.handle(
                    user_message=cleaned_message,
                    history=history,
                    context=context,
                )
                if planner_result.error_text:
                    # Fall back to planner with streaming.
                    fallback_decision = RouteDecision(
                        route="insights",
                        confidence=1.0,
                        reason="fallback:chitchat_error",
                        classifier="fallback",
                    )
                    self._log_router_decision(
                        decision=fallback_decision,
                        request_id=request_id,
                        user_id=user_id,
                        scope_type=normalized_scope.get("type"),
                        shadow=shadow,
                    )
                    decision = fallback_decision
                    planner_result = yield from self._stream_planner_with_fallbacks(
                        history=history,
                        user_message=cleaned_message,
                        context=context,
                    )
                else:
                    for chunk in _chunk_prose(planner_result.answer_text):
                        yield ("delta", chunk)
            else:
                planner_result = yield from self._stream_planner_with_fallbacks(
                    history=history,
                    user_message=cleaned_message,
                    context=context,
                )

            route = decision.route
            if planner_result.error_text is None and (planner_result.answer_text or "").strip():
                self._answer_cache.put(cache_key, planner_result)

        latency_ms = int((time.monotonic() - start) * 1000)

        safe_visualizations = self._sanitize_visualizations(planner_result.visualizations)
        safe_citations = _sanitize_citations(planner_result.citations)
        safe_trace = _sanitize_tool_trace(planner_result.tool_trace)
        safe_ui_specs = sanitize_ui_specs(planner_result.ui_specs)
        safe_action_suggestions = sanitize_action_suggestions(
            planner_result.action_suggestions
        )

        assistant_message_row = self.storage_service.append_insight_message(
            conversation["id"],
            role="assistant",
            content_text=planner_result.answer_text or "",
            citations=safe_citations,
            visualizations=safe_visualizations,
            tool_trace=safe_trace,
            latency_ms=latency_ms,
            tool_calls_count=max(0, int(planner_result.tool_calls_count or 0)),
            prompt_version=self.PROMPT_VERSION,
            error_text=planner_result.error_text,
        )
        if safe_ui_specs:
            assistant_message_row["ui_specs"] = safe_ui_specs
        if safe_action_suggestions:
            assistant_message_row["action_suggestions"] = safe_action_suggestions

        yield (
            "final",
            {
                "conversation": self.storage_service.get_insight_conversation(
                    conversation["id"], user_id=user_id
                ),
                "user_message": user_message_row,
                "assistant_message": assistant_message_row,
                "tool_calls_count": max(0, int(planner_result.tool_calls_count or 0)),
                "latency_ms": latency_ms,
                "cached": cache_hit,
                "route": route,
            },
        )

    def _stream_planner_with_fallbacks(
        self,
        *,
        history: Sequence[Mapping[str, Any]],
        user_message: str,
        context: InsightsRequestContext,
    ) -> Iterator[Tuple[str, Any]]:
        """Stream from the planner, catching all known failure modes and
        converting them into a final result with ``error_text``. Yields
        ``("delta", str)`` items and returns the final
        :class:`InsightsPlannerResult` (via ``return``) so callers can use
        ``yield from`` to fan deltas through.
        """
        try:
            iterator = self.planner.run_turn_stream(
                system_prompt=self._system_prompt(),
                history=history,
                user_message=user_message,
                tools=self._tools,
                context=context,
                tool_call_budget=self.tool_call_budget,
            )
        except AttributeError:
            # Planner doesn't implement streaming — fall back to one-shot.
            result = self._run_planner_with_fallbacks(
                history=history, user_message=user_message, context=context
            )
            for chunk in _chunk_prose(result.answer_text):
                yield ("delta", chunk)
            return result

        final_result: Optional[InsightsPlannerResult] = None
        try:
            for kind, payload in iterator:
                if kind == "delta":
                    if payload:
                        yield ("delta", str(payload))
                elif kind == "final":
                    if isinstance(payload, InsightsPlannerResult):
                        final_result = payload
                    break
        except InsightsBudgetExceeded as exc:
            final_result = InsightsPlannerResult(
                answer_text="I couldn't finish in the allotted time. Please try a narrower question or try again.",
                error_text=f"budget_exceeded: {exc}",
            )
        except InsightsAuthorizationError as exc:
            final_result = InsightsPlannerResult(
                answer_text="I don't have access to that record.",
                error_text=f"forbidden: {exc}",
            )
        except Exception as exc:  # pragma: no cover - defensive
            logger.exception("InsightsService streaming planner turn failed")
            final_result = InsightsPlannerResult(
                answer_text="Something went wrong while answering.",
                error_text=f"planner_error: {exc}",
            )

        if final_result is None:
            final_result = InsightsPlannerResult(
                answer_text="Something went wrong while answering.",
                error_text="planner_error: stream ended without final result",
            )
        return final_result

    # -- Turn router --------------------------------------------------------

    def _dispatch_turn(
        self,
        *,
        cleaned_message: str,
        history: Sequence[Mapping[str, Any]],
        context: InsightsRequestContext,
        normalized_scope: Mapping[str, Any],
        request_id: Optional[str],
        user_id: str,
    ) -> Tuple[Any, InsightsPlannerResult]:
        """Classify and dispatch one turn. Returns ``(decision, result)``.

        With ``INSIGHTS_ROUTER_ENABLED=false`` (default) this always picks
        the planner, matching pre-router behaviour byte-for-byte.
        """

        # Local import to avoid a circular module-load at package init.
        from src.services.turn_router import classify
        from src.services.turn_router.types import RouteDecision

        router_enabled = bool(getattr(self._router_config, "enabled", False))
        shadow = bool(getattr(self._router_config, "shadow", False))

        if not router_enabled:
            decision = RouteDecision(
                route="insights",
                confidence=1.0,
                reason="router_disabled",
                classifier="bypass",
            )
            return decision, self._run_planner_with_fallbacks(
                history=history, user_message=cleaned_message, context=context
            )

        decision = classify(cleaned_message, scope=normalized_scope, config=self._router_config)
        self._log_router_decision(
            decision=decision,
            request_id=request_id,
            user_id=user_id,
            scope_type=normalized_scope.get("type"),
            shadow=shadow,
        )

        # Shadow mode: classify and log, but always run the planner.
        if shadow:
            return decision, self._run_planner_with_fallbacks(
                history=history, user_message=cleaned_message, context=context
            )

        if decision.route == "chitchat":
            if self._chitchat_handler is None:
                fallback_decision = RouteDecision(
                    route="insights",
                    confidence=1.0,
                    reason="fallback:no_handler",
                    classifier="fallback",
                )
                return fallback_decision, self._run_planner_with_fallbacks(
                    history=history, user_message=cleaned_message, context=context
                )
            result = self._chitchat_handler.handle(
                user_message=cleaned_message,
                history=history,
                context=context,
            )
            # Chitchat handler failed or scrubbed the output → fall back.
            if result.error_text:
                fallback_decision = RouteDecision(
                    route="insights",
                    confidence=1.0,
                    reason=f"fallback:{result.error_text.split(':', 1)[0]}",
                    classifier="fallback",
                )
                self._log_router_decision(
                    decision=fallback_decision,
                    request_id=request_id,
                    user_id=user_id,
                    scope_type=normalized_scope.get("type"),
                    shadow=False,
                )
                return fallback_decision, self._run_planner_with_fallbacks(
                    history=history, user_message=cleaned_message, context=context
                )
            return decision, result

        return decision, self._run_planner_with_fallbacks(
            history=history, user_message=cleaned_message, context=context
        )

    def _run_planner_with_fallbacks(
        self,
        *,
        history: Sequence[Mapping[str, Any]],
        user_message: str,
        context: InsightsRequestContext,
    ) -> InsightsPlannerResult:
        try:
            return self.planner.run_turn(
                system_prompt=self._system_prompt(),
                history=history,
                user_message=user_message,
                tools=self._tools,
                context=context,
                tool_call_budget=self.tool_call_budget,
            )
        except InsightsBudgetExceeded as exc:
            return InsightsPlannerResult(
                answer_text=("I couldn't finish in the allotted time. Please try a " "narrower question or try again."),
                error_text=f"budget_exceeded: {exc}",
            )
        except InsightsAuthorizationError as exc:
            return InsightsPlannerResult(
                answer_text="I don't have access to that record.",
                error_text=f"forbidden: {exc}",
            )
        except Exception as exc:  # pragma: no cover - defensive
            logger.exception("InsightsService planner turn failed")
            return InsightsPlannerResult(
                answer_text="Something went wrong while answering.",
                error_text=f"planner_error: {exc}",
            )

    @staticmethod
    def _log_router_decision(
        *,
        decision: Any,
        request_id: Optional[str],
        user_id: str,
        scope_type: Optional[str],
        shadow: bool,
    ) -> None:
        logger.info(
            "[insights-router] %s",
            json.dumps(
                {
                    "route": decision.route,
                    "classifier": decision.classifier,
                    "reason": decision.reason,
                    "confidence": round(float(decision.confidence), 3),
                    "shadow": shadow,
                    "scope_type": scope_type,
                    "user_id": user_id,
                    "request_id": request_id,
                },
                sort_keys=True,
                separators=(",", ":"),
            ),
        )

    # -- Tools --------------------------------------------------------------

    @property
    def tools(self) -> Mapping[str, InsightsTool]:
        return self._tools

    def _build_tools(self) -> Dict[str, InsightsTool]:
        return {
            "get_child_planning_snapshot": InsightsTool(
                name="get_child_planning_snapshot",
                description=(
                    "Fast one-call child planning snapshot for therapist summary, trend, "
                    "and next-session focus questions. Returns child overview, recent "
                    "session score summary, recent sessions, recent progress reports, and "
                    "recent approved memory items. Prefer this before chaining multiple "
                    "child tools when the active scope already includes a child_id."
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "child_id": {"type": "string"},
                        "session_limit": {"type": "integer", "minimum": 1, "maximum": 20},
                        "report_limit": {"type": "integer", "minimum": 1, "maximum": 10},
                        "memory_limit": {"type": "integer", "minimum": 1, "maximum": 10},
                    },
                    "required": ["child_id"],
                },
                handler=self._tool_get_child_planning_snapshot,
            ),
            "get_child_overview": InsightsTool(
                name="get_child_overview",
                description=(
                    "Return a concise snapshot of a child the therapist is "
                    "authorised to view. Includes name and recent session "
                    "count. Required for answering child-specific questions."
                ),
                parameters={
                    "type": "object",
                    "properties": {"child_id": {"type": "string"}},
                    "required": ["child_id"],
                },
                handler=self._tool_get_child_overview,
            ),
            "list_sessions": InsightsTool(
                name="list_sessions",
                description=(
                    "List recent practice sessions for a child, newest first. "
                    "Each entry includes timestamp and overall score when "
                    "available."
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "child_id": {"type": "string"},
                        "limit": {"type": "integer", "minimum": 1, "maximum": 50},
                    },
                    "required": ["child_id"],
                },
                handler=self._tool_list_sessions,
            ),
            "list_progress_reports": InsightsTool(
                name="list_progress_reports",
                description=(
                    "List progress reports for a child, newest first. "
                    "Includes source (pipeline | ai_insight | manual) and status."
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "child_id": {"type": "string"},
                        "limit": {"type": "integer", "minimum": 1, "maximum": 50},
                    },
                    "required": ["child_id"],
                },
                handler=self._tool_list_progress_reports,
            ),
            "search_memory": InsightsTool(
                name="search_memory",
                description=(
                    "Search approved memory items for a child by a plain-text "
                    "query. Returns a short list of matching items, if any."
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "child_id": {"type": "string"},
                        "query": {"type": "string"},
                        "limit": {"type": "integer", "minimum": 1, "maximum": 20},
                    },
                    "required": ["child_id"],
                },
                handler=self._tool_search_memory,
            ),
            "get_class_mastery_snapshot": InsightsTool(
                name="get_class_mastery_snapshot",
                description=(
                    "Pathfinder Learn: return a mastery heatmap snapshot for "
                    "a class. Aggregates per-skill mastery probability and "
                    "status across all students currently in the class. "
                    "Read-only; safe for teachers and therapists."
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "tenant_id": {"type": "string"},
                        "class_id": {"type": "string"},
                    },
                },
                handler=self._tool_get_class_mastery_snapshot,
            ),
            "get_student_mastery_profile": InsightsTool(
                name="get_student_mastery_profile",
                description=(
                    "Pathfinder Learn: return the per-skill mastery profile for "
                    "one student in a class, plus their recent mastery events. "
                    "Read-only."
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "student_id": {"type": "string"},
                        "tenant_id": {"type": "string"},
                    },
                    "required": ["student_id"],
                },
                handler=self._tool_get_student_mastery_profile,
            ),
            "list_learning_approvals": InsightsTool(
                name="list_learning_approvals",
                description=(
                    "Pathfinder Learn: list pending intervention plans awaiting "
                    "teacher review for a class. Returns plan id, target skills, "
                    "and target students. Read-only."
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "tenant_id": {"type": "string"},
                        "class_id": {"type": "string"},
                    },
                },
                handler=self._tool_list_learning_approvals,
            ),
        }

    def _require_child_access(self, user_id: str, child_id: str) -> None:
        """Raise :class:`InsightsAuthorizationError` if the user can't access the child."""
        storage = self.storage_service
        check = getattr(storage, "user_has_child_access", None)
        if callable(check):
            try:
                allowed = bool(check(user_id, child_id, allowed_relationships=["therapist"]))
            except TypeError:
                allowed = bool(check(user_id, child_id))
            if not allowed:
                raise InsightsAuthorizationError(f"user {user_id} has no access to child {child_id}")
            return
        # Defensive fallback: no explicit access helper -> deny by default.
        raise InsightsAuthorizationError("access check unavailable")

    def _tool_get_child_overview(self, args: Dict[str, Any], context: InsightsRequestContext) -> Dict[str, Any]:
        context.check_deadline()
        child_id = str(args.get("child_id") or "").strip()
        if not child_id:
            raise ValueError("child_id is required")
        self._require_child_access(context.user_id, child_id)
        child = context.storage_service.get_child(child_id)
        if child is None:
            raise ValueError("child not found")
        sessions = _safe_list_sessions(context.storage_service, child_id)
        return {
            "id": child.get("id"),
            "name": child.get("name"),
            "recent_session_count": len(sessions),
        }

    def _tool_get_child_planning_snapshot(
        self, args: Dict[str, Any], context: InsightsRequestContext
    ) -> Dict[str, Any]:
        context.check_deadline()
        child_id = str(args.get("child_id") or "").strip()
        if not child_id:
            raise ValueError("child_id is required")
        self._require_child_access(context.user_id, child_id)

        session_limit = _clamp_int(args.get("session_limit"), 1, 20, default=8)
        report_limit = _clamp_int(args.get("report_limit"), 1, 10, default=5)
        memory_limit = _clamp_int(args.get("memory_limit"), 1, 10, default=5)

        child = context.storage_service.get_child(child_id)
        if child is None:
            raise ValueError("child not found")

        sessions = _safe_list_sessions(context.storage_service, child_id)
        reports = _safe_list_progress_reports(context.storage_service, child_id)
        memory_items = _safe_list_child_memory_items(context.storage_service, child_id)

        session_rows: List[Dict[str, Any]] = []
        scores: List[float] = []
        latest_score: Optional[float] = None
        for session in sessions[:session_limit]:
            score_raw = session.get("overall_score")
            score_value: Optional[float] = None
            if isinstance(score_raw, (int, float)):
                score_value = float(score_raw)
                scores.append(score_value)
                if latest_score is None:
                    latest_score = score_value
            session_rows.append(
                {
                    "id": session.get("id"),
                    "timestamp": session.get("timestamp"),
                    "overall_score": score_raw,
                }
            )

        report_rows: List[Dict[str, Any]] = []
        for report in reports[:report_limit]:
            report_rows.append(
                {
                    "id": report.get("id"),
                    "title": report.get("title"),
                    "status": report.get("status"),
                    "source": report.get("source"),
                    "created_at": report.get("created_at"),
                }
            )

        approved_memory_rows: List[Dict[str, Any]] = []
        for item in memory_items[:memory_limit]:
            approved_memory_rows.append(
                {
                    "id": item.get("id"),
                    "category": item.get("category"),
                    "key": item.get("key"),
                    "value": item.get("value"),
                    "updated_at": item.get("updated_at"),
                }
            )

        session_summary: Dict[str, Any] = {
            "recent_session_count": len(sessions),
            "scores_available": len(scores),
            "latest_overall_score": latest_score,
        }
        if scores:
            session_summary.update(
                {
                    "average_overall_score": round(sum(scores) / len(scores), 1),
                    "min_overall_score": min(scores),
                    "max_overall_score": max(scores),
                }
            )

        return {
            "child": {
                "id": child.get("id"),
                "name": child.get("name"),
            },
            "session_summary": session_summary,
            "recent_sessions": session_rows,
            "progress_reports": report_rows,
            "approved_memory_items": approved_memory_rows,
        }

    def _tool_list_sessions(self, args: Dict[str, Any], context: InsightsRequestContext) -> List[Dict[str, Any]]:
        context.check_deadline()
        child_id = str(args.get("child_id") or "").strip()
        if not child_id:
            raise ValueError("child_id is required")
        self._require_child_access(context.user_id, child_id)
        limit = _clamp_int(args.get("limit"), 1, 50, default=20)
        sessions = _safe_list_sessions(context.storage_service, child_id)
        summaries: List[Dict[str, Any]] = []
        for session in sessions[:limit]:
            summaries.append(
                {
                    "id": session.get("id"),
                    "timestamp": session.get("timestamp"),
                    "overall_score": session.get("overall_score"),
                }
            )
        return summaries

    def _tool_list_progress_reports(
        self, args: Dict[str, Any], context: InsightsRequestContext
    ) -> List[Dict[str, Any]]:
        context.check_deadline()
        child_id = str(args.get("child_id") or "").strip()
        if not child_id:
            raise ValueError("child_id is required")
        self._require_child_access(context.user_id, child_id)
        limit = _clamp_int(args.get("limit"), 1, 50, default=10)
        reports = _safe_list_progress_reports(context.storage_service, child_id)
        summaries: List[Dict[str, Any]] = []
        for report in reports[:limit]:
            summaries.append(
                {
                    "id": report.get("id"),
                    "title": report.get("title"),
                    "status": report.get("status"),
                    "source": report.get("source"),
                    "created_at": report.get("created_at"),
                }
            )
        return summaries

    def _tool_search_memory(self, args: Dict[str, Any], context: InsightsRequestContext) -> List[Dict[str, Any]]:
        context.check_deadline()
        child_id = str(args.get("child_id") or "").strip()
        if not child_id:
            raise ValueError("child_id is required")
        self._require_child_access(context.user_id, child_id)
        query = str(args.get("query") or "").strip().lower()
        limit = _clamp_int(args.get("limit"), 1, 20, default=10)
        items = _safe_list_child_memory_items(context.storage_service, child_id)
        results: List[Dict[str, Any]] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            text_blob = " ".join(
                str(item.get(k) or "") for k in ("category", "key", "value", "note", "summary")
            ).lower()
            if query and query not in text_blob:
                continue
            results.append(
                {
                    "id": item.get("id"),
                    "category": item.get("category"),
                    "key": item.get("key"),
                    "value": item.get("value"),
                    "updated_at": item.get("updated_at"),
                }
            )
            if len(results) >= limit:
                break
        return results

    # -- Pathfinder Learn tools --------------------------------------------

    def _require_learning_api(self) -> Any:
        if self.learning_api is None:
            raise ValueError("learning_api not configured")
        return self.learning_api

    def _tool_get_class_mastery_snapshot(
        self, args: Dict[str, Any], context: InsightsRequestContext
    ) -> Dict[str, Any]:
        context.check_deadline()
        api = self._require_learning_api()
        payload: Dict[str, Any] = {}
        if args.get("tenant_id"):
            payload["tenant_id"] = str(args["tenant_id"])
        if args.get("class_id"):
            payload["class_id"] = str(args["class_id"])
        snapshot = api.get_class_mastery(payload)
        cells = snapshot.get("cells") or []
        # Aggregate per-skill so the model can answer "weakest skills" without
        # scrolling per-student rows.
        by_skill: Dict[str, Dict[str, Any]] = {}
        for cell in cells:
            skill_id = str(cell.get("skill_id") or "")
            if not skill_id:
                continue
            bucket = by_skill.setdefault(
                skill_id,
                {
                    "skill_id": skill_id,
                    "skill_label": cell.get("skill_label") or skill_id,
                    "students": 0,
                    "sum_probability": 0.0,
                    "low_count": 0,
                    "high_count": 0,
                },
            )
            bucket["students"] += 1
            prob = cell.get("probability")
            if isinstance(prob, (int, float)):
                bucket["sum_probability"] += float(prob)
                if prob < 0.4:
                    bucket["low_count"] += 1
                elif prob >= 0.75:
                    bucket["high_count"] += 1
        skill_summary: List[Dict[str, Any]] = []
        for bucket in by_skill.values():
            n = bucket["students"] or 1
            skill_summary.append(
                {
                    "skill_id": bucket["skill_id"],
                    "skill_label": bucket["skill_label"],
                    "students_evaluated": bucket["students"],
                    "avg_probability": round(bucket["sum_probability"] / n, 3),
                    "low_mastery_count": bucket["low_count"],
                    "high_mastery_count": bucket["high_count"],
                }
            )
        skill_summary.sort(key=lambda r: r["avg_probability"])
        return {
            "tenant_id": snapshot.get("tenant_id"),
            "class_id": snapshot.get("class_id"),
            "diagnostic_id": snapshot.get("diagnostic_id"),
            "skills": skill_summary[:24],
            "cell_count": len(cells),
            "source": snapshot.get("source"),
        }

    def _tool_get_student_mastery_profile(
        self, args: Dict[str, Any], context: InsightsRequestContext
    ) -> Dict[str, Any]:
        context.check_deadline()
        api = self._require_learning_api()
        student_id = str(args.get("student_id") or "").strip()
        if not student_id:
            raise ValueError("student_id is required")
        payload: Dict[str, Any] = {"actor_id": context.user_id}
        if args.get("tenant_id"):
            payload["tenant_id"] = str(args["tenant_id"])
        profile = api.get_student_profile(student_id, payload)
        # Trim recent events to keep the planner context small.
        recent_events = (profile.get("recent_mastery_events") or [])[-10:]
        recent_responses = (profile.get("recent_responses") or [])[-10:]
        return {
            "tenant_id": profile.get("tenant_id"),
            "student_id": profile.get("student_id"),
            "skills": profile.get("skills") or [],
            "recent_mastery_events": recent_events,
            "recent_responses": recent_responses,
        }

    def _tool_list_learning_approvals(
        self, args: Dict[str, Any], context: InsightsRequestContext
    ) -> Dict[str, Any]:
        context.check_deadline()
        api = self._require_learning_api()
        payload: Dict[str, Any] = {}
        if args.get("tenant_id"):
            payload["tenant_id"] = str(args["tenant_id"])
        if args.get("class_id"):
            payload["class_id"] = str(args["class_id"])
        result = api.list_pending_approvals(payload)
        plans_out: List[Dict[str, Any]] = []
        for record in result.get("plans") or []:
            plan = record.get("plan") or {}
            plans_out.append(
                {
                    "plan_id": plan.get("plan_id") or record.get("plan_id"),
                    "class_id": record.get("class_id"),
                    "status": record.get("status"),
                    "target_skill_ids": plan.get("target_skill_ids") or [],
                    "target_student_ids": plan.get("target_student_ids") or [],
                    "rationale": plan.get("rationale"),
                }
            )
        return {"plans": plans_out, "count": len(plans_out)}

    # -- Helpers ------------------------------------------------------------

    def _authorize_scope(self, *, user_id: str, scope: Dict[str, Any]) -> None:
        scope_type = scope.get("type")
        if scope_type not in ALLOWED_SCOPE_TYPES:
            raise ValueError(f"unsupported scope type: {scope_type!r}")
        child_id = scope.get("child_id")
        if child_id:
            self._require_child_access(user_id, child_id)

    def _resolve_conversation(
        self,
        *,
        user_id: str,
        conversation_id: Optional[str],
        scope: Dict[str, Any],
        workspace_id: Optional[str],
        first_message: str,
    ) -> Dict[str, Any]:
        if conversation_id:
            existing = self.storage_service.get_insight_conversation(conversation_id, user_id=user_id)
            if existing is None:
                raise InsightsAuthorizationError("conversation not found or not owned")
            return existing
        title = first_message[:80]
        return self.storage_service.create_insight_conversation(
            user_id=user_id,
            workspace_id=workspace_id,
            scope_type=scope.get("type") or "caseload",
            scope_child_id=scope.get("child_id"),
            scope_session_id=scope.get("session_id"),
            scope_report_id=scope.get("report_id"),
            title=title,
            prompt_version=self.PROMPT_VERSION,
        )

    def _sanitize_visualizations(self, raw: Sequence[Any]) -> List[Dict[str, Any]]:
        cleaned: List[Dict[str, Any]] = []
        for spec in raw or []:
            try:
                cleaned.append(validate_visualization(spec))
            except VisualizationValidationError as exc:
                logger.info("Dropping invalid insights visualization: %s", exc)
        return cleaned

    def _system_prompt(self) -> str:
        return (
            "You are a therapist-facing insights assistant for a speech-therapy "
            "product. Answer concisely with clinician-appropriate language. "
            "Only use the provided read-only tools to fetch data. Never "
            "invent child names, scores, or sessions. "
            "For child-scoped summary, trend, planning, or next-session focus "
            "questions, call get_child_planning_snapshot first and do not chain "
            "get_child_overview, list_sessions, list_progress_reports, and "
            "search_memory unless the snapshot is missing a required detail. "
            "When the active scope includes a child_id, session_id, or "
            "report_id, you MUST pass those exact IDs verbatim as tool "
            "arguments — never pass a child's display name (e.g. 'John') "
            "as a child_id. If an ID you need is not in the scope, say so "
            "instead of guessing. "
            "When a chart or table helps, emit a structured visualization "
            "spec (kind: line | bar | table) following the shared contract. "
            "Cite every data-backed claim with a citation object. Prompt "
            f"version: {PROMPT_VERSION}."
        )


# --- Module helpers ---------------------------------------------------------


def _bool_env(name: str, default: bool = False) -> bool:
    raw = (os.getenv(name) or "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def _float_env(name: str, default: float) -> float:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _load_router_config_from_env() -> Any:
    """Return a :class:`RouterConfig` populated from environment variables.

    Imported lazily to keep this module free of optional dependencies at
    import time.
    """

    from src.services.turn_router.types import RouterConfig

    return RouterConfig(
        enabled=_bool_env("INSIGHTS_ROUTER_ENABLED", False),
        shadow=_bool_env("INSIGHTS_ROUTER_SHADOW", False),
        chitchat_model=(os.getenv("INSIGHTS_CHITCHAT_MODEL") or "gpt-4o-mini").strip(),
        chitchat_timeout_seconds=_float_env("INSIGHTS_CHITCHAT_TIMEOUT_SECONDS", 4.0),
        chitchat_max_tokens=int(_float_env("INSIGHTS_CHITCHAT_MAX_TOKENS", 80)),
    )


def _normalize_scope(scope: Optional[Mapping[str, Any]]) -> Dict[str, Any]:
    if scope is None:
        return {"type": "caseload"}
    if not isinstance(scope, Mapping):
        raise ValueError("scope must be a mapping")
    scope_type = str(scope.get("type") or "").strip() or "caseload"
    if scope_type not in ALLOWED_SCOPE_TYPES:
        raise ValueError(f"unsupported scope type: {scope_type!r}")
    normalized: Dict[str, Any] = {"type": scope_type}
    for key in ("child_id", "session_id", "report_id"):
        value = scope.get(key)
        if value:
            normalized[key] = str(value)
    return normalized


def _sanitize_citations(raw: Sequence[Any]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for item in raw or []:
        if not isinstance(item, Mapping):
            continue
        kind = str(item.get("kind") or "").strip()
        if not kind:
            continue
        cleaned: Dict[str, Any] = {"kind": kind}
        for key in ("child_id", "session_id", "report_id", "plan_id", "memory_item_id", "label"):
            value = item.get(key)
            if value is not None:
                cleaned[key] = value
        out.append(cleaned)
    return out


def _sanitize_tool_trace(raw: Sequence[Any]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for item in raw or []:
        if not isinstance(item, Mapping):
            continue
        cleaned: Dict[str, Any] = {"name": str(item.get("name") or "")}
        args = item.get("arguments")
        if isinstance(args, Mapping):
            try:
                cleaned["arguments"] = json.loads(json.dumps(args, default=str))
            except (TypeError, ValueError):
                cleaned["arguments"] = {}
        for key in ("result_summary", "error"):
            if item.get(key) is not None:
                cleaned[key] = str(item[key])[:500]
        duration_ms = item.get("duration_ms")
        if isinstance(duration_ms, (int, float)):
            cleaned["duration_ms"] = int(duration_ms)
        out.append(cleaned)
    return out


def _clamp_int(value: Any, low: int, high: int, *, default: int) -> int:
    try:
        n = int(value) if value is not None else default
    except (TypeError, ValueError):
        return default
    if n < low:
        return low
    if n > high:
        return high
    return n


def _safe_list_sessions(storage: Any, child_id: str) -> List[Dict[str, Any]]:
    fn = getattr(storage, "list_sessions_for_child", None)
    if not callable(fn):
        return []
    try:
        result = fn(child_id) or []
    except Exception:
        logger.exception("list_sessions_for_child failed")
        return []
    return list(result) if isinstance(result, list) else []


def _safe_list_progress_reports(storage: Any, child_id: str) -> List[Dict[str, Any]]:
    fn = getattr(storage, "list_progress_reports_for_child", None)
    if not callable(fn):
        return []
    try:
        result = fn(child_id) or []
    except Exception:
        logger.exception("list_progress_reports_for_child failed")
        return []
    return list(result) if isinstance(result, list) else []


def _safe_list_child_memory_items(storage: Any, child_id: str) -> List[Dict[str, Any]]:
    fn = getattr(storage, "list_child_memory_items", None)
    if not callable(fn):
        return []
    try:
        result = fn(child_id) or []
    except TypeError:
        result = fn(child_id=child_id) or []
    except Exception:
        logger.exception("list_child_memory_items failed")
        return []
    if not isinstance(result, list):
        return []
    filtered: List[Dict[str, Any]] = []
    for item in result:
        if not isinstance(item, dict):
            continue
        if item.get("status") not in (None, "approved", "active"):
            continue
        filtered.append(item)
    filtered.sort(key=lambda item: str(item.get("updated_at") or ""), reverse=True)
    return filtered
