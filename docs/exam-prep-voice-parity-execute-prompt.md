# Execute prompt — Exam Prep full tutor-card + voice parity

Paste the block below into a **new** chat session (default/agent mode) in the
`voicelive-api-salescoach` workspace to execute the plan.

---

You are continuing work on the `voicelive-api-salescoach` repo
(`/home/ayoola/sen/voicelive-api-salescoach`, branch `main`). Read the full plan
first: `docs/exam-prep-voice-parity-plan.md`. Implement it end-to-end.

**Objective:** Make ALL exam-prep practice flow through the same tutor-card + voice
engine Maths uses (`LearnerVoiceTurnPlanner` + `PracticeFullscreen`), for every
subject and inside Ask Wulo — "all questions on the tutor card just like maths, and
voice just like maths." MCQ items become tap-cards with TTS + mic; typed
`short_answer` items get a new type-or-say free-response card.

**Hard constraints:**
- Do NOT regress `main`. It already has the shipped Fix #1 (commit `cc782ba`):
  exam-prep subject-bank routing, the `GET /api/learning/exam-prep/topics` route,
  `diagnostic_id` threading, and the subject-aware diagnostic answer hint. Build on
  top of it; don't revert any of it.
- There is a `stash@{0}` ("dirty-tree-reconcile-backup-2026-06-20") plus unrelated
  stashes 1–5. Do NOT pop, apply, or drop any stash.
- `backend/data/wulo.db` is an untracked local runtime artifact — never commit or
  delete it (gitignore it if convenient).

**Approach — implement in order, verifying after each phase:**
1. **Phase 1 (MCQ bridge):** add `exam_prep_scripted_questions(banks)` in
   `learner_voice.py` (parse the embedded `A)/B)/...` options out of each MCQ
   `DiagnosticItem` prompt — `provenance.metadata.mcq_options` is unreliable);
   relax request `Subject` to `Optional[str]`; add a real skill FILTER for
   `request.skill_id`; make `MAX_QUESTIONS` configurable. In `api.py`, inject a
   merged bank (`_CONTENT_BANK` + bridged exam-prep banks) into the planner and relax
   subject validation in `run_learner_voice_turn`. In `ExamPrepLibrary.tsx`, open
   `PracticeFullscreen` instead of `DiagnosticPanel`, threading `exam`/`classYear`/
   `subject` (slug)/`skillId`.
2. **Phase 1.5 (Ask Wulo):** make the assistant practice-seed pass the subject slug
   through (not 1 of 3 literals), and add subject EXTRACTION to `assistant_intent.py`
   so "give me agric questions" overrides the saved-profile subject.
3. **Phase 2 (typed):** add a `FreeResponseCard` kind (type or say) for `short_answer`
   items, render it in `LearnerVoiceCard.tsx`, and grade against the normalised
   `correct_answer`.

**Verification (must be green before claiming done):**
- `cd backend && .venv/bin/python -m pytest tests/unit/test_learner_voice*.py tests/unit/test_exam_prep_topics.py -q`
- `cd frontend && npx vitest run src/learning/__tests__/ExamPrepLibrary.test.tsx`
- Add new tests: backend bridge (physics MCQ item → `McqTapCard` with the correct
  option id; unknown subject → graceful no-content card, NOT a 400); frontend
  `ExamPrepLibrary` opens `PracticeFullscreen`; Phase 2 free-response grading.
- Manual smoke (local dev stack must run UNSANDBOXED or servers die with exit 137):
  `bash scripts/run-dev.sh all`, then `/exam-prep` → pick physics → confirm a tutor
  tap-card with TTS + mic; and in Ask Wulo type "give me agric questions to practice"
  → agric tap-card (not the profile subject). For Playwright/browser checks use the
  WSL IP (e.g. `http://<hostname -I>:5173`), not 127.0.0.1, and drive authenticated
  same-origin calls via in-page `fetch` (the MCP browser lacks CDP Storage/cookies).

**Subtlety to verify:** the exam-prep catalogue subject slug MUST equal `bank.subject`
(check `build_exam_prep_topics`), or filtering silently returns no content.

When each phase is green, summarise what changed and STOP for review before
committing/pushing — do not push without explicit confirmation.

---
