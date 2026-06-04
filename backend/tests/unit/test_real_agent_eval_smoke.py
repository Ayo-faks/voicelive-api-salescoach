"""Smoke test: the real-agent eval script imports cleanly and wires the adapter.

Importing the script must not require Azure credentials or the Copilot SDK — it
only triggers ``main()`` under ``__main__``. This guards against import-time
regressions (bad imports, syntax errors) in the live eval entry point and
confirms the offline planner harness + adapter are reachable from it.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

_SCRIPT = (
    Path(__file__).resolve().parents[2] / "scripts" / "real_agent_eval.py"
)


def test_real_agent_eval_script_imports():
    assert _SCRIPT.is_file()
    name = "real_agent_eval_under_test"
    spec = importlib.util.spec_from_file_location(name, _SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    # Register before exec so dataclass field resolution (which looks the module
    # up in sys.modules via cls.__module__) works during import.
    sys.modules[name] = module
    try:
        spec.loader.exec_module(module)  # must not run main()
    finally:
        sys.modules.pop(name, None)

    # The script must expose main() and the wired-in helpers.
    assert callable(module.main)
    assert callable(module.run_planner_eval)
    assert callable(module.eval_report_to_observability_report)


def test_adapter_and_harness_are_importable_as_modules():
    from src.agents.eval_report_adapter import eval_report_to_observability_report
    from src.agents.planner_eval import run_planner_eval

    assert callable(eval_report_to_observability_report)
    assert callable(run_planner_eval)
