# Track B/B3 + Track C — dark scaffold & go-live gates

> **Status: dark scaffold. Nothing in this document is wired live.**
>
> This file documents the parts of the signed agent-mesh eval plan that deliberately
> stop at the dark→live boundary: **Track B / B3** (staging load + stress) and **all
> of Track C** (closed-loop policy learning). Both change runtime behaviour or touch
> shared infrastructure, so per the signed plan each requires **its own human go-live
> gate** — exactly like the increment-7 cron. They are described, test-covered where
> in-process, and left suspended. Flipping any of them live without the gate below
> would violate the signed plan.

Built and green already (for context):

- Track A increments 1–7 (offline merge-gate → online shadow drift/rollback → cron
  dark scaffold). See [`agent-mesh-eval-plan.md`](agent-mesh-eval-plan.md) and
  [`agent-mesh-cron-runbook.md`](agent-mesh-cron-runbook.md).
- A8–A13 per-agent offline probe suites (`src/learning/eval/*_probes.py`).
- Track B / **B1** personas ([`personas.py`](../src/learning/eval/personas.py)) and
  **B2** outcome scorer ([`population_scorer.py`](../src/learning/eval/population_scorer.py)),
  both in-process, pure, no PII, behind their own flags. Tested in
  [`test_population_scorer.py`](../tests/unit/test_population_scorer.py).

---

## Track B / B3 — traffic driver / load + stress (NOT live)

**Goal.** Spin up N concurrent synthetic sessions (start ~2000, ramp until a
component bends) against the **full staging stack** (websockets, DB, session caps,
durable-sink ingest, safeguarding service) and instrument per-component stress
signals (concurrency, token volume, DB write throughput, sink ingest rate, latency)
to find the first breaking component.

**Why it stays dark.** B3 needs a non-prod staging/load environment and crosses the
dark→live boundary. It is sequenced like the cron (increment 7): documented now,
flipped on only behind the go-live gate.

**Hard rules carried from the plan (non-negotiable at go-live):**

- **Non-prod ONLY.** Never point the driver at production.
- **Notifier → sink swap is MANDATORY.** In any synthetic/load run the safeguarding
  notifier channels MUST be replaced by a capture sink. A synthetic disclosure must
  NEVER page a real human. This is a hard precondition of the gate, not a setting.
- **Synthetic fixtures only.** Safeguarding personas are clearly-synthetic,
  non-graphic, human-reviewed (the B1 population already satisfies this).
- **Dev-only load dep.** A load tool (e.g. locust/k6) is permitted as a DEV/TEST
  dependency only, behind its own flag, decided at B3 design time. No new *runtime*
  dependency enters the service.

**Reuses already-built pieces.** B3 drives the same B1 population through the same
B2 `PopulationScorer` and feeds the same durable sink + drift detector — it adds
concurrency + a real stack, not new scoring logic.

### B3 go-live gate (all must hold before un-suspending)

1. Target is a confirmed **non-prod** environment (assert subscription / cluster).
2. Safeguarding **notifier is swapped for a capture sink** — verified by an explicit
   pre-flight check that no real channel (email/SMS/pager/Teams) is configured.
3. `AGENT_MESH_ENABLED` + the B3 driver flag are set **only** in that environment.
4. A named operator owns the run and can `suspend`/tear down in one action.
5. Run output (stress signals, first-bend component) is captured to the sink, not to
   any human-paging channel.

---

## Track C — closed-loop policy learning (FUTURE, NOT started)

Track C closes `observe → score → adapt` for the few places learned adaptation pays
off — and explicitly nowhere else. **Self-learning here means human-gated learning:**
the agent *proposes*, evidence accumulates, the Track A eval harness scores it, a
human approves, then behaviour updates. **Never live self-retraining.**

| Phase | Scope | Slots into | Gate |
|-------|-------|-----------|------|
| C1 | Next-best-question policy (replace round-robin `DeterministicItemSelector`) | the existing `cat.py` fallback seam | harness beats round-robin in batch → shadow → human-promote |
| C2 | Intervention recommendation from approved `InterventionPlan` outcomes | proposes only; teacher approves every plan | offline → shadow → human-gated |
| C3 | Tutor explanation quality from `CriticAgent` + `OverrideEvent` signal | biases which explanations the tutor reaches for | reuses Track A scoring |
| C4 | Safeguarding **drift baseline** (learn the baseline, NOT the decision) | `MemoryAgent.history` veto-rate baseline | monitoring-only |

### Track C hard boundaries (carried verbatim from the plan)

- The safeguarding **decision/veto rule stays deterministic and auditable.** C4 may
  learn a drift *baseline*; the veto itself NEVER self-retrains. **Safety boundary.**
- `DevOpsAgent` and `MigrationAgent` stay deterministic — no learning.
- **No live/online weight updates anywhere.** All learning is offline-trained, batch-
  scored by Track A, shadow-run, and human-promoted.
- No new runtime deps for shadow/inference paths; training tooling is dev/test-only,
  decided at C1 design time.

### Why Track C is not built here

Track C changes the *brain* (decision policies), is the largest scope/risk in the
plan, and every phase requires offline-train → batch-score → shadow → human-promote,
each with its own go-live gate. Building any of it live now would cross those gates
and violate the signed, dark-by-default discipline. The prerequisites it depends on
— the Track A offline harness (its batch scorer), the durable sink (its log source),
and the drift detector (C4's baseline watcher) — are already built and green, so C1
can begin from this scaffold whenever the go-live process is opened.
