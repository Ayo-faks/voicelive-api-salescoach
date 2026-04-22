# Implementation Prompt — Insights Voice Rollout v2 (Commit 1)

Copy everything below this line into a fresh coding session.

---

You are implementing **Commit 1** of the Insights Voice rollout for the therapist Insights Rail in this repository. The locked plan is at [voicelive-api-salescoach/docs/insights-voice-rollout-plan-v2.md](voicelive-api-salescoach/docs/insights-voice-rollout-plan-v2.md). **Read that file in full before writing any code.** It is the single source of truth — if anything below conflicts with it, the plan wins.

## Non-negotiable invariants

1. The feature is **flag-gated** behind env `INSIGHTS_VOICE_MODE` (values: `off` | `push_to_talk` | `full_duplex`, default `off`). With the flag off, the repo's runtime behaviour and DOM must be byte-identical to today.
2. **Do not modify, import, or read-for-copy-paste:**
   - `frontend/src/hooks/useRealtime.ts` (pattern reference *only* — you may look at it but must not import it).
   - `backend/src/services/websocket_handler.py`, `managers.py`, `prompt_rules.py`, `scoring.py`.
   - `/ws/voice` route, `VoiceProxyHandler`, any practice-session route.
   - Any Alembic migration. No schema changes.
3. **Do not modify:** `InsightsService.ask()` signature, tool registry, planner prompt, access checks, persistence, or `/api/insights/ask`.
4. **No new runtime dependencies.** `azure-cognitiveservices-speech==1.47.0` is already in `backend/requirements.txt` L5 — but Commit 1 is **REST-only**, no SDK imports in the hot path.
5. **No Web Speech API** anywhere. Chrome resolves `speechSynthesis` to Google-hosted voices by default and exfiltrates PHI. Azure REST TTS only.
6. WS failure is silent — client falls back to the existing text composer.

## Read these files first (in this order)

1. `voicelive-api-salescoach/docs/insights-voice-rollout-plan-v2.md` — the plan.
2. `voicelive-api-salescoach/backend/src/app.py` — L791–832 (`_require_therapist_user`, `_require_child_access` — note they return Flask tuples, unusable on WS), L835 (`_insights_rail_enabled` — template for the new `_insights_voice_mode_for`), L1025–1044 (`/api/config`), L3379–3398 (`/ws/voice` — WS auth pattern reference).
3. `voicelive-api-salescoach/backend/src/services/insights_service.py` — L301 (`ask()` signature), L621–628 (conversation resolve).
4. `voicelive-api-salescoach/backend/src/services/azure_openai_auth.py` — has `DefaultAzureCredential`, `get_bearer_token_provider`, `COGNITIVE_SERVICES_SCOPE = "https://cognitiveservices.azure.com/.default"`. **Reuse this** for Speech REST auth.
5. `voicelive-api-salescoach/backend/src/services/storage.py` — L1570 `user_has_child_access`, L4596 `get_insight_conversation`.
6. `voicelive-api-salescoach/backend/src/config.py` — `azure_speech_region` (default `swedencentral`), `azure_speech_language` (`en-GB`).
7. `voicelive-api-salescoach/frontend/src/components/InsightsRail.tsx` — L567 props interface, L1111 stub mic button (keep unchanged — tests depend on it).
8. `voicelive-api-salescoach/frontend/src/components/InsightsOrb.tsx` — L133 props.
9. `voicelive-api-salescoach/frontend/src/hooks/useRecorder.ts` — 24 kHz Int16 PCM base64 output.
10. `voicelive-api-salescoach/frontend/src/types/index.ts` — L484 `InsightsVoiceState`, L855 `AppConfig`.
11. `voicelive-api-salescoach/frontend/src/components/InsightsRail.test.tsx` — 13 existing tests that must stay green.
12. `voicelive-api-salescoach/backend/tests/integration/test_insights_routes.py` — the `/api/config` contract test (uses `.get(...)`, so new keys are safe).

## Deliverables for Commit 1

### Backend (additive only)

