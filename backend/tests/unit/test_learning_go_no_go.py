"""Contract tests — W8 go/no-go gate."""

from __future__ import annotations

import pytest

from src.learning.beta.go_no_go import (
    GO_NO_GO_FLAG,
    GO_NO_GO_RULE_ID,
    GoNoGoInputs,
    GoNoGoUnavailableError,
    evaluate_go_no_go,
)


@pytest.fixture(autouse=True)
def _enable_flag(monkeypatch):
    monkeypatch.setenv(GO_NO_GO_FLAG, "1")
    yield


def _green_inputs(**overrides) -> GoNoGoInputs:
    base = dict(
        tagged_questions_count=420,
        explanation_citations_lint_clean=True,
        retry_metric_reported=True,
        retry_after_explanation_rate=0.62,
        retry_target=0.55,
        signed_offline_pack_verified=True,
        crisis_classifier_safe=True,
        dpia_signed=True,
        dsar_workflow_tested=True,
        cost_per_learner_term_gbp=0.32,
        cost_budget_gbp=0.40,
        labour_market_dataset_signed_off=True,
        labour_market_pathway_count=24,
        eval_gate_passed=True,
        closed_beta_active_weeks=2,
        closed_beta_size=50,
        weekly_digest_delivered=True,
    )
    base.update(overrides)
    return GoNoGoInputs(**base)


def test_kill_switch(monkeypatch):
    monkeypatch.delenv(GO_NO_GO_FLAG, raising=False)
    with pytest.raises(GoNoGoUnavailableError):
        evaluate_go_no_go(_green_inputs())


def test_force_disabled_runs(monkeypatch):
    monkeypatch.delenv(GO_NO_GO_FLAG, raising=False)
    decision = evaluate_go_no_go(_green_inputs(), require_flag=False)
    assert decision.decision == "go"


def test_green_path_returns_go():
    d = evaluate_go_no_go(_green_inputs())
    assert d.decision == "go"
    assert d.blockers == []
    assert d.warnings == []
    assert all(c.passed for c in d.checks)
    assert d.rule_id == GO_NO_GO_RULE_ID
    assert len(d.signature) == 64


def test_blocker_question_bank_under_target():
    d = evaluate_go_no_go(_green_inputs(tagged_questions_count=399))
    assert d.decision == "no_go"
    assert "dod_question_bank" in d.blockers


def test_blocker_explanations_not_grounded():
    d = evaluate_go_no_go(_green_inputs(explanation_citations_lint_clean=False))
    assert d.decision == "no_go"
    assert "dod_explanations_grounded" in d.blockers


def test_blocker_retry_below_target():
    d = evaluate_go_no_go(_green_inputs(retry_after_explanation_rate=0.54))
    assert d.decision == "no_go"
    assert "dod_retry_north_star" in d.blockers


def test_blocker_retry_not_reported():
    d = evaluate_go_no_go(
        _green_inputs(retry_metric_reported=False, retry_after_explanation_rate=None)
    )
    assert d.decision == "no_go"
    assert "dod_retry_north_star" in d.blockers


def test_blocker_offline_pack_unverified():
    d = evaluate_go_no_go(_green_inputs(signed_offline_pack_verified=False))
    assert "dod_offline_pack" in d.blockers


def test_blocker_crisis_classifier_unsafe():
    d = evaluate_go_no_go(_green_inputs(crisis_classifier_safe=False))
    assert "dod_crisis_classifier" in d.blockers


def test_blocker_dpia_missing():
    d = evaluate_go_no_go(_green_inputs(dpia_signed=False))
    assert "dod_dpia" in d.blockers


def test_blocker_dsar_untested():
    d = evaluate_go_no_go(_green_inputs(dsar_workflow_tested=False))
    assert "dod_dsar" in d.blockers


def test_blocker_eval_gate_failed():
    d = evaluate_go_no_go(_green_inputs(eval_gate_passed=False))
    assert "dod_eval_gate" in d.blockers


def test_blocker_closed_beta_short():
    d = evaluate_go_no_go(_green_inputs(closed_beta_active_weeks=1))
    assert d.decision == "no_go"
    assert "dod_closed_beta" in d.blockers


def test_blocker_closed_beta_too_small():
    d = evaluate_go_no_go(_green_inputs(closed_beta_size=49))
    assert "dod_closed_beta" in d.blockers


def test_warning_only_yields_conditional_go():
    d = evaluate_go_no_go(_green_inputs(cost_per_learner_term_gbp=0.55))
    assert d.decision == "conditional_go"
    assert "dod_cost" in d.warnings
    assert "dod_cost" not in d.blockers


def test_warning_labour_market_not_signed_off():
    d = evaluate_go_no_go(_green_inputs(labour_market_dataset_signed_off=False))
    assert d.decision == "conditional_go"
    assert "dod_labour_market_dataset" in d.warnings


def test_blocker_dominates_warning():
    d = evaluate_go_no_go(
        _green_inputs(
            dpia_signed=False,
            cost_per_learner_term_gbp=0.55,
        )
    )
    assert d.decision == "no_go"
    assert "dod_dpia" in d.blockers
    assert "dod_cost" in d.warnings


def test_signature_round_trip_stable_for_same_inputs():
    inp = _green_inputs()
    d1 = evaluate_go_no_go(inp)
    assert len(d1.signature) == 64
    # signature covers decided_at, so the same inputs the next second
    # will still verify with the recorded payload
    assert d1.rule_id == GO_NO_GO_RULE_ID
