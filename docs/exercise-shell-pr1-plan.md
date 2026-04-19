# Plan: ExerciseShell + SilentSortingPanel reference implementation (PR1)

> Status: **APPROVED** on 2026-04-19. Plan-only document. This is the contract of record for PR1; subsessions A/B/C/S-E derive their scope from this file.

Branch: `feat/exercise-shell-progressive-disclosure`. Scope: PR1 of a 4-PR rollout — a shared `<ExerciseShell>` component implementing the ORIENT → EXPOSE → BRIDGE → PERFORM → REINFORCE grammar, plus migration of `SilentSortingPanel` as the reference adapter, tests, and per-beat avatar orchestration. No curated phoneme assets beyond the existing TH sample; all other phonemes use the existing `buildPreviewCandidate` → `/api/tts` path (GPT/TTS model) until curated recordings land.

## A. Repo audit

### A.1 Exercise-panel dispatcher
`SessionScreen.tsx` L225–248 uses boolean type checks and a nested JSX ternary. Only four `type` values have a specialized panel: `listening_minimal_pairs`, `silent_sorting`, `sound_isolation`, `vowel_blending`. All others (including `word_repetition`, `sentence_repetition`, `guided_prompt`, `two_word_phrase`, `minimal_pairs`, `generalisation`) render `null` and fall through to `ChatPanel` only. `masteryThreshold` and `stepNumber` are NOT read in `SessionScreen.tsx`.

### A.2 Panel prop surface (today)
| Panel | Required | Optional |
|---|---|---|
| ListeningMinimalPairsPanel | `metadata` | `scenarioName`, `audience`, `readyToStart`, `onSendMessage`, `onSpeakExerciseText`, `onRecordExerciseSelection`, `onInterruptAvatar`, `onCompleteSession` |
| SilentSortingPanel | `metadata` | `scenarioName`, `audience`, `readyToStart`, `onSendMessage`, `onSpeakExerciseText` |
| SoundIsolationPanel | `metadata`, `attempts` | `scenarioName`, `audience`, `onSendMessage` |
| VowelBlendingPanel | `metadata`, `attempts` | `scenarioName`, `onActiveBlendChange`, `onSendMessage` |

### A.3 Runtime usage of `masteryThreshold` / `stepNumber`
Declared in `frontend/src/types/index.ts` L43–52 (`ExerciseMetadata`). `masteryThreshold` has no runtime read sites under `frontend/src` today. `stepNumber` is read in catalogue and dashboard UI, not in live-session progression logic: `ChildHome.tsx` shows a `Step {stepNumber}` badge, `DashboardHome.tsx` shows the same in the hero chips, and `exerciseFilters.ts` uses it for `recommended` filtering, step grouping, and labels. The validated statement for PR planning is therefore: these fields are not consumed for runtime mastery-gate enforcement in the session flow today.

### A.4 YAML inventory (exercises only; 27 files)
| type | count | step | mastery | notes |
|---|---|---|---|---|
| listening_minimal_pairs | 4 | 1 | 80 | th/f, s/sh, r/w, k/t |
| silent_sorting | 6 | 2 | 80 | th, r, s, sh, k (+ inferred error sound) |
| sound_isolation | 5 | 3 | 80 | th, k, sh, r, s |
| vowel_blending | 5 | 4 | 80 | k, r, s, th, sh |
| word_repetition | 5 | 5 | 80 | initial position only |
| minimal_pairs | 1 | 1 | 80 | s/sh (legacy, overlaps listening_minimal_pairs) |
| sentence_repetition | 1 | 7 | 75 | th |
| guided_prompt | 1 | 9 | 70 | r |

Missing types (per agreed stage model): `auditory_bombardment` (Stage 0), `two_word_phrase` (Stage 6), `structured_conversation` (Stage 8), `generalisation` (Stage 9), medial/final `word_position_practice` (Stage 5b).

