# Phase B — Real two-way learner voice tutor (Azure VoiceLive, scoped)

Repo: `/home/ayoola/sen/voicelive-api-salescoach`
Branch: `feat/pathfinder-learner-voicelive` (cut fresh from `main` after Phase A merges)

## Prerequisites — DO NOT START until all true

- Phase A is merged: `PracticeFullscreen` exists, mic is gone from the tap-only
  surface, Listen 🔊 plays via `/api/learning/tts` with the pluggable provider
  seam (`backend/src/learning/tts/`).
- `/api/learning/voice/turn` still returns the same card vocabulary
  (`greeting | mcq-tap | explanation | progress | mark-known`) and respects
  `exam | class_year | subject` taxonomy.
- Existing VoiceLive practice stack (`useRealtime` → `/ws/voice` →
  `services/websocket_handler.py` → Azure AI VoiceLive) is unmodified and
  still works for current practice/avatar flows.
- Teacher/admin Insights voice (`VoiceAgentFullscreen` + `useInsightsVoice` →
  `/ws/insights-voice` → `services/insights_websocket_handler.py`) is a
  separate Azure Speech STT/TTS stack and must remain unmodified.
- Env available in dev: `AZURE_VOICE_LIVE_ENDPOINT`, credential (key or
  managed identity wired through `build_voicelive_credential`),
  `VOICE_LIVE_MODEL` (default `gpt-5-preview`).

If any prerequisite is false, STOP and report — do not start Phase B.

## Context — read before touching anything

- Admin/teacher Insights Rail voice uses `VoiceAgentFullscreen` +
  `useInsightsVoice` + `/ws/insights-voice`. Do not reuse or repoint that path
  for learner VoiceLive in Phase B.
- Azure VoiceLive bidirectional audio is the existing `/ws/voice` stack:
  frontend `useRealtime` → backend `services/websocket_handler.py`.
- Phase B goal: reuse the `/ws/voice` VoiceLive framing/audio pipeline for
  learners, but add a **learner-scoped agent profile** selected with
  `scope="learner"`: different system prompt, different tool set, different
  conversational guardrails. No new WebSocket protocol, no new audio pipeline.

## Scope — do exactly this, nothing more

### 1. Backend — learner-scoped agent profile

Goal: `services/websocket_handler.py` can boot a VoiceLive session in either
`scope="practice"` (default existing `/ws/voice` behaviour) or
`scope="learner"` (new), picking the correct system prompt + tool set without
forking the file.

**1a. Create `backend/src/services/voice_agent_profiles/`:**

```
voice_agent_profiles/
  __init__.py
  base.py              # AgentProfile dataclass / Protocol
  practice_profile.py  # wrap current /ws/voice behaviour here, no logic change
  learner_profile.py   # new
  registry.py          # get_profile(scope: str) -> AgentProfile
```

**`base.py`** — define an `AgentProfile` Protocol/dataclass with:
- `id: str` (`"practice" | "learner"`)
- `system_prompt: str`
- `tools: list[ToolDef]` (use whatever shape the existing handler already
  passes to VoiceLive `session.update`)
- `voice: str` (e.g. `"en-NG-EzinneNeural"` for learner; keep current for practice)
- `temperature: float`
- `max_response_output_tokens: int`

**`practice_profile.py`** — preserve the EXISTING `/ws/voice` session.update
behaviour, including `AgentManager`/`agent_config` instructions, voice/avatar
overrides, personalization block, phoneme rule, and `finish_session` tool.
Behaviour must be identical (snapshot the assembled `session.update` payload
before/after and diff).

**`learner_profile.py`** — new:
- System prompt: warm, encouraging Nigerian tutor; uses
  `exam | class_year | subject` taxonomy from session context; ALWAYS calls a
  tool to fetch the next card rather than inventing content; never claims to
  see anything the learner hasn't shared; uses simple language; reads MCQ
  options aloud one at a time.
- Tools (thin wrappers over the existing planner — do NOT duplicate logic):
  - `get_next_card(child_id, exam, class_year, subject, prev_card_id?, answer_choice?)`
    → calls into `LearnerVoiceTurnPlanner.next_turn` directly (in-process,
    not over HTTP). Returns the planner's card JSON.
  - `mark_known(child_id, skill_id)` — stub that no-ops for now and returns
    `{"ok": true}` (real spaced-rep wiring is Phase C).
- Voice: `en-NG-EzinneNeural`.
- Temperature: 0.6.

**`registry.py`** — `get_profile(scope: str) -> AgentProfile`. Unknown scope →
raise `ValueError`.

**1b. Modify `services/websocket_handler.py`:**

- Read `scope` query param from the `/ws/voice` upgrade request, default
  `"practice"` for back-compat.
- Call `get_profile(scope)` and use it to assemble the VoiceLive
  `session.update` (system prompt, tools, voice, temp).
