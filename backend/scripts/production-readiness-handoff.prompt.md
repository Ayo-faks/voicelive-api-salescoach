# Handoff prompt — production-readiness gap closure (plan + execute)

Paste everything below into a fresh agent session. It is self-contained.

## Companion docs (read first)

- Audit basis / what already exists:
  [backend/scripts/all-agent-eval-session-memory.md](all-agent-eval-session-memory.md)
- Forward plan for the agent-eval → ObservabilityReport work:
  [backend/scripts/all-agent-eval-plan.md](all-agent-eval-plan.md)
- The original eval handoff:
  [backend/scripts/all-agent-eval-handoff.prompt.md](all-agent-eval-handoff.prompt.md)

If those disagree with this prompt, prefer the verified repo source.

---

## Mission

A production-readiness audit (2026-06-04) returned **NO-GO**. Your job is to
**plan, then execute** the work that closes the real gaps so a defensible
go/no-go can be made. Plan first, get the user's confirmation on scope, then
execute task-by-task with a test gate after each.

Do NOT flip any production switch (no `AGENT_MESH_ENABLED=true`, no policy
promotion to live learners) as part of this work — those are human gated. Your
job is to make the gates real and the evidence honest.

---

## Audit findings (verified — this is the gap list)

| Area | Verdict | Evidence |
|---|---|---|
| Stress test | MISSING | No k6/locust/artillery/vegeta anywhere (package.json, requirements, Makefile, infra). No latency SLOs/error budgets. |
| Load test | SIMULATED + tiny smoke | `backend/data/c1/b3_loadtest_report.json` `mode` = "in-process synthetic ramp (staging-HTTP route /internal/agent-mesh/score not yet implemented server-side)". `backend/data/c1/b3_live_staging_report.json` is real HTTP but only 30 peak sessions / 7.5s. |
| Evaluation (A2,A5) | REAL but bounded | `real_agent_eval.py` live gpt-4o: A2 8/8, A5 recall 1.0. `still_bounded` admits tiny case count, lexical retrieval, synthetic safeguarding, A5 on gpt-4o not the gpt-4o-mini prod pin. |
| Evaluation (A1,A8) | PARTIAL | Offline fake-client / deterministic stub. No live model. |
| CI suite | REAL | `.github/workflows/lint-and-test.yml`: flake8 + black + pytest (3.11/3.12), frontend lint/build, phase-2/3/4 contract jobs. ~134 unit + ~17 integration test files. |
| Observability/eval gate in CI | MISSING | `backend/scripts/run_observability_gate.py` exists but is NOT called by CI; thresholds don't block deploy. |
| C1 policy promotion | SHADOW | `backend/data/c1/next_best_question_policy.json` `status` = "PROMOTED-SIMULATION", note: "human two-role sign-off waived for the simulation run only." |
| Agent mesh | dark-by-default | `backend/deploy/agent-mesh-cron.yaml` `AGENT_MESH_ENABLED=false`. Correct; leave it. |

Thresholds that already exist (keep, reuse — do not weaken):
`backend/src/agents/eval_report_adapter.py` — `TUTOR_ACCURACY_FLOOR=0.85`,
`SAFEGUARDING_RECALL_FLOOR=1.0`, `PLANNER_SCHEMA_FLOOR=1.0`,
`PLANNER_BUDGET_FLOOR=1.0`; critical safeguarding false-negative → BLOCKED (exit 1).

---

## Repo / environment facts (verified)

- Backend root: `/home/ayoola/sen/voicelive-api-salescoach/backend`. Run scripts
  and tests from there with `PYTHONPATH=.`. Venv:
  `/home/ayoola/sen/.venv/bin/python`.
- Push to **origin** only (`github.com/Ayo-faks/voicelive-api-salescoach`), never
  upstream. Confirm branch with `git branch --show-current` before any push. The
  eval work lives on `feat/agent-mesh-gate2-obs`; confirm which branch you are on
  before committing.
- **Live-model / live-HTTP runs MUST be unsandboxed.** The terminal sandbox
  blocks the az CLI credential cache → `DefaultAzureCredential` fails → agents
  fail-open silently (false negatives). Use `requestUnsandboxedExecution=true`
  and verify `az account show` first. Offline unit tests run sandboxed.
- Azure OpenAI: resource `aifoundry-voicelab-e5dj24rvkgx2c`, managed-identity
  auth (no API key), API version `2024-12-01-preview`. Deployments that EXIST:
  `gpt-4o`, `gpt-5.2-chat`, `gpt-5.3-chat`, `text-embedding-3-small`,
  `text-embedding-ada-002`, `gpt-realtime-1.5`, `gpt-image-1`. NO `gpt-4o-mini`
  here (prod safeguarding pin lives on another resource).
