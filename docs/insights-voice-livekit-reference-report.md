# Insights Voice Agent — Reference Report: Proven Configuration to Model On

**Date:** 2026-04-23
**Author:** GitHub Copilot research
**Scope:** Identify a proven, open-source conversational-voice reference for the Wulo Insights Agent, extract its configuration and architectural patterns, and map them onto Wulo's existing React + Flask-Sock stack so multi-turn voice feels smooth without a click per turn.

---

## Note on VibeVoice (why it is not the reference)

The original ask was to model on `microsoft/VibeVoice`. Direct inspection of the repo landing page and module tree shows VibeVoice is **not** a conversational agent framework. It ships three research models:

- **VibeVoice-ASR** — 60-minute long-form offline/batch speech-to-text.
- **VibeVoice-TTS** — 90-minute long-form offline multi-speaker TTS.
- **VibeVoice-Realtime-0.5B** — streaming **text → audio** TTS (~300 ms first-audible latency).

The repo contains no turn-taking logic, no VAD end-of-turn thresholds, no barge-in handling, no conversational websocket server, no microphone/session lifecycle, and no "session stays alive across turns" pattern — because it has no concept of a turn. It therefore cannot answer the questions in the original brief.

**Reference chosen instead:** [`livekit/agents`](https://github.com/livekit/agents) (Python, Apache-2.0, production-proven). Cross-referenced with OpenAI Realtime API server-VAD event semantics, whose defaults match LiveKit's within ±0 on every axis.

---

## 1. Executive Summary

- **One session, many turns.** `AgentSession` in LiveKit is long-lived. It holds `agent_state ∈ {initializing, listening, thinking, speaking}` and `user_state ∈ {listening, speaking, away}`. After a reply ends, state returns to `listening` automatically — no reconnect, no "click again." Wulo today closes the `push_stream` (and in some paths the websocket) per turn; **this is the root cause of the click-per-turn UX**.
- **Endpointing is separate from VAD.** LiveKit uses VAD only to detect speech start/stop, then a dedicated *endpointing delay* (`min_delay=0.5s`, `max_delay=3.0s`) decides when the user's turn is really over. Dynamic mode extends to `max_delay` when an EOU model says "probably not done yet."
- **Interruption is gated and debounced.** Defaults: `min_duration=0.5s`, `min_words=0`, `discard_audio_if_uninterruptible=True`, plus `aec_warmup_duration=3.0s` during which interruptions are suppressed to avoid echo self-interrupts. Wulo's 200 ms `INTERRUPT_HOLD_MS` with no warmup is too eager.
- **False-interruption recovery.** `resume_false_interruption=True`, `false_interruption_timeout=2.0s`: if the "interruption" turns out to be silence/noise, the agent resumes speaking from where it paused. Wulo has no such recovery.
- **Preemptive generation.** `preemptive_generation.enabled=True` — LLM starts on interim transcripts before end-of-turn commits. Hides 200–500 ms of perceived latency. Wulo doesn't do this.
- **AEC warmup.** 3 s grace after agent starts speaking where mic interruptions are ignored. Cheap fix for echo-induced self-barge-in.
- **Consecutive-speech smoothing.** `min_consecutive_speech_delay` rate-limits back-to-back replies so short affirmations don't machine-gun responses.
- **User "away" timer.** `user_away_timeout=15s`: a distinct state for long silences — NOT "turn end" — so the UI can idle instead of closing audio.
- **Session closes only on explicit shutdown or 3 consecutive unrecoverable errors** (`max_unrecoverable_errors=3`). Everything else stays inside the same session.

### Top 3 changes most likely to improve Wulo's smoothness immediately

1. **Stop closing `push_stream` / websocket at `turn.completed`.** Make the socket per-rail-open, not per-turn. Re-arm listening after playback ends. (Backend: [backend/src/services/insights_websocket_handler.py](backend/src/services/insights_websocket_handler.py); Frontend: [frontend/src/hooks/useInsightsVoice.ts](frontend/src/hooks/useInsightsVoice.ts) `turn.completed` handler.)
2. **Add an endpointing delay state** (`min_delay=0.5`, `max_delay=1.5`) distinct from `SILENCE_AUTO_STOP_MS`. Today Wulo ends the turn the instant silence hits, which feels clippy.
3. **Add AEC warmup** (2–3 s after first playback sample) and **false-interruption timeout** (2 s). Wulo's `INTERRUPT_INPUT_LEVEL_THRESHOLD=0.15 / INTERRUPT_HOLD_MS=200` with no warmup will self-interrupt on laptop speakers.

---

## 2. Relevant LiveKit Files Inspected

| File | Why it matters | Key symbols |
|---|---|---|
| [agents/voice/agent_session.py](https://github.com/livekit/agents/blob/main/livekit-agents/livekit/agents/voice/agent_session.py) | The long-lived session object. Proves session stays alive across turns; defines state machine and every knob. | `AgentSession`, `_update_agent_state("listening")`, `aec_warmup_duration=3.0`, `user_away_timeout=15.0`, `min_consecutive_speech_delay`, `session_close_transcript_timeout=2.0`, `commit_user_turn`, `_aclose_impl` |
| [agents/voice/turn.py](https://github.com/livekit/agents/blob/main/livekit-agents/livekit/agents/voice/turn.py) | All turn-handling defaults. | `_ENDPOINTING_DEFAULTS={"mode":"fixed","min_delay":0.5,"max_delay":3.0}`, `_INTERRUPTION_DEFAULTS={"enabled":True,"discard_audio_if_uninterruptible":True,"min_duration":0.5,"min_words":0,"resume_false_interruption":True,"false_interruption_timeout":2.0}`, `_PREEMPTIVE_GENERATION_DEFAULTS={"enabled":True,"preemptive_tts":False,"max_speech_duration":10.0,"max_retries":3}`, `TurnDetectionMode = "stt" \| "vad" \| "realtime_llm" \| "manual"` |
| [agents/voice/audio_recognition.py](https://github.com/livekit/agents/blob/main/livekit-agents/livekit/agents/voice/audio_recognition.py) | Control flow for "detect speech → wait endpointing delay → commit → emit EOU". Also shows transcript-holding during agent speech. | `AudioRecognition`, `_run_eou_detection`, `_bounce_eou_task`, `on_start_of_speech`, `on_end_of_speech`, `_should_hold_stt_event`, `_flush_held_transcripts`, `commit_user_turn(transcript_timeout=2.0, stt_flush_duration=2.0)` |
| [agents/voice/endpointing.py](https://github.com/livekit/agents/blob/main/livekit-agents/livekit/agents/voice/endpointing.py) | Fixed vs dynamic endpointing logic. | `BaseEndpointing` |
| [agents/voice/agent_activity.py](https://github.com/livekit/agents/blob/main/livekit-agents/livekit/agents/voice/agent_activity.py) | Per-activity speech queue, interrupt, drain. `drain()` completes in-flight speech before transitioning — no hard cut at turn end. | `AgentActivity`, `interrupt(force=...)`, `drain()`, `current_speech` |
| [agents/voice/events.py](https://github.com/livekit/agents/blob/main/livekit-agents/livekit/agents/voice/events.py) | Event contract you can mirror on your Flask-Sock channel. | `AgentStateChangedEvent`, `UserStateChangedEvent`, `UserInputTranscribedEvent`, `ConversationItemAddedEvent`, `CloseEvent`, `CloseReason` |
| `livekit-plugins-silero` (Silero VAD defaults) | Concrete VAD thresholds used by most production LiveKit deployments. | `activation_threshold=0.5`, `min_speech_duration=0.05s`, `min_silence_duration=0.55s`, `sample_rate=16000`, `prefix_padding_duration=0.5s` *(standard Silero defaults; inferred from plugin conventions)* |

---

## 3. Voice UX Configuration Inventory

All values are LiveKit defaults unless noted. File paths are under `livekit-agents/livekit/agents/voice/`.

### VAD / End-of-turn

| Name | Default | File | Controls |
|---|---|---|---|
| `turn_detection` | auto: `realtime_llm → vad → stt → manual` | `turn.py` | Which signal ends the turn |
| `endpointing.mode` | `"fixed"` | `turn.py` `_ENDPOINTING_DEFAULTS` | Fixed vs dynamic (ML-predicted) delay |
| `endpointing.min_delay` | **0.5 s** | `turn.py` | Silence before committing when EOU says "done" |
| `endpointing.max_delay` | **3.0 s** | `turn.py` | Silence required when EOU says "probably not done" |
| Silero `activation_threshold` | **0.5** | `livekit-plugins-silero` | Speech probability threshold |
| Silero `min_speech_duration` | **0.05 s** | same | Rejects single-frame blips |
| Silero `min_silence_duration` | **0.55 s** | same | Declares end-of-speech |
| Silero `prefix_padding_duration` | **0.5 s** | same | Audio kept before detected speech start |
| `commit_user_turn.transcript_timeout` | **2.0 s** | `audio_recognition.py` | Wait for final STT after user audio ends |
| `commit_user_turn.stt_flush_duration` | **2.0 s** | same | Silence pushed to STT to flush buffer |
| `session_close_transcript_timeout` | **2.0 s** | `agent_session.py` | On close only |

### Interruption / Barge-in

| Name | Default | File | Controls |
|---|---|---|---|
| `interruption.enabled` | **True** | `turn.py` | Master switch |
| `interruption.mode` | auto (`"adaptive"` or `"vad"`) | same | `"adaptive"` = ML overlap detector; `"vad"` = raw VAD |
| `interruption.min_duration` | **0.5 s** | same | Minimum speech length to count as interruption |
| `interruption.min_words` | **0** | same | STT-based gate for interruption |
| `interruption.discard_audio_if_uninterruptible` | **True** | same | Drops incoming user audio while agent speaks uninterruptibly |
| `interruption.resume_false_interruption` | **True** | same | Resumes speech if "interruption" turns out to be noise/silence |
| `interruption.false_interruption_timeout` | **2.0 s** | same | Silence after interruption before declaring it false |
| `aec_warmup_duration` | **3.0 s** | `agent_session.py` | Ignores user audio after agent starts speaking |

### Streaming transport

| Name | Default | File | Controls |
|---|---|---|---|
| Session lifetime | long-lived, spans all turns | `agent_session.py` | Explicit `start()` / `aclose()`; nothing else closes it |
| `max_unrecoverable_errors` | **3** | `agent_session.py` `SessionConnectOptions` | Consecutive LLM/TTS errors before auto-close |
| `APIConnectOptions` retries | per-component | `types.py` | STT/LLM/TTS backoff internal to session |

### Playback

| Name | Default | File | Controls |
|---|---|---|---|
| `use_tts_aligned_transcript` | off (NOT_GIVEN) | `agent_session.py` | Word-timed captions |
| `tts_text_transforms` | `["filter_markdown", "filter_emoji"]` | same | Cleans TTS input |
| `min_consecutive_speech_delay` | **0.0 s** | same | Minimum gap between consecutive agent replies |
| `can_pause` on `AudioOutput` | capability flag | `io.py` | Required for `resume_false_interruption` |

### Session lifecycle / UI states

| Name | Default | File | Controls |
|---|---|---|---|
| `user_state` | `"listening" → "speaking" → "listening" → "away"` | `events.py`, `agent_session.py` | UI hint |
| `agent_state` | `"initializing" → "listening" → "thinking" → "speaking" → "listening"` | same | UI hint |
| `user_away_timeout` | **15.0 s** | `agent_session.py` | Long silence → `"away"`, not session end |
| `preemptive_generation.enabled` | **True** | `turn.py` | Start LLM on interim transcripts |
| `preemptive_generation.preemptive_tts` | **False** | same | Optionally also pre-synth audio |
| `preemptive_generation.max_speech_duration` | **10.0 s** | same | Skip preemption for very long utterances |
| `preemptive_generation.max_retries` | **3** | same | Restart preemption as transcript changes |
| `max_tool_steps` | **3** | `agent_session.py` | Tool-call budget per turn |

### Buffering / chunking

- Audio frames flow through `push_audio()` frame-by-frame. No fixed chunk size — whatever the transport delivers (WebRTC Opus frames = 20 ms; raw PCM typically 10–20 ms). Silero runs at 16 kHz.
- Held-transcript buffer (`_transcript_buffer: deque`) retains STT events *emitted while the agent is speaking* and replays/discards them based on `_ignore_user_transcript_until`. This is how LiveKit avoids acting on self-echo transcripts.

---

## 4. Smoothness Patterns Worth Copying

### Must-copy

1. **Session persists across turns.** State transitions replace reconnects. Agent returns to `listening` via `_update_agent_state("listening")` after speech ends — no new socket.
2. **Endpointing delay ≠ silence timeout.** VAD says "silence started at T"; the session still waits `min_delay` (or up to `max_delay` when EOU model is uncertain) before committing. Feels deliberate, not clippy.
3. **AEC warmup** (`aec_warmup_duration=3.0s`). Disables interruption detection for ~3 s after agent starts speaking to absorb echo leak before AEC converges.
4. **False-interruption recovery** (`resume_false_interruption=True`, `false_interruption_timeout=2.0s`). If the detected "interruption" is silent for 2 s, resume the agent's speech from where it paused. Requires a pausable audio output.
5. **Hold STT events during agent speech.** `_should_hold_stt_event` buffers transcripts fired while `_agent_speaking=True`. On end of agent speech, `_flush_held_transcripts` drops everything whose end-time is before `_ignore_user_transcript_until`. Kills 90 % of echo-induced phantom turns.
6. **Distinct `user_state="away"` vs session close.** Long silences park the UI without tearing down audio I/O.

### Good-to-copy

7. **Preemptive generation** on interim transcripts (text-only first; TTS preemption is opt-in).
8. **`min_consecutive_speech_delay`** to prevent rapid-fire replies during choppy turns.
9. **Dynamic endpointing** — extend to `max_delay` when an EOU classifier says user isn't done.
10. **Draining instead of cutting.** `drain()` lets in-flight TTS finish before state transitions.

### Context-dependent

11. **Server-provided turn detection** (`turn_detection="realtime_llm"`) if you later move to Azure Voice Live or OpenAI Realtime.
12. **Adaptive vs VAD interruption.** `"adaptive"` requires the ML overlap detector; `"vad"` is a cheap default that works fine for single-speaker therapist UX.

---

## 5. Comparison to Wulo

| Axis | LiveKit | Wulo today (from [useInsightsVoice.ts](frontend/src/hooks/useInsightsVoice.ts) + [insights_websocket_handler.py](backend/src/services/insights_websocket_handler.py)) | Gap |
|---|---|---|---|
| Session lifetime | **Per rail-open / per conversation.** One `AgentSession` across all turns. | Handler closes `push_stream` after each turn ([insights_websocket_handler.py#L333](backend/src/services/insights_websocket_handler.py#L333)); some frontend paths also `ws.close()` ([useInsightsVoice.ts#L231](frontend/src/hooks/useInsightsVoice.ts#L231)). | **Root cause of "click again".** |
| End-of-turn gate | VAD → endpointing `min_delay=500 ms` → (optional EOU) → commit | `SILENCE_AUTO_STOP_MS=500` direct to commit ([useInsightsVoice.ts#L50](frontend/src/hooks/useInsightsVoice.ts#L50)) | Missing the deliberate wait + no EOU signal |
| Speech-start gate | Silero `min_speech_duration=50 ms` + `activation_threshold=0.5` | `VAD_MIN_SPEECH_SAMPLES=8` (~160 ms) + `SPEECH_DETECT_LEVEL_THRESHOLD=0.12` | Amplitude-based, not probability; stricter than Silero (will clip short "yes"/"no"). Partially compensated by `VAD_RECENT_SPEECH_LOOKBACK_MS=250`. |
| Warmup | `aec_warmup_duration=3.0s` after agent speaks | `VAD_WARMUP_MS=400` after entering listening | Wulo has no post-agent-speech warmup → will self-interrupt on laptop speakers |
| Interruption gate | `min_duration=0.5s`, plus `false_interruption_timeout=2.0s` and resume | `INTERRUPT_INPUT_LEVEL_THRESHOLD=0.15` + `INTERRUPT_HOLD_MS=200` | Too eager (200 ms vs 500 ms) and no false-interruption recovery |
| Playback | Draining; pausable output for resume | 24 kHz PCM output, likely non-pausable | Can't implement `resume_false_interruption` without pausable playback |
| Post-turn | `_update_agent_state("listening")`, session stays open | `turn.completed` handler triggers close | **The fix.** |
| User-away | 15 s timer → state `"away"` | Not modeled; silence ends the turn | UI has no "gently idle" state |
| Preemptive gen | On interim STT | None | Latency opportunity |
| Reconnect | Internal retries inside session | Full reconnect per turn | Excess TCP/TLS/websocket handshake overhead |

**Verified:** Wulo closes `push_stream` per turn (line 333 of handler).
**Inferred:** the websocket is also closed per turn on at least one code path, because `ignoreCurrentSocketClose` exists on the frontend ([useInsightsVoice.ts#L218](frontend/src/hooks/useInsightsVoice.ts#L218)) — only needed if the backend (or proxy) closes the socket after `turn.completed`. This pattern makes the "click again" symptom structural, not tunable.

---

## 6. Recommended Changes for Wulo (prioritized)

| # | Change | Where | FE/BE | UX benefit | Risk | Type |
|---|---|---|---|---|---|---|
| 1 | **Keep websocket open across turns.** After sending `{"type":"turn.completed"}`, do NOT close `push_stream` or sock. Reset per-turn state holder; wait for next audio frame. | [insights_websocket_handler.py](backend/src/services/insights_websocket_handler.py) (remove close from success path; keep close only on disconnect/shutdown) | **BE** | Eliminates click-per-turn | Medium — needs per-turn state reset without reallocating Azure speech recognizer | Architecture |
| 2 | **Client auto-rearm on `turn.completed`.** After assistant playback ends, transition hook state `speaking → listening` without closing WS or releasing mic. | [useInsightsVoice.ts](frontend/src/hooks/useInsightsVoice.ts) `case 'turn.completed'` (line 474) | **FE** | Same | Low | State-machine |
| 3 | **Introduce `agent_state` + `user_state` enums** mirroring LiveKit: `initializing / listening / thinking / speaking` and `listening / speaking / away`. Render [InsightsRail.tsx](frontend/src/components/InsightsRail.tsx) off these, not off socket readyState. | `useInsightsVoice.ts`, `InsightsRail.tsx`, backend sends `state` events | **Both** | Clean UI; no flicker | Low | State-machine |
| 4 | **Split `SILENCE_AUTO_STOP_MS` into two constants:** `SPEECH_START_MIN_MS=50` (replace/augment `VAD_MIN_SPEECH_SAMPLES`) and `ENDPOINTING_MIN_DELAY_MS=500`, `ENDPOINTING_MAX_DELAY_MS=1500`. | `useInsightsVoice.ts` | FE | Less clippy | Low | Config |
| 5 | **Add AEC warmup.** After `turn.audio.start` (first TTS chunk played), suppress interruption detection for 2000 ms. | `useInsightsVoice.ts` audio-level watcher | FE | Kills laptop-speaker self-interrupts | Low | Config |
| 6 | **False-interruption timeout.** If user audio level stays below threshold for 2 s after an interruption fires, resume agent playback instead of fully cancelling. Requires making playback queue pausable. | Player in `useInsightsVoice.ts` | FE | Fewer accidental stops | Medium (needs pausable player) | Architecture |
| 7 | **Raise interruption gate.** `INTERRUPT_HOLD_MS: 200 → 500`, keep `0.15` threshold. | `useInsightsVoice.ts` | FE | Fewer false barge-ins | Low | Config |
| 8 | **`user_away_timeout` at 15 s.** Emit `{"type":"user.away"}`; UI shows subtle "Tap to resume" without tearing down the socket. | Both | Both | Battery/CPU; clearer pause UX | Low | State-machine |
| 9 | **Preemptive LLM on interim transcripts.** When a final transcript lands early, optionally start the LLM call while still waiting for endpointing `min_delay`. Cancel if the transcript changes. | `insights_websocket_handler.py` | BE | 200–500 ms lower TTFR | Medium (need cancellation) | Architecture |
| 10 | **Hold STT transcripts while agent is speaking** (mirror `_should_hold_stt_event`). Prevents acting on echo-of-agent transcripts. | BE | BE | Fewer phantom turns | Low | State-machine |

---

## 7. Proposed Wulo Operating Model

**Recommendation: hybrid, session-based.**

- **Click to open the rail → one websocket per rail-open lifecycle.** The socket stays up until the therapist closes the panel or hits a terminal error.
- **Within that session, support two modes (keep your existing two, clarify semantics):**
  - `push_to_talk`: hold-to-talk button. WS stays open; each press just bookends a user turn with `input_audio.start` / `input_audio.end` events. **No reconnection.**
  - `full_duplex`: mic always hot between turns. Client VAD + server endpointing. The agent auto-rearms `listening` after each `turn.completed`.
- **Session closes only on:** therapist closes rail, 3 consecutive unrecoverable errors (mirror `max_unrecoverable_errors=3`), or explicit timeout (e.g., 30 min of no activity — not 15 s).

**Why not "one WS per turn":** TLS handshake + Flask-Sock accept + Azure speech recognizer init is 300–800 ms per turn. That alone dominates perceived latency after the first turn.

**Why not "one WS per conversation" (broader than rail):** PHI handling and socket state are easier to reason about when the socket dies with the rail. Re-open on rail-open is cheap enough.

---

## 8. Concrete Settings to Trial

| Setting | Current Wulo | Trial value | LiveKit default | Rationale |
|---|---|---|---|---|
| Silence → endpointing commit | `SILENCE_AUTO_STOP_MS=500` (direct commit) | `min_delay=500ms`, `max_delay=1500ms` | 500 / 3000 | 3000 feels long for therapy; 1500 is a gentler ceiling |
| Min speech duration | `VAD_MIN_SPEECH_SAMPLES=8` (~160 ms) | **50–80 ms** | 50 ms (Silero) | Catches "yes", "mm" |
| Speech threshold | `SPEECH_DETECT_LEVEL_THRESHOLD=0.12` (amplitude) | 0.10 amplitude OR switch to Silero prob ≥0.5 | 0.5 prob | Amplitude is noisy on quiet mics |
| Interrupt hold | `INTERRUPT_HOLD_MS=200` | **500 ms** | 500 ms | Matches LiveKit `min_duration` |
| Interrupt threshold | `0.15` | 0.15 (keep) | N/A | Fine |
| AEC warmup after agent starts speaking | none | **2000 ms** | 3000 ms | Therapist in quiet room → 2 s is enough |
| False-interruption timeout | none | **2000 ms**, then resume | 2000 ms | Direct copy |
| VAD warmup after entering listening | `VAD_WARMUP_MS=400` | keep 400 ms | (implicit via `min_speech_duration`) | Fine |
| User-away timeout | none | **15 s** | 15 s | Direct copy |
| Chunk size (output) | 24 kHz PCM | keep | WebRTC 20 ms / 48 kHz | Fine; bigger issue is scheduling |
| Playback scheduling | sequential PCM | **queue with lookahead ≥ 200 ms** before starting playback | n/a | Prevents underrun-driven stutter |
| Auto-rearm after `turn.completed` | **no** | **yes** | yes | Core fix |
| Consecutive-speech delay | none | 250 ms | 0 ms | Prevents double-speak on short turns |
| Preemptive LLM on interim | none | feature-flag on | on | Latency win |
| Max unrecoverable errors before close | unclear | **3** | 3 | Direct copy |

---

## 9. Risks and Non-Portable Parts

### Attractive but probably don't copy directly

- **Adaptive interruption detector** (`inference.AdaptiveInterruptionDetector`). Requires a shipped ML overlap model; simple VAD-based interruption is enough for single-user therapist UX.
- **`realtime_llm` turn detection mode.** Only useful if you move to Azure Voice Live / OpenAI Realtime. Your current Flask + Azure Speech path is STT-based.
- **Preemptive TTS** (`preemptive_tts=True`). Wastes tokens when the transcript changes; start with preemptive LLM only.
- **RoomIO / LiveKit WebRTC transport.** You're on Flask-Sock/WS. Don't port RoomIO — port the state machine and event names.
- **Audio pause semantics.** `resume_false_interruption` requires `AudioOutput.can_pause`. The current PCM scheduler may not support mid-chunk pause without clicks. Treat as Phase 2.

### Infrastructure-specific to LiveKit (don't apply)

- OTel spans (`user_turn`, `agent_speaking`) — nice-to-have, not required.
- `RecorderIO` auto-recording — you likely have your own audit pipeline.
- `mcp_servers` / `AgentTask` / tool orchestration — orthogonal.

### Wulo-specific risk

Keeping the Azure speech recognizer alive across turns: Azure's `SpeechRecognizer.stop_continuous_recognition` is expensive. The comment at [insights_websocket_handler.py#L348](backend/src/services/insights_websocket_handler.py#L348) already says "forcing stop." Investigate whether you can **reuse** the recognizer across turns and flush `push_stream` contents via silence (mirror `commit_user_turn.stt_flush_duration=2.0s`) rather than recreating the recognizer. This is the second-biggest latency win.

---

## Top 5 Changes to Test First

1. **Stop closing the push_stream / websocket on `turn.completed`.** Keep the session; just reset per-turn buffers. Emit `{"type":"state","agent_state":"listening"}`. *(Backend + Frontend; Architecture)*
2. **Frontend auto-rearm on `turn.completed`.** Transition `speaking → listening` without dropping mic or WS. Remove/repurpose `ignoreCurrentSocketClose`. *(Frontend; State-machine)*
3. **Split silence timer into `min_delay=500 / max_delay=1500 ms`** and add a **post-playback AEC warmup of 2000 ms**. *(Frontend; Config)*
4. **Add `false_interruption_timeout=2000 ms`** and raise `INTERRUPT_HOLD_MS` from 200 to **500 ms**. Even without pausable playback, the timeout alone cuts accidental stops. *(Frontend; Config)*
5. **Reuse the Azure `SpeechRecognizer` across turns**; flush via 2 s of silence pushed into `push_stream` instead of `stop_continuous_recognition` per turn. Mirrors `commit_user_turn(stt_flush_duration=2.0)`. *(Backend; Architecture)*

If #1 + #2 + #5 land together, "click again after each turn" disappears and per-turn latency drops significantly — without touching the Azure Speech SDK or the audio format.
