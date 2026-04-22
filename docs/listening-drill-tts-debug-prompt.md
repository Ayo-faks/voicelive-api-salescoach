# Debug prompt — Listening Minimal-Pairs drill: avatar hallucinates words & mispronounces `fin`

**Audience:** a fresh coding-agent session (Claude/Copilot) with workspace access to
`/home/ayoola/sen/voicelive-api-salescoach` and the Azure MCP tools enabled.

**Mission:** root-cause and fix two concrete, reproducible bugs in the child-facing
Listening Minimal-Pairs drill. Do not speculate — read the code, read the Voice Live
docs via the Azure MCP, and produce a working fix validated by tests AND by a manual
browser check.

---

## 1. Reproduction (ground truth from live manual test on 2026-04-21)

The exercise is "Listen for TH or F". The UI shows a 2-image pair grid (e.g. `thin` /
`fin`, `thorn` / `fawn`, `three` / `free`). The child hears an avatar say a prompt,
taps one image, hears praise or retry, and advances.

Live capture of what the avatar actually said across a 12-turn session:

```
Listen carefully. The word is thin. Tap the matching picture.        [correct pair shown: thin / fin]
→ (child taps thin)
Great listening. The word is thin.
Listen carefully. The word is three. Tap the matching picture.       [pair shown: three / free]
→ (child taps three)
Great listening. The word is three.
Listen carefully. The word is thorn. Tap the matching picture.       [pair shown: thorn / fawn]
→ (child taps thorn)
Great listening. The word is thorn.
Listen carefully. The word is thick. Tap the matching picture.       ← BUG 1: "thick" is NOT in pairs
```

### Bug 1 — Avatar hallucinates words not in the pair metadata

The drill metadata only contains pairs like `thin/fin`, `three/free`, `thorn/fawn`.
The word `thick` is not any image label and not in the pair list. Yet the avatar
spoke `The word is thick.` while the UI still rendered the correct pair's images.
This means the avatar is **generating its own prompt** instead of reading the exact
text the frontend sent via `response.create.instructions`.

### Bug 2 — `fin` pronounced as `/faɪn/` (rhymes with "fine")

When the avatar says `Listen carefully. The word is fin. Tap the matching picture.`,
the word `fin` is vocalised as `fain` (long /aɪ/ vowel) — the long-vowel lexical
neighbour "fine". The short-vowel `/fɪn/` is needed.

**Notable data point:** when the same word sits in the praise sentence
(`Great listening. The word is fin.`) it sometimes pronounces correctly; when the
praise was previously phrased `You picked fin.` it *always* pronounced correctly.
Pronunciation is inconsistent across carrier phrases and across sessions.

Previous attempts that did NOT fix Bug 2:
- SSML `<phoneme alphabet="ipa" ph="fɪn">fin</phoneme>` wrapper — Voice Live read the
  tags verbatim aloud.
- Phonetic-onset sentinel `fff-in, fin` — robotic UX, user rejected.
- Carrier-phrase rewording: `Listen carefully to the word. fin.` / `I said fin.` /
  `The word is fin.` — each gave different results on different turns.

The REST `/api/tts` endpoint in phoneme mode was already switched on for image-tap
sample playback and `audioCache` prefetch (commit before this prompt), and that path
IS pronouncing `fin` correctly. Bug 2 is specifically on the **avatar narration
channel**.

---

## 2. Hypothesis (needs verification)

Both bugs are consistent with a single root cause: the "speak exact text verbatim"
path in `App.tsx` is not actually a TTS — it's a prompt handed to the avatar's LLM
which then generates its own spoken response. The LLM:

- obeys the *intent* (announce a word, praise, retry) but paraphrases,
- applies its own pronunciation prior to any word that isn't anchored in a lexicon,
- occasionally substitutes a word it thinks fits the exercise context (hence
  `thick` — a plausible TH-word it invented).

If this hypothesis is correct, **no amount of prompt engineering on the instruction
string can fix either bug**. The only fixes are:

- **(Option A — recommended)** Bypass Voice Live for listening prompts. Use the
  REST `/api/tts` endpoint (already wired, already works for image-tap audio) for
  the entire narration, not just the target word clip. The trade-off is that the
  avatar's mouth won't animate to the REST-synthesized audio — which is acceptable
  for listening practice where the child is focused on the image grid anyway.

- **(Option B)** Find the correct Voice Live API configuration that makes
  `response.create` genuinely verbatim (some strict-speak flag, or a different
  endpoint/message type, or an audio-input mode where we upload pre-synthesized
  audio and ask the avatar to play it as-is with lipsync). This needs Azure MCP
  research. If such a mode exists, we keep the avatar lipsync AND get deterministic
  pronunciation.

- **(Option C)** Custom-voice / custom-lexicon path on Voice Live itself (if
  Voice Live supports a lexicon URI config). Same win as B if it exists.

---

## 3. Files you MUST read before proposing a fix

