# Handoff prompt — whole-system load & observability validation

> Paste everything below the line into a fresh session to execute this work.
> It is self-contained: it states the goal, the verified facts about the
> system, the staged plan, the guardrails, and the exact deliverables.

---

You are continuing work on **Pathfinder Learn** inside the
`voicelive-api-salescoach` repo (workspace root `/home/ayoola/sen`, repo at
`/home/ayoola/sen/voicelive-api-salescoach`, Python venv at
`/home/ayoola/sen/.venv`). Run backend with `PYTHONPATH=.` from `backend/`.

## Objective

Stress the **whole system** by simulating thousands of concurrent users
exercising every real entry point — **text tutor** and **voice** — so we can
see (a) how the system behaves under load and (b) whether the observability
surface tells the truth while it is under stress. This is the load/perf
hardening stage, not a feature build.

## Guardrails (do not violate)

- **No unilateral Azure spend or shared-infra changes.** Build hermetic /
  local harnesses first. Anything that hits live `salescoach-swe`, Azure
  VoiceLive, or changes replica counts requires explicit human approval before
  running.
- Push to `origin` (the `Ayo-faks` fork) ONLY, never `upstream`
  (`Azure-Samples`). `az`/`azd`/`git push`/`curl`/`bicep build` need
  `requestUnsandboxedExecution=true` with a reason.
- Never weaken eval thresholds or SLOs to make a run pass.
- Do NOT commit the untracked scratch `backend/scripts/*.md` /
  `*.prompt.md` files. `.dockerignore` already excludes them.
- Synthetic data only. Attributable, one-variable-at-a-time runs.

## Verified facts about the system (already mapped — trust these)

Three user-facing surfaces; only one is load-tested today:

1. **Text tutor** — `POST /api/learning/diagnostic/start`,
   `/api/learning/diagnostic/answer`, `/api/learning/assistant/turn`,
   `/api/learning/voice/turn` (blueprint in
   `backend/src/learning/api.py`, mounted in `backend/src/app.py`). Auth via
   `X-MS-CLIENT-PRINCIPAL*` headers; RLS-scoped per tenant/student;
   rate-limited ~120 req/user/60s. **No load test exists.**
   - `LearningApi()` defaults to an **in-memory repo** and the diagnostic
     journey needs no model/DB, so the REAL tutor code can be driven
     hermetically (no Azure, no DB).
2. **Voice** — WebSocket `/ws/learning-voice` (handler in
   `backend/src/app.py`, mounted with `flask_sock` / `Sock`). The browser
   streams audio **directly to Azure VoiceLive**; the backend only
   authenticates the socket and brokers JSON frames. So load on YOUR code =
   connection + auth + frame-broker cost. Real voice audio load hits Azure
   VoiceLive **quota and real $$** — test the broker against a MOCK upstream;
   validate only a bounded number of REAL voice sessions for quota.
   `flask_sock` + `simple_websocket` are installed; production mounts the
   handler this way.
3. **Agent-mesh score** — `POST /internal/agent-mesh/score`. The ONLY surface
   with an existing load test: `backend/loadtest/agent_mesh_score.js` (k6),
   SLO gate p95<400ms / p99<800ms / errors<1%, with a Makefile target.

**Critical infra finding — surfaces the #1 blocker:** the staging `voicelab`
Container App is pinned at **`min=max=1` replica, 1 vCPU**
(`infra/resources.bicep`, scaleMinReplicas/scaleMaxReplicas). A
"thousands of users" run against it measures the ceiling of ONE container, not
how the system scales. Meaningful scale testing requires enabling KEDA
concurrency autoscaling or raising `scaleMaxReplicas` FIRST — but that is a
shared-infra change, so propose it as a ready-to-apply bicep diff gated behind
approval; do not push it unilaterally.

**Tooling:** `k6` is NOT installed locally (the existing JS smoke no-ops
without it). Python 3.12 + `aiohttp`, `websockets`, `flask`, `flask_sock`,
`simple_websocket` ARE available. A **pure-Python async harness** is the way to
deliver runnable results now without k6.

## Staged plan (execute in order; each rung answers a different question)

| Stage | Question | Shape |
|---|---|---|
| Smoke | Does the harness + SLO gate work at all? | 1–50 VUs, ~1 min, hermetic |
| Load  | Does it hold at expected peak? | ramp to expected concurrency, hold 5–10 min |
| Stress| Where/how does it break (graceful vs crash)? | ramp past peak until errors climb |
| Soak  | Does it leak/degrade over time? | moderate load, 1–4 hrs |
| Spike | Does a sudden surge recover? | jump 50→1000 instantly, watch recovery |

### Phase 1 — Text tutor harness (NEW, hermetic)
- Build a pure-Python async driver that models a realistic learner journey:
  `diagnostic/start` → `diagnostic/answer` ×N → `assistant/turn`, authenticated
  via `X-MS-CLIENT-PRINCIPAL*`, with varied `student_id`/`tenant_id`.
- Host the REAL learning blueprint in-process (in-memory repo) as the target,
  so you exercise real code without Azure/DB.
- Emit golden-signal metrics (rate, errors, p50/p95/p99 latency) and an SLO
  gate. Mirror the existing `backend/loadtest/` conventions and add a
  hermetic smoke runner like the agent-mesh one.

### Phase 2 — Voice WS harness (NEW, hermetic broker)
- Build a client that opens N concurrent `/ws/learning-voice` sockets,
  authenticates, and streams representative JSON frames against a MOCK
  VoiceLive upstream. Measure YOUR broker (connect/auth/frame relay), not
  Azure's bill. Same metrics + gate.

### Phase 3 — Enable autoscaling (PROPOSAL, approval-gated)
- Draft the KEDA concurrency / `scaleMaxReplicas` bicep change for `voicelab`.
  Present the diff; do NOT provision until approved. After approval, re-run
  Phases 1–2 against staging and watch replicas climb.

### Phase 4 — Observability validation
- While load runs, confirm `/api/learning/metrics` (Prometheus counters),
  App Insights latency, and the agent-mesh dashboard all reflect reality. If a
  tile stays green while p99 is blown, THAT is the bug. Capture a report.

## Deliverables
- `backend/loadtest/` Python harnesses for text + voice (hermetic), each with a
  smoke runner and SLO gate, wired into the `Makefile`, documented in
  `backend/loadtest/README.md`.
- A short results capture (metrics + pass/fail) from the hermetic smoke runs.
- An approval-gated bicep diff for autoscaling (Phase 3), not applied.

## Start by
1. Reading `backend/loadtest/agent_mesh_score.js` + its Makefile target +
   `backend/loadtest/README.md` to match conventions.
2. Reading the route shapes in `backend/src/learning/api.py`
   (`diagnostic/start|answer`, `assistant/turn`) and the `/ws/learning-voice`
   handler + frame protocol in `backend/src/app.py`.
3. Building Phase 1, running its hermetic smoke, then Phase 2.
4. Drafting (not applying) the Phase 3 autoscaling bicep change.

Note: a prior session verified this approach works — a hermetic Python harness
mounting the real text blueprint and the real voice handler (with a fixture
brain) drove ~16k mixed text+voice requests in ~8s at 0% errors with the SLO
gate passing. Those scratch files were reverted; rebuild them cleanly as proper
committed deliverables.
