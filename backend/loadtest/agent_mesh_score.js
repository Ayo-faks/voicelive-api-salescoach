// k6 load test for the agent-mesh synthetic-scoring route.
//
// Drives REAL HTTP against POST /internal/agent-mesh/score — the same route the
// deployed staging stack serves (dark-by-default behind AGENT_MESH_ENABLED +
// AGENT_MESH_SCORE_ROUTE_V1). Every request carries `synthetic: true` and a
// named operator, so this only ever exercises the synthetic load path; it never
// touches a real learner.
//
// Two modes:
//   * SMOKE=1  -> 1 VU / 5s, gentle SLOs. Hermetic CI check that the script and
//                 SLO wiring work against the local smoke server.
//   * default  -> staged ramp 50 -> 250 -> 500 -> 1000 VUs against staging.
//
// SLOs are enforced as k6 `thresholds`, so the process exits non-zero if a
// latency/error budget is breached — i.e. the load test can genuinely fail.
//
// Honesty caveats (keep surfacing):
//   * The local smoke hits an in-process fixture classifier (no DB, no model),
//     so its latency is NOT representative of production — it only proves the
//     harness + SLO gate work. The real numbers come from the staging ramp.
//   * The staging ramp spends real shared capacity; run it deliberately, with a
//     named operator, and only with explicit go-ahead.
//
// Run:
//   # local smoke (needs loadtest/serve_score_route.py running on :8787):
//   SMOKE=1 BASE_URL=http://127.0.0.1:8787 k6 run loadtest/agent_mesh_score.js
//   # staging ramp (manual, deliberate):
//   BASE_URL=https://staging-sen.wulo.ai OPERATOR=ayo \
//     AGENT_MESH_SCORE_TOKEN=$TOKEN k6 run loadtest/agent_mesh_score.js

import http from "k6/http";
import { check } from "k6";
import { Rate, Trend } from "k6/metrics";

