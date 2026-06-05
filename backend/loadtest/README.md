# Agent-mesh score route — load testing (k6)

Real HTTP load test for `POST /internal/agent-mesh/score`, the synthetic-scoring
route the B3 ramp drives. This replaces the earlier **in-process synthetic
ramp** (`data/c1/b3_loadtest_report.json`, `mode = "in-process synthetic
ramp ... route not yet implemented server-side"`) — that note is now stale: the
route exists ([`src/learning/agent_mesh_routes.py`](../src/learning/agent_mesh_routes.py),
registered in `api.py`) and this test drives it over real sockets with k6.

## Files

| File | Purpose |
|---|---|
| `agent_mesh_score.js` | k6 script: staged ramp + SLO thresholds + JSON summary. |
| `serve_score_route.py` | Local real-socket server mounting only the score blueprint, for the hermetic CI smoke. |

## SLOs (enforced as k6 thresholds — the run fails if breached)

| Budget | Staging | Local smoke | Override env |
|---|---|---|---|
| p95 latency | < 400 ms | < 800 ms | `P95_BUDGET_MS` |
| p99 latency | < 800 ms | < 1500 ms | `P99_BUDGET_MS` |
| Error rate (non-2xx) | < 1% | < 1% | `ERROR_BUDGET` |
| Outcome present | > 99% | > 99% | — |

The smoke uses looser latency because it hits a single-process in-process fixture
classifier; the staging budget is the one that matters for go/no-go.

## Ramp (staging mode)

50 → 250 → 500 → 1000 VUs over ~6 min (30s/1m/1m/2m hold/ramp-down). Tune via the
`stages` block in the script.

## Running

### Local smoke (hermetic, no creds)

```bash
cd backend
make loadtest-smoke          # starts serve_score_route.py, runs k6 SMOKE=1, tears down
```

or manually:

```bash
cd backend
python loadtest/serve_score_route.py --port 8787 &   # arms flags process-locally
SMOKE=1 BASE_URL=http://127.0.0.1:8787 k6 run loadtest/agent_mesh_score.js
```

### Staging ramp (manual, deliberate — spends real shared capacity)

The deployed route is dark by default. It only answers when **both**
`AGENT_MESH_ENABLED` and `AGENT_MESH_SCORE_ROUTE_V1` are set on the staging app,
and (if configured) the caller presents `AGENT_MESH_SCORE_TOKEN` as a bearer
token. Run unsandboxed, with a named operator, only with explicit go-ahead:

```bash
cd backend
BASE_URL=https://staging-sen.wulo.ai OPERATOR=ayo \
  AGENT_MESH_SCORE_TOKEN=$TOKEN \
  k6 run loadtest/agent_mesh_score.js
# writes data/c1/b3_k6_loadtest_report.json  (mode = "k6-live-staging")
```

## Honesty caveats (keep surfacing)

- **Synthetic only.** Every request sends `synthetic: true` + a named operator;
  the route 400s otherwise. No learner data is involved.
- **Smoke ≠ production latency.** The local smoke hits an in-process fixture
  classifier (no DB, no model), so its numbers prove only that the harness and
  SLO gate work. Real latency comes from the `k6-live-staging` run.
- **Real spend.** The staging ramp uses real shared capacity; keep runs
  deliberate and attributable.
- The route deliberately sits under `/internal/` (not `/api/`) so it sidesteps
  the learner-facing CSRF + rate-limit guards — the load test measures the mesh,
  not the rate limiter.

---

# Whole-system load — Pathfinder Learn (text tutor + voice)

Load + observability hardening for the **real learner entry points**: the text
tutor journey (`/api/learning/*`) and the realtime voice frame broker
(`/ws/learning-voice`). The goal is to (a) see how the system behaves under
thousands of concurrent synthetic learners and (b) check whether the
observability surface tells the truth while it is under stress. This is the
perf-hardening stage, **not** a feature build.

## Files

