# Exam Prep — full tutor-card + voice parity (Fix #2)

> Status: **planned, not started.** Fix #1 (subject-bank routing + subject-aware
> answer hint) already shipped on `main` (commit `cc782ba`). This plan covers the
> remaining work: make **all** exam-prep practice flow through the same tutor-card
> + voice engine that Maths already uses, across every subject and across Ask Wulo.

## Goal (user, 2026-06-20)

> "All questions on the tutor card just like maths, and voice just like maths."

Full parity via the **voice/tutor engine**, not the diagnostic panel. Maths already
flows through `LearnerVoiceTurnPlanner` + `PracticeFullscreen`. Bridge **all** question
banks into that same engine so every subject (English + the 10 SS content subjects)
renders a tap-card with TTS + mic, and typed/short-answer items get a free-response card.

## Engine facts (`backend/src/learning/learner_voice.py`)

- `LearnerVoiceTurnPlanner(bank=...)` — bank is **injectable** (default `_CONTENT_BANK`).
- `_filter_bank` filters `_ScriptedQuestion` by `(exam, class_year, subject)` **equality**;
  `subject` is the raw key, `class_year` canonical (`"SSS3"`), `exam` in `q.exams` set.
- `next_turn` emits `McqTapCard` (stem + options + `correct_option_id`) + `ExplanationCard`
  on a wrong answer + `ProgressCard` at the end. `MAX_QUESTIONS = 3`.
- `forced_skill_id` only **leads** (does not filter) — topic practice needs a real filter.
- Request `Literal`s gate input: `Subject = Literal[3 only]` → 400 on physics etc.;
  `Exam`/`ClassYear` Literals OK; `_VALID_EXAMS_FOR_CLASS` gates combos.
- `_ScriptedQuestion`: `exams` (frozenset), `class_year`, `subject`, `stem`,
  `options` (tuple `McqOption{id,label,text}`), `correct_option_id`,
  `explanation_title`, `explanation_steps`, `skill_id`.
- `candidate_cards()` is a stateless `bank → McqTapCard` projector (reuse pattern).
- `ModelLearnerVoicePlanner` wraps the deterministic planner → must wrap the
  merged-bank instance.

## Bank content shapes (verified)

- **`mcq_single`** (10 SS subjects fully; ~half of english/maths): options are
  **embedded in the prompt** (`"A) ..\nB) .."`); `correct_answer` is `"A) text"`.
  `provenance.metadata.mcq_options` exists **inconsistently** (item 002 yes, 001 no)
  → parse the prompt as the reliable path.
- **`short_answer`** (4 JSS2 phase-2 banks + ~half english/maths): no options, typed.
  Cannot be an `McqTapCard`. Needs a **new free-response card kind** (Phase 2).

## Phased steps

### Phase 1 — MCQ bridge (all MCQ items on the card + voice, "like maths")

1. `learner_voice.py`: add `exam_prep_scripted_questions(banks)` converting each MCQ
   `DiagnosticItem` → `_ScriptedQuestion`: parse prompt → clean stem + options (A..D);
   `correct_answer` letter → `correct_option_id`; `class_year` from `year_group`
   (`SS3` → `SSS3`); `exams` from class band; `subject = bank.subject` (raw slug);
   explanation from item or generic. **Skip `short_answer` in P1.**
2. `learner_voice.py`: relax request `Subject` → `Optional[str]` (planner already gives a
   graceful no-content card for unknown combos). Keep `Exam`/`ClassYear`.
3. `learner_voice.py`: a **real skill FILTER** when `request.skill_id` is set (not just a
   lead); make `MAX_QUESTIONS` configurable for topic practice.
4. `api.py __init__`: merged bank = `_CONTENT_BANK` + `exam_prep_scripted_questions(loaded
   registry banks)` → `LearnerVoiceTurnPlanner(bank=merged)`; ensure
   `ModelLearnerVoicePlanner` wraps it; relax subject validation in `run_learner_voice_turn`.
