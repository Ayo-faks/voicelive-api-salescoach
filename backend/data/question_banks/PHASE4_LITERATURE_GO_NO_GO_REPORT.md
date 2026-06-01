# Literature-in-English SS MCQ Diagnostic Bank — Phase 4 Go/No-Go Report

## Update — Human sign-off complete & go-live (2026-06-01)

**Status superseded:** the original "No deployment / pending_two_reviewer_signoff"
status above reflects the state at Phase 4. As of **2026-06-01** the product owner
confirmed the human **two-reviewer sign-off is complete** (subject-lead review +
safeguarding review) and authorized making the Literature bank learner-available.

What changed as a result:

- **Served diagnostic** (313 machine_verified items) is now learner-visible
  via the exam-prep chips in `frontend/src/learning/routes/StudentLearningHome.tsx`.
- Per-item `provenance[0].metadata` on the served + source banks set to
  `subject_lead_approved = true`, `safeguarding_reviewed = true`,
  `review_state = "approved"`.
- Source bank top-level `review_state` synced to `"approved"`.
- **16 flagged_for_human items remain pending** — held out of the served pack,
  left at `review_state = "pending_two_reviewer_signoff"`.
- Rights/derived-content caveats (§5) are unchanged; sign-off asserts the human
  review occurred, not that licensing was re-cleared.

---


**Status:** GO (real online verification complete) — decision recorded 2026-05-30. **No deployment performed.**
**Scope:** Literature-in-English (SS3) only — subject 3 of 10 in the Pathfinder rollout. Working tree: `voicelive-api-salescoach` (branch `main`).
**Date:** generated at end of Phases 1–3 + Stage 3.5 online execution.

---

## Decision (2026-05-30)

**GO (run online verification)** — executed under the same contract as
Government (subject 1) and History (subject 2). Owner authorized fully autonomous
execution including paid spend. The real 3-model Azure AI Foundry ensemble batch
(gpt-4o + gpt-5.2-chat + gpt-5.3-chat, managed identity, no API key) was run over
all 329 items and the served bank rebuilt from the real consensus. This GO
unblocks the next stage only. It does **not** deploy and does **not** override the
human gate: every item stays `review_state = "pending_two_reviewer_signoff"` and
is not learner-visible until two human reviewers sign off. The rights/derived-content
caveats in §5 still stand.

---

## 1. What was built

| Artifact | Path | Purpose |
| --- | --- | --- |
| Source MCQ bank | `backend/data/question_banks/literature-ss-mcq-v1.json` | Stage-1 authored bank, 329 items |
| Source data module | `backend/data/question_banks/literature_questions.py` | 10 topic pools (`TOPICS`) |
| Bank builder | `backend/data/question_banks/build_literature_bank.py` | Stage 1/2 + `_reband_topic` |
| Ensemble verifier | `backend/data/question_banks/ensemble_verify.py` | Stage 3.5 answer-confidence (subject-aware) |
| Ensemble report | `backend/data/question_banks/literature_ensemble_verify_report.json` | machine-readable verify output |
| Served bank builder | `backend/data/question_banks/build_served_subject.py` | Phase 3 promotion (Option A) |
| **Served diagnostic bank** | `data/learning/diagnostics/literature_ss_v1.json` | 313 active items, 140 skills |
| Flagged sibling | `data/learning/diagnostics/literature_ss_v1_flagged.json` | 16 flagged-for-human items |
| Front-end chips | `frontend/src/learning/routes/StudentLearningHome.tsx` | 2 Literature exam-prep chips |

---

## 2. Coverage report (source bank — 329 items)

- **Topics:** 10, ~33 items each (32–34).
- **Exams:** every item tagged `WAEC, NECO` (329/329).
- **Difficulty bands** (VE −3.0 / E −1.5 / M 0.0 / H 1.5 / VH 3.0):
  totals VE=30, E=30, M=166, H=73, VH=30.
- **Every topic has ≥3 items in every band** (VE/E/M/H/VH) — requirement met.
- **Correct-option balance:** a=83, b=82, c=82, d=82 (even, no positional bias).
- **Duplicate stems:** 0.

| Topic | VE | E | M | H | VH | Total |
| --- | --- | --- | --- | --- | --- | --- |
| African literature | 3 | 3 | 16 | 7 | 3 | 32 |
| Characterisation | 3 | 3 | 17 | 7 | 3 | 33 |
| Drama | 3 | 3 | 17 | 7 | 3 | 33 |
| Elements of literature | 3 | 3 | 17 | 8 | 3 | 34 |
| Figures of speech | 3 | 3 | 16 | 7 | 3 | 32 |
| Non-African literature | 3 | 3 | 16 | 7 | 3 | 32 |
| Poetry | 3 | 3 | 17 | 8 | 3 | 34 |
| Prose | 3 | 3 | 18 | 7 | 3 | 34 |
| Sound devices | 3 | 3 | 18 | 6 | 3 | 33 |
| Themes & literary appreciation | 3 | 3 | 14 | 9 | 3 | 32 |

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
Nigerian SSCE (WAEC/NECO) **Literature-in-English** examiners.

**This run was the REAL paid Azure AI Foundry online batch** (managed identity,
no API key):

