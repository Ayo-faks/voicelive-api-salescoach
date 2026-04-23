# Debug prompt — Insights voice still feels slow after white-noise fix

**Audience:** a fresh coding-agent session with workspace access to
`/home/ayoola/sen/voicelive-api-salescoach`.

**Mission:** root-cause and reduce the remaining perceived latency in the
therapist Insights voice flow. The white-noise distortion is already fixed. Do not
start by changing thresholds blindly. First instrument the flow, reproduce it, and
measure where the delay really sits.

---

## Repo / runtime context

- Repo root: `/home/ayoola/sen/voicelive-api-salescoach`
- Frontend: React + Vite + TypeScript in `frontend/`
- Backend: Flask + Flask-Sock in `backend/`
- Python venv: `/home/ayoola/sen/.venv`
- Dev app URL: `https://172.18.87.141:5173/d`
- Backend health: `http://127.0.0.1:8000/api/health`
- Local auth is enabled via:
  - `LOCAL_DEV_AUTH=true`
  - `LOCAL_DEV_USER_ID=dev-therapist-001`
  - `LOCAL_DEV_USER_ROLE=therapist`
  - `LOCAL_DEV_USER_EMAIL=dev@localhost`
  - `LOCAL_DEV_USER_NAME="Dev Therapist"`
  - `LOCAL_DEV_USER_PROVIDER=local-dev`
- Insights voice mode is currently `full_duplex`

---

## Current symptom

The user says the Insights voice reply still **feels too slow**, even after the
white-noise bug was fixed.

Important distinction:

- The repeated browser-console errors from `useRealtime.ts` connecting to
  `wss://172.18.87.141:8000/ws/voice` are **separate**. That is the deny-listed,
  practice-session voice hook trying TLS against plain Flask on port 8000. It is
  noisy, but it is not the owner of this latency bug.
- The actual bug here is the **elapsed time between end-of-user-turn and first
  useful reply audio** on the `useInsightsVoice` path.

---

## What has already been fixed

Do not re-debug these from scratch.

### 1. White-noise distortion is fixed

The backend TTS streamer now preserves 16-bit PCM alignment across streamed chunks.
This fix lives in:

- `backend/src/services/insights_websocket_handler.py`

Relevant current values / locations:

- `TTS_CHUNK_SIZE = 2048`
- odd-byte buffering in `_stream_tts_audio()`

This removed the noise caused by raw PCM chunk boundaries splitting samples.

### 2. VAD is already fairly aggressive

Frontend full-duplex VAD currently uses:

- `SPEECH_DETECT_LEVEL_THRESHOLD = 0.12`
- `SILENCE_AUTO_STOP_MS = 500`
- `VAD_WARMUP_MS = 400`
- `VAD_MIN_SPEECH_SAMPLES = 12`

File:

- `frontend/src/hooks/useInsightsVoice.ts`

The user already confirmed the reply is still slow **after** these changes.

### 3. STT shutdown is no longer waiting for a long natural drain

The backend now explicitly calls `recognizer.stop_continuous_recognition_async().get()`
after `user_stop`, while still treating the expected stop-time cancellation as
non-fatal.

Current values / locations:

- `MAX_RECOGNITION_STOP_WAIT_SECONDS = 1`
- `_transcribe_audio_stream()` in
  `backend/src/services/insights_websocket_handler.py`
- log line to watch:
  `Insights voice recognition finished with expected cancellation after user_stop`

This means the remaining latency is likely **not** the old 5-second stop timeout.

---

## Strong current hypothesis

The remaining delay is now most likely in one of these buckets:

1. Time from frontend VAD stop to backend `user_stop` handling.
2. Azure STT finalization after `user_stop`.
3. `insights_service.ask(...)` runtime.
4. Azure TTS request / first-byte delay.
5. Frontend playback scheduling after first `turn.audio_chunk` arrives.

Do not guess which one. Measure all five.

---

## Files to read first

Read these in order before editing:

1. `frontend/src/hooks/useInsightsVoice.ts`
   - current VAD parameters
   - `stop()`
   - WebSocket message handling
   - `enqueueAudioChunk()`
2. `backend/src/services/insights_websocket_handler.py`
   - `_transcribe_audio_stream()`
   - `run()`
   - `_stream_tts_audio()`
3. `backend/src/services/insights_service.py`
   - enough to understand `ask(...)` and what could make it slow
4. `frontend/src/components/InsightsRail.tsx`
   - enough to see state transitions and perceived UX
5. `frontend/src/hooks/useInsightsVoice.test.tsx`
6. `backend/tests/unit/test_insights_websocket_handler.py`
7. `backend/tests/integration/test_insights_voice_routes.py`

Also read:

- `/memories/repo/voicelive-api-salescoach.md`

Relevant reminder from repo memory:

- `useRealtime.ts` is deny-listed and unrelated to this bug
- current local launcher support and local auth assumptions are already known-good

---

## Required investigation steps

Perform these in order.

### Step 1 — Verify the local app is live before changing anything

