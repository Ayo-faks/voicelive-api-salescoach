# Data Processing SS MCQ Diagnostic Bank — Phase 4 Go/No-Go Report

## Update — Human sign-off complete & go-live (2026-06-01)

**Status superseded:** the original "No deployment / pending_two_reviewer_signoff"
status above reflects the state at Phase 4. As of **2026-06-01** the product owner
confirmed the human **two-reviewer sign-off is complete** (subject-lead review +
safeguarding review) and authorized making the Data Processing bank learner-available.

What changed as a result:

- **Served diagnostic** (331 machine_verified items) is now learner-visible
  via the exam-prep chips in `frontend/src/learning/routes/StudentLearningHome.tsx`.
- Per-item `provenance[0].metadata` on the served + source banks set to
  `subject_lead_approved = true`, `safeguarding_reviewed = true`,
  `review_state = "approved"`.
- Source bank top-level `review_state` synced to `"approved"`.
- **4 flagged_for_human items remain pending** — held out of the served pack,
  left at `review_state = "pending_two_reviewer_signoff"`.
- Rights/derived-content caveats (§5) are unchanged; sign-off asserts the human
  review occurred, not that licensing was re-cleared.

---


**Status:** GO (real online verification complete) — decision recorded 2026-05-30. **No deployment performed.**
**Scope:** Data Processing (SS3) only — subject 5 of 10 in the Pathfinder rollout. Working tree: `voicelive-api-salescoach` (branch `main`).
**Date:** generated at end of Phases 1–3 + Stage 3.5 online execution.

---

## Decision (2026-05-30)

**GO (run online verification)** — executed under the same contract as
Government (subject 1), History (subject 2), Literature-in-English (subject 3),
and Economics (subject 4). Owner authorized fully autonomous execution including
paid spend. The real 3-model Azure AI Foundry ensemble batch (gpt-4o +
gpt-5.2-chat + gpt-5.3-chat, managed identity, no API key) was run over all 335
items and the served bank rebuilt from the real consensus. This GO unblocks the
next stage only. It does **not** deploy and does **not** override the human gate:
every item stays `review_state = "pending_two_reviewer_signoff"` and is not
learner-visible until two human reviewers sign off. The rights/derived-content
caveats in §5 still stand.

---

## 1. What was built

| Artifact | Path | Purpose |
| --- | --- | --- |
| Source MCQ bank | `backend/data/question_banks/data_processing-ss-mcq-v1.json` | Stage-1 authored bank, 335 items |
| Source data module | `backend/data/question_banks/data_processing_questions.py` | 16 topic pools (`TOPICS`) |
| Bank builder | `backend/data/question_banks/build_data_processing_bank.py` | Stage 1/2 + `_reband_topic` |
| Ensemble verifier | `backend/data/question_banks/ensemble_verify.py` | Stage 3.5 answer-confidence (subject-aware) |
| Ensemble report | `backend/data/question_banks/data_processing_ensemble_verify_report.json` | machine-readable verify output |
| Served bank builder | `backend/data/question_banks/build_served_subject.py` | Phase 3 promotion (Option A) |
| **Served diagnostic bank** | `data/learning/diagnostics/data_processing_ss_v1.json` | 331 active items, 212 skills |
| Flagged sibling | `data/learning/diagnostics/data_processing_ss_v1_flagged.json` | 4 flagged-for-human items |
| Front-end chips | `frontend/src/learning/routes/StudentLearningHome.tsx` | 2 Data Processing exam-prep chips |

---

## 2. Coverage report (source bank — 335 items)

- **Topics:** 16, ~21 items each (17–25).
- **Exams:** every item tagged `WAEC, NECO` (335/335).
- **Difficulty bands** (VE −3.0 / E −1.5 / M 0.0 / H 1.5 / VH 3.0):
  totals VE=48, E=48, M=102, H=89, VH=48.
- **Every topic has ≥3 items in every band** (VE/E/M/H/VH) — requirement met.
- **Correct-option balance:** a=84, b=84, c=84, d=83 (even, no positional bias).
- **Duplicate stems:** 0.

