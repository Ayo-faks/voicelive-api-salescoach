"""Offline, deterministic eval harness for the planner agents (A1 + A8).

The live ``scripts/real_agent_eval.py`` drives the two *model-backed* agents
that speak the plain ``AzureOpenAI`` client (A2 text tutor, A5 safeguarding).
The remaining model-backed agents — **A1 Insights Planner** and **A8 Planning**
— run on a different runtime (the GitHub Copilot SDK + a tool registry, and a
deterministic learning stub respectively), so they need a different harness.

This module supplies that harness, and it is deliberately **offline and
deterministic**:

* **A1 — :class:`~src.services.insights_copilot_planner.CopilotInsightsPlanner`.**
  We exercise the *real* ``run_turn`` code path (real budget hook, real tool
  wrapper, real response parsing) but swap the Copilot SDK seam for a
  :class:`_FakeCopilotClient` that replays a scripted set of tool calls and a
  scripted final answer. No network, no credentials, no subprocess. This lets
  us assert on the structured :class:`InsightsPlannerResult` and, crucially,
  that the per-turn ``tool_call_budget`` is honoured (extra scripted calls are
  denied by the real pre-tool hook).

* **A8 — :class:`~src.learning.planner.StubLearningPlanner`.** This is the only
  ``LearningPlanner`` implementation in the codebase and it is already
  deterministic (zero tool calls, no cloud). We drive it over a few
  :class:`PlannerRequest` shapes and assert the returned
  :class:`PlannerResult` / :class:`InterventionPlan` is schema-valid, requires
  approval, names its offline fallback, and is byte-for-byte stable across
  repeated runs.

The public entry point is :func:`run_planner_eval`, which returns a per-agent
report dict (rows + metrics) ready to be folded into the combined real-agent
report and mapped into an ``ObservabilityReport``.
"""

from __future__ import annotations

import contextlib
from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

import src.services.insights_copilot_planner as icp
from src.services.insights_copilot_planner import CopilotInsightsPlanner
from src.services.insights_service import InsightsRequestContext, InsightsTool
from src.learning.models import InterventionPlan, Provenance
from src.learning.planner import PlannerRequest, PlannerResult, StubLearningPlanner

# Agent keys used in the combined report / observability buckets.
AGENT_A1 = "A1_insights"
AGENT_A8 = "A8_planning"


# ---------------------------------------------------------------------------
# Fake Copilot SDK seam (A1)
# ---------------------------------------------------------------------------
@dataclass
class _ToolResultStub:
    """Stand-in for ``copilot.tools.ToolResult``.

    The real planner constructs these inside its tool wrapper; we only need a
    structurally-compatible object so the wrapper does not blow up.
    """

    text_result_for_llm: str = ""
    result_type: str = "success"
    session_log: str = ""


@dataclass
class _ToolStub:
    """Stand-in for ``copilot.tools.Tool``.

    The real ``_build_sdk_tools`` constructs one per registered
    :class:`InsightsTool`, wrapping the handler. Our fake session looks these up
    by ``name`` and invokes ``handler`` to drive the registered tool.
    """

    name: str
    description: str = ""
    parameters: Dict[str, Any] = field(default_factory=dict)
    handler: Any = None
    skip_permission: bool = False


class _FakeInvocation:
    """Minimal SDK invocation object exposing ``.arguments`` (a dict)."""

    def __init__(self, arguments: Mapping[str, Any]) -> None:
        self.arguments = dict(arguments or {})


class _FakeResponseData:
    def __init__(self, content: str) -> None:
        self.content = content


class _FakeResponse:
    """Shape that ``_extract_response_text`` understands (``.data.content``)."""

    def __init__(self, content: str) -> None:
        self.data = _FakeResponseData(content)


@dataclass(frozen=True)
class _PlannedToolCall:
    name: str
    arguments: Dict[str, Any] = field(default_factory=dict)


