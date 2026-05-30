# History SS MCQ Diagnostic Bank — Phase 4 Go/No-Go Report

**Status:** GO (real online verification complete) — decision recorded 2026-05-30. **No deployment performed.**
**Scope:** History (SS3) only — subject 2 of 10 in the Pathfinder rollout. Working tree: `voicelive-api-salescoach` (branch `main`).
**Date:** generated at end of Phases 1–3 + Stage 3.5 online execution.

---

## Decision (2026-05-30)

**GO (run online verification)** — executed under the same contract as
Government (subject 1). Owner authorized fully autonomous execution including
paid spend. The real 3-model Azure AI Foundry ensemble batch (gpt-4o +
gpt-5.2-chat + gpt-5.3-chat, managed identity, no API key) was run over all 325
items and the served bank rebuilt from the real consensus. This GO unblocks the
next stage only. It does **not** deploy and does **not** override the human gate:
every item stays `review_state = "pending_two_reviewer_signoff"` and is not
learner-visible until two human reviewers sign off. The rights/derived-content
caveats in §5 still stand.

---

## 1. What was built

| Artifact | Path | Purpose |
| --- | --- | --- |
| Source MCQ bank | `backend/data/question_banks/history-ss-mcq-v1.json` | Stage-1 authored bank, 325 items |
| Source data module | `backend/data/question_banks/history_questions.py` | 9 topic pools (`TOPICS`) |
| Bank builder | `backend/data/question_banks/build_history_bank.py` | Stage 1/2 + `_reband_topic` |
| Ensemble verifier | `backend/data/question_banks/ensemble_verify.py` | Stage 3.5 answer-confidence (now subject-aware) |
| Ensemble report | `backend/data/question_banks/history_ensemble_verify_report.json` | machine-readable verify output |
| Served bank builder | `backend/data/question_banks/build_served_subject.py` | Phase 3 promotion (Option A) |
| **Served diagnostic bank** | `data/learning/diagnostics/history_ss_v1.json` | 291 active items, 151 skills |
| Flagged sibling | `data/learning/diagnostics/history_ss_v1_flagged.json` | 34 flagged-for-human items |
| Front-end chips | `frontend/src/learning/routes/StudentLearningHome.tsx` | 2 History exam-prep chips |

---

## 2. Coverage report (source bank — 325 items)

- **Topics:** 9, ~36 items each (35–39).
- **Exams:** every item tagged `WAEC, NECO` (325/325).
- **Difficulty bands** (VE −3.0 / E −1.5 / M 0.0 / H 1.5 / VH 3.0):
  totals VE=27, E=31, M=136, H=104, VH=27.
- **Every topic has ≥3 items in every band** (VE/E/M/H/VH) — requirement met.
- **Correct-option balance:** a=82, b=81, c=81, d=81 (even, no positional bias).
- **Duplicate stems:** 0.

| Topic | VE | E | M | H | VH | Total |
| --- | --- | --- | --- | --- | --- | --- |
| Civil war | 3 | 3 | 14 | 12 | 3 | 35 |
| Colonial rule | 3 | 3 | 17 | 10 | 3 | 36 |
| Early Nigerian states | 3 | 7 | 16 | 10 | 3 | 39 |
| Independence | 3 | 3 | 16 | 10 | 3 | 35 |
| Nationalism | 3 | 3 | 14 | 13 | 3 | 36 |
| Post-independence | 3 | 3 | 13 | 13 | 3 | 35 |
| Trans-Saharan/trans-Atlantic trade | 3 | 3 | 18 | 10 | 3 | 37 |
| West Africa | 3 | 3 | 14 | 14 | 3 | 37 |
| World history | 3 | 3 | 14 | 12 | 3 | 35 |

Stage-3 deterministic validator (`validate_mcq_bank.py`): **PASS, 0 errors**.

---

## 3. Ensemble verification report (Stage 3.5)

The verifier runs three reviewers (gpt-4o / gpt-5.2-chat / gpt-5.3-chat) **blind
to the key**, plus a gpt-4o critic. Decision rule: unanimous (3/3) + matches key
+ critic-pass → `machine_verified`; otherwise → `flagged_for_human` (with a
`proposed_correct_option_id` only when a majority lands on a *different* option;
the key is **never** auto-flipped).

