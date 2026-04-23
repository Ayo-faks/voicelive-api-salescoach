# Phase 3 Build Prompt — Coverage Tours + Help Popovers + Parent/Admin Tours

> **Plan of record**: [docs/onboarding/onboarding-plan-v2.md](./onboarding-plan-v2.md), section **Phase 3 — Coverage tours + popovers + parent/admin tours** (items 11–13).
> **Status going into Phase 3**: Phases 1 and 2 have shipped. Backend ui-state endpoints + audit + kill switch are live (397 backend tests passing). Frontend has `useUiState`, `OnboardingRuntime`, `OnboardingContext`/`useOnboarding`, `TourDriver` (lazy `react-joyride@^3`), `HelpMenu`, `EmptyState`, `ChecklistWidget`, `ChecklistContainer`, `AnnouncementBanner`, telemetry shim (`services/telemetry.ts`), and bus (`onboarding/bus.ts`). 309/311 frontend tests passing (the two fails are pre-existing `InsightsRail.voice` tests, unrelated).

You are continuing work on the v2 onboarding system in the `voicelive-api-salescoach` repo. Phase 3 is about **coverage**: fleshing out the tour catalogue, adding contextual help popovers on ambiguous labels, and shipping the two missing welcome tours (`welcome-parent`, `welcome-admin`). No new backend work. No child-mode work (Phase 4).

Respect every repo memory and every governance rule already established in Phases 1–2. Do not modify `docs/onboarding/onboarding-plan.md` (v1 preserved). Do not touch `infra/resources.bicep` `excludedPaths` (`/api/me/ui-state` must stay gated).

---

## 1. Context you must load before writing code

