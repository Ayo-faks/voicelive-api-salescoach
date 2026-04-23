# Onboarding v2 — QA audit report (2026-04-23)

Owner: QA agent (Playwright MCP, read-only)
Commit: `08f72a5181118d5400dd2364189f41e97c179c94` (`08f72a5`)
Plan ref: [onboarding-plan-v2.md](../../onboarding-plan-v2.md)
Implementation plan: [implementation-plan.md](./implementation-plan.md)
Branch shipped: Phases 1, 2, 3, 4. Phase 5 **NOT shipped** (no admin onboarding-content endpoints; surface skipped per scope).

## Summary

| Metric                                   | Value |
| ---------------------------------------- | ----- |
| Test IDs attempted                       | 23    |
| PASS                                     | 11    |
| FAIL                                     | 9     |
| Not exercised (skipped/deferred)         | 3     |
| **P0 findings**                          | **1** |
| **P1 findings**                          | **7** |
| **P2 findings**                          | **4** |

**Top 3 defects to fix first**

1. **[P0] Child mode leaks adult therapist sidebar + PII + Sign-out control** — a child in child-mode persona sees the adult therapist's full sidebar including the adult's name + email, "Therapist docs" link, "Sign out" button, and help menu. (Finding `C-SIDEBAR-LEAK`.)
2. **[P1] Welcome tour never reaches tooltip: tooltip styles collapse + beacon still renders despite `disableBeacon: true`** — tour mounts, user sees a floating beacon at page centre; clicking it reveals a near-invisible tooltip (Fluent tokens do not resolve inside the Joyride portal). (Findings `P3-BEACON-RACE`, `P3-TOOLTIP-TRANSPARENT`.)
3. **[P1] Telemetry sink is wired nowhere — Tier-A onboarding funnel is unmeasurable today** — `registerAppInsightsSink` is exported but never called; `telemetry.trackEvent` is a permanent no-op. The "child emits nothing" seal is therefore vacuous and the whole onboarding funnel is un-instrumented. (Finding `F-TELEMETRY-NOT-WIRED`.)

## Environment

| Item                  | Value                                                                          |
| --------------------- | ------------------------------------------------------------------------------ |
| Commit                | `08f72a5` (`main`)                                                             |
| Backend               | Flask `src/main.py` on `0.0.0.0:8001`, SQLite `data/wulo.db`                   |
| Backend env           | `LOCAL_DEV_AUTH=true`, `LOCAL_DEV_USER_ROLE=therapist`, `LOCAL_DEV_USER_ID=dev-therapist-001`, `INSIGHTS_RAIL_ENABLED=true`, `INSIGHTS_VOICE_MODE=push_to_talk` |
| SPA                   | Prebuilt assets served from `frontend/static/` by the Flask backend (no Vite in the loop) |
| Browser               | Chromium via Playwright MCP (UA reports Chrome 147)                            |
| Viewports             | 1280×800 (desktop), 375×812 (mobile)                                           |
| Personas exercised    | therapist (full), child (full), admin (bundle + infra only), parent (bundle + infra only) |
| Dataset               | Workspace `workspace-c5f4c29bb8e2`; child `child-93c14c056994` ("john", scenario `k-silent-sorting`) |

Artefacts directory: `docs/onboarding/qa/2026-04-23/`
 - `network/` — saved HAR-like probe outputs (this tree)
 - `snapshots/` — DOM anchor probe outputs (this tree)
 - Playwright screenshots are held inside the MCP sandbox (`.playwright-mcp/` on the agent host); each finding below names the screenshot it was taken from.

---

## Findings

### P0

#### `C-SIDEBAR-LEAK` — Child mode exposes adult sidebar, PII and Sign-out
- **Observed:** After the HandOffInterstitial is dismissed and child mode is entered (`localStorage['wulo.user.mode']='child'`), the home route renders the full therapist chrome:
  - `<aside>` containing "Therapist docs" link to wulo.ai/documentation, "Privacy", "Terms", "AI notice", a "`?` — Help and guided tours" button, "Collapse sidebar" button, and — critically — the adult account block: avatar letter "D", display name **"Dev Therapist"**, email **"dev@localhost"**, and a **"Sign out" button**.
  - At 375×812 the sidebar collapses to a hamburger; the same controls remain reachable in one tap.
