# Onboarding QA Prompt — Live Browser Audit of Phases 1–4 (+ Phase 5 if shipped)

> **Purpose:** Drive a live, hands-on QA pass of the onboarding v2 implementation using the **Playwright MCP browser** (preferred) or the VS Code Simple Browser as a fallback. You will exercise every onboarding surface as each persona, capture real flaws (not theoretical ones), and produce a prioritised triage report. This is a **test-and-diagnose** job, not a build job — do not change production code unless the user explicitly approves a fix after the report lands.

---

## 0. Ground rules

1. **Read-only by default.** Do not edit `frontend/src/**` or `backend/src/**` code. You may write test fixtures, seed scripts, and the final report under `voicelive-api-salescoach/docs/onboarding/qa/`.
2. **No destructive actions.** No `git push`, no `azd deploy`, no database drops. Local SQLite + local dev server only unless the user asks for a Postgres run.
3. **Use real browser sessions**, not Vitest. Vitest is fast but misses the bugs that matter here — timing, focus, z-index, pointer events, network ordering, reduced-motion, forced-colors, keyboard traps.
4. **Prefer the Playwright MCP tools** (`mcp_playwright_browser_*`) over the VS Code built-in browser. Playwright gives you: `snapshot` (DOM + a11y tree), `console_messages`, `network_requests`, `evaluate`, `press_key`, `take_screenshot`, forced-colors + reduced-motion emulation. The VS Code Simple Browser is only a visual sanity fallback — it has no DevTools and no scripting hook.
5. **Capture evidence for every finding.** Each bug entry must link to a screenshot, a console excerpt, a network-log excerpt, or a DOM snapshot. "Looks broken" without artefacts is not a finding.
6. **Do not trust passing tests.** The existing Vitest suite is green for Phase 2 but that is not the system of record here. Trust only what you observed in the browser.
7. **Children's Code audit is mandatory.** Any observed telemetry call fired in child mode is a **P0 block** regardless of anything else.

---

## 1. Context to load first

- [docs/onboarding/onboarding-plan-v2.md](../onboarding-plan-v2.md) — complete.
- [docs/onboarding/phase3-prompt.md](../phase3-prompt.md), [phase4-prompt.md](../phase4-prompt.md), [phase5-prompt.md](../phase5-prompt.md) — done-criteria you are auditing against.
- `scripts/start-local.sh` — local dev entrypoint. Note: defaults `LOCAL_DEV_AUTH=true`, `LOCAL_DEV_USER_ROLE=therapist`, backend on the port you pass via `PORT`, SPA on `5173`. You will flip role per persona.
- `frontend/src/onboarding/events.ts` — the event taxonomy you will spy on.
- `frontend/src/services/telemetry.ts` — the `disableForChild()` seal.
- `/memories/repo/voicelive-api-salescoach.md`, `/memories/repo/security-model-current.md`, `/memories/repo/deploy-arm64-binfmt.md`.

Also read, to know what "done" looks like per phase:

- Phase 1: `useUiState`, `OnboardingContext`, `OnboardingRuntime`, migration `20260423_000023_user_ui_state.py`, `/api/me/ui-state` + `/api/children/{id}/ui-state`.
- Phase 2: `ChecklistWidget`, `AnnouncementBanner`, `ChecklistContainer`, `EmptyState`.
- Phase 3: coverage tours (`welcome-therapist`, `first-session`, `reports-audience`, `planner-readiness`, `welcome-parent`, `welcome-admin`), `WuloTourTooltip`, `HelpMenu`, `HelpPopover`.
- Phase 4: `ChildMascot`, `ChildSpotlight`, `HandOffInterstitial`, `ChildWrapUpCard`, `useChildUiState`, silent-sorting pilot.
- Phase 5 (only if shipped): `/admin/onboarding-content` editor + `/api/content/onboarding` + read-through `t.ts`.

---

## 2. Environment bring-up

Do this once at the start of the run and leave it up for the whole audit.

### 2.1 Start services

Backend (SQLite, local dev auth, insights rail on):

