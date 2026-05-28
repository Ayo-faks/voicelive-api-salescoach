# Pathfinder Learn — Home-screen cleanup + unified Ask Pathfinder assistant

**Workspace:** `/home/ayoola/sen`
**Branch:** create `feat/pathfinder-learn-home-cleanup` off `feat/pathfinder-learn-webpush-w8`
**Primary file:** `voicelive-api-salescoach/frontend/src/learning/routes/StudentLearningHome.tsx`
**Stack:** React + TS + Fluent UI v9, Vitest, Playwright. Backend Flask on `/api/learning/*`. Dev server: `cd voicelive-api-salescoach/frontend && npm run dev -- --port 5174 --strictPort`.

## Goal
Tighten the `/home` learner surface and introduce one grounded assistant.

## Tasks (ship as one commit each unless noted)

### 1. Delete the "Web, desktop, tablet, and phone" card
- Remove the `<article data-testid="cross-device-learner-workspace">` block in `StudentLearningHome.tsx`.
- Replace the signal with a small "Works offline" pill next to the existing "7-day streak" chip in the hero (`data-testid="offline-ready-pill"`).
- Update any test that asserts `cross-device-learner-workspace` (search the repo).

### 2. Remove the "Learning profile" link in the top header
- Header link `<a href="/profile">…Learning profile</a>` duplicates the bottom-nav Profile tab. Strip it. Keep the avatar only if rendered separately; otherwise remove the whole link.
- Update Playwright/Vitest assertions that target that link.

### 3. Merge "Bite-sized practice exercise" into "Today's path"
- Delete the standalone `Bite-sized practice exercise` article.
- In the `Today's path` list, when an item is clicked, expand it inline to render the existing MCQ component (the same one currently inside the bite-sized card). Use a single `expandedStepId` state.
- Keep `data-testid` values stable for steps; add `data-testid="today-step-mcq"` for the inline expansion.

### 4. Replace "Career Navigator" with a unified "Ask Pathfinder" assistant (phase 1 = text-grounded; phase 2 ticket below)
- Remove the `Career Navigator` article on `/home`.
- Add a persistent **side-rail floating action button** (`data-testid="ask-pathfinder-fab"`) on every learner route inside `PathfinderLearnApp.tsx`'s learner shell. Icon: chat bubble + mic. Label: "Ask Pathfinder".
- Clicking it opens a Fluent `Drawer` (right side, `data-testid="ask-pathfinder-drawer"`) containing:
  - A text composer + send button (`data-testid="ask-pathfinder-send"`).
  - A mic button (`data-testid="ask-pathfinder-mic"`) — phase 1 may be disabled with tooltip "Voice answers coming next"; phase 2 wires it.
  - A scrollable transcript region (`data-testid="ask-pathfinder-transcript"`).
- **Grounding payload** (sent with each question): `{ user_id, learnerSetup, weakTopics, dailyPlan, careerFits, lastWrongAnswer }`. Read these from the same props/state `StudentLearningHome` already uses; lift them to a context (`LearnerContext`) so the FAB can consume them from any route.
- **Backend endpoint:** add `POST /api/learning/assistant/ask` in `backend/src/learning/api.py`:
  - Method: `LearningApi.ask_assistant(payload)` → `{ "answer": str, "citations": list[{label,url|topic_id}] }`.
  - Implementation phase 1: deterministic templated answer that quotes the learner's own weak topics + career fits (no LLM call required). Keep the seam so a real model can be wired later via `self.assistant_provider` (Protocol with `.ask(question, context) -> AssistantReply`). Default provider returns a structured grounded answer.
  - Register route in the same place as the other learning routes; reuse `_wrap`/`_read_payload`.
- Wire the drawer's send button to POST there.
- Unit-test the deterministic provider (3 tests: pathway question, weak-topic question, wrong-answer question).
- Vitest: render `StudentLearningHome` inside `LearnerContext`, click FAB, type a question, assert transcript contains response.

### 5. Phase 2 ticket (do NOT implement, just file as TODO in repo memory)
Mic button uses `/api/learning/voice/frame` to transcribe → calls `/assistant/ask` → speaks the answer back via existing TTS path. Note this in `/memories/repo/`.

## Cross-cutting requirements
- No new dependencies.
- All existing Vitest + Playwright tests must still pass. Update assertions where the deleted/renamed cards were referenced.
- Add a new Playwright spec `frontend/e2e/pathfinder-ask-assistant.spec.ts` covering: FAB visible on `/home`, drawer opens, sending a question returns an answer that mentions one of the learner's weak topics.
- Keep `data-testid` discipline — the existing ones are load-bearing.
- Do not change RLS, schemas, or VAPID/W8 wiring.
- One git commit per numbered task above (so the diff is reviewable). Use conventional commits: `refactor(learner-home): …`, `feat(assistant): unified Ask Pathfinder drawer`, etc.

## Verification before stopping
```bash
cd voicelive-api-salescoach/backend && .venv/bin/python -m pytest tests/unit -q
cd ../frontend && npx vitest run
PLAYWRIGHT_SKIP_WEBSERVER=true PLAYWRIGHT_BASE_URL=http://127.0.0.1:5174 \
  npx playwright test e2e/pathfinder-ask-assistant.spec.ts e2e/pathfinder-webpush.spec.ts --reporter=list
git log --oneline feat/pathfinder-learn-webpush-w8..HEAD
```
All green; print the commit list; stop.

## Out of scope (do not touch)
- W8 push pipeline, Bicep, dispatcher, service worker.
- Teacher/admin routes (except confirming the FAB only renders for `learner`/`kid` roles).
- Auth, RLS, billing.

## Context the agent should read first
- `voicelive-api-salescoach/frontend/src/learning/routes/StudentLearningHome.tsx`
- `voicelive-api-salescoach/frontend/src/learning/PathfinderLearnApp.tsx`
- `voicelive-api-salescoach/backend/src/learning/api.py` (search `register_learning_api`, `_wrap`)
- `voicelive-api-salescoach/frontend/e2e/pathfinder-webpush.spec.ts` for the spec pattern
- Existing voice composer code referenced by `start-voice-checkin` testid
