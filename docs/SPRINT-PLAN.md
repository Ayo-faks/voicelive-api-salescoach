# SEN Speech-Support Pilot: Sprint-by-Sprint Engineering Plan

**Scope:** Therapist-supervised English-only pilot, adapted from voicelive-api-salescoach.
**Sprint cadence:** 2-week sprints. 6 sprints = 12 weeks to pilot-ready.
**Team assumption:** 1–2 engineers, 1 SLT advisor (part-time).

---

## Sprint 1 — Domain Foundation (Weeks 1–2)

**Goal:** Replace the sales domain with SEN exercise domain across backend types, prompts, and scenarios. App still runs, tests still pass, but the domain is speech therapy.

### Must-do

1. **New exercise YAML files** — Create 4–6 exercise files under `data/exercises/` using the existing YAML structure from `data/scenarios/scenario1-role-play.prompt.yml`. Exercise types: word repetition, minimal pairs, sentence repetition, guided prompt.
   - Files: new `data/exercises/*.prompt.yml` (role-play + evaluation pairs)

2. **New evaluation prompts** — Replace sales evaluation criteria in evaluation YAMLs with SEN criteria: articulation_clarity, task_completion, engagement_level, phoneme_accuracy, fluency_progress, self_correction.
   - Files: new `data/exercises/*-evaluation.prompt.yml`

3. **Update ScenarioManager** — Rename internally to ExerciseManager. Change `ROLE_PLAY_FILE_SUFFIX`, `SCENARIO_DATA_DIR` constants. Point at `data/exercises/`. Keep the YAML loading, `get_scenario()`, `list_scenarios()` patterns.
   - File: `backend/src/services/managers.py` (ScenarioManager class)

4. **Update ConversationAnalyzer evaluation schema** — Replace the `sales_evaluation` JSON schema in `_get_response_format()` with SEN therapy schema. Replace `_build_evaluation_prompt()` criteria text. Replace `_process_evaluation_result()` field names.
   - File: `backend/src/services/analyzers.py` (ConversationAnalyzer, lines ~68–327)

5. **Update AgentManager.BASE_INSTRUCTIONS** — Replace sales persona with child-friendly speech coach persona. Keep the short-response and stay-in-character guidelines.
   - File: `backend/src/services/managers.py` (AgentManager class, BASE_INSTRUCTIONS)

6. **Update frontend types** — Replace `Assessment.ai_assessment` interface fields (speaking_tone_style, conversation_content) with SEN equivalents. Keep `pronunciation_assessment` as-is.
   - File: `frontend/src/types/index.ts`

7. **Update tests** — Fix `test_analyzers.py` assertions that reference `sales_evaluation`, `speaking_tone_style`, etc. Update `test_managers.py` for renamed constants.
   - Files: `backend/tests/unit/test_analyzers.py`, `backend/tests/unit/test_managers.py`

### Defer
- Graph API scenario generation (remove or hide for now)
- Avatar selection (keep default, hide picker)
- Config changes (keep en-US default for now)

### Exit criteria
- `./scripts/test.sh` passes
- App runs locally, shows exercise list instead of sales scenarios
- GPT-4o returns structured SEN evaluation JSON

---

## Sprint 2 — Exercise Authoring & Child Session Flow (Weeks 3–4)

**Goal:** Therapist can create exercises. Child can complete a guided exercise through the voice interface.

### Must-do

1. **Exercise Builder UI** — Adapt `CustomScenarioEditor.tsx` into an ExerciseEditor. Add fields: target_sound, target_words (comma-separated), prompt_text, difficulty (easy/medium/hard), exercise_type dropdown (word_repetition, minimal_pairs, sentence_repetition, guided_prompt).
   - File: `frontend/src/components/CustomScenarioEditor.tsx` → rename/adapt

