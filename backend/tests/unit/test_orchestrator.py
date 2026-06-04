"""Phase 4 tests: MeshOrchestrator gates a planner turn with safeguarding."""

from __future__ import annotations

import json
from typing import Any, Dict, List

import pytest

from src.agents.orchestrator import (
    MeshOrchestrator,
    OrchestratedTurn,
    STATUS_ALLOWED,
    STATUS_BLOCKED,
)
from src.agents.safeguarding_agent import SafeguardingVerdict


class _RecordingPlanner:
    """Stand-in InsightsPlanner: records the turn and returns a sentinel."""

    def __init__(self) -> None:
        self.calls: List[Dict[str, Any]] = []
        self.sentinel = object()

    def run_turn(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        return self.sentinel


class _ExplodingPlanner:
    def run_turn(self, **kwargs: Any) -> Any:
        raise RuntimeError("planner blew up")


class _FakeSafeguarding:
    """Returns a pre-programmed verdict per action ``kind``."""

    def __init__(self, verdicts: Dict[str, SafeguardingVerdict]) -> None:
        self._verdicts = verdicts
        self.assessed: List[str] = []

    def assess(self, action: Any) -> SafeguardingVerdict:
        kind = str(action.get("kind") or "")
        self.assessed.append(kind)
        return self._verdicts.get(kind, SafeguardingVerdict.allow())


_TURN_KWARGS = dict(
    system_prompt="sys",
    history=[],
    user_message="hi",
    tools={},
    context=None,
    tool_call_budget=4,
)


def test_all_checks_allow_delegates_to_planner() -> None:
    planner = _RecordingPlanner()
    safeguarding = _FakeSafeguarding({"child_access": SafeguardingVerdict.allow()})
    orch = MeshOrchestrator(planner=planner, safeguarding=safeguarding)

    turn = orch.run_turn(
        preflight_actions=[{"kind": "child_access"}],
        **_TURN_KWARGS,
    )

    assert turn.status == STATUS_ALLOWED
    assert turn.allowed is True
    assert turn.result is planner.sentinel
    assert len(planner.calls) == 1
    assert turn.checks_run == 1


def test_veto_blocks_and_planner_not_called() -> None:
    planner = _RecordingPlanner()
    safeguarding = _FakeSafeguarding(
        {"child_access": SafeguardingVerdict.veto("child_access_denied")}
    )
    orch = MeshOrchestrator(planner=planner, safeguarding=safeguarding)

    turn = orch.run_turn(
        preflight_actions=[{"kind": "child_access"}],
        **_TURN_KWARGS,
    )

    assert turn.status == STATUS_BLOCKED
    assert turn.blocked is True
    assert turn.result is None
    assert turn.verdict is not None and turn.verdict.reason == "child_access_denied"
    assert planner.calls == []  # planner never invoked


def test_first_veto_short_circuits_remaining_checks() -> None:
    planner = _RecordingPlanner()
    safeguarding = _FakeSafeguarding(
        {
            "child_access": SafeguardingVerdict.veto("child_access_denied"),
            "data_consent": SafeguardingVerdict.veto("missing_consent"),
        }
    )
    orch = MeshOrchestrator(planner=planner, safeguarding=safeguarding)

    turn = orch.run_turn(
        preflight_actions=[{"kind": "child_access"}, {"kind": "data_consent"}],
        **_TURN_KWARGS,
    )

    assert turn.verdict.reason == "child_access_denied"
    assert safeguarding.assessed == ["child_access"]  # stopped at first veto


def test_no_preflight_actions_allows_turn() -> None:
    planner = _RecordingPlanner()
    safeguarding = _FakeSafeguarding({})
    orch = MeshOrchestrator(planner=planner, safeguarding=safeguarding)

    turn = orch.run_turn(**_TURN_KWARGS)

    assert turn.status == STATUS_ALLOWED
    assert turn.checks_run == 0
    assert len(planner.calls) == 1


def test_planner_exception_propagates_unchanged() -> None:
    safeguarding = _FakeSafeguarding({})
    orch = MeshOrchestrator(planner=_ExplodingPlanner(), safeguarding=safeguarding)

    with pytest.raises(RuntimeError, match="planner blew up"):
        orch.run_turn(**_TURN_KWARGS)


def test_preflight_returns_first_veto_or_none() -> None:
    safeguarding = _FakeSafeguarding(
        {"session_caps": SafeguardingVerdict.veto("session_cap_reached")}
    )
    orch = MeshOrchestrator(planner=_RecordingPlanner(), safeguarding=safeguarding)

    assert orch.preflight([{"kind": "child_access"}]) is None
    veto = orch.preflight([{"kind": "session_caps"}])
    assert veto is not None and veto.reason == "session_cap_reached"


def test_as_dict_is_serialisable_for_both_outcomes() -> None:
    planner = _RecordingPlanner()
    allow_orch = MeshOrchestrator(
        planner=planner, safeguarding=_FakeSafeguarding({})
    )
    allowed = allow_orch.run_turn(**_TURN_KWARGS)
    json.dumps(allowed.as_dict())
    assert allowed.as_dict()["allowed"] is True

    block_orch = MeshOrchestrator(
        planner=planner,
        safeguarding=_FakeSafeguarding(
            {"child_access": SafeguardingVerdict.veto("child_access_denied")}
        ),
    )
    blocked = block_orch.run_turn(
        preflight_actions=[{"kind": "child_access"}], **_TURN_KWARGS
    )
    payload = blocked.as_dict()
    json.dumps(payload)
    assert payload["blocked"] is True
    assert payload["verdict"]["reason"] == "child_access_denied"


def test_tool_allow_list_enforced() -> None:
    orch = MeshOrchestrator(
        planner=_RecordingPlanner(), safeguarding=_FakeSafeguarding({})
    )
    with pytest.raises(PermissionError):
        orch.ensure_tool_allowed("delete_everything")
    orch.ensure_tool_allowed("safeguarding_assess")
    orch.ensure_tool_allowed("planner_run_turn")
