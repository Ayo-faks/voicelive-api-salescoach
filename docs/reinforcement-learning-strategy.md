# Reinforcement Learning Strategy for Wulo

**Author:** AI Engineering
**Status:** Draft / decision doc
**Scope:** Backend — planner, recommendation, scoring, reporting
**Audience:** Founders, backend + ML engineers

---

## 0. TL;DR

Wulo does **not** train Voice Live. Voice Live is a **frozen hosted realtime avatar** (Azure). We never touch its weights and we never should — it is the *speech I/O surface*, not the *decision layer*.

The decision layer we actually own is:

1. **Recommendation service** — picks the next exercise/card given a child's state.
2. **Planner service** — composes multi-session lesson plans.
3. **Scoring / analyzers** — grade each attempt.

That decision layer is currently a **fixed heuristic policy** (hard-coded `"score": 4/5/6` weights + LLM planner with rule-based validation). The data plumbing for RL is ~70% done: `recommendation_logs` already stores `(state, action)` tuples. What's missing is the **reward** column and a **learning step**.

This doc proposes a **staged rollout**:

- **Stage 0 (now)** — instrument rewards. No policy change.
- **Stage 1 (weeks)** — contextual bandit on recommendation ranking.
- **Stage 2 (months)** — offline RL / preference fine-tuning on a *small owned* policy LLM for the planner, kept safe via **dataset mixing + weight merging** (per the catastrophic-forgetting thesis below).
- **Stage 3 (optional)** — RLHF on therapist/parent feedback.

Voice Live stays untouched in every stage.

---

## 1. What is "RL" in the Wulo context?

Wulo's product loop is already a textbook **contextual bandit / delayed-reward MDP**:

```
    child state  ─►  policy(π)  ─►  action           ─►  environment           ─►  reward
    (memory,         (recommender/   (exercise /         (child attempts,          (accuracy,
     recent           planner)        scenario card)      Voice Live speaks,       mastery
     attempts)                                            analyzers grade)         delta)
         ▲                                                                            │
         └────────────────── state update (child_memory_service) ◄────────────────────┘
```

We have every piece except the **reward signal** and the **learning update**.

| RL concept | Wulo file | Status |
|---|---|---|
| State `s` | [backend/src/services/child_memory_service.py](../backend/src/services/child_memory_service.py) | ✅ exists |
| Action `a` | [recommendation_service.py](../backend/src/services/recommendation_service.py) `_rank_candidates` | ✅ exists (fixed weights) |
| Trajectory log | `recommendation_logs` (alembic `20260406_000003`) | ✅ logs context + action |
| Outcome `o` | [scoring.py](../backend/src/services/scoring.py), [analyzers.py](../backend/src/services/analyzers.py) | ✅ exists |
| **Reward `r = f(o)`** | — | ❌ **not computed** |
| **Policy update** | — | ❌ **hard-coded** |

---

## 2. What do we train? (and what we absolutely don't)

### 2.1 Frozen components (never trained by us)

| Component | Why frozen |
|---|---|
| **Azure Voice Live** (realtime avatar) | Hosted black-box. No weight access. Changing it is out of scope and out of contract. We configure it (voice, VAD, prompt) — that's it. |
| **GPT-5 / GPT-4o** deployments (planner, analyzers, report rewrite) | Hosted Azure OpenAI. We can only prompt-engineer, tool-call, or use **fine-tune APIs** (SFT / DPO). No raw-gradient RL. |
| **Azure Speech transcription** | Hosted. We only tune config. |

Rule of thumb: **anything behind an Azure endpoint, we treat as an API, not a model.** Reward signals do not flow into its weights.

### 2.2 What we *can* train

Three tiers, cheapest first:

**Tier A — Classical bandit / small models (recommended first)**
- Target: `recommendation_service._rank_candidates`.
- Model: per-`(target_sound, difficulty_bucket)` **Beta-Bernoulli posterior** (Thompson sampling) or **LinUCB** over engineered features of `ranking_context`.
- Size: kilobytes. Trains online. No GPU.
- Deploy: pickled model in blob storage, loaded at service init, updated nightly from `recommendation_logs` + rewards.

