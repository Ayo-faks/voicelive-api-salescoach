# Engineering Report — Agent Mesh Observability Gate

**Date:** 2026-06-03
**Author:** Platform / AI Systems
**Component:** `voicelive-api-salescoach` backend — `src/agents/`
**Branch:** `feat/pathfinder-learn-ownership-multichild`
**Status:** Delivered (ships dark behind `AGENT_MESH_ENABLED`)

---

## 1. Summary

We completed the agent-mesh refactor by delivering the **integration layer**
(`ObservabilityGate`) that wires the previously built read-only agents into a
single runnable cycle. The gate runs the agents together on a schedule (cron) or
in a pipeline (CI step), records every verdict into a shared in-process memory
buffer, and folds the results into one dashboard-shaped report plus a CI exit
code. The whole mesh remains **dark by default** and introduces **zero behaviour
change** until `AGENT_MESH_ENABLED` is set.

Final state: **114 tests passing**, **26 exported symbols**, no lint/compile
errors.

---

## 2. Problem Statement

Across Phases 1–4 we built nine thin, read-only "mesh" agents, each producing a
structured, non-raising verdict:

| Agent | Responsibility |
| --- | --- |
| `PlannerAgent` | 1:1 delegation to the existing planner |
| `SafeguardingAgent` | veto authority (fail-closed on unknown kinds) |
| `AIOpsAgent` | operational-health snapshot from durable metrics |
| `GenAIOpsAgent` | release eval gate (fail-closed `.blocking`) |
| `CriticAgent` | advisory quality review of planner output |
| `MeshOrchestrator` | safeguarding gate + planner composition |
| `MemoryAgent` | bounded append-only outcome recorder |
| `DevOpsAgent` | staging-only release go/no-go |
| `MigrationAgent` | schema-change risk review (never executes) |

The agents existed but were **never run together**. Their verdicts went nowhere:
no dashboard could read them, no pipeline step could fail on them. The deferred
task was to wire these read-only agents into an **observability cron / CI gate**
so their verdicts actually feed a dashboard or a pipeline decision — without
changing production behaviour and without any agent being able to take a
mutating action.

### Constraints

- **Dark by default.** No code path may run agents unless `AGENT_MESH_ENABLED`
  is set (or an explicit `force=True` for CI invocations).
- **Read-only and non-raising.** No deploys, no migrations, no mutations beyond
  the in-process memory buffer. A cron/CI step must never crash on an agent
  blow-up.
- **One exit code.** A single, unambiguous CI verdict.
- **New files only.** The working tree was dirty; edits were restricted to new
  agent files and their tests.
- **No new runtime dependency.** No agent framework added to `requirements`.

---

## 3. Solution

### 3.1 `ObservabilityGate` (`src/agents/observability_gate.py`)

A plain coordinator (deliberately *not* a `MeshAgent`) that **composes** the
existing agents rather than reimplementing any logic:

- `run_cycle(reader=, eval_handler=, target_env=, migration_steps=,
  allow_skipped_eval=, force=)` — every input is optional, so the same entry
  point serves a metrics-only cron and a full pre-deploy CI gate.
  - If the mesh is off and `force` is not set → returns `STATUS_DISABLED`,
    `exit_code == 0`, and runs **no** agents.
  - Otherwise runs only the agents whose inputs are supplied, records each
    outcome into a shared `MemoryAgent`, and aggregates.
  - The whole cycle is wrapped in `try/except` → any exception degrades to
    `STATUS_ERROR` so the cron/pipeline never crashes.
- `history(limit=, kind=)` — exposes recent recorded outcomes as dashboard-ready
  dicts.

`ObservabilityReport` (frozen dataclass) is the output contract:

| Field / property | Meaning |
| --- | --- |
| `status` | `ok` / `degraded` / `blocked` / `disabled` / `error` |
| `ops`, `eval`, `deploy`, `migration` | per-agent payloads (or `None`) |
| `reasons` | machine-readable blocking/degradation reasons |
| `recorded` | count of outcomes written to memory |
| `.gate_passed` | `status != blocked` |
| `.exit_code` | `0` if passed, else `1` |
| `.as_dict()` | JSON-serialisable dashboard payload |

