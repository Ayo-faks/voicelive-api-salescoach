# Phase A — Honest practice surface + pluggable neural read-aloud

Repo: `/home/ayoola/sen/voicelive-api-salescoach`
Branch: `feat/pathfinder-learn-home-cleanup`

## Context — read before touching anything

Two confusingly-named components exist in this repo:

- `frontend/src/learning/components/VoiceAgentFullscreen.tsx` — the REAL
  teacher/admin voice agent. Uses `useInsightsVoice` → backend
  `services/websocket_handler.py` → **Azure AI VoiceLive** (full-duplex realtime
  STT + LLM + TTS + barge-in). DO NOT touch in Phase A — that is Phase B.

- `frontend/src/learning/components/LearnerVoiceFullscreen.tsx` — a tap-only
  mock with a disabled mic, served by `POST /api/learning/voice/turn` →
  `backend/src/learning/learner_voice.py` (`LearnerVoiceTurnPlanner`). Card
  vocabulary: `greeting | mcq-tap | explanation | progress | mark-known`.
  Taxonomy already wired and gated by `_VALID_EXAMS_FOR_CLASS`.

Phase A:
1. Make the mock honest (rename, kill the disabled mic).
2. Launch it from Today's-path practice cards.
3. Add a **Listen 🔊** button that plays the card's `speak` field through a
   **vendor-agnostic TTS layer**. First provider: **Azure Speech Neural
   (`en-NG-EzinneNeural`)**. The layer must allow swapping to **Google Cloud
   TTS** later by changing one env var, with no route, cache, or frontend
   changes.

## Why pluggable, not direct Azure

We want to A/B Azure `en-NG-EzinneNeural` against Google `en-NG-Standard-A` /
`en-NG-Wavenet-*` on real learners without rewiring. The vendor difference
must NOT leak past the `TtsProvider` interface.

## Scope — do exactly this, nothing more

### Backend — new pluggable TTS layer (additive)

Create `backend/src/learning/tts/` with:

**`tts/providers/base.py`**
```python
from abc import ABC, abstractmethod

class TtsProviderError(Exception):
    pass

class TtsProviderUnavailable(TtsProviderError):
    """Raised when provider is misconfigured (missing creds, etc.). Maps to 503."""

class TtsProvider(ABC):
    id: str  # short identifier, e.g. "azure", "google"

    @abstractmethod
    def synthesize(self, text: str, voice: str, lang: str) -> bytes:
        """Return MP3 audio bytes. Raise TtsProviderUnavailable if not configured."""
```

**`tts/providers/azure_speech.py`**
- Class `AzureSpeechProvider(TtsProvider)`, `id = "azure"`.
- Reads `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` (default `westeurope`).
- Uses `azure.cognitiveservices.speech` (already imported by
  `backend/src/services/insights_websocket_handler.py` — same SDK).
- Output format `audio-24khz-48kbitrate-mono-mp3`. Return MP3 bytes.
- Default voice from arg; if no creds → raise `TtsProviderUnavailable`.

**`tts/providers/google_cloud.py`**
- Class `GoogleCloudTtsProvider(TtsProvider)`, `id = "google"`.
- Reads `GOOGLE_APPLICATION_CREDENTIALS` (path to service account JSON) and
  `GOOGLE_TTS_PROJECT_ID` (optional).
- Implementation may be a stub for Phase A: importing `google.cloud.texttospeech`
  is permitted but NOT required. If the library is not installed, raise
  `TtsProviderUnavailable("google provider not installed")`.
- Output: MP3 (`AudioEncoding.MP3`). When stubbed, raise unavailable —
  do NOT fabricate audio bytes.
- Goal: prove the seam holds; real implementation lands when we swap.

**`tts/service.py`**
- `def get_provider() -> TtsProvider`:
  - Reads `LEARNER_TTS_PROVIDER` env, default `"azure"`.
  - Returns the matching provider instance (lazy singleton).
  - Unknown id → raise `TtsProviderUnavailable`.