**Tier B — Small owned transformer as a planner re-ranker (mid term)**
- Target: *re-rank* or *critique* plans emitted by GPT-5, don't *replace* it.
- Model: 1–8B open-weights (Llama-3-8B, Qwen2-7B, Phi-3-mini). Trainable on a single A100 or via Azure ML managed compute.
- Method: **DPO** (Direct Preference Optimisation) on therapist thumbs-up/down pairs, or **GRPO / PPO** with reward from §4.
- Role: it scores "Plan A vs Plan B"; the LLM still generates candidates.

**Tier C — Azure OpenAI fine-tune (optional)**
- Target: planner / report-rewrite styling.
- Method: Azure OpenAI's **SFT** or **preference fine-tune** endpoints on curated pairs.
- No access to RL hyperparameters — effectively imitation + preference learning. Still useful.

> **We are not training Voice Live. We are training the policy that *chooses what Voice Live says next*.**

---

## 3. End-to-end architecture (Stage 1 + 2)

```
                        ┌─────────────────────────────────────────┐
                        │         websocket_handler (live)         │
                        └──────────────┬──────────────────────────┘
                                       │ attempt events
                                       ▼
                 ┌────────────────────────────────────┐
                 │   scoring.py + analyzers.py        │   immediate outcome
                 └──────────────┬─────────────────────┘
                                │
                                ▼
            ┌──────────────────────────────────────────┐
            │   reward_service.py   (NEW)              │   r = α·acc + β·completion
            │   compute_reward(log_id, outcome)        │       − γ·difficulty_mismatch
            └──────────────┬───────────────────────────┘       − δ·repetition
                           │ writes
                           ▼
            ┌──────────────────────────────────────────┐
            │   recommendation_logs (+ reward col)     │   (s, a, r) store
            └──────────────┬───────────────────────────┘
                           │ nightly batch
                           ▼
            ┌──────────────────────────────────────────┐
            │   trainer job (Azure ML / container job) │
            │   - Stage 1: bandit posterior update     │
            │   - Stage 2: DPO on small planner LLM    │
            └──────────────┬───────────────────────────┘
                           │ artifact
                           ▼
            ┌──────────────────────────────────────────┐
            │   model registry (blob + SHA)            │
            └──────────────┬───────────────────────────┘
                           │ loaded at service start
                           ▼
            ┌──────────────────────────────────────────┐
            │   recommendation_service / planner        │
            │   policy π(a|s) — serves requests         │
            └──────────────────────────────────────────┘
```

**Voice Live sits outside this diagram.** It is the environment, not the learner.

---

## 4. The reward function

Start **simple, auditable, clamped**. A therapist should be able to read it.

```python
# services/reward_service.py  (proposed)

def compute_reward(
    scored_turn: ScoredTurnResult,
    recommendation: RecommendationLog,
    child_state_before: ChildMemorySnapshot,
    child_state_after: ChildMemorySnapshot,
) -> RewardBreakdown:
    accuracy       = scored_turn.target_accuracy          # 0..1
    completion     = 1.0 if scored_turn.completed else 0.0
    mastery_delta  = child_state_after.mastery(recommendation.target_sound) \
                   - child_state_before.mastery(recommendation.target_sound)
    difficulty_gap = abs(recommendation.difficulty - child_state_before.skill_level)
    repetition_pen = min(1.0, recommendation.recent_repeats / 3)

    reward = (
        0.45 * accuracy
      + 0.25 * completion
      + 0.25 * clip(mastery_delta, -0.2, 0.2) * 5   # rescaled to 0..1
      - 0.15 * difficulty_gap
      - 0.10 * repetition_pen
    )
    return RewardBreakdown(value=clip(reward, -1, 1), components={...})
```

Store **components** alongside `value` so we can re-derive rewards if the formula changes — never throw away raw signal.

**Delayed reward** (for planner, Stage 2): sum over a session, discount γ=0.9 across turns, plus an end-of-week mastery bonus.

---

## 5. Catastrophic forgetting — how we'll avoid it

