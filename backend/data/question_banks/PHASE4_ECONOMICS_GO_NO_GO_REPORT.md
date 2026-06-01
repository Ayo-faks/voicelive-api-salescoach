# Economics SS MCQ Diagnostic Bank — Phase 4 Go/No-Go Report

## Update — Human sign-off complete & go-live (2026-06-01)

**Status superseded:** the original "No deployment / pending_two_reviewer_signoff"
status above reflects the state at Phase 4. As of **2026-06-01** the product owner
confirmed the human **two-reviewer sign-off is complete** (subject-lead review +
safeguarding review) and authorized making the Economics bank learner-available.

What changed as a result:

- **Served diagnostic** (318 machine_verified items) is now learner-visible
  via the exam-prep chips in `frontend/src/learning/routes/StudentLearningHome.tsx`.
- Per-item `provenance[0].metadata` on the served + source banks set to
  `subject_lead_approved = true`, `safeguarding_reviewed = true`,
  `review_state = "approved"`.
- Source bank top-level `review_state` synced to `"approved"`.
- **9 flagged_for_human items remain pending** — held out of the served pack,
  left at `review_state = "pending_two_reviewer_signoff"`.
- Rights/derived-content caveats (§5) are unchanged; sign-off asserts the human
  review occurred, not that licensing was re-cleared.

---


**Status:** GO (real online verification complete) — decision recorded 2026-05-31. **No deployment performed.**
**Scope:** Economics (SS3) only — subject 4 of 10 in the Pathfinder rollout. Working tree: `voicelive-api-salescoach` (branch `main`).
**Date:** generated at end of Phases 1–3 + Stage 3.5 online execution.

---

## Decision (2026-05-31)

**GO (run online verification)** — executed under the same contract as
Government (subject 1), History (subject 2), and Literature-in-English (subject
3). Owner authorized fully autonomous execution including paid spend. The real
3-model Azure AI Foundry ensemble batch (gpt-4o + gpt-5.2-chat + gpt-5.3-chat,
managed identity, no API key) was run over all 327 items and the served bank
rebuilt from the real consensus. This GO unblocks the next stage only. It does
**not** deploy and does **not** override the human gate: every item stays
`review_state = "pending_two_reviewer_signoff"` and is not learner-visible until
two human reviewers sign off. The rights/derived-content caveats in §5 still
stand.

---

## 1. What was built

| Artifact | Path | Purpose |
| --- | --- | --- |
| Source MCQ bank | `backend/data/question_banks/economics-ss-mcq-v1.json` | Stage-1 authored bank, 327 items |
| Source data module | `backend/data/question_banks/economics_questions.py` | 14 topic pools (`TOPICS`) |
| Bank builder | `backend/data/question_banks/build_economics_bank.py` | Stage 1/2 + `_reband_topic` |
| Ensemble verifier | `backend/data/question_banks/ensemble_verify.py` | Stage 3.5 answer-confidence (subject-aware) |
| Served bank builder | `backend/data/question_banks/build_served_subject.py` | Phase 3 promotion (Option A) |
| **Served diagnostic bank** | `data/learning/diagnostics/economics_ss_v1.json` | 318 active items, 139 skills |
| Flagged sibling | `data/learning/diagnostics/economics_ss_v1_flagged.json` | 9 flagged-for-human items |
| Front-end chips | `frontend/src/learning/routes/StudentLearningHome.tsx` | 2 Economics exam-prep chips |
| Loader safeguard | `backend/src/learning/diagnostic.py` | `load_subject_diagnostics` now skips `*_flagged.json` |

---

## 2. Coverage report (source bank — 327 items)

- **Topics:** 14, ~23 items each (21–26).
- **Exams:** every item tagged `WAEC, NECO` (327/327).
- **Difficulty bands** (VE −3.0 / E −1.5 / M 0.0 / H 1.5 / VH 3.0).
- **Every topic has ≥3 items in every band** (VE/E/M/H/VH) — requirement met.
- **Correct-option balance:** a=82, b=82, c=82, d=81 (even, no positional bias).
- **Duplicate stems:** 0.

| Topic | VE | E | M | H | VH | Total |
| --- | --- | --- | --- | --- | --- | --- |
| Agriculture and industrialisation | 3 | 3 | 7 | 6 | 3 | 22 |
| Banking and financial institutions | 3 | 3 | 5 | 8 | 3 | 22 |
| Basic economic problem (scarcity & choice) | 3 | 3 | 13 | 3 | 3 | 25 |
| Cost and revenue | 3 | 3 | 5 | 10 | 3 | 24 |
| Economic development and planning | 3 | 3 | 6 | 10 | 3 | 25 |
| Elasticity of demand and supply | 3 | 3 | 5 | 10 | 3 | 24 |
| International trade and balance of payments | 3 | 3 | 3 | 10 | 3 | 22 |
| Market structures | 3 | 3 | 4 | 9 | 3 | 22 |
| Money and inflation | 3 | 3 | 4 | 9 | 3 | 22 |
| National income | 3 | 3 | 6 | 11 | 3 | 26 |
| Population | 3 | 3 | 3 | 9 | 3 | 21 |
| Public finance and taxation | 3 | 3 | 7 | 6 | 3 | 22 |
| Theory of demand and supply | 3 | 3 | 13 | 4 | 3 | 26 |
| Theory of production | 3 | 3 | 10 | 5 | 3 | 24 |

Numerical items were checked for arithmetic correctness (PED/YED elasticities,
GNP/NNP/per-capita income, credit multiplier, natural increase rate, TC/AC/AFC/
AVC/MC, TR and profit).

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
Nigerian SSCE (WAEC/NECO) **Economics** examiners.

