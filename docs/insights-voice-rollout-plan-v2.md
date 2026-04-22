# Insights Voice Rollout Plan — v2 (supersedes v1)

**Status:** locked, ready to implement.
**Supersedes:** [insights-voice-rollout-plan.md](insights-voice-rollout-plan.md) (v1 — Web Speech TTS, 4 commits).
**Date:** 2026-04-22.

Voice input/output for the therapist Insights Rail, feature-flagged behind `INSIGHTS_VOICE_MODE` (default off), with a forward-compatible `turn.*` NDJSON envelope schema that survives the evolution from Q&A to agentic (email, reminders, notifications) without a client rewrite. All Azure-native — no Web Speech API, no Google leak path. Practice-session voice stack untouched.

---

## Invariants

1. Flag `INSIGHTS_VOICE_MODE` ∈ {`off`, `push_to_talk`, `full_duplex`}, default `off`.
2. Do not touch `useRealtime.ts`, `/ws/voice`, `VoiceProxyHandler`, `websocket_handler.py`, practice-session routes.
3. Do not modify `/api/insights/ask`, `InsightsService.ask()` signature, tool registry, planner prompt, access checks, or persistence.
4. New route `/ws/insights-voice`. WS failure → silent fall-back to text composer.
5. No schema changes, no Alembic migration, no new runtime deps (`azure-cognitiveservices-speech==1.47.0` is already in `requirements.txt` L5 but kept out of the v1 hot path — v1 is REST-only).
6. Server gate (env + role on WS) + client gate (mode in `/api/config`).

## Key decisions (locked)

| # | Decision | Rationale |
|---|---|---|
| D1 | **Merge v1's Commits 1+2 into one commit.** | No FE↔BE coupling risk; halves review surface. |
| D2 | **Azure Speech REST for both STT and TTS with managed-identity Bearer.** Web Speech API explicitly rejected. | Chrome's `speechSynthesis` resolves to Google-hosted voices by default — exfiltrates PHI. |
| D3 | **Azure Speech Fast Transcription REST for v1 STT.** Streaming `SpeechRecognizer` SDK deferred to Commit 2. | Simpler surface for PTT utterances <60s: no `PushAudioInputStream`, no sample-rate negotiation, no SDK thread-safety concerns in Flask-sock workers. |
| D4 | **`turn.*` NDJSON envelope schema, borrowed from `transcription-services-demo`.** | Survives the jump from Q&A to agentic (tool calls, confirmations, reminders) as additive events, not a client refactor. |
| D5 | **New `_require_therapist_ws(ws)` helper that closes the socket.** | Existing `_require_therapist_user` / `_require_child_access` return Flask HTTP response tuples that cannot be emitted from a `simple_websocket` handler (see app.py L791–832). |
| D6 | **Pin scope + conversation_id at WS connect; reject later-frame mutation.** | Prevents cross-therapist conversation hijack and duplicate-conversation races in `InsightsService._resolve_conversation` (insights_service.py L621–628). |
| D7 | **Drop the v1 "3 underscore-prefixed forward-compat props" claim** — those props do not exist. Add a normal `insightsVoiceMode` prop to `ProgressDashboard`. |
| D8 | **Expanded `git diff --stat` deny-list:** `useRealtime*`, `websocket_handler.py`, `managers.py`, `prompt_rules.py`, `scoring.py`, `/ws/voice`, any practice-session route, any Alembic migration. |
| D9 | **REST-only in v1 keeps each WS connection single-threaded** — no asyncio juggling inside the Flask-sock worker. |
| D10 | **LiveKit/AI-agents-js rejected for this phase.** Would require a second process, a second auth path, and disruption of the existing flask-sock model. Revisit only if we need multi-user voice rooms. |
| D11 | **VoiceLive Realtime rejected** for Insights. It owns the LLM turn; we can't splice `InsightsService.ask()` (tool registry, scope guards, conversation persistence) into its turn-taking loop. |

---

## Commits (3, down from v1's 4)

### Commit 1 — frontend shell + backend WS + REST STT/TTS (flag-gated)

**Frontend (additive):**

- `frontend/src/types/index.ts`
  - Add `AppConfig.insights_voice_mode?: 'off' | 'push_to_talk' | 'full_duplex'`.
  - Add envelope types (`TurnStarted`, `TurnPartialTranscript`, `TurnFinalTranscript`, `TurnDelta`, `TurnCompleted`, `TurnError`, `TurnConfirmationRequired`, `TurnAudioChunk`, `TurnInterrupt`, `TurnInterrupted`).
