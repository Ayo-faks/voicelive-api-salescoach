"""CI: blocking agent-eval gate over a committed eval report.

This is the *offline, credential-free* half of the agent-eval gate. It reads a
committed real-agent eval report (the JSON ``scripts/real_agent_eval.py``
produces), folds it through :func:`eval_report_to_observability_report`, prints
the resulting :class:`ObservabilityReport`, and exits with that report's CI
verdict (``exit_code`` — ``1`` only on a hard ``blocked``, e.g. a *critical*
safeguarding false negative). Everything else, including a recall/accuracy floor
breach (``degraded``), exits ``0`` but is surfaced in the printed report.

Why a committed report and not a live run:

* The live A2/A5 portion needs Azure OpenAI managed-identity creds, which CI
  does not (and should not) carry, and the terminal sandbox blocks the az
  credential cache — so a live agent would *fail-open* silently. The live run
  stays a **manual, unsandboxed** step (see ``scripts/real_agent_eval.py`` and
  ``scripts/all-agent-eval-handoff.prompt.md``). CI gates on the committed
  evidence instead: if someone commits a regressed report (a critical
  safeguarding miss), this job fails the pipeline.

Dark-awareness:

* The agent mesh is dark by default (``AGENT_MESH_ENABLED`` unset). Without
  ``--force`` the gate grades nothing and returns ``disabled`` / exit 0 — so
  wiring it into CI is inert until either the flag is set or CI passes
  ``--force`` to grade the committed evidence explicitly. A missing creds
  environment never blocks; only a hard safety block (or a missing/oversized
  report file) does.

Examples
--------
    # CI: grade the committed evidence, fail only on a hard block.
    python scripts/ci_eval_gate.py --force

    # Grade a specific report.
    python scripts/ci_eval_gate.py --force --report data/c1/real_agent_eval_report.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.agents.base import agent_mesh_enabled  # noqa: E402
from src.agents.eval_report_adapter import (  # noqa: E402
    eval_report_to_observability_report,
)
from src.agents.observability_gate import STATUS_ERROR  # noqa: E402

DEFAULT_REPORT = Path("data/c1/real_agent_eval_report.json")


def _load_report(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, dict):
        raise ValueError(f"eval report is not a JSON object: {path}")
    return data


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="blocking agent-eval CI gate")
    parser.add_argument(
        "--report",
        type=Path,
        default=DEFAULT_REPORT,
        help="committed eval report JSON to grade (default: %(default)s)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="grade the report even when AGENT_MESH_ENABLED is unset",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help="also write the ObservabilityReport JSON here",
    )
    args = parser.parse_args(argv)

    try:
        report_dict = _load_report(args.report)
    except FileNotFoundError:
        print(
            json.dumps(
                {
                    "status": STATUS_ERROR,
                    "exit_code": 1,
                    "reasons": ["eval_report_missing"],
                    "report": str(args.report),
                },
                sort_keys=True,
            )
        )
        print(f"[blocked] eval report not found: {args.report}", file=sys.stderr)
        return 1
    except (ValueError, json.JSONDecodeError) as exc:
        print(
            json.dumps(
                {
                    "status": STATUS_ERROR,
                    "exit_code": 1,
                    "reasons": ["eval_report_malformed"],
                    "report": str(args.report),
                },
                sort_keys=True,
            )
        )
        print(f"[blocked] eval report malformed: {args.report}: {exc}", file=sys.stderr)
        return 1

    obs_report = eval_report_to_observability_report(report_dict, mesh_enabled=agent_mesh_enabled(), force=args.force)
    payload = obs_report.as_dict()

    if args.out is not None:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        with args.out.open("w", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=2)
            fh.write("\n")

    print(json.dumps(payload, sort_keys=True))
    print(
        f"status={obs_report.status} gate_passed={obs_report.gate_passed} "
        f"reasons={list(obs_report.reasons)} source={args.report}",
        file=sys.stderr,
    )
    return obs_report.exit_code


if __name__ == "__main__":
    raise SystemExit(main())
