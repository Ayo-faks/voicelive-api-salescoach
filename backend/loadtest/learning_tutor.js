// k6 load test for the Pathfinder Learn TEXT TUTOR journey.
//
// Drives the REAL learner-facing routes a tutor session uses, in order:
//   POST /api/learning/diagnostic/start
//   POST /api/learning/diagnostic/answer   (xN, chaining next_item.item_id)
//   POST /api/learning/assistant/turn      (optional; skipped in diagnostic-only mode)
//
// Each VU is a distinct synthetic learner (unique student_id/tenant_id) carrying
// X-MS-CLIENT-PRINCIPAL* headers, so a "thousands of users" ramp models real
// concurrent learners walking a diagnostic and then asking the assistant.
//
// Two modes:
//   * SMOKE=1  -> 1 VU / 5s, looser latency. Hermetic CI check that the script +
//                 SLO wiring work against loadtest/serve_learning_routes.py.
//   * default  -> staged ramp 50 -> 250 -> 500 -> 1000 VUs against staging.
//
// SLOs are enforced as k6 `thresholds`, so the process exits non-zero if a
// latency/error budget is breached — the load test can genuinely fail.
//
// Honesty caveats (keep surfacing):
//   * The local smoke hits an in-process in-memory repo (no DB, no model), so its
//     latency is NOT representative of production — it only proves the harness +
//     SLO gate work. Real numbers come from the staging ramp.
//   * The hard latency SLO is scoped to the DIAGNOSTIC transport (route:diagnostic)
//     only — the genuinely deterministic in-memory engine. `assistant/turn` is
//     still exercised for entry-point coverage and functionally checked (200 +
//     blocks), but its latency is model-bound (the prose planner), so it is
//     reported separately (assistant_turn_ms) and NOT gated. Gating transport SLOs
//     on an unconfigured/model-bound path would be a dishonest red/green.
//   * On staging the diagnostic journey is model-free, but `assistant/turn` may
//     hit Azure OpenAI ($). DIAGNOSTIC_ONLY=1 (the staging default below) keeps a
//     "thousands of users" ramp cheap; set DIAGNOSTIC_ONLY=0 to include the
//     assistant turn deliberately.
//   * The staging ramp spends real shared capacity AND is capped at 1 replica
//     until the Phase 3 autoscaling change is applied — so it measures ONE
//     container's ceiling, not how the system scales. Run it deliberately, with a
//     named operator, only with explicit go-ahead.
//
// Run:
//   # local smoke (needs loadtest/serve_learning_routes.py on :8788):
//   SMOKE=1 BASE_URL=http://127.0.0.1:8788 k6 run loadtest/learning_tutor.js
//   # staging ramp (manual, deliberate):
//   BASE_URL=https://staging-sen.wulo.ai OPERATOR=ayo \
//     k6 run loadtest/learning_tutor.js

import http from "k6/http";
import { check } from "k6";
import { Rate, Trend } from "k6/metrics";
import encoding from "k6/encoding";

const BASE_URL = (__ENV.BASE_URL || "http://127.0.0.1:8788").replace(/\/$/, "");
const OPERATOR = __ENV.OPERATOR || "loadtest";
const SMOKE = __ENV.SMOKE === "1" || __ENV.SMOKE === "true";
// Diagnostic-only is the staging default (model-free, cheap). The hermetic smoke
// includes the assistant turn so the whole journey is exercised in CI.
const DIAGNOSTIC_ONLY =
  __ENV.DIAGNOSTIC_ONLY !== undefined
    ? __ENV.DIAGNOSTIC_ONLY === "1" || __ENV.DIAGNOSTIC_ONLY === "true"
    : !SMOKE;
// How many diagnostic answers each VU submits per journey.
const ANSWERS_PER_JOURNEY = Number(__ENV.ANSWERS_PER_JOURNEY || 5);
const REPORT_PATH =
  __ENV.REPORT_PATH ||
  (SMOKE
    ? "data/c1/learning_tutor_smoke_report.json"
    : "data/c1/learning_tutor_loadtest_report.json");

// Custom metrics for the summary.
const journeyOk = new Rate("journey_completed");
const startLatency = new Trend("diagnostic_start_ms", true);
const answerLatency = new Trend("diagnostic_answer_ms", true);
const assistantLatency = new Trend("assistant_turn_ms", true);