This is the single biggest risk when RL touches an LLM policy (Tier B). Your notes land exactly right; here's how we operationalise them for Wulo.

### 5.1 Mix the RL dataset with broad public data
When we DPO/PPO a small planner LLM on Wulo trajectories:
- **60% Wulo preference pairs** (therapist thumbs / reward-ranked plans).
- **40% broad instruction-following data** — e.g. UltraFeedback, NVIDIA HelpSteer, Tulu-3 preference mix.
- Goal: the model keeps being a *competent instruction follower*, not just a Wulo-plan-emitter.

### 5.2 Weight merging (model soup)
After each RL run:
```
π_deployed = λ · π_rl + (1 − λ) · π_base
```
- Start with `λ = 0.5`. Move to `0.7` only if evals hold.
- Use `mergekit` (linear / SLERP / TIES-merging). Cheap, surprisingly effective, ~minutes of CPU.
- Keep `π_base` pinned by SHA.

### 5.3 Continuous broad evals in the training loop
Every checkpoint runs:
- Wulo-specific evals (`evals/`) — planner quality, recommendation NDCG, report coherence.
- General evals — MMLU-subset, IFEval, a small reasoning slice.
- **Hard gate:** if general eval drops >3% relative, **reject the checkpoint**, do not ship.

### 5.4 Conservative optimisation
- Learning rate ≤ `1e-6` for DPO on 7B models.
- KL penalty to reference policy (`β_KL ≥ 0.1`) — standard DPO/PPO hygiene.
- Early stop on **reward saturation** (classic overfit tell).

### 5.5 Format & objective diversity
- Train with multiple output shapes: JSON plans, prose explanations, short answers, "no-think" direct replies.
- Include "don't reason out loud" examples so the model doesn't collapse into always-chain-of-thought.
- Multi-environment: plan generation, plan critique, report rewrite, recommendation explanation — one model, many jobs.

### 5.6 Canary + rollback
- 5% traffic shadow, 10% canary, full rollout only after 7-day therapist-feedback SLA holds.
- Keep last 3 model SHAs warm for instant rollback.

---

## 6. Staged rollout

### Stage 0 — Instrument rewards (this sprint)
**Goal:** start collecting `(s, a, r)`. Ship **zero** policy change.
1. Alembic migration: add `reward FLOAT NULL`, `reward_components JSONB`, `reward_observed_at TIMESTAMP` to `recommendation_logs`.
2. New module `backend/src/services/reward_service.py` — pure function, fully unit-tested.
3. Call it from `websocket_handler` session-end (or `ScoredTurnDispatcher` flush) with the latest `recommendation_log_id`.
4. Dashboards: reward distribution per target sound, per age, per child; alert on reward collapse.
5. **No behaviour change.** Keep the heuristic ranker. Just watch.

Exit criteria: ≥200 reward-labelled rows per target sound.

### Stage 1 — Contextual bandit ranker
**Goal:** replace the literal `"score": 4/5/6` with a learned posterior.
1. `services/ranker/` package.
   - `features.py` — deterministic featuriser of `ranking_context`.
   - `bandit.py` — Thompson-sampled Beta-Bernoulli per `(target_sound, difficulty_bucket, action_id)`.
   - `registry.py` — load/save pickled posteriors from blob.
2. Nightly Azure container job: read last 24h rewards, update posteriors, version artifact.
3. Shadow-run alongside heuristic for 1 week (log would-be picks, do not serve).
4. A/B at 10% traffic, primary metric = **mean reward per session**, guardrail = **session completion rate**.

Exit criteria: +5% mean reward, no completion-rate regression over 14 days.

### Stage 2 — Owned planner re-ranker (DPO on small LLM)
**Goal:** beat GPT-5 planner on Wulo-specific plan quality *as a re-ranker*, with general-reasoning preserved.
1. Curate preference pairs from `progress_reports` + therapist thumbs.
2. Base: **Qwen2-7B-Instruct** or **Llama-3-8B-Instruct** (permissive licences, strong instruction-following).
3. DPO run on Azure ML, 1×A100, mixed 60/40 Wulo/public as in §5.1.
4. Apply §5.2 merging, §5.3 eval gating.
5. Serve as a **critic**: GPT-5 proposes 4 plans → owned model ranks → top plan wins. LLM still does the hard creative work; we only learn *preferences*, which is where bespoke data actually beats scale.

