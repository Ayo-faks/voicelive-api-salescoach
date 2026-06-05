// k6 load test for the Pathfinder Learn VOICE FRAME BROKER (/ws/learning-voice).
//
// Opens N concurrent WebSocket sessions against the REAL learner-voice broker
// (LearnerVoiceSocketHandler) and streams JSON `turn` frames, measuring YOUR
// broker's connect + frame-relay cost. In production the browser streams audio
// directly to Azure VoiceLive; the backend only authenticates the socket and
// brokers JSON frames — so this measures exactly your code, NOT Azure's bill.
// No audio is ever sent here.
//
// Wire protocol (see services/learner_voice_websocket_handler.py):
//   server -> {"type":"connected","transport":"learning-voice"}
//   client -> {"type":"turn","question":..., "exam":..., "subject":..., ...}
//   server -> {"type":"turn.result","blocks":[...]}
//   client -> {"type":"bye"}   server -> {"type":"bye"}
//
// Two modes:
//   * SMOKE=1  -> 1 VU / 5s, looser latency. Hermetic CI check against
//                 loadtest/serve_learning_voice.py.
//   * default  -> staged ramp of concurrent sockets against staging.
//
// SLOs are enforced as k6 `thresholds`; a breached frame-latency/error budget
// exits non-zero.
//
// Honesty caveats:
//   * Local smoke runs an in-process brain (in-memory repo, no DB/model), so
//     latency is NOT production-representative — it only proves the harness +
//     SLO gate work. Use --fixture-brain on the server to isolate pure transport.
//   * A staging WS ramp relays JSON only, but the upstream brain may hit Azure
//     OpenAI ($) and the app is capped at 1 replica until Phase 3 autoscaling is
//     applied. Run deliberately, named operator, explicit go-ahead. NEVER stream
//     real audio to Azure VoiceLive from a load test (quota + real $$).
//
// Run:
//   # local smoke (needs loadtest/serve_learning_voice.py on :8789):
//   SMOKE=1 BASE_URL=http://127.0.0.1:8789 k6 run loadtest/learning_voice.js
//   # staging ramp (manual, deliberate):
//   BASE_URL=https://staging-sen.wulo.ai OPERATOR=ayo \
//     k6 run loadtest/learning_voice.js

import ws from "k6/ws";
import { check } from "k6";
import { Rate, Trend } from "k6/metrics";

const RAW_BASE = (__ENV.BASE_URL || "http://127.0.0.1:8789").replace(/\/$/, "");
const WS_URL = RAW_BASE.replace(/^http/, "ws") + "/ws/learning-voice";
const OPERATOR = __ENV.OPERATOR || "loadtest";
const SMOKE = __ENV.SMOKE === "1" || __ENV.SMOKE === "true";
// Turns streamed per socket session.
const TURNS_PER_SESSION = Number(__ENV.TURNS_PER_SESSION || 3);
const REPORT_PATH =
  __ENV.REPORT_PATH ||
  (SMOKE
    ? "data/c1/learning_voice_smoke_report.json"
    : "data/c1/learning_voice_loadtest_report.json");

// Custom metrics.
const connectOk = new Rate("ws_connect_ok");
const turnResultOk = new Rate("turn_result_present");
const turnRtt = new Trend("turn_rtt_ms", true);
const sessionErrors = new Rate("ws_session_errors");

// SLOs. Frame relay should be fast; smoke is looser (single process).
const P99_BUDGET_MS = SMOKE
  ? Number(__ENV.P99_BUDGET_MS || 1500)
  : Number(__ENV.P99_BUDGET_MS || 800);
const P95_BUDGET_MS = SMOKE
  ? Number(__ENV.P95_BUDGET_MS || 800)
  : Number(__ENV.P95_BUDGET_MS || 400);
const ERROR_BUDGET = Number(__ENV.ERROR_BUDGET || 0.01);

const QUESTIONS = [
  "Can you explain how to simplify a fraction?",
  "How do I solve a linear equation?",
  "What is the capital of France?",
  "Explain how a verb must agree with its subject.",
  "What is photosynthesis in simple terms?",
];

const SUMMARY_TREND_STATS = ["avg", "min", "med", "p(50)", "p(90)", "p(95)", "p(99)", "max"];

export const options = SMOKE
  ? {
      vus: 1,
      duration: "5s",
      summaryTrendStats: SUMMARY_TREND_STATS,
      thresholds: {
        ws_connect_ok: ["rate>0.99"],
        turn_result_present: ["rate>0.99"],
        ws_session_errors: [`rate<${ERROR_BUDGET}`],
        turn_rtt_ms: [`p(95)<${P95_BUDGET_MS}`, `p(99)<${P99_BUDGET_MS}`],
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
        ws_connect_ok: ["rate>0.99"],
        turn_result_present: ["rate>0.99"],
        ws_session_errors: [`rate<${ERROR_BUDGET}`],
        turn_rtt_ms: [`p(95)<${P95_BUDGET_MS}`, `p(99)<${P99_BUDGET_MS}`],
      },
    };

