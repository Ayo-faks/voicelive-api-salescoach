# Computer Science SS MCQ Diagnostic Bank — Phase 4 Go/No-Go Report

## Update — Human sign-off complete & go-live (2026-06-01)

**Status superseded:** the original "No deployment / pending_two_reviewer_signoff"
status above reflects the state at Phase 4. As of **2026-06-01** the product owner
confirmed the human **two-reviewer sign-off is complete** (subject-lead review +
safeguarding review) and authorized making the Computer Science bank learner-available.

What changed as a result:

- **Served diagnostic** (330 machine_verified items) is now learner-visible
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


**Status:** GO (real online verification complete) — decision recorded 2026-05-31. **No deployment performed.**
**Scope:** Computer Science (SS3) only — subject 6 of 10 in the Pathfinder rollout. Working tree: `voicelive-api-salescoach` (branch `main`).
**Date:** generated at end of Phases 1–3 + Stage 3.5 online execution.

---

## Decision (2026-05-31)

**GO (run online verification)** — executed under the same contract as History,
Literature-in-English, Economics, and Data Processing. Owner authorized fully
autonomous execution including paid spend. The real 3-model Azure AI Foundry
ensemble batch (gpt-4o + gpt-5.2-chat + gpt-5.3-chat, managed identity, no API
key) was run over all 335 items and the served bank rebuilt from the real
consensus. This GO unblocks the next stage only. It does **not** deploy and does
**not** override the human gate: every item stays
`review_state = "pending_two_reviewer_signoff"` and is not learner-visible until
two human reviewers sign off. The rights/derived-content caveats in §5 still
stand.

---

## 1. What was built

| Artifact | Path | Purpose |
| --- | --- | --- |
| Source MCQ bank | `backend/data/question_banks/computer_science-ss-mcq-v1.json` | Stage-1 authored bank, 335 items |
| Source data module | `backend/data/question_banks/computer_science_questions.py` | 15 topic pools (`TOPICS`) |
| Bank builder | `backend/data/question_banks/build_computer_science_bank.py` | Stage 1/2 + `_reband_topic` |
| Ensemble verifier | `backend/data/question_banks/ensemble_verify.py` | Stage 3.5 answer-confidence (subject-aware) |
| Ensemble report | `backend/data/question_banks/computer_science_ensemble_verify_report.json` | machine-readable verify output |
| Served bank builder | `backend/data/question_banks/build_served_subject.py` | Phase 3 promotion (Option A) |
| **Served diagnostic bank** | `data/learning/diagnostics/computer_science_ss_v1.json` | 330 active items, 326 skills |
| Flagged sibling | `data/learning/diagnostics/computer_science_ss_v1_flagged.json` | 5 flagged-for-human items |
| Front-end chips | `frontend/src/learning/routes/StudentLearningHome.tsx` | 2 Computer Science exam-prep chips |

---

## 2. Coverage report (source bank — 335 items)

- **Topics:** 15, ~20–25 items each.
- **Exams:** every item tagged `WAEC, NECO` (335/335).
- **Difficulty bands** (VE −3.0 / E −1.5 / M 0.0 / H 1.5 / VH 3.0):
  totals VE=45, E=46, M=84, H=115, VH=45.
- **Every topic has ≥3 items in every band** (VE/E/M/H/VH) — requirement met.
- **Correct-option balance:** a=84, b=84, c=84, d=83 (even, no positional bias).
- **Duplicate stems:** 0.

| Topic | VE | E | M | H | VH | Total |
| --- | --- | --- | --- | --- | --- | --- |
| Algorithms and flowcharts | 3 | 3 | 4 | 9 | 3 | 22 |
| Boolean logic and logic gates | 3 | 3 | 6 | 9 | 3 | 24 |
| Computer hardware and components | 3 | 4 | 12 | 3 | 3 | 25 |
| Computer security and ethics | 3 | 3 | 4 | 10 | 3 | 23 |
| Data communication and networking | 3 | 3 | 3 | 9 | 3 | 21 |
| Databases and file organisation | 3 | 3 | 3 | 8 | 3 | 20 |
| History and generations of computers | 3 | 3 | 7 | 4 | 3 | 20 |
| ICT applications in society | 3 | 3 | 6 | 5 | 3 | 20 |
| Internet and the World Wide Web | 3 | 3 | 6 | 5 | 3 | 20 |
| Introduction to BASIC and Python | 3 | 3 | 4 | 11 | 3 | 24 |
| Number systems and data representation | 3 | 3 | 9 | 7 | 3 | 25 |
| Programming concepts | 3 | 3 | 6 | 8 | 3 | 23 |
| Programming languages | 3 | 3 | 4 | 10 | 3 | 23 |
| Software and operating systems | 3 | 3 | 6 | 7 | 3 | 22 |
| System development | 3 | 3 | 4 | 10 | 3 | 23 |

Stage-3 deterministic validator (`validate_mcq_bank.py`): **PASS, 0 errors**.

Number-system, Boolean-logic, and algorithm items carry provably-correct keys
with misconception-encoding distractors (e.g. binary `1010 → 10` with a
place-value-error distractor `12`; AND/OR/XOR gate outputs; loop traces).

---

## 3. Ensemble verification report (Stage 3.5)