- `def synthesize_cached(text, voice, lang) -> tuple[bytes, str]`:
  - Returns `(mp3_bytes, cache_status)` where status is `"hit" | "miss"`.
  - In-memory LRU, max 256 entries. Key = sha256(`provider.id + voice + lang + text`).
  - On miss, calls `provider.synthesize(...)`, stores, returns `"miss"`.
- `def resolve_voice(requested: str | None) -> tuple[str, str]`:
  - Returns `(voice, lang)`. If `requested` is None, use env
    `LEARNER_TTS_VOICE` (default `en-NG-EzinneNeural`). Lang derived from
    voice prefix (`en-NG-...` → `en-NG`). Keep this dumb; providers validate.

**`tts/routes.py`** — Flask blueprint:
- `POST /api/learning/tts`
- Auth: reuse the same decorator that protects `/api/learning/voice/turn` in
  `backend/src/learning/api.py`. Do not invent new auth.
- Request JSON: `{ "text": str, "voice"?: str, "lang"?: str }`.
  - Empty/whitespace `text` → 400 `{"error":"empty_text"}`.
  - `len(text) > 600` → 400 `{"error":"text_too_long"}`.
- On `TtsProviderUnavailable` → 503 `{"error":"tts_unavailable"}`.
- On success → `audio/mpeg` body, `Content-Type: audio/mpeg`,
  `Cache-Control: public, max-age=86400`, header `X-TTS-Cache: hit|miss`,
  header `X-TTS-Provider: <provider.id>`.
- Register the blueprint where `/api/learning/voice/turn` is registered
  (search the repo for `voice/turn` registration).

### Backend tests — `backend/tests/unit/test_learning_tts.py`

Mock at the `TtsProvider` boundary, NOT the SDK. Tests must NOT touch network.

- 400 on empty text.
- 400 on >600 chars.
- 503 when provider raises `TtsProviderUnavailable` (monkeypatch
  `get_provider` to return a stub that raises).
- 200 with `X-TTS-Cache: miss` on first call, `X-TTS-Cache: hit` on second call
  with identical body; assert stub `synthesize` called exactly once.
- `X-TTS-Provider` header matches stub's `id`.
- Provider-swap smoke: set `LEARNER_TTS_PROVIDER=google` env, monkeypatch
  `GoogleCloudTtsProvider.synthesize` to return `b"FAKE"`; assert response
  body is `b"FAKE"` and `X-TTS-Provider: google`. Confirms the seam works
  without any route change.

### Frontend (the seam is invisible to FE)

1. Rename `LearnerVoiceFullscreen` → `PracticeFullscreen`.
   - `git mv` component + test. Update all imports.
   - Test ids `learner-voice-*` → `practice-*`.
   - Prop type `LearnerVoiceFullscreenProps` → `PracticeFullscreenProps`.

2. Remove the disabled mic entirely (drop `MicrophoneIcon`, mic button,
   "phase 2.0" copy). Footer: "Tap an option to answer · Tap 🔊 to hear it
   again".

3. Add `frontend/src/learning/hooks/useTtsPlayer.ts`:
   ```ts
   export function useTtsPlayer(): {
     supported: boolean   // false after a 503 from /api/learning/tts
     playing: boolean
     play: (text: string) => Promise<void>
     stop: () => void
   }
   ```
   - Single internal `HTMLAudioElement`.
   - `POST /api/learning/tts` with `credentials: 'include'`, body `{ text }`.
   - 503 → set `supported=false`, resolve silently.
   - `URL.createObjectURL(blob)` → `audio.src` → `audio.play()`.
   - Revoke URL on `ended` / `stop`.
   - Track `playing` via `play`/`pause`/`ended`.

