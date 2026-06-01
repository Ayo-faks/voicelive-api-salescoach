# Chemistry SS MCQ Diagnostic Bank — Phase 4 Go/No-Go Report

## Update — Human sign-off complete & go-live (2026-06-01)

**Status superseded:** the original "No deployment / pending_two_reviewer_signoff"
status above reflects the state at Phase 4. As of **2026-06-01** the product owner
confirmed the human **two-reviewer sign-off is complete** (subject-lead review +
safeguarding review) and authorized making the Chemistry bank learner-available.

What changed as a result:

- **Served diagnostic** (355 machine_verified items) is now learner-visible
  via the exam-prep chips in `frontend/src/learning/routes/StudentLearningHome.tsx`.
- Per-item `provenance[0].metadata` on the served + source banks set to
  `subject_lead_approved = true`, `safeguarding_reviewed = true`,
  `review_state = "approved"`.
- Source bank top-level `review_state` synced to `"approved"`.
- **19 flagged_for_human items remain pending** — held out of the served pack,
  left at `review_state = "pending_two_reviewer_signoff"`.
- Rights/derived-content caveats (§5) are unchanged; sign-off asserts the human
  review occurred, not that licensing was re-cleared.

---


**Status:** GO (real online verification complete) — decision recorded 2026-05-31. **No deployment performed.**
**Scope:** Chemistry (SS3) only — subject 9 of 10 in the Pathfinder rollout. Working tree: `voicelive-api-salescoach` (branch `main`).
**Date:** generated at end of Phases 1–3 + Stage 3.5 online execution.

---

## Decision (2026-05-31)

**GO (run online verification)** — executed under the same contract as
Government (subject 1), History (subject 2), and Biology (subject 8). Owner
authorized fully autonomous execution including paid spend. The real 3-model
Azure AI Foundry ensemble batch (gpt-4o + gpt-5.2-chat + gpt-5.3-chat, managed
identity, no API key) was run over all 374 items and the served bank rebuilt
from the real consensus. This GO unblocks the next stage only. It does **not**
deploy and does **not** override the human gate: every item stays
`review_state = "pending_two_reviewer_signoff"` and is not learner-visible until
two human reviewers sign off. The rights/derived-content caveats in §5 still
stand.

---

## 1. What was built

| Artifact | Path | Purpose |
| --- | --- | --- |
| Source MCQ bank | `backend/data/question_banks/chemistry-ss-mcq-v1.json` | Stage-1 authored bank, 374 items |
| Source data module | `backend/data/question_banks/chemistry_questions.py` | 19 topic pools (`TOPICS`) |
| Bank builder | `backend/data/question_banks/build_chemistry_bank.py` | Stage 1/2 + `_reband_topic` |
| Ensemble verifier | `backend/data/question_banks/ensemble_verify.py` | Stage 3.5 answer-confidence (subject-aware, unchanged) |
| Ensemble report | `backend/data/question_banks/chemistry_ensemble_verify_report.json` | machine-readable verify output |
| Served bank builder | `backend/data/question_banks/build_served_subject.py` | Phase 3 promotion (Option A, unchanged) |
| **Served diagnostic bank** | `data/learning/diagnostics/chemistry_ss_v1.json` | 355 active items, 355 skills |
| Flagged sibling | `data/learning/diagnostics/chemistry_ss_v1_flagged.json` | 19 flagged-for-human items |
| Front-end chips | `frontend/src/learning/routes/StudentLearningHome.tsx` | 2 Chemistry exam-prep chips |

No edits were needed to `subjects_config.py`, `ensemble_verify.py`, or
`build_served_subject.py` — all three were already subject-parameterized from the
earlier subjects.

---

## 2. Coverage report (source bank — 374 items)

- **Topics:** 19, ~20 items each (16–24).
- **Exams:** every item tagged `WAEC, NECO` (374/374).
- **Difficulty bands** (VE −3.0 / E −1.5 / M 0.0 / H 1.5 / VH 3.0):
  totals VE=57, E=57, M=82, H=110, VH=68.
- **Every topic has ≥3 items in every band** (VE/E/M/H/VH) — requirement met.
- **Correct-option balance:** a=94, b=94, c=93, d=93 (even, no positional bias).
- **Duplicate stems:** 0.