5. frontend `ExamPrepLibrary.tsx`: open `PracticeFullscreen` (tutor card + voice) instead
   of `DiagnosticPanel`; thread `exam`, `classYear`, `subject` (slug), `skillId`. Add
   `exam` + `classYear` to `PracticeTarget` (from learner setup/profile).
6. Tests: backend bridge unit (physics item → `McqTapCard` with correct option; unknown
   subject → no-content, not 400); frontend `ExamPrepLibrary` opens `PracticeFullscreen`.

### Phase 1.5 — Ask Wulo assistant parity (confirmed in scope)

- **4b.** assistant practice-seed: pass the exam-prep subject **slug** through as `subject`
  (don't collapse to one of the 3 literals). Inherits the merged bank + Subject relax from P1.
- **4c.** `assistant_intent.py`: add **subject extraction** to the intent classifier so a
  typed/spoken subject ("agric") overrides the saved-profile subject; keyword map of
  subject aliases → slug + LLM fallback. Tests: "give me agric questions" → practice intent
  + `subject=agric` → agric mcq-tap card (not the profile subject).

### Phase 2 — short_answer / typed (true "all questions")

7. `learner_voice.py` + models: `FreeResponseCard` kind (type or say); planner emits it for
   `short_answer`; grade against `correct_answer` (normalised).
8. `LearnerVoiceCard.tsx`: render free-response (text box + optional mic STT).
9. Voice STT → text grading; tests.

## Files

- `backend/src/learning/learner_voice.py` — bridge loader, Subject relax, skill filter,
  (P2) `FreeResponseCard`.
- `backend/src/learning/api.py` — merged-bank inject at planner init, subject-validation
  relax in `run_learner_voice_turn`.
- `frontend/src/learning/routes/ExamPrepLibrary.tsx` — open `PracticeFullscreen`.
- `frontend/src/learning/components/PracticeFullscreen.tsx` — accept subject slug/skillId
  (mostly exists).
- (P2) `frontend/src/learning/components/LearnerVoiceCard.tsx` — free-response renderer.
- `backend/tests/unit/test_learner_voice*.py` — bridge + grading tests.

## Verification

- `pytest backend/tests/unit/test_learner_voice*.py test_exam_prep_topics.py`
- `npm test -- ExamPrepLibrary.test.tsx` (or `npx vitest run`)
- Manual: `/exam-prep` → physics → tutor card with tap options + TTS + mic.

## Decisions / open items (confirmed with user 2026-06-20)

- **Scope:** both phases — 100% parity including typed `short_answer` via a new
  "type-or-say" free-response card. Phase 1 (MCQ) ships first, Phase 2 (typed) follows.
- **Shared engine:** `assistant_turn`, `/voice/turn` (`run_learner_voice_turn`), and
  daily-plan `candidate_cards` all use the **same** `self.learner_voice_planner`
  (`api.py`). The assistant already renders typed practice → mcq-tap cards + voice, so
  Phase 1 steps 1–4 **automatically** make "give me agric questions to practice" work in
  Ask Wulo — except the subject still comes from the **setup profile**, hence step 4c
  (subject extraction from the message).
- **Exam/class source:** learner **saved profile/setup**. The existing Maths card already
  passes `exam`/`classYear`/`subject` from `useLearnerSetup()`. Exam Prep reuses the same
  setup; override `subject = topic slug` + add `skillId`.
- **Subject-key consistency:** the exam-prep catalogue subject slug **must equal**
  `bank.subject`. Verify in `build_exam_prep_topics`.
- **Branch:** JSS3/SS3 exam-prep work belongs on `main`.
- `MAX_QUESTIONS = 3` is too few for topic practice — make it configurable.

## Out of scope here (already done / separate)

- Fix #1 (subject-bank routing, `/api/learning/exam-prep/topics` route, `diagnostic_id`
  threading) + subject-aware diagnostic hint — shipped on `main` (`cc782ba`).
- Layer-2 grading concern: English open-response items are graded by short-string match
  against a single `correct_answer` (poor fit for free-response). Phase 2's free-response
  grading should address the typed-answer side of this.
