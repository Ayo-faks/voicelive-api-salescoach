# Onboarding v2 remediation implementation plan

Source audit: [report.md](./report.md)
Date: 2026-04-23
Scope: implement the shipped-surface fixes from the QA audit for Phases 1-4. Phase 5 remains out of scope until the backend/editor endpoints exist.

## Goals

1. Remove the release-blocking child-mode privacy leak.
2. Make onboarding state deterministic across refreshes and devices.
3. Make guided tours render reliably and readably.
4. Restore observability and the missing write guardrails.
5. Close the remaining P1/P2 issues without widening scope into unrelated product work.

## Delivery strategy

Ship this as four implementation PRs and one cleanup PR, with a focused regression pass after each PR. Do not batch the whole report into one large change set.

## PR1 — Child-mode chrome lockdown (P0)

### Target outcome

A child in child mode can no longer see or reach the adult sidebar, adult identity, help menu, docs links, or sign-out affordance at desktop or mobile widths.

### Primary files

- [frontend/src/app/App.tsx](/home/ayoola/sen/voicelive-api-salescoach/frontend/src/app/App.tsx)
- [frontend/src/components/SidebarNav.tsx](/home/ayoola/sen/voicelive-api-salescoach/frontend/src/components/SidebarNav.tsx)
- Optional new component: `frontend/src/components/childOnboarding/ChildChrome.tsx`

### Implementation steps

1. Introduce a single shell guard in `App.tsx` based on `userMode === 'child'` for all home/session/settings shell rendering.
2. Replace the full `SidebarNav` render path with a minimal child-safe chrome.
3. Remove or hide these controls in child mode:
   - adult name and email
   - sign out
   - help and guided tours button
   - therapist docs
   - privacy / terms / AI notice links if they remain adult-facing shell affordances
   - collapse / expand navigation controls
4. Ensure the mobile hamburger cannot reopen the adult sidebar in child mode.
5. Preserve the child-specific content header and child onboarding orchestrator.
6. If adult exit is still required, move it behind an explicit adult-only handoff or unlock affordance instead of exposing account chrome.

### Acceptance criteria

- No `Dev Therapist`, `dev@localhost`, `Sign out`, `Therapist docs`, or `Help and guided tours` text appears in child mode.
- The mobile nav button does not expose adult controls in child mode.
- Therapist and parent workspace modes still render the normal sidebar.

### Validation

- Manual browser check at 1280x800 and 375x812.
- Targeted DOM assertion or Playwright check for absence of adult strings in child mode.
- Frontend build: `cd frontend && npm run build`

### Risk notes

The shell logic in `App.tsx` is large. Keep the first change as a narrow render-path guard rather than refactoring the full layout in the same PR.

## PR2 — Onboarding source-of-truth unification (P1)

### Target outcome

The app shell decides onboarding status from server-backed `ui_state.onboarding_complete`, not from localStorage. A completed user with a fresh browser profile is not redirected back to `/onboarding`.

### Primary files

- [frontend/src/app/App.tsx](/home/ayoola/sen/voicelive-api-salescoach/frontend/src/app/App.tsx)
- [frontend/src/components/onboarding/OnboardingRuntime.tsx](/home/ayoola/sen/voicelive-api-salescoach/frontend/src/components/onboarding/OnboardingRuntime.tsx)
- [frontend/src/hooks/useUiState.ts](/home/ayoola/sen/voicelive-api-salescoach/frontend/src/hooks/useUiState.ts)
- [frontend/src/services/api.ts](/home/ayoola/sen/voicelive-api-salescoach/frontend/src/services/api.ts)

### Implementation steps

