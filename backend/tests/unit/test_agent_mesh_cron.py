"""Dark-by-default proof for the agent-mesh cron scaffold (Track A, increment 7).

The cron is a documented scaffold. These tests pin the two independent dark
gates: the k8s manifest ships ``suspend: true`` with an empty master flag, and
the wrapper script is a no-op (``status=disabled``, exit 0) when the flags are
unset.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[2]
CRON_SCRIPT = BACKEND / "scripts" / "agent_mesh_cron.sh"
CRON_MANIFEST = BACKEND / "deploy" / "agent-mesh-cron.yaml"


def test_manifest_exists_and_is_suspended():
    text = CRON_MANIFEST.read_text(encoding="utf-8")
    assert "kind: CronJob" in text
    assert "suspend: true" in text
    # Master flag ships empty (dark).
    assert 'name: AGENT_MESH_ENABLED' in text
    assert "--force" not in text  # cron must never bypass the master flag


def test_wrapper_script_exists():
    assert CRON_SCRIPT.exists()
    text = CRON_SCRIPT.read_text(encoding="utf-8")
    assert "--force" not in text
    assert "run_observability_gate.py" in text


def _run_cron(env_overrides, sink_path):
    env = {k: v for k, v in os.environ.items() if not k.startswith("AGENT_MESH")}
    env.update(env_overrides)
    env.setdefault("PYTHON_BIN", sys.executable)
    return subprocess.run(
        ["bash", str(CRON_SCRIPT), sink_path],
        capture_output=True,
        text=True,
        env=env,
        timeout=120,
    )


def test_cron_is_noop_when_master_flag_unset(tmp_path):
    sink = tmp_path / "history.jsonl"
    proc = _run_cron({}, str(sink))
    assert proc.returncode == 0, proc.stderr
    assert '"status": "disabled"' in proc.stdout
    # Dark: no history written.
    assert not sink.exists() or sink.stat().st_size == 0


def test_cron_runs_when_master_flag_set(tmp_path):
    sink = tmp_path / "history.jsonl"
    proc = _run_cron(
        {
            "AGENT_MESH_ENABLED": "1",
            "AGENT_MESH_MEMORY_SINK_V1": "1",
            "LEARNING_SAFEGUARDING_PROBES_V1": "1",
            "LEARNING_CRITIC_PROBES_V1": "1",
        },
        str(sink),
    )
    assert proc.returncode == 0, proc.stderr
    assert '"status": "disabled"' not in proc.stdout
    # Sink received cross-run history for the drift detector.
    assert sink.exists() and sink.stat().st_size > 0