```bash
cd /home/ayoola/sen/voicelive-api-salescoach
source /home/ayoola/sen/.venv/bin/activate
set -a && [[ -f .env ]] && source .env && set +a
PORT=8001 \
INSIGHTS_RAIL_ENABLED=true \
INSIGHTS_VOICE_MODE=push_to_talk \
LOCAL_DEV_AUTH=true \
LOCAL_DEV_USER_ROLE=therapist \
PUBLIC_APP_URL=http://127.0.0.1:5173 \
./scripts/start-local.sh
```

(The two previous boot attempts in this session exited with 143 — that is SIGTERM from the harness, not a crash. Use the `execution_subagent` tool with `mode=async` and `timeout=30000` so the long-running server does not time out.)

Frontend:

```bash
cd /home/ayoola/sen/voicelive-api-salescoach/frontend
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Confirm both are live by `curl -fsS http://127.0.0.1:8001/api/health` (or the equivalent health path) and `curl -I http://127.0.0.1:5173/`.

### 2.2 Persona switching

`LOCAL_DEV_AUTH=true` mints a dev user from env vars. To switch persona, restart the backend with one of:

- **Therapist (baseline)**: `LOCAL_DEV_USER_ROLE=therapist LOCAL_DEV_USER_ID=dev-therapist-001`
- **Admin**: `LOCAL_DEV_USER_ROLE=admin LOCAL_DEV_USER_ID=dev-admin-001`
- **Parent**: `LOCAL_DEV_USER_ROLE=parent LOCAL_DEV_USER_ID=dev-parent-001`
- **Pending therapist**: `LOCAL_DEV_USER_ROLE=pending_therapist LOCAL_DEV_USER_ID=dev-pending-001`
- **Child context**: the adult (therapist or parent) switches the app into child mode from inside the UI (`handleChooseMode`) after parental consent. There is no `LOCAL_DEV_USER_ROLE=child`; the child persona is an in-app mode, not an auth role.

Between personas: stop backend (`Ctrl-C`), clear any frontend `localStorage` that caches persona state (use Playwright `evaluate` → `localStorage.clear()`), restart backend with new env, reload `/`.

To reset onboarding flags for a persona mid-audit: call `DELETE /api/me/ui-state` with the dev cookie. Provide a tiny helper:

```bash
# reset therapist onboarding state
curl -fsS -X DELETE http://127.0.0.1:8001/api/me/ui-state --cookie-jar /tmp/devcookies --cookie /tmp/devcookies
```

(If a cookie jar is not already set up, open the app in the browser first, then copy the `Cookie` header via Playwright `evaluate(() => document.cookie)`.)

### 2.3 Browser

Prefer Playwright MCP. Boot a page:

- `mcp_playwright_browser_navigate` → `http://127.0.0.1:5173/`
- `mcp_playwright_browser_snapshot` for the a11y tree
- `mcp_playwright_browser_network_requests` after each interaction to verify onboarding + telemetry endpoints
- `mcp_playwright_browser_console_messages` to catch React warnings / Fluent UI issues / focus-trap throws

Emulation for accessibility passes:

- Reduced motion: `mcp_playwright_browser_evaluate` → `matchMedia('(prefers-reduced-motion: reduce)').matches` should be forced to `true`. Use `mcp_playwright_browser_run_code` with a Playwright context emulation snippet: `await page.emulateMedia({ reducedMotion: 'reduce' })`.
- Forced colors: `await page.emulateMedia({ forcedColors: 'active' })`.
- Viewport: repeat full audit at 375×812 (child tablet portrait) and 1280×800 (therapist laptop).

---

## 3. Test matrix

For each row: execute the steps, capture evidence, log findings to the report.

### 3.1 Phase 1 — Foundation (Tier A)