Read in full:
- [docs/onboarding/onboarding-plan-v2.md](./onboarding-plan-v2.md) — especially sections **Phased rollout**, **Accessibility — WCAG 2.2 AA**, **GDPR / UK ICO Children's Code**, **Telemetry funnel**, **Error states & offline**, and **Verification** (items 6–9 are Phase-3-relevant).
- [frontend/src/onboarding/tours.ts](../../frontend/src/onboarding/tours.ts) — registry shape (`TourDefinition`, `TourStep`, `TourRole`, `ALL_TOURS`, `pickAutoTour`, `getTourById`). All Phase-3 tours must conform to this shape and declare both `selector` **and** `testId` on every step (v2 Verification #8).
- [frontend/src/onboarding/tours.test.ts](../../frontend/src/onboarding/tours.test.ts) — headless selector/testId contract. Phase 3 must extend this test so it walks **every** tour in `ALL_TOURS` and asserts the `selector` and `testId` match for every step.
- [frontend/src/onboarding/helpContent.ts](../../frontend/src/onboarding/helpContent.ts) — current `HelpTopic` registry. Phase 3 expands it.
- [frontend/src/onboarding/t.ts](../../frontend/src/onboarding/t.ts) — all user-visible copy must flow through `t(key, defaultEnglish)`.
- [frontend/src/onboarding/events.ts](../../frontend/src/onboarding/events.ts) — event taxonomy (`ONBOARDING_EVENTS.TOUR_STARTED`, `.TOUR_STEP`, `.TOUR_COMPLETED`, `.TOUR_DISMISSED`, `.HELP_OPENED`, etc.). No new event names without adding them here first.
- [frontend/src/components/onboarding/TourDriver.tsx](../../frontend/src/components/onboarding/TourDriver.tsx) — lazy-loaded `react-joyride` wrapper; tooltip is `WuloTourTooltip`.
- [frontend/src/components/onboarding/OnboardingRuntime.tsx](../../frontend/src/components/onboarding/OnboardingRuntime.tsx) — orchestrator. Reuse as-is. Child-persona seal (`telemetry.disableForChild()`) is non-negotiable.
- [frontend/src/components/onboarding/HelpMenu.tsx](../../frontend/src/components/onboarding/HelpMenu.tsx) — the `?` menu that replays tours via the bus (`onboarding/bus.ts`).
- [frontend/src/hooks/useUiState.ts](../../frontend/src/hooks/useUiState.ts) — debounced PATCH + outbox + child gate + 401 fallback. Phase 3 must not change its public API.
- `/memories/repo/voicelive-api-salescoach.md`, `/memories/repo/deploy-arm64-binfmt.md`, `/memories/repo/security-model-current.md`.

Skim:
- [frontend/src/components/InsightsRail.tsx](../../frontend/src/components/InsightsRail.tsx), [frontend/src/components/ProgressDashboard.tsx](../../frontend/src/components/ProgressDashboard.tsx), [frontend/src/components/SessionReview.tsx](../../frontend/src/components/SessionReview.tsx), [frontend/src/components/ChildMemoryPanel.tsx](../../frontend/src/components/ChildMemoryPanel.tsx), [frontend/src/components/FamilyIntakeDialog.tsx](../../frontend/src/components/FamilyIntakeDialog.tsx) *(or nearest equivalent)*, [frontend/src/components/CustomScenarioBuilder.tsx](../../frontend/src/components/CustomScenarioBuilder.tsx) *(or nearest equivalent)*, [frontend/src/components/PracticePlanPanel.tsx](../../frontend/src/components/PracticePlanPanel.tsx) *(or nearest equivalent)*, [frontend/src/components/ProgressReportPanel.tsx](../../frontend/src/components/ProgressReportPanel.tsx) *(or nearest equivalent)*. These are the anchor surfaces for the Phase 3 tours — discover the real filenames via `grep_search`/`file_search` if the names above drift.

---

## 2. Deliverables (in dependency order)

### 2.1 Anchor audit + `data-testid` hardening

Before writing any new tour, scan every target surface and ensure each step's anchor has a **stable** `data-testid`. If an anchor is missing, add it with a minimal, self-documenting name that matches the convention already in use (`insights-rail-*`, `dashboard-*`, `session-review-*`, `child-memory-*`, `family-intake-*`, `custom-scenario-*`, `practice-plan-*`, `progress-report-*`, `planner-readiness-*`, `reports-audience-*`). Do **not** repurpose an existing testid already relied on by a test.

If a surface is feature-flagged or not mounted in all roles, note it in the tour's JSDoc and keep the tour out of `ALL_TOURS` until anchors exist (same pattern already used for `firstSessionTour`).

### 2.2 New tours — Phase 3 catalogue

Add each of the following to `frontend/src/onboarding/tours.ts`. Every tour must:
- Export a named `TourDefinition` constant.
- Use `t()` for all copy; keep adult-tour step bodies ≤ 50 words.
- Declare both `selector` and `testId` per step.
- Provide an `autoTrigger.routePrefix` **only when** the surface is genuinely first-visit-worthy; otherwise leave `autoTrigger` undefined and rely on `HelpMenu` to replay.
- Be added to `ALL_TOURS` only after all anchors exist in the DOM (verified by the expanded contract test in 2.5).
- Carry a `role` gate (`'therapist' | 'admin' | 'parent' | 'pending_therapist'`).

Tours:
1. `insights-rail-tour` — therapist + admin. Anchor on the voice-mode toggle, transcript surface, and coaching feedback panel. Non-auto-trigger (replay via HelpMenu).
2. `dashboard-tour` — therapist + admin. Route prefix `/dashboard`. Anchors: session filter, report card, child memory summary block.
3. `session-review-tour` — therapist + admin. Non-auto; anchored from Dashboard session-card detail flow.
4. `child-memory-review-tour` — therapist + admin. Non-auto; anchored from ChildMemoryPanel (proposals list, target summary, refresh control).
5. `family-intake-tour` — therapist + admin. Route prefix wherever the intake screen lives; steps cover invite, consent collection, child proposal.
6. `custom-scenario-tour` — therapist + admin. Non-auto; triggered from the "New custom scenario" button.
7. `practice-plans-tour` — therapist + admin. Non-auto; anchored in the plan builder.
8. `progress-reports-tour` — therapist + admin. Non-auto; anchored in the report generator. Emphasise audience scoping (parent/school/clinical) — no legal text changes.
9. `planner-readiness-tour` — therapist + admin. Microtour (≤ 3 steps) explaining readiness criteria.
10. `reports-audience-tour` — therapist + admin. Microtour (≤ 3 steps) clarifying the audience dropdown semantics.
11. `welcome-parent` — parent. Route prefix `/home` (or `/family-intake` if that lands first). Covers consent, invitation acceptance, child handover. Keep copy parent-friendly; ≤ 4 steps.
12. `welcome-admin` — admin. Route prefix `/home`. 3–4 steps covering caseload visibility, team settings, export/audit surfaces.

`pickAutoTour` already picks the first eligible auto-trigger tour. Extend if you need multi-auto ordering (e.g., `welcome-parent` vs. `family-intake-tour` on `/home`); the safe default is that a fresh parent sees `welcome-parent` first and `family-intake-tour` becomes available via HelpMenu replay once `welcome-parent` is in `tours_seen`.

### 2.3 Help popovers on ambiguous labels (plan item 12)

- Component: add `frontend/src/components/onboarding/HelpPopover.tsx` — a thin wrapper over Fluent v9 `Popover` + a `QuestionMarkCircleIcon` trigger. Props: `{ topicId: string; children?: ReactNode; placement?: ... }`. Emits `ONBOARDING_EVENTS.HELP_OPENED` with `{ source: 'popover', key: topicId }` when opened; telemetry shim already short-circuits for child persona.
- Registry: extend `frontend/src/onboarding/helpContent.ts` with topics for the ambiguous labels below. Keep `HelpTopic` shape; add optional `anchorKey?: string` if cross-referencing needed. Copy flows through `t()`.
- Roll out popovers on at least these labels (confirm the actual label text in situ — do not assume):
  - InsightsRail: **"Voice mode"**, **"Confidence"**, **"Target sound"**.
  - Dashboard: **"Audience"**, **"Redaction"**, **"Consent state"**.
  - SessionReview: **"Score"**, **"Reference text"**, **"Therapist feedback"**.
  - ChildMemoryPanel: **"Proposals"**, **"Targets"**.
  - ProgressReport: **"Audience"**, **"Release"**.
- Popovers must be keyboard-operable (Enter/Space opens, Esc closes), announce via `aria-live="polite"`, and inherit `prefers-reduced-motion` behaviour (no animation override).

### 2.4 Wiring

- **Do not** introduce a new provider. Reuse `OnboardingContext`/`useOnboarding`.
- Tour mount is already global via `OnboardingRuntime` → `TourDriver`; Phase 3 adds only definitions.
- `HelpMenu` already consumes `HELP_TOPICS` and uses `requestReplayTour(id)` via `onboarding/bus.ts`. Confirm every new tour id is reachable from HelpMenu (either via a topic entry with `replayTourId` or via a generic "Replay a tour" submenu — pick whichever keeps the menu under ~8 items).
- Child persona: double-check that `HelpMenu`, `HelpPopover`, and every new tour short-circuit when `role === 'child'` or `userMode === 'child'`. The gate already exists in `OnboardingRuntime` and `telemetry.disableForChild()` — do not bypass.
- Kill switch: `toursEnabled` already flows from `/api/config.onboarding.tours_enabled` through to `pickAutoTour`; Phase 3 must not add an alternate ignition path.

### 2.5 Tests (Vitest, `jsdom@26.1.0`)

Mandatory new/expanded suites:

1. **`frontend/src/onboarding/tours.test.ts` — expanded**: iterate over `ALL_TOURS` with `describe.each`. For every step assert `step.selector === `[data-testid="${step.testId}"]`` and that `step.title`/`step.body` are non-empty strings. This is the v2 Verification #8 headless anchor-rot guard — make sure it is in place **before** adding tours to `ALL_TOURS`.
2. **`frontend/src/components/onboarding/HelpPopover.test.tsx`**: renders trigger with accessible name; opens on click; emits `HELP_OPENED` telemetry (spy on `telemetry.trackEvent`); closes on Esc; returns null / no-ops when `useOnboarding().disabled === true`.
3. **`frontend/src/onboarding/helpContent.test.ts`**: every `HelpTopic.replayTourId` resolves via `getTourById`; every topic has non-empty `title` and `body`.
4. **Per-surface anchor smoke tests**: for any component where you added new `data-testid` anchors, add or extend the component's existing test to assert the testid is present under normal props.
5. **App-level integration**: extend `App.integration.test.tsx` (or the nearest existing App-level test) to assert:
   - Fresh **parent** sees `welcome-parent` on `/home` and therapist tours stay gated.
   - Fresh **admin** sees `welcome-admin` on `/home`.
   - **Child persona** emits zero telemetry events across any Phase 3 interaction (spy `telemetry.trackEvent`).
6. Do not introduce flake. If you touch `ProgressDashboard.test.tsx` or any timing-sensitive suite, keep changes minimal.

### 2.6 Accessibility

- Every new step body ≤ 50 words.
- Popover triggers have an `aria-label` referencing the label they explain ("More about voice mode").
- Focus management: popover returns focus to trigger on close; tour tooltips inherit `react-joyride@3`'s focus trap (already in use).
- Respect `prefers-reduced-motion` (Popover transitions already comply via Fluent v9).
- Contrast: new `HelpPopover` trigger icon must pass 3:1 against its background in both light and dark themes.

### 2.7 Telemetry

- No new event names beyond those already in `ONBOARDING_EVENTS`. If you need one, add it to `events.ts` **first**, add a property table entry to the v2 plan's Telemetry funnel section, and keep cardinality bounded (no free text, no IDs).
- `HELP_OPENED` property set stays `{ source: 'sidebar'|'popover', key }`. `key` is the topic id (popover) or menu item id (sidebar).

### 2.8 Copy & content governance

- All user-visible strings pass through `t(key, defaultEnglish)`.
- Keys namespaced: `tour.<tour_id>.step<n>.title|body`, `help.<topic_id>.title|body`, `popover.<label_key>.body`.
- No legal-text changes anywhere. Consent, privacy, and audience-scope semantics are explained, not altered.

### 2.9 Out of scope (defer to Phase 4 / Phase 5)

- Child mode (mascot, spotlight, hand-off, wrap-up card).
- `ui_content_overrides` table activation or `/admin/onboarding-content` editor.
- Translation runtime. `t()` stays a dumb pass-through.
- Any backend changes.

---

## 3. Execution plan

Suggested todo ordering (keep one in-progress at a time):

1. Audit anchors on each Phase 3 surface; add missing `data-testid`s.
2. Expand `tours.test.ts` to iterate `ALL_TOURS`.
3. Author `HelpPopover` + unit tests.
4. Extend `helpContent.ts` + its test.
5. Add tours one at a time: after each, run its contract test; only then append to `ALL_TOURS`.
6. Wire new topics into `HelpMenu`.
7. Extend App-level integration tests (fresh parent / admin / child).
8. Run full frontend suite and confirm no regressions beyond the two pre-existing `InsightsRail.voice` failures.
9. Run full backend suite as a smoke test (should be unaffected).

Use `manage_todo_list` throughout.

---

## 4. Done criteria

- All 12 tours declared; the shippable subset added to `ALL_TOURS` (the rest exported but parked with JSDoc explaining the missing anchor, same as `firstSessionTour`).
- Expanded `tours.test.ts` green.
- `HelpPopover` used on the 10+ ambiguous labels listed in 2.3 with passing tests.
- App integration: fresh parent and admin each see their welcome tour once; child persona emits zero telemetry events.
- Full frontend `npx vitest run` — no new failures (baseline: 2 pre-existing InsightsRail voice tests).
- Full backend `pytest` — still green.
- No change to `infra/resources.bicep` `excludedPaths`. No new dependencies. No bundle-budget regression (>15 KB gzipped on main entry per v2 Verification #9).
- `/memories/repo/` notes updated only if you discover a new durable fact.

When done, post a concise summary (tour count, new tests added, pass/fail deltas) and stop for user review before starting Phase 4.