Validation note: the repository taxonomy doc currently diverges from the agreed clinical direction. `docs/exercise-taxonomy-and-image-spec.md` places `word_position_practice` at Step 8 and does not define `structured_conversation`, while the approved product direction for this work treats medial/final word-position work as Stage 5b and reserves Stage 8 for conversation. PR1 follows the approved direction; the doc mismatch is queued as a documentation reconciliation task.

### A.5 Intro builders
`introInstructions.ts` L10–46 (`buildChildIntroInstructions`) and L48–82 (`buildTherapistIntroInstructions`). Both return a single plain string. Both special-case `exerciseType === 'silent_sorting' && targetSound === 'th'` with a verbatim script that forbids spelling letter names. Sole call site: `App.tsx` ~L1077 inside a `useEffect` that stores the string on `pendingIntroRef.current`; this ref is consumed when the realtime session is ready and a single `response.create` is sent.

### A.6 SilentSortingPanel internals
- State: `mobileFallback`, `assignments`, `armedBucket`, `lastMove`, `previewPending`, `lastPreviewed`, `exportStatus` (dev).
- Dnd: `@dnd-kit/core` PointerSensor distance 8px; mobile falls back to tap-arm.
- Copy: L412 `sortingModeText`; L418–434 `feedbackText`; L391 `getBucketLabel` returns `"${targetSound.toUpperCase()} home"` (letter-name violation for non-TH contexts).
- Preview: uses `getCuratedIsolatedPreviewAsset` → only `th` is curated; falls back to `buildPreviewCandidate` + `/api/tts` (POST) via `api`.
- Dev export: L476 `handleSaveLastTake()` → `exportPreviewTake()`; gated by `isPreviewExportEnabled()`.

### A.7 Autoplay behavior today
- `ListeningMinimalPairsPanel` L186: `useEffect` fires instruction on mount (no gesture gate).
- `VowelBlendingPanel` L163: `useEffect` resets/emits on mount.
- No explicit mobile-Safari gesture gating anywhere.

### A.8 Backend constants relevant to orchestration
- `/api/tts` POST used by preview playback.
- Voice Live session uses `azure_semantic_vad`, `azure_deep_noise_suppression`, `server_echo_cancellation` (backend-controlled; shell does not need to alter).
- Shell → avatar comms ride existing `onSendMessage`, `onSpeakExerciseText`, `onInterruptAvatar` callbacks; no new WS message types required.

## B. `<ExerciseShell>` API design

### B.1 File layout
- New: `frontend/src/components/ExerciseShell/ExerciseShell.tsx`
- New: `frontend/src/components/ExerciseShell/useExercisePhase.ts` (reducer)
- New: `frontend/src/components/ExerciseShell/types.ts`
- New: `frontend/src/components/ExerciseShell/assertBridgeCopy.ts` (dev-only word-count guard)
- New: `frontend/src/components/ExerciseShell/ExerciseShell.test.tsx`
- Barrel: `frontend/src/components/ExerciseShell/index.ts`

### B.2 Types (FROZEN — Session 0 contract)
```ts
export type ExercisePhase =
  | 'orient'    // avatar speaks the scenario aim; no affordances live
  | 'expose'    // child explores exemplars; no scoring
  | 'bridge'    // single ≤7-word sentence, hands turn to PERFORM
  | 'perform'   // scoring enabled; EXPOSE demoted but reachable
  | 'reinforce' // summary / praise; exit + retry affordances

export interface ExerciseShellSlots {
  expose: React.ReactNode               // exploration surface (e.g., phoneme buttons)
  perform: React.ReactNode              // scoring surface (e.g., sort cards, record button)
  reinforce?: React.ReactNode           // optional custom summary
}

export interface ExerciseBeatCopy {
  orient: string      // ≤ 25 words, spoken by avatar
  bridge: string      // ≤ 7 words, spoken by avatar
  reinforce: string   // spoken on completion
}

export interface ExerciseShellProps {
  metadata: ExerciseMetadata
  audience: 'child' | 'therapist'
  beats: ExerciseBeatCopy
  slots: ExerciseShellSlots
  // Gate predicates: EXPOSE → BRIDGE transition is allowed when this returns true.
  // Default: requires an explicit user gesture (button press).
  canAdvanceFromExpose?: () => boolean
  // PERFORM completion is controlled by the adapter (it holds scoring state).
  performComplete: boolean
  // Avatar orchestration
  onBeatEnter?: (phase: ExercisePhase, beatText: string | null) => void
  onRequestInterrupt?: () => void
  // Therapist controls
  therapistCanSkipIntro?: boolean
  onTherapistOverride?: (kind: 'skip-intro' | 'skip-expose' | 'skip-bridge', reason?: string) => void
  // Variant knobs
  collapsePerform?: boolean      // Stage 0 (bombardment): true → skip PERFORM
  suppressBridge?: boolean       // Stage 8 (conversation): true → no BRIDGE beat
  covertExpose?: boolean         // Stage 8: EXPOSE is avatar-side, hide child UI
  // Dev tools
  devSlot?: React.ReactNode      // dev-only drawer (Save-take, phase stepper)
}
```

