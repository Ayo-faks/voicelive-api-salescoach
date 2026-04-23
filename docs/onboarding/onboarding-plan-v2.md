# Plan v2: Wulo premium onboarding & in-app guidance system

> **Status:** Revision of [onboarding-plan.md](./onboarding-plan.md). v1 is preserved unchanged for diff comparison. Changed sections are prefixed `> **Revised:** …`. Full changelog at the bottom.

## Summary of v1 (≤150 words)

v1 argues Wulo's current onboarding — a single static `OnboardingFlow` card gated for therapist/admin, with progress held in `localStorage` — cannot cover four personas on shared tablets, so it proposes a layered, server-persisted guidance system.

- **Tier A (Foundation):** `user.ui_state` JSONB + `child_ui_state` table, `useUiState()` hook, content registries (`tours.ts` / `helpContent.ts` / `announcements.ts` / `checklist.ts`), telemetry.
- **Tier B (Adult UI):** 11 `react-joyride` tours, contextual `?` help menu, empty-state teaching on 7 surfaces, auto-completing checklist on `/home`, announcements banner, consent UX polish.
- **Tier C (Child mode):** custom mascot guide (VoiceLive TTS), spotlight overlay, per-exercise micro-tutorials, hand-off interstitial, wrap-up card.

**Phased rollout:** 1) Foundation + therapist MVP tour → 2) empty states + checklist + announcements → 3) coverage tours + popovers + parent/admin tours → 4) child mode → 5) optional admin content editor.

---

## Current repo reality (inventory driving the plan)

> **Revised:** Inventory broadened after re-reading [routes.ts](../../frontend/src/app/routes.ts), [App.tsx](../../frontend/src/app/App.tsx), [SettingsView.tsx](../../frontend/src/components/SettingsView.tsx), [ProgressDashboard.tsx](../../frontend/src/components/ProgressDashboard.tsx), [InsightsRail.tsx](../../frontend/src/components/InsightsRail.tsx), and the legal surfaces. Adds assessment panel, memory proposal queue, report audience redaction, scope chips, and Copilot planner readiness — each needs guidance. **No billing/invoicing surface and no impersonation/switch-user surface exist today**; v2 explicitly excludes them rather than leaving them implied. Workspace switching exists in [SidebarNav.tsx](../../frontend/src/components/SidebarNav.tsx) / [SettingsView.tsx](../../frontend/src/components/SettingsView.tsx) and is in scope for the admin tour.

**Routes** (`frontend/src/app/routes.ts`): `/login`, `/logout`, `/onboarding`, `/mode`, `/home`, `/dashboard`, `/settings`, `/session`, `/privacy`, `/terms`, `/ai-transparency`.

**Personas & role gates** (unchanged from v1): `therapist`, `admin`, `parent`, `pending_therapist`, plus child mode.

**Feature surfaces needing guidance** — keep the v1 table as baseline and **add**:

| Persona | Feature | Primary surface | Added reason |
|---|---|---|---|
| Therapist | Assessment panel (pronunciation scoring) | [AssessmentPanel.tsx](../../frontend/src/components/AssessmentPanel.tsx) | Non-obvious entry point after session |
| Therapist | Session review audience redaction | [ProgressDashboard.tsx](../../frontend/src/components/ProgressDashboard.tsx) | Parent vs school vs therapist scopes |
| Therapist | Institutional memory view | ProgressDashboard `memory` tab | Clinic-level pattern explanation |
| Therapist/Admin | Copilot planner readiness banner | `/api/config.planner` → [DashboardHome.tsx](../../frontend/src/components/DashboardHome.tsx) | CLI/token state is opaque to first-run |
| Therapist | Insights rail scope toggles | `data-testid="insights-rail-scope-*"` | Already testable anchors |
| All | Cookie / Clarity consent banner | `vanilla-cookieconsent` | Gate for any telemetry emission |
| (excluded) | Billing / impersonation | n/a | Not present in repo |

---

## Architecture — three coordinated tiers

### Tier A — Foundation (shared infrastructure)

