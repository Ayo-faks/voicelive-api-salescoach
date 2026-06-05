# Plan — all-agent evals + ObservabilityReport mapping

> Forward plan for extending eval coverage to every model-backed agent and
> surfacing the result through the observability gate. Companion to
> `all-agent-eval-session-memory.md` (current state) and
> `all-agent-eval-handoff.prompt.md` (the fresh-session prompt).

## Goal

1. Add evaluation coverage for the agents not yet evaluated (**A1 insights**,
   **A8 planning**), keeping A2 tutor + A5 safeguarding as the live-model cases.
2. **Map the combined eval report into an `ObservabilityReport`** with a
   threshold-driven `status` + `reasons`, surfaced alongside the existing gate
   output.
3. Prove it with **tests that actually exercise the evals** (not just imports).

## Current coverage

| Agent | Harness | Model | Status |
|---|---|---|---|
| A2 text dig-deeper tutor | `ModelAssistantProvider` + real RAG | gpt-4o (live) | ✅ 8/8 |
| A5 safeguarding | `SafeguardingClassifier` | gpt-4o (live) | ✅ 5/5, recall 1.0 |
| A1 insights planner | `CopilotInsightsPlanner` (Copilot SDK + tools) | gpt-5 | ❌ none |
| A8 planning | `LearningPlanner` / `StubLearningPlanner` | stub/SDK | ❌ none |

## Work items

### 1. Confirm A1/A8 entry points (from source, not memory)

- A1: `CopilotInsightsPlanner` (likely `src/services/insights_copilot_planner.py`):
  `__init__(self, settings: Mapping[str, Any])`;
  `run_turn(*, system_prompt, history, user_message, tools, context, tool_call_budget) -> InsightsPlannerResult`.
  Uses `copilot.CopilotClient`. Seam: inject a **fake tool registry** + fake client.
- A8: `LearningPlanner` protocol + `StubLearningPlanner` in `src/learning/planner.py`;
  `run_turn(request: PlannerRequest) -> PlannerResult[InterventionPlan]`. Stub is
  deterministic (no model).

### 2. Add A1 + A8 eval cases (offline, deterministic)

- Drive the Copilot-SDK agents with a **fake client + fake tool registry** so
  cases are offline + deterministic. Assert on structured planner output (fields
  present, tool-call budget respected, no crash, deterministic pass).

### 3. Per-agent metrics

- Tutor: accuracy + citation rate.
- Safeguarding: recall / precision / false-positive-rate.
- Planners (A1/A8): schema-valid rate, tool-budget adherence, deterministic-pass.
- Keep all per-agent, keyed by agent, in the report JSON.

### 4. Adapter: eval report → `ObservabilityReport`

- New `eval_report -> ObservabilityReport` adapter that:
  - sets per-agent results into report fields (`eval`, `safeguarding`, + a new
    bucket for planners — extend `as_dict()` without dropping existing keys),
  - derives `status` from thresholds:
    - all clean → `ok`;
    - any agent below its accuracy floor, or safeguarding recall < 1.0 → `degraded`;
    - a hard safety miss (false negative on critical) → `blocked`;
    - mesh dark → `disabled`;
  - populates `reasons` with the tripped threshold.
- Wire into `run_observability_gate.py` (or a documented flag) so the agent-eval
  section appears in its JSON output. `exit_code` = 0 unless `blocked`.

### 5. Keep honesty caveats

- Live spend on shared quota; lexical retrieval default; A5 on gpt-4o (no
  gpt-4o-mini here); planner cases are fake-client/offline.

## Test gate (must pass before "done")

1. **Adapter unit tests** (offline): synthetic eval-report dicts →
   all-clean → `ok`/exit 0; safeguarding recall miss → `degraded`/`blocked` with
   matching `reasons`; disabled path → `disabled`/exit 0; `as_dict()` keeps
   existing keys + new agent buckets.
2. **Planner-eval tests** (offline, fake CopilotClient + fake tool registry):
   A1/A8 cases produce expected structured outcome deterministically, no network.
3. **Import smoke test**: import `scripts/real_agent_eval.py` + adapter (none
   exists today — add one).
4. Run from `backend/`:
   ```
   PYTHONPATH=. /home/ayoola/sen/.venv/bin/python -m pytest \
     tests/unit/test_observability_gate.py \
     tests/unit/test_agent_mesh_cron.py \
     tests/unit/<new_adapter_test>.py \
     tests/unit/<new_planner_eval_test>.py -q
   ```
   Then regression: `test_online_dryrun.py`, `test_rollback_adapter.py`,
   `test_learning_eval_harness.py`.
5. **Live confirmation (unsandboxed)**: re-run the full eval; confirm
   `REAL_AGENT_EVAL_OK`, A2 8/8, A5 recall 1.0, and the produced
   `ObservabilityReport.as_dict()` has the agent sections with a sensible status.

## Done criteria

- A1 + A8 have deterministic offline coverage; A2 + A5 remain live.
- One adapter turns the combined eval into an `ObservabilityReport`
  (threshold `status` + `reasons`), surfaced in the gate JSON.
- New pytest tests pass; existing gate/eval tests still pass.
- Live re-run green and maps cleanly.
- Commit on the current branch; push to **origin**; summarize scoring +
  thresholds + test results.
