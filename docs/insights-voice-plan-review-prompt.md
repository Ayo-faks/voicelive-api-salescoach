# Prompt: Reflect on & improve the Insights Voice rollout plan

Paste this into a fresh coding session with access to the `voicelive-api-salescoach` repo. The goal is a rigorous, evidence-based critique of the plan before any code is written — not to implement it.

---

## Your role

You are a senior staff engineer doing a **pre-implementation review** of a locked plan. Your job is to:

1. Read the plan end-to-end.
2. Verify every claim in it against the actual repo.
3. Find gaps, incorrect assumptions, hidden coupling, missing tests, risky orderings, and simpler alternatives.
4. Produce a structured reflection with actionable recommendations.

You are **not** writing production code in this session. You may write small throwaway scripts or one-off searches to validate claims. Any suggested edits must be returned as diffs or line-anchored recommendations, not committed.

## Inputs

- **Plan document:** [voicelive-api-salescoach/docs/insights-voice-rollout-plan.md](voicelive-api-salescoach/docs/insights-voice-rollout-plan.md)
- **Repo root:** `/home/ayoola/sen/voicelive-api-salescoach`
- **Prior context (read for situational awareness, do not re-plan from scratch):**
  - `backend/src/services/insights_service.py`
  - `backend/src/services/insights_copilot_planner.py`
  - `backend/src/services/websocket_handler.py` (the `VoiceProxyHandler` we must **not** touch)
  - `backend/src/app.py` — search for `/ws/voice`, `/api/insights`, `/api/config`, `_require_therapist_user`, `_require_child_access`.
  - `frontend/src/components/InsightsRail.tsx` (stub mic button at ~line 1090)
  - `frontend/src/components/InsightsOrb.tsx`
  - `frontend/src/hooks/useRecorder.ts`
  - `frontend/src/hooks/useRealtime.ts` (load-bearing, **must not be edited**)
  - `frontend/src/components/ProgressDashboard.tsx` (forward-compat props ~line 1767-1823)
  - `frontend/src/app/App.tsx` (forwards `insights_rail_enabled` at ~line 4030)

## Background constraints (non-negotiable, from prior sessions)

- The practice-session voice stack (`/ws/voice`, `VoiceProxyHandler`, `useRealtime`) is load-bearing revenue-critical and must not be modified or extended.
- Feature must ship behind `INSIGHTS_VOICE_MODE` with default `off` so DOM + test surface is byte-identical to today when disabled.
- `InsightsService.ask()`, its tool registry, system prompt, access checks, and persistence must remain unchanged.
- No schema changes / Alembic migrations for voice.
- No new runtime dependencies (Azure Speech SDK already wired; Web Speech API is browser built-in).
- User explicitly rejected HTTP for voice — streaming WebSocket is required.

## Deliverable: a single reflection report

Structure your response exactly as below. Be specific: cite file paths and line numbers for every claim.

### 1. Plan-vs-repo fact check

For **each** of the following plan claims, mark ✅ verified / ⚠️ partially correct / ❌ incorrect with file:line evidence:

- `InsightsRail.tsx` stub mic button is at ~line 1090 with `onClick={focusComposer}` and `data-testid="insights-rail-voice-action"`.
- `InsightsOrb` exists, is pure-presentational, unmounted anywhere.
- `useRecorder` implements AudioWorklet + AnalyserNode RMS → `inputLevel` and is not yet used by the rail.
- `useRealtime` is tightly coupled to practice-session concerns (personas, drill tokens, agents) and copying its pattern (not importing/extending) is the right call.
- `/api/config` is the correct surface to publish `insights_voice_mode` and it already gates on therapist/admin.
- `_require_therapist_user` and `_require_child_access` exist in `app.py` and are usable from a WS route.
- `simple_websocket` + `@sock.route` is the Flask websocket mechanism used for `/ws/voice` and is reusable for a new route.
- The 3 `_`-prefixed forward-compat props in `ProgressDashboard.tsx` (~line 1767) are actually safe to use as the `insights_voice_mode` seam.
- Azure Speech SDK credentials in the backend today cover `SpeechRecognizer` with `PushAudioInputStream` (what the plan assumes for STT).
- `InsightsService.ask` signature matches what `insights_websocket_handler.py` will call (`user_id`, `scope`, `message`, `conversation_id`).
- `insight_conversations` / `insight_messages` truly require no changes to accommodate a voice-originated turn (e.g., no `source` or `input_channel` column missing).
- The baseline test counts cited (48 insights tests, 365 backend total, 7/7 rail tests) are accurate.

### 2. Hidden coupling & gotcha hunt

Actively look for things the plan has not mentioned but that will bite during implementation. Specifically check:

- **Auth on WebSockets.** Does the existing `/ws/voice` authenticate via SWA headers, a cookie, a query-string token, or a first-frame message? Will the same mechanism work for `/ws/insights-voice`?
- **CORS / origin checks** on the new WS route.
- **Thread-safety of `InsightsService`.** Is `ask()` safe to call from a WS handler thread? Does it share state with the HTTP request path (e.g., a planner singleton that isn't thread-safe)? Look at how `PracticePlanningService` is invoked from `VoiceProxyHandler` for comparison.
- **Audio format contract.** `useRecorder` emits 24 kHz mono PCM — does Azure `SpeechRecognizer` with `PushAudioInputStream` need 16 kHz? If so, where does resampling happen?
- **Silence / end-of-utterance detection.** Commit 1 says "explicit user stop"; is that actually ergonomic? What does `/ws/voice` use today?
- **`conversation_id` races.** If two `final_transcript` events fire quickly, can they both create conversations? Check `InsightsService.ask` for the create-vs-append branch.
- **`/api/config` caching.** How is `/api/config` consumed on the client? Is it re-fetched on login, on focus, never? Will a stale `insights_voice_mode=off` persist after the flag is flipped server-side?
- **Fluent UI v9 focus behavior** in `InsightsRail` — the voice toggle + existing mic button shouldn't fight over focus.
- **Tests that assert the exact shape of `/api/config`** — adding a new key can break strict-equality tests.
- **Tests that assert `InsightsRail` renders exactly N buttons.**
- **Web Speech API availability** on the therapist's target browsers. What happens on Firefox, Safari, or corporate IE-mode shims? Is the fallback documented?
- **`simple_websocket` message size / framing limits** for PCM streaming. What chunk size does `/ws/voice` actually push?
- **Keepalive / idle timeout** behavior when a therapist opens the orb but doesn't speak.

For each finding, rate impact (blocker / high / medium / low) and propose the smallest fix.

### 3. Test coverage adequacy

For each commit, identify test gaps the plan hasn't specified:

- Integration test that verifies the rail still renders identically with `mode=off` (DOM snapshot or structural assertion).
- Test that `/api/config` continues to return existing fields unchanged.
- Test that a WS connect with a bogus `conversation_id` (one that belongs to another therapist) is rejected, not just that unauth is rejected.
- Test that `InsightsService.ask` is called with the scope from the **URL**, not any scope the client might try to inject in a later message.
- Test that interrupting during `speaking` doesn't leave the conversation in a half-persisted state.
- Test that repeated rapid mic toggles don't leak `AudioContext` / recognizer instances.

### 4. Ordering & rollback risk

- Is the 4-commit order optimal? Could Commit 2 (backend WS) ship before Commit 1 (frontend orb) safely, or vice versa?
- Are there partial-deployment states (backend ahead of frontend, or vice versa) where the product behaves incorrectly?
- What happens if Commit 3 is reverted but Commit 2 stays deployed?
- Does the plan's "`git diff --stat` excludes X" gate catch all the right files, or is it missing any (e.g., shared utility modules, test helpers)?

### 5. Simpler alternatives worth considering

Challenge the plan — not to reject it, but to stress-test:

- Could Commit 1 + Commit 2 be merged into one commit without increasing risk?
- Is a new `/ws/insights-voice` route actually necessary, or could we POST an already-recorded audio blob to a new HTTP endpoint and stream only the STT partials back over Server-Sent Events? (The user rejected HTTP, but is that actually a good call given SSE exists and Azure Speech supports short-form recognition?) Document the tradeoff.
- Is the Web Speech API v1 TTS decision robust, or should server TTS be v1?
- Could the orb mount directly at `voiceActive=false` (scale=1.0, zero motion) and let the mic toggle flip `voiceActive=true`, simplifying the state machine?

### 6. Security / privacy review

- PHI / therapist-child data leaves the server as audio bytes on the WS to Azure Speech. Is that covered by the existing data processing agreement? Check whether `/ws/voice` has the same exposure.
- Are transcripts logged anywhere (server logs, telemetry)? What's the retention policy?
- Does `InsightsService.ask` log the user's message verbatim? If so, voice-originated messages have the same log footprint as text — document it.
- Web Speech API: does it send text off-device in Chrome? (Yes, to Google.) Is that acceptable for clinical content? This is a **blocker-level** question the plan glosses over.

### 7. Recommended changes to the plan

Give a prioritized, numbered list. Each item:
- What to change in the plan.
- Why (evidence-linked to sections above).
- Impact on commit boundaries or scope.

Keep the list lean — aim for 5–10 high-signal changes, not dozens of nits.

### 8. Go / no-go

A one-paragraph verdict: should we start Commit 1 as written, start Commit 1 with specific edits (list them), or revise the plan before starting? Be direct.

---

## Working style

- Use the file/grep/read tools to verify every claim. Do not trust the plan's line numbers without checking.
- Prefer concrete file:line citations over prose.
- If a claim can't be verified because the file doesn't exist or the line is off, say so — don't paper over it.
- Keep the final report under ~1500 words. Dense and specific, not chatty.
- Do not implement any code. Do not edit the plan file. Produce the reflection report as your single response.