4. Wire Listen 🔊 into `PracticeFullscreen`:
   - Show on every card with a non-empty `speak` field.
   - `data-testid="practice-listen"`.
   - aria-label `"Listen"` idle, `"Stop"` while playing.
   - Hidden (not disabled) when `!supported`.
   - Auto-`stop()` on unmount, on close, on `card.card_id` change.

5. Launch from Today's-path cards in
   `frontend/src/learning/routes/StudentLearningHome.tsx`:
   - Add "Open practice" affordance per practice card (enlarge icon +
     accessible name `Open practice: <skill>`). Click + Enter/Space open
     `PracticeFullscreen` with `exam | classYear | subject` from
     `useLearnerSetup()`.

6. Home hero CTA: if "Start voice tutor" exists, relabel to "Start practice"
   or remove if redundant. Pick the smaller change; explain in summary.

## Hard constraints

- DO NOT modify `VoiceAgentFullscreen.tsx`, `useInsightsVoice`, `useWebRTC`,
  `services/websocket_handler.py`, or anything VoiceLive-related.
- DO NOT modify `backend/src/learning/learner_voice.py` or the
  `/api/learning/voice/turn` route logic.
- TTS provider details must NOT leak into `tts/routes.py` or the FE — only
  `tts/service.py` knows which provider exists. The route imports from
  `tts/service.py` only.
- No feature flags. No new markdown docs.
- Default to zero comments; one short line only when the WHY is non-obvious.

## Verification — all blocks must pass before claiming done

### 1. Backend unit tests
```bash
cd /home/ayoola/sen/voicelive-api-salescoach
/home/ayoola/sen/.venv/bin/python -m pytest \
  backend/tests/unit/test_learning_tts.py \
  backend/tests/unit/test_learner_voice_turn.py -q
```

### 2. Frontend vitest + tsc
```bash
cd /home/ayoola/sen/voicelive-api-salescoach/frontend
npx vitest run \
  src/learning/components/PracticeFullscreen.test.tsx \
  src/learning/__tests__/StudentLearningHome.test.tsx \
  src/learning/__tests__/PathfinderLearnApp.test.tsx
npx tsc -p . --noEmit
```

### 3. New FE test cases (write them, watch them pass)

`PracticeFullscreen.test.tsx`:
- "renders no mic button" — `queryByTestId('practice-mic')` is null AND no
  `queryByLabelText(/microphone/i)`.
- "fetches /api/learning/tts when 🔊 is clicked" — spy `global.fetch` returns
  200 with a Blob; click `practice-listen`; assert fetch called with
  `/api/learning/tts` and body containing the card stem.
- "stops audio on close" — spy `HTMLAudioElement.prototype.pause`; click close;
  assert pause called.
- "hides Listen button when backend returns 503" — fetch resolves 503;
  `practice-listen` is absent.

`StudentLearningHome.test.tsx`:
- "opens PracticeFullscreen from a Today's-path card" — mock
  `PracticeFullscreen`; click first practice card; assert mock rendered with
  taxonomy from form selection.

### 4. Backend live smoke

