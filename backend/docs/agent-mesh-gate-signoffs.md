# Agent-mesh gate sign-offs — ownership register

> One owner per gate. Each gate is dark-by-default, reversible with a single
> action, and **human-owned**. This register names the owner, lists the
> pre-flight they must confirm, and holds the per-gate sign-off table. No gate
> may open until its row is signed by the named human. See the
> [go-live runbook](agent-mesh-go-live-runbook.md) for the full sequence.

## Standing invariants (apply to every gate)

- Dark-by-default; master kill = clear `AGENT_MESH_ENABLED`.
- No online / live weight updates — online actions are shadow / proposal only.
- The safeguarding veto is 100% deterministic and human-owned; no gate changes it.
- Synthetic personas only; monitoring agents never act.

---

## Gate 2 — cron online shadow · Owner: **cron on-call**

**Responsibility:** owns the scheduled Container Apps observability Job, watches
its ticks and dashboards, and holds the rollback switch.

**Pre-flight (confirm all):**
- [ ] Gate 1 (offline merge-gate) green in CI at the deploy SHA.
- [ ] Observability Job provisioned: `enableAgentMeshObservabilityCron=true`,
      mounting `wulo-data` Azure Files at `/var/lib/agent-mesh` (**not** a k8s PVC).
- [ ] Dashboards wired: merge verdict, false-positive rate, veto-rate drift,
      rollback proposals.
- [ ] Append-only history sink reachable; healthy ticks exit `0`.

**Go-live action:** set `agentMeshObservabilityEnabled="1"` and redeploy infra.
**Rollback (any one):** `agentMeshObservabilityEnabled=""` ·
`enableAgentMeshObservabilityCron=false` · clear `AGENT_MESH_ENABLED`.

| Owner (cron on-call) | Soak window observed | Sign-off | Date |
| --- | --- | --- | --- |
| _pending_ | | | |

---

## Gate 3 — Track-B staging load · Owner: **B3 operator**

**Responsibility:** named operator who runs the synthetic load against the
**non-prod** staging stack (`https://staging-sen.wulo.ai`), confirms notifications
flow to the capture sink (never paging a human), and stops the run.

**Pre-flight (confirm all):**
- [ ] Gate 2 soaked clean.
- [ ] Target is non-prod (handler refuses prod hosts; driver `non_prod_target`
      check also applies).
- [ ] Flags `AGENT_MESH_ENABLED` + `AGENT_MESH_B3_DRIVER_V1` +
      `AGENT_MESH_B3_STAGING_HANDLER_V1` set only for the run window.
- [ ] Notifier → capture sink pre-flight passes; operator name recorded.
- [ ] Staging score route (`/internal/agent-mesh/score`) reachable.

**Go-live action:** run `B3Driver(handler=build_staging_handler(base_url, operator=...))`
with `force=True` for the load window. **Rollback (any one):** end the run · clear
`AGENT_MESH_B3_STAGING_HANDLER_V1` or `AGENT_MESH_B3_DRIVER_V1` · clear
`AGENT_MESH_ENABLED`. Synthetic-only; no learner data touched.

| Owner (B3 operator) | Run window | Sink-only confirmed | Sign-off | Date |
| --- | --- | --- | --- | --- |
| _pending_ | | | | |

---

## Gate 4 — Track-C policy promotion · Owner: **policy reviewer**

**Responsibility:** signs off the labeled corpus + trained artifact, confirms the
batch-score beats round-robin, and is the only party who promotes the policy from
shadow to live selection. Full record in the
[C1 policy sign-off](agent-mesh-c1-policy-signoff.md).

**Pre-flight (confirm all):**
- [ ] Gate 3 ran clean.
- [ ] Corpus + artifact reviewed; sampled labels agree with expert judgement.
- [ ] Batch-score: policy **beats round-robin** on a held-out split (reproduced
      at the committed SHA).
- [ ] [C1 policy sign-off](agent-mesh-c1-policy-signoff.md) §7 signed by both roles.

**Go-live action:** set `AGENT_MESH_ENABLED` + `LEARNING_C1_POLICY_V1`, load the
artifact into `LearnedItemSelector`, call `promote()`. **Rollback (any one):**
clear `LEARNING_C1_POLICY_V1` · clear `AGENT_MESH_ENABLED` · revert to the baseline
selector — policy returns to shadow, no learner-visible effect.

| Owner (policy reviewer) | Batch-score ref | C1 sign-off complete | Sign-off | Date |
| --- | --- | --- | --- | --- |
| _pending_ | | | | |

---

## Escalation

Any owner may invoke the master kill (clear `AGENT_MESH_ENABLED`) at any time
without waiting for the others — it reverts all three gates to dark in one action.