- Staging base URL used by the live load smoke: `https://staging-sen.wulo.ai`.

---

## Required work (plan these, confirm scope, then execute in order)

Order is deliberate: cheapest/highest-leverage first; infra-touching last.

### Task 1 — Wire the eval gate into CI as a blocking gate (no infra)
- Make `run_observability_gate.py` (or a thin wrapper that calls
  `eval_report_to_observability_report`) run in CI and **fail the job on
  BLOCKED** (exit 1). Decide: run the offline-safe portion in CI (A1/A8 + adapter
  thresholds over a committed eval report) so it needs no Azure creds, OR gate
  only on a fixture. Live A2/A5 stays a manual unsandboxed step (document it).
- Add a CI job to `.github/workflows/lint-and-test.yml`. Keep it dark-aware:
  disabled mesh → `STATUS_DISABLED`, exit 0; never block on absence of creds.
- Test gate: a unit test asserting the wrapper exits non-zero on a synthetic
  BLOCKED report and zero on OK/DISABLED.

### Task 2 — Implement the real `/internal/agent-mesh/score` route + real load test
- Confirm the route truly does not exist server-side (the synthetic report says
  so). Implement a minimal, real scoring endpoint (or point the load test at an
  existing equivalent if one exists — verify first).
- Add a **real** load tool (prefer k6; locust acceptable). Script a ramp
  (e.g. 50 → 250 → 500 → 1k VUs), capture p50/p95/p99 + error rate, write a
  report to `backend/data/c1/`. Mark the artifact mode honestly
  (`"mode": "k6-live-staging"`).
- Define SLOs (e.g. p99 latency target, error-rate ceiling) and make the load
  script assert them so it can pass/fail.
- Run unsandboxed against staging only with the user's explicit go-ahead.
- Test gate: the k6 script runs in `--vus 1 --duration 5s` smoke mode in CI (or a
  documented make target), and a unit/integration test covers the new route.

### Task 3 — Strengthen the evaluation baseline
- Expand A2/A5 case counts to a defensible set (target dozens, not a handful);
  add real learner paraphrases for the tutor; keep safeguarding content synthetic
  and non-graphic but broaden coverage.
- Run A5 against the production safeguarding pin if reachable (note: gpt-4o-mini
  is NOT on this resource — document the cross-resource auth or keep gpt-4o and
  state the caveat explicitly).
- Optionally enable dense retrieval (`AOAI_DENSE_RETRIEVAL=1`) for an A/B and
  record the delta.
- Test gate: offline smoke (import + adapter) stays green; live run unsandboxed
  confirms thresholds still pass with the larger set.

### Task 4 — Make the C1 policy promotion honest
- Do NOT promote to live learners. Either revert
  `next_best_question_policy.json` status to an accurate shadow label
  (e.g. `SHADOW-UNPROMOTED`) or document the real two-reviewer promotion
  workflow and leave the artifact un-promoted. The current
  `PROMOTED-SIMULATION` + "sign-off waived" wording must not read as a real
  production promotion.
- Test gate: any test asserting policy status reflects the corrected label.

### Task 5 — Produce a go/no-go readiness doc
- Only if the user asks. Summarize: load/stress results vs SLOs, eval baseline,
  CI gate status, policy status, and the remaining human-gated items (DPIA,
  phase-4 KPIs, mesh enablement). Honest verdict.

---

## Global rules

- Plan first. Present the task list + per-task test gate, get confirmation, then
  execute one task at a time, validating after each.
- Never weaken existing thresholds to make a gate pass.
- Keep honesty caveats in every artifact (real spend on shared quota; lexical vs
  dense retrieval; synthetic safeguarding content; A5 model pin reality;
  simulated vs live load).
- Run live model / live HTTP unsandboxed; verify `az account show` first.
- Commit logically; push to **origin** after confirming the branch. Use
  `requestUnsandboxedExecution=true` for `git push`.
- Do not flip production switches or promote policy to live learners.

## Done criteria

- CI has a blocking eval gate (Task 1) with a passing test.
- A real load test exists and runs against a real route with SLO pass/fail
  (Task 2); synthetic-only report no longer the sole evidence.
- Eval baseline expanded and re-run green with documented caveats (Task 3).
- Policy artifact label is honest (Task 4).
- New + existing tests pass; summary of what changed and the residual
  human-gated blockers.
