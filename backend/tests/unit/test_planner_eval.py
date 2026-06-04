"""Unit tests for the offline planner eval harness (A1 fake-client + A8 stub).

These tests must run fully offline: no Azure credentials, no Copilot SDK, no
network. The A1 path drives the *real* ``CopilotInsightsPlanner.run_turn`` over
a fake SDK client; the A8 path drives the real ``StubLearningPlanner``.
"""

from __future__ import annotations

from src.agents.planner_eval import (
    AGENT_A1,
    AGENT_A8,
    run_planner_eval,
)


def test_run_planner_eval_all_pass_offline():
    report = run_planner_eval()
    assert set(report) == {AGENT_A1, AGENT_A8}

    a1 = report[AGENT_A1]["metrics"]
    assert a1["schema_valid_rate"] == 1.0
    assert a1["tool_budget_adherence"] == 1.0
    assert a1["deterministic_pass"] is True
    assert a1["passed"] == a1["support"]

    a8 = report[AGENT_A8]["metrics"]
    assert a8["schema_valid_rate"] == 1.0
    assert a8["deterministic_pass"] is True
    assert a8["passed"] == a8["support"]


def test_a1_rows_respect_tool_budget():
    report = run_planner_eval()
    rows = report[AGENT_A1]["rows"]
    by_case = {r["case_id"]: r for r in rows}

    # Single-tool case calls exactly one tool, well under budget.
    single = by_case["a1-single-tool"]
    assert single["tool_calls_count"] == 1
    assert single["tool_calls_count"] <= single["tool_call_budget"]
    assert single["schema_valid"] is True

    # Two-tool case calls exactly two.
    assert by_case["a1-two-tools"]["tool_calls_count"] == 2

    # Budget-exhaustion case scripts four calls but a budget of two; the real
    # pre-tool hook must deny the overflow, capping the count at the budget.
    exhausted = by_case["a1-budget-exhaustion"]
    assert exhausted["tool_call_budget"] == 2
    assert exhausted["tool_calls_count"] == 2
    assert exhausted["budget_ok"] is True


def test_a1_is_deterministic_across_runs():
    first = run_planner_eval()[AGENT_A1]["rows"]
    second = run_planner_eval()[AGENT_A1]["rows"]
    norm = lambda rows: [(r["case_id"], r["tool_calls_count"], r["match"]) for r in rows]
    assert norm(first) == norm(second)


def test_a8_rows_are_schema_valid_and_zero_tool_calls():
    report = run_planner_eval()
    for row in report[AGENT_A8]["rows"]:
        assert row["schema_valid"] is True
        assert row["deterministic"] is True
        assert row["tool_calls_count"] == 0
        assert row["offline_fallback"]