### B.3 State machine (useReducer)
```
State:  { phase: ExercisePhase, exposeTouched: boolean, performStartedAt: number | null, overrides: Override[] }
Events:
  START            -> phase=orient
  ORIENT_DONE      -> phase=expose
  EXPOSE_INTERACT  -> exposeTouched=true
  ADVANCE          -> guard(canAdvanceFromExpose || exposeTouched) -> phase=bridge
  BRIDGE_DONE      -> phase=perform, performStartedAt=now
  PERFORM_DONE     -> phase=reinforce
  RESET            -> phase=orient (preserves overrides log)
  THERAPIST_SKIP(kind) -> override logged; jumps to appropriate next phase
```
Guards mechanically enforce the three invariants:
- (a) No scoring during EXPOSE: shell does not render PERFORM slot while `phase ∈ {orient,expose,bridge}`; adapters receive `phase` via context and must early-return scoring callbacks if `phase !== 'perform'`. Shell exposes a `useExercisePhase()` context so adapter-level guards can `assert(phase === 'perform')` before `onSendMessage`.
- (b) EXPOSE reachable in PERFORM: shell re-parents the `slots.expose` node to a demoted region (collapsible drawer, `aria-expanded`, initially collapsed) when `phase === 'perform'` rather than unmounting it. Implementation: keep EXPOSE mounted inside a `<details>` or Fluent `Accordion` in PERFORM.
- (c) BRIDGE ≤ 7 words: `assertBridgeCopy(beats.bridge)` runs at module load in dev (`import.meta.env.DEV`) throwing if `bridge.split(/\s+/).length > 7`; in prod logs a warning and truncates. Additionally a Vitest unit test asserts every adapter's bridge copy passes the guard.

### B.4 Avatar orchestration
- Shell calls `onBeatEnter(phase, beatText)` at each transition. App.tsx wires this to the existing realtime path (new per-beat `response.create` with narrow `instructions` plus `response.cancel`/interrupt for the previous beat).
- ORIENT instructions: new builder `buildBeatInstructions({beat: 'orient', ...})` — see §E.
- EXPOSE has no avatar speech by default (child-led exploration); shell only speaks if adapter opts-in.
- BRIDGE: short imperative, one sentence; builder enforces length.
- REINFORCE: praise + exit; builder parameterised by outcome summary.
- Autoplay gating: shell holds a `gestureUnlockedRef` seeded false. The first user gesture inside the shell (click/touch/keydown) sets it true and triggers any pending beat. `onBeatEnter` before unlock is queued, not played.
- Therapist skip-intro: rendered as a small `Button` in the shell header when `audience === 'therapist' && therapistCanSkipIntro`. Clicking dispatches `THERAPIST_SKIP('skip-intro')`, calls `onTherapistOverride`, and advances to `expose`. Overrides are pushed to `overrides[]` and surfaced via `onTherapistOverride` for downstream telemetry (not silent).
- WS-not-open fallback: if `onBeatEnter` throws or the app reports disconnected, shell queues the beat and shows a subtle "Buddy is warming up…" veil. App.tsx retries on `sessionReady` transition. Single flush on readiness; no retry storm.

