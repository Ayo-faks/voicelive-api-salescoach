# Government SS MCQ Diagnostic Bank — Phase 4 Go/No-Go Report

## Update — Human sign-off complete & go-live (2026-06-01)

**Status superseded:** the original "No deployment / pending_two_reviewer_signoff"
status above reflects the state at Phase 4. As of **2026-06-01** the product owner
confirmed the human **two-reviewer sign-off is complete** (subject-lead review +
safeguarding review) and authorized making the Government bank learner-available.

What changed as a result:

- **Served diagnostic** (428 machine_verified items) is now learner-visible
  via the exam-prep chips in `frontend/src/learning/routes/StudentLearningHome.tsx`.
- Per-item `provenance[0].metadata` on the served + source banks set to
  `subject_lead_approved = true`, `safeguarding_reviewed = true`,
  `review_state = "approved"`.
- Source bank top-level `review_state` synced to `"approved"`.
- **13 flagged_for_human items remain pending** — held out of the served pack,
  left at `review_state = "pending_two_reviewer_signoff"`.
- Rights/derived-content caveats (§5) are unchanged; sign-off asserts the human
  review occurred, not that licensing was re-cleared.

---


**Status:** GO (real online verification complete) — decision recorded 2026-05-30. **No deployment performed.**
**Scope:** Government (SS3) only. Working tree: `voicelive-api-salescoach` (branch `main`).
**Date:** generated at end of Phases 1–3 + Stage 3.5 online execution.

---

## Decision (2026-05-30)

**GO (run online verification)** — option 2 of §6. Owner authorized fully
autonomous execution including paid spend. The real 3-model Azure AI Foundry
ensemble batch (gpt-4o + gpt-5.2-chat + gpt-5.3-chat, managed identity, no API
key) was run over all 441 items and the served bank rebuilt from the real
consensus. This GO unblocks the next stage only. It does **not** deploy and does
**not** override the human gate: every item stays
`review_state = "pending_two_reviewer_signoff"` and is not learner-visible until
two human reviewers sign off. The rights/derived-content caveats in §5 still
stand.

---

## 1. What was built

| Artifact | Path | Purpose |
| --- | --- | --- |
| Source MCQ bank | `backend/data/question_banks/government-ss-mcq-v1.json` | Stage-1 authored bank, 441 items |
| Source data module | `backend/data/question_banks/government_questions.py` | 10 topic pools (`TOPICS`) |
| Bank builder | `backend/data/question_banks/build_government_bank.py` | Stage 1/2 + `_reband_topic` |
| Ensemble verifier | `backend/data/question_banks/ensemble_verify.py` | Stage 3.5 answer-confidence |
| Ensemble report | `backend/data/question_banks/government_ensemble_verify_report.json` | machine-readable verify output |
| Served bank builder | `backend/data/question_banks/build_served_government.py` | Phase 3 promotion (Option A) |
| **Served diagnostic bank** | `data/learning/diagnostics/government_ss_v1.json` | 441 active items, 121 skills |
| Front-end chips | `frontend/src/learning/routes/StudentLearningHome.tsx` | 2 Government exam-prep chips |

---

## 2. Coverage report (source bank — 441 items)

- **Topics:** 10, ~44 items each (43–45).
- **Exams:** every item tagged `WAEC, NECO` (441/441).
- **Difficulty bands** (VE −3.0 / E −1.5 / M 0.0 / H 1.5 / VH 3.0):
  totals VE=30, E=36, M=154, H=191, VH=30.
- **Every topic has ≥3 items in every band** (VE/E/M/H/VH) — requirement met.
- **Correct-option balance:** a=111, b=110, c=110, d=110 (even, no positional bias).

| Topic | VE | E | M | H | VH | Total |
| --- | --- | --- | --- | --- | --- | --- |
| Basic concepts | 3 | 9 | 23 | 7 | 3 | 45 |
| Constitution | 3 | 3 | 19 | 17 | 3 | 45 |
| ECOWAS/AU/UN | 3 | 3 | 16 | 19 | 3 | 44 |
| Electoral process | 3 | 3 | 16 | 19 | 3 | 44 |
| International relations | 3 | 3 | 14 | 21 | 3 | 44 |
| Nigerian government | 3 | 3 | 13 | 22 | 3 | 44 |
| Organs of government | 3 | 3 | 17 | 18 | 3 | 44 |
| Political parties | 3 | 3 | 16 | 19 | 3 | 44 |
| Pre/Post independence | 3 | 3 | 7 | 28 | 3 | 44 |
| Public administration | 3 | 3 | 13 | 21 | 3 | 43 |

Stage-3 deterministic validator (`validate_mcq_bank.py`): **PASS, 0 errors**.

---

## 3. Ensemble verification report (Stage 3.5)

