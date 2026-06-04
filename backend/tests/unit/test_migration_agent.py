"""Phase 4 tests: MigrationAgent read-only migration-readiness reviewer."""

from __future__ import annotations

import json
from dataclasses import dataclass

import pytest

from src.agents.migration_agent import (
    CODE_DESTRUCTIVE_OP,
    CODE_NO_ROLLBACK,
    CODE_UNKNOWN_OP,
    RISK_DESTRUCTIVE,
    RISK_REVIEW,
    RISK_SAFE,
    MigrationAgent,
    MigrationFinding,
    MigrationPlan,
)


def test_additive_steps_are_safe_and_approved() -> None:
    agent = MigrationAgent()
    plan = agent.assess(
        [
            {"name": "create_users", "statement": "CREATE TABLE users (id int)"},
            {"name": "add_email", "statement": "ALTER TABLE users ADD COLUMN email text"},
        ]
    )
    assert plan.risk == RISK_SAFE
    assert plan.approved is True
    assert plan.step_count == 2
    assert all(f.risk == RISK_SAFE for f in plan.findings)


def test_destructive_step_blocks_and_flags_no_rollback() -> None:
    agent = MigrationAgent()
    plan = agent.assess([{"name": "drop_old", "statement": "DROP TABLE legacy_sessions"}])
    assert plan.risk == RISK_DESTRUCTIVE
    assert plan.approved is False
    finding = plan.findings[0]
    assert finding.is_blocking is True
    assert CODE_DESTRUCTIVE_OP in finding.codes
    assert CODE_NO_ROLLBACK in finding.codes


def test_review_step_is_not_approved() -> None:
    agent = MigrationAgent()
    plan = agent.assess([{"name": "rename_col", "statement": "ALTER TABLE t RENAME COLUMN a TO b"}])
    assert plan.risk == RISK_REVIEW
    assert plan.approved is False
    assert plan.findings[0].needs_review is True


def test_overall_risk_is_worst_of_steps() -> None:
    agent = MigrationAgent()
    plan = agent.assess(
        [
            {"name": "safe", "statement": "CREATE TABLE a (id int)"},
            {"name": "review", "statement": "UPDATE a SET id = 1"},
            {"name": "destructive", "statement": "TRUNCATE a"},
        ]
    )
    assert plan.risk == RISK_DESTRUCTIVE
    assert len(plan.destructive) == 1
    assert len(plan.needs_review) == 2  # review + destructive


def test_unknown_step_fails_closed_to_review() -> None:
    agent = MigrationAgent()
    plan = agent.assess([{"name": "mystery", "statement": "EXEC sp_do_something"}])
    assert plan.findings[0].risk == RISK_REVIEW
    assert CODE_UNKNOWN_OP in plan.findings[0].codes


def test_empty_statement_requires_review() -> None:
    agent = MigrationAgent()
    plan = agent.assess([{"name": "blank"}])
    assert plan.findings[0].risk == RISK_REVIEW
    assert CODE_UNKNOWN_OP in plan.findings[0].codes


def test_empty_step_list_is_not_approved() -> None:
    agent = MigrationAgent()
    plan = agent.assess([])
    assert plan.step_count == 0
    assert plan.approved is False  # nothing to approve, fail-closed
    assert plan.risk == RISK_SAFE


def test_destructive_with_rollback_still_blocks_by_default() -> None:
    agent = MigrationAgent()
    plan = agent.assess(
        [{"name": "drop", "statement": "DROP COLUMN secret", "rollback": True}]
    )
    assert plan.risk == RISK_DESTRUCTIVE  # dropped data isn't restored by a down-migration


def test_rollback_downgrade_kill_switch(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MIGRATION_ALLOW_ROLLBACK_DOWNGRADE", "true")
    agent = MigrationAgent()
    plan = agent.assess(
        [{"name": "drop", "statement": "DROP INDEX idx_foo", "rollback": True}]
    )
    assert plan.risk == RISK_REVIEW  # downgraded, but never auto-approved
    assert plan.approved is False


def test_accepts_objects_not_just_mappings() -> None:
    @dataclass
    class Step:
        name: str
        operation: str = ""
        statement: str = ""
        rollback: bool = False

    agent = MigrationAgent()
    plan = agent.assess([Step(name="s", statement="DELETE FROM audit")])
    assert plan.risk == RISK_DESTRUCTIVE
    assert plan.findings[0].name == "s"


def test_plan_as_dict_is_json_serialisable() -> None:
    agent = MigrationAgent()
    plan = agent.assess([{"name": "drop", "statement": "DROP TABLE t"}])
    payload = plan.as_dict()
    json.dumps(payload)
    assert payload["risk"] == RISK_DESTRUCTIVE
    assert payload["destructive_count"] == 1
    assert payload["findings"][0]["name"] == "drop"


def test_assess_never_raises_on_bad_input() -> None:
    agent = MigrationAgent()
    plan = agent.assess([None, 42, {"name": "ok", "statement": "CREATE TABLE x (id int)"}])
    assert isinstance(plan, MigrationPlan)
    assert plan.step_count == 3


def test_tool_allow_list_excludes_execution() -> None:
    agent = MigrationAgent()
    for forbidden in ("apply_migration", "run_sql", "drop_table", "migrate"):
        with pytest.raises(PermissionError):
            agent.ensure_tool_allowed(forbidden)
    agent.ensure_tool_allowed("inspect_migration_steps")
