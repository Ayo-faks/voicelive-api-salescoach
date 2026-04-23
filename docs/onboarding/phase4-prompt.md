# Phase 4 Build Prompt — Child Mode (Mascot, Spotlight, Hand-off, Wrap-up)

> **Plan of record:** [docs/onboarding/onboarding-plan-v2.md](./onboarding-plan-v2.md), Tier C (items 13–17) and Phase 4 rollout (items 14–16).
> **Status going into Phase 4:** Phases 1–3 shipped. Backend `child_ui_state` is already live (migration `20260423_000023_user_ui_state.py`, endpoints `GET/PUT /api/children/{child_id}/ui-state`, schema validators, audit writes, RLS, tests). Frontend has `useUiState`, `OnboardingContext`, `OnboardingRuntime` with a hard child-persona seal (`telemetry.disableForChild()`), tour catalogue, `EmptyState`, `ChecklistWidget`, `AnnouncementBanner`, `HelpMenu`, `HelpPopover`. The directory `frontend/src/components/childOnboarding/` does not yet exist.

You are continuing the v2 onboarding system in the `voicelive-api-salescoach` repo. **Phase 4 is frontend-only.** Do not touch backend endpoints, migrations, Bicep (`infra/resources.bicep`, `excludedPaths`), v1 plan (`docs/onboarding/onboarding-plan.md`), or legal copy in `frontend/src/components/legal/*`. Do not add `framer-motion` or `@reactour/*` — both explicitly rejected in v2.

---

## 1. Non-negotiable constraints

Read these before writing any code:

- **Zero telemetry in child mode.** `telemetry.trackEvent` must not fire while `role === 'child'` or `userMode === 'child'`. The seal already exists in `services/telemetry.ts` (module-level `_childMode` flag set by `disableForChild()`) and is invoked by `OnboardingRuntime`. Any new component you write must rely on that seal — do **not** add new telemetry callsites inside `childOnboarding/*` or its hooks. Verify with a spied-emitter test in `App.integration.test.tsx`.
- **No child analytics anywhere.** No Clarity events, no App Insights events, no console logging of child identifiers. Children's Code compliance is enforced at the emitter, not the consumer (v2 plan §GDPR / UK ICO Children's Code).
- **No `ui_state` writes for child persona.** `useUiState` returns `disabled: true` in child context. Phase 4 writes its flags via the **per-child** endpoint (`PUT /api/children/{child_id}/ui-state`) from the **therapist/parent's session**, *not* from inside child mode. The child tablet never sees that PUT; the flag is written either (a) by the therapist/parent who launched the session, right after the mascot finishes, or (b) on session end as part of the existing session-finalise flow. Pick (a); justify in JSDoc.
- **Reduced motion, forced colors, 44×44 px tap targets, keyboard & screen-reader paths.** All four are hard requirements per v2 §Accessibility. `prefers-reduced-motion` = no animation, static dim.
- **Bundle budget.** No new runtime deps except `@floating-ui/react` (already listed in v2 as the only approved Tier C addition — check `frontend/package.json` first; if absent, add it). Reuse existing CSS keyframes from `WuloRobot.tsx` / `DashboardHome.tsx` for motion. Inline SVG `<rect>` + `feGaussianBlur` for the spotlight mask. Pure JS only (arm64 binfmt per repo memory).
- **Copy ≤25 words per mascot utterance.** Flow every string through `frontend/src/onboarding/t.ts`. Keys namespaced `child.<surface>.<role>.<n>`. No legal wording changes.
- **Voice-gated UX.** Mascot narration uses the existing `api.synthesizeSpeech` + `useAudioPlayer` pipeline. Respect the `useAudioPlayer` playback queue; never call it twice concurrently. Provide a parallel hidden `aria-live="polite"` caption so SR users aren't reliant on TTS.

---

## 2. Context to load first

Read in full:

