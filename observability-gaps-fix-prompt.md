# Prompt: Close the observability gaps on `/observability`

> Paste this whole file as the first message in a **new session**, working in
> `/home/ayoola/sen/voicelive-api-salescoach`. Do the discovery phase first and
> **do not write any code until discovery is reported back and confirmed.**

---

## Role & context

You are extending the admin observability dashboard for the Wulo / Pathfinder
Learn app (Flask backend + React/Vite/FluentUI frontend, deployed to Azure
Container Apps).

- Container App: `voicelab`, RG `rg-salescoach-swe`, sub
  `3cb57c01-55ff-4609-8967-c47271818125`, region `swedencentral`.
- Staging: `https://staging-sen.wulo.ai`. Internal:
  `https://voicelab.wittyground-443dbaba.swedencentral.azurecontainerapps.io`.
- azd env `salescoach-swe`. Deploy (WSL):
  `AZURE_EXTENSION_DIR=/tmp/az-noext DOCKER_CONFIG=$(mktemp -d) azd deploy voicelab -e salescoach-swe --no-prompt`.
  Do **not** pipe azd through `tail` (it buffers and the wrapper terminal looks
  like it exits early); verify with `az containerapp revision list`.
- venv: `/home/ayoola/sen/.venv`. Frontend dir: `frontend/`.

### Key files (verify these still match before editing)
- Dashboard builder: `backend/src/learning/api.py` →
  `get_observability_dashboard()` (~L1938) builds `sections[].tiles[]` +
  `overall_status`. Tiles are badged `live` / `fixture` / `nodata`.
- Metric source: `backend/src/learning/observability.py` (`metrics_snapshot()`,
  Prometheus text at `/api/learning/metrics`, OTel export via
  `PilotTelemetryService` when `APPLICATIONINSIGHTS_CONNECTION_STRING` is set).
- Route handler: `backend/src/learning/api.py` ~L3505
  (`/api/learning/observability/dashboard`).
- Frontend dashboard component: under `frontend/src/learning/` (route
  `/observability`, admin-only, testId `pf-observability-dashboard`, fetches
  `GET /api/learning/observability/dashboard`).
- E2E: `frontend/e2e/pathfinder-observability.spec.ts`.

### Current sections/tiles (as of this prompt — re-verify)
1. **Product & learning outcomes**: retry-after-explanation success, diagnostic
   completion (fixture), weekly cost/student (fixture).
2. **Service health**: API error rate, LLM latency p50/p95/p99, LLM turn error
   rate + spend.
3. **Safety & agent quality**: citation coverage, RAG refusal rate,
   safeguarding signals, safety eval pass rate (fixture).

---

## The five gaps to close

1. **Durability** — `metrics_snapshot()` is in-process & ephemeral: counters
   reset every revision restart and only reflect one replica. Back the live
   tiles with Azure Monitor / Application Insights (Log Analytics KQL) so values
   survive deploys and aggregate across replicas. OTel is already exported to
   App Insights, so this is wiring queries, not new instrumentation.
2. **DevOps layer (missing entirely)** — add a tile row for: active revision
   name, healthy replica count, last deploy time, `/api/health` status, and
   **Postgres connectivity / migration boot** status.
3. **Fixture tiles** — diagnostic completion, cost/student, DSR SLA, safety-eval
   pass rate read a static snapshot file and don't move with real usage. Make
   them live where a real signal exists, or clearly label them as snapshot.
4. **AgentOps depth** — surface signals already logged but not shown: planner
   tool-call count / budget breaches, approval-vs-override rate, and voice TTFA
   (time-to-first-audio) where available.
5. **Pull-only → push** — add Azure Monitor alert rules for the bottom two
   layers (health 5xx, p95 latency, Postgres auth failures, token spend) so
   issues are pushed, not polled.

---

## PHASE 0 — Discovery (DO THIS FIRST, no code changes)

Before implementing anything, **check what already exists** and report findings.
Do not assume the list above is current. Specifically determine:

