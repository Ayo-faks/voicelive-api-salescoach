# Agent-mesh go-live runbook — gates 2 → 3 → 4

> One page. Sequences the three **live-traffic** go-live gates after the offline
> merge-gate (gate 1) is green in CI. Every gate is dark-by-default, reversible,
> and human-owned. The safeguarding veto stays 100% deterministic — no gate here
> changes it. Online actions are shadow/proposal only.

**Order is mandatory.** Do not open a later gate until the earlier one has run
clean for its soak window. Each gate has its own owner sign-off.

| Gate | Name | Scope | Master + feature flags | Live effect |
| --- | --- | --- | --- | --- |
| 1 | Merge-gate (offline) | per-change CI | per-suite probe flags | Blocks merge. *Prereq — must be green.* |
| 2 | Cron (online recurring) | prod, read-only | `AGENT_MESH_ENABLED` + sink/drift/rollback | Shadow: record → drift → **rollback proposal** |
| 3 | Track-B staging load | **non-prod only** | `AGENT_MESH_ENABLED` + `AGENT_MESH_B3_DRIVER_V1` | Synthetic load; notifications → sink |
| 4 | Track-C policy promotion | prod selection seam | `AGENT_MESH_ENABLED` + `LEARNING_C1_POLICY_V1` | Learned next-best-question after `promote()` |

---

## Gate 2 — cron online shadow

**Pre-flight:** gate 1 green in CI · `agent-mesh-history` PVC provisioned ·
dashboards wired (merge verdict, false-positive rate, veto-rate drift, rollback
proposals) · on-call owner named.

**Go live** (see [cron runbook](agent-mesh-cron-runbook.md)):
1. Set `AGENT_MESH_ENABLED=1`, `AGENT_MESH_MEMORY_SINK_V1=1`, the per-suite probe
   flags, and `AGENT_MESH_DRIFT_V1` / `AGENT_MESH_ROLLBACK_V1` in the CronJob.
2. Set `spec.suspend: false`.
3. Soak: confirm sink accrues cross-run history and exit codes are `0` on healthy
   ticks before proceeding to gate 3.

**Rollback (any one, instant dark):** set `spec.suspend: true` **or** clear
`AGENT_MESH_ENABLED`. Drift stops watching; rollback stays a proposal that was
never executed. No data cleanup needed — the sink is append-only history.

---

## Gate 3 — Track-B staging load (B3)

**Pre-flight:** gate 2 stable · target is a **non-prod** environment (driver
rejects any env whose name contains a prod token) · a named operator · a
capture-only notifier wired so synthetic disclosures route to the sink and
**never page a human**.

**Go live:**
1. In staging only, set `AGENT_MESH_ENABLED=1` + `AGENT_MESH_B3_DRIVER_V1=1`.
2. Run `B3Driver.preflight(config)`; all five gate checks must pass
   (`non_prod_target`, `notifier_capture_only`, `feature_flags_set`,
   `named_operator`, `output_to_sink`). A failed check raises `B3PreflightError`.
3. Only then call `B3Driver.run(config, force=True)`; it ramps sessions and stops
   at the first component that bends. Record the bend point.

**Rollback:** call `B3Driver.suspend()` (disarms in one call) **or** clear either
flag. The ramp halts; no prod traffic was ever involved. Tear down the staging
load generator.

---

## Gate 4 — Track-C policy promotion (C1)

**Pre-flight:** gates 2–3 clean · an **offline-trained, human-reviewed**
`NextBestQuestionPolicy` artifact exists · Track A batch score shows the policy
beats round-robin · shadow divergence reviewed in the dashboard
(`c1_policy_shadow` sink records).

**Go live (staged):**
1. Set `AGENT_MESH_ENABLED=1` + `LEARNING_C1_POLICY_V1=1` and inject the loaded
   policy into `LearnedItemSelector`. **Still shadow** — output stays the
   round-robin baseline; proposals are recorded for review.
2. After the shadow window passes review, call `LearnedItemSelector.promote()`.
   It refuses (`C1DarkError`) unless the flag is on **and** a policy is loaded.
   Only then does the learned ordering win.

**Rollback (any one):** call `LearnedItemSelector.suspend()` to revert to the
deterministic baseline in one call · **or** clear `LEARNING_C1_POLICY_V1` /
`AGENT_MESH_ENABLED`. Selection returns to round-robin byte-for-byte. No learner
state is persisted live, so there is nothing to unwind.

---

## Invariants across all gates

- **Master kill-switch:** clearing `AGENT_MESH_ENABLED` returns the entire mesh to
  dark, regardless of feature flags — the universal rollback.
- **No online training / no live weight updates.** All learning is
  offline-trained, batch-scored by Track A, shadow-run, human-promoted.
- **Safeguarding veto is deterministic and human-owned.** No gate, drift signal,
  or policy ever retrains or overrides it.
- **Online = proposal only.** Drift monitors; the rollback adapter proposes; a
  human approves every action.