// SLOs (latency budget + error budget). Smoke uses looser latency because the
// local server is single-process; staging uses the production budget.
const P99_BUDGET_MS = SMOKE
  ? Number(__ENV.P99_BUDGET_MS || 1500)
  : Number(__ENV.P99_BUDGET_MS || 800);
const P95_BUDGET_MS = SMOKE
  ? Number(__ENV.P95_BUDGET_MS || 800)
  : Number(__ENV.P95_BUDGET_MS || 400);
const ERROR_BUDGET = Number(__ENV.ERROR_BUDGET || 0.01); // <1% non-2xx

// Purely synthetic, benign learner answers — no learner data.
const ANSWERS = ["A", "B", "C", "D", "12", "true", "photosynthesis"];

const SUMMARY_TREND_STATS = ["avg", "min", "med", "p(50)", "p(90)", "p(95)", "p(99)", "max"];

export const options = SMOKE
  ? {
      vus: 1,
      duration: "5s",
      summaryTrendStats: SUMMARY_TREND_STATS,
      thresholds: {
        http_req_failed: [`rate<${ERROR_BUDGET}`],
        // Gate only the deterministic diagnostic transport; assistant/turn is
        // model-bound and excluded from the hard latency budget on purpose.
        "http_req_duration{route:diagnostic,expected_response:true}": [`p(95)<${P95_BUDGET_MS}`, `p(99)<${P99_BUDGET_MS}`],
        journey_completed: ["rate>0.99"],
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
        "http_req_duration{route:diagnostic,expected_response:true}": [`p(95)<${P95_BUDGET_MS}`, `p(99)<${P99_BUDGET_MS}`],
        journey_completed: ["rate>0.99"],
      },
    };

// A distinct synthetic principal per VU+iteration so RLS sees varied learners.
// k6 has no btoa, so the base64 principal is built via the k6/encoding module.
function learnerHeaders(studentId) {
  const principal = encoding.b64encode(
    JSON.stringify({
      userId: studentId,
      userDetails: `${studentId}@loadtest.invalid`,
      identityProvider: "loadtest",
      claims: [{ typ: "name", val: `Synthetic ${studentId}` }],
    })
  );
  return {
    "Content-Type": "application/json",
    "X-MS-CLIENT-PRINCIPAL": principal,
    "X-MS-CLIENT-PRINCIPAL-ID": studentId,
    "X-MS-CLIENT-PRINCIPAL-NAME": `Synthetic ${studentId}`,
    "X-MS-CLIENT-PRINCIPAL-IDP": "loadtest",
  };
}

export default function () {
  const studentId = `ld-student-${__VU}-${__ITER}`;
  const tenantId = `ld-tenant-${__VU % 8}`;
  const headers = learnerHeaders(studentId);

  // 1) Start the diagnostic.
  const startRes = http.post(
    `${BASE_URL}/api/learning/diagnostic/start`,
    JSON.stringify({
      synthetic: true,
      operator: OPERATOR,
      tenant_id: tenantId,
      student_id: studentId,
      item_count: ANSWERS_PER_JOURNEY + 2,
    }),
    { headers, tags: { route: "diagnostic" } }
  );
  startLatency.add(startRes.timings.duration);

  let sessionId = null;
  let itemId = null;
  const startedOk = check(startRes, {
    "start 200": (r) => r.status === 200,
    "start has session": (r) => {
      try {
        sessionId = r.json("session_id");
        itemId = r.json("item.item_id");
        return typeof sessionId === "string" && typeof itemId === "string";
      } catch (e) {
        return false;
      }
    },
  });
  if (!startedOk || !sessionId || !itemId) {
    journeyOk.add(false);
    return;
  }

  // 2) Answer N items, chaining next_item.item_id (the route 409s on wrong order).
  let answered = 0;
  for (let i = 0; i < ANSWERS_PER_JOURNEY && itemId; i++) {
    const answerRes = http.post(
      `${BASE_URL}/api/learning/diagnostic/answer`,
      JSON.stringify({
        session_id: sessionId,
        item_id: itemId,
        response_text: ANSWERS[(i + __VU) % ANSWERS.length],
      }),
      { headers, tags: { route: "diagnostic" } }
    );
    answerLatency.add(answerRes.timings.duration);
    const ok = check(answerRes, { "answer 200": (r) => r.status === 200 });
    if (!ok) break;
    answered++;
    try {
      const nextItem = answerRes.json("next_item");
      const completed = answerRes.json("completed");
      itemId = nextItem ? nextItem.item_id : null;
      if (completed === true) break;
    } catch (e) {
      itemId = null;
    }
  }

  // 3) Optional assistant turn (skipped in diagnostic-only mode to bound spend).
  let assistantOk = true;
  if (!DIAGNOSTIC_ONLY) {
    const turnRes = http.post(
      `${BASE_URL}/api/learning/assistant/turn`,
      JSON.stringify({
        user_id: studentId,
        question: "Can you explain how to simplify a fraction?",
      }),
      { headers, tags: { route: "assistant_turn" } }
    );
    assistantLatency.add(turnRes.timings.duration);
    assistantOk = check(turnRes, {
      "assistant 200": (r) => r.status === 200,
      "assistant has blocks": (r) => {
        try {
          return Array.isArray(r.json("blocks"));
        } catch (e) {
          return false;
        }
      },
    });
  }

  journeyOk.add(answered > 0 && assistantOk);
}