Use narrow checks first:

```bash
cd /home/ayoola/sen/voicelive-api-salescoach
curl --max-time 3 -s -o /dev/null -w 'backend_health=%{http_code}\n' http://127.0.0.1:8000/api/health
curl -k --max-time 5 -s -o /dev/null -w 'frontend_http=%{http_code}\n' https://172.18.87.141:5173/
```

If backend is not up, restart only the backend with the current local-dev env and
`INSIGHTS_VOICE_MODE=full_duplex`.

### Step 2 — Reproduce in the browser and capture the timing path

If Playwright MCP browser is available, use it. Preferred flow:

1. Open `https://172.18.87.141:5173/d`
2. Start one short voice turn
3. Capture browser console entries around:
   - `[insights-voice] ws open`
   - `[insights-voice-vad] armed`
   - `[insights-voice-vad] silence stop firing`
   - any `turn.final_transcript` handling
   - first `turn.audio_chunk`

If Playwright MCP browser is unavailable, do not block on that. Use temporary
instrumentation plus local logs instead.

### Step 3 — Add temporary frontend timing marks

Add temporary `console.info` or `performance.mark` instrumentation in
`frontend/src/hooks/useInsightsVoice.ts` for these exact milestones:

1. when `stop()` sends `{ type: 'user_stop' }`
2. when `handleEnvelope()` receives `turn.final_transcript`
3. when `handleEnvelope()` receives first `turn.audio_chunk`
4. when playback actually starts scheduling the first source in `enqueueAudioChunk()`
5. when `turn.completed` arrives

Use a consistent prefix like:

```ts
console.info('[insights-voice-timing]', { stage: 'first_audio_chunk', t: performance.now() })
```

Do not leave this instrumentation as random logs. Keep it easy to remove.

### Step 4 — Add temporary backend timing logs

Add `time.perf_counter()` based logging in
`backend/src/services/insights_websocket_handler.py` for these milestones:

1. `user_stop` received
2. recognizer stop requested
3. transcript available
4. `insights_service.ask(...)` start
5. `insights_service.ask(...)` end
6. TTS POST start
7. first TTS chunk yielded
8. final `turn.completed` send

Use one turn-local timer origin so deltas are comparable.

### Step 5 — Run one reproduction and compute the deltas

After a single voice turn, answer these with measured values:

1. `user_stop` send -> backend `user_stop` receive
2. backend `user_stop` receive -> transcript available
3. transcript available -> `insights_service.ask()` end
4. `ask()` end -> first TTS chunk
5. first TTS chunk -> frontend playback scheduled

Only after you have these numbers should you decide what to optimize.

### Step 6 — Choose the fix based on the measured bottleneck

Guidance:

- If most delay is before transcript finalization:
  - inspect STT shutdown/finalization path further
- If most delay is in `insights_service.ask(...)`:
  - inspect planner/tool path, conversation load, and any synchronous waits
- If most delay is TTS first-byte:
  - inspect TTS request setup, auth/token cost, request payload, or chunking strategy
- If most delay is frontend after first audio chunk:
  - inspect `AudioContext` resume/scheduling and playback queueing

Do not optimize the wrong stage.

---

## Guardrails / non-goals

1. Do **not** touch `frontend/src/hooks/useRealtime.ts`.
2. Do **not** touch `/ws/voice`, practice-session routes, or the legacy voice path.
3. Do **not** reintroduce the white-noise bug by removing PCM alignment handling.
4. Do **not** blindly lower VAD silence below current values without evidence.
5. Do **not** add new runtime dependencies.
6. Do **not** create schema changes or Alembic migrations.
7. Do **not** push to origin.

---

## Useful current facts to preserve

- Current frontend VAD values in `frontend/src/hooks/useInsightsVoice.ts`:
  - threshold `0.12`
  - silence `500 ms`
  - warmup `400 ms`
  - min speech samples `12`
- Current backend values in `backend/src/services/insights_websocket_handler.py`:
  - `MAX_RECOGNITION_STOP_WAIT_SECONDS = 1`
  - `TTS_CHUNK_SIZE = 2048`
- Current TTS streamer already preserves 16-bit alignment.
- The backend was recently restarted successfully in `full_duplex` mode and health
  checked with `200` on `/api/health`.

---

## Minimum validation after any fix

Run the smallest relevant checks first:

```bash
cd /home/ayoola/sen/voicelive-api-salescoach/backend
/home/ayoola/sen/.venv/bin/pytest tests/unit/test_insights_websocket_handler.py tests/integration/test_insights_voice_routes.py -q
```

If frontend code changed, at minimum run a narrow validation on the touched hook or
test file.

Then do one manual/browser reproduction and report actual timings before and after.

---

## Done criteria

The task is done only if all of the following are true:

1. The main remaining latency stage is identified with actual numbers.
2. A fix is applied to the measured bottleneck, not guessed at.
3. White-noise distortion stays fixed.
4. The touched tests pass.
5. The final report includes a before/after timing table for one real turn.