- `frontend/src/app/App.tsx` (~L4030): forward `insightsVoiceMode={appConfig?.insights_voice_mode ?? 'off'}` into `ProgressDashboard` as a new prop.
- `frontend/src/components/ProgressDashboard.tsx` (~L1820): pipe prop to `<InsightsRail>`.
- `frontend/src/components/InsightsRail.tsx`
  - Import `useRecorder`, `InsightsOrb`, new hook `useInsightsVoice`.
  - **Keep the existing stub mic button at L1111 unchanged** (Talk↔Send swap tests depend on it — `InsightsRail.test.tsx` L309–332).
  - Add a new toggle `data-testid="insights-rail-voice-toggle"`, rendered only when `insightsVoiceMode !== 'off'`.
  - Mount `<InsightsOrb>` only when `voiceActive`.
- `frontend/src/hooks/useInsightsVoice.ts` (new, ~150 lines). Copy **pattern only** from `useRealtime.ts` (do NOT import it):
  - Opens `/ws/insights-voice?scope_type=...&child_id=...&conversation_id=...`.
  - Forwards 24 kHz Int16 PCM chunks from `useRecorder` stream mode (base64-encoded, same shape as `/ws/voice`).
  - Parses `turn.*` NDJSON envelopes; dispatches on `type.startsWith("turn.")`; unknown types logged and ignored.
  - Plays `turn.audio_chunk` bytes via `AudioContext` + `AnalyserNode` → `outputLevel`.
  - Never instantiated when `insightsVoiceMode === 'off'`.

**Backend (additive):**

- `backend/src/services/insights_websocket_handler.py` (new file). Class signature:
  ```python
  class InsightsVoiceHandler:
      def __init__(self, ws, *, insights_service, storage, user, scope, conversation_id): ...
      def run(self) -> None: ...
  ```
  Lifecycle:
  1. Collect PCM chunks into an in-memory buffer until client sends `{type:"user_stop"}` OR max 60s.
  2. Serialize buffer → 16 kHz WAV (downsample from 24 kHz server-side) → POST to Azure Speech Fast Transcription REST with managed-identity Bearer token.
  3. Emit `turn.final_transcript` with the returned text.
  4. Call `insights_service.ask(user_id=user.id, scope=<pinned>, message=text, conversation_id=<pinned_or_none>)`.
  5. Emit `turn.completed` with `{conversation_id, answer_text, citations, visualizations}`.
  6. POST `answer_text` to Azure TTS REST (`https://<region>.tts.speech.microsoft.com/cognitiveservices/v1`, SSML, `X-Microsoft-OutputFormat: raw-24khz-16bit-mono-pcm`) → stream bytes as `turn.audio_chunk` envelopes.
  - **No SDK imports.** Pure `requests` + managed-identity token via `azure_openai_auth.get_bearer_token_provider` with `COGNITIVE_SERVICES_SCOPE = "https://cognitiveservices.azure.com/.default"` (already exported from `azure_openai_auth.py`).
- `backend/src/app.py`
  - New helper `_require_therapist_ws(ws) -> Optional[Dict]`: reads `ws.environ` headers (same as `voice_proxy` at L3384–3394), enforces therapist/admin role, closes `ws.close(4403, "insights_voice_forbidden")` on fail. Returns user dict or `None`.
  - New route `@sock.route("/ws/insights-voice")`:
    - Gate: `os.getenv("INSIGHTS_VOICE_MODE", "off") != "off"` → else `ws.close(4404)`.
    - Auth: `_require_therapist_ws(ws)` → on fail already closed.
    - Child access: parse `ws.environ["QUERY_STRING"]`; for `scope_type=child`, call `storage_service.user_has_child_access(user_id, child_id)` directly (the HTTP variant at L806 returns Flask tuples).
    - Conversation pin: if client provided `conversation_id`, verify ownership via `storage_service.get_insight_conversation(conversation_id, user.id)`; reject 4403 on mismatch.
    - Instantiate `InsightsVoiceHandler(ws, ...)`.
  - `/api/config` at L1025: add `"insights_voice_mode": _insights_voice_mode_for(user)` using the same role+env pattern as `_insights_rail_enabled` at L835.

**`turn.*` envelope schema (locked now, expandable):**

```
{type:"turn.started",               turn_id, conversation_id?}
{type:"turn.partial_transcript",    text}                      // reserved for Commit 2 streaming
{type:"turn.final_transcript",      text}
{type:"turn.reasoning_summary",     text}                      // reserved for future agent turns
{type:"turn.tool_started",          tool, args}                // reserved; lights up when write-tools land
{type:"turn.tool_completed",        tool, result}              // reserved
{type:"turn.confirmation_required", tool, summary}             // reserved for destructive ops
{type:"turn.delta",                 text}                      // reserved for token streaming
{type:"turn.citation",              item}                      // reserved
{type:"turn.audio_chunk",           data_b64, format}
{type:"turn.completed",             conversation_id, answer_text, citations?, visualizations?}
{type:"turn.error",                 code, message}
{type:"turn.interrupt"}             // client→server, Commit 3
{type:"turn.interrupted"}           // server→client ack, Commit 3
```