1. Remove the `App.tsx` initializer that reads `wulo.onboarding.complete` directly from localStorage.
2. Drive `onboardingComplete` from `useUiState().state.onboarding_complete`, with a loading-safe fallback during bootstrap.
3. Keep the one-shot legacy migration in `OnboardingRuntime`, but make it a backfill path only; it must no longer be the value that controls routing.
4. Update `handleCompleteOnboarding` so the server-backed state is patched first and localStorage becomes optional compatibility state, not the routing authority.
5. Review all `setOnboardingComplete(...)` call sites in `App.tsx` and either delete them or convert them into UI-local optimism that is reconciled by `useUiState`.
6. Verify authenticated redirect logic around `/onboarding`, `/home`, and invitation redirects so this change does not break family-invite flows.

### Acceptance criteria

- Fresh browser profile + server `onboarding_complete=true` lands on `/home`, not `/onboarding`.
- Completing onboarding updates server state and survives reload.
- Child mode remains excluded from `useUiState` writes.

### Validation

- Browser repro for the split-brain case using cleared localStorage.
- Frontend build: `cd frontend && npm run build`
- Existing frontend tests plus a new focused test around onboarding redirect logic if the routing layer already has coverage.

### Risk notes

This change crosses app bootstrap and onboarding runtime. Do not bundle it with PR1.

## PR3 — Tour usability and rendering reliability (P1)

### Target outcome

Auto tours open as readable anchored dialogs on the intended target instead of a centered beacon, and their tooltip styles render correctly inside the Joyride portal.

### Primary files

- [frontend/src/components/onboarding/TourDriver.tsx](/home/ayoola/sen/voicelive-api-salescoach/frontend/src/components/onboarding/TourDriver.tsx)
- [frontend/src/components/onboarding/WuloTourTooltip.tsx](/home/ayoola/sen/voicelive-api-salescoach/frontend/src/components/onboarding/WuloTourTooltip.tsx)
- [frontend/src/onboarding/tours.ts](/home/ayoola/sen/voicelive-api-salescoach/frontend/src/onboarding/tours.ts)
- Optional related tests under `frontend/src/components/onboarding/`

### Implementation steps

1. Add an anchor-readiness gate before passing `run` to `Joyride`.
2. Wait until the first step selector resolves before launching the tour.
3. Keep `disableBeacon: true`; the fix is to prevent the fallback state, not to style the fallback.
4. Wrap the tooltip content in a `FluentProvider` or otherwise provide concrete colors and shadow so the portal render does not lose Fluent tokens.
5. Localize or override Joyride default labels, especially the beacon/open label.
6. Confirm the welcome-therapist path first, then verify the same mechanism works for the other tours in `tours.ts`.

### Acceptance criteria

- Fresh reset on `/home` opens a visible tooltip on the first step without manual beacon click.
- Tooltip background, text color, and shadow are readable.
- The same tour still marks `tours_seen` on completion.

### Validation

- Browser reset flow for therapist welcome tour.
- Targeted component test for tooltip rendering if feasible.
- Frontend build: `cd frontend && npm run build`

### Risk notes

Do not refactor the full tour system here. Fix only anchor timing, portal styling, and labels.

## PR4 — Observability, backend guardrails, and bundle hygiene (P1)

### Target outcome

Telemetry is actually wired, `/api/me/ui-state` enforces the documented write limit, and `react-joyride` is no longer pulled into the eager framework chunk.

### Primary files

- [frontend/src/services/telemetry.ts](/home/ayoola/sen/voicelive-api-salescoach/frontend/src/services/telemetry.ts)
- Frontend bootstrap file where the app is mounted, likely `frontend/src/main.tsx`
- [frontend/vite.config.ts](/home/ayoola/sen/voicelive-api-salescoach/frontend/vite.config.ts)
- [backend/src/app.py](/home/ayoola/sen/voicelive-api-salescoach/backend/src/app.py)
- [backend/src/config.py](/home/ayoola/sen/voicelive-api-salescoach/backend/src/config.py)
- Optional backend tests around `/api/me/ui-state`

### Implementation steps

1. Wire a real telemetry sink during frontend bootstrap with `registerAppInsightsSink(...)`.
2. Preserve `telemetry.disableForChild()` as the hard stop for child mode.
3. Add a route-specific policy for `/api/me/ui-state` in `_rate_limit_for_request()` instead of relying on the broad mutation bucket.
4. Add backend test coverage for:
   - unknown key still returns 422
   - repeated PATCHes hit 429 at the intended threshold
