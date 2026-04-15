# Exercise Taxonomy, Image Asset Spec & Gap Analysis

Based on the Peterborough "Steps to Speech" Intervention Pack mapped against the current SpeakBright exercise model.

---

## Part 1: Concrete Exercise Taxonomy (Step by Step)

Each step below defines a reusable exercise template. A therapist authors an exercise by choosing a step, supplying the sound-specific data, and optionally adjusting difficulty.

### Step 1 — `listening_minimal_pairs`

| Field | Value |
|---|---|
| **Goal** | Child distinguishes target sound from error sound by listening only (no production required) |
| **Interaction** | Buddy says one of two words; child taps the matching picture card |
| **Assets needed** | Two picture cards per pair (e.g. car / tar) |
| **Authoring inputs** | `targetSound`, `errorSound`, `pairs: [{word_a, word_b, image_a, image_b}]` |
| **Repetitions** | 10–20 randomised presentations per pair set |
| **Scoring** | % correct selections; no pronunciation scoring |
| **Mastery rule** | ≥ 80% correct across 2 consecutive sessions → advance |
| **Feedback style** | "Great listening!" / "Let's listen again — was it _car_ or _tar_?" |
| **Key difference from current `minimal_pairs`** | Current type conflates listening and production. This step is listen-only; child taps, not speaks. |

### Step 2 — `silent_sorting`

| Field | Value |
|---|---|
| **Goal** | Child sorts object cards into two sound "homes" without speaking — builds internal phonological awareness |
| **Interaction** | Two anchor images (one per sound) at top. Child drags/taps object cards into the correct home. No speaking. |
| **Assets needed** | 2 anchor images + 8–12 object cards (half per sound) |
| **Authoring inputs** | `targetSound`, `errorSound`, `sound_a_words: [...]`, `sound_b_words: [...]` |
| **Repetitions** | Full set sorted once, then reviewed; repeat set if < 75% |
| **Scoring** | % correctly sorted |
| **Mastery rule** | ≥ 85% correct sort → advance |
| **Feedback style** | After sorting, buddy reviews errors: "Hmm, _camera_ starts with a /k/ sound — listen: _k-camera_." |

### Step 3 — `sound_isolation`

| Field | Value |
|---|---|
| **Goal** | Child produces the target sound on its own, consistently, before using it in words |
| **Interaction** | Buddy shows a sound mascot/mouth cue image, models the sound, child repeats. Repetition counter visible. |
| **Assets needed** | Sound cue card (e.g. snake for /s/, tap for /t/), optional mouth-position diagram |
| **Authoring inputs** | `targetSound`, `cueImage`, `cuePhrase` (e.g. "a snake goes sss") |
| **Repetitions** | 20–30+ isolated sound productions per session |
| **Scoring** | Binary per attempt (detected / not detected via audio); streak counter |
| **Mastery rule** | 10 consecutive accurate productions → advance |
| **Feedback style** | "That's a lovely /s/!" / "Nearly — watch my mouth: sss. Your turn!" |
| **Game wrappers** | Stepping stones, tower builder, post box — each attempt earns a visual reward unit |

### Step 4 — `vowel_blending`

| Field | Value |
|---|---|
| **Goal** | Child blends the target consonant with vowel sounds (CV and VC combos) |
| **Interaction** | Visual "blending slide" — consonant card on left, vowel card on right, slide animation pushes them together. Child says the blend. |
| **Assets needed** | Consonant card, vowel cards (a, e, i, o, u, oo, ee, etc.), slide/rail animation |
| **Authoring inputs** | `targetSound`, `vowels: [...]`, `direction: 'CV' | 'VC' | 'both'` |
| **Repetitions** | 15–25 blends per session |
| **Scoring** | Blend recognised yes/no; percentage |
| **Mastery rule** | ≥ 80% blends correct, both CV and VC → advance |
| **Feedback style** | "Push the sounds together — sss-oo — soo! Your turn!" |

### Step 5 — `word_initial` (maps to existing `word_repetition`)

