# Insights Voice — Non-Breaking Rollout Plan (Phase 4f)

**Status:** PLAN LOCKED 2026-04-22
**Scope:** Add voice input/output to the therapist Insights Rail without touching the load-bearing practice-session voice stack.
**Shape:** 4 additive, feature-flagged commits behind `INSIGHTS_VOICE_MODE` (default `off`).

---

## Context

The Insights Rail (Phase 4b–4e, shipped) currently exposes a stub mic button on `InsightsRail.tsx` that only calls `focusComposer`. Voice is fully deferred. The rail already has:

- `InsightsOrb` (`frontend/src/components/InsightsOrb.tsx`, 312 lines) — pure presentational, unmounted.
- `useRecorder` (`frontend/src/hooks/useRecorder.ts`, 226 lines) — AudioWorklet 24 kHz PCM + AnalyserNode RMS → `inputLevel`. Complete.
- `useRealtime` (`frontend/src/hooks/useRealtime.ts`, 497 lines) — WS client for `/ws/voice`, **tightly coupled** to practice-session agents/personas/drill tokens. Copy its scaffolding only.
- `InsightsService.ask()` — synchronous, scope-validated, tool-budgeted, prompt-versioned. Unchanged by voice.

The practice-session voice path (`/ws/voice`, `VoiceProxyHandler` in `backend/src/services/websocket_handler.py`, `useRealtime`) is load-bearing for the product's primary revenue flow and must not be touched.

## Guiding invariants (every commit must preserve these)

1. **Feature flag:** `INSIGHTS_VOICE_MODE` env var with values `off` | `push_to_talk` | `full_duplex`. **Default `off`.** When off, the rail behaves exactly as today.
2. **Do not touch** `useRealtime.ts`, `/ws/voice`, `VoiceProxyHandler`, or any practice-session route. Copy the *pattern* into new files; never extend or generalize the existing hook/handler.
3. **Do not change** the existing rail composer, Ask button, scope chips, history drawer, or the `/api/insights/ask` / `/api/insights/conversations*` route signatures. Voice is strictly additive.
4. `InsightsService`, the tool registry, system prompt, access checks, and conversation persistence remain unchanged. Voice is a new *input channel* that ultimately calls the same `ask()` method.
5. All new WS traffic uses a **new** endpoint `/ws/insights-voice`. Any failure on that socket must fall back silently to the existing text path, never error the rail.
6. **No schema changes.** No Alembic migration. Voice turns reuse `insight_conversations` / `insight_messages` as-is — the service does not know the input channel was voice.
7. **Server gate + client gate.** Backend WS route rejects on `INSIGHTS_VOICE_MODE == "off"` + not-therapist. Frontend orb/mic logic only renders when `appConfig.insights_voice_mode !== "off"`. Existing tests stay green *without modification*.

---

## Commits

### Commit 1 — frontend-only: mount orb + voice state machine (no backend dependency)

**Files touched (all additive):**

- `frontend/src/components/InsightsRail.tsx`:
  - Import `useRecorder`, `InsightsOrb`.
  - Add local state: `voiceActive: boolean`, `voiceState: InsightsVoiceState`, `transcript: string`.
  - Add a new toggle button `data-testid="insights-rail-voice-toggle"` rendered **only when** `appConfig.insights_voice_mode !== 'off'`.
  - Keep the existing stub mic button (`data-testid="insights-rail-voice-action"`, line ~1090) with `onClick={focusComposer}` for backward-compat test stability.
  - Render `<InsightsOrb state={voiceState} inputLevel={inputLevel} />` **only when `voiceActive`**. When `voiceActive === false`, rail DOM is byte-identical to today.
  - For this commit, transitions are **local-only** (`idle → listening → thinking → idle`) with no network I/O. This keeps the orb testable with zero backend dependency.

- `frontend/src/types/index.ts` (additive): add `AppConfig.insights_voice_mode?: 'off' | 'push_to_talk' | 'full_duplex'`.

- `frontend/src/app/App.tsx`: forward `insightsVoiceMode={appConfig?.insights_voice_mode ?? 'off'}` into `ProgressDashboard` via the existing 3 `_`-prefixed forward-compat props (line ~1767) — the seam is already there.

