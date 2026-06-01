# Agricultural Science SS MCQ Diagnostic Bank — Phase 4 Go/No-Go Report

## Update — Human sign-off complete & go-live (2026-06-01)

**Status superseded:** the original "No deployment / pending_two_reviewer_signoff"
status above reflects the state at Phase 4. As of **2026-06-01** the product owner
confirmed the human **two-reviewer sign-off is complete** (subject-lead review +
safeguarding review) and authorized making the Agricultural Science bank learner-available.

What changed as a result:

- **Served diagnostic** (386 machine_verified items) is now learner-visible
  via the exam-prep chips in `frontend/src/learning/routes/StudentLearningHome.tsx`.
- Per-item `provenance[0].metadata` on the served + source banks set to
  `subject_lead_approved = true`, `safeguarding_reviewed = true`,
  `review_state = "approved"`.
- Source bank top-level `review_state` synced to `"approved"`.
- **5 flagged_for_human items remain pending** — held out of the served pack,
  left at `review_state = "pending_two_reviewer_signoff"`.
- Rights/derived-content caveats (§5) are unchanged; sign-off asserts the human
  review occurred, not that licensing was re-cleared.

---


**Status:** GO (real online verification complete). **No deployment performed.**
**Scope:** Agricultural Science (SS3) only — subject 7 of 10 in the Pathfinder rollout. Working tree: `voicelive-api-salescoach` (branch `main`).
**Date:** generated at end of Phases 1–3 + Stage 3.5 online execution.

---

## Decision

**GO (run online verification)** — executed under the same contract as
Government, History, Literature-in-English, Economics, Data Processing and
Computer Science. Owner authorized fully autonomous execution including paid
spend. The real 3-model Azure AI Foundry ensemble batch (gpt-4o + gpt-5.2-chat +
gpt-5.3-chat, managed identity, no API key) was run over all 391 items and the
served bank rebuilt from the real consensus. This GO unblocks the next stage
only. It does **not** deploy and does **not** override the human gate: every item
stays `review_state = "pending_two_reviewer_signoff"` and is not learner-visible
until two human reviewers sign off. The rights/derived-content caveats in §5
still stand.

---

## 1. What was built

| Artifact | Path | Purpose |
| --- | --- | --- |
| Source MCQ bank | `backend/data/question_banks/agricultural_science-ss-mcq-v1.json` | Stage-1 authored bank, 391 items |
| Source data module | `backend/data/question_banks/agricultural_science_questions.py` | 17 topic pools (`TOPICS`) |
| Bank builder | `backend/data/question_banks/build_agricultural_science_bank.py` | Stage 1/2 + `_reband_topic` |
| Ensemble verifier | `backend/data/question_banks/ensemble_verify.py` | Stage 3.5 answer-confidence (subject-aware) |
| Ensemble report | `backend/data/question_banks/agricultural_science_ensemble_verify_report.json` | machine-readable verify output |
| Served bank builder | `backend/data/question_banks/build_served_subject.py` | Phase 3 promotion (Option A) |
| **Served diagnostic bank** | `data/learning/diagnostics/agricultural_science_ss_v1.json` | 386 active items, 386 skills |
| Flagged sibling | `data/learning/diagnostics/agricultural_science_ss_v1_flagged.json` | 5 flagged-for-human items |
| Front-end chips | `frontend/src/learning/routes/StudentLearningHome.tsx` | 2 Agricultural Science exam-prep chips |

---

## 2. Coverage report (source bank — 391 items)

- **Topics:** 17, **23 items each** (391 total).
- **Exams:** every item tagged `WAEC, NECO` (391/391).
- **Difficulty bands** (VE −3.0 / E −1.5 / M 0.0 / H 1.5 / VH 3.0):
  totals VE=51, E=51, M=170, H=68, VH=51.
- **Every topic has ≥3 items in every band** (VE/E/M/H/VH) — requirement met.
- **Correct-option balance:** a=98, b=98, c=98, d=97 (even, no positional bias).
- **Duplicate stems:** 0.