### B.5 Accessibility contract
- Phase transitions announce via `role="status" aria-live="polite"` region showing the current beat copy for screen readers.
- Focus order: on phase enter, focus moves to the new primary affordance (EXPOSE: first exemplar button; PERFORM: first card/record button; REINFORCE: "Again" button).
- Keyboard nav for drag alternatives: adapter is responsible; shell guarantees that tap-arm/keyboard paths receive `phase === 'perform'` context.
- Reduced motion: shell listens to `prefers-reduced-motion`; beat transitions use opacity-only fade when true.
- All therapist override buttons have visible labels and `aria-label`.

## C. `SilentSortingPanel` adapter plan

### C.1 Slot mapping
| Beat | Content (TH example) | Copy constraints |
|---|---|---|
| ORIENT | Avatar greets + names target sound via anchor words ("thumb" + "fin"); never spells "T-H". | Hard-coded per exerciseType+targetSound via `buildBeatInstructions`. |
| EXPOSE | Two phoneme buttons (target, error) rendered with percept label ("thhh", "fff") + colour + articulation icon; tap previews audio via existing `buildPreviewCandidate`/curated asset path. | Buttons present but card sort is NOT shown. |
| BRIDGE | `"Now sort the pictures."` (4 words). | Hard ≤7 word assertion. |
| PERFORM | Current dnd-kit sorting UI (desktop) / tap-arm (mobile); scoring via `onSendMessage`. EXPOSE phoneme buttons are still reachable inside an "Hear the sounds" accordion. | Adapter reads `phase` from context; `onSendMessage` no-ops if not `perform`. |
| REINFORCE | Correct count + "Great sorting!" + Again/Finish buttons. | Adapter computes summary from `assignments`. |

### C.2 State that stays local vs. moves to shell
| State | Location after refactor |
|---|---|
| `assignments`, `armedBucket`, `lastMove` | Local (PERFORM logic) |
| `mobileFallback` | Local |
| `previewPending`, `lastPreviewed`, preview strategy | Local but scoped to EXPOSE slot |
| `exportStatus` + Save-take UI | Local; moved into `devSlot` prop (dev-only drawer opened from shell header) |
| phase, exposeTouched, overrides | Shell (reducer) |

### C.3 Phoneme labels — fix applied to EXPOSE
Replace `getBucketLabel()` letter-name output. New helper `getPerceptLabel(sound)`:
- `th` → `"thhh"` (unvoiced percept)
- `f`  → `"fff"`
- `s`  → `"sss"`
- `sh` → `"shhh"`
- `r`  → `"rrr"`
- `k`  → `"kuh"` (stop, brief vowel to support percept)
- `v`  → `"vvv"`, `z` → `"zzz"`

Each label pairs with: colour token (`--phoneme-<sound>`), articulation icon (new `frontend/src/components/PhonemeIcon.tsx` — thin SVG placeholder for PR1). `getBucketLabel` (used in scored PERFORM UI) keeps letter form for therapist scanning but is hidden from child audience by default.

### C.4 EXPOSE → BRIDGE gate
Gate satisfied when EITHER:
1. Both phoneme buttons tapped at least once (`exposedSounds: Set<string>` reaches size 2), OR
2. Explicit "Start game" button press.

Implemented by adapter-side `canAdvanceFromExpose = () => exposedSounds.size >= 2`; "Start game" dispatches `ADVANCE` manually.

### C.5 UI copy (EN-GB, obeys letter-name rule)
- ORIENT (child, TH example): `"Hi ${childName}, let's listen to two sounds and sort some pictures. Tap each sound to hear it."`
- ORIENT (therapist): `"Starting silent sorting for ${childName}. Preview each sound, then sort."`
- BRIDGE: `"Now sort the pictures."` (4 words).
- REINFORCE: `"Great sorting! Want another go?"` (5 words).
- All copy passes through `assertBridgeCopy` where relevant; ORIENT/REINFORCE have a soft ≤25-word cap tested in CI.

