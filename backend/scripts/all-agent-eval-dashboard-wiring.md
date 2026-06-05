# Wiring all-agent eval results into the observability dashboard

## Problem statement

The all-agent eval harness (`scripts/real_agent_eval.py`) already grades every
mesh agent — A2 (text tutor), A5 (safeguarding), A1 (insights planner), A8
(planning) — and maps the combined result into an `ObservabilityReport`. But
that report was **only** a CI/CLI artifact:

- a printed `OBSERVABILITY_REPORT { ... }` line, and
- a JSON file at `data/c1/real_agent_eval_report.json`.

Nothing rendered those per-agent eval verdicts in the **browser** observability
dashboard (`GET /api/learning/observability/dashboard`). The dashboard's
`agent-mesh` section showed live production-state tiles (merge-gate, veto rate,
veto drift, rollback proposals) but had no "did this agent version pass its
offline suite" signal.

**Goal:** surface tutor accuracy / safeguarding recall / planner pass on the
dashboard, reusing the existing `agent-mesh` section, without conflating offline
eval verdicts with live production counters.

## Key constraints honoured

1. **Eval tiles ≠ live tiles.** Live tiles answer "what is production doing
   now" (in-process Prometheus/OTel counters). Eval tiles answer "did this agent
   version pass its test suite". These stay distinct — eval results are badged
   `source: kql`, never pushed into the live counters.
2. **Safeguarding recall is its own tile.** The existing `mesh-veto-rate` tile
   is the live *false-positive*-adjacent signal. A5 eval recall is the offline
   *false-negative* signal (did we miss a real intervention). They must not be
   overloaded onto one tile.
3. **The eval script stays a pure producer.** A local run must not default to
   writing `/var/lib/agent-mesh/` (permission/no-op risk). The durable write is
   opt-in behind `AGENT_MESH_MEMORY_SINK_V1`.
4. **Telemetry must never break a run or 500 the dashboard.** All new read/write
   paths are non-raising.

## How it was resolved

### 1. Durable-sink recorder (`src/agents/eval_report_adapter.py`)

Added `record_eval_observability_report(report, *, history_path=None)`:

- No-ops unless `AGENT_MESH_MEMORY_SINK_V1` is truthy (`durable_sink_enabled()`).
- Resolves the path from `history_path` → `AGENT_MESH_HISTORY_PATH` →
  `DEFAULT_HISTORY_PATH` (`/var/lib/agent-mesh/history.jsonl`, same default the
  dashboard reads).
- Appends a record of `kind="agent_eval"` (`EVAL_HISTORY_KIND`) carrying the full
  `ObservabilityReport.as_dict()` (so tutor accuracy, safeguarding recall, and
  planner pass all travel together).
- Wrapped in `try/except` → returns `True` only when a record was written.

### 2. Eval-script wiring (`scripts/real_agent_eval.py`)

After printing `OBSERVABILITY_REPORT`, the script now calls the recorder and
prints `OBSERVABILITY_REPORT_RECORDED` only when a record was actually written.
The script remains a pure producer when the flag is unset.

### 3. New dashboard tiles (`src/learning/api.py`)

`_agent_mesh_section()` now also reads `kind="agent_eval"` from the durable
history and appends three net-new tiles, built by a new `_agent_eval_tiles()`
helper from the latest `agent_eval` payload:

| Tile id | Label | Source | Status logic |
| --- | --- | --- | --- |
| `mesh-tutor-accuracy` | Tutor answer accuracy (A2) | `kql`/`nodata` | `crit` below the 85% floor, else `ok` |
| `mesh-safeguarding-recall` | Safeguarding recall (A5) | `kql`/`nodata` | `crit` on any critical miss, `warn` below floor, else `ok` |
| `mesh-planner-eval` | Planner eval (A1+A8) | `kql`/`nodata` | `crit` on fail, else `ok` |

Each tile renders `nodata` when its slice of the report is absent, so the tiles
stay dark until the eval harness writes a record. The helper is read-only and
never raises (a malformed payload degrades to `nodata`).

The frontend (`ObservabilityDashboard.tsx`) is data-driven and renders the new
tiles with **no change** required.

### 4. Tests

- Updated `test_agent_mesh_section_dark_without_history` to assert the new
  seven-tile id set.
- Added `test_agent_mesh_section_reads_agent_eval_history` writing an
  `agent_eval` row and asserting the three new tiles' values/status/source.
- Added two adapter recorder tests: a no-op when the sink flag is unset, and a
  successful `agent_eval` write when enabled.

## Data contract

`agent_eval` record payload = `ObservabilityReport.as_dict()`. The tiles read:

- `eval.accuracy`, `eval.accuracy_floor`, `eval.support` → tutor tile.
- `safeguarding.recall`, `safeguarding.recall_floor`,
  `safeguarding.critical_false_negatives` → safeguarding-recall tile.
- `planners.passed` (+ per-key `A1_insights.passed` / `A8_planning.passed` for
  the failing-agent detail) → planner tile.

## Validation

- Targeted suites green: `test_learning_observability.py` +
  `test_eval_report_adapter.py` + `test_observability_gate.py` = **48 passed**.
- The 14 failures seen in the full `tests/unit` run are **pre-existing and
  environmental** (`test_case_adapter_conformance`, `test_learner_memory_api`,
  `test_oneroster_import_smoke` — missing fixtures/evidence-bundles/DB), and
  reproduce identically in isolation without importing any changed module.

## Files touched

- `backend/src/agents/eval_report_adapter.py` — recorder + constants.
- `backend/scripts/real_agent_eval.py` — call the recorder.
- `backend/src/learning/api.py` — `agent_eval` read + `_agent_eval_tiles()` + 3 tiles.
- `backend/tests/unit/test_learning_observability.py` — tile-id + new-tile tests.
- `backend/tests/unit/test_eval_report_adapter.py` — recorder tests.
