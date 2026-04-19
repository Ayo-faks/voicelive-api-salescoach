# PR1 kickoff prompt — paste into a fresh Copilot chat session

Copy the block between the `---` markers into a new chat. Start the session on branch `feat/exercise-shell-progressive-disclosure` with an empty context. Choose ONE of the execution modes below depending on whether you're running a single agent or parallel agents.

---

## Mode 1 — Single-agent sequential execution

```
You are continuing an approved, planned piece of work on the Wulo speech-therapy app.

The full plan and contract of record is:
  voicelive-api-salescoach/docs/exercise-shell-pr1-plan.md

Read that file FIRST, in full, before any other action. It is the frozen Session 0 contract for PR1 (ExerciseShell + SilentSortingPanel reference adapter). Do not re-debate scope or API shape — treat §B.2 types, §B.3 reducer events, §C.1 slot mapping, and the Execution strategy section as fixed.

Repository context:
- Branch: feat/exercise-shell-progressive-disclosure
- Workspace root: /home/ayoola/sen/voicelive-api-salescoach
- Frontend: React + TS + Vite + Vitest + Fluent UI at frontend/
- Backend: FastAPI + Azure Voice Live at backend/
- Only TH has a curated phoneme asset today; non-TH uses buildPreviewCandidate → /api/tts (GPT-modelled TTS). Do not block on curated assets.

Execute PR1 in this order, stopping at each checkpoint for verification:

1. Create integration branch: `integration/pr1` off `feat/exercise-shell-progressive-disclosure`. All subsession work lands here, never directly on the feature branch.

2. Session A — Shell core.
   - Scope, files, and acceptance criteria: see "Session A" in the Execution strategy section.
   - Files: frontend/src/components/ExerciseShell/* (all new).
   - Hard boundary: no imports from panels, App.tsx, or SessionScreen.tsx. No api.*, getUserMedia, or realtime send calls.
   - Stop when `npx vitest run ExerciseShell` is green and ≥90% coverage on useExercisePhase.ts and assertBridgeCopy.ts is demonstrated. Commit. Report to user.

3. Session B — Avatar beat orchestration.
   - Scope and files: see "Session B" in the Execution strategy section.
   - New: frontend/src/app/beatInstructions.ts, beatInstructions.test.ts.
   - Modify: frontend/src/app/introInstructions.ts (narrow; keep legacy wrappers), introInstructions.test.ts, App.tsx (ONLY around L1077–L1086 to expose a sendBeat helper behind feature flag).
   - Hard boundary: no edits to SilentSortingPanel.tsx or SessionScreen.tsx. No imports from ExerciseShell/.
   - Stop when all 4 original TH intro tests still pass AND new beat-builder tests pass AND pre-ready-WS queue+flush is covered. Commit. Report to user.

4. Session C — SilentSorting adapter.
   - Scope and files: see "Session C" in the Execution strategy section.
   - Modify: frontend/src/components/SilentSortingPanel.tsx (replace letter-name bucket labels, move dev Save-take into devSlot, add both-buttons-tapped gate).
   - New: frontend/src/components/PhonemeIcon.tsx, SilentSortingDevTools.tsx, SilentSortingPanel.test.tsx.
   - Hard boundary: no edits to SessionScreen.tsx, introInstructions.ts, or App.tsx. Import the shell from a local __mocks__/ExerciseShellContract.ts matching the frozen S0 signature until the S-E integration step.
   - Stop when zero letter-name bucket strings remain, both-buttons gate is enforced, TH curated and non-TH TTS fallback paths both test green. Commit. Report to user.

5. Session E — Integration + QA.
   - Modify frontend/src/components/SessionScreen.tsx (L225–L248 only; route silent_sorting through the shell-backed adapter; leave the other three panel branches untouched).
   - Replace C's local shell mock with the real ExerciseShell from A.
   - Remove the feature flag around sendBeat in App.tsx.
   - Update frontend/src/components/ExercisePanels.test.tsx only where shell-driven DOM differs; keep the api.synthesizeSpeech mock name.
   - Run full `npx vitest run` from frontend/. Must be green.
   - Run the manual QA matrix in the plan §G / Execution strategy (child TH, child non-TH, therapist, skip-intro, gesture unlock, dev export, unchanged panels).
   - Stop and report results to user.

6. Squash-merge `integration/pr1` → `feat/exercise-shell-progressive-disclosure` ONLY after user confirms QA is green.

Process rules:
- Do not create new markdown docs unless the user asks.
- Do not edit files outside each session's declared scope.
- Do not refactor unrelated code.
- Do not touch backend/, data/exercises/*.yaml, or docs/exercise-taxonomy-and-image-spec.md in PR1.
- Surface every open question immediately; do not silently decide.
- If any frozen contract item in the plan turns out to be wrong, STOP and ask before changing it.

First action: read voicelive-api-salescoach/docs/exercise-shell-pr1-plan.md in full, confirm understanding, then propose Session A's first commit plan (file skeletons + test names) for user approval before writing code.
```

