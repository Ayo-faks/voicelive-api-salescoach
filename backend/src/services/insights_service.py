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

import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Mapping, Optional, Protocol, Sequence

from src.services.visualization_service import (
    VisualizationValidationError,
    validate_visualization,
)

logger = logging.getLogger(__name__)


# --- Public constants -------------------------------------------------------

PROMPT_VERSION = "insights-v1"

DEFAULT_TOOL_CALL_BUDGET = 6
DEFAULT_WALL_CLOCK_BUDGET_SECONDS = 20.0

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
    """

    answer_text: str
    citations: List[Dict[str, Any]] = field(default_factory=list)
    visualizations: List[Dict[str, Any]] = field(default_factory=list)
    tool_trace: List[Dict[str, Any]] = field(default_factory=list)
    tool_calls_count: int = 0
    error_text: Optional[str] = None


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
    ) -> InsightsPlannerResult: ...


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
                result = tools["get_child_overview"].handler(
                    {"child_id": scope_child_id}, context
                )
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
                f"Here's what I have on {child_name}. "
                f"(Stub planner — the real LLM wiring lands in Phase 4b.)"
            )
            return InsightsPlannerResult(
                answer_text=answer_text,
                citations=citations,
                visualizations=visualizations,
                tool_trace=trace,
                tool_calls_count=tool_calls_count,
            )

        scope_summary = (
            context.scope.get("type") if isinstance(context.scope, dict) else "caseload"
        ) or "caseload"
        return InsightsPlannerResult(
            answer_text=(
                f"(Stub answer for scope '{scope_summary}'.) "
                "The real Insights planner will answer with citations and, "
                "when useful, a chart or table."
            ),
            tool_trace=trace,
            tool_calls_count=tool_calls_count,
        )


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
        tool_call_budget: int = DEFAULT_TOOL_CALL_BUDGET,
        wall_clock_budget_seconds: float = DEFAULT_WALL_CLOCK_BUDGET_SECONDS,
    ) -> None:
        self.storage_service = storage_service
        self.child_memory_service = child_memory_service
        self.institutional_memory_service = institutional_memory_service
        self.planner: InsightsPlanner = planner or StubInsightsPlanner()
        self.tool_call_budget = max(1, int(tool_call_budget))
        self.wall_clock_budget_seconds = max(1.0, float(wall_clock_budget_seconds))
        self._tools: Dict[str, InsightsTool] = self._build_tools()

    # -- Public API ---------------------------------------------------------

    def list_conversations(self, *, user_id: str, limit: int = 50) -> List[Dict[str, Any]]:
        return self.storage_service.list_insight_conversations_for_user(user_id, limit=limit)

    def get_conversation(
        self,
        *,
        user_id: str,
        conversation_id: str,
    ) -> Optional[Dict[str, Any]]:
        conversation = self.storage_service.get_insight_conversation(
            conversation_id, user_id=user_id
        )
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

        start = time.monotonic()
        error_text: Optional[str] = None
        try:
            planner_result = self.planner.run_turn(
                system_prompt=self._system_prompt(),
                history=history,
                user_message=cleaned_message,
                tools=self._tools,
                context=context,
                tool_call_budget=self.tool_call_budget,
            )
        except InsightsBudgetExceeded as exc:
            error_text = f"budget_exceeded: {exc}"
            planner_result = InsightsPlannerResult(
                answer_text=(
                    "I couldn't finish in the allotted time. Please try a "
                    "narrower question or try again."
                ),
                error_text=error_text,
            )
        except InsightsAuthorizationError as exc:
            error_text = f"forbidden: {exc}"
            planner_result = InsightsPlannerResult(
                answer_text="I don't have access to that record.",
                error_text=error_text,
            )
        except Exception as exc:  # pragma: no cover - defensive
            logger.exception("InsightsService planner turn failed")
            error_text = f"planner_error: {exc}"
            planner_result = InsightsPlannerResult(
                answer_text="Something went wrong while answering.",
                error_text=error_text,
            )

        latency_ms = int((time.monotonic() - start) * 1000)

        safe_visualizations = self._sanitize_visualizations(planner_result.visualizations)
        safe_citations = _sanitize_citations(planner_result.citations)
        safe_trace = _sanitize_tool_trace(planner_result.tool_trace)

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

        return {
            "conversation": self.storage_service.get_insight_conversation(
                conversation["id"], user_id=user_id
            ),
            "user_message": user_message_row,
            "assistant_message": assistant_message_row,
            "tool_calls_count": max(0, int(planner_result.tool_calls_count or 0)),
            "latency_ms": latency_ms,
        }

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
                raise InsightsAuthorizationError(
                    f"user {user_id} has no access to child {child_id}"
                )
            return
        # Defensive fallback: no explicit access helper -> deny by default.
        raise InsightsAuthorizationError("access check unavailable")

    def _tool_get_child_overview(
        self, args: Dict[str, Any], context: InsightsRequestContext
    ) -> Dict[str, Any]:
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

    def _tool_list_sessions(
        self, args: Dict[str, Any], context: InsightsRequestContext
    ) -> List[Dict[str, Any]]:
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

    def _tool_search_memory(
        self, args: Dict[str, Any], context: InsightsRequestContext
    ) -> List[Dict[str, Any]]:
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
            existing = self.storage_service.get_insight_conversation(
                conversation_id, user_id=user_id
            )
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

    def _sanitize_visualizations(
        self, raw: Sequence[Any]
    ) -> List[Dict[str, Any]]:
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
