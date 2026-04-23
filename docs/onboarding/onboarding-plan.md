# Plan: Wulo premium onboarding & in-app guidance system

TL;DR — Wulo today has a single static welcome card (`OnboardingFlow`) gated only for therapist/admin, with all state in browser `localStorage`. There is no guided tour, contextual help, empty-state teaching, child walkthrough, announcements, or checklist. This plan replaces the current scaffold with a layered, role-aware guidance system that covers every user-facing feature across therapist, admin, parent, and child personas, persisted server-side and measurable.

---

## Current repo reality (inventory driving the plan)

**Routes** (`frontend/src/app/routes.ts`): `/login`, `/logout`, `/onboarding`, `/mode`, `/home`, `/dashboard`, `/settings`, `/session`, `/privacy`, `/terms`, `/ai-transparency`.

**Personas & role gates**:
- `therapist`, `admin` → full workspace, pass `/onboarding` on first visit (localStorage).
- `parent` → skips onboarding, limited to consent + family-intake + child view.
- `pending_therapist` → `InviteCodeScreen` before any onboarding.
- `child` → child mode (`/mode` → ChildHome + session), no onboarding today.

**Feature surfaces needing guidance** (grouped by persona):

| Persona | Feature | Primary component / route | Has guidance today? |
|---|---|---|---|
| All | SSO login (Google/Microsoft) | `AuthGateScreen` `/login` | Static copy only |
| Pending therapist | Invite-code claim | `InviteCodeScreen` | Static copy |
| Therapist/Admin | First-run welcome | `OnboardingFlow` `/onboarding` | Single card, no tour |
| Therapist/Admin | Supervised-practice consent | `ConsentScreen` | Dialog, no context |
| Therapist | Workspace switcher (multi-tenant) | `SidebarNav` | None |
| Therapist | Child roster + create child | `SettingsView` | None |
| Therapist | Invite parent (child invitation) | `SettingsView` | None |
| Therapist | Family intake approvals (proposals) | `SettingsView` | None |
| Therapist | Custom scenario editor | `CustomScenarioEditor` | None |
| Therapist | Avatar selection | `SettingsView` | None |
| Therapist | Mic-mode toggle (push-to-talk vs conversational) | `SettingsView` | Helper text |
| Therapist | Session launch + handoff | `App.tsx`, `SessionLaunchOverlay` | None |
| Therapist | Insights rail (text) + insights voice | `InsightsRail`, `InsightsOrb`, `useInsightsVoice` | `collapsedHint` only |
| Therapist | Progress dashboard (charts) | `ProgressDashboard` `/dashboard` | None |
| Therapist | Session history / review | Dashboard rail | None |
| Therapist | Session summary + therapist feedback | `AssessmentPanel` | None |
| Therapist | Child memory review / approvals | memory proposal flows | None |
| Therapist | Practice plans (Copilot planner) | Planner readiness in `/api/config` | None |
| Therapist | Progress reports (export PDF/CSV) | Report endpoints | None |
| Therapist | Recommendations | Recommendation endpoints | None |
| Parent | Parental consent (GDPR) | `ParentalConsentDialog` | Copy only |
| Parent | Family intake — propose children | `SettingsView` | None |
| Parent | View child progress (when invited) | SettingsView-scoped | None |
| Child | ChildHome landing | `ChildHome` | None |
| Child | Session flow + avatar intro | `VideoPanel`, `videoPanelCopy.ts` | Avatar TTS intro |
| Child | Per-exercise panels (9+ types) | Each `*Panel.tsx` | ORIENT beat copy only |
| Child | Wrap-up / session end | Beat REINFORCE | TTS praise only |
| All | Legal (Privacy/Terms/AI) | `/privacy` `/terms` `/ai-transparency` | Static pages |
| All | Cookie/Clarity analytics consent | (per Privacy Policy §6) | Mentioned, likely banner exists |