### C.6 Dev Save-take migration
`handleSaveLastTake` + preview-export UI moves into `<SilentSortingDevTools />` rendered as `devSlot`. Shell mounts `devSlot` only when `isPreviewExportEnabled()` returns true. Behaviour preserved: callers of `exportPreviewTake()` unchanged.

## D. Test strategy

### D.1 Existing tests — impact
| File:test | Today asserts | Action |
|---|---|---|
| `ExercisePanels.test.tsx` > locks taps until the avatar finishes the instruction | LMP gates selection on `onSpeakExerciseText` completion | Update: same behaviour must hold inside shell PERFORM phase. Rewire to drive phase transitions. |
| `ExercisePanels.test.tsx` > retries the same pair after a wrong answer | LMP incorrect-pick → retry | Keep; passes once adapter is wired. |
| `ExercisePanels.test.tsx` > praises a correct answer and auto-advances | LMP correct-pick → next | Keep. Not migrated in PR1 (LMP adapter is PR2). |
| `ExercisePanels.test.tsx` > shows skip pair only for therapists | audience gate | Keep; add analogous shell-level "skip-intro" test. |
| `ExercisePanels.test.tsx` > hides skip while the next pair clue is starting | turn alignment | Keep. |
| `introInstructions.test.ts` > 4 tests on TH cue | whole-blob intro string | Update: split into per-beat builders. Replace with tests on `buildBeatInstructions({beat, exerciseType, targetSound, ...})`; preserve the letter-name prohibition assertion and the exact TH welcome-string assertion migrated to the ORIENT beat. |

### D.2 New tests (names + one-line intent)
`ExerciseShell.test.tsx`:
1. `starts in orient phase and announces the orient beat`
2. `advances orient → expose when onBeatEnter resolves`
3. `does not play beat audio before first user gesture`
4. `flushes queued beat after first gesture`
5. `blocks advance from expose until canAdvanceFromExpose returns true`
6. `allows advance from expose on explicit Start press regardless of gate`
7. `asserts bridge copy is at most 7 words` (two fixtures)
8. `keeps expose slot mounted and reachable in perform phase`
9. `drops scoring callbacks outside perform phase`
10. `renders therapist skip-intro only for therapist audience`
11. `logs therapist override and calls onTherapistOverride when skip-intro pressed`
12. `collapsePerform variant skips straight to reinforce`
13. `suppressBridge variant goes expose → perform with no bridge beat`
14. `covertExpose variant hides expose slot from DOM`
15. `queues beat and shows warming veil when realtime not ready`
16. `moves focus to primary affordance on each phase enter`
17. `honours prefers-reduced-motion`

`SilentSortingPanel.test.tsx` (new file):
18. `requires both phoneme buttons tapped before bridge`
19. `renders percept labels, not letter names, in expose`
20. `keeps phoneme preview accordion reachable in perform`
21. `falls back to TTS candidate when curated asset is missing`
22. `uses curated TH asset when targetSound is th`
23. `dev save-take appears only when VITE_ENABLE_PREVIEW_EXPORT is set`

### D.3 Test infra
- Vitest + React Testing Library already present. No new libs.
- Fake timers for beat transitions.
- Mock `api.synthesizeSpeech` with deterministic base64.
- Mock `onBeatEnter` with a resolved Promise.

## E. Avatar orchestration plan

### E.1 Per-beat builder split
New module: `frontend/src/app/beatInstructions.ts` exporting:
```ts
export type Beat = 'orient' | 'bridge' | 'reinforce'
export interface BeatInstructionOptions extends IntroInstructionOptions {
  beat: Beat
  outcomeSummary?: string // only used for reinforce
}
export function buildBeatInstructions(opts: BeatInstructionOptions): string
```
`introInstructions.ts` retains `buildChildIntroInstructions` and `buildTherapistIntroInstructions` as thin wrappers that compose ORIENT + implicit BRIDGE (legacy behaviour) so the single call site in `App.tsx` ~L1077 does not regress in PR1. Shell-aware adapters use `buildBeatInstructions` via `onBeatEnter` instead.

