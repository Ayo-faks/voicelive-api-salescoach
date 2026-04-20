# Child-mode usability fix — investigation & plan

**Status**: investigation complete, awaiting go-ahead before implementation.
**Scope**: [ExerciseShell](frontend/src/components/ExerciseShell/ExerciseShell.tsx) and all exercise panels rendered under it in child mode.
**Trigger**: child opens an exercise in child mode (`?userMode=child`). Page shows no Start button, no image cards, no audio. Worst case: Voice Live WS stalls (capacity, bad `agent_id`, offline) and the page is permanently dead.

---

## 1. Findings (with file + line citations)

### 1.1 ExerciseShell — two gates, no child-visible release valve

- **Gate 1 — `gestureUnlocked`**: [ExerciseShell.tsx#L92](frontend/src/components/ExerciseShell/ExerciseShell.tsx#L92) flips `true` only on `onPointerDown` / `onKeyDown` of `<section class="exercise-shell">` ([L236-L238](frontend/src/components/ExerciseShell/ExerciseShell.tsx#L236-L238)). There is no visible prompt, cursor, pulsing ring or copy telling a child to tap. `handleRootGesture` ([L213](frontend/src/components/ExerciseShell/ExerciseShell.tsx#L213)) is the only path in child mode.
- **Gate 2 — `realtimeReady`**: defaults `true` in the shell ([L86](frontend/src/components/ExerciseShell/ExerciseShell.tsx#L86)) but is overridden by props from `SessionScreen` → `App`. When `false`, the beat orchestration effect ([L138-L168](frontend/src/components/ExerciseShell/ExerciseShell.tsx#L138-L168)) short-circuits at [L143](frontend/src/components/ExerciseShell/ExerciseShell.tsx#L143) (`if (!gestureUnlocked || !realtimeReady) return`) and never fires `onBeatEnter` / `ORIENT_DONE`.
- **"Start session" button**: `showSkipIntro = audience === 'therapist' && therapistCanSkipIntro && phase === 'orient'` ([L201-L202](frontend/src/components/ExerciseShell/ExerciseShell.tsx#L201-L202)). Dispatches `THERAPIST_SKIP { kind: 'skip-intro' }` which forces orient → expose in the reducer ([useExercisePhase.ts#L92-L95](frontend/src/components/ExerciseShell/useExercisePhase.ts#L92-L95)). **No child equivalent exists.**
- **Warming veil**: `BreatheRing` shown whenever `!realtimeReady` ([ExerciseShell.tsx#L263](frontend/src/components/ExerciseShell/ExerciseShell.tsx#L263)), indefinitely, with no timeout or fallback.
- **Orient slot content**: there is no visible copy in orient phase. The `<output aria-live>` block holds `beats.orient` ([L246-L252](frontend/src/components/ExerciseShell/ExerciseShell.tsx#L246-L252)) but that is an assistive-tech announce region, not a child-visible affordance.

### 1.2 `realtimeReady` wiring — can stall forever

- Shell → prop → passed through from `SessionScreen` ([SessionScreen.tsx#L284, #L298](frontend/src/components/SessionScreen.tsx#L284)) for `StructuredConversationPanel` and `TwoWordPhrasePanel`. **Other panels (`AuditoryBombardmentPanel`, `WordPositionPracticePanel`, `SilentSortingPanel`, `ListeningMinimalPairsPanel`) do not forward `realtimeReady` at all** — they rely on the shell's `true` default. (See [AuditoryBombardmentPanel.tsx#L211-L226](frontend/src/components/AuditoryBombardmentPanel.tsx#L211-L226) — no `realtimeReady` prop on the `<ExerciseShell>` call.) For those panels, gate 2 is effectively off.
- In `App.tsx`: `realtimeReady={connected && sessionIntroComplete}` ([App.tsx#L4253](frontend/src/app/App.tsx#L4253)).
- `sessionIntroComplete` only flips on the first non-empty assistant transcript ([App.tsx#L2660-L2672](frontend/src/app/App.tsx#L2660-L2672)): `if (role === 'assistant' && text.trim() && sessionIntroRequested && !sessionIntroComplete) setSessionIntroComplete(true)`.
- **Failure modes that leave `realtimeReady=false` forever**:
  - Voice Live WS never opens (capacity HTTP 429, bad `agent_id`, bad model deployment, network).
  - WS opens but agent never emits any assistant transcript (instructions misconfigured, model errors out silently).
  - Dev without Azure credentials — nothing speaks.
- **No timeout, no skip, no local-TTS fallback.** Shell renders the warming veil indefinitely and the beat orchestration effect never runs for `StructuredConversationPanel` / `TwoWordPhrasePanel`. All panels still need the `gestureUnlocked` gate to pass as well, so even where `realtimeReady` defaults to true, the child-discoverability issue (§1.1) remains.

### 1.3 Image / picture rendering — tied to `phase === 'expose'`

- Shell renders EXPOSE slot only when `showExposeMain = phase === 'expose' && !covertExpose` ([ExerciseShell.tsx#L224, #L269-L273](frontend/src/components/ExerciseShell/ExerciseShell.tsx#L224)). If the shell hangs in `orient`, **no panel's cards are in the DOM at all**. That is the "no visible picture cards" the user reported.
- Panel-specific behaviour *after* expose is reached:
  - **AuditoryBombardmentPanel** — `PlaybackSlot` auto-starts on mount ([L376-L384](frontend/src/components/AuditoryBombardmentPanel.tsx#L376-L384)); ignores `readyToStart` for audio (intentional post-regression fix). Image cards render eagerly once mounted. Fine once expose is reached.
  - **SilentSortingPanel** — `dragEnabled = readyToStart && !mobileFallback` ([L380](frontend/src/components/SilentSortingPanel.tsx#L380)) and preview cues gated on `readyToStart` ([L498, L408](frontend/src/components/SilentSortingPanel.tsx#L498)). If `readyToStart` is false (WS stalled), drag is dead and preview audio never plays even though the grid shows.
  - **WordPositionPracticePanel** — `canStart = readyToStart && previewedIndexes.size > 0 && playingIndex === null` ([L376](frontend/src/components/WordPositionPracticePanel.tsx#L376)). Start-round button stays disabled if `readyToStart` is false.
  - **ListeningMinimalPairsPanel** — early-return `if (!readyToStart) return` inside the turn-start effect ([L224, L247](frontend/src/components/ListeningMinimalPairsPanel.tsx#L224)); `tapsDisabled = !readyToStart || phase !== 'awaiting'` ([L346](frontend/src/components/ListeningMinimalPairsPanel.tsx#L346)). No prompts play, taps dead.
  - **TwoWordPhrasePanel** — `canStart = readyToStart && previewedIndexes.size > 0 && …` ([L402](frontend/src/components/TwoWordPhrasePanel.tsx#L402)). Same pattern.
  - **StructuredConversationPanel** — `disabled={!readyToStart || !selectedTopicId || phase !== 'expose'}` on primary action ([L399](frontend/src/components/StructuredConversationPanel.tsx#L399)).
- Net: even once the orient gate passes, every panel except bombardment is partially or fully dead when `readyToStart` (== `connected && sessionIntroComplete`) is false. The bombardment panel pointedly worked around this by auto-starting TTS off a plain `/api/tts` POST that does not require the realtime session ([L376-L384 comment](frontend/src/components/AuditoryBombardmentPanel.tsx#L376-L384)); the other panels never got the same treatment.

### 1.4 `onBeatEnter` failure modes — safe against throw, **unsafe against hang**

- Shell wraps the host callback in `Promise.resolve().then(() => onBeatEnterRef.current?.(phase, beatText)).catch(() => {}).then(() => { dispatch(…) })` ([L147-L162](frontend/src/components/ExerciseShell/ExerciseShell.tsx#L147-L162)). Rejections are swallowed → good.
- But if a host callback returns a Promise that **never resolves**, the downstream `.then(dispatch)` never fires and orient is stuck. Grep of host usages: the panels' `onBeatEnter` handlers are plain synchronous functions ([AuditoryBombardmentPanel.tsx#L232-L241](frontend/src/components/AuditoryBombardmentPanel.tsx#L232-L241) etc.), so in practice this is safe today. Flagged for belt-and-braces: add a watchdog in case a future adapter returns an awaitable TTS promise.

### 1.5 Gesture discoverability — the headline bug

Child mode relies entirely on a hidden `pointerdown` on the section. There is no:
- visible "Tap to start" copy,
- pulsing / glowing hit target,
- cursor-pointer styling on the section,
- ARIA hint,
- keyboard-focus affordance.

Even the test helper `seedShellGesture()` in [AuditoryBombardmentPanel.test.tsx#L11-L16](frontend/src/components/AuditoryBombardmentPanel.test.tsx#L11-L16) synthesises a `fireEvent.pointerDown` on the section — i.e. tests already encode the "invisible trigger" contract. That's a smell: a real 4-year-old cannot know to tap an empty panel.

### 1.6 Avatar-free path

- `VideoPanel` receives `onVideoLoaded` → flips `avatarVideoReady` in App ([App.tsx#L4239](frontend/src/app/App.tsx#L4239)). Used for UI polish, not shell gating. Good — avatar video failure alone does not block the shell.
- However, a missing Azure credentials dev run means no WS → no `sessionIntroComplete` → the stall path in §1.2.

### 1.7 Reproduction

No live repro was attempted (headless browser not warranted — the code path is conclusive). A Vitest repro is the cheapest evidence and will be part of PR1 (see §5). Proposed repro skeleton:

```tsx
// Each panel, audience="child", NOT seeding the gesture:
render(<AuditoryBombardmentPanel metadata={meta} audience="child" />)
// Expect a visible start affordance (button / copy) or advance on any visible interaction.
// Today: nothing visible; assertion fails.
```

Add a second test explicitly pinning `realtimeReady={false}` on the wrappers that forward it, to assert timeout-fallback behaviour (§3 option B).

---

## 2. Root causes (ordered by impact)

1. **No child-visible Start affordance in ORIENT.** The section-wide hidden-pointerdown gesture is undiscoverable; a 4-year-old will never trigger it. This alone explains "no cards, no audio" for a healthy-WS session.
2. **No timeout / fallback on `realtimeReady`.** When the realtime greeting never arrives (WS capacity error, bad `agent_id`, offline dev), orient never advances and the page shows only the warming veil indefinitely.
3. **Panels over-couple to `readyToStart` (== `connected && sessionIntroComplete`).** Even when expose is reached, `ListeningMinimalPairsPanel`, `SilentSortingPanel`, `WordPositionPracticePanel`, `TwoWordPhrasePanel`, `StructuredConversationPanel` go dead if the realtime greeting never lands. Bombardment already decoupled; the others should follow.
4. **Inconsistent forwarding of `realtimeReady` from `SessionScreen`.** Only two panels forward it to the shell. If we rely on `realtimeReady` for gate 2, we should forward it everywhere; if we gate on the child-Start button instead, we should stop forwarding it for child mode.

---

## 3. Proposed fix plan

### Recommended: **Option B (plus a minimal visible affordance borrowed from Option A)**

Ship both layers, but keep each PR small and testable.

- **Layer 1 — discoverability (Option A, child only)**: In `ExerciseShell`, when `audience === 'child' && phase === 'orient'`, render a big, friendly, centred "Tap to start" tile inside the header region. Pulsing ring (respecting `prefers-reduced-motion`), `role="button"`, large tap target, `data-primary-affordance="true"` so focus lands on it. Tapping dispatches `THERAPIST_SKIP { kind: 'skip-intro' }` (rename copy in code path is fine; the reducer effect is identical to therapist skip). Keep `gestureUnlocked` flipping on tap as well so any dependent effects still run. This alone fixes the happy path.
- **Layer 2 — realtime warmup timeout (Option B)**: Add a `childRealtimeWarmupMs` (default 3000 ms) in `ExerciseShell`. For `audience === 'child'`, after gesture unlock, if `realtimeReady` is still `false` after `childRealtimeWarmupMs`, treat the realtime gate as "effectively ready" for advance-purposes: fire `onBeatEnter` (which the panel can no-op or route to `/api/tts`), advance orient → expose, and drop the warming veil. Log `[shell] realtime warmup timeout — continuing without WS greeting` for diagnostics. If the WS later resolves, that's fine — the shell has already advanced and the avatar greeting simply does not play. Therapist mode is unchanged.
- **Layer 3 — panel-level `readyToStart` decoupling in child mode**: For child-mode, change `readyToStart` for the five downstream panels to `connected || childWarmupElapsed` (not `&& sessionIntroComplete`). Audio previews use `/api/tts` which does not need the realtime greeting — same pattern `AuditoryBombardmentPanel` already uses. Wire this from `SessionScreen` / `App` rather than each panel.

### Why Option B over Option A alone

Option A alone leaves the production stall (dead WS → forever warming veil) unfixed. We already saw that bug once in `AuditoryBombardmentPanel`, and the other four panels still have the equivalent stall. A 3 s warmup timeout costs nothing when the WS is healthy (greeting usually lands in < 1 s) and unblocks the degraded path. Adding the visible tap affordance is near-zero cost and removes the discoverability landmine that will keep biting us even with a healthy WS.

Option B full-rework (remove `realtimeReady` from the shell entirely) is tempting but risky for therapist mode, where the current "wait for greeting" behaviour is load-bearing for the session-summary flow. Gating the decoupling on `audience === 'child'` keeps therapist behaviour bit-identical.

---

## 4. Rollout risk

- **Therapist mode**: untouched. `showSkipIntro` logic, warming veil, `realtimeReady` gate, all preserved. Existing ExerciseShell tests under `item 15` ([ExerciseShell.test.tsx#L295-L312](frontend/src/components/ExerciseShell/ExerciseShell.test.tsx#L295-L312)) must still pass.
- **Child mode**: the new Tap-to-start tile replaces the hidden-gesture-only path. Existing `seedShellGesture()` helper can continue to work because the new tile will still produce a `pointerdown` bubble up to the section, so `gestureUnlocked` continues to flip. Alternatively, test helper is rewritten to click the new button.
- **Bombardment regression risk**: PlaybackSlot auto-starts on expose mount; adding warmup-timeout path means expose mounts earlier when WS is unhealthy — `PlaybackSlot` starts and uses `/api/tts` — which is the already-documented safe path ([AuditoryBombardmentPanel.tsx#L363-L375 comment](frontend/src/components/AuditoryBombardmentPanel.tsx#L363-L375)).
- **REINFORCE auto-wrap**: unchanged. `onBeatEnter(phase === 'reinforce', audience === 'child')` still fires `onExerciseComplete()` ([AuditoryBombardmentPanel.tsx#L238-L241](frontend/src/components/AuditoryBombardmentPanel.tsx#L238-L241)).
- **StrictMode**: the warmup-timeout effect must clear its timer on cleanup; otherwise the dev double-invoke fires twice. Pattern mirrors the existing ref-reset in `PlaybackSlot` ([L283-L293](frontend/src/components/AuditoryBombardmentPanel.tsx#L283-L293)).
- **Accessibility**: Tap-to-start tile needs `role="button"`, `aria-label`, keyboard-focusable, reduced-motion fallback for the pulse.

---

## 5. Test plan (Vitest, RTL)

Template off [AuditoryBombardmentPanel.test.tsx](frontend/src/components/AuditoryBombardmentPanel.test.tsx).

**New shell tests** (`ExerciseShell.test.tsx`):
1. `child-mode — renders Tap to start tile in ORIENT and focuses it on mount`.
2. `child-mode — clicking Tap to start advances orient → expose without needing realtimeReady`.
3. `child-mode — when realtimeReady=false, warming veil hides after the warmup timeout and beat fires`.
4. `child-mode — therapist-only Start session button is NOT rendered when audience='child'`.
5. `therapist-mode — Tap to start tile is NOT rendered (no regression on existing `showSkipIntro` test)`.
6. `warmup timeout is cleared on unmount (StrictMode double-invoke safe)`.

**New panel tests** (one file each, or extend existing):
7. `AuditoryBombardmentPanel — audience="child" renders the Tap to start tile; after tap, cards and progress appear`.
8. `ListeningMinimalPairsPanel — audience="child" with realtimeReady=false still becomes interactive after warmup timeout`.
9. `SilentSortingPanel — audience="child", drag becomes enabled after warmup timeout despite readyToStart=false`.
10. `WordPositionPracticePanel — audience="child", start-round button enables after warmup timeout`.
11. `TwoWordPhrasePanel — audience="child", start enables after warmup timeout`.
12. `StructuredConversationPanel — audience="child", primary action enables after warmup timeout`.

**Regression guards**:
13. Existing `seedShellGesture()` helper keeps working (adjust helper to click the new tile when `audience="child"` is in DOM; else fall back to section pointerdown).
14. `ExerciseShell.test.tsx — item 15 warming veil` (therapist) still passes.
15. Full suite: `cd frontend && npx vitest run` — current 231 tests must still pass, net count can grow.

---

## 6. Rough PR sequence (small, reviewable)

- **PR0 — repro** _(optional but recommended)_: add two Vitest child-mode tests asserting "Tap-to-start is reachable" and "expose slot renders after warmup timeout". Both **fail** on `main`. Fastest way to lock the contract before implementation.
- **PR1 — child Tap-to-start tile** in `ExerciseShell`. Fixes discoverability. Therapist path untouched. Tests #1, #2, #4, #5, #7.
- **PR2 — realtime warmup timeout for child mode** in `ExerciseShell`. Defaults 3000 ms, prop-overridable for tests (`childRealtimeWarmupMs`). Tests #3, #6.
- **PR3 — panel-level `readyToStart` decoupling** for `ListeningMinimalPairsPanel`, `SilentSortingPanel`, `WordPositionPracticePanel`, `TwoWordPhrasePanel`, `StructuredConversationPanel`. Threaded from `SessionScreen` / `App` as `childAudioReady = connected || shellWarmupElapsed` (event from shell → callback up, or derive the same 3 s timeout in `SessionScreen`). Tests #8–#12.
- **PR4 — cleanup**: forward `realtimeReady` consistently (or remove from panels that no longer need it); tighten the `seedShellGesture` test helper; add `data-testid="exercise-shell-tap-to-start"` stable hooks.

Each PR is independently revertable. PR1 alone fixes the "silent WS-is-healthy" case; PR2+PR3 cover the degraded-WS production stall.

---

## 7. Open questions for reviewer

1. Copy for the Tap-to-start tile — preference? ("Tap to start", "Let's go!", "Ready? Tap me"). Child-facing voice.
2. Warmup timeout duration — is 3 s the right budget, or should we allow it to be env-configurable (`CHILD_REALTIME_WARMUP_MS`) like the Voice Live tunables in [backend/src/config.py](voicelive-api-salescoach/backend/src/config.py#L49-L63)?
3. Do we want a one-time toast/log surfaced to therapists ("Session continued without avatar greeting") when the warmup path fires in a non-child session? Out of scope here; flagging.
4. Should the Tap-to-start tile also render in therapist mode as the replacement for the current small header button? Keeping them separate for now to minimise blast radius.