class _FakeSession:
    """Replays scripted tool calls then returns a scripted final answer.

    Faithfully reproduces the bit of SDK behaviour the planner depends on: for
    each scripted tool call it consults the real ``on_pre_tool_use`` budget hook
    and, only when allowed, invokes the corresponding registered tool handler
    (which increments the planner's real ``call_state`` counter and appends to
    the real tool trace). This is what makes the tool-budget assertion real.
    """

    def __init__(self, kwargs: Mapping[str, Any], script: "_Script") -> None:
        self._kwargs = dict(kwargs)
        self._script = script
        self._tools = {t.name: t for t in self._kwargs.get("tools", [])}

    async def send_and_wait(self, prompt: str) -> _FakeResponse:
        del prompt
        hooks = self._kwargs.get("hooks") or {}
        pre_tool = hooks.get("on_pre_tool_use")
        for planned in self._script.tool_calls:
            if pre_tool is not None:
                decision = await pre_tool({}, {"name": planned.name})
                if (decision or {}).get("permissionDecision") != "allow":
                    continue
            tool = self._tools.get(planned.name)
            if tool is None or tool.handler is None:
                continue
            # The real wrapper is synchronous and increments call_state.
            tool.handler(_FakeInvocation(planned.arguments))
        return _FakeResponse(self._script.answer_content)

    async def disconnect(self) -> None:  # pragma: no cover - trivial
        return None


class _FakeCopilotClient:
    """Stand-in for ``copilot.CopilotClient`` bound to one scripted turn."""

    def __init__(self, script: "_Script") -> None:
        self._script = script

    async def start(self) -> None:  # pragma: no cover - trivial
        return None

    async def stop(self) -> None:  # pragma: no cover - trivial
        return None

    async def create_session(self, **kwargs: Any) -> _FakeSession:
        return _FakeSession(kwargs, self._script)


@dataclass(frozen=True)
class _Script:
    """A scripted A1 turn: which tools the 'model' calls and what it answers."""

    answer_content: str
    tool_calls: Tuple[_PlannedToolCall, ...] = ()


@contextlib.contextmanager
def _patched_copilot_sdk():
    """Temporarily install fake SDK symbols on the planner module.

    ``CopilotInsightsPlanner._validate_sdk_available`` requires the module-level
    ``CopilotClient`` / ``PermissionRequestResult`` / ``Tool`` / ``ToolResult``
    to be non-``None``; ``_build_sdk_tools`` and the tool wrapper use ``Tool`` /
    ``ToolResult`` directly. We swap them for structural fakes for the duration
    of an eval run, then restore the originals.
    """
    sentinels = {
        "CopilotClient": _FakeCopilotClient,
        "PermissionRequestResult": object,
        "Tool": _ToolStub,
        "ToolResult": _ToolResultStub,
    }
    originals = {name: getattr(icp, name) for name in sentinels}
    try:
        for name, value in sentinels.items():
            setattr(icp, name, value)
        yield
    finally:
        for name, value in originals.items():
            setattr(icp, name, value)


# ---------------------------------------------------------------------------
# A1 deterministic tool registry + cases
# ---------------------------------------------------------------------------
def _build_fake_tool_registry() -> Dict[str, InsightsTool]:
    """A small, deterministic, read-only tool registry for A1 eval turns."""

    def caseload_summary(args: Dict[str, Any], ctx: InsightsRequestContext) -> Dict[str, Any]:
        del args, ctx
        return {"students": 24, "flagged": 3, "skill": "ratio"}

    def skill_breakdown(args: Dict[str, Any], ctx: InsightsRequestContext) -> Dict[str, Any]:
        del ctx
        return {"skill_id": str(args.get("skill_id") or "ratio"), "mastery": 0.62}

    return {
        "get_caseload_summary": InsightsTool(
            name="get_caseload_summary",
            description="Summarise the caseload (deterministic fake).",
            parameters={"type": "object", "properties": {}},
            handler=caseload_summary,
        ),
        "get_skill_breakdown": InsightsTool(
            name="get_skill_breakdown",
            description="Per-skill mastery breakdown (deterministic fake).",
            parameters={
                "type": "object",
                "properties": {"skill_id": {"type": "string"}},
            },
            handler=skill_breakdown,
        ),
    }


@dataclass(frozen=True)
class _A1Case:
    case_id: str
    user_message: str
    script: _Script
    tool_call_budget: int
    expect_min_tool_calls: int
    expect_max_tool_calls: int