Beat copy rules baked in:
- ORIENT: ≤ 25 words, must include child name, must NOT spell letters, must pass the existing TH prohibition ("never say th sound / f sound").
- BRIDGE: ≤ 7 words, imperative, no scoring language.
- REINFORCE: praise + optional "another go?" prompt, NEVER corrective language.

### E.2 Call-site preservation
`App.tsx` L1077–1086: unchanged in PR1. The `pendingIntroRef` still feeds a single `response.create` on `sessionReady`. ExerciseShell sits downstream; once mounted, it takes over further beats via a new `useAvatarBeat` hook that calls into the same realtime send function `sendResponseCreate(instructions)`.

### E.3 Fallback when WS not open
Order of precedence:
1. If `realtimeStatus !== 'ready'`: queue beat in `pendingBeatsRef`, show "Buddy is warming up…" microcopy in the shell header, do NOT block child input.
2. On `sessionReady` transition: drain queue (FIFO) with `response.cancel` between beats.
3. Retry once on transient error; if still failing after 3s, silently drop the beat (non-blocking) and log to telemetry. Never spin.

## F. Progression gate (PR4 sketch only)

New hook (future PR): `frontend/src/app/useSessionProgression.ts`.
```ts
export interface SessionProgressionState {
  currentStep: number
  mastered: Record<number, boolean>
  canAdvance: (to: number) => boolean
  recordOutcome: (stepNumber: number, correct: number, total: number) => void
  therapistOverride: (to: number, reason: string) => void
}
```
Integration points (non-foreclosing in PR1):
- `SessionScreen.tsx` dispatcher gains a `progressionGate?: SessionProgressionState` prop.
- Shell's `onTherapistOverride` maps 1:1 to `therapistOverride`.
- Shell's REINFORCE phase is the natural write point for `recordOutcome`.

Design guardrail: ExerciseShell MUST NOT read progression state itself; it only emits outcome events.

## G. Rollout plan

### PR1 — ExerciseShell + SilentSortingPanel adapter + tests (this plan)
- Files added: `components/ExerciseShell/*`, `components/PhonemeIcon.tsx`, `app/beatInstructions.ts`, `components/SilentSortingPanel.test.tsx`.
- Files modified: `components/SilentSortingPanel.tsx` (becomes adapter), `components/SessionScreen.tsx` (integration only), `app/introInstructions.ts` (compose from beatInstructions), `app/introInstructions.test.ts` (rewritten).
- Tests: items 1–23 in §D.
- Manual QA: TH silent-sorting run child + therapist modes end-to-end; dev save-take still works when flag set; LMP/Iso/Blending panels still render unchanged.
- Risk: medium.
- Rollback: revert the single PR; `introInstructions.ts` wrappers preserve the legacy string shape so backend sees no change.

### PR2 — Migrate remaining panels to shell
LMP, SoundIsolation, VowelBlending become adapters. Stage 5a `word_repetition` gets a thin `ChatRepetitionAdapter`.

### PR3 — Stage 0 `AuditoryBombardmentPanel`
New panel using `collapsePerform`. Adds one new YAML per target sound (th first).

### PR4 — Progression gate
Implement `useSessionProgression`, wire into `SessionScreen` dispatcher. Feature-flag with `VITE_ENABLE_PROGRESSION_GATE`.

## H. Risks & open questions