- **Expected (plan v2 §Tier B #2–#5 and ICO Children's Code §3, §7, §11, §13):** Child persona must render a minimal, child-safe chrome. Adult identity, account-management, external docs links and "Sign out" must not be reachable without an age-appropriate unlock.
- **Reproduction:**
  1. Sign in as therapist, open child `child-93c14c056994`, click "Hand to child".
  2. Dismiss HandOffInterstitial with "Start".
  3. Inspect `<aside>` — all controls above are present and tappable.
- **Evidence:** `child-post-handoff.png`, `child-post-handoff-375.png`; DOM snapshot recorded in this report (see snapshot block above this file was written from).
- **Suspected cause:** `frontend/src/app/App.tsx` renders `<Sidebar>` unconditionally; there is no `mode === 'child'` guard around the sidebar / account block. The child-mode switch only affects the main panel (mascot + spotlight overlay) — chrome is untouched.
- **Proposed fix:** When `useUserMode() === 'child'`, render `<ChildChrome>` (logo + child name + discreet adult-unlock tap target) in place of `<Sidebar>`. Add Playwright regression: in child mode, `queryAllByText(/sign out|therapist docs|dev@/i)` must be `[]`.

### P1

#### `F-SPLIT-BRAIN-GATE` — Onboarding-complete flag split between localStorage and server `ui_state`
- **Observed:** `frontend/src/app/App.tsx:877` drives the onboarding redirect from `localStorage.getItem('wulo.onboarding.complete') === 'true'`. The server's `ui_state.onboarding_complete` (written by `useUiState` and persisted via `PATCH /api/me/ui-state`) is **not** consulted by this guard.
- **Impact:** A returning user on a new device / fresh browser profile — whose server `ui_state` already says `onboarding_complete: true` — is still redirected to `/onboarding` because localStorage is empty. Directly contradicts plan v2 Tier-A §1 ("server as source of truth").
- **Reproduction:**
  1. As a user whose `GET /api/me/ui-state` returns `{"onboarding_complete": true}`, run `localStorage.clear()` and reload `/home`.
  2. Redirected to `/onboarding`.
- **Evidence:** confirmed live during this session: after `localStorage.clear()` + `DELETE /api/me/ui-state`, the redirect fires exactly as above; the converse (server says done, LS empty) is the same codepath.
- **Suspected cause:** `frontend/src/app/App.tsx:877` and `App.tsx:3017`, `App.tsx:3636`.
- **Proposed fix:** Replace the `useState(() => localStorage.getItem(…))` initialiser with the already-present `useUiState()` hook; treat LS only as an optimistic pre-hydration hint that is reconciled on first `ui_state` load.

#### `P3-BEACON-RACE` — Welcome tour shows a centred beacon instead of the first tooltip
- **Observed:** After a clean reset (`DELETE /api/me/ui-state`, `localStorage.clear()`) and fresh sign-in, the welcome-therapist tour mounts on `/home` but renders as a 36×36 yellow beacon at the page centre (`aria-label="Open the dialog"`), not as the step-1 tooltip anchored on `[data-testid="dashboard-home-greeting"]`. The tour sits there indefinitely; a user must find + click the beacon to proceed.
- **Expected (plan v2 Tier B §6):** `disableBeacon: true` means the tooltip auto-opens on the first anchor.
- **Reproduction:**
  1. Reset as above and navigate to `/home`.
  2. Within ~1s the beacon appears at ~(774,630); no tooltip is rendered until the beacon is clicked.
- **Evidence:** `therapist-fresh-welcome-tour.png`, `therapist-tour-beacon-clicked.png`.
- **Suspected cause:** `frontend/src/components/onboarding/TourDriver.tsx:62-70` — `Joyride` is mounted with `run` immediately, but the `[data-testid="dashboard-home-greeting"]` node has not yet mounted on the first commit (dashboard data is still streaming). React-joyride v3 falls back to `placement: 'center'` with a beacon when the selector does not resolve. The `placement: step.placement ?? 'auto'` default compounds the fallback.
- **Proposed fix:** Gate `run` on an "anchor ready" check (e.g. a `useLayoutEffect` + `requestAnimationFrame` polling until the first selector is in DOM), or set explicit `placement` on each step and use `spotlightClicks: false`. Ideally move to `stepIndex`-controlled mode and advance only after `DOM.querySelector(step.selector)` resolves.

#### `P3-TOOLTIP-TRANSPARENT` — Tour tooltip renders without Fluent tokens (unreadable)
- **Observed:** When the beacon is forced open, the `<div data-testid="wulo-tour-tooltip">` is rendered but the Fluent CSS custom properties (`tokens.colorNeutralBackground1`, `tokens.shadow28`, etc.) resolve to empty strings. Background is transparent, shadow absent, body text overlaps the page content beneath; the Fluent `Text` child is also unstyled. The dialog is effectively invisible.
- **Expected:** Opaque card with Fluent background/foreground tokens, max-width 360 px, drop-shadow (per styles in `WuloTourTooltip.tsx:40-55`).
- **Reproduction:** open beacon → inspect `[data-testid="wulo-tour-tooltip"]`; computed style `background-color` is `rgba(0,0,0,0)`.
- **Evidence:** `therapist-tour-beacon-clicked.png`.
- **Suspected cause:** react-joyride portals its tooltip into `document.body`, which sits **outside** the app's `<FluentProvider>`. Fluent tokens only resolve inside that provider (it attaches the `--colorNeutralBackground1: …` etc. CSS vars to its root). See `frontend/src/components/onboarding/TourDriver.tsx:105` (`tooltipComponent={WuloTourTooltip}`) and `frontend/src/components/onboarding/WuloTourTooltip.tsx:40-55`.
- **Proposed fix:** Wrap the tooltip body in a nested `<FluentProvider theme={…}>` so tokens resolve inside the portal, or replace Fluent tokens with hard-coded hex + shadow in `WuloTourTooltip.tsx`.

#### `F-TELEMETRY-NOT-WIRED` — Telemetry sink is never registered; funnel metrics are dead
- **Observed:** `frontend/src/services/telemetry.ts:60` exports `registerAppInsightsSink`. A workspace-wide `grep -R "registerAppInsightsSink" frontend/src/` returns exactly ONE match — the definition itself. Nothing calls it. Therefore every `telemetry.trackEvent(…)` call in the codebase is a no-op (or, in dev, a `console.debug`).
- **Impact:** The v2 plan designates App Insights as the system of record for the onboarding funnel. Today that funnel produces zero signal. Also makes the "child mode emits nothing" seal untestable as a runtime property — which is itself flagged as a secondary risk below.
- **Reproduction:** `grep -R "registerAppInsightsSink" voicelive-api-salescoach/frontend/src/`.
- **Evidence:** see `network/C-10-child-mode-zero-telemetry.txt`.
- **Suspected cause:** Tier-A #6 in the plan was sequenced after first release but no follow-up wire-up was scheduled. `telemetry.ts:56-61` is the entire hook.
- **Proposed fix:** Wire App Insights in `frontend/src/main.tsx` (or equivalent bootstrap) behind a build-time flag; call `registerAppInsightsSink` with the SDK's `trackEvent`. Add an E2E that installs a fake sink and asserts at least one `trackEvent` fires for the canonical happy-path (therapist → completes welcome tour).

#### `P3-JOYRIDE-CHUNK-LEAK` — `react-joyride` bundled into the eagerly-loaded framework chunk
- **Observed:** Despite being `React.lazy(() => import('react-joyride'))` in `TourDriver.tsx:33-36`, the joyride implementation lands in `framework-BaX54NV-.js` (737 KB raw / ~234 KB gz) which is loaded on first paint for every user — including users who never enter onboarding.
- **Expected:** Joyride lives in its own on-demand chunk (expected ~60–80 KB gz), loaded only when `<TourDriver>` mounts.
- **Reproduction:** `ls -lh frontend/static/js/` and inspect `framework-*.js`; `grep -l "react-joyride\|Joyride" frontend/static/js/*.js`.
- **Evidence:** bundle scan; `frontend/vite.config.ts:3-38`.
- **Suspected cause:** `vite.config.ts:3-38` `getPackageChunkName` has a catch-all `return 'framework'` for any `node_modules` package whose name doesn't match the explicit allow-list (`charts`, `fluent`, `react`). `react-joyride` isn't listed, so Rollup hoists it into `framework`.
- **Proposed fix:** Add `react-joyride` (and any `react-floater` transitive) to a dedicated `tour` chunk in `getPackageChunkName`; verify with `rollup-plugin-visualizer` that `framework` drops by the expected delta (~100+ KB).

#### `F-RATE-LIMIT-MISSING` — `PATCH /api/me/ui-state` has no rate limit
- **Observed:** 62 sequential PATCHes under <1 s all returned 200. No 429s emitted. See `network/F-03-F-04-rate-limit-and-schema.txt`.
- **Expected:** Plan Tier A §2 states "rate limit 60/min per user-key".
- **Suspected cause:** Route in backend (around `src/routes/me.py` or `src/routes/ui_state.py`) does not decorate with the existing rate-limit middleware.
- **Proposed fix:** Attach the same bucket already applied to auth routes; add a regression test (pytest + Flask test client) for "61st request in 60 s ⇒ 429".

#### `C-02-MASCOT-SENTINEL-TYPE` — Child first-run key uses magic-string `exercise_type: "__mascot__"`
- **Observed:** First-run mascot ack fires `PUT /api/children/child-93c14c056994/ui-state` with body `{"exercise_type":"__mascot__","first_run":true}`. `__mascot__` is not a real exercise type; it's abusing the `exercise_type` column as a discriminated namespace.
- **Impact:** Analytics aggregating by `exercise_type` will see a phantom `__mascot__` type. Schema future-proofing is fragile.
- **Proposed fix:** Introduce a `scope` field (`scope: "mascot" | "exercise"`) or move mascot state to a dedicated key on child ui_state.
- **Evidence:** `network/C-10-child-mode-zero-telemetry.txt` (last line of the PUT section).

### P2

#### `D-DUPLICATE-FETCHES` — Many `/api/children/{id}/…` endpoints fire 2-3× on mount
- **Observed:** On child selection, `sessions`, `plans`, `reports`, `memory/summary`, `memory/items`, `memory/proposals`, `recommendations` each fire 2× within the same ms. Double-invoke pattern, not a genuine refresh.
- **Suspected cause:** React 18 StrictMode double-effect in dev or unstable deps in child-selection context. Check `frontend/src/hooks/useChildQueries.ts` (or equivalent) for non-memoised `useEffect` deps.
- **Impact:** Bandwidth waste, noise in analytics, potential server log volume. Not onboarding-specific but surfaced during this audit.

#### `P3-ANCHOR-DRIFT` — `dashboard-home-create-exercise` anchor referenced but missing
- **Observed:** Plan / docs reference a `dashboard-home-create-exercise` target; no element with that `data-testid` is present on `/home`. See `snapshots/P3-10-anchor-rot-home.txt`. No tour step actually uses it today so runtime is OK, but the spec is stale.
- **Fix:** Remove the stale reference or add the anchor to `DashboardHome`.

#### `P3-DOC-MISNAMES-TOUR-ATTR` — Plan says `data-tour="…"`, code uses `data-testid`
- **Observed:** `docs/onboarding/onboarding-plan-v2.md` (Tier B §6) says anchors use `data-tour`. Implementation uses `data-testid`. Runtime is fine (tours.ts matches what's in DOM) but the spec is misleading.
- **Fix:** Update plan doc.

#### `P3-BEACON-ARIA-NOT-LOCALISED` — Default joyride aria-label "Open the dialog"
- **Observed:** Beacon exposes `aria-label="Open the dialog"`, the Joyride default. Not localised through the app's i18n pipeline and not child-reading-age appropriate (even though beacon shouldn't fire at all — see `P3-BEACON-RACE`).
- **Fix:** Pass `locale={{ open: t('tour.beaconOpenLabel') }}` to `<Joyride>` alongside `next`, `back`, `skip`, `last`, `close`.

---

## Passes (evidenced)

- **`F-01` GET `/api/me/ui-state` fires once on boot, 200 OK** with full payload (tours_seen, checklist, flags).
- **`F-04` Unknown key ⇒ 422** with `{"details":["unknown field 'x'"],"error":"invalid_ui_state_patch"}` — see `network/F-03-F-04-rate-limit-and-schema.txt`.
- **`P1-01` Existing therapist is NOT redirected to `/onboarding`** when their `ui_state.onboarding_complete` is true (as long as LS matches — see split-brain finding).
- **`P2-01` ChecklistWidget mounts on `/home`** with the "Getting started" region exposed as `data-testid="onboarding-checklist"`, 2/5 steps complete, 5 items rendered.
- **`P2-02` Auto-tick** — "Add your first child" and "Run your first session" tick immediately when the underlying data exists (observed: both ticked after session fixture created).
- **`P3-10-partial` Anchors present for welcome-therapist tour steps 1–4** on `/home` (see `snapshots/P3-10-anchor-rot-home.txt`).
- **`C-01` HandOffInterstitial dialog renders in child mode** with correct copy ("Hand the device to your child") + "Start" primary button.
- **`C-02` First-run mascot ack PUT fires exactly once** — `PUT /api/children/{id}/ui-state {"exercise_type":"__mascot__","first_run":true}` → 200. (But see P1 `C-02-MASCOT-SENTINEL-TYPE` above for the schema smell.)
- **`C-10-caveated` No network telemetry beacons during child mode** — zero requests to App Insights, Clarity, `/api/events`, `/api/telemetry` during full child flow. **Caveat:** this is vacuous today because the telemetry sink is never wired (`F-TELEMETRY-NOT-WIRED`).
- **`INFRA-01` Easy-Auth `excludedPaths` do NOT leak onboarding endpoints** — `infra/resources.bicep:705-730` excludes only SPA routes + `/api/health`; none of `/api/me/ui-state`, `/api/children/*/ui-state`, `/api/admin/onboarding-content` appear.
- **`P3-CHUNKING-PARTIAL`** — the lazy import split is observable (a small `index--gwanioE.js` 17 KB chunk holds `ChildOnboardingOrchestrator`, `ChildMascot`, `ChildSpotlight`, `ChildWrapUpCard`, `HandOffInterstitial`, `SilentSortingTutorial`); only Joyride's framework-chunk leak (P1 above) spoils the otherwise clean split.

---

## Not exercised (explicit)

- **Phase 5 (admin onboarding content editor)** — no server endpoints shipped; skipped per scope.
- **`F-05` Offline outbox replay, `F-06` Parent GET scope enforcement, `F-07` Pending-therapist redirect** — not exercised; requires additional personas + seeded data.
- **`C-03`…`C-09`, `C-11`…`C-15`** — not fully exercised (tutorial spotlight, mascot caption ≤25 words, 44×44 tap targets, reduced-motion / forced-colors rendering, TTS queue, anchor-loss recovery, offline first-run, keyboard flow, wrap-up card). An attempt to click "Start practice" would have driven into a Voicelive WebSocket session and a microphone-permission prompt outside Playwright's capability envelope here; deferred to a future manual/automation pass with mic stubbing. The mascot component on `/home` itself renders (`Meg — "Your practice buddy is ready…"`) with legible copy and adequate touch targets at both viewports.
- **`P3-02`…`P3-09`, `P3-11`, `P3-12`** — Esc-to-dismiss, returning-user-no-retrigger, session-tour, reports-tour, parent/admin personas end-to-end, help-popover-anchored, reduced-motion, kill-switch — deferred.

---

## Open questions

- Is the tour-beacon race deterministic on slower devices or only on Playwright's fast mount? (needs throttling repro.)
- Are the duplicate `/api/children/{id}/*` fetches a StrictMode artefact (dev only) or a genuine double-invoke in production builds? Worth a prod-build re-check.
- What is the intended contract for `child ui-state.exercise_type` — is `__mascot__` documented anywhere, or is it an improvisation?
- Phase 5 schedule — is admin onboarding-content editing formally descoped or merely deferred?

---

## Execution order

1. **Fix the release blocker first:** ship `<ChildChrome>` or otherwise gate `<Sidebar>` behind `mode !== 'child'` so child mode cannot expose the adult account block, sign-out control, help menu, or external docs links. (`C-SIDEBAR-LEAK`.)
2. **Stabilise onboarding correctness:** collapse the onboarding-complete gate to a single server-backed source of truth so a fresh browser does not regress a completed user back to `/onboarding`. (`F-SPLIT-BRAIN-GATE`.)
3. **Make the tour usable:** fix the first-anchor race in `TourDriver` and fix the transparent tooltip rendering in `WuloTourTooltip` so the welcome tour opens as an anchored, readable dialog instead of a stray beacon. (`P3-BEACON-RACE`, `P3-TOOLTIP-TRANSPARENT`.)
4. **Restore observability and guardrails:** wire `registerAppInsightsSink`, add the missing `PATCH /api/me/ui-state` rate limit, and split `react-joyride` into its own chunk. (`F-TELEMETRY-NOT-WIRED`, `F-RATE-LIMIT-MISSING`, `P3-JOYRIDE-CHUNK-LEAK`.)
5. **Clean up the remaining P1/P2 debt:** rename the mascot sentinel state off `exercise_type: "__mascot__"`, then tackle duplicate fetches, anchor/doc drift, and Joyride string localisation. (`C-02-MASCOT-SENTINEL-TYPE`, `D-DUPLICATE-FETCHES`, `P3-ANCHOR-DRIFT`, `P3-DOC-MISNAMES-TOUR-ATTR`, `P3-BEACON-ARIA-NOT-LOCALISED`.)
6. **Rerun the focused release-regression pass:** therapist fresh-reset welcome tour, child post-handoff at desktop and mobile widths, session-tour and parent/admin personas, child accessibility matrix with a microphone stub, and an offline/StrictMode-disabled rerun of the failing cases.