_A1_ANSWER = (
    '{"answer_text": "Three students are below the ratio mastery floor; '
    'reteach is recommended.", "citations": [{"source": "caseload"}]}'
)

_A1_CASES: Tuple[_A1Case, ...] = (
    # Single tool call, well within budget -> exactly one call, schema-valid.
    _A1Case(
        case_id="a1-single-tool",
        user_message="Which students are struggling with ratios?",
        script=_Script(
            answer_content=_A1_ANSWER,
            tool_calls=(_PlannedToolCall("get_caseload_summary"),),
        ),
        tool_call_budget=3,
        expect_min_tool_calls=1,
        expect_max_tool_calls=1,
    ),
    # Two tool calls within a budget of 3 -> both run.
    _A1Case(
        case_id="a1-two-tools",
        user_message="Give me a ratio breakdown and the caseload summary.",
        script=_Script(
            answer_content=_A1_ANSWER,
            tool_calls=(
                _PlannedToolCall("get_caseload_summary"),
                _PlannedToolCall("get_skill_breakdown", {"skill_id": "ratio"}),
            ),
        ),
        tool_call_budget=3,
        expect_min_tool_calls=2,
        expect_max_tool_calls=2,
    ),
    # Model tries four calls but budget is two -> hook denies the overflow.
    _A1Case(
        case_id="a1-budget-exhaustion",
        user_message="Run every diagnostic you have.",
        script=_Script(
            answer_content=_A1_ANSWER,
            tool_calls=(
                _PlannedToolCall("get_caseload_summary"),
                _PlannedToolCall("get_skill_breakdown", {"skill_id": "ratio"}),
                _PlannedToolCall("get_caseload_summary"),
                _PlannedToolCall("get_skill_breakdown", {"skill_id": "fractions"}),
            ),
        ),
        tool_call_budget=2,
        expect_min_tool_calls=2,
        expect_max_tool_calls=2,
    ),
)


def _make_context() -> InsightsRequestContext:
    return InsightsRequestContext(
        user_id="eval-therapist",
        scope={"type": "caseload"},
        storage_service=None,
        request_id="planner-eval-a1",
    )


def _run_a1_case(case: _A1Case) -> Dict[str, Any]:
    planner = CopilotInsightsPlanner({"copilot_insights_model": "gpt-5"})
    # Override the SDK client factory to hand back our scripted fake. Setting an
    # instance attribute shadows the bound method; it is called as
    # ``self._create_client()`` with no args.
    planner._create_client = lambda: _FakeCopilotClient(case.script)  # type: ignore[assignment]
    tools = _build_fake_tool_registry()
    context = _make_context()

    with _patched_copilot_sdk():
        result = planner.run_turn(
            system_prompt="You are the insights planner.",
            history=[],
            user_message=case.user_message,
            tools=tools,
            context=context,
            tool_call_budget=case.tool_call_budget,
        )

    schema_valid = (
        bool(result.answer_text)
        and result.error_text is None
        and isinstance(result.citations, list)
        and isinstance(result.tool_trace, list)
        and len(result.tool_trace) == result.tool_calls_count
    )
    budget_ok = (
        result.tool_calls_count <= case.tool_call_budget
        and case.expect_min_tool_calls <= result.tool_calls_count <= case.expect_max_tool_calls
    )
    match = schema_valid and budget_ok
    return {
        "agent": AGENT_A1,
        "case_id": case.case_id,
        "tool_call_budget": case.tool_call_budget,
        "tool_calls_count": result.tool_calls_count,
        "schema_valid": schema_valid,
        "budget_ok": budget_ok,
        "match": match,
        "excerpt": str(result.answer_text or "")[:160],
    }


# ---------------------------------------------------------------------------
# A8 deterministic cases (StubLearningPlanner)
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class _A8Case:
    case_id: str
    scope: Dict[str, Any]


_A8_CASES: Tuple[_A8Case, ...] = (
    _A8Case("a8-explicit-scope", {"skill_ids": ["ratio"], "student_ids": ["student-1"]}),
    _A8Case("a8-multi-skill", {"skill_ids": ["ratio", "fractions"], "student_ids": ["s1", "s2"]}),
    _A8Case("a8-default-scope", {}),
)


