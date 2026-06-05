# Handoff prompt — all-agent evals + ObservabilityReport mapping

Paste everything below into a fresh agent session. It is self-contained.

## Companion docs (read these first)

- **Current state / hard-won lessons**:
  `backend/scripts/all-agent-eval-session-memory.md`
- **Forward plan (work items, thresholds, test gate)**:
  `backend/scripts/all-agent-eval-plan.md`

This prompt is the executable brief; the two files above are the source of truth
for *what is already done* and *what the plan is*. If they disagree with this
prompt, prefer the plan.

---

## Mission

Extend the real-agent evaluation suite so **every model-backed agent** in the
Pathfinder Learn mesh has a real (or honestly-stubbed) evaluation, then **map the
combined result into an `ObservabilityReport`** so it shows up alongside the
existing observability gate output. Finish by **running tests that prove the
evals actually work** — not just that the file imports.

Do NOT mark this done until the test gate (bottom of this doc) is green.

## Repo / environment facts (verified)

- Workspace: `/home/ayoola/sen`. Backend: `/home/ayoola/sen/voicelive-api-salescoach/backend`.
- Run Python with the venv: `/home/ayoola/sen/.venv/bin/python`. Scripts and
  tests run from the **backend** dir with `PYTHONPATH=.`.
- Git: work on the current feature branch; push to **origin** only
  (`https://github.com/Ayo-faks/voicelive-api-salescoach.git`), never upstream.
- **Live-model runs MUST be unsandboxed.** The terminal sandbox blocks the az
  CLI credential cache, so `DefaultAzureCredential` fails and every agent
  fail-opens silently (false negatives). Use `requestUnsandboxedExecution=true`
  for any command that calls Azure OpenAI. Offline work (imports, unit tests
  with fakes) can run sandboxed. Verify auth first with `az account show`.
- Azure OpenAI: AI Foundry endpoint, **managed-identity auth (no API key)**, API
  version `2024-12-01-preview`, scope `https://cognitiveservices.azure.com/.default`.
  Deployments that EXIST on this resource: `gpt-4o`, `gpt-5.2-chat`,
  `gpt-5.3-chat`, `text-embedding-3-small`, `text-embedding-ada-002`,
  `gpt-realtime-1.5`, `gpt-image-1`. **No `gpt-4o-mini`** here.

## What already exists (do not rebuild)

- `backend/scripts/real_agent_eval.py` — REAL-agent eval, currently covers:
  - **A2 text dig-deeper tutor** = `ModelAssistantProvider` + real RAG (gpt-4o):
    `ModelAssistantProvider(client, model, rag_retriever, fallback, *, temperature, max_tokens, max_turns)`;
    `ask(question, context) -> {answer, citations, grounded?, smalltalk?}`.
    Result today: 8/8.
  - **A5 safeguarding** = `SafeguardingClassifier(client_factory=None, *, model=None)`;
    `async classify(text, *, direction="inbound", context_turns=()) -> LayerScore`
    (`.severity` is a `Severity`; `Severity.rank`: NONE0 LOW1 MEDIUM2 HIGH3 CRITICAL4).
    Result today: 5/5, recall 1.0, fpr 0.0.
  - Writes JSON to `data/c1/real_agent_eval_report.json`, prints `REAL_AGENT_EVAL_OK`.
- `backend/src/agents/observability_gate.py` — `ObservabilityReport` (frozen
  dataclass) with fields `status, ops, eval, safeguarding, critic, deploy,
  migration, reasons, recorded`; statuses `ok|degraded|blocked|disabled|error`;
  `.exit_code` (0 unless `blocked`), `.as_dict()` dashboard payload. `ObservabilityGate.run_cycle(...)`.
- `backend/scripts/run_observability_gate.py` — CLI runner: `--force`,
  `--target-env`, `--out PATH`; builds a report, prints JSON, exits `report.exit_code`.
- `agent_mesh_enabled()` in `src/agents/base.py` — env `AGENT_MESH_ENABLED`
  (truthy: 1/true/yes/on/enabled). Mesh is **dark by default**.

## Agents still needing eval coverage (the gap)

These run on the **GitHub Copilot SDK + a tool registry**, not the plain
`AzureOpenAI` client, so they need a different harness. VERIFY exact
names/paths/signatures yourself before coding (Explore reported these, treat as
hints, confirm against source):

- **A1 Insights Planner** — `CopilotInsightsPlanner` (likely
  `src/services/insights_copilot_planner.py`):
  `__init__(self, settings: Mapping[str, Any])`;
  `run_turn(*, system_prompt, history, user_message, tools: Mapping[str, InsightsTool], context: InsightsRequestContext, tool_call_budget: int) -> InsightsPlannerResult`.
  Uses `copilot.CopilotClient`. Injection seam: the `tools` mapping and a
  client factory — inject a **fake tool registry** returning deterministic tool
  results so the eval is offline + deterministic.