| File | Purpose |
|---|---|
| `learning_tutor.js` | k6 HTTP: diagnostic `start` → `answer` ×N (chained) → `assistant/turn`. Per-VU unique synthetic learner + tenant, `X-MS-CLIENT-PRINCIPAL*` headers. |
| `learning_voice.js` | k6 WS (`k6/ws`): opens `/ws/learning-voice`, relays `turn` frames, measures send→`turn.result` RTT, closes with `bye`. |
| `serve_learning_routes.py` | Local real-socket server mounting the **real** `register_learning_api` blueprint (in-memory repo, no DB/model) for the hermetic text smoke. Port 8788. |
| `serve_learning_voice.py` | Local real-socket server mounting the **real** `LearnerVoiceSocketHandler` over `flask_sock`. Port 8789. `--fixture-brain` isolates pure transport. |
| `run_text_smoke.sh` | Boots `serve_learning_routes.py`, waits, runs `learning_tutor.js` `SMOKE=1`, tears down. No-ops (exit 0) if k6 missing. |
| `run_voice_smoke.sh` | Boots `serve_learning_voice.py` (fixture brain by default), waits, runs `learning_voice.js` `SMOKE=1`, tears down. |

## What is gated vs. exercised (read this — it is the honesty contract)

- **Text:** the hard latency SLO is scoped to `route:diagnostic` only — the
  genuinely deterministic in-memory engine. `assistant/turn` is still fired for
  full entry-point coverage and functionally checked (`200` + `blocks[]`), but
  its latency is **model-bound** (the prose planner), so it is reported
  separately (`assistant_turn_ms`) and **not gated**. Gating transport SLOs on an
  unconfigured/model-bound path would be a dishonest red/green.
- **Voice:** the hermetic gate measures **transport** (connect / auth /
  frame-relay RTT) using the fixture brain. The model is the same prose planner
  already covered by the text path, so wiring it here would only re-measure model
  latency. Set `FIXTURE_BRAIN=0` to attach the real brain deliberately.

## SLOs (enforced as k6 thresholds — the run exits non-zero if breached)

| Budget | Staging | Local smoke | Override env |
|---|---|---|---|
| p95 latency | < 400 ms | < 800 ms | `P95_BUDGET_MS` |
| p99 latency | < 800 ms | < 1500 ms | `P99_BUDGET_MS` |
| Error / WS-session-error rate | < 1% | < 1% | `ERROR_BUDGET` |
| `journey_completed` / `connect_ok` / `turn_result` | > 99% | > 99% | — |

(Same budget convention as the agent-mesh smoke above.) The gate genuinely
fails: tightening the budget (`P95_BUDGET_MS=0`) makes k6 exit `99`.

## Running

### Local smokes (hermetic, no creds, no Azure)

```bash
make loadtest-text-smoke     # diagnostic transport gate + assistant/turn coverage
make loadtest-voice-smoke    # voice broker transport gate (fixture brain)
```

Reports land in `data/c1/learning_tutor_smoke_report.json` and
`data/c1/learning_voice_smoke_report.json`.

### Staging ramps (manual, deliberate — spend + shared capacity)

50 → 250 → 500 → 1000 VUs over ~6 min. Run with a **named operator** and only
with explicit go-ahead:

```bash
cd backend
# Text — diagnostic-only by default (model-free, cheap). Add DIAGNOSTIC_ONLY=0 to
# include assistant/turn (hits Azure OpenAI $).
BASE_URL=https://staging-sen.wulo.ai OPERATOR=ayo \
  k6 run loadtest/learning_tutor.js

# Voice — fixture brain by default (transport ceiling). FIXTURE_BRAIN=0 attaches
# the real brain ($) but never streams audio to Azure VoiceLive.
BASE_URL=https://staging-sen.wulo.ai OPERATOR=ayo \
  k6 run loadtest/learning_voice.js
```

## Honesty caveats (keep surfacing)

- **Synthetic only.** Synthetic learners, synthetic answers, JSON-only voice
  frames. No learner data; no real audio ever reaches Azure VoiceLive.
- **Smoke ≠ production latency.** The hermetic smokes hit an in-process
  in-memory repo (no DB, no model), so their numbers prove only that the harness
  + SLO gate work. Real numbers come from the staging ramp.
- **Real spend.** `assistant/turn` (text, `DIAGNOSTIC_ONLY=0`) and the real voice
  brain (`FIXTURE_BRAIN=0`) hit Azure OpenAI. Keep ramps deliberate.
- **One replica until Phase 3.** Staging is capped at `scaleMaxReplicas: 1`
  (`infra/resources.bicep`), so a staging ramp measures **one container's
  ceiling**, not how the system scales. The autoscaling change is drafted in
  [`infra/loadtest-autoscale.bicep-diff.md`](../../infra/loadtest-autoscale.bicep-diff.md)
  and is **not applied**.
- **Trust the dashboards.** After a text ramp, confirm `GET /api/learning/metrics`
  shows non-zero Prometheus counters matching the driven volume. Flag any tile
  that stays green while p99 is blown.
