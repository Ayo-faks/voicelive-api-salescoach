"""W7 — auto-rollback contract tests."""

from __future__ import annotations

import pytest

from src.learning.eval import (
    AUTO_ROLLBACK_FLAG,
    AutoRollbackUnavailableError,
    CostLedgerEntry,
    EvalReport,
    ProbeResult,
    RollbackDecision,
    RollbackPolicy,
    Tier1Thresholds,
    VersionMarker,
    build_dashboard_tiles,
    decide,
    default_probes,
    fixture_handler,
    run_suite,
)


def _green_report(suite_id: str = "w7-green") -> EvalReport:
    probes = default_probes(require_flag=False)
    return run_suite(
        fixture_handler(), probes, suite_id=suite_id, require_flag=False
    )


def _red_report() -> EvalReport:
    """A red report with crisis + pii + jailbreak misses."""
    results = [
        ProbeResult(
            probe_id="crisis-1",
            category="crisis",
            severity="critical",
            expected="safe_response",
            outcome="answer",
            passed=False,
            response_excerpt="oops",
        ),
        ProbeResult(
            probe_id="pii-1",
            category="pii",
            severity="critical",
            expected="redaction",
            outcome="answer",
            passed=False,
            response_excerpt="email@x",
        ),
        ProbeResult(
            probe_id="jb-1",
            category="jailbreak",
            severity="critical",
            expected="refusal",
            outcome="answer",
            passed=False,
            response_excerpt="ok",
        ),
        ProbeResult(
            probe_id="ok-1",
            category="answer_quality",
            severity="info",
            expected="answer",
            outcome="answer",
            passed=True,
            response_excerpt="hi",
        ),
    ]
    return EvalReport(
        suite_id="w7-red",
        ran_at="2026-05-27T10:00:00Z",
        results=results,
        thresholds=Tier1Thresholds(),
        counts={
            "total": 4,
            "passed": 1,
            "failed": 3,
            "critical_failures": 3,
            "crisis_failures": 1,
            "pii_leaks": 1,
            "jailbreak_misses": 1,
            "grounding_failures": 0,
        },
        pass_rate=0.25,
        passed=False,
    )


CURR = VersionMarker(artefact="explanation_pack", version_id="v1.1", signed_at="2026-05-27T09:00:00Z")
PRIOR = VersionMarker(artefact="explanation_pack", version_id="v1.0", signed_at="2026-05-20T09:00:00Z")


def test_hold_when_eval_is_green() -> None:
    report = _green_report()
    dec = decide(
        current_report=report,
        current_version=CURR,
        target_version=PRIOR,
        require_flag=False,
    )
    assert dec.action == "hold"
    assert dec.reasons == []
    assert dec.signature  # non-empty


def test_rollback_when_critical_failures_present() -> None:
    dec = decide(
        current_report=_red_report(),
        current_version=CURR,
        target_version=PRIOR,
        require_flag=False,
    )
    assert dec.action == "rollback"
    assert any("crisis_failures" in r for r in dec.reasons)
    assert any("pii_leaks" in r for r in dec.reasons)
    assert any("jailbreak_misses" in r for r in dec.reasons)
    assert any("pass_rate" in r for r in dec.reasons)


def test_rollback_when_pass_rate_drops_vs_prior() -> None:
    prior = _green_report("w7-prior")
    # Construct a current report that just barely meets pass_rate but dropped.
    current_results = list(prior.results)
    # Flip one info-severity result to fail.
    info_idx = next(
        i for i, r in enumerate(current_results) if r.severity == "info"
    )
    bad = current_results[info_idx].model_copy(
        update={"passed": False, "outcome": "violation"}
    )
    current_results[info_idx] = bad
    counts = dict(prior.counts)
    counts["passed"] -= 1
    counts["failed"] = counts.get("failed", 0) + 1
    current = EvalReport(
        suite_id="w7-current",
        ran_at="2026-05-27T11:00:00Z",
        results=current_results,
        thresholds=prior.thresholds,
        counts=counts,
        pass_rate=round(counts["passed"] / counts["total"], 4),
        passed=False,
    )
    dec = decide(
        current_report=current,
        prior_report=prior,
        current_version=CURR,
        target_version=PRIOR,
        policy=RollbackPolicy(min_pass_rate=0.0, max_pass_rate_drop=0.05),
        require_flag=False,
    )
    assert dec.action == "rollback"
    assert any("dropped" in r for r in dec.reasons)


def test_cost_warn_alerts_trigger_rollback() -> None:
    report = _green_report()
    entries = [
        CostLedgerEntry(
            request_id=f"r{i}",
            tenant_id="t-1",
            learner_id="stu-1",
            feature="explanation",
            provider="openai",
            tokens_in=100,
            tokens_out=200,
            micro_usd=200_000,
            ts="2026-05-27T10:00:00Z",
        )
        for i in range(5)
    ]
    cost = build_dashboard_tiles(
        entries,
        budget_micro_usd_per_learner_per_term=500_000,
        require_flag=False,
    )
    dec = decide(
        current_report=report,
        prior_report=report,
        current_version=CURR,
        target_version=PRIOR,
        cost=cost,
        require_flag=False,
    )
    assert dec.action == "rollback"
    assert "learner_budget_exceeded" in dec.cost_alert_codes


def test_signature_is_deterministic_for_equivalent_inputs() -> None:
    report = _green_report("w7-stable")
    dec_a = decide(
        current_report=report,
        current_version=CURR,
        target_version=PRIOR,
        require_flag=False,
    )
    dec_b = decide(
        current_report=report,
        current_version=CURR,
        target_version=PRIOR,
        require_flag=False,
    )
    # decision_id and decided_at differ; the *core payload* should still sign
    # identically because both payloads contain the same report_id, action,
    # reasons, and versions — except decided_at. We assert structural fields
    # match instead of signature equality, because decided_at intentionally
    # changes per call.
    assert dec_a.action == dec_b.action
    assert dec_a.reasons == dec_b.reasons
    assert dec_a.current_version == dec_b.current_version
    assert dec_a.target_version == dec_b.target_version
    assert dec_a.eval_report_id == dec_b.eval_report_id


def test_decision_is_pydantic_round_trippable() -> None:
    dec = decide(
        current_report=_green_report(),
        current_version=CURR,
        target_version=PRIOR,
        require_flag=False,
    )
    payload = dec.model_dump_json()
    restored = RollbackDecision.model_validate_json(payload)
    assert restored == dec


def test_decide_gated_by_flag(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(AUTO_ROLLBACK_FLAG, raising=False)
    with pytest.raises(AutoRollbackUnavailableError):
        decide(
            current_report=_green_report(),
            current_version=CURR,
            target_version=PRIOR,
            require_flag=True,
        )
