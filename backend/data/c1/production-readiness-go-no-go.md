# Production-readiness go/no-go — agent mesh gate

_Last updated: 2026-06-04. Branch: `feat/agent-mesh-gate2-obs`._

This document records the evidence assembled to close the gaps from the
2026-06-04 NO-GO audit, plus the items that remain **human-gated** before a
defensible GO. It is an honest status snapshot, not an approval. No production
switch was flipped and no policy was promoted to live learners while producing
it.

## Summary verdict

**Conditional — not yet GO.** The automated gates are now real and passing, but
two pieces of evidence still require deliberate human action: a
production-representative staging load ramp, and the human two-role policy
sign-off. See [Residual human-gated blockers](#residual-human-gated-blockers).

## What changed in this pass

| # | Gap (from audit) | Status | Evidence / commit |
|---|------------------|--------|-------------------|
| 1 | No blocking CI eval gate | ✅ Closed | `scripts/ci_eval_gate.py` + CI job `agent-eval-gate` (`38302bd`) |
| 2 | No real load test (synthetic in-process ramp only) | ✅ Tooling closed; staging ramp human-gated | k6 script + smoke + CI job `loadtest-smoke` (`de7e651`) |
| 3 | Eval baseline too small (a handful of cases) | ✅ Closed | A2/A5 expanded + live re-run (`743608c`, `58d6cfc`) |
| 4 | Policy mislabelled as promoted | ✅ Closed | `next_best_question_policy.json` relabelled `SHADOW-UNPROMOTED` (`720960c`) |

## 1. Blocking CI eval gate

- `scripts/ci_eval_gate.py` grades the committed eval report through the same
  adapter the runtime observability gate uses. It is **credential-free** (reads
  a committed JSON report), so it runs in CI without Azure access.
- Exit semantics: `BLOCKED` → exit 1 (fails the build); `DEGRADED`/`DISABLED`/
  `OK` → exit 0. Missing or malformed report → exit 1.
- Wired as CI job `agent-eval-gate` in `.github/workflows/lint-and-test.yml`.
- Thresholds (unchanged, not weakened): tutor accuracy floor **0.85**,
  safeguarding recall floor **1.0**, planner schema/budget floors **1.0**.

## 2. Real load test with SLO pass/fail

- Replaced the in-process synthetic ramp with a real **k6** script
  (`backend/loadtest/agent_mesh_score.js`) driving the existing
  `/internal/agent-mesh/score` route over HTTP (synthetic-only payloads).
- **SLOs enforced as k6 thresholds:**
  - Staging ramp: p95 < **400 ms**, p99 < **800 ms**, error rate < **1%**;
    staged 50 → 250 → 500 → 1000 VUs.
  - Local smoke: p95 < **800 ms**, p99 < **1500 ms** (loose, fixture latency
    is not prod-representative).
- **Local smoke result:** RC 0, 3931 requests, 0 errors, p95 ≈ 1.7 ms,
  p99 ≈ 8.6 ms — thresholds passed. CI job `loadtest-smoke`
  (`grafana/setup-k6-action`) runs it on every push.
- **Honesty caveat:** the smoke runs against a hermetic local fixture server;
  its latency is **not** representative of production. The
  production-representative ramp against staging is a separate, human-gated step
  (see below).

## 3. Real-agent eval baseline

Live run on 2026-06-04 against `aifoundry-voicelab-e5dj24rvkgx2c` (swe),
managed-identity auth, `gpt-4o` for both tutor and safeguarding.

| Agent | Cases | Result | Floor | Pass |
|-------|-------|--------|-------|------|
| A2 text tutor | 27 | accuracy **0.963** (26/27) | 0.85 | ✅ |
| A5 safeguarding | 17 | recall **1.0**, FPR **0.0** (17/17) | recall 1.0 | ✅ |
| A1 insights | 3 | schema 1.0 (offline fake-client) | 1.0 | ✅ |
| A8 planning | 3 | schema 1.0 (offline stub) | 1.0 | ✅ |

- The single A2 miss is `tutor-oncorpus-quadratic-formula`: the model answered
  correctly but **without surfacing a citation** (expected `citation`, actual
  `answer`) — a grounding-attribution miss, not a wrong answer.
- Safeguarding set: 6 critical + 3 medium (intervene), 8 benign (pass).
- **Caveats (recorded in the report's `still_bounded`):**
  - Safeguarding ran on `gpt-4o`, **not** the production `gpt-4o-mini` pin.
  - Safeguarding content is **synthetic, non-graphic, author-written** — not a
    clinically validated corpus.
  - The case set is **dozens, not hundreds** — broader than the original
    handful, still a sample.
  - Retrieval is lexical by default (`AOAI_DENSE_RETRIEVAL=1` enables dense).

## 4. Policy label honesty

- `backend/data/c1/next_best_question_policy.json` was tagged
  `status=PROMOTED-SIMULATION` with a note claiming "human two-role sign-off
  waived". That reads like a real production promotion.
- Relabelled to **`SHADOW-UNPROMOTED`**, the misleading `promoted_by` removed,
  and the note rewritten: dark/shadow artifact, **not** promoted, promotion
  still requires human two-role sign-off.
- Regression test `test_committed_policy_artifact_is_not_promoted` asserts the
  shipped artifact never reads as promoted. No runtime consumer reads this
  status — it is governance metadata only.

## Residual human-gated blockers

These must be cleared by a human before a defensible GO:

1. **Production-representative staging load ramp.** `staging-sen.wulo.ai`
   (the `rg-salescoach-swe` app) enforces Easy Auth
   (`unauthenticatedClientAction=Return401`) — every request, including
   `/healthz`, returns 401 — and the mesh flags (`AGENT_MESH_ENABLED`,
   `AGENT_MESH_SCORE_ROUTE_V1`) are **not** set on staging. Running the k6 ramp
   there requires (a) enabling the mesh flags on the staging revision,
   (b) provisioning an auth path for the load traffic, and (c) a score token.
   These are deliberate shared-infra changes and were **not** made.
2. **Agent-mesh enablement in production** (`AGENT_MESH_ENABLED=true`) remains
   off by design.
3. **Policy promotion to live learners** remains pending human two-role
   sign-off (artifact is `SHADOW-UNPROMOTED`).
4. **DPIA / safeguarding review** for the safeguarding classifier against the
   production `gpt-4o-mini` pin (the eval baseline used `gpt-4o`).
5. **Phase-4 KPIs** (per the contract suite) remain to be evidenced.

## How to reproduce the gates

```bash
# Credential-free CI eval gate (grades the committed report)
cd backend && PYTHONPATH=. python scripts/ci_eval_gate.py --force

# Local k6 load smoke (no Azure needed)
make loadtest-smoke PYTHON=python

# Live real-agent eval (needs az login + unsandboxed network; real model spend)
cd backend && AZURE_OPENAI_ENDPOINT="https://aifoundry-voicelab-e5dj24rvkgx2c.cognitiveservices.azure.com/" \
  PYTHONPATH=. python scripts/real_agent_eval.py
```