**Aggregation rules.** A hard block (`exit_code == 1`) is raised only for:
`ops_health_critical`, `staging_deploy_no_go`, `non_staging_target_blocked`, or
`destructive_migration`. Non-blocking anomalies (ops warnings, a skipped/errored
eval) surface as `degraded` with `exit_code == 0`.

### 3.2 CLI (`scripts/run_observability_gate.py`)

Mirrors the established `run_eval_gate.py` pattern:
`argparse` (`--target-env`, `--metrics`, `--no-eval`, `--allow-skipped-eval`,
`--force`, `--out`), lazily constructs the durable-metrics reader and the eval
fixture handler (so it runs without Azure credentials), prints the JSON report,
optionally writes it to `--out`, and `raise SystemExit(report.exit_code)`.

### 3.3 Tests

`tests/unit/test_observability_gate.py` — 16 table-driven cases covering:
dark-by-default, `force`, flag-on, critical-ops block, warn→degraded,
disabled-reader, staging go/no-go, non-staging block, destructive-migration
block, safe-migration ok, memory recording, `history()`, JSON-serialisability,
empty cycle, and never-raises-on-bad-reader.

---

## 4. Defect Found & Fixed

**`MemoryAgent.__len__` made an empty injected buffer falsy.**

The coordinator originally initialised memory with
`self.memory = memory or MemoryAgent()`. Because `MemoryAgent` defines
`__len__`, a freshly injected (empty) buffer is falsy, so `or` silently
**discarded the caller's instance** and substituted a new one. This broke
history/recording assertions in tests.

**Fix:** use an explicit identity check —
`self.memory = memory if memory is not None else MemoryAgent()`.

**Lesson:** never use `or` for dependency-injection defaults when the injected
type implements `__len__` or `__bool__`; always use `is not None`.

---

## 5. Verification

```text
114 passed
exports: 26
get_errors: No errors found (gate module, __init__, CLI, tests)
```

CLI smoke test confirmed both modes:

- `--force --target-env staging --allow-skipped-eval` → `status=degraded`,
  `gate_passed=True`, `exit=0`, `recorded=2`.
- (no `--force`) → `status=disabled`, `recorded=0`, `exit=0`.

---

## 6. Recommendations

### 6.1 Rollout (operational)

1. **Enable in staging CI first.** Add a non-blocking pipeline step
   (`run_observability_gate.py --force --target-env staging`) that records the
   exit code but does not fail the build, to gather a baseline of `degraded` vs
   `blocked` outcomes before making it gating.
2. **Promote to a gating step** once the false-positive rate is understood.
   The gate already fails closed, so promotion is a one-line CI change.
3. **Schedule the metrics-only cron** (`--metrics`) once
   `DURABLE_METRICS_RESOURCE_ID` is configured, to populate ops-health history
   independent of deploys.

### 6.2 Observability / dashboard

4. **Persist history beyond the process.** `MemoryAgent` is intentionally
   in-process and bounded (`maxlen`), so cron history is lost on restart. For a
   real dashboard, add a thin sink that forwards each recorded outcome to a
   durable store (Log Analytics / a table) — without changing agent contracts.
5. **Emit the report as a structured artifact** (`--out`) and publish it as a CI
   artifact so the dashboard can read the latest `as_dict()` payload directly.

### 6.3 Engineering hygiene

6. **Add a lint/convention note** (or a small helper) discouraging
   `x or Default()` for DI defaults across the agents package, given the
   `__len__` footgun documented in §4.
7. **Document the flag lifecycle.** Track an explicit decision date for when
   `AGENT_MESH_ENABLED` becomes default-on, and what evidence is required.

### 6.4 Future scope (optional)

8. **Fold `CriticAgent` into the cycle** as an additional non-blocking signal
   (advisory `degraded` only) once planner results are available to the gate.
9. **Multi-target deploy matrix.** `DevOpsAgent` is staging-only by design;
   any future prod gating must go through a separate, explicitly reviewed path
   — never by widening the staging allow-list.

---

## 7. Appendix — Files Delivered

| File | Purpose |
| --- | --- |
| `backend/src/agents/observability_gate.py` | Coordinator + `ObservabilityReport` |
| `backend/scripts/run_observability_gate.py` | Cron / CI CLI entry point |
| `backend/tests/unit/test_observability_gate.py` | 16 unit tests |
| `backend/src/agents/__init__.py` | Exports (now 26 symbols) |
