"""Tests for the explanation-provenance CI lint script."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest


SCRIPT_PATH = (
    Path(__file__).resolve().parents[2]
    / ".."
    / "scripts"
    / "lint_explanations_have_provenance.py"
).resolve()


@pytest.fixture(scope="module")
def lint_module():
    spec = importlib.util.spec_from_file_location("lint_explanations", SCRIPT_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules["lint_explanations"] = module
    spec.loader.exec_module(module)
    return module


def _write(path: Path, body: str) -> Path:
    path.write_text(body, encoding="utf-8")
    return path


def test_clean_call_passes(tmp_path: Path, lint_module) -> None:
    src = _write(
        tmp_path / "ok.py",
        "from x import ExplanationResult, WikiAnchor\n"
        "ExplanationResult(\n"
        "    lang='en',\n"
        "    provenance=[{'source':'r'}],\n"
        "    explanation_version='1',\n"
        "    question_id='q1', skill_id='s1', body_markdown='b',\n"
        "    wiki_citations=[WikiAnchor(node_id='n', version='v', anchor='a')],\n"
        ")\n",
    )
    assert lint_module._scan_file(src) == []


def test_missing_kwarg_is_violation(tmp_path: Path, lint_module) -> None:
    src = _write(
        tmp_path / "missing.py",
        "ExplanationResult(question_id='q1', body_markdown='b')\n",
    )
    violations = lint_module._scan_file(src)
    assert len(violations) == 1
    assert "missing required keyword" in violations[0].message
    assert violations[0].lineno == 1


def test_empty_list_literal_is_violation(tmp_path: Path, lint_module) -> None:
    src = _write(
        tmp_path / "empty.py",
        "ExplanationResult(wiki_citations=[])\n",
    )
    violations = lint_module._scan_file(src)
    assert len(violations) == 1
    assert "empty literal forbidden" in violations[0].message


def test_attribute_form_is_detected(tmp_path: Path, lint_module) -> None:
    src = _write(
        tmp_path / "attr.py",
        "import models\nmodels.ExplanationResult(question_id='q')\n",
    )
    violations = lint_module._scan_file(src)
    assert any("missing required keyword" in v.message for v in violations)


def test_kwargs_spread_is_warning_not_fatal(tmp_path: Path, lint_module) -> None:
    src = _write(
        tmp_path / "spread.py",
        "kwargs = {}\nExplanationResult(**kwargs)\n",
    )
    violations = lint_module._scan_file(src)
    assert len(violations) == 1
    assert violations[0].message.startswith("WARN:")


def test_main_returns_nonzero_on_violation(tmp_path: Path, lint_module) -> None:
    _write(
        tmp_path / "bad.py",
        "ExplanationResult(question_id='q')\n",
    )
    code = lint_module.main([str(tmp_path)])
    assert code == 1


def test_main_returns_zero_on_clean(tmp_path: Path, lint_module) -> None:
    _write(
        tmp_path / "ok.py",
        "ExplanationResult(wiki_citations=[1])\n",
    )
    code = lint_module.main([str(tmp_path)])
    assert code == 0


def test_real_backend_src_is_clean(lint_module) -> None:
    repo_root = Path(__file__).resolve().parents[3]
    backend_src = repo_root / "backend" / "src"
    assert backend_src.exists()
    code = lint_module.main([str(backend_src)])
    assert code == 0, "production backend code must be lint-clean"