5. Add an explicit `react-joyride` manual chunk bucket in `vite.config.ts` so it stops falling into `framework`.
6. Rebuild and inspect the output chunk names to confirm the split.

### Acceptance criteria

- At least one therapist onboarding telemetry event reaches the configured sink in non-child mode.
- Child mode still emits nothing through that sink.
- The documented limit for `/api/me/ui-state` is enforced.
- `react-joyride` is no longer bundled into the eager `framework` chunk.

### Validation

- Frontend build: `cd frontend && npm run build`
- Backend tests: `cd backend && /usr/bin/python -m pytest tests/`
- If the backend suite is too broad, start with a focused route test and then run the full suite.

### Risk notes

Keep the telemetry sink abstraction intact. Do not couple App Insights calls directly into onboarding components.

## PR5 — Remaining cleanup and schema tidy-up (P1/P2)

### Target outcome

The remaining medium-priority items are cleaned up without destabilizing the release-critical path.

### Primary files

- [frontend/src/hooks/useChildUiState.ts](/home/ayoola/sen/voicelive-api-salescoach/frontend/src/hooks/useChildUiState.ts)
- [frontend/src/childOnboarding/childUiState.ts](/home/ayoola/sen/voicelive-api-salescoach/frontend/src/childOnboarding/childUiState.ts)
- [backend/src/schemas/ui_state.py](/home/ayoola/sen/voicelive-api-salescoach/backend/src/schemas/ui_state.py)
- [backend/src/services/storage.py](/home/ayoola/sen/voicelive-api-salescoach/backend/src/services/storage.py)
- [frontend/src/onboarding/tours.ts](/home/ayoola/sen/voicelive-api-salescoach/frontend/src/onboarding/tours.ts)
- Related docs in `docs/onboarding/`

### Implementation steps

1. Replace the magic `exercise_type: "__mascot__"` pattern with a dedicated child-ui-state scope or reserved field that does not masquerade as an exercise type.
2. Update backend validation and storage accordingly.
3. Fix anchor/doc drift:
   - remove or add the missing `dashboard-home-create-exercise` anchor
   - align docs that still say `data-tour` with the actual `data-testid` contract
4. Localize or override the remaining Joyride strings.
5. Triage duplicate fetches separately from onboarding if they are confirmed to be StrictMode-only.

### Acceptance criteria

- Child ui-state no longer stores mascot progress as a fake exercise type.
- Tour docs match the real selector contract.
- No release-critical onboarding regressions are introduced.

### Validation

- Focused frontend and backend tests around child ui-state serialization.
- Browser smoke test for mascot first-run path.

### Risk notes

If the mascot sentinel change would require a data migration, split it from the smaller doc/localization fixes.

## Recommended sequencing and checkpoints

1. Merge PR1.
2. Run the child-mode regression from the audit report.
3. Merge PR2.
4. Re-run onboarding redirect checks.
5. Merge PR3.
6. Re-run the therapist fresh-reset welcome-tour flow.
7. Merge PR4.
8. Verify telemetry, rate-limit behavior, and chunk output.
9. Merge PR5.
10. Run the final targeted QA sweep from the report.

## Final regression pass

Re-run these scenarios before closing the audit:

1. Therapist fresh-reset on `/home` with auto-tour.
2. Completed therapist on a fresh browser profile.
3. Child post-handoff at desktop and mobile widths.
4. Child telemetry seal with a real sink registered.
5. Parent and admin tour triggers if shipped.
6. Session-tour path and help-menu replay.
7. Offline or outbox replay for `useUiState` if the route-gate work touched that logic.

## Suggested owners

- Frontend app shell and onboarding: frontend owner
- Backend ui-state policy and tests: backend owner
- Final QA sweep: whoever merges PR4 or PR5, because that is where the highest chance of silent regression remains
