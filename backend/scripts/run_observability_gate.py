"""CLI: run one agent-mesh observability cycle (cron / CI gate).

Runs the read-only mesh agents (AIOps ops-health, GenAIOps eval gate, DevOps
staging go/no-go, Migration risk), records every verdict into the mesh memory
buffer, prints a single dashboard-shaped JSON report, and exits ``0``/``1`` for
CI.

The gate is **dark by default**: with ``AGENT_MESH_ENABLED`` unset and without
``--force`` it runs no agents and exits 0. Pass ``--force`` to run it in CI
without flipping the process-wide flag.

Examples
--------
    # CI pre-deploy gate against the deterministic fixture handler:
    python scripts/run_observability_gate.py --force --target-env staging \
        --out artifacts/observability.json

    # Metrics-only cron (reads durable metrics from Azure Monitor when
    # DURABLE_METRICS_RESOURCE_ID is set):
    python scripts/run_observability_gate.py --force --metrics
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.agents.observability_gate import ObservabilityGate  # noqa: E402


def _build_eval_handler():
    """Return the deterministic eval fixture handler, or ``None`` if absent."""
    try:
        from src.learning.eval import fixture_handler
    except Exception:  # pragma: no cover - eval harness optional
        return None
    return fixture_handler()


def _build_safeguarding_handler():
    """Return the offline safeguarding probe handler, or ``None`` if absent."""
    try:
        from src.learning.eval import safeguarding_fixture_handler
    except Exception:  # pragma: no cover - eval harness optional
        return None
    return safeguarding_fixture_handler()


def _build_critic_handler():
    """Return the offline critic quality probe handler, or ``None`` if absent."""
    try:
        from src.learning.eval import critic_fixture_handler
    except Exception:  # pragma: no cover - eval harness optional
        return None
    return critic_fixture_handler()


def _build_reader():
    """Return a DurableMetricsReader, or ``None`` if observability is off."""
    try:
        from src.learning.observability_kql import DurableMetricsReader
    except Exception:  # pragma: no cover - observability optional
        return None
    return DurableMetricsReader()


def _build_durable_sink(path):
    """Return a durable sink, or ``None`` when its kill-switch is unset.

    With ``--durable-sink PATH`` a cross-process JSONL sink is built; passing the
    sentinel ``-`` selects the process-local in-memory sink. Stays dark behind
    its own ``AGENT_MESH_MEMORY_SINK_V1`` flag — like the per-suite probe flags,
    ``--force`` does *not* bypass it.
    """
    try:
        from src.agents.durable_sink import build_durable_sink
    except Exception:  # pragma: no cover - sink optional
        return None
    sink_path = None if path in (None, "-") else path
    return build_durable_sink(sink_path)


def main() -> int:
    parser = argparse.ArgumentParser(description="agent-mesh observability gate")
    parser.add_argument(
        "--target-env",
        default=None,
        help="staging environment to evaluate a deploy go/no-go for",
    )
    parser.add_argument(
        "--metrics",
        action="store_true",
        help="read durable ops metrics (needs DURABLE_METRICS_RESOURCE_ID)",
    )
    parser.add_argument(
        "--no-eval",
        action="store_true",
        help="skip the GenAIOps eval gate",
    )
    parser.add_argument(
        "--safeguarding",
        action="store_true",
        help="run the offline safeguarding probe suite (dark unless "
        "LEARNING_SAFEGUARDING_PROBES_V1 is set)",
    )
    parser.add_argument(
        "--critic",
        action="store_true",
        help="run the offline critic quality probe suite (dark unless "
        "LEARNING_CRITIC_PROBES_V1 is set)",
    )
    parser.add_argument(
        "--allow-skipped-eval",
        action="store_true",
        help="a skipped eval gate does not block the staging decision",
    )
    parser.add_argument(
        "--durable-sink",
        nargs="?",
        const="-",
        default=None,
        metavar="PATH",
        help="mirror every verdict into a durable sink (JSONL at PATH, or "
        "in-memory if no PATH); dark unless AGENT_MESH_MEMORY_SINK_V1 is set",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="run even when AGENT_MESH_ENABLED is unset",
    )
    parser.add_argument("--out", type=Path, default=None, help="write JSON report here")
    args = parser.parse_args()

    gate = ObservabilityGate()
    report = gate.run_cycle(
        reader=_build_reader() if args.metrics else None,
        eval_handler=None if args.no_eval else _build_eval_handler(),
        safeguarding_handler=_build_safeguarding_handler() if args.safeguarding else None,
        critic_handler=_build_critic_handler() if args.critic else None,
        target_env=args.target_env,
        allow_skipped_eval=args.allow_skipped_eval,
        durable_sink=(
            _build_durable_sink(args.durable_sink)
            if args.durable_sink is not None
            else None
        ),
        force=args.force,
    )

    payload = report.as_dict()
    if args.out is not None:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        with args.out.open("w", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=2)
            fh.write("\n")
        print(f"[ok] wrote report -> {args.out}", file=sys.stderr)

    print(json.dumps(payload, sort_keys=True))
    print(
        f"status={report.status} gate_passed={report.gate_passed} "
        f"recorded={report.recorded} reasons={list(report.reasons)}",
        file=sys.stderr,
    )
    return report.exit_code


if __name__ == "__main__":
    raise SystemExit(main())
