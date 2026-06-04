"""Unit tests for the eval-report -> ObservabilityReport adapter."""

from __future__ import annotations

from src.agents.eval_report_adapter import (
    REASON_PLANNER_EVAL,
    REASON_SAFEGUARDING_CRITICAL_FN,
    REASON_SAFEGUARDING_RECALL,
    REASON_TUTOR_ACCURACY,
    eval_report_to_observability_report,
)
from src.agents.observability_gate import (
    STATUS_BLOCKED,
    STATUS_DEGRADED,
    STATUS_DISABLED,
    STATUS_OK,
)


def _clean_report():
    return {
        "agents": {
            "A2_text_tutor": {"metrics": {"support": 8, "correct": 8, "accuracy": 1.0}},
            "A5_safeguarding": {
                "metrics": {"support": 5, "correct": 5, "accuracy": 1.0},
                "safety": {"recall": 1.0, "false_positive_rate": 0.0},
                "rows": [
                    {"case_id": "sg-critical-ideation", "expected": "intervene", "actual": "intervene"},
                    {"case_id": "sg-low-banter", "expected": "pass", "actual": "pass"},
                ],
            },
            "A1_insights": {
                "kind": "copilot-insights-planner",
                "harness": "fake-client/offline",
                "metrics": {
                    "support": 3,
                    "passed": 3,
                    "schema_valid_rate": 1.0,
                    "tool_budget_adherence": 1.0,
                    "deterministic_pass": True,
                },
            },
            "A8_planning": {
                "kind": "learning-planner-stub",
                "harness": "deterministic/offline",
                "metrics": {
                    "support": 3,
                    "passed": 3,
                    "schema_valid_rate": 1.0,
                    "tool_budget_adherence": 1.0,
                    "deterministic_pass": True,
                },
            },
        }
    }


def test_clean_report_is_ok_exit_zero():
    report = eval_report_to_observability_report(_clean_report(), mesh_enabled=True)
    assert report.status == STATUS_OK
    assert report.gate_passed is True
    assert report.exit_code == 0
    assert report.reasons == ()


def test_dark_mesh_without_force_is_disabled():
    report = eval_report_to_observability_report(_clean_report(), mesh_enabled=False)
    assert report.status == STATUS_DISABLED
    assert report.exit_code == 0


def test_dark_mesh_with_force_still_grades():
    report = eval_report_to_observability_report(
        _clean_report(), mesh_enabled=False, force=True
    )
    assert report.status == STATUS_OK


def test_safeguarding_recall_miss_degrades():
    data = _clean_report()
    data["agents"]["A5_safeguarding"]["safety"]["recall"] = 0.8
    report = eval_report_to_observability_report(data, mesh_enabled=True)
    assert report.status == STATUS_DEGRADED
    assert REASON_SAFEGUARDING_RECALL in report.reasons
    assert report.exit_code == 0


def test_critical_false_negative_blocks():
    data = _clean_report()
    data["agents"]["A5_safeguarding"]["safety"]["recall"] = 0.8
    data["agents"]["A5_safeguarding"]["rows"] = [
        {"case_id": "sg-critical-ideation", "expected": "intervene", "actual": "pass"},
    ]
    report = eval_report_to_observability_report(data, mesh_enabled=True)
    assert report.status == STATUS_BLOCKED
    assert REASON_SAFEGUARDING_CRITICAL_FN in report.reasons
    assert report.gate_passed is False
    assert report.exit_code == 1


def test_tutor_accuracy_below_floor_degrades():
    data = _clean_report()
    data["agents"]["A2_text_tutor"]["metrics"]["accuracy"] = 0.5
    report = eval_report_to_observability_report(data, mesh_enabled=True)
    assert report.status == STATUS_DEGRADED
    assert REASON_TUTOR_ACCURACY in report.reasons


def test_planner_schema_failure_degrades():
    data = _clean_report()
    data["agents"]["A1_insights"]["metrics"]["schema_valid_rate"] = 0.5
    report = eval_report_to_observability_report(data, mesh_enabled=True)
    assert report.status == STATUS_DEGRADED
    assert REASON_PLANNER_EVAL in report.reasons
    assert report.planners["A1_insights"]["passed"] is False


def test_planner_budget_violation_degrades():
    data = _clean_report()
    data["agents"]["A8_planning"]["metrics"]["deterministic_pass"] = False
    report = eval_report_to_observability_report(data, mesh_enabled=True)
    assert report.status == STATUS_DEGRADED
    assert REASON_PLANNER_EVAL in report.reasons


def test_as_dict_carries_existing_keys_and_planners_bucket():
    report = eval_report_to_observability_report(_clean_report(), mesh_enabled=True)
    payload = report.as_dict()
    for key in (
        "status",
        "healthy",
        "gate_passed",
        "exit_code",
        "reasons",
        "recorded",
        "ops",
        "eval",
        "safeguarding",
        "critic",
        "deploy",
        "migration",
        "planners",
    ):
        assert key in payload
    assert payload["eval"]["accuracy"] == 1.0
    assert payload["safeguarding"]["recall"] == 1.0
    assert set(payload["planners"]) >= {"A1_insights", "A8_planning", "passed"}