---

## Mode 2 — Parallel multi-agent execution

Dispatch three agents simultaneously after creating `integration/pr1`. Each agent gets ONLY its own brief below, plus the plan file path. Do not give any agent another agent's brief.

### Agent A brief

```
You are implementing Session A (shell core) of an approved plan.

READ FIRST: voicelive-api-salescoach/docs/exercise-shell-pr1-plan.md — especially §B (ExerciseShell API design) and the "Session A — Shell core" subsection in Execution strategy. The contract in §B.2 is FROZEN. Do not propose changes to it.

Branch: work on `integration/pr1` (already created).
Working directory: /home/ayoola/sen/voicelive-api-salescoach/frontend/

SCOPE (exhaustive):
Create these files ONLY:
  src/components/ExerciseShell/ExerciseShell.tsx
  src/components/ExerciseShell/useExercisePhase.ts
  src/components/ExerciseShell/types.ts
  src/components/ExerciseShell/assertBridgeCopy.ts
  src/components/ExerciseShell/index.ts
  src/components/ExerciseShell/ExerciseShell.test.tsx

HARD BOUNDARIES:
- Do NOT import from src/components/SilentSortingPanel.tsx, src/app/App.tsx, or src/components/SessionScreen.tsx.
- Do NOT call api.*, getUserMedia, or any realtime send helper. Side effects go only through injected callbacks.
- Do NOT modify any file outside src/components/ExerciseShell/.
- Do NOT modify src/types/index.ts (ExerciseMetadata is frozen).

ACCEPTANCE:
- Reducer covers ORIENT, EXPOSE, BRIDGE, PERFORM, REINFORCE + therapist override + skip-intro per §B.3.
- assertBridgeCopy throws in dev (import.meta.env.DEV), logs+truncates in prod.
- Gesture-unlock slot renders before any EXPOSE audio fires.
- ≥ 90% line coverage on useExercisePhase.ts and assertBridgeCopy.ts.
- `npx vitest run ExerciseShell` green.
- All 17 test items from plan §D.2 (ExerciseShell.test.tsx) implemented.

Commit message: `feat(shell): ExerciseShell core + reducer + bridge assertion (Session A)`.

Report back with: files created, test count, coverage summary, and any ambiguity found in the contract.
```

### Agent B brief