- Route tool calls through the profile's tool handlers. For `scope="learner"`,
  `get_next_card` must invoke `LearnerVoiceTurnPlanner.next_turn` with the
  taxonomy from connection context — same gate (`_VALID_EXAMS_FOR_CLASS`)
  applies, so invalid combos return `mark-known` cards.
- DO NOT change the WebSocket framing, auth, or VoiceLive credential
  acquisition. Only the agent profile changes per scope.

**1c. Auth for `scope="learner"`:**

- Allowed roles: `learner` (primary), `teacher`/`admin` (for demoing).
- Reuse the same session-cookie / JWT decorator the existing `/ws/voice`
  handler uses.
- Preserve current `scope="practice"` auth behaviour for existing practice
  flows. If a `learner` user opens any staff/admin-only route such as
  `/ws/insights-voice`, keep returning 403/4403. If a `learner` user opens
  `/ws/voice?scope=learner`, allow.

### 2. Backend tests — `backend/tests/unit/test_voice_agent_profiles.py`

- `get_profile("practice")` returns a profile whose system prompt and tool names
  match the snapshot of the pre-refactor handler output (golden-file test of
  the assembled `session.update` shape; mock VoiceLive SDK so nothing
  connects).
- `get_profile("learner")` returns a profile with:
  - `id == "learner"`
  - `voice == "en-NG-EzinneNeural"`
  - tool names include `get_next_card` and `mark_known`
- `get_profile("nope")` raises `ValueError`.
- Tool-call routing: invoke `get_next_card` via the profile's handler with
  `exam="JAMB", class_year="JSS2", subject="Mathematics"` and assert the
  returned card has `kind == "mark-known"` (taxonomy gate still applies
  because the handler delegates to the real planner).
- Tool-call routing: `exam="WAEC", class_year="SSS2", subject="Mathematics"`
  → `kind == "mcq-tap"` and `skill_id == "differentiation"`.

Use the existing test fixtures that already test `LearnerVoiceTurnPlanner`
(13 passing tests in `test_learner_voice_turn.py`) — do not duplicate them.

### 3. Frontend — generalize the realtime fullscreen + learner entry point

**3a. Add learner VoiceLive connection params without touching Insights voice:**

Do **not** generalize or repoint `VoiceAgentFullscreen` / `useInsightsVoice`.
Those remain the admin/teacher Insights Rail path on `/ws/insights-voice`.

For learners, use the existing VoiceLive client plumbing that targets
`/ws/voice` (`useRealtime`) or a thin learner-specific wrapper around the same
framing/audio code. Append `?scope=learner&child_id=...&exam=...&class_year=...&subject=...`
to the `/ws/voice` URL.

**3b. Add `frontend/src/learning/components/LearnerTutorFullscreen.tsx`:**