| Field | Value |
|---|---|
| **Goal** | Child uses the target sound at the **beginning** of single words consistently |
| **Interaction** | One object card shown at a time. Buddy models the word, child repeats. High repetition. |
| **Assets needed** | 5–10 object cards per target sound, word-initial position |
| **Authoring inputs** | `targetSound`, `wordPosition: 'initial'`, `targetWords: [...]` |
| **Repetitions** | Each word said 5–7 times; ≥ 50 total attempts per session |
| **Scoring** | Pronunciation assessment per word (existing pipeline) |
| **Mastery rule** | ≥ 80% accuracy across word set for 2 sessions → advance |
| **Feedback style** | Specific: "I heard a strong /s/ in _sun_!" / "Try that one more time — _sss-un_." |

### Step 6 — `two_word_phrase`

| Field | Value |
|---|---|
| **Goal** | Child produces the target sound in 2-word phrases (adjective + noun, or noun + verb) |
| **Interaction** | Object card + modifier chip (colour, action, size). Child combines them into a phrase. |
| **Assets needed** | Object cards (reused from Step 5) + modifier chips (colour swatches, action icons) |
| **Authoring inputs** | `targetSound`, `targetWords: [...]`, `modifiers: [...]`, `carrierPhrase?: string` |
| **Repetitions** | 15–25 phrase productions |
| **Scoring** | Pronunciation assessment on the target word within the phrase |
| **Mastery rule** | ≥ 75% accuracy in phrases → advance |
| **Feedback style** | "Red boat — I heard your /b/! Now try: _blue_ boat." |

### Step 7 — `sentence_level` (maps to existing `sentence_repetition`)

| Field | Value |
|---|---|
| **Goal** | Child uses the target sound in full sentences |
| **Interaction** | Sentence starter strip + object card → child builds and says a sentence. Or: silly sentence builder (target word + random verb + random place). |
| **Assets needed** | Sentence starter cards ("I have a…", "I can see a…"), object cards, optional verb/place cards |
| **Authoring inputs** | `targetSound`, `targetWords: [...]`, `sentenceStarters: [...]`, `sillyMode?: boolean` |
| **Repetitions** | 10–15 sentences |
| **Scoring** | Pronunciation assessment on target word(s) within the sentence |
| **Mastery rule** | ≥ 75% accuracy in sentences → advance |
| **Feedback style** | "The seal is running in the park — great /s/ on seal!" |

### Step 8 — `word_position_practice`

| Field | Value |
|---|---|
| **Goal** | Child practises the target sound in medial and final word positions (not just initial) |
| **Interaction** | Same mechanic as Step 5, but word position highlighted visually (e.g. underline position in the written word) |
| **Assets needed** | Object cards for medial words (e.g. "messy", "apple") and final words (e.g. "bus", "house") |
| **Authoring inputs** | `targetSound`, `wordPosition: 'medial' | 'final'`, `targetWords: [...]` |
| **Repetitions** | Same volume as Step 5 |
| **Scoring** | Pronunciation assessment |
| **Mastery rule** | Same as Step 5, per position |

### Step 9 — `generalisation`

| Field | Value |
|---|---|
| **Goal** | Child transfers the target sound into spontaneous speech and everyday conversation |
| **Interaction** | Conversation prompts, "would you rather" cards, personal key-word lists, talk-about-your-day prompts. Buddy listens for the target sound in free speech. |
| **Assets needed** | Conversation prompt cards, optional personal photo cards |
| **Authoring inputs** | `targetSound`, `keyWords: [...]`, `conversationPrompts: [...]` |
| **Repetitions** | Open-ended; session timer (5–10 min) |
| **Scoring** | % of target-sound words produced correctly in free speech (if detectable); otherwise therapist rates |
| **Mastery rule** | Therapist judgment; discharge when consistent in conversation |
| **Feedback style** | Gentle reminders: "That word has your /s/ sound — try it again?" |

### Supplementary Templates

| Template | Type key | Description |
|---|---|---|
| **Consonant clusters** | `cluster_blending` | Like vowel_blending but for /s/+consonant, /l/+consonant, /r/+consonant clusters. Uses transition sheets (e.g. s + nail = snail). |
| **Multi-syllabic words** | `syllable_practice` | Clap/tap syllable counting, then production of 3–4 syllable words with target sound. |

---

## Part 2: Image Asset Spec

### 2.1 Core Object Cards

