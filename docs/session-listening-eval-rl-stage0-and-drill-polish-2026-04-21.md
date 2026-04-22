# Session Summary — 21 April 2026

**Sprint window:** 20–21 April 2026 (two-session thread)
**Author:** AI Engineering
**Audience:** Backend + ML + Frontend engineers, product, therapist stakeholders
**Status:** Shipped — behind staff-only surface and feature-gated RL read

---

## 0. TL;DR

This sprint landed the **data plane** for Wulo's reinforcement-learning roadmap and fixed three child-facing bugs in the listening minimal-pairs drill.

Concretely:

| Workstream | Outcome | Where |
|---|---|---|
| **Listening-eval A/B tool (backend)** | Staff-only blueprint + service + alembic migration; writes items / votes / aggregated rewards | [`backend/src/routes/listening_eval_routes.py`](../backend/src/routes/listening_eval_routes.py), [`backend/src/services/listening_eval_service.py`](../backend/src/services/listening_eval_service.py), [`backend/alembic/versions/20260421_000020_listening_eval_tables.py`](../backend/alembic/versions/20260421_000020_listening_eval_tables.py) |
| **RL Stage 0 reward gate** | Read-side projection that returns `None` until a quorum of therapist votes is reached; otherwise returns scalar reward per target token | [`backend/src/services/reward_service.py`](../backend/src/services/reward_service.py) |
| **DPO preference-pair exporter** | Converts raw votes to `{chosen, rejected, weight}` rows for future preference training | `build_dpo_preference_pairs` in `listening_eval_service.py` |
| **Listening drill UX fixes** | Phonetic-onset drill tokens, rephrased instruction, retry cap, spoken-vs-visible channel split | [`frontend/src/utils/drillTokens.ts`](../frontend/src/utils/drillTokens.ts), [`frontend/src/components/ListeningMinimalPairsPanel.tsx`](../frontend/src/components/ListeningMinimalPairsPanel.tsx), [`frontend/src/components/ExercisePanels.test.tsx`](../frontend/src/components/ExercisePanels.test.tsx) |
| **Incidental:** `phonemeSsml.ts` merge conflict | Stale duplicate block deleted; test file now compiles | [`frontend/src/utils/phonemeSsml.ts`](../frontend/src/utils/phonemeSsml.ts) |

What the sprint deliberately **did not** ship: the staff React surface for A/B voting, the nightly aggregation job, the bandit ranker, the DPO training pipeline, PPO/GRPO, and anything that touches Voice Live weights. The rationale for each deferral is in §4.

---

## 1. Why now — problem statement

Wulo's decision layer (planner + recommendation + scoring) is a fixed heuristic policy. The [reinforcement-learning strategy doc](./reinforcement-learning-strategy.md) lays out a staged path from "no learning" to "preference-tuned small planner LLM," and the very first prerequisite is **trusted reward data**.

Two gaps were blocking that prerequisite:

1. **We had no acoustic-quality signal for drill utterances.** The only feedback channel was therapist anecdote in Slack. Without per-token preference data we cannot compute a reward, cannot rank SSML variants, and cannot ship any learned policy — not a bandit, certainly not a DPO'd re-ranker.
2. **The listening drill itself was mispronouncing short target words** (`"fin"` → `"fine"`), looping indefinitely on wrong taps, and leaking raw drill-token sentinels (`F_FREE_MODEL`, `TH_THREE_MODEL`) into child-facing UI. A child-facing UX bug in the one drill that will feed our reward model is a direct threat to signal quality.

Both had to land in the same thread because they share a data path: the drill tokens the child hears are the same tokens the A/B tool scores and the reward service exposes.

---

## 2. What shipped — RL Stage 0 data plane

### 2.1 Schema

[`20260421_000020_listening_eval_tables.py`](../backend/alembic/versions/20260421_000020_listening_eval_tables.py) introduces three tables:

| Table | Purpose |
|---|---|
| `listening_eval_items` | Catalogue of A/B comparisons. Each row pairs two SSML variants of the same `target_token` (e.g. `F_FIN_MODEL` rendered with IPA vs. pseudo-spelling). |
| `listening_eval_votes` | Individual therapist votes: `preferred_variant ∈ {a, b, tie}` plus a 1–5 confidence. |
| `listening_eval_rewards` | Per-token aggregated reward in `[-1, +1]`, refreshed from votes. Indexed on `(target_sound, reward DESC)` so the reward service can scan by phoneme family without a table sort. |