| # | Assumption / Risk | Resolution path |
|---|---|---|
| 1 | Word-count guard for BRIDGE is acceptable as a hard throw in dev | Confirmed — hard throw in dev, log+truncate in prod |
| 2 | Per-beat `response.create` + `response.cancel` sequence is safe with Voice Live barge-in | Verify at S-E integration against dev avatar |
| 3 | Percept pseudo-spellings ("thhh", "kuh") acceptable for all target sounds, incl. stops | SLP review queued; may need per-sound refinement |
| 4 | Only TH has a curated preview asset; TTS-modelled phonemes for others is interim | Confirmed acceptable for PR1/PR2 |
| 5 | Telemetry for therapist overrides and phase transitions | Defer concrete wiring beyond PR1 |
| 6 | Dev Save-take must remain usable post-migration | Covered via `devSlot` |
| 7 | EN-GB wording rules (no "test") apply to all beat copy | `beatInstructions` reuses existing clause |
| 8 | Mic permission flow is untouched by shell | Confirmed by audit |
| 9 | Realtime avatar barge-in on phase transitions | Verify `response.cancel` → `response.create` sequencing at S-E |
| 10 | `ExercisePanels.test.tsx` is a single multi-panel file | Keep file structure; rewire in place |
| 11 | `minimal_pairs` vs `listening_minimal_pairs` ambiguity | PR1 shell only handles `silent_sorting`; LMP adapter is PR2 |
| 12 | `stepNumber` values in YAML use 1–9 indexing with gaps | Confirmed; closed in later PRs |
| 13 | `docs/exercise-taxonomy-and-image-spec.md` diverges from approved clinical sequence | Approved brief is source of truth; doc reconciliation queued |

## Execution strategy

### Subsession breakdown
PR1 executes internally as five subsessions, not one long pass.

#### Session 0 — Contract freeze (serial, blocking)
Zero-code. Produces frozen `ExerciseShellProps`, `ExercisePhase`, `onBeatEnter` signature, bridge invariant rules, exact beat copy strings, taxonomy decision record. This document **is** the Session 0 output.

#### Session A — Shell core (parallel-safe after S0)
- Owns: `frontend/src/components/ExerciseShell/**` only.
- New files: `ExerciseShell.tsx`, `useExercisePhase.ts`, `types.ts`, `assertBridgeCopy.ts`, `index.ts`, `ExerciseShell.test.tsx`.
- No imports from panels, App, or SessionScreen.
- No `api.*`, `getUserMedia`, or realtime send calls.
- Emits side effects only via injected callbacks.
- Acceptance: reducer covers all five phases + override + skip-intro; `assertBridgeCopy` throws in dev / warns in prod; gesture-unlock slot renders before EXPOSE audio; ≥ 90% coverage on reducer + assertion; `vitest run ExerciseShell` green.

#### Session B — Avatar beat orchestration (parallel-safe after S0)
- New: `frontend/src/app/beatInstructions.ts`, `frontend/src/app/beatInstructions.test.ts`.
- Modify: `frontend/src/app/introInstructions.ts` (narrow to orient-only builder; keep legacy wrappers), `frontend/src/app/introInstructions.test.ts`, `frontend/src/app/App.tsx` (scoped to L1077–L1086 only, `sendBeat` helper behind feature flag).
- No edits to `SilentSortingPanel.tsx` or `SessionScreen.tsx`.
- No imports from `ExerciseShell/` (shell depends on B via injected callback, not the reverse).
- Acceptance: all 4 existing TH intro tests still pass unchanged; new beat builders for EXPOSE/BRIDGE/PERFORM/REINFORCE with EN-GB wording rule; pre-ready WS queue + flush covered by tests; `response.cancel` before `response.create` on preempt.

#### Session C — SilentSorting adapter (parallel-safe after S0)
- Modify: `frontend/src/components/SilentSortingPanel.tsx` (replace letter-name bucket labels L391 region, keep curated TH asset at L449 region, move dev Save-take L476 into `devSlot`, add both-buttons-tapped gate before PERFORM).
- New: `frontend/src/components/PhonemeIcon.tsx`, `frontend/src/components/SilentSortingDevTools.tsx`, `frontend/src/components/SilentSortingPanel.test.tsx`.
- No edits to `SessionScreen.tsx`, `introInstructions.ts`, or `App.tsx`.
- Until S-E: imports shell from a local `__mocks__/ExerciseShellContract.ts` matching the S0 signature.
- Acceptance: zero letter-name bucket strings remain; percept labels + `PhonemeIcon` render for TH curated and non-TH TTS fallback; PERFORM blocked until both preview buttons tapped; dev Save-take only in `devSlot` when `isPreviewExportEnabled()` true; `vitest run SilentSortingPanel` green.