- Thin learner VoiceLive fullscreen that opens `/ws/voice?scope=learner...`.
- Accepts `open, onClose, exam, classYear, subject, childId`.
- Passes taxonomy into the WS connection params (the backend reads them and
  forwards into the learner profile's tool handler context).
- Reuses `VoiceAgentDynamicSurface` to render the cards the learner profile
  emits via tool output (planner's existing card JSON renders unchanged).
- data-testid `learner-tutor` on the dialog root.

**3c. Entry points:**

- On `PracticeFullscreen`, add a single secondary button "🎙️ Talk to tutor"
  next to the Listen button. data-testid `practice-talk`. Clicking opens
  `LearnerTutorFullscreen` for the SAME taxonomy and child.
- On `StudentLearningHome`, add an explicit "Talk to your tutor" CTA in the
  hero area (replaces whatever generic "Start practice" remained from Phase A
  if redundant — pick the smaller change and explain in the summary).

**3d. Permission UX:**

- The first time the learner opens `LearnerTutorFullscreen`, request mic
  permission via the existing VoiceLive recorder flow. If denied, show inline
  copy: "Tutor needs your microphone to listen. Tap 🔊 Listen on cards
  instead." and `onClose()` after 4s. Do NOT silently fail.

### 4. Frontend tests

`LearnerTutorFullscreen.test.tsx`:
- Renders with `scope="learner"` and forwards `exam | classYear | subject`
  into the `/ws/voice` connection params (mock the learner VoiceLive hook or
  `useRealtime`; assert the call
  args).
- Renders the dynamic surface with a card payload that came back from a
  mocked tool result (`kind=mcq-tap`).
- Shows the mic-denied fallback copy when the learner VoiceLive recorder reports
  `permission: 'denied'`.

`PracticeFullscreen.test.tsx` (additions):
- "Talk to tutor button opens LearnerTutorFullscreen" — mock the import;
  click `practice-talk`; assert mock rendered with the same taxonomy props.

`VoiceAgentFullscreen` / `useInsightsVoice` regression:
- Admin/teacher Insights Rail still opens `/ws/insights-voice` unchanged.

## Hard constraints

- DO NOT change the VoiceLive WebSocket framing, audio pipeline, credential
  acquisition, or `useRealtime`/recorder internals. Phase B is profile + scope routing
  only.
- DO NOT duplicate `LearnerVoiceTurnPlanner` logic in the tool handler — the
  tool MUST call `next_turn` directly.
- DO NOT touch `/api/learning/voice/turn` or `/api/learning/tts` routes.
  Tap-only surface and Listen 🔊 must keep working unchanged.
- DO NOT rename or repoint existing admin/teacher call sites of
  `VoiceAgentFullscreen` or `useInsightsVoice`.
- No feature flags. No new markdown docs.
- Default to zero comments; one short line only when the WHY is non-obvious.

## Verification — all blocks must pass before claiming done

### 1. Backend unit tests
```bash
cd /home/ayoola/sen/voicelive-api-salescoach
/home/ayoola/sen/.venv/bin/python -m pytest \
  backend/tests/unit/test_voice_agent_profiles.py \
  backend/tests/unit/test_learner_voice_turn.py \
  backend/tests/unit/test_learning_tts.py -q
```

### 2. Frontend vitest + tsc
```bash
cd /home/ayoola/sen/voicelive-api-salescoach/frontend
npx vitest run \
  src/learning/components/PracticeFullscreen.test.tsx \
  src/learning/components/LearnerTutorFullscreen.test.tsx \
  src/learning/__tests__/StudentLearningHome.test.tsx \
  src/learning/__tests__/PathfinderLearnApp.test.tsx \
  src/learning/components/VoiceAgentFullscreen.test.tsx
npx tsc -p . --noEmit
```

### 3. Backend live smoke (regression-only — VoiceLive WS not exercised)

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

# Tap surface must still answer correctly (no Phase A regression)
for body in \
  '{"child_id":"child-f5acbae3aaa8","exam":"JAMB","class_year":"JSS2","subject":"Mathematics"}' \
  '{"child_id":"child-f5acbae3aaa8","exam":"WAEC","class_year":"SSS2","subject":"Mathematics"}' \
  '{"child_id":"child-f5acbae3aaa8","exam":"Junior WAEC","class_year":"JSS2","subject":"Basic Science"}'; do
  echo "--- $body ---"
  curl -s -c /tmp/c.txt -b /tmp/c.txt -X POST http://127.0.0.1:8000/api/learning/voice/turn \
    -H 'Content-Type: application/json' -d "$body" \
    | python3 -c 'import sys,json;d=json.load(sys.stdin);c=d.get("card",{});print(c.get("kind"),"|",c.get("skill_id"))'
done

# TTS still hidden when no Azure key (Phase A invariant)
echo "--- TTS 503 (no key) ---"
curl -s -o /dev/null -w 'http=%{http_code}\n' \
  -c /tmp/c.txt -b /tmp/c.txt -X POST http://127.0.0.1:8000/api/learning/tts \
  -H 'Content-Type: application/json' -d '{"text":"Hello"}'
```

Expected:
- JAMB+JSS2 → `mark-known | None`
- WAEC SSS2 Math → `mcq-tap | differentiation`
- Junior WAEC JSS2 Basic Science → `mcq-tap | energy-sources`
- TTS no key → `http=503`

### 4. Manual VoiceLive smoke (only if creds are present)

If `AZURE_VOICE_LIVE_ENDPOINT` is configured in dev:

1. Start FE (`pnpm dev` or equivalent), open as a `learner` role user.
2. Open `PracticeFullscreen` for `WAEC / SSS2 / Mathematics`. Click
   `🎙️ Talk to tutor`. Grant mic permission.
3. Say "Give me a question." Expect the tutor to call `get_next_card` and
   read out the differentiation MCQ in Nigerian English.
4. Pick the existing admin/teacher Insights Rail flow and confirm
  `/ws/insights-voice` still works with the original prompt/tools.
5. Try a `learner`-role user hitting `/ws/insights-voice` — must 403/4403.

Record outcomes in the deliverables section. If creds are absent, mark this
section "skipped — no VoiceLive creds in env" and ensure sections 1–3 are
green.

## Deliverables in final message

- Files added / renamed / modified (paths only) — including the
  `voice_agent_profiles/` layout and the `LearnerTutorFullscreen` component.
- Pytest output (last 10 lines).
- Vitest output (last 10 lines).
- `tsc --noEmit` exit code.
- Curl matrix output verbatim.
- Manual VoiceLive smoke results or explicit "skipped — no creds".
- One line on what changed in `StudentLearningHome` hero (CTA decision).

Only call `task_complete` after all four verification blocks are accounted for
(green or explicitly skipped with reason).

## Out of scope (do NOT do in Phase B)

- Spaced-repetition / mastery storage (`mark_known` stays a no-op stub).
- New planner content. Phase B uses the existing 45-item bank.
- Replacing VoiceLive with another vendor. (If you want vendor-agnostic
  realtime later, that is Phase D — extract a `RealtimeVoiceProvider`
  Protocol mirroring the Phase A TTS seam.)
- UI restyling beyond the new buttons and the mic-denied fallback copy.