- [docs/onboarding/onboarding-plan-v2.md](./onboarding-plan-v2.md) §Tier C, §Phase 4, §Accessibility, §GDPR/Children's Code, §Error states & offline, §Verification (items 7, 13, 16).
- [frontend/src/hooks/useUiState.ts](../../frontend/src/hooks/useUiState.ts) — confirm the child-persona gate; Phase 4 must not bypass it.
- [frontend/src/services/api.ts](../../frontend/src/services/api.ts) — `getChildUiState`, `putChildUiState`, `synthesizeSpeech` signatures.
- [frontend/src/hooks/useAudioPlayer.ts](../../frontend/src/hooks/useAudioPlayer.ts) — `playAudio`, `stopAudio`, `getPendingAudioMs`. Mascot narration reuses this — no second audio pipeline.
- [frontend/src/app/beatInstructions.ts](../../frontend/src/app/beatInstructions.ts) — child vs. therapist beat builder + 25-word cap convention.
- [frontend/src/components/BuddyAvatar.tsx](../../frontend/src/components/BuddyAvatar.tsx), [WuloRobot.tsx](../../frontend/src/components/WuloRobot.tsx), [DashboardHome.tsx](../../frontend/src/components/DashboardHome.tsx) — existing mascot asset + reusable CSS keyframes (`robotPulseRing`, `buddyImage`) that honour `prefers-reduced-motion`.
- [frontend/src/components/SessionScreen.tsx](../../frontend/src/components/SessionScreen.tsx) — `isChildMode` prop threading; where `ChildSpotlight` will mount during practice.
- [frontend/src/components/SilentSortingPanel.tsx](../../frontend/src/components/SilentSortingPanel.tsx) — Phase 4 pilot exercise; identify the element the first-run tutorial should spotlight (sort bins + sample chip).
- [frontend/src/app/App.tsx](../../frontend/src/app/App.tsx) — `userMode` state, `LAUNCH_HANDOFF_DELAY_MS`, `SUMMARY_HANDOFF_DELAY_MS`, `SESSION_WRAP_UP_DELAY_MS`, `handleChooseMode`, `handleAcknowledgeConsent`, `handleParentalConsentSubmit`, session-launch path, wrap-up handlers around lines 2378–2470 and 3280–3340.
- [frontend/src/onboarding/events.ts](../../frontend/src/onboarding/events.ts) — event taxonomy (child flows do NOT add events; they simply exist as a no-op for child context).
- [frontend/src/onboarding/t.ts](../../frontend/src/onboarding/t.ts) — copy wrapper.
- `/memories/repo/voicelive-api-salescoach.md`, `/memories/repo/deploy-arm64-binfmt.md`, `/memories/repo/security-model-current.md`, `/memories/repo/child-practice-flow.md`.

Skim:
- [frontend/src/components/legal/ParentalConsentDialog.tsx](../../frontend/src/components/legal/ParentalConsentDialog.tsx) — the hand-off interstitial sits *between* consent and child mode. Do not modify consent wording.
- [backend/src/app.py](../../backend/src/app.py) lines 2672–2730 — child_ui_state endpoint shape (reference only; no backend change).
- [docs/child-mode-usability-plan.md](../../docs/child-mode-usability-plan.md) — existing REINFORCE auto-wrap behaviour that `ChildWrapUpCard` must not fight.

---

## 3. Deliverables (in dependency order)

### 3.1 `frontend/src/childOnboarding/` content module

New directory. No components yet — only pure TS.

1. `frontend/src/childOnboarding/childUiState.ts` — typed schema for the child-scoped flags:
   ```ts
   export interface ChildOnboardingFlags {
     mascot_seen?: boolean                 // welcome mascot for this child
     exercise_tutorials_seen?: Record<string, boolean>  // per exercise_type
     wrap_up_seen?: boolean                // at least one wrap-up card shown
   }
   ```
   Narrow helper getters/setters that accept the raw `child_ui_state` blob returned by `api.getChildUiState` and produce/merge a typed view. Caps: ignore unknown keys, cap array/object sizes defensively (mirror the server-side JSON schema in `backend/src/schemas/ui_state.py`).
2. `frontend/src/childOnboarding/copy.ts` — all user-visible strings via `t()`. One entry per (surface, persona tone). Each mascot utterance ≤ 25 words. Surfaces: `handoff`, `welcome-mascot`, `silent-sorting-tutorial`, `wrap-up`.
3. `frontend/src/childOnboarding/narration.ts` — thin adapter around `api.synthesizeSpeech` + `useAudioPlayer`:
   - Single in-flight promise; queues at most one follow-up utterance.
   - Exposes `narrate({ key, text, voiceName? })` and `cancelNarration()`.
   - Always emits the matching caption via an exported callback prop so the consumer can render `aria-live` text.
   - Honours `prefers-reduced-motion`? Not directly, but the consumer should be able to disable TTS entirely (e.g., during silent-mode toggle). Provide a `muted` option.