- **A8 Planning** — `LearningPlanner` protocol + `StubLearningPlanner` in
  `src/learning/planner.py`; `run_turn(request: PlannerRequest) -> PlannerResult[InterventionPlan]`.
  Stub is deterministic (no model). Decide: eval the stub (offline, deterministic)
  and/or the real Copilot-backed impl if one exists.
- Confirm whether the **chitchat (A4)** and **voice tutor (A3)** paths warrant
  their own cases or are covered transitively by A2.

## Required work

1. **Confirm the real entry points** for A1 and A8 from source (don't trust line
   numbers in this doc). Note the injection seams for a fake CopilotClient /
   fake tool registry.
2. **Add A1 + A8 eval cases** to `real_agent_eval.py` (or a sibling module it
   imports). For Copilot-SDK agents, drive them with a **fake/mock client + tool
   registry** so the cases are deterministic and offline — assert on the
   structured planner output (e.g. insight/plan fields, tool-call budget
   respected, no crash). Keep A2/A5 as the live-model cases.
3. **Per-agent metrics**: each agent gets the metrics appropriate to it
   (tutor: accuracy + citation rate; safeguarding: recall/precision/fpr;
   planners: schema-valid rate, tool-budget adherence, deterministic-pass).
   Keep these in the report JSON, keyed per agent.
4. **Map the combined eval report into an `ObservabilityReport`.** Write a small
   adapter (e.g. `eval_report -> ObservabilityReport`) that:
   - sets per-agent results into the report fields (`eval`, `safeguarding`, and
     a new bucket for planners if needed — extend `as_dict()` payload, don't
     break existing fields),
   - derives `status` from **thresholds**: e.g. safeguarding recall < 1.0 or any
     agent accuracy below its floor → `degraded`; a hard safety miss →
     `blocked`; all clean → `ok`; honor dark-by-default (`disabled`).
   - populate `reasons` with which threshold tripped.
   Wire it so `run_observability_gate.py` (or a documented flag) can surface the
   agent-eval section in its JSON output.
5. **Honesty**: keep the existing caveats in the report (live spend on shared
   quota; lexical retrieval default; gpt-4o used for safeguarding because
   gpt-4o-mini absent on this resource; planner cases are fake-client/offline).

## Test gate — MUST run and pass before declaring done

Add real tests under `backend/tests/unit/` (NOT just a script run):

1. **Adapter unit tests** (offline, sandboxed OK): feed synthetic eval-report
   dicts into the `eval_report -> ObservabilityReport` adapter and assert:
   - all-clean → `status == "ok"`, `exit_code == 0`;
   - a safeguarding recall miss → `degraded` or `blocked` per your threshold,
     with a matching `reasons` entry;
   - mesh dark / disabled path → `disabled`, `exit_code == 0`;
   - `as_dict()` contains the per-agent buckets and doesn't drop existing keys.
2. **Planner-eval tests** (offline, fake CopilotClient + fake tool registry):
   assert A1/A8 cases produce the expected structured outcome deterministically
   and the harness records pass/fail without hitting the network.
3. **Smoke import test**: a test that imports `scripts/real_agent_eval.py` and
   the adapter (there is currently NO test importing the script — add one).
4. Run the suite from `backend/`:
   ```
   PYTHONPATH=. /home/ayoola/sen/.venv/bin/python -m pytest \
     tests/unit/test_observability_gate.py \
     tests/unit/test_agent_mesh_cron.py \
     tests/unit/<your_new_adapter_test>.py \
     tests/unit/<your_new_planner_eval_test>.py -q
   ```
   All must pass. Then run the existing related suites to prove no regression:
   `test_online_dryrun.py`, `test_rollback_adapter.py`, `test_learning_eval_harness.py`.
5. **Live confirmation (unsandboxed)**: run the full eval once for real to prove
   A2/A5 still score as before AND the new report maps to an `ObservabilityReport`:
   ```
   # requestUnsandboxedExecution=true
   cd backend && PYTHONPATH=. AZURE_OPENAI_ENDPOINT=<endpoint> \
     /home/ayoola/sen/.venv/bin/python scripts/real_agent_eval.py
   ```
   Confirm `REAL_AGENT_EVAL_OK`, A2 8/8, A5 recall 1.0, and that the produced
   `ObservabilityReport.as_dict()` has the agent sections with a sensible status.

## Done criteria

- A1 + A8 have deterministic offline eval coverage; A2 + A5 remain live.
- One adapter turns the combined eval into an `ObservabilityReport` with
  threshold-driven `status` + `reasons`, surfaced in the gate's JSON output.
- New pytest tests (adapter + planner + import smoke) pass; existing gate/eval
  tests still pass.
- Live eval re-run is green and its report maps cleanly.
- Commit the new/changed files on the current branch and push to **origin**.
  Summarize: what each agent is scored on, the thresholds, and the test results.

## Plan first

Before editing, produce a short plan: the confirmed A1/A8 entry points + chosen
injection seams, the per-agent metrics + thresholds, the adapter shape, and the
exact list of test files you'll add. Then implement.