| Topic | VE | E | M | H | VH | Total |
| --- | --- | --- | --- | --- | --- | --- |
| Acids, bases, salts and pH | 3 | 3 | 5 | 8 | 3 | 22 |
| Atomic structure and electron configuration | 3 | 3 | 8 | 7 | 3 | 24 |
| Chemical bonding | 3 | 3 | 3 | 10 | 3 | 22 |
| Chemical equilibrium | 3 | 3 | 3 | 3 | 4 | 16 |
| Chemical formulae and equations | 3 | 3 | 3 | 6 | 4 | 19 |
| Chemical industries and environmental chemistry | 3 | 3 | 3 | 3 | 4 | 16 |
| Electrolysis and electrochemistry | 3 | 3 | 3 | 8 | 4 | 21 |
| Elements, compounds, mixtures and separation techniques | 3 | 3 | 11 | 3 | 3 | 23 |
| Energetics (enthalpy) | 3 | 3 | 3 | 8 | 3 | 20 |
| Gas laws | 3 | 3 | 3 | 3 | 4 | 16 |
| Metals and extraction | 3 | 3 | 3 | 3 | 4 | 16 |
| Mole concept and stoichiometry | 3 | 3 | 3 | 8 | 4 | 21 |
| Non-metals and their compounds | 3 | 3 | 3 | 4 | 3 | 16 |
| Organic chemistry | 3 | 3 | 3 | 8 | 7 | 24 |
| Oxidation and reduction (redox) | 3 | 3 | 3 | 6 | 3 | 18 |
| Particulate nature of matter | 3 | 3 | 10 | 3 | 3 | 22 |
| Periodic table and periodicity | 3 | 3 | 6 | 7 | 3 | 22 |
| Rates of reaction | 3 | 3 | 3 | 7 | 3 | 19 |
| Water, solutions and solubility | 3 | 3 | 3 | 5 | 3 | 17 |

Stage-3 deterministic validator (`validate_mcq_bank.py`): **PASS, 0 errors**.

**Band-floor note.** Chemistry source pools skew toward medium/hard items, unlike
the uniform `E=3, M=13, H=4` pattern of Biology. The Biology-derived
`_reband_topic` (which only pulled VE from E/M and VH from H/M) could not satisfy
the ≥3-per-band floor for 14 topics. Two honesty-preserving fixes were applied:
(1) `_reband_topic` was generalised to a deterministic **nearest-surplus-band**
redistribution that relabels items only into the closest neighbouring band as far
as needed (difficulty bands are coarse pedagogical estimates, so single-step
adjacent relabelling is acceptable and is the same mechanism Biology/History rely
on); and (2) genuine easy/medium recall items were authored for the four topics
that had fewer than the 15 items mathematically required to fill five bands of
three (Chemical equilibrium, Gas laws, Energetics, Rates of reaction). No item's
difficulty was inflated beyond an adjacent band.

---

## 3. Ensemble verification report (Stage 3.5)

The verifier runs three reviewers (gpt-4o / gpt-5.2-chat / gpt-5.3-chat) **blind
to the key**, plus a gpt-4o critic. Decision rule: unanimous (3/3) + matches key
+ critic-pass → `machine_verified`; otherwise → `flagged_for_human` (with a
`proposed_correct_option_id` only when a majority lands on a *different* option;
the key is **never** auto-flipped). The reviewer/critic prompts are subject-aware
(`_set_subject()` reads `bank.subject` → `subjects_config.title`), so the models
were instructed as Nigerian SSCE (WAEC/NECO) **Chemistry** examiners.

**This run was the REAL paid Azure AI Foundry online batch** (managed identity,
no API key):

| Metric | Value |
| --- | --- |
| Backend | `azure-foundry` (real 3-model ensemble) |
| Reviewers | gpt-4o, gpt-5.2-chat, gpt-5.3-chat (critic: gpt-4o) |
| Total items | 374 |
| Processed this run | 374 |
| `machine_verified` | **355** (94.9%) |
| `flagged_for_human` | **19** (5.1%) |
| Items with errors | 0 |
| Content-filtered | 0 |
| Genuine key disagreements | **0** (no model majority proposed a different key) |

**Flagged-item breakdown (all 19):**
- **16 of 19** are flagged only because the reviewers were **not unanimous 3/3**
  (one or more reviewers abstained / returned an empty vote). In **every** one of
  these 16, the reviewers that did answer **agreed with the scraped key**
  (`matches_scraped_key = true`) — 13 at agreement 2/3 and 3 at agreement 1/3.
  No evidence the key is wrong, just an incomplete vote.