2. **Exercise data model** — Extend `CustomScenarioData` in `frontend/src/types/index.ts` to include `exerciseType`, `targetSound`, `targetWords`, `difficulty`, `promptText` alongside `systemPrompt`.

3. **Exercise localStorage service** — Adapt `frontend/src/services/customScenarios.ts`. Rename storage key. Update `getDefaultSystemPrompt()` to return SEN exercise template.
   - File: `frontend/src/services/customScenarios.ts`

4. **Child session UI** — Simplify `App.tsx` flow: remove corporate layout, make the exercise selection screen large-button/card-based, make the active session screen a single large microphone button + visual feedback.
   - Files: `frontend/src/app/App.tsx`, `frontend/src/components/ScenarioList.tsx`

5. **Exercise-aware agent creation** — Update `api.createAgentWithCustomScenario()` to pass exercise metadata (target words, prompt text) so the agent instructions include them.
   - Files: `frontend/src/services/api.ts`, `backend/src/app.py` (create_agent endpoint)

6. **Configurable speech locale** — Make `azure_speech_language` overridable per exercise via the exercise YAML `speechLanguage` field. Default stays en-US. Wire through to `PronunciationAssessor._create_speech_config()`.
   - Files: `backend/src/config.py`, `backend/src/services/analyzers.py`

### Defer
- Mobile-responsive CSS (next sprint)
- Progress persistence (next sprint)
- Avatar changes

### Exit criteria
- Therapist can create a custom exercise with target sounds/words
- Child can start an exercise, speak, and hear the AI coach respond
- Exercise metadata flows through to the agent persona

---

## Sprint 3 — Per-Utterance Scoring & Feedback (Weeks 5–6)

**Goal:** Pronunciation scoring happens per exercise utterance, not just after a long conversation. The child sees word-level feedback during or immediately after each exercise attempt.

### Must-do

1. **Per-utterance assessment endpoint** — Add `POST /api/assess-utterance` in `backend/src/app.py`. Accepts a single audio chunk + reference_text (the target words for that exercise step). Calls `PronunciationAssessor.assess_pronunciation()` and returns word-level scores immediately.
   - File: `backend/src/app.py`

2. **Utterance recording hook** — Adapt `frontend/src/hooks/useRecorder.ts` to support "record one utterance" mode (record → stop → send for scoring) in addition to the existing streaming mode.
   - File: `frontend/src/hooks/useRecorder.ts`

3. **Inline feedback component** — Create a new `ExerciseFeedback.tsx` component that shows word-level scores (green/yellow/red badges from the existing `getScoreColor()` pattern in `AssessmentPanel.tsx`) immediately after each utterance.
   - Files: new `frontend/src/components/ExerciseFeedback.tsx`, reuse patterns from `frontend/src/components/AssessmentPanel.tsx`

4. **Age-calibrated score adjustment** — Add a post-processing layer in `PronunciationAssessor` that applies age-based adjustments: if exercise metadata includes `childAge`, suppress known age-appropriate substitutions (e.g., /w/ for /r/ at age 4) from the error list.
   - File: `backend/src/services/analyzers.py` (new method on PronunciationAssessor)

5. **Safety copy in feedback** — All score displays include a static label: "Practice feedback — not a clinical assessment." Add this to `ExerciseFeedback.tsx` and `AssessmentPanel.tsx`.
   - Files: `frontend/src/components/ExerciseFeedback.tsx`, `frontend/src/components/AssessmentPanel.tsx`

6. **Tests for new endpoint** — Unit tests for `/api/assess-utterance`, age-calibration logic, and the new feedback component.
   - Files: `backend/tests/unit/test_app.py`, `backend/tests/unit/test_analyzers.py`

### Defer
- Streaming mid-session assessment via WebSocket (too complex for pilot)
- Prosody scoring display (prosody_score is en-US only and unreliable for children)

### Exit criteria
- Child completes a 3-word exercise, sees word-level accuracy after each attempt
- Age-calibration suppresses developmentally normal substitutions
- Safety disclaimer visible on every feedback screen