| Topic | VE | E | M | H | VH | Total |
| --- | --- | --- | --- | --- | --- | --- |
| Computer ethics and security | 3 | 3 | 4 | 7 | 3 | 20 |
| Computer hardware | 3 | 3 | 11 | 5 | 3 | 25 |
| Computer software | 3 | 3 | 6 | 8 | 3 | 23 |
| Data and information concepts | 3 | 3 | 12 | 3 | 3 | 24 |
| Data communication and networks | 3 | 3 | 5 | 7 | 3 | 21 |
| Data integrity and validation | 3 | 3 | 4 | 8 | 3 | 21 |
| Data representation and number systems | 3 | 3 | 10 | 6 | 3 | 25 |
| Database and DBMS concepts | 3 | 3 | 6 | 7 | 3 | 22 |
| File concepts | 3 | 3 | 8 | 4 | 3 | 21 |
| ICT in society | 3 | 3 | 4 | 4 | 3 | 17 |
| Information processing cycle | 3 | 3 | 4 | 8 | 3 | 21 |
| Internet and the World Wide Web | 3 | 3 | 7 | 5 | 3 | 21 |
| Maintenance and care of computers | 3 | 3 | 4 | 4 | 3 | 17 |
| Presentation packages | 3 | 3 | 3 | 5 | 3 | 17 |
| Spreadsheet packages | 3 | 3 | 8 | 4 | 3 | 21 |
| Word processing | 3 | 3 | 6 | 4 | 3 | 19 |

Stage-3 deterministic validator (`validate_mcq_bank.py`): **PASS, 0 errors**.
Subject allow-list: `data_processing` admits `BOTH | CONTENT | QUANT` item
types (it carries both conceptual and quantitative number-system items).

---

## 3. Ensemble verification report (Stage 3.5)

The verifier runs three reviewers (gpt-4o / gpt-5.2-chat / gpt-5.3-chat) **blind
to the key**, plus a gpt-4o critic. Decision rule: unanimous (3/3) + matches key
+ critic-pass → `machine_verified`; otherwise → `flagged_for_human` (with a
`proposed_correct_option_id` only when a majority lands on a *different* option;
the key is **never** auto-flipped).

The reviewer/critic system prompts are subject-aware (`_set_subject()` reads
`bank.subject` → `subjects_config.title`), so the models were instructed as
Nigerian SSCE (WAEC/NECO) **Data Processing** examiners.

**This run was the REAL paid Azure AI Foundry online batch** (managed identity,
no API key):

| Metric | Value |
| --- | --- |
| Backend | `azure-foundry` (real 3-model ensemble) |
| Reviewers | gpt-4o, gpt-5.2-chat, gpt-5.3-chat (critic: gpt-4o) |
| Total items | 335 |
| Processed this run | 335 |
| `machine_verified` | **331** (98.8%) |
| `flagged_for_human` | **4** (1.2%) |
| Items with errors | 0 |
| Content-filtered | 0 |
| Genuine key disagreements | **0** (no model majority proposed a different key) |

**Flagged-item breakdown (all 4):**
- **All 4 of 4** are flagged *only* because reviewer C (gpt-5.3-chat) abstained
  (returned an empty/`None` vote, so the run was not unanimous 3/3). In **every**
  one of these 4, the two reviewers that did answer **agreed with the scraped
  key** (`matches_scraped_key = true`) and the critic **passed** — i.e. no
  evidence the key is wrong, just an incomplete vote.
  - `data_processing-mcq-ss3-091` (Computer software, key `c`)
  - `data_processing-mcq-ss3-104` (Information processing cycle, key `d`)
  - `data_processing-mcq-ss3-105` (Information processing cycle, key `a`)
  - `data_processing-mcq-ss3-125` (File concepts, key `a`)
- **No item** had a model majority pointing at a *different* option, so **no
  `proposed_correct_option_id` was set** and **no key was auto-flipped**.

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
- Machine-readable report: `data_processing_ensemble_verify_report.json`.

---