1. Does `get_observability_dashboard()` still have exactly these sections/tiles?
   Re-read it and list current tile ids + their `source` badge.
2. Is `APPLICATIONINSIGHTS_CONNECTION_STRING` actually set on the `voicelab`
   Container App? (`az containerapp show` / secret list). Is there a Log
   Analytics workspace + App Insights resource already provisioned (check
   `infra/` Bicep and `azd env get-values`)? If yes, capture resource IDs.
3. What OTel metrics/spans does `observability.py` already export to App
   Insights, and under what metric/span names? (so KQL targets the right names.)
4. Is there already any Azure Monitor alert rule, action group, or
   `infra/`-defined alerting? List what exists.
5. Does the backend already expose health/revision/Postgres status anywhere
   (e.g. `/api/health`, a readiness probe, a migrations status check)?
6. Are planner tool-call counts, approval/override events, and voice TTFA
   actually being emitted today? Find the emit sites; if a signal is NOT
   emitted, note it (don't fabricate a tile with no source).
7. Does the frontend dashboard component render tiles purely from the API
   `sections[].tiles[]` shape (so backend-only changes suffice), or is anything
   hard-coded client-side?
8. Run the existing tests to establish a green baseline:
   `npx tsc --noEmit`, the observability vitest/e2e, and any backend tests for
   the dashboard endpoint.

**Output of Phase 0:** a short written report — for each of the 5 gaps, state
whether the building blocks already exist, partially exist, or are absent, with
file/resource references. Then propose a concrete, minimal implementation plan
and **wait for my confirmation before writing code.**

---

## PHASE 1 — Implementation (only after I confirm the plan)

Implement in this priority order; each step independently shippable:

1. **DevOps tile row** (gap 2) + **push alerts** (gap 5) first — smallest change,
   biggest operational win. Add a "Service & infrastructure" section with
   revision/replica/health/Postgres tiles. Add Azure Monitor alert rules +
   action group in `infra/` (Bicep) for 5xx, p95 latency, Postgres auth, spend.
2. **Durability** (gap 1) — add a KQL-backed source path for the live tiles,
   reading from App Insights/Log Analytics when configured, falling back to the
   current in-process counters (and `nodata`) when not. Keep the existing
   `live`/`fixture`/`nodata` badging; add a `kql` source badge if helpful.
3. **AgentOps tiles** (gap 4) — only for signals confirmed emitted in Phase 0.
4. **Fixture tiles** (gap 3) — convert to live where a real signal exists;
   otherwise relabel so they read as snapshot, not real-time.

### Constraints
- The dashboard endpoint must **never 500** — every new source path needs a
  graceful `nodata` fallback (match the existing `try/except` pattern).
- Keep changes minimal and idiomatic; don't refactor unrelated code, don't add
  comments/docstrings to code you didn't change.
- Don't hardcode secrets/connection strings; read from env / Container App
  secrets / managed identity as the codebase already does.
- Preserve the existing tile/section JSON shape so the frontend keeps working;
  extend, don't break.

### Validation (must pass before deploy)
- `npx tsc --noEmit` clean.
- Observability vitest + `frontend/e2e/pathfinder-observability.spec.ts` green.
- Backend dashboard-endpoint tests green; add tests for new tiles + the KQL
  fallback (mock the Azure client; assert `nodata` when unconfigured).
- `az bicep build` / `azd provision` what-if (or equivalent) clean for new
  alert resources.

### Ship
- Commit with a clear message per logical step.
- Deploy: `AZURE_EXTENSION_DIR=/tmp/az-noext DOCKER_CONFIG=$(mktemp -d) azd deploy voicelab -e salescoach-swe --no-prompt`.
- Verify: `az containerapp revision list -n voicelab -g rg-salescoach-swe`,
  then `curl` `/api/health` and `/api/learning/observability/dashboard` on
  `https://staging-sen.wulo.ai` and confirm new tiles render + alerts exist.
- Report final status: revision name, endpoint codes, new tiles/alerts created.
