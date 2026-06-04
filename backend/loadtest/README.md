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