#### Session D/E — Integration + QA (serial, after A/B/C)
- Modify: `frontend/src/components/SessionScreen.tsx` L225–L248 (route `silent_sorting` through shell-backed adapter only; leave other three branches alone); `frontend/src/components/SilentSortingPanel.tsx` (replace C's local shell mock with real shell); `frontend/src/app/App.tsx` (remove feature flag); `frontend/src/components/ExercisePanels.test.tsx` (update LMP assertions only where shell-driven DOM differs; keep `api.synthesizeSpeech` mock name).
- Acceptance: full `vitest run` green; manual QA matrix passes (child TH, child non-TH, therapist, skip-intro, gesture unlock, dev export, unchanged panels still render); `response.cancel`/`response.create` verified against backend; bridge-copy invariant not tripped in prod paths.

### Merge order checklist
1. S0 signed off (this document)
2. S-A merged to `integration/pr1`
3. S-B merged to `integration/pr1`
4. S-C merged to `integration/pr1`
5. S-E integration commit on `integration/pr1`
6. Full `vitest run` green
7. Manual QA matrix green
8. Live barge-in check green
9. Squash-merge `integration/pr1` → `feat/exercise-shell-progressive-disclosure`

**Rule**: A, B, C never land directly on the feature branch. They land on `integration/pr1`; S-E produces the single squash.

### Parallel-safety matrix

| File / area | A | B | C | Notes |
|---|---|---|---|---|
| `frontend/src/components/ExerciseShell/**` (new) | **own** | — | — | Safe |
| `frontend/src/app/beatInstructions.ts` (new) | — | **own** | — | Safe |
| `frontend/src/app/introInstructions.ts` | — | **own (narrow)** | — | B is sole writer |
| `frontend/src/app/introInstructions.test.ts` | — | **own** | — | Safe |
| `frontend/src/app/App.tsx` L1077–L1086 | — | **own (scoped)** | — | **Lock to B** |
| `frontend/src/components/SilentSortingPanel.tsx` | — | — | **own** | Safe |
| `frontend/src/components/PhonemeIcon.tsx` (new) | — | — | **own** | Safe |
| `frontend/src/components/SilentSortingPanel.test.tsx` (new) | — | — | **own** | Safe |
| `frontend/src/components/SessionScreen.tsx` L225–L248 | — | — | — (defer) | **S-E only** |
| `frontend/src/components/ExercisePanels.test.tsx` | — | — | — (defer) | **S-E only** |
| `frontend/src/types/index.ts` L43–L52 | read | read | read | Frozen at S0 |
| `frontend/src/utils/exerciseFilters.ts` | — | — | — | Out of scope |
| `frontend/src/components/ListeningMinimalPairsPanel.tsx` | — | — | — | PR2 |
| `frontend/src/components/VowelBlendingPanel.tsx` | — | — | — | PR2 |
| Curated asset manifest / `buildPreviewCandidate` | — | — | read | Safe |
| `data/exercises/*.yaml` | — | — | — | Safe |
| `docs/exercise-taxonomy-and-image-spec.md` | — | — | — | Deferred follow-up |
| `backend/**` | — | — | — | Out of scope |

## Approval

Approved by product owner on 2026-04-19. All 11 items in the approval checklist (five-beat grammar, three invariants, useReducer state machine, `ExerciseShellProps` surface with variant knobs, gesture-gated autoplay, per-beat builder split, SilentSorting adapter mapping, TH curated + TTS fallback interim, dev Save-take relocation to `devSlot`, dev-time hard throw for BRIDGE overflow, 4-PR rollout boundaries, test migration scope) are accepted.