Client dispatches on `type.startsWith("turn.")`; unknown types logged and ignored. This is the forward-compat seam for agentic use cases (email drafting, reminders, notifications).

**Tests:**

- `frontend/src/components/InsightsRail.test.tsx`
  - New: orb hidden when `mode=off`; toggle + `<InsightsOrb data-state="listening">` visible when `mode=push_to_talk`.
  - Existing 13 tests must remain green with default `off`.
- `backend/tests/unit/test_insights_websocket_handler.py` (new)
  - Fake WS + fake REST STT/TTS.
  - Asserts `turn.final_transcript` triggers `ask()` with **pinned** scope.
  - Asserts `turn.completed` carries the answer.
  - Asserts unknown client frame types are ignored.
- `backend/tests/integration/test_insights_voice_routes.py` (new)
  - 4404 when flag off.
  - 4401 when unauth headers.
  - 4403 close when therapist lacks child access.
  - **Cross-therapist hijack test:** 4403 when connecting with a `conversation_id` owned by another user.
  - Scope passed to `ask()` comes from URL, not from a later client frame trying to override it.
- `backend/tests/integration/test_insights_routes.py`
  - Assert pre-existing `/api/config` keys still present after the additive change.
- **Structural DOM lock test** that `InsightsRail` markup with `mode=off` is byte-identical to mode-absent baseline (snapshot or `querySelectorAll('[data-testid]').length` lock).

**Rollback:** unset env → WS rejects + client never opens socket.

---

### Commit 2 — streaming STT upgrade (optional, only if barge-in demands it)

Swap the REST Fast Transcription call for `SpeechRecognizer` + `PushAudioInputStream` over the same WS. Envelope schema is unchanged — `turn.partial_transcript` events start firing. No client changes beyond rendering partials (which the client already ignores safely in Commit 1).

**Skip this commit entirely** if product sign-off accepts a "thinking…" indicator instead of live partials.

---

### Commit 3 — barge-in / interrupt + polish

- Frontend: during `voiceState === 'speaking'`, if `useRecorder.inputLevel > 0.15` for ≥200 ms, emit `{type:"turn.interrupt"}` and stop audio playback.
- Backend: on `turn.interrupt` during synthesis, cancel the TTS stream and emit `{type:"turn.interrupted"}`.
- Explicit Stop button on the orb for reduced-motion / a11y users.
- Reuses `InsightsOrb`'s existing `interrupted` scale state; add `data-testid="insights-orb-interrupt"`.

**Requires** Commit 2 streaming STT (barge-in only makes sense if user can speak over TTS mid-stream).

---

## Relevant files