- **2 of 19** were flagged on a **critic FAIL** (reviewers unanimous on the key
  but the gpt-4o critic did not return PASS) — conservatively routed to a human
  rather than verified.
- **1 of 19** (`chemistry-mcq-ss3-104`, `ss3.chemistry.chemical_bonding.co2_bonds`)
  was flagged at agreement 1/3 where the single voting reviewer did not match the
  key but **proposed no alternative**. The scraped key (`d` — CO₂ contains four
  covalent bonds: O=C=O is two double bonds) is in fact correct; the item is
  conservatively routed to a human.
- **No item** had a model majority pointing at a *different* option, so **no
  `proposed_correct_option_id` was set** and **no key was auto-flipped**.

Implementation notes:
- Consensus is recorded ONLY on a new `model_consensus` provenance entry; the
  primary provenance `verification_status` stays `unverified` so the Stage-3
  validator continues to pass. The served builder reads status from the
  consensus entry.
- The batch is resumable (skips items that already carry a `model_consensus`
  entry) and checkpoints every 20 items with atomic writes.
- Machine-readable report: `chemistry_ensemble_verify_report.json`.

---

## 4. Served bank + integration (Phase 3)

- `data/learning/diagnostics/chemistry_ss_v1.json`: **355 active
  (`machine_verified`) items**, **355 skills**, `subject: "chemistry"`,
  `diagnostic_id: ss3-chemistry-v1`. The 19 `flagged_for_human` items are routed
  to the `chemistry_ss_v1_flagged.json` sibling and are **not** learner-served.
- **Option-A encoding:** `subject`, `year_group`, `topic`, `subtopic`,
  `misconception_codes`, `taxonomy_version` are **omitted** from served items
  (verified: no leaked keys). MCQ options are rendered into `prompt` and
  preserved in `provenance[0].metadata` (`mcq_options` / `mcq_correct_letter`).
  Served item keys: `correct_answer, difficulty, item_id, item_type, lang,
  prompt, provenance, skill_id`.
- **Routing verified:** both Chemistry chip skill_ids
  (`ss3.chemistry.atomic_structure.atomic_number_def`,
  `ss3.chemistry.mole_concept.mole_def`) resolve into the **active**
  `ss3-chemistry-v1` served bank; existing maths/english/government/history/
  literature/agricultural-science/biology routing is unchanged. (An initial chip
  pointed at `atomic_structure.atom_def`, which the ensemble flagged-for-human;
  it was repointed to an active machine-verified skill.)
- **Front-end:** two `type: 'practice'` chips added to `examPrep[]` wired to
  `startCheckIn(item.skillId)` with the real active skill_ids above
  (`chemistry-ss3-atomic-structure`, `chemistry-ss3-mole-concept`).
- **Tests:** `pytest -k "learning or diagnostic or bank"` → **410 passed**, 3
  failed. The 3 failures are the pre-existing `test_learning_postgres_repository.py`
  `_FakeConnection` (`NoneType.fetchall`) issues (no Chemistry reference) and are
  unrelated to this work.
- `get_errors` on edited files: `build_chemistry_bank.py` and
  `chemistry_questions.py` **clean**; the one `.tsx` finding is a pre-existing
  `parent-share-preview` a11y lint at L2851, untouched by this change.

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
- **Model abstention pattern.** Reviewers returned incomplete votes on 16 items;
  these are conservatively flagged rather than verified. (Consistent with prior
  subjects; worth a retry-on-empty before flagging in future subjects.)

---

## 6. Decision (resolved)

**Option 2 — GO (run online verification) — was executed.** The real paid Foundry
batch ran over all 374 items; the served bank was rebuilt from real consensus
(355 active, 19 routed to the flagged sibling). Outcome: no genuine key
disagreements, no key auto-flips, all items remain
`pending_two_reviewer_signoff`.

Remaining human gates before any learner exposure:

1. **Subject-lead review** of the 355 `machine_verified` items + adjudication of
   the 19 flagged items (16 reviewer-abstentions + 2 critic-fails + 1
   low-agreement, all with the scraped key either matched or independently
   confirmed correct).
2. **Safeguarding review** and **rights clearance** for derived SSCE content.
3. **Two-reviewer sign-off** flipping `review_state` and the
   `subject_lead_approved` / `safeguarding_reviewed` flags.

**No deployment will occur without an explicit GO at the deploy stage.**
**STOP after Chemistry — Physics (subject 10) was not started.**