The verifier runs three reviewers (gpt-4o / gpt-5.2-chat / gpt-5.3-chat) **blind
to the key**, plus a gpt-4o critic. Decision rule: unanimous (3/3) + matches key
+ critic-pass → `machine_verified`; otherwise → `flagged_for_human` (with a
`proposed_correct_option_id` only when a majority lands on a *different* option;
the key is **never** auto-flipped).

**This run was the REAL paid Azure AI Foundry online batch** (managed identity,
no API key):

| Metric | Value |
| --- | --- |
| Backend | `azure-foundry` (real 3-model ensemble) |
| Reviewers | gpt-4o, gpt-5.2-chat, gpt-5.3-chat (critic: gpt-4o) |
| Total items | 441 |
| Processed this run | 436 (+5 from earlier smoke = 441 with consensus) |
| `machine_verified` | **428** (97.1%) |
| `flagged_for_human` | **13** (2.9%) |
| Items with errors | 1 |
| Content-filtered | 1 |
| Genuine key disagreements | **0** (no model majority proposed a different key) |

**Flagged-item breakdown (all 13):**
- **12 of 13** are flagged *only* because reviewer_c (gpt-5.3-chat) abstained
  (returned an empty/`None` vote on that item, so the run was not unanimous
  3/3). In **every** one of these 12, the reviewers that did answer **agreed
  with the scraped key** (`matches_scraped_key = true`) and the critic passed —
  i.e. no evidence the key is wrong, just an incomplete vote.
- **1 of 13** (`government-mcq-ss3-215`, electoral-process qualification) was
  **content-filtered by Azure Responsible-AI on all three reviewers** → 0
  agreement → correctly flagged with `proposed_correct_option_id = null`. The
  safety filter was honoured, never bypassed.
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
  entry) and checkpoints every 20 items with atomic writes, so Azure rate-limit
  back-off (gpt-4o cap-10 bottleneck) and content-filter exceptions never lose
  work.
- Machine-readable report: `government_ensemble_verify_report.json`.

---

## 4. Served bank + integration (Phase 3)

- `data/learning/diagnostics/government_ss_v1.json`: **428 active
  (`machine_verified`) items**, `subject: "government"`,
  `diagnostic_id: ss3-government-v1`. The 13 `flagged_for_human` items are routed
  to the `government_ss_v1_flagged.json` sibling and are **not** learner-served.
- **Option-A encoding:** `subject`, `year_group`, `topic`, `subtopic`,
  `misconception_codes`, `taxonomy_version` are **omitted** from served items
  (the served `DiagnosticItem` model constrains those to maths/english). MCQ
  options are rendered into `prompt` and preserved in
  `provenance[0].metadata.mcq_options` / `mcq_correct_letter`.
- `government_ss_v1_flagged.json` sibling written with the 13 flagged items for
  human adjudication.
- **Routing verified:** both Government chip skill_ids
  (`ss3.government.basic_concepts.power_authority`,
  `ss3.government.constitution.nigerian_constitutions`) resolve to
  `ss3-government-v1`; the default maths bank and existing maths/english routing
  are unchanged.
- **Front-end:** two `type: 'practice'` chips added to `examPrep[]` wired to
  `startCheckIn(item.skillId)` with the real skill_ids above.
- **Tests:** `pytest -k "learning or diagnostic or bank"` → **410 passed**, 3
  failed. The 3 failures are the pre-existing `test_learning_postgres_repository.py`
  `_FakeConnection` issues (no Government reference) and are unrelated to this
  work.
- `get_errors` on edited files: **clean** (the one `.tsx` a11y warning is a
  pre-existing `parent-share-preview` lint at L2771, untouched by this change).

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
  remains an answer-*confidence* signal below the human two-reviewer gate — it is
  **not** sign-off and items are not learner-visible.
- **Key never auto-flipped.** No model majority proposed a different key; the
  pipeline only ever produces a human-adjudication hint, never an automatic key
  change.
- **One model abstention pattern.** gpt-5.3-chat returned empty votes on 12
  items; these are conservatively flagged rather than verified. Worth noting for
  the remaining 9 subjects (consider a retry-on-empty before flagging).

---

## 6. Decision (resolved)

**Option 2 — GO (run online verification) — was executed.** The real paid Foundry
batch ran over all 441 items; the served bank was rebuilt from real consensus
(428 active, 13 routed to the flagged sibling). Outcome: no genuine key
disagreements, no key auto-flips, all items remain
`pending_two_reviewer_signoff`.

Remaining human gates before any learner exposure:

1. **Subject-lead review** of the 428 `machine_verified` items + adjudication of
   the 13 flagged items (12 reviewer_c abstentions + 1 content-filtered).
2. **Safeguarding review** and **rights clearance** for derived SSCE content.
3. **Two-reviewer sign-off** flipping `review_state` and the
   `subject_lead_approved` / `safeguarding_reviewed` flags.

**No deployment will occur without an explicit GO at the deploy stage.**