Exit criteria: +10% therapist-accepted plans at parity latency; zero general-eval regression >3%.

### Stage 3 — RLHF / preference loop (optional)
Only after Stage 2 is stable. Add explicit thumbs up/down in therapist and parent UIs. Preference pairs feed a second DPO pass. Same §5 safety rails.

---

## 6b. Which algorithm? DPO vs RPO vs GRPO vs PPO vs RLVR vs bandits

There is no single "RL algorithm for Wulo" — different layers of the stack want different algorithms. The right question is: **what signal do I have, and what policy am I updating?**

### Decision table

| Signal you have | Policy you're updating | Best algorithm | Why |
|---|---|---|---|
| Scalar reward per `(state, action)` row, discrete actions | Recommender ranker | **Contextual bandit** (Thompson / LinUCB) | No LLM. Cheapest. Works with hundreds of rows. |
| **Verifiable** reward (pass/fail, grader-checkable) | Small LLM | **RLVR / GRPO** | Built for math/code/graded tasks — our scoring is graded. |
| Pairwise preferences (A ≻ B) | Small LLM | **DPO / RPO / IPO** | No reward model, no rollouts, stable, cheap. |
| Dense scalar reward + need exploration | Small LLM | **PPO** (classic RLHF) | Powerful but heavy: reward model + rollouts + KL control. |
| Only demonstrations (therapist-written plans) | Small LLM | **SFT** first, then DPO | Bootstrap before any RL. |

### What each one actually is

- **SFT (Supervised Fine-Tuning).** Not RL. Teacher-forced next-token loss on therapist-approved plans. Always do this *before* any preference/RL step — it defines the initial policy `π_0` and the reference model `π_ref` that DPO/PPO regularise toward.

- **DPO — Direct Preference Optimisation.** Given pairs `(prompt, chosen, rejected)`, optimises a closed-form loss that is equivalent to RLHF under a Bradley-Terry preference model, *without* a reward model or rollouts. One forward pass per pair. **This is the default for Wulo Stage 2.** Needs only ~2–10k good pairs.

- **RPO — Rejection-sampling Preference Optimisation** (a.k.a. RSO / Iterative DPO). Sample N completions from the current policy, score them (reward model or verifier), keep best-vs-worst pairs, run DPO, repeat. Closes the gap DPO has with on-policy methods. Worth the extra complexity only after plain DPO plateaus.

- **IPO / KTO / SimPO / ORPO.** Variants of DPO that fix specific failure modes: IPO (length/overfit), KTO (only needs unpaired thumbs-up/down — useful if therapists only give 👍/👎, not A-vs-B), SimPO (no reference model, cheaper), ORPO (merges SFT + preference into one stage). **KTO is a strong fit** for Wulo's thumbs-up/down UX and should be on the candidate list alongside DPO.

- **PPO — Proximal Policy Optimisation.** Classic RLHF. Train a reward model from preferences, then do on-policy PPO rollouts with KL penalty to `π_ref`. Most flexible, most compute, hardest to tune. Only consider if DPO/GRPO stop delivering.

- **GRPO — Group Relative Policy Optimisation** (DeepSeek-R1-style). PPO minus the value critic: sample a *group* of K completions for the same prompt, reward each, use group-mean as baseline, policy-gradient update with KL to `π_ref`. Cheap compared to PPO, very effective when rewards are **verifiable**. **Strong Stage 2-alt candidate** if our reward (accuracy, mastery delta) is the signal, not preferences.

- **RLVR — Reinforcement Learning from Verifiable Rewards.** An *umbrella paradigm*, not a specific loss — the one Tulu-3 / DeepSeek-R1 popularised. "Use a deterministic verifier as the reward signal." Implementation is usually **GRPO or PPO on top**. For Wulo this maps directly onto `scoring.py` + `analyzers.py`: those functions *are* the verifier. If a plan/exercise leads to measurable mastery gain, reward = 1. That's RLVR.