---

## Sprint 4 — Persistence & Therapist Review (Weeks 7–8)

**Goal:** Sessions are stored. A therapist can review a child's exercise history and scores over time.

### Must-do

1. **Persistence layer** — Add a lightweight storage backend. For pilot scale, use Azure Cosmos DB (serverless) or even SQLite behind the Flask app. Define models: `Therapist`, `Child`, `Exercise`, `Session` (exercise_id, child_id, timestamp, scores, audio_ref).
   - Files: new `backend/src/services/storage.py`, update `backend/src/app.py` with session-save logic

2. **Session save on completion** — After exercise completion and scoring, auto-save the session record (scores, word-level results, exercise metadata) to the persistence layer.
   - File: `backend/src/app.py` (analyze and assess-utterance endpoints)

3. **Therapist review endpoints** — Add `GET /api/children/{child_id}/sessions` and `GET /api/sessions/{session_id}`. Returns session history with scores.
   - File: `backend/src/app.py`

4. **Therapist review UI** — Add a simple `ProgressDashboard.tsx` component: list of children → list of sessions → session detail with scores. Reuse the score display patterns from `AssessmentPanel.tsx`.
   - Files: new `frontend/src/components/ProgressDashboard.tsx`, update `frontend/src/app/App.tsx` routing

5. **Basic auth gate** — Add a simple therapist PIN or password screen to access the therapist view. Not full enterprise auth — just enough to separate therapist and child modes for the pilot.
   - Files: `frontend/src/app/App.tsx`, `backend/src/app.py` (simple middleware)

6. **Infrastructure update** — If using Cosmos DB, add the resource to `infra/resources.bicep` and wire the connection string through to the backend config.
   - Files: `infra/resources.bicep`, `backend/src/config.py`

### Defer
- Full Entra ID / B2C auth (Phase 2)
- Audio recording storage in Blob Storage (Phase 2)
- Export/reporting features

### Exit criteria
- After a child completes exercises, the session appears in the therapist review screen
- Therapist can see score trends across multiple sessions for one child
- Therapist view is gated behind a simple PIN

---

## Sprint 5 — Mobile & Pilot Hardening (Weeks 9–10)

**Goal:** The app works on a mobile phone browser. The deployment is stable enough for a supervised clinic pilot.

### Must-do

1. **Responsive CSS** — Update `frontend/src/styles/global.css` and component styles for mobile viewports. Large touch targets for the child session. Readable therapist review on tablet.
   - Files: `frontend/src/styles/global.css`, component `makeStyles` blocks

2. **PWA manifest** — Add a basic `manifest.json` for add-to-homescreen on mobile. Add a service worker for static asset caching only (not offline voice).
   - Files: new `frontend/public/manifest.json`, `frontend/index.html`

3. **Voice configuration for children** — Change the default TTS voice to a friendlier option. Make it configurable via env var (already supported in `config.py` via `AZURE_VOICE_NAME`).
   - File: `backend/src/config.py` (change DEFAULT_VOICE_NAME)

4. **Remove sales artifacts** — Final cleanup pass: remove `data/scenarios/` sales YAMLs, remove Graph scenario generation code, remove avatar picker, remove sales-specific copy from README.
   - Files: `data/scenarios/*`, `backend/src/services/graph_scenario_generator.py`, `frontend/src/components/ScenarioList.tsx`

5. **Error handling for poor connectivity** — Add reconnection logic in `frontend/src/hooks/useRealtime.ts` for dropped WebSocket connections. Show user-friendly "connection lost" message.
   - File: `frontend/src/hooks/useRealtime.ts`

6. **Deployment to South Africa North** — Update `infra/resources.bicep` location parameter. Validate that AI Foundry + Speech Services are available in that region. If not, use closest viable region and document the latency trade-off.
   - Files: `infra/resources.bicep`, `backend/src/config.py`