| Property | Requirement |
|---|---|
| **Subject** | Single object, centred, no competing items |
| **Background** | Flat, lightly tinted (pastel), or transparent PNG |
| **Style** | Clean vector illustration or soft watercolour; consistent across the entire set |
| **Dimensions** | 512 × 512 px minimum; square aspect ratio; export as WebP + PNG |
| **Text** | None baked into the image. Word label rendered by the UI layer |
| **Naming agreement** | Each image must have ≥ 90% naming agreement in target dialect (British English). Pre-test with 5+ adults. |
| **Colour palette** | Accessible; pass WCAG AA contrast against the card background |
| **File naming** | `{sound}-{position}-{word}.webp` e.g. `s-initial-sun.webp` |
| **Metadata** | Sidecar JSON or embedded EXIF: `targetSound`, `wordPosition`, `word`, `ageRange`, `dialectNotes` |

### 2.2 Minimal Pair Cards

All Core Object Card rules, plus:

| Property | Requirement |
|---|---|
| **Pair consistency** | Both cards in a pair must use identical illustration style, size, and background tint |
| **Visual distinctness** | The two objects must be semantically unambiguous (no "boat" that could be "ship") |
| **Pair file grouping** | Stored together: `pairs/s-sh/sip.webp`, `pairs/s-sh/ship.webp` |

### 2.3 Sound Mascot / Cue Cards

| Property | Requirement |
|---|---|
| **Purpose** | Represent a sound in isolation (e.g. snake = /s/, tap = /t/) |
| **Style** | Same illustration style as object cards; slightly larger (640 × 640 px) |
| **Content** | Character or object + optional mouth-position inset in bottom-right corner |
| **One per sound** | Exactly one canonical mascot per target sound across the product |

### 2.4 Modifier Chips (Colours, Actions, Places)

| Property | Requirement |
|---|---|
| **Dimensions** | 256 × 256 px; rounded-rectangle or circle crop |
| **Colours** | Flat colour swatch with word label rendered by UI |
| **Actions** | Simple stick-figure or icon (running, jumping, sleeping) |
| **Places** | Simplified scene (park, house, school) |

### 2.5 Vowel & Consonant Cards (Blending)

| Property | Requirement |
|---|---|
| **Dimensions** | 384 × 384 px |
| **Content** | Large phoneme symbol + small mouth-position diagram |
| **Animation** | Must work with a CSS/JS slide-rail animation; transparent background required |

### 2.6 Therapist-Uploaded / Personal Photos

| Property | Requirement |
|---|---|
| **Upload format** | JPEG, PNG, WebP; max 5 MB |
| **Auto-processing** | Server-side: resize to 512 × 512, centre-crop, strip EXIF GPS, convert to WebP |
| **Labelling** | Therapist supplies the target word at upload time |
| **Storage** | Per-child or per-therapist; not shared globally without review |

### 2.7 AI-Generated Images (Secondary Use Only)

| Property | Requirement |
|---|---|
| **When to use** | Story backgrounds, reward scenes, non-therapeutic decoration, therapist draft review |
| **When NOT to use** | Core object cards for articulation practice (unless therapist reviews and approves) |
| **Generation prompt template** | "A single {object}, centered, plain pastel background, clean vector illustration style for children aged 4–8, no text, no extra objects" |
| **Review gate** | AI-generated card images must be flagged `source: 'ai-generated'` and require therapist approval before use in a child session |
| **Consistency** | Use a fixed model + seed for batch generation to maintain style coherence |

---

## Part 3: Gap Analysis — PDF Steps vs Current Exercise Model

### Current Model (from `ExerciseType` in types/index.ts)

| Current type | Current exercises | PDF step covered |
|---|---|---|
| `word_repetition` | s-sound-words | Step 5 (initial words) partially |
| `minimal_pairs` | s-sh minimal pairs | Step 1 partially (conflates listening + production) |
| `sentence_repetition` | th-sentences | Step 7 partially |
| `guided_prompt` | r-story | Step 9 loosely (more creative than clinical generalisation) |

### Missing Exercise Types