| ID | Persona | Step | Expect | Evidence |
|---|---|---|---|---|
| F-01 | Therapist | Boot app, inspect network | `GET /api/me/ui-state` fires once, returns `{}` on fresh user | network log |
| F-02 | Therapist | Trigger any dismissal (e.g., banner close) | `PATCH /api/me/ui-state` fires with *only* the changed key | network log + audit row (query `ui_state_audit`) |
| F-03 | Therapist | Send 61 PATCHes in 60 s via `evaluate` | 61st returns 429 | console + network |
| F-04 | Therapist | Send PATCH with unknown key via `evaluate` | 422 | network |
| F-05 | Therapist | Offline toggle (Playwright `context.setOffline(true)`), dismiss, reload with online | Flag still applied (outbox replayed) | localStorage + network |
| F-06 | Parent | `/api/children/{id}/ui-state` GET | 200 only for their own children | network |
| F-07 | Pending therapist | Any onboarding endpoint | Either 403 or a degraded experience, never 500 | network |
| F-08 | Therapist | Inspect `OnboardingContext` via React DevTools or window probe | `disabled: false` for therapist, `true` for child | screenshot |

### 3.2 Phase 2 — Checklist + Announcements + EmptyStates

| ID | Persona | Step | Expect | Evidence |
|---|---|---|---|---|
| P2-01 | Therapist fresh | Reach DashboardHome | Checklist widget visible, all items un-ticked | screenshot |
| P2-02 | Therapist | Create first child (or seed via API) | Checklist ticks "Add child" automatically without reload | screenshot + network |
| P2-03 | Therapist | Dismiss announcement | Banner disappears, `PATCH` fires, does not return on reload | network + screenshot |
| P2-04 | Therapist | Complete all checklist items | Widget collapses / hides per design | screenshot |
| P2-05 | Parent | DashboardHome | Parent-scoped checklist, not therapist's | screenshot |
| P2-06 | Child mode | DashboardHome | Checklist + banner NOT rendered (child seal) | snapshot (no matching nodes) |
| P2-07 | Any | Empty states for Sessions, Reports, Children | Each renders `EmptyState`, not a blank screen | screenshot each |
| P2-08 | Therapist | Keyboard-only pass | Banner dismiss + checklist items reachable via Tab, operable via Enter/Space | video / sequential snapshots |
| P2-09 | Therapist | Forced colors emulation | Banner + checklist use `CanvasText`/`Canvas`, still legible | screenshot |

### 3.3 Phase 3 — Coverage tours, Help

| ID | Persona | Step | Expect | Evidence |
|---|---|---|---|---|
| P3-01 | Therapist fresh | First login | `welcome-therapist` auto-fires, all steps have anchor nodes | screenshot each step |
| P3-02 | Therapist | Press `Esc` mid-tour | Tour dismisses, `tours_seen` patched, does not re-fire on reload | network |
| P3-03 | Therapist returning | Login | No tour auto-fires | network (no tour GET / telemetry `tour_started`) |
| P3-04 | Therapist | Navigate to `/session` first time | `first-session` fires | screenshot |
| P3-05 | Therapist | Reports with mixed audience | `reports-audience` micro-tour fires | screenshot |
| P3-06 | Admin fresh | Login | `welcome-admin` fires, covers workspace switch in `SidebarNav`/`SettingsView` | screenshot |
| P3-07 | Parent fresh (via family-intake) | Login | `welcome-parent` covers consent + propose children | screenshot |
| P3-08 | Any | Help menu (sidebar) | Opens, keyboard accessible, lists role-relevant entries | snapshot + screenshot |
| P3-09 | Any | Help popover on a field with `data-tour="…"` | Renders anchored, `Esc` dismisses, focus returns to field | snapshot |
| P3-10 | Any | **Anchor rot check** — for every tour, assert every step's selector exists | No warnings in console, no missing-anchor silent failures | console log + evaluate script iterating over `tours.ts` |
| P3-11 | Therapist | Reduced motion on | Tour renders without slide-in animation | screenshot |
| P3-12 | Therapist | Kill switch: `ONBOARDING_TOURS_ENABLED=false`, redeploy locally | No tour fires; `/api/config` returns `false` | restart + network |
| P3-13 | Therapist | Telemetry spy | `onboarding.tour_started/step_viewed/completed` fire with bounded props (no free text, no IDs) | network payload inspection |
| P3-14 | Therapist | Bundle sanity | `curl -s http://127.0.0.1:5173/ | grep -i joyride` ⇒ no eager load; network shows tour chunk loaded only on tour arm | network |

