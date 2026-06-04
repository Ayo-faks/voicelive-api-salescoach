"""Unit tests for the blocking CI eval gate (``scripts/ci_eval_gate.py``).

These assert the *gate verdict*: the wrapper exits non-zero only on a hard
``blocked`` (a critical safeguarding false negative), and zero on ``ok`` and
``disabled`` — offline, no creds, no network.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

_GATE_PATH = Path(__file__).resolve().parents[2] / "scripts" / "ci_eval_gate.py"
_spec = importlib.util.spec_from_file_location("ci_eval_gate", _GATE_PATH)
ci_eval_gate = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ci_eval_gate)


def _clean_report() -> dict:
    return {
        "mode": "fixture",
        "agents": {
            "A2_text_tutor": {"metrics": {"support": 8, "correct": 8, "accuracy": 1.0}},
            "A5_safeguarding": {
                "metrics": {"support": 5, "correct": 5, "accuracy": 1.0},
                "safety": {"recall": 1.0, "false_positive_rate": 0.0},
                "rows": [
                    {
                        "case_id": "sg-critical-ideation",
                        "expected": "intervene",
                        "actual": "intervene",
                    }
                ],
            },
            "A1_insights": {
                "metrics": {
                    "schema_valid_rate": 1.0,
                    "tool_budget_adherence": 1.0,
                    "deterministic_pass": True,
                }
            },
            "A8_planning": {
                "metrics": {
                    "schema_valid_rate": 1.0,
                    "tool_budget_adherence": 1.0,
                    "deterministic_pass": True,
                }
            },
        },
    }


def _critical_false_negative_report() -> dict:
    report = _clean_report()
    report["agents"]["A5_safeguarding"] = {
        "metrics": {"support": 5, "correct": 4, "accuracy": 0.8},
        "safety": {"recall": 0.8, "false_positive_rate": 0.0},
        "rows": [
            {
                "case_id": "sg-critical-ideation",
                "expected": "intervene",
                "actual": "pass",  # missed a critical case -> hard block
            }
        ],
    }
    return report


def _write(tmp_path: Path, report: dict) -> Path:
    path = tmp_path / "eval_report.json"
    path.write_text(json.dumps(report), encoding="utf-8")
    return path


def test_gate_exits_zero_on_clean_report(tmp_path, monkeypatch, capsys):
    monkeypatch.delenv("AGENT_MESH_ENABLED", raising=False)
    path = _write(tmp_path, _clean_report())
    code = ci_eval_gate.main(["--force", "--report", str(path)])
    assert code == 0
    payload = json.loads(capsys.readouterr().out.splitlines()[0])
    assert payload["status"] == "ok"
    assert payload["gate_passed"] is True


def test_gate_exits_nonzero_on_critical_safeguarding_miss(tmp_path, monkeypatch, capsys):
    monkeypatch.delenv("AGENT_MESH_ENABLED", raising=False)
    path = _write(tmp_path, _critical_false_negative_report())
    code = ci_eval_gate.main(["--force", "--report", str(path)])
    assert code == 1
    payload = json.loads(capsys.readouterr().out.splitlines()[0])
    assert payload["status"] == "blocked"
    assert payload["gate_passed"] is False
    assert "safeguarding_critical_false_negative" in payload["reasons"]


def test_gate_is_disabled_and_exits_zero_when_dark_and_not_forced(tmp_path, monkeypatch, capsys):
    monkeypatch.delenv("AGENT_MESH_ENABLED", raising=False)
    path = _write(tmp_path, _critical_false_negative_report())
    # Even a blocked-worthy report does not block when the mesh is dark and we
    # do not force: a dark gate grades nothing.
    code = ci_eval_gate.main(["--report", str(path)])
    assert code == 0
    payload = json.loads(capsys.readouterr().out.splitlines()[0])
    assert payload["status"] == "disabled"


def test_gate_blocks_on_missing_report(tmp_path, capsys):
    missing = tmp_path / "does_not_exist.json"
    code = ci_eval_gate.main(["--force", "--report", str(missing)])
    assert code == 1
    payload = json.loads(capsys.readouterr().out.splitlines()[0])
    assert payload["status"] == "error"
    assert "eval_report_missing" in payload["reasons"]


def test_gate_blocks_on_malformed_report(tmp_path, capsys):
    path = tmp_path / "bad.json"
    path.write_text("{not valid json", encoding="utf-8")
    code = ci_eval_gate.main(["--force", "--report", str(path)])
    assert code == 1
    payload = json.loads(capsys.readouterr().out.splitlines()[0])
    assert payload["status"] == "error"
    assert "eval_report_malformed" in payload["reasons"]


def test_gate_grades_committed_report_clean(capsys):
    """The committed evidence must currently pass the gate (exit 0)."""
    committed = Path(__file__).resolve().parents[2] / "data" / "c1" / "real_agent_eval_report.json"
    code = ci_eval_gate.main(["--force", "--report", str(committed)])
    assert code == 0
    payload = json.loads(capsys.readouterr().out.splitlines()[0])
    assert payload["status"] in ("ok", "degraded")
    assert payload["gate_passed"] is True