- `frontend/src/components/ProgressDashboard.tsx`: pipe `insightsVoiceMode` through to `<InsightsRail>`.

**Backend:** `/api/config` payload adds `"insights_voice_mode": os.getenv("INSIGHTS_VOICE_MODE", "off")`, returned only for therapists/admins; otherwise omitted or `"off"`.

**Tests (new):** `InsightsRail.test.tsx`:
- Orb hidden when `mode=off`.
- Orb visible + `data-state="listening"` after toggle click when `mode=push_to_talk`.
- Existing 7/7 rail tests remain green with default `mode=off`.

**Rollback:** unset `INSIGHTS_VOICE_MODE` → clients receive `"off"` → orb never mounts.

---

### Commit 2 — backend: `/ws/insights-voice` streaming STT → existing `InsightsService.ask()`

**New file** `backend/src/services/insights_websocket_handler.py`:
- Class `InsightsVoiceHandler(ws, *, insights_service, speech_config, user)`.
- Copy auth/keepalive/error-handling scaffolding from `websocket_handler.py::VoiceProxyHandler`. **Do not import from it.**
- Azure Speech SDK `SpeechRecognizer` in continuous mode with `PushAudioInputStream`.
- Emit frames to the client: `{type:'partial_transcript', text}`, `{type:'final_transcript', text}`.
- On `final_transcript`, call `insights_service.ask(user_id=user.id, scope=session_scope, message=text, conversation_id=...)`.
- Reply `{type:'answer_complete', conversation_id, assistant_message}`. For v1, send the full answer (no token streaming — `InsightsService` is synchronous). Leave `answer_delta` as a documented future seam.

**`backend/src/app.py`:** new route `@sock.route("/ws/insights-voice")` gated by `INSIGHTS_VOICE_MODE != "off"` AND `_require_therapist_user`. On gate fail → `ws.close(4403, "insights_voice_disabled")`.

**Scope transport:** query string `/ws/insights-voice?scope_type=child&child_id=...&conversation_id=...`. Validated on connect via the existing `_require_child_access` helper.

**Tests (new):**
- `tests/unit/test_insights_websocket_handler.py` — fake WS + fake recognizer; asserts the `final_transcript` path calls `InsightsService.ask` with the correct scope/message and returns the stub planner's answer.
- `tests/integration/test_insights_voice_routes.py` — 403 when flag off, 401 when unauth, handshake succeeds when flag on + therapist.

**Rollback:** `INSIGHTS_VOICE_MODE=off` rejects the WS on connect; Commit 1 frontend keeps working (orb just never establishes a socket).

---

### Commit 3 — frontend: wire real STT socket + TTS playback with `outputLevel`

**New file** `frontend/src/hooks/useInsightsVoice.ts` (~120 lines). **Copy the pattern** from `useRealtime.ts`; do not extend it.
- Opens `/ws/insights-voice`.
- Forwards PCM chunks from `useRecorder` stream mode.
- Surfaces events: `partial_transcript`, `final_transcript`, `answer_complete`, `error`.
- Exposes `outputLevel` via an `AnalyserNode` on a playback `AudioContext`.

**TTS v1:** Web Speech API (`window.speechSynthesis.speak`) — zero new infra, zero new deps. Leave `TODO(insights-voice-tts-stream)` for a future server-side Azure `SpeechSynthesizer` migration with an identical client contract (`answer_audio_chunk` events).

**`InsightsRail.tsx`:** replace Commit 1's stubbed transitions with real `useInsightsVoice()` events:
- `final_transcript` → set transcript, `voiceState='thinking'`.
- `answer_complete` → append to conversation (reuse existing render path), start Web Speech utterance, `voiceState='speaking'`. Sample an analyser if reachable for `outputLevel`; fallback constant 0.5.
- Utterance `end` → `voiceState='idle'`.

**Feature flag:** if `insights_voice_mode === 'off'`, `useInsightsVoice` is never instantiated.

**Tests:** `InsightsRail.test.tsx` mocks `useInsightsVoice` and `window.speechSynthesis`; asserts transcript + answer render paths.

**Rollback:** same env flag.

---

### Commit 4 — barge-in / interrupt + polish

