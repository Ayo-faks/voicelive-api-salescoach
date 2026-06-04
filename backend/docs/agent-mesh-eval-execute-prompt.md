# Execution prompt — Agent Mesh Eval Plan (paste into a new session)

Copy everything in the fenced block below into a fresh agent session to start
building. It points the agent at the signed-off plan and enforces the same
guardrails this plan was designed under.

```
You are implementing a SIGNED-OFF plan. Do NOT redesign it. Build it incrementally,
one increment at a time, stopping for review after each.

PLAN (authoritative): read `backend/docs/agent-mesh-eval-plan.md` in full before
writing any code. That file is the single source of truth for scope, order, and
constraints. If anything you want to do conflicts with it, STOP and ask.

REPO: voicelive-api-salescoach. Work happens in `backend/`. The eventual merge
target is `main`. Current dev branch is `feat/pathfinder-learn-ownership-multichild`
— confirm the branch with me before committing anything.

NON-NEGOTIABLE CONSTRAINTS (from the plan):
- Dark by default behind AGENT_MESH_ENABLED + per-suite flags. Nothing goes live.
- Online = shadow only. Rollback = proposal only (never auto-execute a rollback).
- New files only, EXCEPT the sanctioned edits: the clean committed eval files
  (`src/learning/eval/harness.py`, eval `__init__`) and the untracked mesh files
  (`src/agents/*`, `observability_kql.py`, `scripts/run_observability_gate.py`).
- DO NOT TOUCH the dirty files: observability.py, app.py, api.py,
  insights_service.py, storage*.py, profile_config.py, tts/routes.py + their tests.
- No new runtime deps. Reuse run_suite / ProbeCase.
- No real PII in any fixture. Safeguarding personas (Track B) are synthetic-only,
  non-graphic, human-reviewed, with all notifications redirected to a sink.

THE harness.py EDIT IS ADDITIVE-ONLY. Before changing it, write a regression test
proving `default_probes()` yields identical counts/pass_rate/passed before and
after the edit. Append (never reorder) the new ProbeCategory members; new
thresholds must default to a no-op for existing suites.

START HERE — Track A, increment 1 ONLY:
1. Safeguarding offline probes + handler + JSON fixtures + unit tests, mirroring
   the existing `src/learning/eval/safety_probes.py` pattern (default_probes() +
   fixture_handler).
2. Then the additive harness.py extension + its before/after regression test.
Run the unit test suite, show me the diff and the test output, and WAIT for my
review before starting increment 2.

After the mesh triad (1–6b), Track A continues with per-agent suites A8–A13 for the
OTHER user-facing agents: text tutor (assistant_llm.py), voice tutor
(learner_voice_llm.py), live voice profiles (learner/learner_ask tool handlers),
insights agent (insights_service.py) and planning service (planning_service.py) —
BOTH adapter-only / DO-NOT-EDIT — and the safeguarding LLM classifier
(classifier.py). Do NOT start A8–A13 until 1–6b are green. See the plan for flags.

Track B (synthetic population) is NOT in this first pass — it begins only after
Track A increments 1–6 are green. Do not start it yet.

If at any point you are blocked or uncertain, ask rather than guessing. Do not
brute-force around a guardrail.
```