def _build_a8_request(case: _A8Case) -> PlannerRequest:
    return PlannerRequest(
        tenant_id="tenant-eval",
        actor_id="teacher-eval",
        role="teacher",
        prompt="Suggest an intervention.",
        scope=dict(case.scope),
        lang="en-NG",
        provenance=[Provenance(source="planner-eval", confidence=1.0, evidence_count=1)],
        offline=True,
    )


def _plan_signature(result: PlannerResult[InterventionPlan]) -> Tuple[Any, ...]:
    """Identity tuple that must be stable across repeated deterministic runs."""
    plan = result.plan
    return (
        tuple(plan.target_skill_ids),
        tuple(plan.target_student_ids),
        tuple(plan.item_types),
        tuple(plan.suggested_resources),
        plan.rationale,
        plan.requires_approval,
        result.tool_calls_count,
        result.offline_fallback,
    )


def _run_a8_case(case: _A8Case) -> Dict[str, Any]:
    planner = StubLearningPlanner()
    request = _build_a8_request(case)
    first = planner.run_turn(request)
    second = planner.run_turn(_build_a8_request(case))

    plan = first.plan
    schema_valid = (
        isinstance(first, PlannerResult)
        and isinstance(plan, InterventionPlan)
        and bool(plan.target_skill_ids)
        and bool(plan.target_student_ids)
        and bool(plan.item_types)
        and bool(plan.rationale)
        and plan.requires_approval is True
        and first.tool_calls_count == 0
        and bool(first.offline_fallback)
        and first.error_text is None
    )
    deterministic = _plan_signature(first) == _plan_signature(second)
    match = schema_valid and deterministic
    return {
        "agent": AGENT_A8,
        "case_id": case.case_id,
        "schema_valid": schema_valid,
        "deterministic": deterministic,
        "tool_calls_count": first.tool_calls_count,
        "offline_fallback": first.offline_fallback,
        "match": match,
    }


# ---------------------------------------------------------------------------
# Metrics + public entry point
# ---------------------------------------------------------------------------
def _rate(numerator: int, denominator: int) -> Optional[float]:
    return round(numerator / denominator, 4) if denominator else None


def _a1_metrics(rows: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    total = len(rows)
    schema_valid = sum(1 for r in rows if r["schema_valid"])
    budget_ok = sum(1 for r in rows if r["budget_ok"])
    passed = sum(1 for r in rows if r["match"])
    return {
        "support": total,
        "passed": passed,
        "schema_valid_rate": _rate(schema_valid, total),
        "tool_budget_adherence": _rate(budget_ok, total),
        "deterministic_pass": passed == total,
    }


def _a8_metrics(rows: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    total = len(rows)
    schema_valid = sum(1 for r in rows if r["schema_valid"])
    deterministic = sum(1 for r in rows if r["deterministic"])
    passed = sum(1 for r in rows if r["match"])
    return {
        "support": total,
        "passed": passed,
        "schema_valid_rate": _rate(schema_valid, total),
        "tool_budget_adherence": _rate(total, total),  # stub never calls tools
        "deterministic_pass": deterministic == total and total > 0,
    }


def run_planner_eval() -> Dict[str, Any]:
    """Run the offline A1 + A8 eval suites and return a per-agent report.

    Deterministic and network-free. Shape mirrors the live-agent buckets in
    ``scripts/real_agent_eval.py`` so the combined report stays uniform.
    """
    a1_rows = [_run_a1_case(case) for case in _A1_CASES]
    a8_rows = [_run_a8_case(case) for case in _A8_CASES]
    return {
        AGENT_A1: {
            "kind": "copilot-insights-planner",
            "harness": "fake-client/offline",
            "metrics": _a1_metrics(a1_rows),
            "rows": a1_rows,
        },
        AGENT_A8: {
            "kind": "learning-planner-stub",
            "harness": "deterministic/offline",
            "metrics": _a8_metrics(a8_rows),
            "rows": a8_rows,
        },
    }