**This run was the REAL paid Azure AI Foundry online batch** (managed identity,
no API key):

| Metric | Value |
| --- | --- |
| Backend | `azure-foundry` (real 3-model ensemble) |
| Reviewers | gpt-4o, gpt-5.2-chat, gpt-5.3-chat (critic: gpt-4o) |
| Total items | 327 |
| Processed this run | 325 (2 already verified in the pre-run smoke test) |
| `machine_verified` | **318** (97.2%) |
| `flagged_for_human` | **9** (2.8%) |
| Items with errors | 0 |
| Content-filtered | 0 |
| Genuine key disagreements | **0** (no model majority proposed a different key) |

**Flagged-item breakdown (all 9):**
- The 9 flagged items include items 035 (`ss3.economics.demand_supply.demand_types`)
  and 139 (`ss3.economics.market_structures.comparison`), which surfaced as
  `key_disagreements` with `agreement = 1`. In both, `proposed_correct_option_id`
  is **null** — i.e. no model majority converged on a *different* option, so the
  scraped key was **not** auto-flipped; both are conservatively routed to a human.
- The remaining flagged items are flagged because the run was not a unanimous
  3/3 (a reviewer abstained / returned an empty vote, or the critic did not
  return PASS), not because the key is believed wrong.
- **No item** had a model majority pointing at a *different* option, so **no
  `proposed_correct_option_id` was set** and **no key was auto-flipped**.

Implementation notes:
- gpt-5.x-chat requires `max_completion_tokens` (not `max_tokens`) and rejects
  non-default `temperature`.
- Consensus is recorded ONLY on a new `model_consensus` provenance entry; the
  primary provenance `verification_status` stays `unverified` so the Stage-3
  validator continues to pass. The served builder reads status from the
  consensus entry. All 327 items carry a `model_consensus` entry; all 327
  primary entries remain `unverified`.
- The batch is resumable (skips items that already carry a `model_consensus`
  entry) and checkpoints every 20 items with atomic writes.

---

## 4. Served bank + integration (Phase 3)

- `data/learning/diagnostics/economics_ss_v1.json`: **318 active
  (`machine_verified`) items**, **139 skills**, `subject: "economics"`,
  `diagnostic_id: ss3-economics-v1`. The 9 `flagged_for_human` items are routed
  to the `economics_ss_v1_flagged.json` sibling
  (`diagnostic_id: ss3-economics-v1-flagged`) and are **not** learner-served.
- **Option-A encoding:** `subject`, `year_group`, `topic`, `subtopic`,
  `misconception_codes`, `taxonomy_version` are **omitted** from served items.
  MCQ options are rendered into `prompt` and preserved in
  `provenance[0].metadata` (`mcq_options` / `mcq_correct_letter`).
- **Routing verified:** both Economics chip skill_ids
  (`ss3.economics.basic_economic_problem.scarcity`,
  `ss3.economics.demand_supply.law_of_demand`) resolve into active
  `machine_verified` items in `ss3-economics-v1`; the default maths bank and
  existing maths/english/government/history/literature routing are unchanged.
- **Front-end:** two `type: 'practice'` chips added to `examPrep[]` wired to
  `startCheckIn(item.skillId)` with the real skill_ids above
  (`economics-ss3-scarcity-choice`, `economics-ss3-demand-supply`).
- **Loader safeguarding fix (in-scope, safeguarding-positive):**
  `load_subject_diagnostics` previously globbed **every** `*.json` in the served
  diagnostics directory — including the `*_flagged.json` human-review queues —
  into the student-serving registry. Because Economics legitimately flagged only
  9 items, `test_subject_registry_loads_all_fixtures` (which asserts every loaded
  bank has ≥10 items) failed. Rather than weaken the test or manipulate
  verification to reach 10, the loader now **skips `*_flagged.json` files**. This
  is the correct safeguard: flagged-for-human items must never enter the serving
  registry. It also closes a latent gap where prior subjects' flagged
  (unverified) items were reachable via their `-flagged` diagnostic_id. No
  serving test depended on flagged banks being loaded.
- **Tests:** `pytest -k "learning or diagnostic or bank"` → **410 passed**, 3
  failed. The 3 failures are the pre-existing `test_learning_postgres_repository.py`
  `_FakeConnection` (`NoneType.fetchall`) issues (no Economics reference) and are
  unrelated to this work.
- `get_errors` on edited files: `diagnostic.py`, `economics_questions.py`,
  `build_economics_bank.py` **clean**; the one `.tsx` finding is a pre-existing
  `parent-share-preview` a11y lint at L2819, untouched by this change.

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
  change. The two `key_disagreements` (035, 139) carry `proposed_correct_option_id
  = null` and are held for a human.
- **Model abstention pattern.** Some flagged items reflect reviewer abstentions
  / a non-PASS critic rather than evidence the key is wrong; these are
  conservatively flagged rather than verified.

---

## 6. Decision (resolved)

**Option 2 — GO (run online verification) — was executed.** The real paid Foundry
batch ran over all 327 items; the served bank was rebuilt from real consensus
(318 active, 9 routed to the flagged sibling). Outcome: no genuine key
disagreements, no key auto-flips, all items remain
`pending_two_reviewer_signoff`.

Remaining human gates before any learner exposure:

1. **Subject-lead review** of the 318 `machine_verified` items + adjudication of
   the 9 flagged items.
2. **Safeguarding review** and **rights clearance** for derived SSCE content.
3. **Two-reviewer sign-off** flipping `review_state` and the
   `subject_lead_approved` / `safeguarding_reviewed` flags.

**No deployment will occur without an explicit GO at the deploy stage.**
**STOP after Economics — no other subject was started.**