4. `frontend/src/childOnboarding/spotlightAnchors.ts` — registry mapping an anchor id → selector + testId + `aria-label`. Keeps Phase 4's contract grep-able, parallels `tours.ts`.

### 3.2 Hook: `useChildUiState`

`frontend/src/hooks/useChildUiState.ts`. Public shape:

```ts
useChildUiState(childId: string | null, options?: { disabled?: boolean }) => {
  state: ChildOnboardingFlags
  markMascotSeen: () => Promise<void>
  markTutorialSeen: (exerciseType: string) => Promise<void>
  markWrapUpSeen: () => Promise<void>
  loading: boolean
  error: Error | null
}
```

Rules:
- Boots only for the **therapist/parent** (adult) view — this hook must never run inside child-rendered subtrees. Guard with `disabled` when `userMode === 'child' || role === 'child'`.
- On boot, `GET /api/children/{childId}/ui-state`; merge server into local.
- Writes call `PUT /api/children/{childId}/ui-state` with the full merged blob (the server validates the schema).
- Optimistic: update local first, rollback on 4xx/5xx; queue to `localStorage['wulo.childUiStateOutbox:{childId}']` on 5xx and replay on next focus (mirrors the `useUiState` outbox story — v2 §Error states).
- No retries on 401 (adult is logged out — consent flow will re-prompt).

Tests (Vitest): optimistic update, rollback, outbox replay, disabled gate, does-not-fire inside child context.

### 3.3 `ChildMascot` component

`frontend/src/components/childOnboarding/ChildMascot.tsx`.

- Reuses `BuddyAvatar` + existing CSS keyframes. No new asset imports.
- Props: `{ active: boolean; caption: string; onComplete?: () => void; onSkip?: () => void; reducedMotion?: boolean }`.
- Renders an accessible `<div role="dialog" aria-modal="false" aria-label="Wulo guidance">` containing the avatar, the 25-word caption, and two ≥44×44 px buttons: "Got it" (advances) and "Skip" (hides permanently). No timer auto-advance.
- Under `prefers-reduced-motion: reduce` (detected via `window.matchMedia`, falling back to `false` on SSR) disables drop-in animation and pulse ring; static dim only.
- `forced-colors: active` — use `CanvasText`/`Canvas`; drop gradients.
- Narration: pulls from `narration.ts`; caption text stays visible even if TTS is muted.
- Emits nothing to telemetry.

Tests: renders caption, buttons are keyboard-operable (Enter/Space/Esc), reduced-motion removes animation class, `active={false}` unmounts, muted mode shows caption only.

### 3.4 `ChildSpotlight` component

`frontend/src/components/childOnboarding/ChildSpotlight.tsx`.

- Positioning: `@floating-ui/react` (`useFloating` + `autoUpdate`). No `framer-motion`, no `@reactour`.
- Mask: a fixed, full-screen `<svg>` with `<mask>` cutting a `<rect>` hole at the anchor's bounding client rect; backdrop dim via `rgba(0,0,0,0.55)` (matches existing child overlays). Pulse animation reuses the `robotPulseRing` keyframes; disabled under reduced motion.
- Props: `{ anchorId: string; caption: string; onNext: () => void; onDismiss: () => void; reducedMotion?: boolean }`.
- Anchor resolution via `spotlightAnchors.ts`. If the selector misses (e.g., the panel unmounted), silently unmount the spotlight and log a dev-only warning (no telemetry). This is the "silent anchor rot" fallback.
- Keyboard: `Enter`/`Space` = next; `Esc` = dismiss. Focus returns to the anchor on dismiss (use `document.activeElement` snapshot).
- Pointer isolation: the mask blocks clicks outside the cutout so young users can't accidentally hit background UI.
- Tap targets ≥44×44 px.

Tests: resolves anchor, handles missing anchor without throwing, keyboard flow, reduced-motion state, forced-colors fallback.

### 3.5 `HandOffInterstitial` component