- [backend/src/app.py](../backend/src/app.py) — L791–832 (`_require_*` helpers), L835 (`_insights_rail_enabled` template), L1025–1044 (`/api/config`), L3379–3398 (`/ws/voice` WS auth pattern reference).
- [backend/src/services/insights_service.py](../backend/src/services/insights_service.py) — L301 (`ask()` signature), L621–628 (conversation resolve race point).
- [backend/src/services/azure_openai_auth.py](../backend/src/services/azure_openai_auth.py) — `DefaultAzureCredential`, `get_bearer_token_provider`, `COGNITIVE_SERVICES_SCOPE`. Reuse for Speech REST.
- [backend/src/services/storage.py](../backend/src/services/storage.py) — L1570 `user_has_child_access`, L4522 `create_insight_conversation`, L4596 `get_insight_conversation`, L4620 `list_insight_messages`, L4657 `append_insight_message`.
- [backend/src/config.py](../backend/src/config.py) — `azure_speech_key`, `azure_speech_region` (default `swedencentral`), `azure_speech_language` (`en-GB`).
- [backend/src/services/websocket_handler.py](../backend/src/services/websocket_handler.py) — **reference only; do not import from.**
- [backend/requirements.txt](../backend/requirements.txt) — L5 `azure-cognitiveservices-speech==1.47.0` (available, unused in v1).
- [frontend/src/components/InsightsRail.tsx](../frontend/src/components/InsightsRail.tsx) — L1111 stub mic, L567 props interface, L689/707/807 `focusComposer` usages (don't disturb).
- [frontend/src/components/InsightsOrb.tsx](../frontend/src/components/InsightsOrb.tsx) — props at L133; has internal animation state (not strictly pure-presentational).
- [frontend/src/hooks/useRecorder.ts](../frontend/src/hooks/useRecorder.ts) — 24 kHz Int16 PCM base64, `inputLevel` via AnalyserNode.
- [frontend/src/hooks/useRealtime.ts](../frontend/src/hooks/useRealtime.ts) — pattern reference only; **DO NOT MODIFY OR IMPORT**.
- [frontend/src/components/ProgressDashboard.tsx](../frontend/src/components/ProgressDashboard.tsx) — L1820 `insightsRailEnabled` prop; add `insightsVoiceMode` alongside.
- [frontend/src/app/App.tsx](../frontend/src/app/App.tsx) — L1295–1305 config fetch (fetched once; flag flips require re-login), L4030 prop forward.
- [frontend/src/services/api.ts](../frontend/src/services/api.ts) — `api.getConfig()` caches result in module-level `cachedConfig`.
- [frontend/src/types/index.ts](../frontend/src/types/index.ts) — L484 `InsightsVoiceState` (6 states), L855 `AppConfig`.
- [frontend/src/components/InsightsRail.test.tsx](../frontend/src/components/InsightsRail.test.tsx) — 13 existing tests (not the "7/7" v1 claimed).
- [backend/tests/integration/test_insights_routes.py](../backend/tests/integration/test_insights_routes.py) — L54–73 `/api/config` contract test (uses `.get(...)` — new keys are safe).

## Azure Speech REST contracts (verified 2026-04-22)

- **Fast Transcription (STT v1):** synchronous, multipart/form-data, accepts WAV/MP3/OGG. Auth: `Authorization: Bearer <token>` with scope `https://cognitiveservices.azure.com/.default`. Faster than realtime, single-shot — fits PTT.
- **STT short-audio (alternative):** `https://<region>.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1` — **requires 16 kHz WAV, ≤60 s**. If we pick this, the handler must downsample from useRecorder's 24 kHz.
- **TTS:** `https://<region>.tts.speech.microsoft.com/cognitiveservices/v1`. Headers: `Content-Type: application/ssml+xml`, `X-Microsoft-OutputFormat: raw-24khz-16bit-mono-pcm` (matches playback rate). Body is SSML.

## Verification gates (each commit)

1. `cd backend && pytest` — full suite green; insights subset passes.
2. `cd frontend && npm test -- InsightsRail InsightsOrb ProgressDashboard` — all green.
3. With `INSIGHTS_VOICE_MODE=off`: rail DOM byte-identical to today; existing stub mic still focuses composer; `/api/insights/ask` unchanged.
4. With `INSIGHTS_VOICE_MODE=push_to_talk`: PTT end-to-end on localhost with stub planner; then with Copilot planner.
5. `git diff --stat` **must not touch**: `useRealtime.ts`, `websocket_handler.py`, `managers.py`, `prompt_rules.py`, `scoring.py`, `/ws/voice`, any practice-session route, any Alembic migration.
6. No new entries in `requirements.txt` or `package.json`.
7. WS connect with a hijacked `conversation_id` is closed 4403. Scope passed to `ask()` is the URL scope, not any client-frame override.

## Explicit non-goals (v1)

- No streaming token-level LLM output (`InsightsService.ask()` is synchronous; `turn.delta` is reserved envelope space, unused until the planner streams).
- No server-side audio persistence or transcripts beyond what `insight_messages` already stores (voice turn content is indistinguishable from text — documented privacy trade-off).
- No voice agent write-tools (email, reminders) in v1. Envelope schema is ready for them; `InsightsService` tool registry is ready for them; no UX work done.
- No Firefox / Safari / mobile certification — desktop Chrome/Edge only.
- **No changes to practice-session voice, ever.**

## Kill switches

1. `INSIGHTS_VOICE_MODE=off` → instant disable.
2. Revert any commit in isolation (each is additive + behind flag).
3. Client treats missing `insights_voice_mode` in `/api/config` as `off`.

## Open considerations (v2+)

1. Long-running tools (send email, schedule reminder) will need a job queue + a `turn.tool_completed` pushed *after* `turn.completed` — envelope supports it, runtime does not. Not blocking v1.
2. `/api/config` caching: flag flips require re-login. Acceptable; document in README.
3. Per-therapist opt-in (voice preference on `users.preferences`) — deferred.
4. Silence detection for push-to-talk — client-side `useRecorder.inputLevel` threshold, deferred to Commit 2/3.
5. Confirmation UX for destructive voice actions (Phase 5): `turn.confirmation_required` → modal → `turn.confirmation_response`. Envelope ready.