Read the full file, not just the cited lines — context matters.

### Frontend
- `frontend/src/app/App.tsx`
  - `speakExerciseText` callback (around L2614). This is the current Voice Live
    "say verbatim" path. The current implementation literally writes:
    `instructions: "Say exactly the following text verbatim in one turn, with no extra words: ${trimmedText}"`
    and sends `response.create` with `modalities: ['audio', 'text']`. That is a
    **prompt**, not TTS. Verify this is indeed what's happening.
- `frontend/src/components/ListeningMinimalPairsPanel.tsx`
  - `buildInstruction`, `buildPraiseText`, `buildRetryText`, `buildRevealText` — the
    strings being sent.
  - `speakWord`, `playWord`, `synthesizeWord`, `audioCache` — the REST `/api/tts`
    path that IS working correctly for phoneme-clamped word audio.
- `frontend/src/services/api.ts`
  - `api.synthesizeSpeech` — the REST client. Supports `{ text }`, `{ ssml }`, or
    `{ phoneme, alphabet, fallback_text, voiceName }`.
- `frontend/src/utils/drillTokens.ts`
  - `getDrillWordIpa`, `getDrillWordSsml`, `DRILL_WORD_IPA` (30-word map covering
    all drill targets and minimal-pair partners).

### Backend
- `backend/src/app.py` lines 2157-2289 — `/api/tts` route. Accepts `text`, `ssml`,
  or `phoneme`+`alphabet`+`fallback_text`. Phoneme mode wraps via
  `wrap_as_ssml(..., lexicon_uri=config['azure_custom_lexicon_url'])` so custom
  lexicon is honoured. Returns base64 MP3.
- `backend/src/services/tts_normalizer.py` — `normalize_for_tts` with
  `_EXISTING_PHONEME` masking (masks `<phoneme>` blocks before grapheme→SSML
  rewrites, so pre-wrapped SSML is preserved).
- `backend/src/services/websocket_handler.py` line ~684 — where SSML is forwarded
  on the articulation-drill Voice Live path. Confirm whether that channel is
  different from the `response.create.instructions` path used by
  `speakExerciseText`.

### Config / infra
- `backend/.env` / `azd env` — `AZURE_CUSTOM_LEXICON_URL` (is it set? is the blob
  reachable? does it include `fin`, `thin`, `thorn`?).
- `backend/alembic/` and `backend/src/data/lexicons/` — where the custom lexicon
  is defined.

### Tests
- `frontend/src/components/ExercisePanels.test.tsx` — 9 listening-panel tests,
  currently all passing. Any fix must keep these green.
- `frontend/src/utils/drillTokens.test.ts` — drill-token unit tests.

### Docs (previous investigation)
- `docs/session-listening-eval-rl-stage0-and-drill-polish-2026-04-21.md` — the
  sprint retrospective. Section §4.7 notes the TTS-preview test drift and the
  historical context on the `fff-in, fin` sentinel.

---

## 4. Required investigation steps

Execute each step in order. Do not skip to implementation until steps 1–4 are done
and you can state each answer with evidence.

### Step 1 — Confirm the Voice Live channel semantics
Use the Azure MCP tools to pull the **authoritative** Voice Live API reference.
Search for:
- `mcp_azure_foundry` / `mcp_azure_documentation` queries: "Voice Live API
  response.create instructions verbatim speak TTS", "Voice Live say exact text
  without LLM paraphrase", "Voice Live custom lexicon", "Voice Live SSML support",
  "Voice Live pronunciation control".
- The Voice Live endpoint URL we're connecting to (grep backend for
  `voicelive`, `voice-live`, `api_version`, `deployment_name`).
- Whether Voice Live has a `speech.tts` or `audio.speak` path distinct from the
  conversational `response.create` path.
- Whether Voice Live supports `modalities: ['audio']` with a `content` field
  containing pre-authored text+SSML that bypasses the LLM turn.

**Deliverable:** a 3-paragraph summary of what `response.create.instructions` does
vs what we need, with doc citations. State definitively whether Voice Live has a
verbatim-TTS mode and if so, how to invoke it.

### Step 2 — Instrument and capture the Voice Live exchange
- Add a temporary `console.log` in `speakExerciseText` that logs the exact JSON
  sent to Voice Live, prefixed with `[speakExerciseText →]`.
- Add a temporary log in the WebSocket `onMessage` handler that logs every inbound
  `response.*` event (especially `response.audio_transcript.delta`,
  `response.done`) with a `[VL ←]` prefix.
- Start backend + frontend, open the listening drill, run through 3 turns.
- Capture the logs. The first bug is falsified or confirmed by comparing the
  outbound `instructions` text to the inbound `response.audio_transcript.delta`
  text. If inbound text ≠ outbound text → hypothesis confirmed (LLM paraphrase).

**Deliverable:** the paired log excerpt showing outbound vs inbound text for at
least 3 turns, including at least one "thick"-style hallucination or one `fain`
pronunciation.