```
You are implementing Session B (avatar beat orchestration) of an approved plan.

READ FIRST: voicelive-api-salescoach/docs/exercise-shell-pr1-plan.md — especially §E (Avatar orchestration plan) and the "Session B" subsection in Execution strategy. The onBeatEnter signature in §B.2 is FROZEN.

Branch: `integration/pr1`.
Working directory: /home/ayoola/sen/voicelive-api-salescoach/frontend/

SCOPE (exhaustive):
- CREATE: src/app/beatInstructions.ts, src/app/beatInstructions.test.ts.
- MODIFY: src/app/introInstructions.ts (narrow to orient-only; KEEP the legacy buildChildIntroInstructions and buildTherapistIntroInstructions as composing wrappers so App.tsx L1077–1086 does not regress).
- MODIFY: src/app/introInstructions.test.ts (keep all 4 existing TH tests passing unchanged).
- MODIFY: src/app/App.tsx — ONLY around L1077–L1086 to expose a `sendBeat(instructions)` helper behind a feature flag (e.g. VITE_ENABLE_BEAT_ORCHESTRATION). Do not touch any other part of App.tsx.

HARD BOUNDARIES:
- Do NOT edit src/components/SilentSortingPanel.tsx, SessionScreen.tsx, or any file under src/components/ExerciseShell/.
- Do NOT import from src/components/ExerciseShell/ (the shell depends on you via injected callback, not the reverse).
- Do NOT remove or rename buildChildIntroInstructions or buildTherapistIntroInstructions — they must remain exported with the same signature.
- Do NOT modify the realtime WS path beyond wrapping it in the sendBeat helper.

ACCEPTANCE:
- All 4 original TH intro tests in introInstructions.test.ts pass unchanged.
- New beat builders for ORIENT, BRIDGE, REINFORCE (and implicit EXPOSE/PERFORM silence) exist with EN-GB wording ("no 'test'").
- ORIENT builder preserves the existing TH prohibition ("never say th sound / f sound").
- BRIDGE builder enforces ≤7 words at build time.
- Pre-ready-WS queue + flush on sessionReady is implemented and covered by a test.
- response.cancel is issued before response.create when a beat preempts another.
- `npx vitest run introInstructions beatInstructions` green.

Commit message: `feat(avatar): per-beat instruction builders + queue/flush (Session B)`.

Report back with: new file contents summary, feature-flag name, test count, and any realtime-path ambiguity found.
```

### Agent C brief

```
You are implementing Session C (SilentSorting adapter) of an approved plan.

READ FIRST: voicelive-api-salescoach/docs/exercise-shell-pr1-plan.md — especially §C (SilentSortingPanel adapter plan) and the "Session C" subsection in Execution strategy. §B.2 ExerciseShellProps is FROZEN — you must conform to it.

Branch: `integration/pr1`.
Working directory: /home/ayoola/sen/voicelive-api-salescoach/frontend/

SCOPE (exhaustive):
- MODIFY: src/components/SilentSortingPanel.tsx
  - Replace letter-name bucket labels in getBucketLabel (around L391) with percept labels via a new getPerceptLabel helper.
  - Keep the curated TH asset path (around L449) working via buildPreviewCandidate fallback for non-TH.
  - Move dev Save-take UI (around L476, gated by isPreviewExportEnabled()) into the shell's devSlot prop via a new SilentSortingDevTools component.
  - Add a both-buttons-tapped gate before PERFORM (exposedSounds Set reaches size 2) OR explicit "Start game" button.
- CREATE: src/components/PhonemeIcon.tsx (thin SVG placeholder for PR1).
- CREATE: src/components/SilentSortingDevTools.tsx (owns handleSaveLastTake + export status).
- CREATE: src/components/SilentSortingPanel.test.tsx (new file; all 6 test items from plan §D.2 items 18–23).
- CREATE: src/components/__mocks__/ExerciseShellContract.ts — a local shell mock matching the §B.2 signature. You use this INSTEAD OF importing from src/components/ExerciseShell/ until the integration session (S-E) replaces it.

HARD BOUNDARIES:
- Do NOT edit src/components/SessionScreen.tsx, src/app/App.tsx, src/app/introInstructions.ts, or src/app/beatInstructions.ts.
- Do NOT import from src/components/ExerciseShell/ directly — use the local mock.
- Do NOT import from src/app/beatInstructions.ts directly — the shell injects beat callbacks.
- Do NOT remove or change the existing curated TH asset logic; only refactor it into the EXPOSE slot.
- Do NOT remove isPreviewExportEnabled() gating for dev Save-take.

ACCEPTANCE:
- Zero occurrences of `${...toUpperCase()} home` (letter-name bucket text) remain in the file.
- Percept labels render for TH, f, s, sh, r, k, v, z per plan §C.3.
- PhonemeIcon renders alongside each EXPOSE button.
- PERFORM is blocked until both preview buttons have been tapped at least once (or explicit Start pressed).
- Dev Save-take only renders inside devSlot when isPreviewExportEnabled() is true.
- TH curated and non-TH TTS fallback paths both have tests.
- A @dnd-kit interaction test covers a successful sort round.
- `npx vitest run SilentSortingPanel` green.

Commit message: `feat(silent-sorting): adapter refactor + percept labels + expose gate (Session C)`.

Report back with: list of modifications in SilentSortingPanel.tsx (line-by-line diff summary), files created, test count, and any contract ambiguity found.
```