export function handleSummary(data) {
  const metrics = data.metrics || {};
  // The hard SLO gates the diagnostic transport sub-metric, so the report's
  // headline latency reflects exactly what is gated (not the overall, which is
  // polluted by the model-bound assistant turn when DIAGNOSTIC_ONLY=0).
  const gated =
    metrics["http_req_duration{route:diagnostic,expected_response:true}"] ||
    metrics.http_req_duration ||
    {};
  const dur = gated.values || {};
  const assistant = (metrics.assistant_turn_ms && metrics.assistant_turn_ms.values) || {};
  const failed = (metrics.http_req_failed && metrics.http_req_failed.values) || {};
  const journey = (metrics.journey_completed && metrics.journey_completed.values) || {};

  const report = {
    mode: SMOKE ? "k6-local-smoke" : "k6-live-staging",
    surface: "text-tutor",
    base_url: BASE_URL,
    operator: OPERATOR,
    diagnostic_only: DIAGNOSTIC_ONLY,
    answers_per_journey: ANSWERS_PER_JOURNEY,
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
    gated_route: "diagnostic",
    assistant_turn_ms: DIAGNOSTIC_ONLY
      ? null
      : {
          p50: assistant["p(50)"] !== undefined ? assistant["p(50)"] : assistant.med,
          p95: assistant["p(95)"],
          p99: assistant["p(99)"],
          max: assistant.max,
          note: "model-bound (prose planner); exercised + functionally checked but NOT gated",
        },
    requests: (metrics.http_reqs && metrics.http_reqs.values && metrics.http_reqs.values.count) || 0,
    error_rate: failed.rate,
    journey_completed_rate: journey.rate,
    thresholds_passed: Object.values(metrics)
      .filter((m) => m && m.thresholds)
      .every((m) => Object.values(m.thresholds).every((t) => t.ok !== false)),
    note:
      "Synthetic load only (named operator, synthetic learners). Local smoke hits " +
      "an in-process in-memory repo and is NOT representative of production latency; " +
      "only the k6-live-staging mode reflects the deployed stack, and that is capped " +
      "at 1 replica until the Phase 3 autoscaling change is applied.",
  };

  const out = {};
  out[REPORT_PATH] = JSON.stringify(report, null, 2);
  out["stdout"] = textSummary(report);
  return out;
}

function textSummary(report) {
  const l = report.latency_ms;
  const a = report.assistant_turn_ms;
  return (
    `\n[${report.mode}] ${report.surface} ${report.base_url}\n` +
    `  requests=${report.requests} error_rate=${report.error_rate} ` +
    `journey_completed=${report.journey_completed_rate}\n` +
    `  diagnostic_only=${report.diagnostic_only}\n` +
    `  [gated route:diagnostic] p50=${l.p50}ms p95=${l.p95}ms p99=${l.p99}ms ` +
    `(budget p95<${report.slo.p95_budget_ms} p99<${report.slo.p99_budget_ms})\n` +
    (a ? `  [ungated assistant/turn] p95=${a.p95}ms p99=${a.p99}ms (model-bound, functional only)\n` : "") +
    `  thresholds_passed=${report.thresholds_passed}\n`
  );
}
