"""Phase 4 tests: CriticAgent reviews planner results (read-only, advisory)."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Dict, List

import pytest

from src.agents.critic_agent import (
    CODE_EMPTY_ANSWER,
    CODE_OVERSIZED_ANSWER,
    CODE_PLANNER_ERROR,
    CODE_UNCITED_CLAIM,
    CriticAgent,
    Critique,
    SEVERITY_CRITICAL,
    SEVERITY_OK,
    SEVERITY_WARN,
)


@dataclass
class _Result:
    """Minimal stand-in for InsightsPlannerResult."""

    answer_text: str = ""
    citations: List[Dict[str, Any]] = field(default_factory=list)
    error_text: Any = None


def _codes(critique: Critique) -> set:
    return {f.code for f in critique.findings}


def test_clean_result_has_no_findings() -> None:
    agent = CriticAgent()
    critique = agent.review(
        _Result(answer_text="Here is a gentle suggestion for the session.")
    )
    assert critique.severity == SEVERITY_OK
    assert critique.clean is True
    assert critique.needs_revision is False
    assert critique.findings == ()


def test_planner_error_is_critical() -> None:
    agent = CriticAgent()
    critique = agent.review(_Result(answer_text="oops", error_text="boom"))
    assert critique.severity == SEVERITY_CRITICAL
    assert critique.needs_revision is True
    assert CODE_PLANNER_ERROR in _codes(critique)


def test_empty_answer_is_critical() -> None:
    agent = CriticAgent()
    critique = agent.review(_Result(answer_text="   "))
    assert critique.severity == SEVERITY_CRITICAL
    assert CODE_EMPTY_ANSWER in _codes(critique)


def test_uncited_claim_is_warning() -> None:
    agent = CriticAgent()
    critique = agent.review(
        _Result(answer_text="According to the data, 60% of sessions improved.")
    )
    assert critique.severity == SEVERITY_WARN
    assert critique.needs_revision is False  # warnings don't force revision
    assert CODE_UNCITED_CLAIM in _codes(critique)


def test_cited_claim_is_clean() -> None:
    agent = CriticAgent()
    critique = agent.review(
        _Result(
            answer_text="According to the data, 60% of sessions improved.",
            citations=[{"source": "session-log"}],
        )
    )
    assert critique.clean is True


def test_oversized_answer_is_warning(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CRITIC_MAX_ANSWER_CHARS", "10")
    agent = CriticAgent()
    critique = agent.review(_Result(answer_text="x" * 50))
    assert CODE_OVERSIZED_ANSWER in _codes(critique)
    assert critique.severity == SEVERITY_WARN


def test_critical_outranks_warning() -> None:
    agent = CriticAgent()
    # Empty answer (critical) — empty answers short-circuit the claim check,
    # so pair the error with a claim instead.
    critique = agent.review(
        _Result(
            answer_text="According to the data, results vary.",
            error_text="partial failure",
        )
    )
    assert critique.severity == SEVERITY_CRITICAL
    assert {CODE_PLANNER_ERROR, CODE_UNCITED_CLAIM} <= _codes(critique)


def test_review_is_defensive_against_foreign_object() -> None:
    agent = CriticAgent()

    class _Weird:
        answer_text = None  # not a str

    critique = agent.review(_Weird())
    # None answer → treated as empty → critical, but never raises.
    assert critique.severity == SEVERITY_CRITICAL


def test_as_dict_is_serialisable() -> None:
    agent = CriticAgent()
    critique = agent.review(_Result(answer_text="", error_text="x"))
    payload = critique.as_dict()
    json.dumps(payload)
    assert payload["needs_revision"] is True
    assert payload["findings"]


def test_tool_allow_list_enforced() -> None:
    agent = CriticAgent()
    with pytest.raises(PermissionError):
        agent.ensure_tool_allowed("rewrite_answer")
    agent.ensure_tool_allowed("review_result")
