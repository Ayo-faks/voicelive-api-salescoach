# Azure support form — Voice Live phoneme pronunciation

## 1. Describe the issue

We are using **Azure AI Voice Live API** (real-time WebRTC avatar with `response.create` + lipsynced audio) as the spoken voice of a paediatric speech-therapy practice app. In our **listening minimal-pair drills** (e.g. `thin/fin`, `thorn/fawn`, `three/free`, `red/wed`) the avatar fails on two reproducible behaviours that make the drills clinically unusable:

1. **Isolated phonemes spoken as letter names.** When an exercise opens and the avatar is asked to model the target sound on its own, it says the **letter name** instead of the **phoneme** — `/θ/` is voiced as "tee aitch", `/ɹ/` as "ar", `/ʃ/` as "ess aitch", `/f/` as "eff", and so on across every phoneme family. This is the most common failure: it happens at the start of essentially every articulation and listening exercise where the buddy is supposed to demonstrate the sound. Clinically it is unusable — the child hears English orthography, not the target articulation.
2. **Non-deterministic pronunciation of short monosyllables.** `fin` is rendered as `/faɪn/` ("fine"), `thin` as `/ðaɪn/` ("thine"), inconsistently across turns and carrier phrases — so the child hears the wrong vowel, not the /θ/–/f/ contrast we are testing.
3. **Hallucinated targets.** The avatar occasionally speaks a word that is not in the pair metadata at all (e.g. "thick" while the UI shows `thorn/fawn`), indicating that `response.create.instructions` is being treated as an LLM prompt rather than a verbatim TTS string and is paraphrasing.

The same class of failure appears on /ɹ/ targets (drift toward /w/-coloured or rhotacised long-vowel variants depending on context, and "ar" / "are" when produced in isolation). Workarounds we have already tried and ruled out: inline `<phoneme alphabet="ipa" ph="…">` SSML (read aloud as XML), phonetic-onset sentinels like `fff-in, fin` (works but is robotic and rejected on UX grounds for children), carrier-phrase rewording, lowering `temperature` and tightening the system prompt, and attaching a custom **PLS lexicon via `AZURE_CUSTOM_LEXICON_URL`** — the lexicon works on our standard Speech REST `/api/tts` channel but has **no observable effect on the Voice Live avatar narration channel**. We need authoritative guidance on (a) whether Voice Live exposes a verbatim / pre-rendered TTS mode that bypasses the LLM turn while keeping lipsync, (b) how to attach a custom PLS lexicon at the Voice Live session level, and (c) recommended voice / deployment / session-config settings for deterministic short-vowel and /θ/, /ð/, /ɹ/ rendering.

## 2. How will the solution move you forward?

Deterministic, child-safe phoneme rendering is the gating requirement for our entire **listening-drill product line** — minimal pairs, auditory bombardment, sound isolation, and two-word phrase modelling — which together cover Stages 0–6 of our clinical progression and are the exercises speech-and-language therapists rely on most for early-years intervention. With it, we can:

- Have the avatar **model the actual phoneme** (`/θ/`, `/ɹ/`, `/ʃ/`, `/f/` …) at the start of every exercise instead of spelling out the letter name ("tee aitch", "ar"). Sound modelling is the first beat of every clinical exercise; if it is wrong, nothing downstream is salvageable.
- Ship listening drills to clinic and home users with confidence that the acoustic target is correct on every turn (no `fin → fine`, no hallucinated TH words), so therapists can trust the tool as an unsupervised practice surface between sessions.
- Use the resulting clean audio as the **reward signal** for our listening-evaluation RL loop (we already capture per-token votes); right now the noise floor from mispronunciations contaminates that signal and blocks the training set.
- Retire the brittle workarounds (onset sentinels, REST-channel audio splicing, manual fallback buttons) that currently exist purely to mask the avatar's pronunciation drift, and consolidate on a single Voice Live narration path with full lipsync — the experience parents and children expect from an "AI buddy".
- Expand to additional target sounds and to non-English locales without re-engineering each phoneme family by hand.

In short, fixing this unblocks the clinical credibility, the data quality, and the roadmap of the product simultaneously.