7. **Pilot exercise library** — Finalize 8–10 therapist-reviewed exercises covering common SEN targets: /s/, /r/, /l/, /th/, /sh/ sounds in initial/medial/final position, plus 2–3 sentence-level exercises.
   - Files: `data/exercises/*.prompt.yml`

### Defer
- Opus audio compression (defer unless 3G testing shows it's required)
- Offline mode
- Animated avatar for children

### Exit criteria
- App works on Android Chrome and iOS Safari on a phone
- Full exercise flow completes on 4G mobile connection
- Deployment runs in or near the target African region
- Exercise library reviewed by at least one SLT

---

## Sprint 6 — Pilot Launch & Instrumentation (Weeks 11–12)

**Goal:** The app is deployed, instrumented, and ready for supervised clinic use with 3–5 therapists.

### Must-do

1. **Pilot onboarding flow** — Add a first-run screen for therapists: brief explanation, consent acknowledgment, PIN setup. Add a child-mode entry: therapist selects child profile, picks exercise, hands device to child.
   - Files: `frontend/src/app/App.tsx`, new `frontend/src/components/OnboardingFlow.tsx`

2. **Consent and safety** — Add a consent screen before first child session. Therapist acknowledges: tool is for supervised practice only, not diagnosis. Store consent timestamp.
   - Files: new `frontend/src/components/ConsentScreen.tsx`, `backend/src/services/storage.py`

3. **Telemetry for pilot** — Instrument key events via Application Insights (already in infra): exercise_started, exercise_completed, utterance_scored, session_duration, therapist_review_opened. No PII in telemetry.
   - Files: `backend/src/app.py`, `frontend/src/app/App.tsx`

4. **Pilot feedback mechanism** — Add a simple "Rate this exercise" (thumbs up/down + optional text) after each session. Store with the session record.
   - Files: `frontend/src/components/ExerciseFeedback.tsx`, `backend/src/services/storage.py`

5. **Ops readiness** — Verify health check endpoint works (`/api/config`), verify Application Insights dashboards show key metrics, set up a basic alert for container restarts.
   - Files: `backend/src/app.py` (existing health check), Azure Portal config

6. **Documentation** — Write a 1-page therapist quick-start guide: how to create exercises, how to start a child session, how to review progress, known limitations.
   - File: new `docs/therapist-guide.md`

### Defer
- Automated clinical outcome tracking
- Multi-clinic tenant isolation
- Data export for research

### Exit criteria
- 3–5 therapists can independently run the tool with children
- Each session generates telemetry and stored results
- Therapist feedback loop is active
- No diagnostic language appears anywhere in the UI

---

## Summary: What Ships vs. What Waits

| Category | Sprint | Status |
|----------|--------|--------|
| SEN exercise domain (prompts, types, scoring) | 1 | Must have |
| Exercise authoring (therapist creates exercises) | 2 | Must have |
| Child session UI (simplified, large-button) | 2 | Must have |
| Per-utterance pronunciation scoring | 3 | Must have |
| Age-calibrated score adjustment | 3 | Must have |
| Safety disclaimers everywhere | 3 | Must have |
| Session persistence + therapist review | 4 | Must have |
| Basic auth gate (therapist PIN) | 4 | Must have |
| Mobile responsive + PWA | 5 | Must have |
| Regional deployment (South Africa North) | 5 | Must have |
| Pilot onboarding + consent | 6 | Must have |
| Telemetry + feedback loop | 6 | Must have |
| African language scoring | — | Deferred (blocker) |
| Offline mode | — | Deferred (blocker) |
| Full enterprise auth (B2C) | — | Deferred |
| Opus audio compression | — | Deferred |
| Custom Speech child model | — | Deferred |
| Parent portal | — | Deferred |
| FastAPI rewrite | — | Deferred |
| APIM rate limiting | — | Deferred |
| Animated child avatar | — | Deferred |