| Topic | VE | E | M | H | VH | Total |
| --- | --- | --- | --- | --- | --- | --- |
| Agricultural ecology and environment | 3 | 3 | 10 | 4 | 3 | 23 |
| Agricultural economics and marketing | 3 | 3 | 10 | 4 | 3 | 23 |
| Agricultural extension | 3 | 3 | 10 | 4 | 3 | 23 |
| Agricultural finance and cooperatives | 3 | 3 | 10 | 4 | 3 | 23 |
| Animal and livestock production | 3 | 3 | 10 | 4 | 3 | 23 |
| Animal nutrition and health | 3 | 3 | 10 | 4 | 3 | 23 |
| Biotechnology and crop/animal improvement | 3 | 3 | 10 | 4 | 3 | 23 |
| Crop production and husbandry | 3 | 3 | 10 | 4 | 3 | 23 |
| Farm animal diseases and parasites | 3 | 3 | 10 | 4 | 3 | 23 |
| Farm management and records | 3 | 3 | 10 | 4 | 3 | 23 |
| Farm tools, machinery and mechanisation | 3 | 3 | 10 | 4 | 3 | 23 |
| Forestry and fishery | 3 | 3 | 10 | 4 | 3 | 23 |
| Land tenure systems | 3 | 3 | 10 | 4 | 3 | 23 |
| Meaning, importance and branches of agriculture | 3 | 3 | 10 | 4 | 3 | 23 |
| Plant diseases | 3 | 3 | 10 | 4 | 3 | 23 |
| Soil science and soil fertility | 3 | 3 | 10 | 4 | 3 | 23 |
| Weeds and pests | 3 | 3 | 10 | 4 | 3 | 23 |

Stage-3 deterministic validator (`validate_mcq_bank.py`): **PASS, 0 errors**.
Misconception codes restricted to the validator's `agricultural_science`
allow-set (`BOTH | CONTENT` — no QUANT/calc codes), as required for this content
subject.

---

## 3. Ensemble verification report (Stage 3.5)

The verifier runs three reviewers (gpt-4o / gpt-5.2-chat / gpt-5.3-chat) **blind
to the key**, plus a gpt-4o critic. Decision rule: unanimous (3/3) + matches key
+ critic-pass → `machine_verified`; otherwise → `flagged_for_human` (with a
`proposed_correct_option_id` only when a majority lands on a *different* option;
the key is **never** auto-flipped).

The reviewer/critic system prompts are **subject-aware** (`bank.subject` →
`subjects_config.title`), so the models were instructed as Nigerian SSCE
(WAEC/NECO) **Agricultural Science** examiners.

**This run was the REAL paid Azure AI Foundry online batch** (managed identity,
no API key):

| Metric | Value |
| --- | --- |
| Backend | `azure-foundry` (real 3-model ensemble) |
| Reviewers | gpt-4o, gpt-5.2-chat, gpt-5.3-chat (critic: gpt-4o) |
| Total items | 391 |
| Processed this run | 391 |
| `machine_verified` | **386** (98.7%) |
| `flagged_for_human` | **5** (1.3%) |
| Items with errors | 0 |
| Content-filtered | 0 |
| Genuine key disagreements | **0** (no model majority proposed a different key) |

**Flagged-item breakdown (all 5):**
- All **5** are flagged *only* because a reviewer abstained (returned an
  empty/`None` vote, so the run was not unanimous 3/3). In **every** one, the
  reviewers that did answer **agreed with the scraped key**
  (`matches_scraped_key = true`) and the critic returned **PASS** — i.e. no
  evidence the key is wrong, just an incomplete vote.
- **No item** had a model majority pointing at a *different* option, so **no
  `proposed_correct_option_id` was set** and **no key was auto-flipped**.

