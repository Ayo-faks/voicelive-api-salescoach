# Planning Prompt — Agent Mesh Offline & Online Evaluations

> Paste this whole file to a coding agent as the task brief. It is a **planning +
> build** prompt: produce the plan first, get sign-off, then implement
> incrementally. Do not skip the gap table or the data-sourcing section.

---

## Role & context

You are extending the **agent mesh** in `voicelive-api-salescoach/backend`
(`src/agents/`). The mesh is nine read-only agents + an `ObservabilityGate`
coordinator, all dark behind `AGENT_MESH_ENABLED`. The same backend powers two
products that share this code:

- **Wulo** — therapist-supervised speech therapy (regulated).
- **Wulo Academy / Pathfinder Learn** — adaptive learning for **minors** (JSS–SS3).

There is already a deterministic eval harness you MUST reuse, not replace:

- `src/learning/eval/harness.py` — `ProbeCase`, `ProbeResult`, `run_suite(suite_id, probes, handler, thresholds)`, `Tier1Thresholds`, `EvalReport`, `EvalHandlerProtocol`. **No LLM traffic in the harness** — a handler returns an `OutcomeLabel` + excerpt; the harness scores against `expected_outcome`.
- `src/learning/eval/safety_probes.py` — `default_probes()`, `fixture_handler()`. Categories today: `crisis`, `jailbreak`, `pii`, `grounding`, `answer_quality`.
- `src/learning/eval/auto_rollback.py` — `RollbackPolicy`, `decide(...)`, `RollbackDecision` (currently NOT wired to the mesh).
- `src/learning/eval/cost_dashboard.py` — cost rollups.
- `GenAIOpsAgent` already runs `run_suite` + `default_probes` as the release gate; `ObservabilityGate.run_cycle(eval_handler=...)` already records its verdict.

**Hard constraints (do not violate):**
- Everything stays **dark by default** behind `AGENT_MESH_ENABLED` (+ the existing per-suite kill-switch flags `LEARNING_EVAL_HARNESS_V1`, `LEARNING_SAFETY_PROBES_V1`).
- Agents stay **read-only** and **never raise** on a bad outcome — they return verdicts.
- **New files only** unless a file is already clean; do not touch the dirty working tree.
- **No new runtime dependency** (no external eval framework).
- Reuse `run_suite` / `ProbeCase` — every new eval is a probe set + a handler, scored by the existing harness.
- This work is on `main`; do NOT port JSS3/SS3 diagnostic/exam-prep features onto the phase-0 branch.

---

## Step 1 — Produce the gap analysis (deliver this table first)

Confirm/refine this assessment before writing any code. For each agent state
whether it needs an **offline eval** (batch probe suite, pre-deploy) and/or an
**online eval** (continuous, against live/shadow traffic), and why.

| Agent | Judgement or deterministic? | Offline eval needed? | Online eval needed? | Rationale |
|---|---|---|---|---|
| `SafeguardingAgent` | judgement (veto) | **Yes — highest priority** | Yes (shadow) | child-safety veto; needs adversarial/red-team probe set + drift detection on live denials |
| `CriticAgent` | judgement (quality) | **Yes** | Optional | needs a labelled quality benchmark (uncited/empty/oversized/hallucination) |
| `GenAIOpsAgent` | runs evals | Already has offline | Yes (continuous) | promote the existing suite to a scheduled online run |
| `AIOpsAgent` | monitor | No (consumes metrics) | Already online via `--metrics` cron | monitoring, not a probe eval; just schedule it |
| `PlannerAgent` | delegates | Eval the *planner*, not the wrapper | Optional | answer-quality + tool-use correctness belongs to the planner |
| `MeshOrchestrator` | composition | Integration eval only | No | covered by gate + orchestration tests |
| `DevOpsAgent` | deterministic | No (unit tests suffice) | No | pure aggregator |
| `MigrationAgent` | deterministic | No (unit tests suffice) | No | pure classifier |
| `MemoryAgent` | infrastructure | No | No | recorder |

**Output:** a corrected table + a one-paragraph justification for each "No" so we
don't over-build evals for deterministic agents.

---

## Step 2 — Design the OFFLINE evals (batch, pre-deploy)

For each agent that needs one, build a **probe set + handler** scored by the
existing `run_suite`. Mirror the `safety_probes.py` pattern exactly.

1. **Safeguarding eval (build first).**
   - New `src/learning/eval/safeguarding_probes.py`: a `ProbeCase` suite with a new category (extend `ProbeCategory` if needed) covering: crisis/self-harm, grooming/contact-sharing, age-inappropriate content, jailbreak-to-bypass-safeguarding, PII exfiltration of a child's data, and **false-positive** cases (benign learner questions that must NOT be vetoed).
   - A `safeguarding_handler` that maps each probe prompt through `SafeguardingAgent.assess(...)` and returns the harness `OutcomeLabel` (`violation` vs `safe_response`/`answer`).
   - `Tier1Thresholds` tuned for minors: `max_crisis_misses=0`, `max_pii_leaks=0`, plus a bounded false-positive rate.
   - A `run_safeguarding_eval()` entry the gate can call.

2. **Critic eval.**
   - New `src/learning/eval/critic_probes.py`: labelled answer fixtures (good answer, uncited claim, empty, oversized, hallucinated citation) with the expected `CritiqueFinding` codes; handler runs `CriticAgent.review(...)`; score precision/recall of each finding code.

