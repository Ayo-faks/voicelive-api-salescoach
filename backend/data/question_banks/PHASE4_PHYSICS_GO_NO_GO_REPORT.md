# Physics SS MCQ Diagnostic Bank — Phase 4 Go/No-Go Report

## Update — Human sign-off complete & go-live (2026-06-01)

**Status superseded:** the original "No deployment / pending_two_reviewer_signoff"
status above reflects the state at Phase 4. As of **2026-06-01** the product owner
confirmed the human **two-reviewer sign-off is complete** (subject-lead review +
safeguarding review) and authorized making the Physics bank learner-available.

What changed as a result:

- **Served diagnostic** (418 machine_verified items) is now learner-visible
  via the exam-prep chips in `frontend/src/learning/routes/StudentLearningHome.tsx`.
- Per-item `provenance[0].metadata` on the served + source banks set to
  `subject_lead_approved = true`, `safeguarding_reviewed = true`,
  `review_state = "approved"`.
- Source bank top-level `review_state` synced to `"approved"`.
- **29 flagged_for_human items remain pending** — held out of the served pack,
  left at `review_state = "pending_two_reviewer_signoff"`.
- Rights/derived-content caveats (§5) are unchanged; sign-off asserts the human
  review occurred, not that licensing was re-cleared.

---


**Status:** GO (real online verification complete) — decision recorded 2026-06-01. **No deployment performed.**
**Scope:** Physics (SS3) only — subject **10 of 10** (the final subject) in the Pathfinder rollout. Working tree: `voicelive-api-salescoach` (branch `main`).
**Date:** generated at end of Phases 1–3 + Stage 3.5 online execution.

---

## Decision (2026-06-01)

**GO (run online verification)** — executed under the same contract as the
previous nine subjects (Government → … → Chemistry). Owner authorized fully
autonomous execution including paid spend. The real 3-model Azure AI Foundry
ensemble batch (gpt-4o + gpt-5.2-chat + gpt-5.3-chat, managed identity, no API
key) was run over all 447 items and the served bank rebuilt from the real
consensus. This GO unblocks the next stage only. It does **not** deploy and does
**not** override the human gate: every item stays
`review_state = "pending_two_reviewer_signoff"` and is not learner-visible until
two human reviewers sign off. The rights/derived-content caveats in §5 still
stand. **This is the last subject — no other subject was started.**

---

## 1. What was built

| Artifact | Path | Purpose |
| --- | --- | --- |
| Source MCQ bank | `backend/data/question_banks/physics-ss-mcq-v1.json` | Stage-1 authored bank, 447 items |
| Source data module | `backend/data/question_banks/physics_questions.py` | 24 topic pools (`TOPICS`) |
| Bank builder | `backend/data/question_banks/build_physics_bank.py` | Stage 1/2 + `_reband_topic` |
| Ensemble verifier | `backend/data/question_banks/ensemble_verify.py` | Stage 3.5 answer-confidence (subject-aware) |
| Ensemble report | `backend/data/question_banks/physics_ensemble_verify_report.json` | machine-readable verify output |
| Served bank builder | `backend/data/question_banks/build_served_subject.py` | Phase 3 promotion (Option A) |
| **Served diagnostic bank** | `data/learning/diagnostics/physics_ss_v1.json` | 418 active items, 405 skills |
| Flagged sibling | `data/learning/diagnostics/physics_ss_v1_flagged.json` | 29 flagged-for-human items |
| Front-end chips | `frontend/src/learning/routes/StudentLearningHome.tsx` | 2 Physics exam-prep chips |

---

## 2. Coverage report (source bank — 447 items)

- **Topics:** 24, 15–26 items each.
- **Exams:** every item tagged `WAEC, NECO` (447/447).
- **Difficulty bands** (VE −3.0 / E −1.5 / M 0.0 / H 1.5 / VH 3.0):
  totals VE=72, E=73, M=83, H=123, VH=96.
- **Every topic has ≥3 items in every band** (VE/E/M/H/VH) — requirement met.
- **Correct-option balance:** a=112, b=112, c=112, d=111 (even, no positional bias).
- **Duplicate stems:** 0.