> **Revised:** Persistence schema split. A single `user.ui_state` JSONB blob is kept for **ephemeral UI flags** (`tours_seen`, `announcements_dismissed`, `help_mode`, `checklist_state`), but three things move to **normalised tables** for auditability and to keep SQLite parity safe:
> 1. `ui_state_audit` — append-only `(user_id, event, payload_json, created_at)` for dismissals, checklist completions, and reset actions (supports Children's Code retention proofs and UX regressions post-mortem).
> 2. `child_ui_state` — per-`(child_id, user_id, exercise_type)` first-run flag row (unchanged from v1, but must be a real table, not a JSON path, because SQLite's JSON1 `->>` is ergonomic but indexing nested JSON across SQLite + Postgres is hostile).
> 3. `ui_content_overrides` (Phase 5 only, nullable in Phase 1 migration) — `(content_key, locale, body, updated_by, updated_at)` for the admin editor.
>
> Everything else stays JSONB. Rationale: [storage_postgres.py](../../backend/src/services/storage_postgres.py) uses `dict_row` cursors (repo memory: tuple indexing has caused 500s on parity fields), and SQLite's JSON1 path queries are supported but indexing them portably is painful. Keeping hot-read flags in JSONB and audit events in a normal table gives us both cheap reads and clean `EXPLAIN` on both backends.

1. **Backend migration** `backend/alembic/versions/20260423_000023_user_ui_state.py` (raw-SQL style matching existing migrations per `/memories/repo/voicelive-api-salescoach.md`):
   - `ALTER TABLE users ADD COLUMN ui_state JSON NOT NULL DEFAULT '{}'` (Postgres: `JSONB`; SQLite: `TEXT` with `CHECK(json_valid(ui_state))`).
   - `CREATE TABLE child_ui_state (child_id TEXT, user_id TEXT, exercise_type TEXT, first_run_at TEXT, PRIMARY KEY (child_id, user_id, exercise_type))`.
   - `CREATE TABLE ui_state_audit (id INTEGER PK AUTOINCREMENT / BIGSERIAL, user_id TEXT NOT NULL, event TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL)`.
   - Postgres-only: RLS policy on `child_ui_state` and `ui_state_audit` using `set_config('app.current_user_id', ...)` pattern already used by [20260408_000006_invitation_rls.py](../../backend/alembic/versions/).
   - **Parity test required** (repo memory #31): seed both SQLite and Postgres, run `pytest backend/tests/test_ui_state.py` under `DATABASE_BACKEND=sqlite` **and** `DATABASE_BACKEND=postgres`.

2. **Backend endpoints** in [backend/src/app.py](../../backend/src/app.py) following the `/api/me/*` pattern established in the discovery report:
   - `GET /api/me/ui-state` — returns current `users.ui_state` JSON.
   - `PATCH /api/me/ui-state` — **server-side JSON Schema validation** (new `backend/src/schemas/ui_state.py`): rejects unknown keys, caps string length, caps `tours_seen` array at 64 entries, caps total payload at 8 KB. Rate limit: `60/min` per user-key, below the existing `120/min` mutation bucket so bloat attacks can't starve real traffic.
   - `DELETE /api/me/ui-state` — reset (audited).
   - `GET/PUT /api/children/{child_id}/ui-state` — gated by `_require_child_access(..., allowed_roles={THERAPIST, ADMIN}, allowed_relationships=['therapist'])` per repo memory #39.
   - All writes call `_log_audit_event` **and** insert into `ui_state_audit` with the diff keys (never values — no PII leakage into audit).

3. **Easy Auth** — add `/api/me/ui-state` to the **authenticated** side of the path map. It is a new API route so it **must not** appear in `globalValidation.excludedPaths` in [infra/resources.bicep](../../infra/resources.bicep) (lines 712+). We only add SPA routes to excluded paths; API routes stay gated by default (repo memory #41, #43). Verification step adds an infra read-through assertion.

4. **Frontend `useUiState()` hook** — unchanged from v1 in intent. Implementation notes:
   - Single in-memory cache, seeded from `GET /api/me/ui-state` on boot.
   - Write path: optimistic local update → debounced PATCH (400ms) → on 5xx, queue to `localStorage['wulo.uiStateOutbox']` and retry on next app focus. On 401, fall back to read-only cache (user will be redirected to `/login` anyway).
   - **Never fire tours for the child persona, ever.** The hook returns `{ enabled: false, ...noopWriters }` when `role === 'child'` or `userMode === 'child'`. Telemetry events are short-circuited at the emitter, not just the consumer (Children's Code: minors must not emit analytics events).

5. **Content registry** — typed TS files in `frontend/src/onboarding/` (unchanged), but **all strings go through a thin `t(key, defaultEnglish)` wrapper from day one**. Not a full i18n runtime; just a centralised lookup so the pilot can rewrite copy via a single PR without hunting string literals, and so late-stage translation remains a drop-in. No ICU/MessageFormat yet. See "Stress-test — i18n" for why.

6. **Telemetry** — see "Stress-test — Telemetry" and the dedicated funnel section below. Short version: **Application Insights (existing `PilotTelemetryService`) is the system of record for the onboarding funnel**; Clarity stays as consented session-replay only.

### Tier B — Adult UI (therapist, admin, parent)

> **Revised:** Library choice reconfirmed with current evidence (see Stress-test). Tours list unchanged except to add a `planner-readiness` microtour and a `reports-audience` microtour (both from the broader inventory). Empty-state list unchanged.

6. **Product tours** — `react-joyride@^3` (not `^2`). See Stress-test for evidence. Themed `WuloTourTooltip` component, `data-tour="…"` anchors. Lazy-load the library and all tour content behind `React.lazy(() => import('./onboarding/tours'))` — the initial bundle on the child tablet must not carry it.

7. **Contextual help popovers** — Fluent `Popover`, zero new deps (unchanged from v1).

8. **Global help menu** — `?` in sidebar footer (unchanged).

9. **Empty-state teaching** — `EmptyState` component across the seven surfaces (unchanged).

10. **Getting-started checklist** — `ChecklistWidget` on `/home` with auto-completing predicates (unchanged).

11. **Announcements banner** — `AnnouncementBanner` with severity styling (unchanged).

12. **Consent UX upgrades** — inline help icons on `ConsentScreen` and `ParentalConsentDialog`. **No legal text changes** (unchanged, reiterated for safety).

### Tier C — Child mode

> **Revised:** v1 proposed a bespoke spotlight stack using `@floating-ui/react` + `framer-motion` + a custom SVG mask. v2 recommends a **smaller custom build** that reuses what the repo already has:
> - Positioning: `@floating-ui/react` (kept — it's the canonical lightweight anchor library and the only new dep).
> - Animations: **reuse existing CSS keyframes** from [WuloRobot.tsx](../../frontend/src/components/WuloRobot.tsx) and [DashboardHome.tsx](../../frontend/src/components/DashboardHome.tsx) (`robotPulseRing`, `buddyImage`, `prefers-reduced-motion` already handled). **Drop `framer-motion`** from Tier C — it's ~25KB gzipped and we don't need its gesture/variants engine.
> - Mask: a single inline SVG `<rect>` + `feGaussianBlur` backdrop. No library.
> - Evaluated and **rejected** `@reactour/mask` for child mode: it would import `@reactour/tour` transitively and its focus-lock (React Spectrum FocusScope) is designed for adult SaaS, not voice-gated child UX. Keeping the custom build justified on compliance + voice grounds, but at a materially lower dependency cost than v1 implied.
>
> Mascot narration pipeline (mascot → VoiceLive TTS) remains. REINFORCE wrap-up card remains. Hand-off interstitial remains.

13. **Mascot guide** — reuse `/wulo-robot.webp` via [BuddyAvatar.tsx](../../frontend/src/components/BuddyAvatar.tsx) (already shared across ChildHome + DashboardHome). VoiceLive TTS narration via existing `useAudioPlayer` + `api.synthesizeSpeech`. Copy ≤25 words, aligned with `beatInstructions.ts`.

14. **Spotlight overlay** — `ChildSpotlight` component: `@floating-ui/react` for position, SVG mask for cutout, CSS keyframes for motion. Respects `prefers-reduced-motion` (no animation, static dim).

15. **Per-exercise micro-tutorials** — persisted in `child_ui_state` (see Tier A #1). Pilot on `silent_sorting` first, measure completion, then roll the remaining 9 exercise types.

16. **Hand-off interstitial** — unchanged.

17. **Session wrap-up framing** — unchanged.

---

## Phased rollout

> **Revised:** Phase ordering re-examined. v1's Phase 1 (Foundation + therapist MVP tour) is **still the right first slice**, but v2 **hoists empty states into Phase 1** because they are the single highest-ROI, lowest-risk wedge — they work without any server state, they unblock the other phases' testing (users see affordances that tours can then point at), and they validate the content-governance pipeline before we invest in `react-joyride` plumbing. This costs ~1 day of scope in Phase 1 and buys a testable UX win even if Phase 1 slips.

### Phase 1 — Foundation + empty states + therapist MVP tour
1. Backend: migration + `/api/me/ui-state` GET/PATCH/DELETE + `/api/children/{id}/ui-state` + **schema validation** + tests on both SQLite and Postgres (repo memory: parity non-negotiable).
2. Backend: `ui_state_audit` table + audit writes.
3. Frontend: `useUiState` hook + `EmptyState` component + rollout on 7 surfaces.
4. Frontend: install `react-joyride@^3`, ship `welcome-therapist` tour (replaces `OnboardingFlow` behaviour) + `first-session` auto-trigger.
5. Help `?` menu + "Take the tour again".
6. Telemetry via `PilotTelemetryService` (Application Insights) with the event taxonomy defined below.
7. Migrate `wulo.onboarding.complete` from `localStorage` to `ui_state.onboarding_complete`. Dual-read for 2 weeks, then remove.
8. **Kill switch**: `/api/config` exposes `{ onboarding: { tours_enabled: bool, forced_reset: bool } }`. Setting `tours_enabled=false` via env on the container app disables all tours without a release — this is the rollback story v1 lacked.

### Phase 2 — Checklist + announcements
9. `ChecklistWidget` on `/home` + predicates.
10. `AnnouncementBanner` + dismiss persistence.

### Phase 3 — Coverage tours + popovers + parent/admin tours
11. Remaining tours: `insights-rail`, `dashboard`, `session-review`, `child-memory-review`, `family-intake`, `custom-scenario`, `practice-plans`, `progress-reports`, `planner-readiness`, `reports-audience`.
12. Help popovers on ambiguous labels.
13. `welcome-parent`, `welcome-admin`.

### Phase 4 — Child mode
14. `child_ui_state` endpoints are already shipped in Phase 1; Phase 4 only adds frontend.
15. `ChildSpotlight` + `ChildMascot` + hand-off + wrap-up.
16. Pilot on `silent_sorting`, measure completion, expand.

### Phase 5 — Content ops (optional)
17. `/admin/onboarding-content` editor + `ui_content_overrides` table activation.

---

## Relevant files

**New** (additions from v1 in bold)
- `backend/alembic/versions/20260423_000023_user_ui_state.py`
- **`backend/src/schemas/ui_state.py`** — JSON Schema + Python validator (bloat-attack defence).
- `backend/src/app.py` — `/api/me/ui-state` + `/api/children/{id}/ui-state` handlers.
- `backend/tests/test_ui_state.py` — role gating, partial-merge, parity (SQLite + Postgres), rate limiting, schema rejection, audit row emission.
- `frontend/src/hooks/useUiState.ts`, `frontend/src/hooks/useChildUiState.ts`.
- `frontend/src/onboarding/tours.ts`, `helpContent.ts`, `announcements.ts`, `checklist.ts`, **`events.ts`** (central event taxonomy), **`t.ts`** (string wrapper).
- `frontend/src/components/onboarding/WuloTourTooltip.tsx`, `ChecklistWidget.tsx`, `AnnouncementBanner.tsx`, `EmptyState.tsx`, `HelpMenu.tsx`, `HelpPopover.tsx`.
- `frontend/src/components/childOnboarding/ChildMascot.tsx`, `ChildSpotlight.tsx`, `HandOffInterstitial.tsx`, `ChildWrapUpCard.tsx`.

**Modified** (unchanged from v1; see v1 for list).

**Infra** (v2 addition)
- [infra/resources.bicep](../../infra/resources.bicep) — **no change** to `excludedPaths`. Explicit verification note: `/api/me/ui-state` must stay gated by Easy Auth (do not add it to the excluded list).

---

## Verification

> **Revised:** Adds parity, kill-switch, Easy-Auth, bundle-budget, and headless-testable-contract checks that v1 implied but didn't name.

**Automated**
1. `pytest backend/tests/test_ui_state.py` under **both** `DATABASE_BACKEND=sqlite` and `DATABASE_BACKEND=postgres` (repo memory #31).
2. Schema validation test: PATCH with unknown key → 422; PATCH with oversize payload → 413.
3. Rate-limit test: 61st PATCH in 60s → 429.
4. Audit-row test: every PATCH/DELETE produces a `ui_state_audit` row with key-list only, no values.
5. RLS test (Postgres): user A cannot read user B's `ui_state` or `child_ui_state` rows.
6. Frontend: Vitest (`jsdom@26.1.0` per repo memory) for `useUiState` offline fallback, 401 handling, outbox replay; `ChecklistWidget` predicate firing; `EmptyState` snapshot; `WuloTourTooltip` focus trap, keyboard escape, `prefers-reduced-motion`.
7. `App.integration.test.tsx` extension: fresh therapist sees `welcome-therapist`; returning therapist doesn't; parent doesn't see therapist tours; **child mode emits zero telemetry events** (assert via spied `PilotTelemetryService`).
8. **Headless-testable tour contract**: every tour exports `{ id, steps: Array<{ selector: string; testId: string }> }`. A Vitest suite walks every tour, mounts a fixture page, asserts each `selector` resolves to a DOM node and each `testId` is present. Regression guard against silent anchor rot.
9. Bundle budget: `npm run build` reports `dist/assets/onboarding-*.js` (lazy chunk) and fails CI if main entry grows >15KB gzipped from baseline after this plan lands.

**Manual**
10. Fresh therapist login → tour runs → ends on `/home` with checklist → `/session` triggers `first-session`.
11. Returning therapist → no tour; checklist reflects actual state.
12. Parent via family-intake invite → `welcome-parent` covers consent + propose children.
13. Child session → mascot fires once on first `silent_sorting` per child, silent thereafter; **no Clarity or App Insights events** fire during child mode (network inspector).
14. Accessibility: keyboard-only, VoiceOver + NVDA, `prefers-reduced-motion`, 44px minimum tap target on child spotlight, high-contrast OS mode.
15. Kill switch: flip `ONBOARDING_TOURS_ENABLED=false` on `salescoach-swe` via `azd env set`, redeploy with the documented command (`AZURE_EXTENSION_DIR=/tmp/az-noext DOCKER_CONFIG=$(mktemp -d) azd deploy --environment salescoach-swe`), confirm tours disabled without code change (repo memory #25).
16. Deploy arm64 sanity: no new native deps (verified: `react-joyride`, `@floating-ui/react`, `@reactour/mask` rejected, `framer-motion` rejected — all remaining adds are pure-JS, binfmt-safe per `/memories/repo/deploy-arm64-binfmt.md`).

---

## Accessibility — WCAG 2.2 AA

> **Revised:** New section. v1 mentioned reduced-motion only; v2 enumerates the full set.

- **Focus management**: `WuloTourTooltip` traps focus (`react-joyride@3` provides this; verified via its "Accessible: Focus trapping" feature). On close, focus returns to the triggering element.
- **Keyboard**: `Esc` dismisses; `Enter`/`Space` advances; `Tab` cycles inside tooltip only.
- **Screen reader**: each step has `aria-live="polite"` announce region with step number + title + body. Child mascot narration has a parallel hidden `aria-live` text track so SR users aren't reliant on TTS audio.
- **Reduced motion**: `@media (prefers-reduced-motion: reduce)` disables mascot drop-in, spotlight pulse, and robot float (pattern already used in [DashboardHome.tsx](../../frontend/src/components/DashboardHome.tsx)).
- **High contrast / forced-colors**: tooltip uses `CanvasText`/`Canvas` system colors under `forced-colors: active`; spotlight mask falls back to a solid border ring.
- **Tap targets**: child mode tour buttons ≥44×44 CSS px (Children's Code "Tools" section).
- **Cognitive**: tours skippable at every step; never auto-advance (timer-free); copy ≤25 words per step for child, ≤50 for adult.

---

## GDPR / UK ICO Children's Code

> **Revised:** New section. v1 mentioned Children's Code at the library-choice level only.

- **Lawful basis**: telemetry events are "legitimate interest" for adults, emitted only after Clarity consent (already gated in [PrivacyPolicy.tsx §6](../../frontend/src/components/legal/PrivacyPolicy.tsx)). **Children never emit events** — enforced at the `PilotTelemetryService` call site, not just at the consumer.
- **Data minimisation**: tour events carry `{ tour_id, step_index, action, user_role }` only. No content, no free text, no child identifiers.
- **DPIA touchpoint**: the existing DPIA (PrivacyPolicy §8) covers AI processing of children's data. This plan adds no new child data categories; the per-child first-run flag is a boolean keyed by existing `child_id`, covered by the current DPIA. Document the update in the next DPIA review; no new DPIA needed.
- **Retention**: `users.ui_state` JSON is deleted on account deletion (existing `DELETE /api/users/me` flow). `child_ui_state` is deleted by the existing 6-month child-inactivity soft-delete (PrivacyPolicy §7). `ui_state_audit` retained **90 days** (short, because it's UX analytics, not compliance evidence), via a scheduled purge job added to the existing retention runner.
- **Right-to-erasure impact**: `DELETE /api/me/ui-state` already zeroes the blob; add cascade delete of `ui_state_audit` rows and `child_ui_state` rows for that user.

---

## Telemetry funnel

> **Revised:** New section. v1 listed event names but no funnel.

**Three headline metrics** (measured in Application Insights, not Clarity):

1. **Activation**: % of new therapists who complete `welcome-therapist` within 24h of first login.
2. **Time-to-first-session (TTFS)**: median minutes from first login to `exercise_session_started` (existing event).
3. **Checklist completion rate**: % of therapists with all Phase-1 checklist items auto-ticked within 7 days.

**Event taxonomy** (authoritative source: `frontend/src/onboarding/events.ts`):

| Event name | Properties (low-cardinality) |
|---|---|
| `onboarding.tour_started` | `tour_id`, `role` |
| `onboarding.tour_step_viewed` | `tour_id`, `step_index`, `role` |
| `onboarding.tour_step_skipped` | `tour_id`, `step_index`, `role` |
| `onboarding.tour_completed` | `tour_id`, `role`, `duration_bucket` (`<30s`/`30-120s`/`>120s`) |
| `onboarding.help_opened` | `source` (`sidebar`/`popover`), `key` |
| `onboarding.announcement_dismissed` | `announcement_id`, `role` |
| `onboarding.checklist_task_completed` | `task_id`, `role`, `auto_vs_manual` |

All cardinalities bounded (no free-text fields, no IDs). `role` is enum-constrained at the emitter.

**Clarity vs App Insights decision**: Microsoft Clarity's custom-events support is thin (it stores a bag of strings, doesn't expose KQL-grade filtering). [PilotTelemetryService](../../backend/src/services/telemetry.py) already wires Application Insights with `track_event` and low-cardinality property enforcement. **Recommendation: App Insights for the funnel, Clarity for consented session replay.** This overturns v1's "Option A short-term" default.

---

## Error states & offline

> **Revised:** New section. v1 mentioned offline fallback once; v2 enumerates failure paths.

- **PATCH 5xx mid-tour**: `useUiState` queues to `localStorage['wulo.uiStateOutbox']`. Retries on next focus/online event. If the user closes the browser with an unreplayed outbox, the **next login replays it before running tours** — so `tours_seen` dismissals are never lost silently. A dead-letter counter emits a `onboarding.sync_failed` event if retries exceed 5.
- **PATCH 401**: user was signed out mid-session. Outbox persists; tours re-fire only if `tours_seen` is genuinely empty after login — never double-fire based on local state alone.
- **GET 5xx on boot**: cache returns `{}`; tours do not auto-fire. Banner: "Guidance unavailable — try refreshing." Prevents the worst failure mode (re-running `welcome-therapist` every login for a week because the GET was flaky).
- **Offline child mode**: child UI never writes to the server; `child_ui_state` is read at session start and flagged-done at session end. Offline first-runs are idempotent.

---

## Security

> **Revised:** Named explicitly. v1 implied user-scoping via the endpoint shape.

- **User-scoping**: `GET/PATCH/DELETE /api/me/ui-state` resolves `user_id` from `_require_authenticated()` only; path-level IDs are not accepted. Postgres RLS on `child_ui_state` and `ui_state_audit` provides defence-in-depth.
- **CSRF**: reuse existing CSRF policy from [app.py](../../backend/src/app.py). No new exemptions.
- **Rate limiting**: 60/min per user on PATCH (tighter than the 120/min mutation default) to cap bloat-attack bandwidth.
- **Schema validation**: server-side via `backend/src/schemas/ui_state.py`. Rejects unknown keys, oversize strings, array length overflows. Client-side validation does not suffice.
- **Audit**: every write logged via `_log_audit_event(...)` **and** `ui_state_audit`. Keys only, never values.
- **Secrets hygiene**: `ui_state` must never store API keys, tokens, or free-text; enforce via schema and add a denylist test (`test_ui_state_no_secret_keys`).

---

## Performance & bundle

> **Revised:** Named explicitly. v1 said "lazy-load `react-joyride`" without a budget.

- **Child tablet critical path**: the default chunk for `/mode` and `/session` must not contain `react-joyride`, `@floating-ui/react`, or any adult tour code. Enforce via `import()` splits in [App.tsx](../../frontend/src/app/App.tsx) and a `grep` guard in CI.
- **Budget**: initial JS entry ≤ current baseline + 15KB gzipped after Phase 1 lands. Child chunk ≤ current baseline + 8KB gzipped after Phase 4 lands (accounts for `@floating-ui/react` + `ChildSpotlight`).
- **Deps overturned from v1**: `framer-motion` **rejected** (reuse existing CSS keyframes). `@reactour/mask` **rejected** (transitive surface, React Spectrum FocusScope not needed).

---

## Content governance

> **Revised:** New section.

- **Ownership**: copy lives in `frontend/src/onboarding/*.ts`, reviewed in PRs by the product owner (Amir/Efa). Legal copy (consent, privacy) is out of scope for this plan — it lives in [legal/](../../frontend/src/components/legal/) and is only referenced.
- **Translations**: `t(key, defaultEnglish)` wrapper from day one; locale files under `frontend/src/onboarding/locales/{en,…}.json` when the first non-English locale is added. Until then, only `en.json` exists and `t()` is effectively identity.
- **Versioning**: content registry files are code — no separate version field. The Phase-5 editor writes to `ui_content_overrides` with `(content_key, locale, body, updated_by, updated_at)`, read-through at render time; code defaults are fallbacks.

---

## Rollback

> **Revised:** New section, promoted from v1's implicit "Phase 5 is optional" note.

- **Kill switch**: `ONBOARDING_TOURS_ENABLED` env var on the container app (default `true`). Surfaced via `/api/config`; the frontend no-ops all tours when `false`. Flip via `azd env set` and `azd deploy` (no code change, no DB change). Canary-friendly: set per-environment.
- **Per-tour disable**: `/api/config.onboarding.disabled_tour_ids: string[]`. Same mechanism, finer grain, for pilot-specific regressions.
- **Full revert**: the Phase 1 migration is additive (`ADD COLUMN` + two new tables). Down-migration drops the new tables and the column; no data lost from other tables.

---

## Decisions & assumptions

### Stress-test of v1's five assumptions

> **Revised:** Each assumption tested with evidence.

1. **Library choice — `react-joyride`: CONFIRMED, stronger than v1.**
   Evidence (fetched from npm on 2026-04-23):
   - `react-joyride@3.0.2`, published **22 days ago**, **679,813 weekly downloads**, MIT, explicit React 16.8–19 support, SSR-safe, focus trap + keyboard + ARIA built in, "~30% smaller bundle than v2", Vitest-friendly hook API (`useJoyride`).
   - `@reactour/tour@3.8.0`, published **a year ago**, 127k weekly, MIT, uses React Spectrum `FocusScope`. Viable but noticeably staler.
   - `driver.js@1.4.0`, 5 months ago, 542k weekly, MIT, **5KB gzipped, zero deps, vanilla TS**. Tempting on size alone, but not React-native and lacks the focus-trap primitives we'd otherwise reinvent.
   - **`shepherd.js@15.2.2` — AGPL-3.0 / dual-commercial.** v1 did not flag this. **Hard reject** for a commercial SaaS.
   - Custom build: rejected — cost > savings once focus trap, keyboard nav, and placement are included.
   **Decision**: `react-joyride@^3`. Themed tooltip (`WuloTourTooltip`) neutralises v1's "dated default styling" concern. Lazy-loaded.

2. **Child mode custom build — CONFIRMED, but lighter than v1 implied.**
   - Reason to keep custom: voice-gated interaction, mascot narration, and pointer-event discipline aren't modelled by any library targeting adult SaaS.
   - Reason to shrink: `@reactour/mask` drags in `@reactour/tour` and a focus-lock we don't want for child mode; `framer-motion` is 25KB gzipped for features we don't use.
   **Decision**: `@floating-ui/react` only. Reuse existing CSS keyframes from [WuloRobot.tsx](../../frontend/src/components/WuloRobot.tsx) and [DashboardHome.tsx](../../frontend/src/components/DashboardHome.tsx). SVG mask inline.

3. **Persistence schema — OVERTURNED.**
   v1: single `user.ui_state` JSONB. v2: **hybrid**. Ephemeral flags stay in `ui_state` JSON; dismissals/completions append-only to `ui_state_audit`; per-child first-run in its own table. Rationale: SQLite's JSON1 supports `->>` but indexing and constraint-enforcing nested JSON across SQLite + Postgres is fragile (repo memory #31 — `dict_row` parity incidents have shipped 500s before). Alembic migrations run cleanly on both because we use raw SQL (matching existing style).

4. **Phase ordering — PARTIALLY OVERTURNED.**
   v1 Phase 1 stays (Foundation + therapist MVP tour) but **empty states are hoisted into Phase 1** because they're the highest-ROI, lowest-risk wedge and they unblock test fixtures for later tours. Checklist and announcements remain Phase 2.

5. **i18n from day one — CONFIRMED, but downgraded.**
   v1 proposed "thin i18n wrapper." v2 keeps exactly that — a `t(key, default)` lookup — but **does not** add ICU/MessageFormat, `react-intl`, or locale detection. UK pilot is English-only; premature i18n runtime is dead weight. The wrapper preserves the option to drop in a real runtime in one PR when a second locale lands.

### Prioritised improvements (the 5–10 list)

| # | Title | Motivation | Change | Cost | Risk if skipped |
|---|---|---|---|---|---|
| 1 | Kill-switch via `/api/config.onboarding.tours_enabled` | v1 has no rollback story | Env-var read-through to frontend no-op | **S** | A regressed tour can't be disabled without a release |
| 2 | Reject `shepherd.js` on license grounds | v1 doesn't mention it; AGPL is disqualifying | Documented rejection in library matrix | **S** | Junior dev picks Shepherd for a later tour, legal issue |
| 3 | Hybrid persistence (JSON blob + `ui_state_audit`) | v1's single JSONB is weak on auditability | New `ui_state_audit` table, normalised child flags | **M** | No ability to prove a dismissal happened or diagnose loss |
| 4 | Server-side schema validation on PATCH | v1 omits it | `backend/src/schemas/ui_state.py` + 422/413 | **S** | Bloat attack can balloon `users.ui_state` to MB-scale |
| 5 | App Insights as funnel source-of-truth; Clarity replay-only | v1 defers the decision | `PilotTelemetryService` wiring from day one | **S** | Funnel built on Clarity custom events is high-cardinality-unsafe |
| 6 | Hoist empty states into Phase 1 | Highest-ROI wedge, low risk | Re-scope Phase 1 | **S** | Phase 1 delivers a "hollow" win without visible UX |
| 7 | Drop `framer-motion` from Tier C | v1 pulls in 25KB for features we don't use | Reuse existing CSS keyframes | **S** | Child tablet bundle bloats; reduced-motion handling duplicated |
| 8 | Headless-testable tour contract in Vitest | v1 implies tests but doesn't define a contract | Each tour exports `{ selectors, testIds }`; generic walker test | **M** | Silent `data-tour` rot breaks tours in prod with no CI signal |
| 9 | Telemetry short-circuit for child/role | v1 says "children never emit" but doesn't enforce at emitter | Gate in `PilotTelemetryService` call site, not consumer | **S** | Children's Code violation if a future contributor forgets the gate |
| 10 | Bundle budget + CI guard | v1 hand-waves bundle impact | `size-limit` (or equivalent) step in CI | **M** | Initial-entry creep is invisible until prod reports |

---

## Further considerations

> **Revised:** v1's three open questions are resolved; v2 replaces with the genuinely open ones.

1. **Admin content editor (Phase 5)** — **defer until pilot feedback proves copy-churn**. Unchanged from v1.
2. **Clarity → App Insights migration** — **resolved**: App Insights is the funnel source-of-truth, Clarity stays replay-only.
3. **Mascot fidelity (SVG vs Lottie)** — unchanged: ship v1 with existing asset, upgrade later.
4. **Open**: how to retire a tour cleanly. When `welcome-therapist` is deprecated, we need to stop marking it "unseen" for users who never got a chance to see it. Proposal: a `tours_retired: string[]` in `/api/config`; `useUiState` treats them as seen. Leaves audit history intact.
5. **Open**: child-mode voice-first accessibility review. Screen readers + VoiceLive TTS simultaneously may collide. Plan a pilot session with NVDA and VoiceOver on the `silent_sorting` micro-tutorial before general rollout.

---

## Changelog vs v1

- **Inventory**: added assessment panel, memory proposal queue, report audience redaction, planner readiness, insights scope chips, cookie consent. Explicitly excluded billing and impersonation (not present in repo).
- **Persistence schema**: overturned v1's single-JSONB model. Introduced hybrid JSON blob + `ui_state_audit` + `child_ui_state` + optional `ui_content_overrides`.
- **Library evidence**: verified live on npm. Reconfirmed `react-joyride@^3`. **Hard-rejected `shepherd.js` on AGPL grounds** (not flagged in v1).
- **Child mode deps**: dropped `framer-motion` and `@reactour/mask`. Kept `@floating-ui/react` only. Reused existing CSS keyframes.
- **Phase 1 scope**: hoisted empty states from v1's Phase 2.
- **Telemetry**: designated Application Insights as funnel source-of-truth (was "Option A short-term" in v1). Clarity demoted to consented session replay only. Added event taxonomy with cardinality caps.
- **New sections**: Accessibility (WCAG 2.2 AA), GDPR / Children's Code, Telemetry funnel, Error states & offline, Security, Performance & bundle, Content governance, Rollback.
- **New verification checks**: SQLite+Postgres parity run, schema rejection, rate-limit, audit emission, RLS, tour-contract headless walker, bundle budget, kill-switch drill, arm64 deploy sanity.
- **New: kill switch** via `ONBOARDING_TOURS_ENABLED` + per-tour disable list.
- **New: Easy Auth** explicit note — `/api/me/ui-state` stays gated; not added to `excludedPaths`.
- **i18n**: downgraded from v1's implied full wrapper to a minimal `t(key, default)` lookup. No runtime yet.
- **Prioritised improvements**: added the 10-item table.