**Frontend:** while `voiceState === 'speaking'`, if `useRecorder.inputLevel > 0.15` for ≥ 200 ms, send `{type:'interrupt'}` over the socket, cancel `speechSynthesis`, transition `interrupted → listening`. Add an explicit Stop button on the orb for reduced-motion / a11y users.

**Backend:** on `{type:'interrupt'}` during synthesis, cancel (no-op for Web Speech path, reserved for server TTS migration) and ack `{type:'interrupted'}`.

**Cosmetic:** `InsightsOrb`'s existing `interrupted` scale=0.92 is reused; add `data-testid="insights-orb-interrupt"` for tests.

**Tests:** simulate an `inputLevel` spike during speaking; assert cancel + state flip.

---

## Reuse map (what is NOT rewritten)

| Asset | Reuse | Copy scaffolding | Rewrite |
|---|---|---|---|
| `InsightsService.ask()` + tools + prompt + authz | ✅ | | |
| `InsightsOrb` (already built) | ✅ | | |
| `useRecorder` (AudioWorklet + analyser `inputLevel`) | ✅ | | |
| `insight_conversations` / `insight_messages` schema | ✅ | | |
| `/api/insights/ask`, `/api/insights/conversations*` | ✅ untouched | | |
| WS auth + keepalive patterns | | ✅ from `websocket_handler.py` | |
| Azure Speech STT config | | ✅ from `VoiceProxyHandler` | |
| `useRealtime` WS client | | ✅ pattern only → new `useInsightsVoice` | |
| `/ws/voice` handler, `useRealtime`, practice-session routes | ❌ do not touch | | |

---

## Verification gates (run on every commit)

1. `cd backend && pytest` — full suite green. Baseline: 365 passed / 1 pre-existing unrelated failure (`drill_tokens` parity). Insights subset: 48.
2. `cd frontend && npm test -- InsightsRail InsightsOrb ProgressDashboard` — green.
3. With `INSIGHTS_VOICE_MODE=off`: manual smoke — rail DOM identical to today, existing mic button still focuses composer, `/api/insights/ask` still returns answers.
4. With flag on: push-to-talk flow works end-to-end on localhost (sqlite + stub planner, then Copilot planner).
5. `git diff --stat` per commit **must not include**: `useRealtime.ts`, `websocket_handler.py`, `app.py::voice_proxy`, `/ws/voice`, any practice-session route.
6. No new entries in `requirements.txt` or `package.json` (Azure Speech SDK already wired; Web Speech API is browser built-in).

## Explicit non-goals (v1)

- No server-side streaming token-level TTS (Web Speech API v1).
- No voice memory, voiceprint, or speaker identification.
- No multi-turn barge-in queueing (single interrupt only).
- No mobile browser certification — desktop Chrome/Edge only in v1.
- No changes to practice-session voice, ever.

## Kill switches

- `INSIGHTS_VOICE_MODE=off` (server env) — instant disable for all users.
- Omit `insights_voice_mode` from `/api/config` — client treats as `off`.
- Revert any single commit in isolation — each is independently reversible because they're additive.

## Decisions locked

- **Streaming WebSocket, not HTTP**, per 2026-04-22 user directive.
- **Push-to-talk default**; `full_duplex` is a later flag value on the same code path.
- **Web Speech API TTS for v1** — avoids server TTS infra in the first shippable cut. Azure `SpeechSynthesizer` is a follow-up with no client breaking change.

## Open considerations (to validate in reflection pass)

1. **Scope transport on WS connect** — query string (simple, matches `/ws/voice`) vs. first-frame `hello` message (more flexible). Recommendation: query string.
2. **Per-therapist opt-in persistence** — deferred; env flag only in v1. Could live on `users.preferences` later.
3. **Server-side TTS upgrade path** — current Web Speech approach must not force a client refactor when Azure TTS lands.
4. **Silence detector for push-to-talk** — not in Commit 1; relies on explicit user stop. Automatic silence detection is a Commit 3 or 4 enhancement.
5. **Conversation ID lifecycle over WS** — client sends existing `conversation_id` on connect; server returns the (possibly newly created) id on `answer_complete`. Matches the HTTP path.