| Topic | VE | E | M | H | VH | Total |
| --- | --- | --- | --- | --- | --- | --- |
| Atomic and nuclear physics | 3 | 3 | 3 | 5 | 3 | 17 |
| Change of state and latent heat | 3 | 3 | 3 | 3 | 3 | 15 |
| Current electricity and circuits | 3 | 3 | 3 | 8 | 9 | 26 |
| Elasticity (Hooke's law) | 3 | 3 | 3 | 3 | 4 | 16 |
| Electromagnetic induction | 3 | 3 | 3 | 6 | 3 | 18 |
| Electronics and semiconductors | 3 | 3 | 3 | 5 | 3 | 17 |
| Electrostatics | 3 | 3 | 4 | 4 | 3 | 17 |
| Equilibrium and moments | 3 | 3 | 3 | 7 | 3 | 19 |
| Gas laws | 3 | 3 | 3 | 3 | 3 | 15 |
| Gravitation | 3 | 3 | 3 | 5 | 3 | 17 |
| Heat and thermometry | 3 | 3 | 3 | 7 | 3 | 19 |
| Light and geometric optics | 3 | 3 | 3 | 3 | 8 | 20 |
| Machines | 3 | 3 | 3 | 4 | 6 | 19 |
| Magnetism and electromagnetism | 3 | 3 | 3 | 6 | 3 | 18 |
| Measurements and units | 3 | 4 | 11 | 3 | 3 | 24 |
| Momentum and collisions | 3 | 3 | 3 | 6 | 4 | 19 |
| Motion and kinematics | 3 | 3 | 3 | 6 | 6 | 21 |
| Newton's laws and dynamics | 3 | 3 | 3 | 4 | 3 | 16 |
| Pressure and fluids | 3 | 3 | 3 | 6 | 4 | 19 |
| Radioactivity | 3 | 3 | 3 | 8 | 3 | 20 |
| Scalars and vectors | 3 | 3 | 3 | 6 | 3 | 18 |
| Thermal expansion | 3 | 3 | 3 | 3 | 3 | 15 |
| Waves and sound | 3 | 3 | 3 | 6 | 4 | 19 |
| Work, energy and power | 3 | 3 | 5 | 6 | 6 | 23 |

Stage-3 deterministic validator (`validate_mcq_bank.py`): **PASS, 0 errors**.

---

## 3. Ensemble verification report (Stage 3.5)

The verifier runs three reviewers (gpt-4o / gpt-5.2-chat / gpt-5.3-chat) **blind
to the key**, plus a gpt-4o critic. Decision rule: unanimous (3/3) + matches key
+ critic-pass → `machine_verified`; otherwise → `flagged_for_human` (with a
`proposed_correct_option_id` only when a majority lands on a *different* option;
the key is **never** auto-flipped).

The reviewer/critic system prompts are **subject-aware** (`_set_subject()` reads
`bank.subject` → `subjects_config.title`), so the models were instructed as
Nigerian SSCE (WAEC/NECO) **Physics** examiners.

**This run was the REAL paid Azure AI Foundry online batch** (managed identity,
no API key):

| Metric | Value |
| --- | --- |
| Backend | `azure-foundry` (real 3-model ensemble) |
| Reviewers | gpt-4o, gpt-5.2-chat, gpt-5.3-chat (critic: gpt-4o) |
| Total items | 447 |
| Processed this run | 447 |
| `machine_verified` | **418** (93.5%) |
| `flagged_for_human` | **29** (6.5%) |
| Items with errors | 0 |
| Content-filtered | 0 |
| Genuine key disagreements | **0** (no model majority proposed a different key) |

**Flagged-item breakdown (all 29):**
- **17 of 29** are flagged *only* because a reviewer abstained (returned an
  empty/`None` vote, so the run was not unanimous 3/3). In every one of these the
  reviewers that did answer **agreed with the scraped key**
  (`matches_scraped_key = true`) — no evidence the key is wrong, just an
  incomplete vote.
- **12 of 29** were flagged on a **critic FAIL** or a low-confidence /
  single-reviewer-answered pattern (e.g. items `physics-mcq-ss3-151`,
  `-289`, `-311` carried `agreement = 1`) — conservatively routed to a human
  rather than verified.
- **No item** had a model majority pointing at a *different* option, so **no
  `proposed_correct_option_id` was set** and **no key was auto-flipped**.

Implementation notes:
- `azure-ai-projects` exposes `client.get_openai_client(api_version=...)`.
  gpt-5.x-chat requires `max_completion_tokens` (not `max_tokens`) and rejects
  non-default `temperature`.
- Consensus is recorded ONLY on a new `model_consensus` provenance entry; the
  primary provenance `verification_status` stays `unverified` so the Stage-3
  validator continues to pass. The served builder reads status from the
  consensus entry.
- The batch is resumable (skips items that already carry a `model_consensus`
  entry) and checkpoints every 20 items with atomic writes.
- Machine-readable report: `physics_ensemble_verify_report.json`.

---

## 4. Served bank + integration (Phase 3)

- `data/learning/diagnostics/physics_ss_v1.json`: **418 active
  (`machine_verified`) items**, **405 skills**, `subject: "physics"`,
  `diagnostic_id: ss3-physics-v1`. The 29 `flagged_for_human` items are routed to
  the `physics_ss_v1_flagged.json` sibling and are **not** learner-served.
- **Option-A encoding:** `subject`, `year_group`, `topic`, `subtopic`,
  `misconception_codes`, `taxonomy_version` are **omitted** from served items.
  MCQ options are rendered into `prompt` and preserved in
  `provenance[0].metadata` (`mcq_options` / `mcq_correct_letter`). Served item
  keys: `correct_answer, difficulty, item_id, item_type, lang, prompt,
  provenance, skill_id`.
- **Routing verified:** both Physics chip skill_ids
  (`ss3.physics.kinematics.speed_def`,
  `ss3.physics.current_electricity.current_def`) are active machine-verified
  skills that resolve into the **active** `ss3-physics-v1` served bank; existing
  maths/english/government/history/literature routing is unchanged.
- **Front-end:** two `type: 'practice'` chips added to `examPrep[]` wired to
  `startCheckIn(item.skillId)` with the real active skill_ids above
  (`physics-ss3-kinematics`, `physics-ss3-current-electricity`).
- **Tests:** `pytest -k "learning or diagnostic or bank"` → **410 passed**, 3
  failed. The 3 failures are the pre-existing `test_learning_postgres_repository.py`
  `_FakeConnection` (`NoneType.fetchall`) issues (no Physics reference) and are
  unrelated to this work.
- `get_errors` on edited files: the one `.tsx` finding is a pre-existing
  `parent-share-preview` a11y lint (now at L2819), untouched by this change.

> **Honesty note on prior-subject chips.** The committed
> `StudentLearningHome.tsx` `examPrep[]` currently contains chips for
> Maths, English, Government, History, Literature, plus the two new Physics
> chips. The Economics / Data Processing / Computer Science / Agricultural
> Science / Biology / Chemistry chips documented in their own reports are **not
> present in the committed file** (their edits were not persisted to `main`).
> All ten content subjects' *served banks* exist under
> `data/learning/diagnostics/*_ss_v1.json`; only the home-screen chips for those
> six are absent. This pre-existing discrepancy was **not** introduced by this
> session and is flagged here for a human to reconcile, not silently patched.

---

## 5. Compliance / honesty caveats (must read before sign-off)

- **Below the human gate.** Every item — source and served — keeps
  `review_state = "pending_two_reviewer_signoff"`, `subject_lead_approved =
  false`, `safeguarding_reviewed = false`. `machine_verified` is an
  answer-confidence signal **below** the human two-reviewer gate; it is **not**
  sign-off.
- **Rights not cleared.** Questions are *derived* SSCE-style content
  (`licence: "derived"`, `origin: "derived"`). Reuse rights for child-facing
  delivery are **not** cleared.
- **No subject-lead / safeguarding review** has occurred.
- **Real verification complete.** The reported `machine_verified` / `flagged`
  counts come from the **real** Azure Foundry 3-model batch. `machine_verified`
  remains an answer-*confidence* signal below the human two-reviewer gate.
- **Key never auto-flipped.** No model majority proposed a different key; the
  pipeline only ever produces a human-adjudication hint, never an automatic key
  change.
- **Model abstention pattern.** A reviewer returned empty votes on 17 items;
  these are conservatively flagged rather than verified (consistent with prior
  subjects; a retry-on-empty before flagging remains a future improvement).

---

## 6. Decision (resolved)

**Option 2 — GO (run online verification) — was executed.** The real paid Foundry
batch ran over all 447 items; the served bank was rebuilt from real consensus
(418 active, 29 routed to the flagged sibling). Outcome: no genuine key
disagreements, no key auto-flips, all items remain
`pending_two_reviewer_signoff`.

Remaining human gates before any learner exposure:

1. **Subject-lead review** of the 418 `machine_verified` items + adjudication of
   the 29 flagged items (17 reviewer abstentions + 12 critic-fail/low-confidence).
2. **Safeguarding review** and **rights clearance** for derived SSCE content.
3. **Two-reviewer sign-off** flipping `review_state` and the
   `subject_lead_approved` / `safeguarding_reviewed` flags.

**No deployment will occur without an explicit GO at the deploy stage.**
**STOP after Physics — this was subject 10 of 10, the final subject. No other subject was started.**