```bash
pkill -f 'src.app' 2>/dev/null; sleep 1
cd /home/ayoola/sen/voicelive-api-salescoach/backend
nohup env LOCAL_DEV_AUTH=true LOCAL_DEV_USER_ID=dev-learner-001 \
  LOCAL_DEV_USER_EMAIL=learner@localhost LOCAL_DEV_USER_NAME="Dev Learner" \
  LOCAL_DEV_USER_ROLE=learner LOCAL_DEV_USER_PROVIDER=local-dev \
  LEARNER_VOICE_FULLSCREEN_ENABLED=true PUBLIC_APP_URL=http://127.0.0.1:5173 \
  /home/ayoola/sen/.venv/bin/python -m src.app > /tmp/backend.log 2>&1 &
disown
sleep 4 && lsof -ti:8000

curl -s -c /tmp/c.txt -b /tmp/c.txt http://127.0.0.1:8000/api/auth/session > /dev/null

# Taxonomy regression check — must still pass
for body in \
  '{"child_id":"child-f5acbae3aaa8","exam":"JAMB","class_year":"JSS2","subject":"Mathematics"}' \
  '{"child_id":"child-f5acbae3aaa8","exam":"WAEC","class_year":"SSS2","subject":"Mathematics"}'; do
  echo "--- $body ---"
  curl -s -c /tmp/c.txt -b /tmp/c.txt -X POST http://127.0.0.1:8000/api/learning/voice/turn \
    -H 'Content-Type: application/json' -d "$body" \
    | python3 -c 'import sys,json;d=json.load(sys.stdin);c=d.get("card",{});print(c.get("kind"),"|",c.get("skill_id"))'
done

# TTS — without AZURE_SPEECH_KEY, default azure provider must 503
echo "--- TTS 503 (azure, no key) ---"
curl -s -o /dev/null -w 'http=%{http_code} provider=%header{X-TTS-Provider}\n' \
  -c /tmp/c.txt -b /tmp/c.txt -X POST http://127.0.0.1:8000/api/learning/tts \
  -H 'Content-Type: application/json' -d '{"text":"Hello world"}'

# Validation paths
echo "--- TTS 400 empty ---"
curl -s -o /dev/null -w 'http=%{http_code}\n' \
  -c /tmp/c.txt -b /tmp/c.txt -X POST http://127.0.0.1:8000/api/learning/tts \
  -H 'Content-Type: application/json' -d '{"text":""}'

echo "--- TTS 400 too long ---"
curl -s -o /dev/null -w 'http=%{http_code}\n' \
  -c /tmp/c.txt -b /tmp/c.txt -X POST http://127.0.0.1:8000/api/learning/tts \
  -H 'Content-Type: application/json' \
  -d "$(python3 -c 'import json;print(json.dumps({"text":"x"*601}))')"

# Provider swap — flip to google (uninstalled), must still 503 cleanly
echo "--- TTS 503 (google, not installed) ---"
pkill -f 'src.app' 2>/dev/null; sleep 1
nohup env LOCAL_DEV_AUTH=true LOCAL_DEV_USER_ID=dev-learner-001 \
  LOCAL_DEV_USER_EMAIL=learner@localhost LOCAL_DEV_USER_NAME="Dev Learner" \
  LOCAL_DEV_USER_ROLE=learner LOCAL_DEV_USER_PROVIDER=local-dev \
  LEARNER_VOICE_FULLSCREEN_ENABLED=true PUBLIC_APP_URL=http://127.0.0.1:5173 \
  LEARNER_TTS_PROVIDER=google \
  /home/ayoola/sen/.venv/bin/python -m src.app > /tmp/backend.log 2>&1 &
disown
sleep 4
curl -s -c /tmp/c2.txt -b /tmp/c2.txt http://127.0.0.1:8000/api/auth/session > /dev/null
curl -s -o /dev/null -w 'http=%{http_code}\n' \
  -c /tmp/c2.txt -b /tmp/c2.txt -X POST http://127.0.0.1:8000/api/learning/tts \
  -H 'Content-Type: application/json' -d '{"text":"Hello world"}'
```

Expected:
- JAMB+JSS2 → `mark-known | None`
- WAEC SSS2 Math → `mcq-tap | differentiation`
- TTS azure no key → `http=503`
- TTS empty → `http=400`
- TTS 601 chars → `http=400`
- TTS google not installed → `http=503`

Any drift → fix before claiming done.

## Deliverables in final message

- Files added / renamed / modified (paths only) — including the
  `tts/providers/` layout.
- Pytest output (last 10 lines).
- Vitest output (last 10 lines).
- `tsc --noEmit` exit code.
- Curl matrix output verbatim, including both 503 paths.
- One line on home hero CTA decision.

Only call `task_complete` after all four verification blocks are green.
