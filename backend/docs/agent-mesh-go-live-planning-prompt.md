# Prompt — plan the pending implementations to go live (gates 2 → 3 → 4)

> Hand this to a planning agent. It produces a **plan**, not code. Read the
> binding context first, then emit the deliverables in the exact shape requested.

## Role

You are planning the remaining work to take the **agent-mesh eval** implementation
from "dark scaffolds + green offline gate" to **live**, in the order below. You are
extending a **signed-off** plan — do NOT redesign it, do NOT cross any go-live gate
in code, and do NOT flip anything live. Output a sequenced, dependency-aware plan
with acceptance criteria, owners, and rollback per step.

## Binding context (read before planning)

- Master plan (signed): `backend/docs/agent-mesh-eval-plan.md` — do not change the
  design; build incrementally.
- Go-live runbook: `backend/docs/agent-mesh-go-live-runbook.md` — the gate 2→3→4
  sequence and per-gate rollback are authoritative.
- Track B/C scaffold: `backend/docs/agent-mesh-trackb-trackc-scaffold.md`.
- Cron runbook: `backend/docs/agent-mesh-cron-runbook.md`.
- Session progress (what's built + green): `/memories/session/agent-mesh-eval-progress.md`.

### Non-negotiable constraints (carry into every task)

- **Dark-by-default.** Every new capability ships behind its own flag gated on the
  master flag `AGENT_MESH_ENABLED`; truthy set `{"1","true","yes","on","enabled"}`.
- **New files only**, except the already-sanctioned additive edits (`harness.py`
  additive-only, `eval/__init__.py` exports). Do **not** touch the unrelated dirty
  `pathfinder-learn-ownership-multichild` files.
- **No live/online weight updates.** All learning is offline-trained → batch-scored
  by Track A → shadow-run → human-promoted.
- **Safeguarding veto stays 100% deterministic and human-owned.** Nothing learns or
  overrides it. Track C may only learn a drift *baseline*.
- **No real PII.** Synthetic-only personas; all notifications redirect to a sink.
- **No new runtime deps.** Any load tool (locust/k6) is **dev/test-only**, gated.
- Tests live in `backend/tests/unit`; run under the venv at `/home/ayoola/sen/.venv`.
  Scoped sweep keyword set: `agent|eval|gate|probe|harness|persona|population|b3|
  driver|sink|drift|dryrun|c1|policy|selector|cron|rollback`.

## Current state (do not re-plan what's done)

- **Gate 1 (offline merge-gate):** Track A inc 1–3 + A8–A13 — BUILT, GREEN, wired.
- **Gate 2 plumbing (online shadow):** durable sink, drift detector, rollback
  adapter, cron scaffold (`suspend: true`), dry-run proof (6b) — BUILT, dark.
- **Gate 3 driver (B3):** load/stress driver + notifier→sink pre-flight — BUILT,
  suspended; drives the in-process B2 fixture, NOT a live staging handler.
- **Gate 4 stub (C1):** `LearnedItemSelector` proposes-only at the selection seam —
  BUILT, permanently dark (no policy artifact exists).
- B3 + C1 + go-live runbook are **uncommitted**.

## Plan these 5 workstreams in order (each gates the next)

1. **Commit the pending dark scope.** Stage only the new agent-mesh files (B3, C1,
   runbook + sanctioned `eval/__init__.py` edit); exclude all unrelated dirty work.
   Verify no `__pycache__`. State the exact branch/commit/merge steps.
2. **Monitoring dashboards on the existing gate JSON (unblocks gate 2).** Define the
   tiles/queries consuming the dashboard-shaped report: merge-gate verdict,
   false-positive rate, veto-rate drift, rollback proposals. Specify the data
   source (durable sink / gate JSON), alert thresholds, and on-call routing. This is
   the highest-leverage missing piece — without it, gate 2 is blind.
3. **Provision history + flip gate 2 in shadow.** `agent-mesh-history` PVC, set the
   flags + `suspend: false`, define the soak window and the exact pass criteria
   before gate 3 may open. Include the symmetric rollback.
4. **Stand up staging + run the gate 3 load test (B3).** Wire a real non-prod
   staging handler into B3 (replacing the in-process fixture); add the dev-only load
   tool behind its flag; wire a capture-only notifier; author/scale toward the
   2000+ persona target. Define the ramp, the "first component bends" stop
   criterion, and rollback (`suspend()`).
5. **Offline training + persona corpus → gate 4 (C1).** Plan the dev/test-only
   training harness that produces a `NextBestQuestionPolicy` artifact, the Track A
   batch-score proof that it beats round-robin, the shadow-review window, and the
   gated `promote()`. Include rollback (`suspend()` → round-robin byte-for-byte).

## Required output shape

For **each** of the 5 workstreams, produce:

- **Goal** (one sentence) and the gate it unblocks.
- **Tasks** — ordered, each a new file or sanctioned edit, with the flag it sits
  behind and whether it's code / infra / ops / content.
- **Dependencies** — what must be green first.
- **Acceptance criteria** — testable; name the test file(s) or the dashboard/alert.
- **Rollback** — the single action that returns to dark.
- **Owner role** — who signs off the go-live decision.

Then emit:

- A **dependency graph** (Mermaid) of the 5 workstreams and their gates.
- A **risk register**: top 5 risks (e.g. dashboard not consuming JSON, staging
  parity, persona corpus authoring cost, training artifact provenance) with
  mitigations.
- An explicit **"do NOT do yet"** list (anything that would cross a gate early).

## Guardrails for the planner

- Do not write production code in the plan output — describe tasks and acceptance.
- Do not propose anything that violates a non-negotiable constraint above.
- If a step requires a human decision (PVC, staging env, corpus sign-off, policy
  promotion), mark it **[human gate]** and stop the automatable chain there.
- Keep every online action **proposal/shadow only** until its gate is human-approved.