`frontend/src/components/childOnboarding/HandOffInterstitial.tsx`.

- Appears after parental consent success and before the child's first rendered surface. Gated on `userMode === 'child'` and `flags.mascot_seen === false`.
- Full-screen card using existing child-mode theming. Title: "Hand the device to your child"; body ≤ 25 words (pulled from `copy.ts`); large "Start" button ≥ 56 px.
- Triggers `narration.narrate()` for a parent-facing line, then on "Start" switches to child narration.
- Timer: no forced progression. The existing `LAUNCH_HANDOFF_DELAY_MS` stays as-is; the interstitial adds its own explicit confirmation step in front of that delay.
- On dismiss, calls `markMascotSeen()` (writes the per-child flag) and invokes `onComplete` so App can proceed.

Tests: renders when flag absent, skipped when flag present, calls `markMascotSeen` exactly once on completion.

### 3.6 Silent-sorting first-run micro-tutorial (pilot exercise)

- Use `ChildSpotlight` to step through 2–3 anchors in `SilentSortingPanel`:
  1. The sort bin area (tell child "Drag each card into its bin").
  2. The sample/preview chip ("Tap here to hear the word").
  3. The finish affordance or the natural end state — keep it soft; auto-dismiss when the child completes the first sort.
- Triggered only when `flags.exercise_tutorials_seen?.silent_sorting !== true`.
- On completion/skip, call `markTutorialSeen('silent_sorting')`.
- Keep the tutorial strictly opt-in for subsequent exercises: do **not** auto-arm tutorials for the other nine exercise types in Phase 4 (v2 plan item 15: pilot first, measure, then roll).

### 3.7 `ChildWrapUpCard` component

`frontend/src/components/childOnboarding/ChildWrapUpCard.tsx`.

- Renders after the REINFORCE beat auto-wrap fires (existing `beginSessionWrapUp` path in `App.tsx`). **Do not modify** the existing timers; only render an additional visual card alongside them.
- Mascot + ≤ 25-word celebratory line + one primary action ("All done"). No analytics. No score exposure (audience scoping already enforced in SessionScreen).
- On dismiss, calls `markWrapUpSeen()` (idempotent; only writes if currently `false`).
- Under reduced motion / forced colors: static card, no confetti/animation.

Tests: renders only when `isChildMode` and REINFORCE wrap-up has been signalled; writes flag once; respects motion/contrast preferences.

### 3.8 Wiring into `App.tsx`

- Adult-side: the adult's session-launch path (`handleParentalConsentSubmit` → existing child-launch branch) is where `useChildUiState(selectedChildId)` is instantiated. After the launch, the adult layer renders `<HandOffInterstitial>` at the top of the child view.
- Child-side: inside the `userMode === 'child'` branch, mount `<ChildSpotlight>` inside `SessionScreen` when the pilot exercise is active, and `<ChildWrapUpCard>` when the existing wrap-up timer resolves.
- Never wrap child subtrees in `OnboardingContext.Provider` (the context is therapist-scoped). `OnboardingRuntime` must keep short-circuiting for child persona.
- Persisted flags are read by the adult hook before transitioning `userMode` → `child`, so the child subtree gets the flags via props, not a context.

### 3.9 Tests

Mandatory:

1. `frontend/src/hooks/useChildUiState.test.ts` — optimistic + outbox + disabled-in-child-context.
2. `frontend/src/components/childOnboarding/ChildMascot.test.tsx` — render, a11y, keyboard, reduced-motion, muted caption.
3. `frontend/src/components/childOnboarding/ChildSpotlight.test.tsx` — anchor resolution, missing-anchor fallback, keyboard, reduced-motion.
4. `frontend/src/components/childOnboarding/HandOffInterstitial.test.tsx` — flag-gated render, one-shot `markMascotSeen`.
5. `frontend/src/components/childOnboarding/ChildWrapUpCard.test.tsx` — render-on-wrap-up, flag write, reduced-motion/forced-colors fallbacks.
6. `frontend/src/childOnboarding/narration.test.ts` — queueing, cancellation, muted mode, caption callback.
7. `frontend/src/childOnboarding/childUiState.test.ts` — schema narrowing + unknown-key dropping.
8. `App.integration.test.tsx` (extend): launching a child session from an adult account renders `HandOffInterstitial` once per child, and zero telemetry events fire across the whole child flow (spy `telemetry.trackEvent`). Returning to an already-seen child skips the interstitial.
9. Regression guard: a test that imports all of `frontend/src/components/childOnboarding/*` and asserts they do not reference `telemetry.trackEvent` directly (simple `fs.readFileSync` grep in a Vitest spec — see `tours.test.ts` for precedent).