SQLite local-dev auto-creates the schema; Postgres goes through the alembic revision. This dual-path pattern is already canonical in the repo (see the parity notes for SQLite ↔ Postgres in the repo memory).

### 2.2 Service layer — `ListeningEvalService`

[`listening_eval_service.py`](../backend/src/services/listening_eval_service.py) holds the domain logic. Three things worth calling out for future engineers:

**(a) The reward formula is deliberately boring.** Lines 324–395 of `refresh_rewards`:

```
r(t) = Σ_i (c_i · s_i) / Σ_i c_i       # confidence-weighted mean, clipped to [-1, 1]
```

where `c_i` is the 1–5 confidence and `s_i` is `+1 / -1 / 0` for variant A / B / tie. No Bradley–Terry, no Wilson intervals, no Bayesian posterior — **yet**. The reasoning matches §4 of the RL strategy doc: *start simple, auditable, clamped; a therapist should be able to read the formula.* Upgrades (Wilson lower-bound for the low-vote regime, per-therapist variance weighting, Thompson sampling on top) are explicitly Stage 1 work.

**(b) Gating is a first-class concern, not a hack.**

```python
MIN_VOTES_FOR_REWARD = 200
MIN_THERAPISTS_FOR_REWARD = 3
```

`refresh_rewards` returns `[]` when either threshold is unmet, and the reward service returns `None`. We chose *global* thresholds (not per-token) because:

- Per-token thresholds let a few power-users ship a reward for one phoneme while starving another — selection bias we don't want feeding a training set.
- Requiring ≥3 distinct therapists kills the single-rater confound that Stage 0 is most exposed to.
- `200` votes is the conventional floor for a confidence-weighted mean to stabilise inside ±0.05 when confidences are drawn from a 1–5 scale with typical variance; it is a *policy choice* we should revisit from data, not a hard statistical bound.

**(c) DPO preference-pair exporter** (`build_dpo_preference_pairs`, line 542) converts raw A/B votes into `{chosen, rejected, weight}` rows. It filters ties and sums weights across duplicate pairs so the downstream DPO loss sees a strict preference. This is Stage-2-facing code we shipped now because the schema makes it trivial and because it forces us to keep the vote model strict enough to produce a clean preference signal later.

### 2.3 Staff blueprint

[`listening_eval_routes.py`](../backend/src/routes/listening_eval_routes.py) exposes eight endpoints under `/staff/listening-eval/*`. All are gated by `require_staff_user` (therapist or admin). The `export.csv` route exists so we can pull raw votes for offline analysis and for the DPO exporter without needing a dashboard.

### 2.4 RL Stage 0 read projection — `RewardService`

[`reward_service.py`](../backend/src/services/reward_service.py) is ~90 lines and intentionally thin. It exposes:

- `snapshot()` → `RewardSnapshot` (gated flag + reason + per-token rewards)
- `get_reward(target_token)` → `Optional[float]`
- `rewards_for_tokens(tokens)` → `Dict[str, Optional[float]]`

The `Optional[float]` return type is the entire Stage 0 contract: **callers must handle `None`.** That forces any future pipeline consumer (SFT baseline, DPO trainer, bandit featuriser) to fall back to unweighted behaviour until the gate opens, instead of silently training on a thin prior.

The reward service is **read-only** by design. It never mutates `listening_eval_rewards`; refresh is driven by the staff route or (future) a scheduled job. This keeps the dependency graph acyclic: `ListeningEvalService` owns writes, `RewardService` owns reads, trainers consume the read surface.

---

## 3. What shipped — listening-drill UX fixes (this session)

Three user-reported bugs. All three landed together because they share a substrate (`drillTokens.ts` expansion + `ListeningMinimalPairsPanel` text generation), and because fixing #1 without #3 would have made the raw-sentinel leak worse.

### 3.1 Bug #1 — `"fin"` pronounced as `"fine"`

**Root cause.** [`drillTokens.ts`](../frontend/src/utils/drillTokens.ts) mapped short single-syllable tokens to the bare word:

```ts
F_FIN_MODEL: 'fin',
TH_THIN_MODEL: 'thin',
// …
```

On the Voice Live "say-verbatim" path ([`frontend/src/app/App.tsx` `speakExerciseText`](../frontend/src/app/App.tsx) line 2614) a bare monosyllable with no phonetic onset triggers the model's default "long vowel in isolation" prior — `fin` becomes `fine`, `thin` becomes `thine`.