| PDF Step | Proposed type key | Status | Priority | Notes |
|---|---|---|---|---|
| **Step 1** | `listening_minimal_pairs` | **MISSING** | **P0** | Current `minimal_pairs` asks child to speak. Step 1 is listen-only (tap the picture). This is clinically foundational — many children start here. Needs a new interaction mode: buddy speaks, child taps, no mic. |
| **Step 2** | `silent_sorting` | **MISSING** | **P1** | Drag-to-sort interaction with no speech. Entirely new UI mechanic. |
| **Step 3** | `sound_isolation` | **MISSING** | **P0** | Producing a sound alone (/s/, /k/) before using it in words. Current model jumps straight to words. Needs: repetition counter, sound-only detection, no word-level pronunciation scoring. |
| **Step 4** | `vowel_blending` | **EXISTS** | **P1** | CV vowel blending now ships with a visual slide, built-in prompts/evals, and selected-blend scoring. VC expansion is still future work. |
| **Step 5** | `word_repetition` | **EXISTS** | Enhance | Add `wordPosition` field (initial/medial/final). Current exercises are all initial-position. Add explicit repetition target (×5 per word). Add mastery tracking. |
| **Step 6** | `two_word_phrase` | **MISSING** | **P1** | Bridge between words and sentences. Modifier chips + object cards. New prompt template + phrase-level scoring. |
| **Step 7** | `sentence_repetition` | **EXISTS** | Enhance | Add sentence starter cards, silly sentence builder mode. Current version is adequate but could be richer. |
| **Step 8** | `word_position_practice` | **MISSING (partially)** | **P1** | Could reuse `word_repetition` if `wordPosition` is added. Main gap is content (medial/final word lists + images). |
| **Step 9** | `generalisation` | **MISSING** | **P2** | Hardest to automate. Conversation prompts, key-word monitoring in free speech, therapist judgment. `guided_prompt` is the closest match but lacks target-sound monitoring and key-word tracking. |
| **Supplement** | `cluster_blending` | **MISSING** | **P2** | Consonant cluster work (/sp/, /st/, /bl/, /cr/). Transition sheet mechanic. |
| **Supplement** | `syllable_practice` | **MISSING** | **P2** | Multi-syllabic word clapping/tapping. New interaction mode. |

### Summary of Gaps

| Category | Count |
|---|---|
| Exercise types that exist and partially cover a step | 3 (`word_repetition`, `sentence_repetition`, `vowel_blending`) |
| Exercise types that exist but mismatch the step's intent | 2 (`minimal_pairs` conflates listening+production; `guided_prompt` is creative not clinical) |
| Exercise types completely missing | 7 (`listening_minimal_pairs`, `silent_sorting`, `sound_isolation`, `two_word_phrase`, `generalisation`, `cluster_blending`, `syllable_practice`) |

### Missing Data Model Fields

The current `ExerciseMetadata` interface needs these additions to support the full taxonomy:

| Field | Type | Purpose |
|---|---|---|
| `wordPosition` | `'initial' \| 'medial' \| 'final' \| 'all'` | Which position in the word the target sound occupies |
| `errorSound` | `string` | The sound the child substitutes (needed for minimal pairs and sorting) |
| `repetitionTarget` | `number` | How many times each item should be repeated per session |
| `masteryThreshold` | `number` (0–100) | % accuracy required to advance |
| `stepNumber` | `number` (1–9) | Position in the intervention progression |
| `requiresMic` | `boolean` | false for Steps 1–2 (listening/sorting only) |
| `imageAssets` | `ImageAssetRef[]` | References to the required card images |
| `modifiers` | `string[]` | Colour/action/place words for phrase-level exercises |
| `sentenceStarters` | `string[]` | Carrier phrases for sentence-level exercises |
| `conversationPrompts` | `string[]` | Open prompts for generalisation exercises |

### Recommended Implementation Order

1. **P0 — Sound Isolation** (`sound_isolation`): Unlocks the clinical starting point for many children. Relatively simple UI (sound cue + repeat button + counter).
2. **P0 — Listening Minimal Pairs** (`listening_minimal_pairs`): Distinguish from current `minimal_pairs`. Listen-only mode with tap interaction.
3. **P1 — Enhance `word_repetition`**: Add `wordPosition`, repetition counter, mastery tracking.
4. **P1 — Vowel Blending** (`vowel_blending`): Now implemented for CV practice; current refinement work is prompt hardening, evaluator coverage, and selected-blend scoring.
5. **P1 — Two-Word Phrases** (`two_word_phrase`): Modifier chips.
6. **P1 — Silent Sorting** (`silent_sorting`): Drag interaction.
7. **P2 — Generalisation** (`generalisation`): Conversation mode with target-sound monitoring.
8. **P2 — Cluster Blending + Syllable Practice**: Specialist extensions.