export default function () {
  let turnsSent = 0;
  let turnsAnswered = 0;
  let pendingSince = 0;
  let connected = false;
  let erroredThisSession = false;

  function sendTurn(socket) {
    const q = QUESTIONS[(turnsSent + __VU) % QUESTIONS.length];
    pendingSince = Date.now();
    socket.send(
      JSON.stringify({
        type: "turn",
        synthetic: true,
        operator: OPERATOR,
        question: q,
        exam: "WAEC",
        class_year: "ss3",
        subject: "mathematics",
        lang: "en-NG",
      })
    );
    turnsSent++;
  }

  const res = ws.connect(WS_URL, {}, function (socket) {
    socket.on("message", function (raw) {
      let frame;
      try {
        frame = JSON.parse(raw);
      } catch (e) {
        return;
      }
      const ftype = frame.type;
      if (ftype === "connected") {
        connected = true;
        connectOk.add(true);
        sendTurn(socket);
        return;
      }
      if (ftype === "turn.result") {
        if (pendingSince) {
          turnRtt.add(Date.now() - pendingSince);
          pendingSince = 0;
        }
        turnsAnswered++;
        const hasBlocks = Array.isArray(frame.blocks);
        turnResultOk.add(hasBlocks);
        if (turnsSent < TURNS_PER_SESSION) {
          sendTurn(socket);
        } else {
          socket.send(JSON.stringify({ type: "bye" }));
        }
        return;
      }
      if (ftype === "error") {
        erroredThisSession = true;
        return;
      }
      if (ftype === "bye") {
        socket.close();
        return;
      }
    });

    socket.on("error", function () {
      erroredThisSession = true;
    });

    // Safety valve: never let a stuck socket hang the VU.
    socket.setTimeout(function () {
      socket.close();
    }, SMOKE ? 4000 : 15000);
  });

  if (!connected) {
    connectOk.add(false);
  }
  sessionErrors.add(erroredThisSession || turnsAnswered === 0);

  check(res, {
    "ws handshake 101": (r) => r && r.status === 101,
  });
}

export function handleSummary(data) {
  const metrics = data.metrics || {};
  const rtt = (metrics.turn_rtt_ms && metrics.turn_rtt_ms.values) || {};
  const connect = (metrics.ws_connect_ok && metrics.ws_connect_ok.values) || {};
  const result = (metrics.turn_result_present && metrics.turn_result_present.values) || {};
  const errs = (metrics.ws_session_errors && metrics.ws_session_errors.values) || {};
  const sessions = (metrics.ws_sessions && metrics.ws_sessions.values && metrics.ws_sessions.values.count) || 0;

  const report = {
    mode: SMOKE ? "k6-local-smoke" : "k6-live-staging",
    surface: "voice-broker",
    ws_url: WS_URL,
    operator: OPERATOR,
    turns_per_session: TURNS_PER_SESSION,
    run_at: new Date().toISOString(),
    slo: {
      p95_budget_ms: P95_BUDGET_MS,
      p99_budget_ms: P99_BUDGET_MS,
      error_budget: ERROR_BUDGET,
    },
    turn_rtt_ms: {
      p50: rtt["p(50)"] !== undefined ? rtt["p(50)"] : rtt.med,
      p90: rtt["p(90)"],
      p95: rtt["p(95)"],
      p99: rtt["p(99)"],
      max: rtt.max,
      avg: rtt.avg,
    },
    sessions: sessions,
    connect_ok_rate: connect.rate,
    turn_result_rate: result.rate,
    session_error_rate: errs.rate,
    thresholds_passed: Object.values(metrics)
      .filter((m) => m && m.thresholds)
      .every((m) => Object.values(m.thresholds).every((t) => t.ok !== false)),
    note:
      "Synthetic JSON frames only — no audio, never touches Azure VoiceLive. " +
      "Local smoke runs an in-process brain and is NOT production-representative; " +
      "use --fixture-brain on the server to isolate pure transport cost. Staging " +
      "is capped at 1 replica until Phase 3 autoscaling is applied.",
  };

  const out = {};
  out[REPORT_PATH] = JSON.stringify(report, null, 2);
  out["stdout"] = textSummary(report);
  return out;
}

function textSummary(report) {
  const r = report.turn_rtt_ms;
  return (
    `\n[${report.mode}] ${report.surface} ${report.ws_url}\n` +
    `  sessions=${report.sessions} connect_ok=${report.connect_ok_rate} ` +
    `turn_result=${report.turn_result_rate} session_errors=${report.session_error_rate}\n` +
    `  turn_rtt p50=${r.p50}ms p95=${r.p95}ms p99=${r.p99}ms (budget p95<${report.slo.p95_budget_ms} p99<${report.slo.p99_budget_ms})\n` +
    `  thresholds_passed=${report.thresholds_passed}\n`
  );
}