3. **Wire offline evals into the gate.**
   - Extend `ObservabilityGate.run_cycle(...)` with optional `safeguarding_handler` / `critic_handler` inputs (same optional-input pattern), record each verdict to `MemoryAgent`, and fold blocking failures into the existing `reasons`/`exit_code`. Keep dark-by-default semantics.
   - Add CLI flags to `scripts/run_observability_gate.py` (e.g. `--safeguarding`, `--critic`).

4. **Tests** for every new probe set + handler + gate wiring (table-driven, ≥10 each).

---

## Step 3 — Design the ONLINE evals (continuous, live/shadow)

Online = the same probe contracts, but run on a schedule against
production-shaped inputs, with results persisted and capable of triggering
rollback.

1. **Scheduled cron.** Define a recurring job that runs
   `ObservabilityGate.run_cycle(...)` with `--metrics` (AIOps) + the
   safeguarding/critic/genaiops suites in **shadow mode** (observe, never block
   live traffic). Document it as a Container Apps job / GitHub Actions schedule —
   do not deploy it, just produce the manifest + runbook.
2. **Durable history sink.** `MemoryAgent` is in-process and bounded. Add a thin,
   optional sink interface so each recorded outcome can be forwarded to a durable
   store, reusing the existing `PilotTelemetryService` / Application Insights OTel
   export already in `src/learning/observability.py`. Keep it behind a flag; the
   in-process buffer remains the default.
3. **Auto-rollback wiring.** Connect `src/learning/eval/auto_rollback.decide(...)`
   to the gate's `exit_code`/`reasons` so a sustained online eval failure produces
   a `RollbackDecision` (proposal only — never auto-executes; emits a verdict a
   human/pipeline acts on).
4. **Drift detection.** For safeguarding, track the live veto rate over time
   (from `MemoryAgent.history`) and flag statistically significant drift as a
   `degraded` signal.

---

## Step 4 — How we get the data (the data-sourcing plan)

This is the part that makes the evals real. Specify, for each eval, **where the
ground-truth data comes from, how it is labelled, and how it stays safe.** Cover:

1. **Seed probes (offline, day 1) — synthetic + curated.**
   - Hand-authored adversarial probes per category (you write these in the probe
     files). Source from published red-team taxonomies and the product's own
     safeguarding policy; for minors, align categories to UK/Nigeria
     safeguarding guidance already referenced in the safety docs.
   - Each probe has a fixed `expected_outcome` → this is the label.

2. **Real-traffic mining (online, ongoing) — from existing telemetry.**
   - The backend already emits structured logs and xAPI/metrics
     (`src/learning/observability.py`, `[agent-mesh]` logs, `MemoryAgent`
     history, durable metrics via `DurableMetricsReader`). Mine these for
     **candidate** probes: turns that were vetoed, low-quality critiques,
     refusals, near-miss anomalies.
   - Pipeline: live turn → telemetry → candidate extraction → **de-identify** →
     human label → promote into the probe set. NEVER promote a real child's data
     unredacted; run it through the existing PII redaction first and respect RLS
     tenant scoping + parental consent.

3. **Labelling workflow.**
   - Two-reviewer sign-off for any probe added from real traffic (consistent with
     the existing human-review bar for promoting learner content).
   - Store probes as versioned fixtures (JSON, like `data/learning/*.json`) with
     provenance fields (source, reviewer, date) so the suite is auditable.
   - Keep a held-out set so thresholds aren't tuned on the test set.

4. **Online ground-truth (delayed labels).**
   - Where an outcome's correctness is only known later (e.g. a safeguarding
     escalation confirmed by a human, or a teacher/therapist correction), define
     how that feedback is captured and joined back to the original turn id to
     score online precision/recall over time.

5. **Privacy & governance constraints (must be explicit).**
   - Minors' data: de-identify before any probe promotion; honour RLS
     (`app.tenant_id`, parental consent) and data-retention rules.
   - Keep the whole eval path dark until the minors suites are reviewed.
   - No real PII in committed fixtures — only synthetic or fully redacted.

---

## Step 5 — Deliverables & acceptance

Produce, in order, pausing for sign-off after the plan:

1. **Plan doc** — corrected gap table, file list, flag list, data-sourcing plan,
   rollout order (safeguarding offline → gate wiring → online cron → rollback).
2. **Code** — new probe files + handlers, gate inputs, CLI flags, sink interface,
   rollback wiring — new files only, dark by default, reusing `run_suite`.
3. **Tests** — ≥10 per new probe set/handler; full mesh suite stays green; report
   the new pass count + export count.
4. **Runbooks** (only if requested) — the cron manifest + the labelling workflow.

**Acceptance criteria:**
- `AGENT_MESH_ENABLED` unset → every new path is a no-op (prove with a test).
- Safeguarding offline eval: `max_crisis_misses=0`, `max_pii_leaks=0` enforced;
  false-positive rate bounded and tested.
- Online evals run in **shadow** (never block live traffic); rollback is a
  **proposal**, never auto-executed.
- No real PII in any committed fixture; provenance recorded on every mined probe.
- Full backend test suite passes; `get_errors` clean on all touched files.

---

## Working method

- Reuse `run_suite` / `ProbeCase` / `Tier1Thresholds` — do not invent a new
  harness.
- One increment per agent eval; run the targeted tests + full mesh suite after
  each; keep edits to new files.
- Agents return verdicts; the gate decides `exit_code`. Nothing here may raise on
  a denied/anomalous/low-quality outcome.
- Update `/memories/session/plan.md` as you go.
