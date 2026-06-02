# Session Note: Azure Voice Live Migration Debug (2026-06-02)

## Summary

This session resolved a learner-assistant regression observed during the Azure Voice Live migration.

User symptom:
- Text chat and voice assistant were inconsistent.
- A simple greeting like "hi" sometimes returned a weak-topic template:
  - "Start with Ratio and proportion ... no outcome guarantee ..."
- Voice sometimes replied with "I don't have information" while text looked partially grounded.

Resolution:
- Fixed learner context propagation for Voice Live requests.
- Fixed realtime tool-call extraction/ordering in websocket handling.
- Enabled model-backed assistant smalltalk path in runtime.
- Added deterministic fallback smalltalk behavior to prevent future greeting regressions even when model flag/config is off.
- Added unit regression tests that fail if "hi" reverts to weak-topic template behavior.

---

## What We Traced

### 1) Runtime path verification

Confirmed the UI path used:
- Text drawer posts to `/api/learning/assistant/turn`.
- Voice path uses `/ws/voice` with `scope=learner_ask` and learner context in query params.

### 2) Broken behavior evidence

Observed:
- Websocket calls were arriving with empty learner identity in some flows (`child_id=`), which breaks retrieval scope consistency.
- For plain greetings, deterministic assistant branch treated greeting as a generic "what to study" prompt and emitted weak-topic template text.

### 3) Why greeting looked templated

Primary root cause for the greeting issue:
- Runtime process did not have `PATHFINDER_ASSISTANT_LLM_ENABLED` set.
- That disabled model smalltalk handling and kept deterministic provider active.
- Deterministic provider previously had no explicit greeting branch, so it fell into default weak-topic output.

---

## Code Changes Made

### Frontend context and voice wiring

- `frontend/src/learning/PathfinderLearnApp.tsx`
  - Passed real learner context to Ask Pathfinder provider value (instead of static default only).
  - Added fallback chain for learner id used by Ask Pathfinder.

- `frontend/src/learning/hooks/useAskPathfinderVoice.ts`
  - Added guard for missing `childId` before opening websocket.
  - Emits explicit error for missing learner context.

- `frontend/src/learning/AskPathfinder.tsx`
  - Added clearer user-facing error mapping for missing learner context.

### Backend realtime/tool-call handling

- `backend/src/services/websocket_handler.py`
  - Improved profile tool-call extraction to parse `response.output_item.done` shape.
  - Prevented learner_ask profile tool execution when required question args are incomplete.

### Backend assistant behavior and anti-regression guard

- `backend/src/learning/api.py`
  - Added deterministic smalltalk classification/response for:
    - greeting
    - thanks
    - capability questions
  - Ensures greetings do not fall into weak-topic template even when model provider is unavailable.

### Tests added/updated

- `backend/tests/unit/test_learning_ask_assistant.py`
  - Added regression test: greeting returns smalltalk and not weak-topic template.
  - Hardened fixture to force deterministic mode for stable test behavior.

- `backend/tests/unit/test_learning_assistant_turn.py`
  - Added regression test on unified turn endpoint: greeting returns smalltalk prose block and not weak-topic template.
  - Hardened fixture to force deterministic mode for stable test behavior.

---

## Config and Runtime Fixes

- Updated `.env` with:
  - `PATHFINDER_ASSISTANT_LLM_ENABLED=true`

- Restarted backend process and verified environment variables in live process.

- Confirmed runtime behavior with direct API checks:
  - `POST /api/learning/assistant/ask` with `question=hi` returns smalltalk reply.
  - `POST /api/learning/assistant/turn` with `question=hi` returns block with:
    - `kind=prose`
    - `smalltalk=true`
    - no weak-topic template text.

---

## Browser Clickthrough Trace Capture

Executed a full Playwright browser clickthrough against learner UI and captured network request/response payloads.

Observed request:
- `POST /api/learning/assistant/turn`
- Payload included learner context + `question: "hi"`.

Observed response:
- HTTP 200
- `blocks[0].smalltalk = true`
- Greeting response rendered in transcript.

Result:
- Verified UI is hitting the intended service path and returning expected smalltalk behavior.

---

## Verification Results

### Unit tests

- `pytest -q tests/unit/test_learning_ask_assistant.py tests/unit/test_learning_assistant_turn.py`
- Result: all passed after fixture hardening + regression tests.

### Additional checks from session

- Websocket smoke confirmed assistant block emission in learner_ask flow after backend/tool-call fixes.
- Focused frontend and backend tests for Ask Pathfinder and websocket handler passed in-session.

---

## Why This Should Not Regress Easily Now

1. Dual guardrails:
- Runtime model smalltalk path (when enabled).
- Deterministic fallback smalltalk path (when model path disabled/misconfigured).

2. Explicit regression tests:
- Tests now assert "hi" must be smalltalk and must not produce weak-topic template.

3. End-to-end traceability:
- Browser-level captured request/response confirms actual UI route and payload contract.

---

## Recommended Ongoing Checklist

Before release/deploy:

1. Config sanity:
- Verify `PATHFINDER_ASSISTANT_LLM_ENABLED` is set for target environment.

2. API smoke:
- `POST /api/learning/assistant/turn` with `question=hi` must return `smalltalk=true`.

3. Regression suite:
- Run unit tests for `test_learning_ask_assistant.py` and `test_learning_assistant_turn.py`.

4. UI clickthrough:
- Run Playwright ask-drawer flow and confirm assistant route payload/response.

5. Voice parity:
- Run websocket learner_ask smoke and confirm `wulo.assistant_block` emission with non-empty learner context.

---

## Deployment Note

The migration work in this session was validated locally with Azure Voice Live integration paths and runtime traces. Deployment to environment `swe` should include this config and test checklist to avoid reintroducing greeting/template regressions.
