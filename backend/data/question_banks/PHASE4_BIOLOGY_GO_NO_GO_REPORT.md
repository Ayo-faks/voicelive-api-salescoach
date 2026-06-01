# Biology SS MCQ Diagnostic Bank — Phase 4 Go/No-Go Report

## Update — Human sign-off complete & go-live (2026-06-01)

**Status superseded:** the original "No deployment / pending_two_reviewer_signoff"
status above reflects the state at Phase 4. As of **2026-06-01** the product owner
confirmed the human **two-reviewer sign-off is complete** (subject-lead review +
safeguarding review) and authorized making the Biology bank learner-available.

What changed as a result:

- **Served diagnostic** (352 machine_verified items) is now learner-visible
  via the exam-prep chips in `frontend/src/learning/routes/StudentLearningHome.tsx`.
- Per-item `provenance[0].metadata` on the served + source banks set to
  `subject_lead_approved = true`, `safeguarding_reviewed = true`,
  `review_state = "approved"`.
- Source bank top-level `review_state` synced to `"approved"`.
- **8 flagged_for_human items remain pending** — held out of the served pack,
  left at `review_state = "pending_two_reviewer_signoff"`.
- Rights/derived-content caveats (§5) are unchanged; sign-off asserts the human
  review occurred, not that licensing was re-cleared.

---


**Status:** GO (real online verification complete). **No deployment performed.**
**Scope:** Biology (SS3) only — subject 8 of 10 in the Pathfinder rollout. Working tree: `voicelive-api-salescoach` (branch `main`).
**Date:** generated at end of Phases 1–3 + Stage 3.5 online execution.

---

## Decision

**GO (run online verification)** — executed under the same contract as
Government, History, Literature-in-English, Economics, Data Processing,
Computer Science and Agricultural Science. Owner authorized fully autonomous
execution including paid spend. The real 3-model Azure AI Foundry ensemble batch
(gpt-4o + gpt-5.2-chat + gpt-5.3-chat, managed identity, no API key) was run over
all 360 items and the served bank rebuilt from the real consensus. This GO
unblocks the next stage only. It does **not** deploy and does **not** override the
human gate: every item stays `review_state = "pending_two_reviewer_signoff"` and
is not learner-visible until two human reviewers sign off. The rights/derived-
content caveats in §5 still stand.

---

## 1. What was built

| Artifact | Path | Purpose |
| --- | --- | --- |
| Source MCQ bank | `backend/data/question_banks/biology-ss-mcq-v1.json` | Stage-1 authored bank, 360 items |
| Source data module | `backend/data/question_banks/biology_questions.py` | 18 topic pools (`TOPICS`) |
| Bank builder | `backend/data/question_banks/build_biology_bank.py` | Stage 1/2 + `_reband_topic` |
| Ensemble verifier | `backend/data/question_banks/ensemble_verify.py` | Stage 3.5 answer-confidence (subject-aware) |
| Ensemble report | `backend/data/question_banks/biology_ensemble_verify_report.json` | machine-readable verify output |
| Served bank builder | `backend/data/question_banks/build_served_subject.py` | Phase 3 promotion (Option A) |
| **Served diagnostic bank** | `data/learning/diagnostics/biology_ss_v1.json` | 352 active items, 352 skills |
| Flagged sibling | `data/learning/diagnostics/biology_ss_v1_flagged.json` | 8 flagged-for-human items |
| Front-end chips | `frontend/src/learning/routes/StudentLearningHome.tsx` | 2 Biology exam-prep chips |

---

## 2. Coverage report (source bank — 360 items)

- **Topics:** 18, **20 items each** (360 total).
- **Exams:** every item tagged `WAEC, NECO` (360/360).
- **Difficulty bands** (VE −3.0 / E −1.5 / M 0.0 / H 1.5 / VH 3.0):
  totals VE=54, E=54, M=144, H=54, VH=54.
- **Every topic has ≥3 items in every band** (VE/E/M/H/VH) — requirement met.
- **Correct-option balance:** a=90, b=90, c=90, d=90 (perfectly even, no positional bias).
- **Duplicate stems:** 0.

| Topic | VE | E | M | H | VH | Total |
| --- | --- | --- | --- | --- | --- | --- |
| Adaptation | 3 | 3 | 8 | 3 | 3 | 20 |
| Cell division | 3 | 3 | 8 | 3 | 3 | 20 |
| Cell structure | 3 | 3 | 8 | 3 | 3 | 20 |
| Coordination | 3 | 3 | 8 | 3 | 3 | 20 |
| Ecology | 3 | 3 | 8 | 3 | 3 | 20 |
| Evolution and conservation | 3 | 3 | 8 | 3 | 3 | 20 |
| Excretion | 3 | 3 | 8 | 3 | 3 | 20 |
| Food chains | 3 | 3 | 8 | 3 | 3 | 20 |
| Genetics | 3 | 3 | 8 | 3 | 3 | 20 |
| Growth and development | 3 | 3 | 8 | 3 | 3 | 20 |
| Homeostasis | 3 | 3 | 8 | 3 | 3 | 20 |
| Living things | 3 | 3 | 8 | 3 | 3 | 20 |
| Nutrient cycles | 3 | 3 | 8 | 3 | 3 | 20 |
| Nutrition | 3 | 3 | 8 | 3 | 3 | 20 |
| Photosynthesis | 3 | 3 | 8 | 3 | 3 | 20 |
| Reproduction | 3 | 3 | 8 | 3 | 3 | 20 |
| Respiration | 3 | 3 | 8 | 3 | 3 | 20 |
| Transport | 3 | 3 | 8 | 3 | 3 | 20 |

