# Handoff prompt — fix child-mode usability across exercise panels

Paste everything below into a new assistant session.

---

## Context

Repo: `/home/ayoola/sen/voicelive-api-salescoach` (React + Vite frontend, FastAPI backend).
Frontend stack: TypeScript, Fluent UI, Vitest, React 18 + StrictMode.

When a child opens an exercise in child mode, the page is effectively
unusable: no "Start" button, no visible picture cards, and the audio never
starts. This is worst on the auditory bombardment ("listen to camera")
exercise but the pattern likely affects other panels too.

Therapist mode works because `ExerciseShell` renders a **Start session**
button that dispatches `THERAPIST_SKIP` to force `orient → expose`. In
child mode, there is no such button — the shell depends entirely on two
gates being true:

1. `gestureUnlocked` — set by `onPointerDown`/`onKeyDown` on the
   `<section class="exercise-shell">`.
2. `realtimeReady` — controlled by a prop from the host (defaults to
   `true` in the shell, but `SessionScreen`/`App.tsx` may pass `false`
   until the Voice Live websocket greeting completes).

Plus the beat orchestration effect (`ExerciseShell.tsx`, the
`useEffect` around line 138) fires `onBeatEnter(orient, ...)` and then
auto-dispatches `ORIENT_DONE`. If the host's `onBeatEnter` callback never
resolves, or if `realtimeReady` never flips true, the shell stays stuck in
`orient` forever and the child sees a blank page.

## What I want you to do

**Do not start coding.** First investigate and produce a written plan
(markdown file under `docs/`) that I can review before you implement.

### Investigation scope

For each of these panels:

- `frontend/src/components/AuditoryBombardmentPanel.tsx` (listen-to-camera)
- `frontend/src/components/SilentSortingPanel.tsx`
- `frontend/src/components/WordPositionPracticePanel.tsx`
- `frontend/src/components/ListeningMinimalPairsPanel.tsx`
- `frontend/src/components/TwoWordPhrasePanel.tsx`
- `frontend/src/components/StructuredConversationPanel.tsx` (if applicable)

And for `ExerciseShell`
(`frontend/src/components/ExerciseShell/ExerciseShell.tsx`,
`useExercisePhase.ts`):

Answer each of these, with file + line citations:

1. **Start affordance in child mode.** What visible affordance (if any)
   unblocks the child's first beat? The "Start session" button is gated
   by `audience === 'therapist' && therapistCanSkipIntro && phase === 'orient'`
   (see `ExerciseShell.tsx` ~line 200-260). In child mode is there an
   equivalent? If the answer is "the child must tap anywhere on the
   section", is that discoverable (visible prompt, cursor, aria)? Is the
   tap target always present before `realtimeReady` flips true?

2. **`realtimeReady` wiring.** Trace the prop from
   `SessionScreen.tsx` → `ExerciseShell`. When does it become true? What
   happens if the Voice Live websocket fails (capacity error, bad
   `agent_id`, network)? Does the child see `WARMING_COPY` forever? Is
   there a timeout / skip / fallback? (We already saw this stall in
   production — see commit history around the `readyToStart` removal in
   `AuditoryBombardmentPanel`.)

3. **Image / picture rendering.** In each panel's EXPOSE slot, are the
   image cards rendered eagerly on mount, or gated on another state
   (playback started, readyToStart, etc.)? For the bombardment panel,
   `PlaybackSlot` auto-starts on mount — but only after `showExposeMain`
   flips true, which requires `orient → expose`. If orient never
   advances, the child never sees the cards. Check every panel for
   equivalents.

4. **`onBeatEnter` failure modes.** If the host's `onBeatEnter`
   callback throws / rejects / never resolves, does the shell still
   dispatch `ORIENT_DONE`? Currently it uses `.catch(() => {})` then
   `.then()` to dispatch — good — but confirm for each phase that there
   is no `await` path that can hang indefinitely.

5. **Gesture discoverability.** `gestureUnlocked` is set by the first
   pointerdown/keydown on the section. In child mode, with no visible
   button or copy saying "tap to start", how would a 4-year-old know to
   tap? Is there a visible prompt, pulsing ring, or copy?

6. **Avatar-free path.** If the avatar video never loads (e.g.
   development without Azure credentials), do panels still function?
   Check for hard dependencies on avatar events vs. soft dependencies
   with timeouts.

7. **Reproduce the bug.** Either (a) start the dev server
   (`./scripts/start-local.sh`) and open an exercise in child mode with
   `?userMode=child` (or whatever query param / setting is used — find
   it), or (b) write a Vitest RTL test that renders each panel with
   `audience="child"` and asserts a start affordance is reachable and
   that image cards render. Report what you see: screenshot, DOM
   snapshot, or test failure excerpt.

### Deliverable

A markdown file at `docs/child-mode-usability-plan.md` with:

- **Findings** per panel with file+line citations.
- **Root cause(s)** — likely multiple (no child start button, possible
  realtime-ready stall, discoverability gap, etc.).
- **Proposed fix plan** with one of:
  - *Option A: minimal* — add a child-visible "Tap to start" affordance
    in `ExerciseShell` when `audience === 'child' && phase === 'orient'`
    and either `!gestureUnlocked` or a 2-second timeout elapsed, that
    dispatches `THERAPIST_SKIP { kind: 'skip-intro' }` (or a new
    `CHILD_START` event) when tapped. Big, friendly, pulsing.
  - *Option B: full* — rework the orient gate to not depend on
    `realtimeReady` for child mode at all, since the realtime greeting
    is nice-to-have not load-bearing. Add a 3-second realtime-warmup
    timeout before falling back to a local TTS greeting or silent
    advance.
  - Recommend one. Explain why.
- **Test plan** — list the Vitest tests you'd add (use the existing
  `AuditoryBombardmentPanel.test.tsx` child-mode test as a template).
- **Rollout risk** — what could break in therapist mode if we change
  the orient gate?

### Constraints

- Do not change backend behaviour.
- Follow existing code style (Fluent UI `makeStyles`, `mergeClasses`,
  TypeScript strict).
- Prefer editing `ExerciseShell` centrally over patching each panel
  individually, unless a panel has genuinely unique requirements.
- React 18 StrictMode-safe (refs reset on unmount — see the pattern in
  `PlaybackSlot` in `AuditoryBombardmentPanel.tsx`).
- All new behaviour must be covered by Vitest tests. Full suite must
  still pass: `cd frontend && npx vitest run` (currently 231 tests).
- Keep the child-mode auto-wrap path intact — the bombardment panel's
  child mode fires `onExerciseComplete()` on REINFORCE beat entry
  (`AuditoryBombardmentPanel.tsx` near the `ExerciseShell` call).

### Useful starting points (pre-read these)

- `frontend/src/components/ExerciseShell/ExerciseShell.tsx` lines 75-260
- `frontend/src/components/ExerciseShell/useExercisePhase.ts`
- `frontend/src/components/SessionScreen.tsx` lines 280-470
- `frontend/src/components/AuditoryBombardmentPanel.tsx`
- `frontend/src/app/App.tsx` search for `isChildMode`
- `frontend/src/components/AuditoryBombardmentPanel.test.tsx` (see
  `seedShellGesture` helper — that's how the gesture gate is simulated
  in tests, which itself is a smell: real children need a visible
  affordance, not a hidden pointerdown listener)

### Return to me with

1. The markdown plan file.
2. A short summary of root cause(s).
3. Your recommended option and why.
4. A rough sequence of PRs you'd open (keep each PR small and testable).

Then **wait for my go-ahead** before implementing anything.