### Integration session (S-E) — run AFTER A, B, C all report green

```
You are running Session E (integration + QA) of an approved plan.

READ FIRST: voicelive-api-salescoach/docs/exercise-shell-pr1-plan.md — "Session D/E" in Execution strategy.

PRECONDITION: Agents A, B, and C have each reported green acceptance and their commits are on `integration/pr1`.

Branch: `integration/pr1`.
Working directory: /home/ayoola/sen/voicelive-api-salescoach/frontend/

SCOPE (exhaustive):
- MODIFY src/components/SilentSortingPanel.tsx: replace the local __mocks__/ExerciseShellContract.ts import with the real ExerciseShell from src/components/ExerciseShell.
- DELETE src/components/__mocks__/ExerciseShellContract.ts.
- MODIFY src/components/SessionScreen.tsx (L225–L248 only): route the `silent_sorting` branch through the shell-backed adapter. Leave the other three branches (listening_minimal_pairs, sound_isolation, vowel_blending) untouched.
- MODIFY src/app/App.tsx: remove the VITE_ENABLE_BEAT_ORCHESTRATION feature flag around sendBeat.
- MODIFY src/components/ExercisePanels.test.tsx: only where shell-driven DOM differs for SilentSorting cases. Keep the `api.synthesizeSpeech` mock name. Do not rewrite LMP/Iso/Blending tests.

ACCEPTANCE:
- `npx vitest run` from frontend/ is fully green.
- Manual QA matrix passes (have the user run through it):
  1. Child mode, TH silent_sorting: curated asset plays, percept labels visible, both-buttons gate works, sort round works, reinforce shown.
  2. Child mode, non-TH silent_sorting (e.g. s, r): TTS fallback plays, same flow works.
  3. Therapist mode: skip-intro button visible and functional; override logged.
  4. Gesture-unlock: first tap inside shell releases queued beats; no audio before gesture.
  5. Dev Save-take: appears in devSlot only when VITE_ENABLE_PREVIEW_EXPORT is set.
  6. Unchanged panels: LMP, SoundIsolation, VowelBlending render identically to pre-PR1.
- Back-to-back response.cancel → response.create tolerated by backend (check browser network tab for errors).

After QA is green AND user approves: squash-merge `integration/pr1` → `feat/exercise-shell-progressive-disclosure` with message `feat: ExerciseShell + SilentSortingPanel adapter (PR1)`.

Do NOT squash-merge without explicit user approval.
```

---

## Notes for the human running this

- The plan file is versioned in git; any agent reading it will see the same frozen contract regardless of context compaction.
- If an agent asks for clarification on a contract item, answer from the plan file; do not let it negotiate the API surface.
- If A, B, or C return with a legitimate contract-blocker, update the plan file on `integration/pr1`, re-broadcast to the other agents, then resume.
- Expected order of completion when running in parallel: B finishes first (smallest surface), then A, then C. If C finishes before A, that's fine — C has its own shell mock.