### 3.4 Phase 4 — Child mode (the highest-risk phase)

> If Phase 4 has not yet been implemented, record that and skip — do not invent findings.

| ID | Step | Expect | Evidence |
|---|---|---|---|
| C-01 | Therapist starts a child session on `silent_sorting` | `HandOffInterstitial` renders first, once per child | screenshot + network |
| C-02 | Dismiss handoff | `markMascotSeen` writes via `PUT /api/children/{id}/ui-state` from the adult side; child subtree itself does not hit the endpoint | network log + `child_ui_state` row |
| C-03 | Child mascot appears | ≤25 words in caption; `aria-live` hidden mirror present; buttons ≥44×44 CSS px (measure via `getBoundingClientRect`) | snapshot + evaluate probe |
| C-04 | First-run silent-sorting spotlight | Mask positioned over bins; pulse reuses existing keyframes; pointer events outside cutout blocked | screenshot + evaluate hit-test |
| C-05 | Reduced motion on | No drop-in, no pulse, static dim only | screenshot |
| C-06 | Forced colors active | Border ring fallback; no lost affordances | screenshot |
| C-07 | Second silent-sorting session for same child | No mascot, no spotlight, no handoff | network (no PUT, no synthesizeSpeech for intro) |
| C-08 | Another exercise (e.g., auditory_bombardment) | No tutorial (pilot is silent-sorting only) | snapshot |
| C-09 | Session wrap-up fires | `ChildWrapUpCard` renders, existing REINFORCE timers undisturbed, `markWrapUpSeen` writes once | network + screenshot |
| C-10 | **Zero-telemetry seal** | Across the entire child session (handoff → session → wrap-up), `telemetry.trackEvent` is never called; no App Insights or Clarity network requests fire | network log (assert zero `trackEvent`, zero `dc.services.visualstudio.com`, zero `clarity.ms`) |
| C-11 | TTS pipeline | Mascot narration queues correctly, never overlaps; muted mode preserves captions | network `synthesizeSpeech` + audio timing |
| C-12 | Anchor loss | Unmount the silent-sorting panel mid-spotlight (navigate away via keyboard) | Spotlight unmounts without throw | console clean |
| C-13 | Offline first-run | Toggle offline at session start, first-run completes, flag set locally, replays when online | localStorage + network |
| C-14 | Bundle sanity | `childOnboarding-*.js` is a lazy chunk; not in main entry | network during adult boot |
| C-15 | A11y | Keyboard-only flow: tab to "Got it", Enter, spotlight steps advance via Enter; Esc skips; focus returns to anchor | sequential snapshots |

### 3.5 Phase 5 — Admin content editor (only if shipped)

| ID | Persona | Step | Expect | Evidence |
|---|---|---|---|---|
| P5-01 | Admin | `/admin/onboarding-content` | Renders editor, legal/child keys absent from picker | snapshot |
| P5-02 | Admin | Override `welcome-therapist` step 1 body; save | 200, `PUT /api/admin/onboarding-content/{key}` payload excludes body in audit | network + DB row |
| P5-03 | Admin | Try to override `legal.tos` | 422 | network |
| P5-04 | Therapist fresh (after admin override, >60 s TTL) | Login | Sees overridden copy | screenshot |
| P5-05 | Non-admin | Navigate `/admin/onboarding-content` | Redirect or empty, never the editor | snapshot |
| P5-06 | Child mode | Network | No `/api/content/onboarding` fetch fires | network log |
| P5-07 | Admin | Revert override | Copy returns to default on next fresh session | screenshot |
| P5-08 | Admin | Hit rate limit (31 PUTs/min) | 429, form preserves state | network + screenshot |
| P5-09 | Ops | Set `ONBOARDING_CONTENT_OVERRIDES_ENABLED=false`, restart | Editor route still reachable; live app falls through to defaults | screenshot + network |

### 3.6 Cross-cutting