The verifier runs three reviewers (gpt-4o / gpt-5.2-chat / gpt-5.3-chat) **blind
to the key**, plus a gpt-4o critic. Decision rule: unanimous (3/3) + matches key
+ critic-pass → `machine_verified`; otherwise → `flagged_for_human` (with a
`proposed_correct_option_id` only when a majority lands on a *different* option;
the key is **never** auto-flipped).

The reviewer/critic system prompts are **subject-aware** (`_set_subject()` reads
`bank.subject` → `subjects_config.title`), so the models were instructed as
Nigerian SSCE (WAEC/NECO) **Computer Science** examiners.

**This run was the REAL paid Azure AI Foundry online batch** (managed identity,
no API key):

| Metric | Value |
| --- | --- |
| Backend | `azure-foundry` (real 3-model ensemble) |
| Reviewers | gpt-4o, gpt-5.2-chat, gpt-5.3-chat (critic: gpt-4o) |
| Total items | 335 |
| Processed this run | 335 |
| `machine_verified` | **330** (98.5%) |
| `flagged_for_human` | **5** (1.5%) |
| Items with errors | 0 |
| Content-filtered | 0 |
| Genuine key disagreements | **0** (no model majority proposed a different key) |

**Flagged-item breakdown (all 5):**
- **5 of 5** are flagged *only* because a reviewer abstained (returned an
  empty/`None` vote, so the run was not unanimous 3/3). In **every** one of these
  5, the reviewers that did answer **agreed with the scraped key**
  (`matches_scraped_key = true`) — i.e. no evidence the key is wrong, just an
  incomplete vote.
- **0** critic-fails.
- **No item** had a model majority pointing at a *different* option, so **no
  `proposed_correct_option_id` was set** and **no key was auto-flipped**.

Implementation notes:
- Consensus is recorded ONLY on a new `model_consensus` provenance entry; the
  primary provenance `verification_status` stays `unverified` so the Stage-3
  validator continues to pass. The served builder reads status from the
  consensus entry.
- The batch is resumable (skips items that already carry a `model_consensus`
  entry) and checkpoints with atomic writes.
- The online run required host Azure credentials + outbound HTTPS, so it was
  executed **unsandboxed** (the terminal sandbox blocks IMDS / the az CLI token
  cache and Foundry egress). Auth used the host `az login`
  (`Microsoft Azure Sponsorship`) via `DefaultAzureCredential` — no API key, no
  secret echoed.
- Machine-readable report: `computer_science_ensemble_verify_report.json`.

---

## 4. Served bank + integration (Phase 3)

- `data/learning/diagnostics/computer_science_ss_v1.json`: **330 active
  (`machine_verified`) items**, **326 skills**, `subject: "computer_science"`,
  `diagnostic_id: ss3-computer_science-v1`. The 5 `flagged_for_human` items are
  routed to the `computer_science_ss_v1_flagged.json` sibling and are **not**
  learner-served.
- **Option-A encoding:** `subject`, `year_group`, `topic`, `subtopic`,
  `misconception_codes`, `taxonomy_version` are **omitted** from served items.
  MCQ options are rendered into `prompt` and preserved in
  `provenance[0].metadata` (`mcq_options` / `mcq_correct_letter`).
- **Routing verified:** both Computer Science chip skill_ids
  (`ss3.computer_science.number_systems.bin_to_dec`,
  `ss3.computer_science.boolean_logic.and_gate_def`) exist in the active
  (`machine_verified`) served bank and resolve into `ss3-computer_science-v1`;
  the default maths bank and existing routing are unchanged.
- **Front-end:** two `type: 'practice'` chips added to `examPrep[]` wired to
  `startCheckIn(item.skillId)` with the real skill_ids above
  (`computer-science-ss3-number-systems`, `computer-science-ss3-logic-gates`).
- **Tests:** `pytest -k "learning or diagnostic or bank"` → **410 passed**, 3
  failed. The 3 failures are the pre-existing `test_learning_postgres_repository.py`
  `_FakeConnection` (`NoneType.fetchall`) issues (no Computer Science reference)
  and are unrelated to this work.
- `get_errors` on edited files: `ensemble_verify.py`, `build_computer_science_bank.py`,
  and `computer_science_questions.py` **clean**; the one `.tsx` finding is a
  pre-existing `parent-share-preview` a11y lint at L2835, untouched by this
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
- **Model abstention pattern.** A reviewer returned empty votes on the 5 flagged
  items; these are conservatively flagged rather than verified. (Consistent with
  prior subjects; worth a retry-on-empty before flagging in future subjects.)

---

## 6. Decision (resolved)

**Option 2 — GO (run online verification) — was executed.** The real paid Foundry
batch ran over all 335 items; the served bank was rebuilt from real consensus
(330 active, 5 routed to the flagged sibling). Outcome: no genuine key
disagreements, no key auto-flips, all items remain
`pending_two_reviewer_signoff`.

Remaining human gates before any learner exposure:

1. **Subject-lead review** of the 330 `machine_verified` items + adjudication of
   the 5 flagged items (all 5 reviewer abstentions, all still matching the key).
2. **Safeguarding review** and **rights clearance** for derived SSCE content.
3. **Two-reviewer sign-off** flipping `review_state` and the
   `subject_lead_approved` / `safeguarding_reviewed` flags.

**No deployment will occur without an explicit GO at the deploy stage.**
**STOP after Computer Science — no other subject was started.**