### 3.10 Accessibility verification

Add to the existing `e2e`/manual checklist in `docs/onboarding/onboarding-plan-v2.md` §Verification items 13 and 16. No automated a11y framework change required; however, every new component must pass:

- VoiceOver / NVDA announce: caption read; focus order: avatar → caption → primary → secondary.
- Keyboard: tab order identical with `prefers-reduced-motion` on/off.
- Tap targets: measure in the test via `getBoundingClientRect()` snapshots (≥44 px).
- Contrast: add a note to `docs/child-mode-usability-plan.md` referencing the Phase 4 implementation (no new doc file needed).

### 3.11 Bundle + deploy

- Confirm `@floating-ui/react` is a single dep add (pure JS). If the repo already has it transitively via another dep, do not re-add; import directly.
- Lazy-load `childOnboarding/*` behind `React.lazy(() => import('./childOnboarding'))` from App. Child tablets must not pay the cost on adult boots and vice versa.
- `npm run build` must not regress the main entry by >15 KB gzipped from the current baseline.

### 3.12 Out of scope (defer)

- `ui_content_overrides` / admin content editor (Phase 5).
- Rolling tutorials to the other 9 exercise types (v2 item 15: measure `silent_sorting` completion first).
- New telemetry or a child-specific analytics pipeline (prohibited).
- Animations beyond the reused keyframes (no `framer-motion`).
- Translation runtime (`t()` stays dumb).

---

## 4. Execution plan (track with `manage_todo_list`)

1. Audit `BuddyAvatar`, `WuloRobot`, `DashboardHome` keyframes — confirm reusability; note any extraction into a shared CSS file.
2. Create `childOnboarding/` content module (`childUiState.ts`, `copy.ts`, `narration.ts`, `spotlightAnchors.ts`) + their tests.
3. Build `useChildUiState` + tests.
4. Build `ChildMascot` + tests.
5. Build `ChildSpotlight` + tests.
6. Build `HandOffInterstitial` + tests.
7. Wire silent-sorting tutorial; verify anchor testids exist in `SilentSortingPanel`.
8. Build `ChildWrapUpCard` + tests.
9. Wire into `App.tsx` for the adult→child handoff path.
10. Extend `App.integration.test.tsx` telemetry-silence + one-shot handoff assertions.
11. Run full `npx vitest run` and `pytest` (backend must remain green; expect 2 pre-existing `InsightsRail.voice` failures as baseline).
12. `npm run build` — check bundle delta; ensure `childOnboarding-*.js` appears as a lazy chunk.
13. Update `/memories/repo/child-practice-flow.md` only if you discover durable facts not already captured.

---

## 5. Done criteria

- All 5 components (`ChildMascot`, `ChildSpotlight`, `HandOffInterstitial`, `ChildWrapUpCard`, silent-sorting micro-tutorial wiring) shipped with tests.
- `useChildUiState` hook green under optimistic / outbox / disabled scenarios.
- `App.integration.test.tsx` asserts zero telemetry events across a full child session.
- Silent-sorting first-run tutorial fires exactly once per child; never after.
- Wrap-up card renders on REINFORCE auto-wrap without disturbing existing timers.
- No changes to: backend code, migrations, `infra/resources.bicep`, legal copy, v1 plan, `OnboardingContext`, `telemetry.ts` seal logic.
- No new runtime deps except `@floating-ui/react` (if not already present); no `framer-motion`, no `@reactour/*`.
- Full frontend test suite: no new failures beyond the two pre-existing `InsightsRail.voice` tests.
- Full backend test suite: still green.
- Bundle: no regression >15 KB gzipped on main entry; `childOnboarding-*.js` present as a lazy chunk.

When done: post a concise summary (component count, new tests, pass/fail deltas, bundle delta, open follow-ups for Phase 5) and stop for user review.