**Persistence gaps**: `wulo.onboarding.complete` and `wulo.user.mode` in localStorage; `wulo.insightsRail.mode` too. Nothing server-side tracks tour progress, announcements dismissed, or per-child first-run flags → children on shared tablets re-see everything.

---

## Architecture — three coordinated tiers

### Tier A — Foundation (shared infrastructure)

1. **Backend `user.ui_state` JSONB column** on users table (new Alembic migration).
   Shape:
   ```json
   {
     "onboarding_complete": true,
     "tours_seen": ["welcome-therapist"],
     "announcements_dismissed": [],
     "help_mode": "auto",
     "checklist_state": { "taskId": "done" }
   }
   ```
   New endpoints on `backend/src/app.py`: `GET /api/me/ui-state`, `PATCH /api/me/ui-state`. RBAC: user can only read/write their own.

2. **Per-child first-run flags** — new `child_ui_state` table keyed by `(child_id, user_id)` JSONB for child-mode per-exercise intro tracking (so the same child on two devices doesn't re-see the mascot walkthrough). Schema mirrored across SQLite + Postgres storage adapters (per repo memory on parity).

3. **Frontend `useUiState()` hook** in `frontend/src/hooks/useUiState.ts` — loads once, caches, exposes `hasSeenTour(id)`, `markTourSeen(id)`, `dismissAnnouncement(id)`, `setChecklistTaskDone(id)`. Falls back to localStorage when offline and reconciles on next successful PATCH.

4. **Content registry** — typed TS files, PR-reviewed:
   - `frontend/src/onboarding/tours.ts` — step arrays keyed by tour id, per role.
   - `frontend/src/onboarding/helpContent.ts` — popover content keyed by `helpKey`.
   - `frontend/src/onboarding/announcements.ts` — array with id, title, body, CTA.
   - `frontend/src/onboarding/checklist.ts` — first-week tasks with completion predicates.
   All strings run through existing i18n layer (check what's present; introduce thin wrapper if none).

5. **Telemetry events** via existing analytics seam (Microsoft Clarity per privacy policy): `onboarding.tour_started`, `.step_viewed`, `.step_skipped`, `.completed`, `.help_opened`, `.announcement_dismissed`, `.checklist_task_completed`. Gated by existing analytics-consent cookie so children never emit.

### Tier B — Adult UI (therapist, admin, parent)

Layered components, each independently useful:

6. **Product tours** — add `react-joyride` with a Fluent-themed `WuloTourTooltip` component (matches existing `Card`, tokens, font-display). Target elements annotated with `data-tour="..."`. Tours:
   - `welcome-therapist` — replaces today's `OnboardingFlow` scaffold, ends at `/home` with checklist opened.
   - `welcome-admin` — workspace/multi-tenant emphasis.
   - `welcome-parent` — consent → family intake → child view.
   - `first-session` — auto-runs on first `/session` entry; walks child picker, exercise list, avatar selector, mic-mode, Start, "hand over device" callout.
   - `insights-rail` — covers scope chips, voice orb, citations, modes (collapsed/normal/full).
   - `dashboard` — charts, filters, report export.
   - `session-review` — session summary tabs (overview, recommendations, therapist notes + feedback).
   - `child-memory-review` — proposals queue, approve/reject, evidence links.
   - `family-intake` — invite parent, pending proposals, approve/reject flow.
   - `custom-scenario` — editor walkthrough (exercise type, target sound, target words).
   - `practice-plans` — planner readiness banner, generate plan, review AI suggestions.
   - `progress-reports` — create, edit summary, export PDF/CSV, audience scope.

   Each tour checks `ui_state.tours_seen`; auto-triggers tied to route entry; manually replayable from the help menu.

7. **Contextual help popovers** — Fluent `Popover` next to ambiguous labels (mic-mode toggle, "conversational", "TargetTally", "EXPOSE/PERFORM beats for therapist dev view", scope chips, "allowed relationships", "special category consent"). Content from `helpContent.ts`. Zero new deps.

8. **Global help menu** — new `?` button in `SidebarNav` footer opening a menu:
   - Take the tour again → submenu per-tour
   - Show the checklist
   - See what's new (announcements history)
   - Contact support / docs link
   - Keyboard shortcuts

9. **Empty-state teaching** — replace silent empty lists with purposeful copy + primary CTA + tip, for: no children yet (Settings + Home), no sessions yet (Dashboard), no reports (Reports), no memory items (review queue), no custom scenarios (library), no invitations, no plans. Each renders from a single `EmptyState` component.

10. **Getting-started checklist** — `ChecklistWidget` on `/home` showing ordered tasks for the active role:
    - Therapist: Create your first child → Record parental consent → Run your first session → Review session summary → Approve first memory proposal → Invite a parent (optional).
    - Admin: Set up your workspace → Invite a therapist → Review compliance settings.
    - Parent: Complete consent → Propose children → View first session summary.

    Each task has a predicate that auto-completes (no "fake" ticks): e.g. `children.length > 0`, `sessions.length > 0`, `parentalConsent.saved === true`. Widget is dismissible, re-openable from help menu.

11. **Announcements banner** — a single dismissible `AnnouncementBanner` at the top of `/home`, rendering the first non-dismissed entry from `announcements.ts`. Severity field (info/feature/urgent) drives styling.

12. **Consent UX upgrades** — add inline contextual help icons explaining lawful basis, retention, withdrawal path on `ConsentScreen` and `ParentalConsentDialog` (long dialogs with many checkboxes are a drop-off hotspot). No legal text changes — presentation only.

### Tier C — Child mode (custom, no library)

13. **Mascot guide** — reuse `/wulo-robot.webp` (or Lottie variant) as an animated character that appears for first-run moments and narrates through VoiceLive TTS (reuse `useAudioPlayer` + `api.synthesizeSpeech`). Keep copy ≤25 words, align with `beatInstructions.ts` soft-cap.

14. **Spotlight overlay** — new `ChildSpotlight` component using `@floating-ui/react` for positioning + SVG mask for the cutout + Framer Motion (or existing CSS keyframes in `WuloRobot`) for transitions. Disables pointer-events outside the target; target advances only on correct tap. Adult escape = long-press top-right corner.

15. **Per-exercise micro-tutorials** — the first time a child meets each exercise type (`auditory_bombardment`, `silent_sorting`, `listening_minimal_pairs`, `sound_isolation`, `vowel_blending`, `word_position_practice`, `two_word_phrase`, `structured_conversation`, `sentence_repetition`, `guided_prompt`), a 6–10s intro plays: mascot points at the first target, narrates one sentence of how to interact, then hands over. Persisted via `child_ui_state` keyed on `(child_id, exercise_type)` so it plays once per child per exercise, not per device.

16. **Hand-off interstitial** — after therapist launches session and before child mode takes over, a calming full-screen "Pass the device to {child}" screen with 3s countdown and soft chime. Stable UX anchor for the device-switch ritual, replaces abrupt transition.

17. **Session wrap-up framing** — today REINFORCE fires TTS praise then silently ends. Add a visible "Nice practising!" card with mascot + two child-safe buttons ("Show my grown-up" → returns to therapist review, "All done" → ChildHome). Currently implicit in code, make it explicit.

---

## Phased rollout

### Phase 1 — Foundation + therapist MVP tour (highest ROI)
1. Backend: `user.ui_state` column + Alembic migration + GET/PATCH endpoints + tests (`backend/tests/`).
2. Frontend: `useUiState` hook + `tours.ts` scaffold + install `react-joyride` + `WuloTourTooltip`.
3. Wire `welcome-therapist` tour to replace behaviour of current `OnboardingFlow` screen (keep the card as tour step 1).
4. Add `first-session` auto-trigger when entering `/session` with `!tours_seen.includes('first-session')`.
5. Add help menu "?" button → "Take the tour again".
6. Telemetry hooks on tour start/step/complete.
7. Migrate `wulo.onboarding.complete` from localStorage to `ui_state.onboarding_complete` (dual-read, single-write, remove localStorage after two weeks of clean telemetry).

### Phase 2 — Empty states + checklist + announcements
Parallel with Phase 1 where possible.
8. `EmptyState` component + rollout across the 7 empty surfaces listed above.
9. `ChecklistWidget` on `/home` + predicates + `checklist.ts` content.
10. `AnnouncementBanner` + `announcements.ts` + dismiss persistence.

### Phase 3 — Coverage tours (depends on Phase 1)
11. `insights-rail`, `dashboard`, `session-review`, `child-memory-review`, `family-intake`, `custom-scenario`, `practice-plans`, `progress-reports` tours — each its own PR, shares the infra from Phase 1.
12. Help popovers on ambiguous labels.
13. Parent + admin welcome tours.

### Phase 4 — Child mode (depends on Phase 1 infra for `child_ui_state`)
Parallel with Phase 3.
14. Backend: `child_ui_state` table + endpoints + SQLite/Postgres parity tests.
15. Frontend: `ChildSpotlight` + `ChildMascot` components + `@floating-ui/react` + `framer-motion`.
16. Hand-off interstitial + wrap-up card.
17. Pilot on one exercise (suggest `silent_sorting` — richest ORIENT beat copy), measure first-session completion in telemetry, roll to the other 9 exercise types.

### Phase 5 — Content ops (optional / nice-to-have)
18. Admin-only `/admin/onboarding-content` editor (role-gated) with a `content_overrides` table, letting Amir/Efa edit tour copy without a release.

---

## Relevant files

**New**
- `backend/alembic/versions/xxxx_add_user_ui_state.py` — `user.ui_state` JSONB + `child_ui_state` table (Postgres + SQLite parity required per `storage_postgres` repo memory).
- `backend/src/app.py` — add `/api/me/ui-state` GET/PATCH + `/api/children/{id}/ui-state` handlers.
- `backend/tests/test_ui_state.py` — role gating + parity.
- `frontend/src/hooks/useUiState.ts`, `frontend/src/hooks/useChildUiState.ts`.
- `frontend/src/onboarding/tours.ts`, `helpContent.ts`, `announcements.ts`, `checklist.ts`.
- `frontend/src/components/onboarding/WuloTourTooltip.tsx`, `ChecklistWidget.tsx`, `AnnouncementBanner.tsx`, `EmptyState.tsx`, `HelpMenu.tsx`, `HelpPopover.tsx`.
- `frontend/src/components/childOnboarding/ChildMascot.tsx`, `ChildSpotlight.tsx`, `HandOffInterstitial.tsx`, `ChildWrapUpCard.tsx`.

**Modified**
- `frontend/src/components/OnboardingFlow.tsx` — becomes tour step 1, exports step content.
- `frontend/src/app/App.tsx` — replace localStorage-based onboarding gate with `useUiState`; wire route-entry tour auto-triggers; mount announcement banner + checklist on `/home`; add `HelpMenu` in shell.
- `frontend/src/components/SidebarNav.tsx` — add `?` help trigger in footer; `data-tour` attributes on nav items, workspace switcher, child picker.
- `frontend/src/components/DashboardHome.tsx` — `data-tour` hooks + empty states + mount `ChecklistWidget`.
- `frontend/src/components/InsightsRail.tsx` — `data-tour` on scope chips, mic orb, composer; replace `collapsedHint` content path with `helpContent.ts`.
- `frontend/src/components/SettingsView.tsx` — `data-tour` on child roster, invite forms, mic-mode toggle, avatar picker, family-intake sections; help popovers on "conversational mic", "special category consent".
- `frontend/src/components/SessionScreen.tsx`, `VideoPanel.tsx` — hand-off interstitial + wrap-up card integration points.
- Each exercise panel (`AuditoryBombardmentPanel`, `SilentSortingPanel`, `ListeningMinimalPairsPanel`, `SoundIsolationPanel`, `VowelBlendingPanel`, `WordPositionPracticePanel`, `TwoWordPhrasePanel`, `StructuredConversationPanel`, plus sentence/guided) — hook `ChildSpotlight` around the first interactive element, gated by `useChildUiState` first-run flag.
- `frontend/src/components/legal/ParentalConsentDialog.tsx`, `ConsentScreen.tsx` — inline help popovers (no legal text changes).

---

## Verification

**Automated**
1. Backend: `pytest tests/test_ui_state.py` — role gating, PATCH partial merge, SQLite+Postgres parity (repo requires both).
2. Frontend: Vitest suites for `useUiState` (localStorage fallback, 401 handling), `ChecklistWidget` (predicate firing), `EmptyState` snapshots per variant, `WuloTourTooltip` accessibility (focus trap, escape, reduced-motion).
3. Integration: extend `App.integration.test.tsx` — assert new-therapist on first login sees `welcome-therapist` tour; assert `tours_seen` flag blocks re-run; assert parent flow doesn't trigger therapist tours.
4. Route-guard test update: `routes.test.ts` should read from `ui_state.onboarding_complete` path.
5. Telemetry unit tests: events fire with expected payload keys.

**Manual**
6. Fresh therapist login on clean account → `welcome-therapist` tour runs → ends on `/home` with checklist visible → first `/session` triggers `first-session` tour.
7. Returning therapist → no tour, checklist reflects actual state (children, sessions).
8. Parent via family-intake invite → `welcome-parent` tour covers consent + propose children.
9. Child session (once implemented) → mascot walkthrough fires once on first `silent_sorting` for a given child; second session is silent.
10. Admin on `/admin/onboarding-content` edits a step's copy → next load reflects override.
11. Accessibility: keyboard-only traversal, VoiceOver/NVDA screen reader runs through a tour, `prefers-reduced-motion` disables mascot animation.
12. Deploy verification per repo memory: `AZURE_EXTENSION_DIR=/tmp/az-noext DOCKER_CONFIG=$(mktemp -d) azd deploy --environment salescoach-swe` → smoke test `/api/me/ui-state` behind Easy Auth.

---

## Decisions & assumptions

- **Library choice: react-joyride**, with Fluent-themed custom `tooltipComponent` so "dated" default styling concern is neutralised. MIT, self-hosted, no third-party script in the data path (aligns with Children's Code compliance posture).
- **Child mode is custom**, not library-driven. Libraries target adult SaaS UIs; Wulo child mode needs voice + mascot + gated interaction that libraries don't model.
- **Persistence is server-side**, not localStorage — shared tablets and cross-device therapists demand it. localStorage kept only as offline fallback.
- **i18n-ready from day one** — Wulo copy churns during pilot; putting content behind a thin string wrapper costs nothing now and avoids a later rewrite.
- **Out of scope (explicit excludes)**: SaaS onboarding vendors (Appcues/Pendo/Userflow) rejected due to privacy (children's data, Children's Code). No WalkMe-style DOM scraping. No re-architecting existing components — tours and spotlights wrap, they don't replace.

---

## Further considerations (to flag / decide)

1. **Admin content editor** — build now (Phase 5) or defer until pilot feedback proves copy-churn justifies it? Recommend defer: start with code-reviewed `tours.ts`, build editor only if Amir/Efa actually request to edit mid-sprint.
2. **Analytics provider for onboarding funnel** — Clarity is already in place (session replay) but may not capture custom events cleanly. Option A: reuse Clarity custom events. Option B: add Application Insights (per repo skills) for the funnel. Recommend Option A short-term, Option B if funnel fidelity matters.
3. **Child mascot fidelity** — SVG `WuloRobot` today or invest in Lottie artwork? Recommend ship v1 with existing `WuloRobot` + scripted SVG animations, upgrade to Lottie in a later PR once one exercise is proven.
