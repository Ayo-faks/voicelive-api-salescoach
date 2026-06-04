# Execution prompt v2 — Agent Mesh Eval + Self-Learning Plan

Paste the fenced block below into a fresh agent session to start building. It
points the agent at the signed-off plan, restates the guardrails, and adds the
success-metric (observability tile) and Track C (self-learning) context the v1
prompt predates.

```
You are implementing a SIGNED-OFF plan. Do NOT redesign it. Build it incrementally,
one increment at a time, stopping for review after each.

PLAN (authoritative): read `backend/docs/agent-mesh-eval-plan.md` IN FULL before
writing any code — including the "Track C", "Success metrics", and
"Pre-registered thresholds (SM-D1..SM-D4)" sections. That file is the single
source of truth for scope, order, constraints, and the definition of done. If
anything you want to do conflicts with it, STOP and ask.

REPO: voicelive-api-salescoach. Work happens in `backend/`. The eventual merge
target is `main`. Current dev branch is `feat/pathfinder-learn-ownership-multichild`
— confirm the branch with me before committing anything.

NON-NEGOTIABLE CONSTRAINTS (from the plan):
- Dark by default behind AGENT_MESH_ENABLED + per-suite flags. Nothing goes live.
- Online = shadow only. Rollback = proposal only (never auto-execute a rollback).
- Self-learning (Track C) = offline-trained, batch-scored by the Track A harness,
  shadow-run behind a flag, then HUMAN-PROMOTED. No live/online weight updates.
- The safeguarding/veto decision stays 100% deterministic and auditable. Track C
  may learn a DRIFT BASELINE only (C4) — never the veto itself.
- New files only, EXCEPT the sanctioned edits: the clean committed eval files
  (`src/learning/eval/harness.py`, eval `__init__`) and the untracked mesh files
  (`src/agents/*`, `observability_kql.py`, `scripts/run_observability_gate.py`).
- DO NOT TOUCH the dirty files: observability.py, app.py, api.py,
  insights_service.py, planning_service.py, storage*.py, profile_config.py,
  tts/routes.py + their tests. Evaluate insights_service.py / planning_service.py
  (A11/A12) via ADAPTER-ONLY probe handlers that call them — never edit them.
- No new runtime deps. Reuse run_suite / ProbeCase.
- No real PII in any fixture. Safeguarding personas (Track B) are synthetic-only,
  non-graphic, human-reviewed, with all notifications redirected to a sink.

THE harness.py EDIT IS ADDITIVE-ONLY. Before changing it, write a regression test
proving `default_probes()` yields identical counts/pass_rate/passed before and
after the edit. Append (never reorder) new ProbeCategory members; new thresholds
must default to a no-op for existing suites.

SUCCESS IS TILE-SHAPED. Each increment's output should map to an observability
tile described in the plan's "Success metrics" section (e.g. merge-gate verdict,
false-positive rate, mesh gate status, drift/rollback proposals). When you finish
an increment, state which tile/field it feeds and what "green" means per SM-D1..D4.
Do NOT wire new tiles into the dirty observability.py/api.py — surface fields via
the sanctioned mesh/eval files and tell me where a future dashboard edit would read
them.

START HERE — Track A, increment 1 ONLY:
1. Safeguarding offline probes + handler + JSON fixtures + unit tests, mirroring
   the existing `src/learning/eval/safety_probes.py` pattern (default_probes() +
   fixture_handler).
2. Then the additive harness.py extension + its before/after regression test
   (adds safeguarding/benign categories + false_positive_rate, defaulting to a
   no-op for existing suites per SM-D1/SM-D2).
Run the unit test suite, show me the diff and the test output, map the result to
its success tile, and WAIT for my review before starting increment 2.

SEQUENCING (do not jump ahead):
- Track A mesh triad: increments 1–6b, then per-agent suites A8–A13 (text tutor,
  voice tutor, live voice profiles, insights [adapter-only], planning
  [adapter-only], safeguarding LLM classifier). A8–A13 only after 1–6b green.
- Track B (synthetic population) only after Track A increments 1–6 green.
- Track C (self-learning; C1 next-best-question first) only after Track A
  increments 1–3 (offline merge-gate) green — that harness is C1's batch scorer.
  C1 must beat round-robin by the pre-registered margin (SM-D4) in BATCH before any
  shadow run.

If at any point you are blocked or uncertain, ask rather than guessing. Do not
brute-force around a guardrail.
```