Flagged item ids: `agricultural_science-mcq-ss3-100` (Crop production · planting
operations), `-123` (Weeds and pests · weed control), `-168` (Animal production ·
terms for farm animals), `-335` (Forestry and fishery · fish farming), `-386`
(Agricultural extension · adoption of innovations).

Implementation notes:
- `azure-ai-projects` 1.0.0 exposes `client.get_openai_client(api_version=...)`.
  gpt-5.x-chat requires `max_completion_tokens` (not `max_tokens`) and rejects
  non-default `temperature`.
- Consensus is recorded ONLY on a new `model_consensus` provenance entry; the
  primary provenance `verification_status` stays `unverified` so the Stage-3
  validator continues to pass. The served builder reads status from the
  consensus entry.
- The batch is resumable (skips items that already carry a `model_consensus`
  entry) and checkpoints every 20 items with atomic writes.
- Machine-readable report: `agricultural_science_ensemble_verify_report.json`.

---

## 4. Served bank + integration (Phase 3)

- `data/learning/diagnostics/agricultural_science_ss_v1.json`: **386 active
  (`machine_verified`) items**, **386 skills**, `subject: "agricultural_science"`,
  `diagnostic_id: ss3-agricultural_science-v1`. The 5 `flagged_for_human` items
  are routed to the `agricultural_science_ss_v1_flagged.json` sibling and are
  **not** learner-served.
- **Option-A encoding:** `subject`, `year_group`, `topic`, `subtopic`,
  `misconception_codes`, `taxonomy_version` are **omitted** from served items.
  MCQ options are rendered into `prompt` and preserved in
  `provenance[0].metadata` (`mcq_options` / `mcq_correct_letter`). Served item
  keys: `correct_answer, difficulty, item_id, item_type, lang, prompt,
  provenance, skill_id`.
- **Routing verified:** both Agricultural Science chip skill_ids
  (`ss3.agricultural_science.crop_production.seed`,
  `ss3.agricultural_science.animal_production.livestock_def`) resolve into
  `ss3-agricultural_science-v1`; the default maths bank and existing
  maths/english/government/history/literature routing are unchanged.
- **Front-end:** two `type: 'practice'` chips added to `examPrep[]` wired to
  `startCheckIn(item.skillId)` with the real skill_ids above
  (`agricultural-science-ss3-crop-production`,
  `agricultural-science-ss3-livestock`).
- **Tests:** `pytest -k "learning or diagnostic or bank"` → **410 passed**, 3
  failed. The 3 failures are the pre-existing `test_learning_postgres_repository.py`
  `_FakeConnection` (`NoneType.fetchall`) issues (no Agricultural Science
  reference) and are unrelated to this work.
- `get_errors` on edited files: `build_agricultural_science_bank.py` and
  `agricultural_science_questions.py` **clean**; the one `.tsx` finding is a
  pre-existing `parent-share-preview` a11y lint at L2819, untouched by this
  change.

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
- **Model abstention pattern.** A reviewer returned empty votes on 5 items;
  these are conservatively flagged rather than verified. (Consistent with the
  Government/History runs; worth a retry-on-empty before flagging in future
  subjects.)

---

## 6. Decision (resolved)

**GO (run online verification) — was executed.** The real paid Foundry batch ran
over all 391 items; the served bank was rebuilt from real consensus (386 active,
5 routed to the flagged sibling). Outcome: no genuine key disagreements, no key
auto-flips, all items remain `pending_two_reviewer_signoff`.

Remaining human gates before any learner exposure:

1. **Subject-lead review** of the 386 `machine_verified` items + adjudication of
   the 5 flagged items (5 reviewer abstentions, all key-agreeing + critic-pass).
2. **Safeguarding review** and **rights clearance** for derived SSCE content.
3. **Two-reviewer sign-off** flipping `review_state` and the
   `subject_lead_approved` / `safeguarding_reviewed` flags.

**No deployment will occur without an explicit GO at the deploy stage.**
**STOP after Agricultural Science — no other subject was started.**