1. **`backend/src/app.py`**
   - Add helper `_require_therapist_ws(ws) -> Optional[Dict]` that reads `ws.environ` (same parsing as `voice_proxy` L3384–3394), enforces therapist/admin role, and on failure calls `ws.close(4403, "insights_voice_forbidden")` and returns `None`.
   - Add helper `_insights_voice_mode_for(user) -> str` mirroring the `_insights_rail_enabled` pattern at L835. Returns the env value or `"off"` for non-therapist users.
   - Add route `@sock.route("/ws/insights-voice")`:
     - If env flag is `off` → `ws.close(4404)`.
     - Auth via `_require_therapist_ws`.
     - Parse `ws.environ["QUERY_STRING"]` for `scope_type`, `child_id`, `conversation_id`.
     - For `scope_type=child`, call `storage_service.user_has_child_access(user.id, child_id)` directly (do **not** call the HTTP variant at L806).
     - If `conversation_id` provided, verify ownership via `storage_service.get_insight_conversation(conversation_id, user.id)`; on mismatch close `4403`.
     - Instantiate `InsightsVoiceHandler(ws, insights_service=insights_service, storage=storage_service, user=user, scope=<pinned>, conversation_id=<pinned_or_none>)` and call `.run()`.
   - In `/api/config` at L1025, add `"insights_voice_mode": _insights_voice_mode_for(user)`.

2. **`backend/src/services/insights_websocket_handler.py`** (new file)
   - Class `InsightsVoiceHandler` with the signature and lifecycle specified in the plan (Commit 1 section).
   - Uses `requests` + `get_bearer_token_provider(DefaultAzureCredential(), COGNITIVE_SERVICES_SCOPE)` for auth.
   - STT: POST to Azure Speech Fast Transcription REST. Send a 16 kHz mono WAV built by downsampling the buffered 24 kHz Int16 PCM client stream.
   - TTS: POST SSML to `https://{region}.tts.speech.microsoft.com/cognitiveservices/v1` with `X-Microsoft-OutputFormat: raw-24khz-16bit-mono-pcm`; stream response bytes as `turn.audio_chunk` envelopes (base64, chunked).
   - Envelope schema is locked to the `turn.*` list in the plan. Emit only what's needed in v1: `turn.started`, `turn.final_transcript`, `turn.audio_chunk`, `turn.completed`, `turn.error`. Ignore any client frame whose `type` is not `user_audio_chunk` or `user_stop`.
   - Scope + conversation_id are **pinned at construction**. Any client frame attempting to change them must be silently ignored.
   - Hard limit: 60 s of buffered audio; emit `turn.error` with code `"input_too_long"` and stop.

3. **Tests**
   - `backend/tests/unit/test_insights_websocket_handler.py` (new): fake WS + mocked `requests.post` for STT/TTS; assert `turn.final_transcript` → `ask()` called with pinned scope; `turn.completed` carries answer; unknown frames ignored.
   - `backend/tests/integration/test_insights_voice_routes.py` (new): 4404 flag-off, 4401 unauth, 4403 no child access, 4403 cross-therapist `conversation_id` hijack, scope-override-attempt ignored.
   - Extend `backend/tests/integration/test_insights_routes.py`: assert pre-existing `/api/config` keys still present after the additive change.

### Frontend (additive only)

1. **`frontend/src/types/index.ts`**
   - Add `insights_voice_mode?: 'off' | 'push_to_talk' | 'full_duplex'` to `AppConfig`.
   - Add discriminated-union envelope types for all `turn.*` entries listed in the plan.

2. **`frontend/src/app/App.tsx`** (~L4030)
   - Forward `insightsVoiceMode={appConfig?.insights_voice_mode ?? 'off'}` to `ProgressDashboard`.

3. **`frontend/src/components/ProgressDashboard.tsx`** (~L1820)
   - Accept `insightsVoiceMode` prop and pipe it to `<InsightsRail>`.

4. **`frontend/src/components/InsightsRail.tsx`**
   - Accept `insightsVoiceMode` prop (default `'off'`).
   - **Do not touch the existing stub mic button at L1111** — `InsightsRail.test.tsx` L309–332 depends on it.
   - Add a new toggle `data-testid="insights-rail-voice-toggle"` rendered only when `insightsVoiceMode !== 'off'`.
   - Mount `<InsightsOrb>` only when voice is active.
   - Call new hook `useInsightsVoice` only when `insightsVoiceMode !== 'off'`.