- **Bundle regression:** `cd frontend && npm run build`; compare `dist/assets/*.js` sizes against the previous main-branch build (use `git stash` + rebuild if a baseline isn't cached). Flag any main-entry delta >15 KB gzipped.
- **Console hygiene:** during the full audit, collect all unique console warnings/errors via `mcp_playwright_browser_console_messages` and classify: React act warnings, Fluent UI warnings, focus-trap warnings, third-party noise.
- **Network hygiene:** assert that no onboarding endpoint is called from a non-authenticated page (landing, login, consent — except `/api/config` which is explicitly public).
- **Easy Auth infra read-through:** grep `infra/resources.bicep` `excludedPaths`; assert no `/api/me/ui-state`, no `/api/children/*/ui-state`, no `/api/admin/onboarding-content`. Only SPA routes may be excluded.

---

## 4. Evidence capture — file layout

Create (do not overwrite) the following under `voicelive-api-salescoach/docs/onboarding/qa/`:

```
qa/
  YYYY-MM-DD/
    report.md                  # the deliverable
    network/                   # JSON snapshots (one per test id)
    console/                   # txt excerpts
    screenshots/               # PNGs; naming: {test_id}-{viewport}-{theme}.png
    snapshots/                 # a11y tree JSON where relevant
    scripts/
      reset-ui-state.sh
      telemetry-spy.ts         # injected via browser_evaluate to count trackEvent calls
      anchor-rot-check.ts      # walks every tour's selectors
```

Name everything with the test ID so findings can link `#C-10 → qa/2026-04-23/network/C-10.json`.

---

## 5. Report format

Write `qa/YYYY-MM-DD/report.md` with these sections:

1. **Summary** — one paragraph. Pass/fail counts per phase. Number of P0/P1/P2 findings.
2. **Environment** — commit SHA, backend port, browser version, viewport + emulation matrix.
3. **Findings** — one entry per defect:
   ```
   ### [P0 | P1 | P2] <phase> — <short title>
   **Test ID:** C-10
   **Observed:** …
   **Expected:** …
   **Reproduction:** 1. … 2. … 3. …
   **Evidence:** screenshots/C-10-*, network/C-10.json
   **Suspected cause:** file:line reference
   **Proposed fix:** one-sentence direction, not a patch
   ```
4. **Passes** — bulleted list by test ID.
5. **Open questions** — anything you could not reproduce or where the plan is ambiguous.
6. **Suggested next actions** — ordered P0 → P2 with owner hints.

Severity rubric:

- **P0**: Children's Code violation (any telemetry in child mode), security gate bypass (non-admin reaching admin endpoint), destructive data loss, or crash blocking a core persona.
- **P1**: Functional regression (tour doesn't fire, checklist doesn't auto-tick, overrides don't reach the frontend), a11y WCAG 2.2 AA failure, kill-switch broken.
- **P2**: Cosmetic, noisy console, documentation mismatches, non-blocking edge case.

---

## 6. Execution plan (use `manage_todo_list`)

1. Bring up backend + frontend; confirm health.
2. Open Playwright MCP page; inject `telemetry-spy.ts`; snapshot `localStorage` baseline.
3. Run §3.1 therapist baseline → log findings.
4. Persona switch loop: admin, parent, pending_therapist; repeat §3.1 + §3.3 subsets.
5. Run §3.2 Phase 2 matrix.
6. Run §3.3 Phase 3 matrix including anchor-rot iteration + kill switch restart.
7. Enter child mode via adult → run §3.4 fully with reduced-motion and forced-colors emulations.
8. If Phase 5 shipped: run §3.5.
9. Run §3.6 cross-cutting checks (bundle + console + network + bicep).
10. Write `report.md` with linked evidence.
11. Stop. Do not patch code. Wait for user direction on which findings to fix first.

---

## 7. Done criteria

- `qa/YYYY-MM-DD/report.md` exists with: environment, per-phase pass/fail counts, every finding evidenced by at least one artefact, suspected-cause file:line hints, prioritised next actions.
- Child-mode telemetry seal verified directly from the network tab, not inferred.
- Every tour's anchors verified present in the live DOM (no silent anchor rot).
- Reduced-motion and forced-colors passes completed for Phases 2–4.
- No production code has been edited.

When done: post a one-paragraph summary (counts, top 3 P0/P1, link to the report) and stop.