**Fix.** Adopt the same `onset, word` pattern already used for the longer drill tokens (`rrr-ah, rah`):

```ts
F_FIN_MODEL:   'fff-in, fin',
F_FREE_MODEL:  'fff-ree, free',
F_FAWN_MODEL:  'fff-awn, fawn',
TH_THIN_MODEL: 'th-in, thin',
TH_THREE_MODEL:'th-ree, three',
TH_THORN_MODEL:'th-orn, thorn',
TH_THUMB_MODEL:'th-umb, thumb',
```

The onset locks the short-vowel pronunciation. The existing reverse lookup (`DRILL_WORD_TO_TOKEN_MAP`) still works because the builder splits on comma and keeps the last segment — no call sites need to change.

### 3.2 Bug #2 — Instruction wording

**User ask.** *"Instead of `Listen carefully. fin. Tap the matching picture`, why can't we say `Listen carefully to the word`, then emphasise the word `fin`, `Tap the matching picture`?"*

**Fix.** Two-part change in `ListeningMinimalPairsPanel.tsx`:

1. `buildInstruction` now emits:
   `Listen carefully to the word. <TOKEN>. <TOKEN>. Tap the matching picture.`
   The preamble *to the word* primes the child that the next spoken segment IS the target, not a generic instruction word. The token is double-spoken because we cannot inject SSML on the say-verbatim path — repetition is the cleanest text-only emphasis.

2. `buildRetryText` likewise says the target twice then names the contrast:
   `Let's listen again. <TARGET>. <TARGET>. Was it <TARGET> or <COMPARISON>?`

### 3.3 Bug #3 — Raw sentinels leaking into UI

**Root cause.** The panel was calling `setStatusText(retryText)` with the same drill-token string it passed to the TTS. Children saw `Let's listen again. F_FREE_MODEL. TH_THREE_MODEL.` rendered in the DOM.

**Fix.** Split the two channels:

- **Spoken channel** (avatar) still receives the sentinel-laden string so the TTS pronounces the token correctly.
- **Visible `statusText`** uses plain English with the original word:
  - `Great listening — you picked "fin"!`
  - `Not quite — let's listen again.`
  - `The word was "thin". Let's try a new one.`

### 3.4 Bug #4 (bonus) — Wrong-answer retry loop

While investigating #1/#2/#3 we found `handleSelect`'s wrong-answer path calling `beginInstructionTurn(promptWord)` with **no retry cap**. A child who can't yet discriminate the contrast was locked on the same pair forever. Added a `MAX_RETRIES_PER_PAIR = 2` guard driven by `retryCountRef`. After the cap the panel speaks a reveal line, counts the turn as attempted (so the therapist's `repetitionTarget` still progresses), and advances. The ref resets on pair advance, correct answer, skip-pair, and `resetKey`.

### 3.5 Incidental — `phonemeSsml.ts` merge conflict

`src/utils/phonemeSsml.ts` had a stale duplicate block at lines 190–354 that re-declared `SOUND_TO_IPA`, `SOUND_PREVIEW_DEFINITIONS`, and four exported functions. esbuild refused to transform the module, which in turn blocked the entire `ExercisePanels.test.tsx` suite from loading. Deleted the stale block. Four pre-existing TTS-preview tests that expected the *older* behaviour (`pseudo` default strategy instead of `ipa`) now fail — they are unrelated to this sprint and are logged as follow-up.

### 3.6 Tests

- All 9 `ListeningMinimalPairsPanel` tests green, including the new `reveals the target and advances after the retry cap is exceeded`.
- Backend `test_reward_service_respects_gate` exercises the `None`-when-gated contract.

---

## 4. Deferred work — and why

This is the section a senior engineer cares about most. Every item below is consciously parked with a reason, not forgotten.

### 4.1 Staff React surface for the A/B tool — *Deferred*

**What.** The staff-facing React surface under `frontend/src/app/staff/listening-eval/` that would let therapists cast votes, refresh rewards, and export CSVs.

**Why deferred.**
1. The backend blueprint is consumable directly via curl + CSV. For the first ~20 votes we'd rather prototype with a spreadsheet than bake UI assumptions into a tool we may re-scope once we see real voting behaviour.
2. Building the UI now risks a **measurement-instrument bias** — making voting *easier* is exactly what drives untrained raters to click through without thinking. We want early votes to come from ≤5 carefully briefed therapists, which is better served by a spreadsheet workflow.
3. The frontend sprint budget this window went to listening-drill UX fixes, which protect the *signal source* feeding the A/B tool. Fixing the pronouncing-`fin`-as-`fine` bug was higher-leverage than building the vote-collection UI.

