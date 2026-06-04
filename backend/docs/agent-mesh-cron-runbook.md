# Agent-mesh cron + labelling runbook (Track A, increment 7)

> **Status: dark scaffold.** Nothing here runs automatically. The schedule in
> [`deploy/agent-mesh-cron.yaml`](../deploy/agent-mesh-cron.yaml) ships with
> `suspend: true` and an empty `AGENT_MESH_ENABLED`. Going live is a deliberate,
> reversible operator action gated on the steps below.

## What the cron does

[`scripts/agent_mesh_cron.sh`](../scripts/agent_mesh_cron.sh) runs **one** read-only
[`ObservabilityGate.run_cycle`](../src/agents/observability_gate.py) per tick:

1. Reads durable ops metrics (`--metrics`).
2. Runs the offline safeguarding + critic probe suites (each dark behind its own
   per-suite flag).
3. Mirrors every verdict into the durable sink (`--durable-sink`) so the online
   **drift detector** ([`drift_detector.py`](../src/agents/drift_detector.py)) has
   cross-run veto-rate history.
4. Prints a dashboard-shaped JSON report and exits `0` (healthy/disabled) or `1`
   (blocked).

The cron **never** sets `AGENT_MESH_ENABLED` and **never** passes `--force`. With
the master flag unset the cycle is a no-op (`status=disabled`, exit 0). Online
actions stay shadow-only: drift is monitoring, rollback is a **proposal**, never an
execution.

## Go-live gate (human decision)

Flip live ONLY after all of the following are signed off:

- [ ] Track A increments 1–6b are green in CI.
- [ ] A durable-history volume (`agent-mesh-history` PVC) is provisioned.
- [ ] Dashboards consuming the gate JSON are wired (merge-gate verdict,
      false-positive rate, veto-rate drift, rollback proposals).
- [ ] An on-call owner is named for blocked/`drifted` signals.

Then, and only then:

1. Set the environment flags in the CronJob (`AGENT_MESH_ENABLED=1`,
   `AGENT_MESH_MEMORY_SINK_V1=1`, the per-suite probe flags, optionally
   `AGENT_MESH_DRIFT_V1`/`AGENT_MESH_ROLLBACK_V1`).
2. Set `spec.suspend: false`.

Rollback is symmetric: set `suspend: true` **or** clear `AGENT_MESH_ENABLED`. Either
alone returns the mesh to dark.

## Labelling runbook (drift + rollback triage)

When the gate reports `status=blocked` or the drift detector returns
`drifted=true`, an on-call human labels the signal — the label is the audit trail,
never an automated action.

| Signal | Source field | Label decision |
| --- | --- | --- |
| Merge-gate fail | `safeguarding`/`critic` `passed=false` | `regression` → revert offending change; `fixture-drift` → update reviewed fixtures |
| False-positive spike | `false_positive_rate > 0.10` | `over-blocking` → tune probe; `expected` → accept |
| Veto-rate drift | `drift.drifted=true`, `delta` sign | `population-shift` (monitor), `model-regression` (escalate), `noise` (under-powered → ignore) |
| Rollback proposal | `rollback.action=rollback` | Human approves/denies; the adapter only **proposes** |

Labels are recorded against the run in the dashboard/issue tracker. No label ever
triggers a deploy, rollback, or safeguarding decision automatically — the
safeguarding veto stays 100% deterministic and human-owned.

## Confirmation

The dark-by-default guarantees are pinned by
[`tests/unit/test_agent_mesh_cron.py`](../tests/unit/test_agent_mesh_cron.py):
the manifest stays `suspend: true` with an empty master flag, and the wrapper
script is a no-op (`status=disabled`, exit 0) when the flags are unset.