const BASE_URL = (__ENV.BASE_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const SCORE_URL = BASE_URL + "/internal/agent-mesh/score";
const OPERATOR = __ENV.OPERATOR || "loadtest";
const TOKEN = __ENV.AGENT_MESH_SCORE_TOKEN || "";
const SMOKE = __ENV.SMOKE === "1" || __ENV.SMOKE === "true";
const REPORT_PATH =
  __ENV.REPORT_PATH ||
  (SMOKE
    ? "data/c1/b3_k6_smoke_report.json"
    : "data/c1/b3_k6_loadtest_report.json");

// Custom metrics for the summary.
const outcomeOk = new Rate("outcome_present");
const scoreLatency = new Trend("score_latency_ms", true);

// SLOs (latency budget + error budget). Smoke uses looser latency because the
// local fixture server is single-process; staging uses the production budget.
const P99_BUDGET_MS = SMOKE
  ? Number(__ENV.P99_BUDGET_MS || 1500)
  : Number(__ENV.P99_BUDGET_MS || 800);
const P95_BUDGET_MS = SMOKE
  ? Number(__ENV.P95_BUDGET_MS || 800)
  : Number(__ENV.P95_BUDGET_MS || 400);
const ERROR_BUDGET = Number(__ENV.ERROR_BUDGET || 0.01); // <1% non-2xx

// Purely synthetic, benign tutor prompts — no learner data, nothing graphic.
const PROMPTS = [
  "Can you explain how do i simplify a fraction?",
  "How do I solve a linear equation?",
  "What is the capital of France?",
  "Explain how a verb must agree with its subject.",
  "What is photosynthesis in simple terms?",
];

// Make the summary emit p50/p95/p99 (k6 omits them by default).
const SUMMARY_TREND_STATS = ["avg", "min", "med", "p(50)", "p(90)", "p(95)", "p(99)", "max"];

export const options = SMOKE
  ? {
      vus: 1,
      duration: "5s",
      summaryTrendStats: SUMMARY_TREND_STATS,
      thresholds: {
        http_req_failed: [`rate<${ERROR_BUDGET}`],
        "http_req_duration{expected_response:true}": [`p(95)<${P95_BUDGET_MS}`, `p(99)<${P99_BUDGET_MS}`],
        outcome_present: ["rate>0.99"],
      },
    }
  : {
      summaryTrendStats: SUMMARY_TREND_STATS,
      stages: [
        { duration: "30s", target: 50 },
        { duration: "1m", target: 250 },
        { duration: "1m", target: 500 },
        { duration: "2m", target: 1000 },
        { duration: "1m", target: 1000 },
        { duration: "30s", target: 0 },
      ],
      thresholds: {
        http_req_failed: [`rate<${ERROR_BUDGET}`],
        "http_req_duration{expected_response:true}": [`p(95)<${P95_BUDGET_MS}`, `p(99)<${P99_BUDGET_MS}`],
        outcome_present: ["rate>0.99"],
      },
    };

export default function () {
  const prompt = PROMPTS[Math.floor(Math.random() * PROMPTS.length)];
  const headers = { "Content-Type": "application/json" };
  if (TOKEN) {
    headers["Authorization"] = "Bearer " + TOKEN;
  }
  const body = JSON.stringify({
    synthetic: true,
    operator: OPERATOR,
    prompt: prompt,
    agent: "tutor",
  });

  const res = http.post(SCORE_URL, body, { headers: headers });
  scoreLatency.add(res.timings.duration);

  const ok = check(res, {
    "status is 200": (r) => r.status === 200,
    "synthetic echoed": (r) => {
      try {
        return r.json("synthetic") === true;
      } catch (e) {
        return false;
      }
    },
  });

  let hasOutcome = false;
  try {
    hasOutcome = typeof res.json("outcome") === "string";
  } catch (e) {
    hasOutcome = false;
  }
  outcomeOk.add(hasOutcome);

  return ok;
}

export function handleSummary(data) {
  const metrics = data.metrics || {};
  const dur = (metrics.http_req_duration && metrics.http_req_duration.values) || {};
  const failed = (metrics.http_req_failed && metrics.http_req_failed.values) || {};

  const report = {
    mode: SMOKE ? "k6-local-smoke" : "k6-live-staging",
    base_url: BASE_URL,
    score_url: SCORE_URL,
    operator: OPERATOR,
    run_at: new Date().toISOString(),
    slo: {
      p95_budget_ms: P95_BUDGET_MS,
      p99_budget_ms: P99_BUDGET_MS,
      error_budget: ERROR_BUDGET,
    },
    latency_ms: {
      p50: dur["p(50)"] !== undefined ? dur["p(50)"] : dur.med,
      p90: dur["p(90)"],
      p95: dur["p(95)"],
      p99: dur["p(99)"],
      max: dur.max,
      avg: dur.avg,
    },
    requests: (metrics.http_reqs && metrics.http_reqs.values && metrics.http_reqs.values.count) || 0,
    error_rate: failed.rate,
    // k6 sets a non-zero exit code when any threshold fails; mirror the verdict
    // here so the artifact is self-describing.
    thresholds_passed: Object.values(metrics)
      .filter((m) => m && m.thresholds)
      .every((m) =>
        Object.values(m.thresholds).every((t) => t.ok !== false)
      ),
    note:
      "Synthetic load only (synthetic:true, named operator). Local smoke hits an " +
      "in-process fixture classifier and is NOT representative of production latency; " +
      "only the k6-live-staging mode reflects the deployed stack.",
  };

  const out = {};
  out[REPORT_PATH] = JSON.stringify(report, null, 2);
  out["stdout"] = textSummary(report);
  return out;
}

function textSummary(report) {
  const l = report.latency_ms;
  return (
    `\n[${report.mode}] ${report.score_url}\n` +
    `  requests=${report.requests} error_rate=${report.error_rate}\n` +
    `  p50=${l.p50}ms p95=${l.p95}ms p99=${l.p99}ms (budget p95<${report.slo.p95_budget_ms} p99<${report.slo.p99_budget_ms})\n` +
    `  thresholds_passed=${report.thresholds_passed}\n`
  );
}