5. **`frontend/src/hooks/useInsightsVoice.ts`** (new, ~150 lines)
   - Pattern-copy from `useRealtime.ts` — do not import.
   - Opens `/ws/insights-voice?scope_type=...&child_id=...&conversation_id=...` via `WebSocket`.
   - Streams 24 kHz Int16 PCM base64 chunks from `useRecorder`.
   - Sends `{type:"user_stop"}` on stop.
   - Parses NDJSON frames; dispatches `turn.*`; logs + ignores unknown types.
   - Plays `turn.audio_chunk` via `AudioContext` + `AnalyserNode` → exposes `outputLevel`.
   - Exposes `{ voiceState, start, stop, lastTranscript, lastAnswer, outputLevel }`.

6. **Tests**
   - Extend `frontend/src/components/InsightsRail.test.tsx`:
     - With `mode='off'` (default) orb is absent, no voice toggle.
     - With `mode='push_to_talk'`, toggle renders and orb mounts in listening state on press.
     - Existing 13 tests unchanged and green.
   - Add a structural DOM lock: `mode='off'` rail markup is byte-identical to mode-absent baseline (snapshot or `querySelectorAll('[data-testid]').length` compare).

## Commit message

```
feat(insights-voice): Phase 4f Commit 1 — flag-gated voice shell + WS + Azure REST STT/TTS

- Add /ws/insights-voice (Flask-sock), gated by INSIGHTS_VOICE_MODE env + therapist role.
- Add InsightsVoiceHandler: buffered PCM → Fast Transcription REST → InsightsService.ask()
  → Azure TTS REST → turn.* NDJSON envelopes.
- Add insights_voice_mode to /api/config (role + env gated, same pattern as insights_rail_enabled).
- Frontend: useInsightsVoice hook, voice toggle + orb in InsightsRail, wired through
  ProgressDashboard + App. All additive; mode=off is DOM-identical.
- Pinned scope + conversation_id at WS connect; cross-therapist hijack closes 4403.
- No changes to /ws/voice, practice session, useRealtime, InsightsService.ask, or any schema.

Plan: voicelive-api-salescoach/docs/insights-voice-rollout-plan-v2.md
```

## Verification gates (all must pass before declaring Commit 1 done)

1. `cd voicelive-api-salescoach/backend && pytest` — full suite green.
2. `cd voicelive-api-salescoach/frontend && npm test -- InsightsRail InsightsOrb ProgressDashboard` — all green.
3. With `INSIGHTS_VOICE_MODE` unset or `off`: rail DOM byte-identical to today; stub mic still focuses composer; `/api/insights/ask` behaviour unchanged.
4. With `INSIGHTS_VOICE_MODE=push_to_talk`: PTT end-to-end works on localhost (manual smoke test).
5. `git diff --stat` **must not touch**: `useRealtime.ts`, `websocket_handler.py`, `managers.py`, `prompt_rules.py`, `scoring.py`, `/ws/voice`, any practice-session route, any Alembic migration.
6. No new entries in `requirements.txt` or `package.json`.
7. Integration test proves a hijacked `conversation_id` closes 4403 and that the scope passed to `ask()` comes from the URL, not from any later client frame.

## What NOT to do

- Don't implement Commit 2 (streaming STT) or Commit 3 (barge-in) yet. Commit 1 only.
- Don't add `turn.partial_transcript`, `turn.delta`, `turn.tool_*`, `turn.confirmation_required` emissions — those are reserved envelope types for later commits. They exist in the TypeScript types so the client is forward-compat, but the server doesn't emit them in Commit 1.
- Don't use `azure.cognitiveservices.speech` SDK. REST only.
- Don't edit the existing stub mic button or its tests.
- Don't refactor `InsightsService`, `websocket_handler.py`, or the practice voice stack.
- Don't create docs/changelogs for the commit unless asked.

## When you're done

Output: (a) a summary of files added/changed with line counts, (b) the verification gate results, (c) any deviations from the plan and the reasoning. Then stop — Commits 2 and 3 are separate sessions.