For this subject the reviewer/critic system prompts were made **subject-aware**
(`_set_subject()` reads `bank.subject` → `subjects_config.title`), so the models
were instructed as Nigerian SSCE (WAEC/NECO) **History** examiners rather than
the hard-coded "Government" of subject 1.

**This run was the REAL paid Azure AI Foundry online batch** (managed identity,
no API key):

| Metric | Value |
| --- | --- |
| Backend | `azure-foundry` (real 3-model ensemble) |
| Reviewers | gpt-4o, gpt-5.2-chat, gpt-5.3-chat (critic: gpt-4o) |
| Total items | 325 |
| Processed this run | 325 |
| `machine_verified` | **291** (89.5%) |
| `flagged_for_human` | **34** (10.5%) |
| Items with errors | 0 |
| Content-filtered | 0 |
| Genuine key disagreements | **0** (no model majority proposed a different key) |

**Flagged-item breakdown (all 34):**
- **33 of 34** are flagged *only* because a reviewer abstained (returned an
  empty/`None` vote, so the run was not unanimous 3/3). In **every** one of these
  33, the reviewers that did answer **agreed with the scraped key**
  (`matches_scraped_key = true`) — i.e. no evidence the key is wrong, just an
  incomplete vote.
- **1 of 34** was flagged on a **critic FAIL** (reviewers unanimous on the key
  but the gpt-4o critic did not return PASS) — conservatively routed to a human
  rather than verified.
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
- Machine-readable report: `history_ensemble_verify_report.json`.

---

## 4. Served bank + integration (Phase 3)

- `data/learning/diagnostics/history_ss_v1.json`: **291 active
  (`machine_verified`) items**, **151 skills**, `subject: "history"`,
  `diagnostic_id: ss3-history-v1`. The 34 `flagged_for_human` items are routed
  to the `history_ss_v1_flagged.json` sibling and are **not** learner-served.
- **Option-A encoding:** `subject`, `year_group`, `topic`, `subtopic`,
  `misconception_codes`, `taxonomy_version` are **omitted** from served items.
  MCQ options are rendered into `prompt` and preserved in
  `provenance[0].metadata` (`mcq_options` / `mcq_correct_letter`). Served item
  keys: `correct_answer, difficulty, item_id, item_type, lang, prompt,
  provenance, skill_id`.
- **Routing verified:** both History chip skill_ids
  (`ss3.history.early_nigerian_states.kanem_bornu`,
  `ss3.history.independence.challenges`) resolve into `ss3-history-v1`; the
  default maths bank and existing maths/english/government routing are unchanged.
- **Front-end:** two `type: 'practice'` chips added to `examPrep[]` wired to
  `startCheckIn(item.skillId)` with the real skill_ids above
  (`history-ss3-early-states`, `history-ss3-independence`).
- **Tests:** `pytest -k "learning or diagnostic or bank"` → **410 passed**, 3
  failed. The 3 failures are the pre-existing `test_learning_postgres_repository.py`
  `_FakeConnection` (`NoneType.fetchall`) issues (no History reference) and are
  unrelated to this work.
- `get_errors` on edited files: `ensemble_verify.py` **clean**; the one `.tsx`
  finding is a pre-existing `parent-share-preview` a11y lint at L2787, untouched
  by this change.

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
- **Model abstention pattern.** A reviewer returned empty votes on 33 items;
  these are conservatively flagged rather than verified. (Consistent with the
  Government run; worth a retry-on-empty before flagging in future subjects.)

---

## 6. Decision (resolved)

**Option 2 — GO (run online verification) — was executed.** The real paid Foundry
batch ran over all 325 items; the served bank was rebuilt from real consensus
(291 active, 34 routed to the flagged sibling). Outcome: no genuine key
disagreements, no key auto-flips, all items remain
`pending_two_reviewer_signoff`.

Remaining human gates before any learner exposure:

1. **Subject-lead review** of the 291 `machine_verified` items + adjudication of
   the 34 flagged items (33 reviewer abstentions + 1 critic-fail).
2. **Safeguarding review** and **rights clearance** for derived SSCE content.
3. **Two-reviewer sign-off** flipping `review_state` and the
   `subject_lead_approved` / `safeguarding_reviewed` flags.

**No deployment will occur without an explicit GO at the deploy stage.**
**STOP after History — no other subject was started.**