| Metric | Value |
| --- | --- |
| Backend | `azure-foundry` (real 3-model ensemble) |
| Reviewers | gpt-4o, gpt-5.2-chat, gpt-5.3-chat (critic: gpt-4o) |
| Total items | 329 |
| Processed this run | 329 |
| `machine_verified` | **313** (95.1%) |
| `flagged_for_human` | **16** (4.9%) |
| Items with errors | 0 |
| Content-filtered | 0 |
| Genuine key disagreements | **0** (no model majority proposed a different key) |

**Flagged-item breakdown (all 16):**
- **16 of 16** are flagged *only* because a reviewer abstained (returned an
  empty/`None` vote, so the run was not unanimous 3/3). In **every** one of these
  16, the reviewers that did answer **agreed with the scraped key**
  (`matches_scraped_key = true`) — i.e. no evidence the key is wrong, just an
  incomplete vote.
- **0** critic-fail flags and **0** items with a model majority pointing at a
  *different* option, so **no `proposed_correct_option_id` was set** and **no key
  was auto-flipped**.

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
- Machine-readable report: `literature_ensemble_verify_report.json`.

---

## 4. Served bank + integration (Phase 3)

- `data/learning/diagnostics/literature_ss_v1.json`: **313 active
  (`machine_verified`) items**, **140 skills**, `subject: "literature"`,
  `diagnostic_id: ss3-literature-v1`. The 16 `flagged_for_human` items are routed
  to the `literature_ss_v1_flagged.json` sibling and are **not** learner-served.
- **Option-A encoding:** `subject`, `year_group`, `topic`, `subtopic`,
  `misconception_codes`, `taxonomy_version` are **omitted** from served items.
  MCQ options are rendered into `prompt` and preserved in
  `provenance[0].metadata` (`mcq_options` / `mcq_correct_letter`). Served item
  keys: `correct_answer, difficulty, item_id, item_type, lang, prompt,
  provenance, skill_id`.
- **Routing verified:** both Literature chip skill_ids
  (`ss3.literature.figures_of_speech.comparison`,
  `ss3.literature.african_literature.prose_fiction`) are present in the active
  served bank (`ss3-literature-v1`); the default maths bank and existing
  maths/english/government/history routing are unchanged.
- **Front-end:** two `type: 'practice'` chips added to `examPrep[]` wired to
  `startCheckIn(item.skillId)` with the real skill_ids above
  (`literature-ss3-figures-of-speech`, `literature-ss3-african-prose`).
- **Tests:** backend `pytest -k "learning or diagnostic or bank"` → **410 passed**,
  3 failed. The 3 failures are the pre-existing `test_learning_postgres_repository.py`
  `_FakeConnection` (`NoneType.fetchall`) issues (no Literature reference) and are
  unrelated to this work. Front-end `vitest run src/learning` → **145 passed**.
- `get_errors` on edited files: the only `.tsx` finding is a pre-existing
  `parent-share-preview` a11y lint at L2803, untouched by this change.

---

## 5. Compliance / honesty caveats (must read before sign-off)

- **Below the human gate.** Every item — source and served — keeps
  `review_state = "pending_two_reviewer_signoff"`, `subject_lead_approved =
  false`, `safeguarding_reviewed = false`. `machine_verified` is an
  answer-confidence signal **below** the human two-reviewer gate; it is **not**
  sign-off.
- **Rights not cleared.** Questions are *derived* SSCE-style content
  (`licence: "derived"`, `origin: "derived"`). Reuse rights for child-facing
  delivery are **not** cleared. Content uses durable/verifiable literary facts
  (genre & device definitions; uncontroversial authorship) — no set-text plot
  trivia, no past-paper verbatim, no PII.
- **No subject-lead / safeguarding review** has occurred.
- **Real verification complete.** The reported `machine_verified` / `flagged`
  counts come from the **real** Azure Foundry 3-model batch. `machine_verified`
  remains an answer-*confidence* signal below the human two-reviewer gate.
- **Key never auto-flipped.** No model majority proposed a different key; the
  pipeline only ever produces a human-adjudication hint, never an automatic key
  change.
- **Model abstention pattern.** A reviewer returned empty votes on the 16 flagged
  items; these are conservatively flagged rather than verified. (Consistent with
  the Government/History runs; worth a retry-on-empty before flagging in future
  subjects.)

---

## 6. Decision (resolved)

**Option 2 — GO (run online verification) — was executed.** The real paid Foundry
batch ran over all 329 items; the served bank was rebuilt from real consensus
(313 active, 16 routed to the flagged sibling). Outcome: no genuine key
disagreements, no key auto-flips, all items remain
`pending_two_reviewer_signoff`.

Remaining human gates before any learner exposure:

1. **Subject-lead review** of the 313 `machine_verified` items + adjudication of
   the 16 flagged items (all reviewer abstentions that matched the key).
2. **Safeguarding review** and **rights clearance** for derived SSCE content.
3. **Two-reviewer sign-off** flipping `review_state` and the
   `subject_lead_approved` / `safeguarding_reviewed` flags.

**No deployment will occur without an explicit GO at the deploy stage.**
**STOP after Literature-in-English — no other subject was started.**