## 4. Served bank + integration (Phase 3)

- `data/learning/diagnostics/data_processing_ss_v1.json`: **331 active
  (`machine_verified`) items**, **212 skills**, `subject: "data_processing"`,
  `diagnostic_id: ss3-data_processing-v1`. The 4 `flagged_for_human` items are
  routed to the `data_processing_ss_v1_flagged.json` sibling and are **not**
  learner-served.
- **Option-A encoding:** `subject`, `year_group`, `topic`, `subtopic`,
  `misconception_codes`, `taxonomy_version` are **omitted** from served items.
  MCQ options are rendered into `prompt` and preserved in
  `provenance[0].metadata` (`mcq_options` / `mcq_correct_letter`). Served item
  keys: `correct_answer, difficulty, item_id, item_type, lang, prompt,
  provenance, skill_id`.
- **Routing verified:** both Data Processing chip skill_ids
  (`ss3.data_processing.data_information.qualities` → 4 active items,
  `ss3.data_processing.number_systems.bin_to_dec` → 4 active items) resolve into
  `ss3-data_processing-v1`; the default maths bank and existing
  maths/english/government/history/literature/economics routing are unchanged.
- **Front-end:** two `type: 'practice'` chips added to `examPrep[]` wired to
  `startCheckIn(item.skillId)` with the real skill_ids above
  (`data-processing-ss3-data-quality`, `data-processing-ss3-number-systems`).
- **Tests:** `pytest -k "learning or diagnostic or bank"` → **410 passed**, 3
  failed. The 3 failures are the pre-existing `test_learning_postgres_repository.py`
  `_FakeConnection` (`NoneType.fetchall`) issues (no Data Processing reference)
  and are unrelated to this work.
- `get_errors` on edited files: clean except the one `.tsx` finding, a
  pre-existing `parent-share-preview` a11y lint (now at L2819 after the +16-line
  chip insertion), untouched by this change.

---

## 5. Compliance / honesty caveats (must read before sign-off)

- **Below the human gate.** Every item — source and served — keeps
  `review_state = "pending_two_reviewer_signoff"`, `subject_lead_approved =
  false`, `safeguarding_reviewed = false`. `machine_verified` is an
  answer-confidence signal **below** the human two-reviewer gate; it is **not**
  sign-off.
- **Rights not cleared.** Questions are *derived* SSCE-style content
  (`licence: "derived"`, `origin: "derived"`, provenance source
  `scrape:data_processing-ssce-derived`). Reuse rights for child-facing delivery
  are **not** cleared.
- **No subject-lead / safeguarding review** has occurred.
- **Real verification complete.** The reported `machine_verified` / `flagged`
  counts come from the **real** Azure Foundry 3-model batch. `machine_verified`
  remains an answer-*confidence* signal below the human two-reviewer gate.
- **Key never auto-flipped.** No model majority proposed a different key; the
  pipeline only ever produces a human-adjudication hint, never an automatic key
  change.
- **Model abstention pattern.** Reviewer C returned empty votes on 4 items;
  these are conservatively flagged rather than verified. (Consistent with prior
  subjects; worth a retry-on-empty before flagging in future subjects.)

---

## 6. Decision (resolved)

**Option 2 — GO (run online verification) — was executed.** The real paid Foundry
batch ran over all 335 items; the served bank was rebuilt from real consensus
(331 active, 4 routed to the flagged sibling). Outcome: no genuine key
disagreements, no key auto-flips, all items remain
`pending_two_reviewer_signoff`.

Remaining human gates before any learner exposure:

1. **Subject-lead review** of the 331 `machine_verified` items + adjudication of
   the 4 flagged items (all 4 reviewer abstentions, key-agreeing + critic-pass).
2. **Safeguarding review** and **rights clearance** for derived SSCE content.
3. **Two-reviewer sign-off** flipping `review_state` and the
   `subject_lead_approved` / `safeguarding_reviewed` flags.

**No deployment will occur without an explicit GO at the deploy stage.**
**STOP after Data Processing — no other subject was started.**