**Unblock trigger.** Once we have ~3 therapists and ~50 votes via CSV workflow, or when a therapist explicitly asks for the UI.

### 4.2 Scheduled reward refresh — *Deferred*

**What.** A nightly Azure Container Apps job that calls `ListeningEvalService.refresh_rewards()` and caches the result.

**Why deferred.** The reward gate is at `MIN_VOTES_FOR_REWARD = 200`. We are empirically months away from triggering it. Running a nightly job against an empty-ish table is pure ops overhead with zero signal, and the manual `/staff/listening-eval/rewards/refresh` endpoint covers the interim.

**Unblock trigger.** When aggregate votes cross 150 (75% of gate) we schedule the job so the first gate-open is observed in a dashboard rather than in a human refresh.

### 4.3 Contextual bandit ranker (Stage 1) — *Deferred*

**What.** Replace the hard-coded `"score": 4/5/6` in `recommendation_service._rank_candidates` with a Thompson-sampled Beta-Bernoulli posterior per `(target_sound, difficulty_bucket, action_id)`, updated nightly from `recommendation_logs` + rewards.

**Why deferred.** A bandit without a reward signal is just a random-walk ranker. Stage 0 *has no reward* until the gate opens. Shipping the bandit plumbing now would force us to pick a placeholder reward (attempt accuracy alone, say) that would then become de-facto gospel and bias every subsequent design decision. Better to wait for real preference-weighted rewards.