Stage-3 deterministic validator (`validate_mcq_bank.py`): **PASS, 0 errors**.
Misconception codes restricted to the validator's `biology` allow-set
(`BOTH | CONTENT` — no QUANT/calc codes), as required for this content subject.
Genetics ratio distractors use `concept_confusion` / `factual_recall`
(`ratio_inversion` is forbidden for this subject).

---

## 3. Ensemble verification report (Stage 3.5)

The verifier runs three reviewers (gpt-4o / gpt-5.2-chat / gpt-5.3-chat) **blind
to the key**, plus a gpt-4o critic. Decision rule: unanimous (3/3) + matches key
+ critic-pass → `machine_verified`; otherwise → `flagged_for_human` (with a
`proposed_correct_option_id` only when a majority lands on a *different* option;
the key is **never** auto-flipped).

The reviewer/critic system prompts are **subject-aware** (`bank.subject` →
`subjects_config.title`), so the models were instructed as Nigerian SSCE
(WAEC/NECO) **Biology** examiners.

**This run was the REAL paid Azure AI Foundry online batch** (managed identity,
no API key):

| Metric | Value |
| --- | --- |
| Backend | `azure-foundry` (real 3-model ensemble) |
| Reviewers | gpt-4o, gpt-5.2-chat, gpt-5.3-chat (critic: gpt-4o) |
| Total items | 360 |
| Processed this run | 360 |
| `machine_verified` | **352** (97.8%) |
| `flagged_for_human` | **8** (2.2%) |
| Items with errors | 0 |
| Content-filtered | 0 |
| Genuine key disagreements | **0** (no model majority proposed a different key) |

**Flagged-item breakdown (all 8):**
- All **8** are flagged *only* because a reviewer abstained (returned an
  empty/`None` vote, so the run was not unanimous 3/3). In **every** one, the
  reviewers that did answer **agreed with the scraped key**
  (`matches_scraped_key = true`) and the critic returned **PASS** — i.e. no
  evidence the key is wrong, just an incomplete vote.
- **No item** had a model majority pointing at a *different* option, so **no
  `proposed_correct_option_id` was set** and **no key was auto-flipped**.

Flagged item ids: `biology-mcq-ss3-036` (Cell structure · multicellular),
`-106` (Transport · platelets), `-152` (Excretion · egestion vs excretion),
`-157` (Excretion · homeostasis link), `-227` (Growth & development · cotyledon),
`-285` (Nutrient cycles · decay & carbon), `-297` (Nutrient cycles · CO₂/O₂
balance), `-353` (Evolution & conservation · afforestation).

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
- Machine-readable report: `biology_ensemble_verify_report.json`.

---

## 4. Served bank + integration (Phase 3)

- `data/learning/diagnostics/biology_ss_v1.json`: **352 active
  (`machine_verified`) items**, **352 skills**, `subject: "biology"`,
  `diagnostic_id: ss3-biology-v1`. The 8 `flagged_for_human` items are routed to
  the `biology_ss_v1_flagged.json` sibling and are **not** learner-served.
- **Option-A encoding:** `subject`, `year_group`, `topic`, `subtopic`,
  `misconception_codes`, `taxonomy_version` are **omitted** from served items.
  MCQ options are rendered into `prompt` and preserved in
  `provenance[0].metadata` (`mcq_options` / `mcq_correct_letter`). Served item
  keys: `correct_answer, difficulty, item_id, item_type, lang, prompt,
  provenance, skill_id`.
- **Routing verified:** both Biology chip skill_ids
  (`ss3.biology.cell_structure.cell_def`,
  `ss3.biology.genetics.genetics_def`) resolve into `ss3-biology-v1` and are
  confirmed present in the **active** served bank (not the flagged sibling); the
  default maths bank and existing maths/english/government/history/literature/
  economics/data-processing/computer-science/agricultural-science routing are
  unchanged.
- **Front-end:** two `type: 'practice'` chips added to `examPrep[]` wired to
  `startCheckIn(item.skillId)` with the real skill_ids above
  (`biology-ss3-cell-structure`, `biology-ss3-genetics`), placed immediately
  after the Agricultural Science livestock chip.
- **Tests:** `pytest -k "learning or diagnostic or bank"` → **410 passed**, 3
  failed. The 3 failures are the pre-existing `test_learning_postgres_repository.py`
  `_FakeConnection` (`NoneType.fetchall`) issues (no Biology reference) and are
  unrelated to this work.
- `get_errors` on edited files: `build_biology_bank.py` and `biology_questions.py`
  **clean**; the one `.tsx` finding is a pre-existing `parent-share-preview` a11y
  lint at L2835, untouched by this change.

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
- **Model abstention pattern.** A reviewer returned empty votes on 8 items;
  these are conservatively flagged rather than verified. (Consistent with the
  Government/History/Agricultural-Science runs; worth a retry-on-empty before
  flagging in future subjects.)

---

## 6. Decision (resolved)

**GO (run online verification) — was executed.** The real paid Foundry batch ran
over all 360 items; the served bank was rebuilt from real consensus (352 active,
8 routed to the flagged sibling). Outcome: no genuine key disagreements, no key
auto-flips, all items remain `pending_two_reviewer_signoff`.

Remaining human gates before any learner exposure:

1. **Subject-lead review** of the 352 `machine_verified` items + adjudication of
   the 8 flagged items (8 reviewer abstentions, all key-agreeing + critic-pass).
2. **Safeguarding review** and **rights clearance** for derived SSCE content.
