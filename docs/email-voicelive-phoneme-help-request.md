**Subject:** Voice Live API — guidance needed on deterministic phoneme pronunciation (/θ/, /ɹ/) for paediatric speech-therapy listening drills

Hi [Name],

I'm building Wulo — an Azure-hosted speech-therapy practice app for children. The avatar is driven by **Voice Live API** (real-time WebRTC, with `response.create` + lipsynced audio). It works beautifully for free conversation, but **listening exercises are failing on the one thing they must get right: deterministic, child-safe pronunciation of the target phoneme.**

I'd value 30 minutes of your time, or pointers to the right doc / preview feature. Two concrete failure modes:

**1. Long-vowel mispronunciation of short monosyllables.** In a TH-vs-F minimal-pair drill (`thin/fin`, `thorn/fawn`, `three/free`), the avatar pronounces `fin` as `/faɪn/` ("fine"), `thin` as `/ðaɪn/` ("thine"), inconsistently across turns and carrier phrases. The drill is therefore acoustically wrong — the child hears the wrong vowel, not the contrast we're testing.

**2. Hallucinated targets.** On the same drill the avatar occasionally speaks a word that isn't in the pair metadata at all (e.g. "thick" while the UI shows `thorn/fawn`). This tells us `response.create.instructions` is being interpreted as an LLM prompt, not as a TTS string — the model paraphrases and substitutes plausible-sounding TH words.

Same is true on the `/r/` side (e.g. `red rocket` corpus): /ɹ/ rendering drifts toward /w/-coloured or rhotacised long-vowel variants depending on neighbouring context.

### What we've already tried and ruled out

| # | Approach | Outcome |
|---|---|---|
| 1 | SSML `<phoneme alphabet="ipa" ph="θ"> / "fɪn"</phoneme>` inside `response.create.instructions` | Avatar reads the XML tags aloud verbatim ("phoneme alphabet IPA…"). |
| 2 | Phonetic-onset sentinels in plain text (`fff-in, fin`, `thh-in, thin`) | Locks the short vowel reliably — but children find it robotic; rejected on UX grounds. |
| 3 | Carrier-phrase rewording (`Listen carefully…`, `I said fin.`, `The word is fin.`) | Non-deterministic; same word pronounces differently turn-to-turn. |
| 4 | `AZURE_CUSTOM_LEXICON_URL` (PLS XML) wired into our backend `/api/tts` REST path via `wrap_as_ssml(..., lexicon_uri=...)` | Works perfectly on the REST channel (we use it for image-tap audio). **Has no observable effect on the Voice Live avatar narration channel** — same `fin → fine` regression. We can't tell whether Voice Live ignores the session-level lexicon or whether we're attaching it on the wrong field. |
| 5 | Strict instruction prompt: `"Say exactly the following text verbatim in one turn, with no extra words: …"` | Reduces but does not eliminate paraphrase; hallucinated targets (item 2 above) still occur. |
| 6 | Lowering session `temperature` and tightening the system prompt | Marginal improvement; paraphrase persists. |
| 7 | Pseudo-spelling / anchor-word fallback (`thh`, `think`; `rrr`, `rabbit`) for the *child's* mic-side ASR (OpenAI Realtime transcription returns nothing for isolated /θ/, /ɹ/) | Workable mitigation on the recognition side, but doesn't address the avatar's *production* problem. |
| 8 | Lengthening continuants with the IPA length marker `ː` (`θː`, `ɹː`) on the REST channel | Improves perceptual clarity in isolation; not viable for the avatar narration channel because of (1). |

The lexicons, IPA map, and reproduction notes live in:

- `data/lexicons/phoneme-map.json` — canonical sound→IPA bindings
- `frontend/src/utils/phonemeSsml.ts` — strategy router (ipa / pseudo / anchor)
- `docs/listening-drill-tts-debug-prompt.md` — full repro for items 1–4 with paired outbound/inbound transcripts
- `docs/session-listening-eval-rl-stage0-and-drill-polish-2026-04-21.md` §3.2 — onset-sentinel workaround
- `docs/session-sound-isolation-phoneme-fix-2026-04-10.md` — recognition-side mitigations

### What I'd like your help with

Specifically, can you confirm or point me at:

1. **Is there a verbatim / pre-rendered TTS mode on Voice Live** that bypasses the LLM turn? Either `modalities: ['audio']` with authored SSML/audio, an `audio.speak` style endpoint, or an "input audio with lipsync re-render" mode?
2. **How do I attach a custom PLS lexicon at the Voice Live session level** so it influences avatar narration the way it influences plain Speech TTS? (Field name, attachment shape, regional availability.)
3. **Recommended `voice` / model deployment / `temperature` / system-instructions configuration** for deterministic short-vowel rendering of monosyllables and crisp /θ/, /ð/, /ɹ/ in connected speech.
4. **Custom Neural Voice / fine-tuning** — is it on the roadmap for Voice Live avatars, and is paediatric phoneme clarity a supported scenario?
5. Any **preview features or private flights** we could opt into for clinical / health-adjacent use cases.

Happy to share live session traces, the exact `session.update` payload we send, and read-only access to the staging environment if useful.

Thanks very much,
Ayoola