### Step 3 — Check the Voice Live session config
- Find where the Voice Live session is created/configured (grep for
  `session.update`, `instructions`, `voice`, `temperature`).
- Record:
  - System `instructions` set on `session.update`.
  - `temperature` value (a non-zero temp will cause the paraphrase/hallucination).
  - `voice` / `voice_name`.
  - Any `output_audio_format` settings.
- The session-level system prompt likely tells the avatar "you are a speech buddy
  who helps the child practice TH/F words" — which is exactly why it felt free to
  invent "thick".

**Deliverable:** the session.update payload verbatim, with a note on which fields
are likely causing the paraphrase (esp. temperature and system instructions).

### Step 4 — Check the custom lexicon status
- Is `AZURE_CUSTOM_LEXICON_URL` set in the active azd env
  (`azd env get-values --environment salescoach-swe`)?
- Fetch the lexicon XML. Does it contain entries for `fin`, `thin`, `thorn`,
  `three`, `sin`, `tin`, `pin` with short-vowel IPA?
- If not: the lexicon is the real deterministic fix (for both the REST path AND,
  if Voice Live supports it, the avatar path).

**Deliverable:** the lexicon URL, the word entries for our drill corpus, and a
pass/fail on whether each drill word has an override.

---

## 5. Acceptance criteria for the fix

A fix is acceptable if and only if:

1. **Bug 1 gone:** across 20 consecutive listening turns, every spoken prompt
   contains exactly one target word and that word equals `promptWord` (i.e. one of
   the two labels on the visible image pair). No hallucinated words. Verified by
   either (a) log-diff between outbound-intended-text and inbound-transcript, or
   (b) manual listening with the tester checking the image pair vs audio.

2. **Bug 2 gone:** `fin`, `thin`, `sin`, `tin`, `pin`, `bin`, `win`, `din` all
   pronounce with the short `/ɪ/` vowel in all four contexts (instruction, praise,
   retry, reveal) on three separate sessions. No more `fain`/`thine`/etc.

3. **UX unchanged:** no robotic pauses, no spelled-out sentinels, single-pass
   utterances, instruction < 3s.

4. **Tests:** `npx vitest run` — all 9 listening-panel tests stay green, and any
   new logic has test coverage.

5. **No regressions:** articulation drill (custom-lexicon path) still works;
   session launch / cancel / complete flows untouched.

---

## 6. Implementation options — pick based on Step 1 findings

### If Voice Live has a verbatim-speak / pre-rendered-audio mode
Use it. Keep avatar lipsync. Rewire `speakExerciseText` to call that mode. The
backend phoneme SSML will flow through and pronunciation will clamp. Update the 9
listening tests to match the new payload shape.

### If Voice Live is LLM-only on this endpoint (expected)
Option A — the surgical fix:
- Swap the listening panel's narration off `onSpeakExerciseText` entirely. Use
  `api.synthesizeSpeech({ ssml: "…" })` or `{ text: "…" }` with the target word
  in phoneme mode. The backend SSML path already clamps pronunciation.
- Accept that the avatar video won't lipsync during listening prompts. Show a
  subtle "Listening prompt" indicator (a speaker icon) so it doesn't feel broken.
- Keep `onSpeakExerciseText` for the avatar's intro/outro (where lipsync matters
  and paraphrase is acceptable).

Option B — a hybrid:
- Voice Live speaks the framing (`Listen carefully.` / `Tap the matching
  picture.`) with lipsync.
- REST `/api/tts` inserts the phoneme-clamped target word between the two Voice
  Live utterances. UX: brief pause while audio switches channels.
- Requires careful audio-gap timing so it doesn't feel chopped. The test-file
  restructure is significant but previously attempted; revisit with cleaner test
  helpers.

Option C — temperature=0 on the session and a stricter system prompt:
- Worth trying in parallel with A/B but historically insufficient; paraphrase
  persists even at temp=0 because the instruction is still LLM-routed.

---

## 7. Out of scope for this prompt

- Do NOT rewrite the articulation drill. It already works through a custom-lexicon
  path.
- Do NOT change `SessionLaunchOverlay`, `SessionScreen`, or navigation logic.
- Do NOT touch the 4 pre-existing TTS-preview failing tests (flagged in retro §4.7
  as API signature drift, unrelated).

---

## 8. Handoff checklist before you close the task

- [ ] Step 1 docs summary posted with citations
- [ ] Step 2 log paired excerpt showing Bug 1 mechanism
- [ ] Step 3 session.update payload captured
- [ ] Step 4 lexicon contents verified
- [ ] Root cause stated in one sentence ("the bug is caused by X because Y")
- [ ] Fix implemented per §6
- [ ] All listening-panel tests green (`npx vitest run src/components/ExercisePanels.test.tsx`)
- [ ] Manual 20-turn browser test: zero hallucinations, zero long-vowel mispronunciations
- [ ] Short summary posted with files touched and commands used