- **Contextual bandits** (Thompson, LinUCB, Vowpal Wabbit). *Not* deep RL. Best choice for the recommender layer. Don't skip this by going straight to LLM-RL — it's 10× cheaper and 10× safer.

### Mapped to Wulo's three policy sites

| Layer | Algorithm | Rationale |
|---|---|---|
| **Stage 1 — recommender ranker** | **Thompson-sampled Beta-Bernoulli contextual bandit** (or LinUCB for richer features) | Discrete candidate set, scalar reward, needs online updates, tiny data regime. LLM-RL here is overkill. |
| **Stage 2a — planner re-ranker (preferences available)** | **DPO** (default), **KTO** if only thumbs-up/down, **RPO** as iterative upgrade | Therapist feedback is naturally pairwise or binary. No rollouts, no reward model, stable. |
| **Stage 2b — planner re-ranker (verifiable outcomes)** | **GRPO under the RLVR paradigm** | When we can verify a plan's quality downstream via `scoring.py` + mastery delta, GRPO lets us optimise *directly* on that signal without a reward-model proxy. |
| **Stage 3 — full RLHF** | **PPO** only if DPO/GRPO both plateau | Reserved. Heaviest tooling debt. |

### Recommended sequence

1. **Bandit** on the recommender. Ship first.
2. **SFT** the small planner on curated therapist plans — establishes `π_ref`.
3. **DPO** (or KTO if UX gives only 👍/👎) on therapist preference pairs.
4. **RLVR + GRPO** on top of the DPO'd model, using `scoring.py`-derived verifiable rewards, once we trust the reward function.
5. **PPO / RPO-iterative** only if a measurable ceiling is hit.

All of 2–5 must follow §5 safety rails (60/40 mix, weight merging, eval gating).

### Hard constraints — what we do **not** run

- **No RL of any kind on Voice Live.** Frozen API.
- **No PPO/GRPO on GPT-5 / GPT-4o.** Not exposed by Azure OpenAI. The only "training" available on those is Azure OpenAI's SFT / preference fine-tune surfaces — treat as black-box imitation.
- **No reward-hacking-prone rewards.** Every reward term must be therapist-readable and clamped (§4). Unverifiable rewards (e.g. "LLM judge score") get a lower weight than verifiable ones (accuracy, mastery delta).

---

## 7. Data, privacy, compliance

- All rewards derived from **Wulo-owned** session data. No Voice Live internals leave Azure.
- **PII never enters training data.** [report_redaction.py](../backend/src/services/report_redaction.py) is already our redaction layer; extend it to the training-export path.
- Parent/guardian consent: training-use flag per child, default **off**. Honour deletion within 30 days (propagates to training set + reversioned models).
- Keep a `training_manifest.json` per model SHA: dataset hashes, consent snapshot, eval results, merge ratio.

---

## 8. What this buys us

- **Stage 0** alone — observability. We finally know which recommendations actually help.
- **Stage 1** — measurable lift in accuracy/completion with no LLM training costs.
- **Stage 2** — a defensible moat: a small model that *prefers plans the way our therapists do*. This is the kind of thing hosted frontier APIs structurally can't ship.

---

## 9. What this deliberately is **not**

- Not training Voice Live. (Not possible, not desired.)
- Not doing end-to-end RL on a frontier API. (Not exposed.)
- Not replacing GPT-5 as the plan *generator*. (Wrong battle; use it, rank it.)
- Not shipping a policy before the reward signal is trusted. (Stage 0 first, always.)

---

## 10. Appendix — concrete first PR

```
backend/alembic/versions/2026xxxx_000xxx_recommendation_rewards.py   # migration
backend/src/services/reward_service.py                                # pure compute
backend/src/services/websocket_handler.py                             # hook at session end
backend/tests/unit/test_reward_service.py                             # table-driven
backend/tests/integration/test_reward_pipeline.py                     # end-to-end
```

~300 lines. No behaviour change. Unlocks everything downstream.