**Unblock trigger.** Reward gate opens AND we have ~200 reward-labelled rows per target sound (per the strategy doc's Stage 0 exit criteria).

### 4.4 DPO / preference training pipeline (Stage 2) — *Deferred*

**What.** Run DPO on a 7–8B open-weights base (Qwen2-7B-Instruct or Llama-3-8B-Instruct) using therapist thumbs and A/B preferences, with the §5 safety rails from the strategy doc.

**Why deferred.** Needs all of: (a) enough preference pairs (~2–10k per the doc), (b) the staff A/B UI to collect at scale, (c) the recommendation-log reward column, (d) Azure ML training environment. We shipped (d-prerequisite data schema) and the `build_dpo_preference_pairs` exporter so the pipeline consumes a stable contract when we do build it, but actually running DPO on ~12 votes would catastrophically overfit.

**Unblock trigger.** Stage 1 bandit is live and stable for ≥14 days, AND we have ≥2k labelled preference pairs with ≥5 distinct therapists.

### 4.5 GRPO / PPO / RLVR — *Explicitly out of scope*

**Why.** These are Stage-2-alternative or Stage-3 paths per the strategy doc (§6b). They require a verifiable reward (GRPO/RLVR) or a full reward-model + rollouts setup (PPO). We don't have the verifier infrastructure wired for plan-level outcomes yet — that lives in a separate future sprint that instruments `scoring.py` + `analyzers.py` to emit end-of-session mastery deltas as structured signals. Picking DPO-first remains the right call for our data regime (pairwise preferences from therapists, small corpus, stability > flexibility).

### 4.6 Voice Live weight updates — *Never*

**Why.** Voice Live is a hosted Azure realtime avatar. We have no weight access, no gradient hook, no training API. The RL strategy doc (§2.1) is unambiguous: *anything behind an Azure endpoint, we treat as an API, not a model.* Every document in this sprint reinforces that rule — the reward service is for *our* policy layer, not for the frontier TTS.

### 4.7 Four failing TTS-preview tests in `ExercisePanels.test.tsx` — *Logged, not owned here*

**What.** After removing the duplicate block in `phonemeSsml.ts`, four tests (`'uses the curated asset for TH and falls back to pseudo TTS for F'`, etc.) fail because they expected the older `pseudo`-default strategy. The current authoritative block defaults to `ipa` and feature-gates pseudo/anchor behind `tts_preview_strategies_unlocked`.

**Why deferred here.** The correct fix is to either (a) update the tests to match the new gated behaviour, or (b) flip the feature flag in the test env. Either way it is a TTS-preview concern, not a listening-eval concern, and fixing it in this thread would conflate two unrelated rollbacks.

**Unblock trigger.** Next TTS-preview sprint. Tracked in the fixes backlog.

---

## 5. Risks & open questions

| Risk | Mitigation in place | Still open |
|---|---|---|
| **Reward formula is naive.** Confidence-weighted mean has no uncertainty quantification, so one high-confidence outlier rater can swing a token. | Gate at ≥3 distinct therapists before any reward is emitted. | Upgrade to Wilson lower-bound or Bayesian posterior before Stage 1 bandit consumes rewards. |
| **Selection bias in which tokens get A/B tested.** If we only create items for tokens that *sound* wrong to the team, the reward corpus is biased toward fixing regressions and under-samples the tokens that sound right. | — | Define a systematic A/B item-creation protocol (e.g. every drill token gets ≥1 item within 30 days of introduction). |
| **Raw sentinels could re-leak in UI.** The panel now splits channels, but `statusText` is one of ~15 call sites. A future `setStatusText(speakingText)` copy-paste would regress. | Tests assert plain-English DOM content after correct/wrong/reveal paths. | Consider a lint rule or a typed `SpokenText` / `VisibleText` nominal split. |
| **Drill-token onset is language-specific.** The `fff-in, fin` expansion assumes an English TTS front-end. Non-English deployments (none today, but `speechLanguage` is already a metadata field) would mispronounce these. | `speechLanguage` is threaded through the metadata. | When a non-English locale is planned, branch `DRILL_TOKEN_DISPLAY_MAP` by locale. |
| **Retry cap is a fixed constant (`MAX_RETRIES_PER_PAIR = 2`).** Therapists may want to tune it per child. | Cap is high enough not to frustrate, low enough to prevent infinite loops. | Expose via exercise metadata once therapists ask. |
| **Stage 0 test coverage is narrow.** `test_reward_service_respects_gate` covers the gated/ungated split but not the CSV export or the DPO exporter. | — | Add table-driven tests for `build_dpo_preference_pairs` and the export endpoint before the staff UI lands. |

---

## 6. Validation run

Frontend (new + changed listening-panel tests):

```bash
cd voicelive-api-salescoach/frontend
npm test -- --run src/components/ExercisePanels.test.tsx \
  -t "listening|Listen|retries|reveals|praises|auto-advances|hands off|hides skip|locks taps|shows skip pair"
# 9 passed, 8 skipped, 0 failed
```

Backend (RL Stage 0):

```bash
/home/ayoola/sen/.venv/bin/python -m pytest \
  backend/tests/unit/test_listening_eval_service.py \
  -k "reward_service_respects_gate or refresh_rewards or build_dpo"
```

(Full repo validation per [`AGENTS.md`](../AGENTS.md) §Validation Commands remains the deploy gate.)

---

## 7. Follow-up backlog (ordered)

1. **[Stage 0 ops]** Dashboard: reward distribution per target sound + gate-progress (`votes / MIN_VOTES_FOR_REWARD`, distinct therapists / min).
2. **[Stage 0 data quality]** Systematic A/B item-creation protocol to kill selection bias.
3. **[Stage 0 math]** Swap the naive confidence-weighted mean for a Wilson lower-bound or Beta-Bernoulli posterior once ≥50 votes land.
4. **[Stage 0 UX]** Staff React surface for vote casting once ≥3 therapists are briefed.
5. **[Stage 0 → 1 bridge]** Add `reward FLOAT`, `reward_components JSONB`, `reward_observed_at TIMESTAMP` to `recommendation_logs` (migration is §10 of the strategy doc; still pending).
6. **[Stage 1]** Contextual bandit on the recommender; shadow-run for one week before A/B.
7. **[Hygiene]** Repair the four pre-existing TTS-preview tests in `ExercisePanels.test.tsx` or gate them behind `tts_preview_strategies_unlocked=true` in the test env.
8. **[Hygiene]** Add a typed `SpokenText` / `VisibleText` nominal split (or eslint rule) to prevent raw-sentinel leaks in `statusText`.

---

## 8. Related reading

- [`docs/reinforcement-learning-strategy.md`](./reinforcement-learning-strategy.md) — the staged RL plan this sprint executes Stage 0 of.
- [`backend/src/services/listening_eval_service.py`](../backend/src/services/listening_eval_service.py) — reward formula (line 324), gate (line 42), DPO exporter (line 542).
- [`backend/src/services/reward_service.py`](../backend/src/services/reward_service.py) — Stage 0 read contract.
- [`frontend/src/components/ListeningMinimalPairsPanel.tsx`](../frontend/src/components/ListeningMinimalPairsPanel.tsx) — emphasis logic, retry cap, UI-vs-spoken channel split.
