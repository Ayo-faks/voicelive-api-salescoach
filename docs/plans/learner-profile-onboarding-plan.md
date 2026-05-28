# Pathfinder Learner Profile + Onboarding Wizard + Guided Tour — Implementation Plan

**Date:** May 28, 2026
**Branch base:** `feat/pathfinder-learner-voicelive` (in `voicelive-api-salescoach`, strict superset of phase-0)
**Working branch:** `feat/pathfinder-learner-profile-onboarding`
**Single feature flag:** `PATHFINDER_LEARNER_ONBOARDING_ENABLED` (default off; mirrored as `VITE_PATHFINDER_LEARNER_ONBOARDING_ENABLED`)

## Background

The role-picker (`WelcomeRolePicker`) and self-learner auto-create already exist (commit `55dba81`, gated by `PATHFINDER_B2C_ONBOARDING_ENABLED`). Cookie consent banner (localStorage only) exists from `ac054fe`. What is missing: a server-side learner profile, explicit consent capture, a post-role-pick wizard, and a learner-role guided tour. Today the only learner profile is `localStorage["pathfinder-learner-setup-v1"]` (firstName/exam/year/subject), and `learning_students.career_consent` has a column but no writer, so `backend/src/learning/career/planner.py` silently applies a 0.75 multiplier to pathway ranking.

## Scope

**In**
- Server-side learner profile (replaces localStorage `useLearnerSetup`).
- Explicit consent capture with append-only audit (terms, privacy, AI notice, career, analytics).
- 3-step onboarding wizard after role pick, before `/home`.
- Learner-role guided tour anchored on existing `/home` testids.
- Wire `career_consent` end-to-end so the planner stops applying the 0.75 penalty silently.

**Out**
- Parent/teacher profile changes.
- Backfill of existing localStorage profiles beyond a one-shot import on first load.
- `vanilla-cookieconsent` package (existing banner stays).
- Therapist/`parental_consents` flow.

## Verified facts driving the design

| Fact | Source |
|------|--------|
| `WelcomeRolePicker` shows when role is `unassigned`; learner pick calls `chooseRole('learner')` + auto-creates self-learner child | `frontend/src/learning/components/WelcomeRolePicker.tsx`, `backend/src/app.py` ~L1594 |
| Today's "profile" is `{exam, year, subject, firstName}` in `localStorage["pathfinder-learner-setup-v1"]` | `frontend/src/learning/hooks/useLearnerSetup.ts` |
| `learning_students.career_consent` column exists, no writer | `backend/alembic/versions/20260523_000024_learning_foundations.py` |
| `consent_multiplier = 1.0 if career_consent else 0.75` | `backend/src/learning/career/planner.py` ~L23 |
| `TourRole` union does **not** include `'learner'` | `frontend/src/onboarding/tours.ts` |
| `tours.test.ts` forbids the **child** persona; the authenticated learner is a different concept | `frontend/src/onboarding/tours.test.ts` ~L54 |
| Cookie consent today is `localStorage["pathfinder.cookie-consent.v1"]`, no server record | `frontend/src/learning/PathfinderLearnApp.tsx` ~L38 |
| Existing `/home` testids ready to anchor a tour: `learner-hero-title`, `start-checkin`, `weak-topic-profile`, `daily-revision-plan`, `start-learner-tutor`, `career-pathway-suggestions`, `parent-share-summary` | `frontend/src/learning/routes/StudentLearningHome.tsx` |

---

## Slice 1 — Backend: profile table, consent log, API, career-consent wiring

**Goal:** Learner can `GET`/`PATCH` profile and `POST` consent; planner multiplier flips correctly. Default off.

### Steps

1. Alembic migration `backend/alembic/versions/<ts>_learner_profiles.py`:
   - `learner_profiles` (one row per `user_id`):
     - `user_id` PK FK→users
     - `display_name` text
     - `exam` text, `year_group` text
     - `subjects` JSONB array, `interests` JSONB array
     - `locale` text (BCP-47), `country` text, `age_band` text
     - `guardian_email` text NULL, `guardian_relationship` text NULL
     - `career_consent` bool default false
     - `analytics_consent` bool default false
     - `tour_seen_at` timestamptz NULL
     - `created_at`, `updated_at` timestamptz
   - `user_consents` append-only audit:
     - `id` uuid PK, `user_id` FK, `kind` text (`terms|privacy|ai_notice|career|analytics`), `version` text, `granted` bool, `created_at` timestamptz, `ip_hash` text NULL, `user_agent` text NULL
     - Index `(user_id, kind, created_at desc)`
2. Storage layer (mirror in in-memory backend):
   - `get_learner_profile(user_id) -> dict | None`
   - `upsert_learner_profile(user_id, patch) -> dict`
   - `record_consent(user_id, kind, version, granted, meta) -> dict`
   - `latest_consents(user_id) -> dict[kind, row]`
   - In `upsert_learner_profile`, if `career_consent` changes, also UPDATE `learning_students.career_consent` for rows where the row's owning user is `user_id` (self-learner link). One source of truth at write time.
3. Routes in `backend/src/app.py` (RBAC `ROLE_LEARNER`, gated by `PATHFINDER_LEARNER_ONBOARDING_ENABLED`; 404 when off):
   - `GET /api/learners/me/profile` → `{profile, consents: latest_consents, needs_onboarding: bool}`. `needs_onboarding = true` if profile missing required fields OR no `terms`/`privacy` consent rows.
   - `PATCH /api/learners/me/profile` → validates: exam ∈ allowed set, year ∈ allowed set, subjects ≤ 6, locale BCP-47, age_band ∈ enum, guardian_email RFC-5322.
   - `POST /api/learners/me/consent` body `{kind, version, granted}` → appends audit row; mirrors to profile booleans for `career`/`analytics`.
4. Pytest (`backend/tests/integration/test_learner_profile.py` + addition to career-planner test):
   - Anonymous → 401; non-learner → 403; learner → 200 happy paths.
   - PATCH validation rejections.
   - Audit row count grows per POST; profile booleans mirror.
   - Planner regression: `career_consent=True` flips multiplier 0.75 → 1.0.

### Verification

```bash
cd /home/ayoola/sen/voicelive-api-salescoach/backend
alembic upgrade head && alembic downgrade -1 && alembic upgrade head
/home/ayoola/sen/.venv/bin/python -m pytest tests/integration/test_learner_profile.py tests/learning/test_career_planner.py -q
```

### Files

- New: `backend/alembic/versions/<ts>_learner_profiles.py`, `backend/tests/integration/test_learner_profile.py`.
- Edit: `backend/src/app.py` (insert near `/api/auth/choose-role` ~L1593), `backend/src/services/storage.py`, `backend/src/services/storage_postgres.py`.
- Edit (test only): `backend/tests/learning/test_career_planner.py`.

### Playwright coverage (Slice 1)

No new spec file — Slice 1 is server-only. But add one smoke assertion to the new pytest module that hits the routes via Flask's test client; do not stand up Playwright for backend-only changes.

---

## Slice 2 — Frontend: onboarding wizard + replace `useLearnerSetup`

**Goal:** New learner goes role pick → 3 wizard steps → `/home`. Returning learners with complete profiles skip the wizard.

### Steps

1. `frontend/src/services/api.ts`: add `getLearnerProfile()`, `patchLearnerProfile(patch)`, `recordConsent({kind, version, granted})`.
2. New hook `frontend/src/learning/hooks/useLearnerProfile.ts`. Server is source of truth; surface `{profile, isLoading, needsOnboarding, patch, recordConsent}`. On first mount, if legacy `pathfinder-learner-setup-v1` exists and server profile is empty, `PATCH` once then delete the key (pure helper, unit-tested).
3. New `frontend/src/learning/onboarding/LearnerOnboardingWizard.tsx`. 3 steps:
   - **Step 1 — Welcome & permissions:** display_name, age_band, locale, country; required terms / privacy / AI-notice checkboxes; optional analytics_consent. One `recordConsent` POST per checkbox; then `PATCH` profile.
   - **Step 2 — Your study:** exam, year_group, ≤6 subject chips (seeded from existing exam→subjects map in `StudentLearningHome`).
   - **Step 3 — Interests & adult support:** interests chips, career_consent toggle (copy: "lets the planner recommend full-strength pathway matches"), optional guardian_email + guardian_relationship. Finish → final `PATCH` → navigate `/home`.
   - Testids: `learner-onboarding-wizard`, `learner-onboarding-step-{1|2|3}`, `learner-onboarding-next`, `learner-onboarding-back`, `learner-onboarding-finish`, `consent-checkbox-{kind}`.
4. `frontend/src/learning/PathfinderLearnApp.tsx`:
   - Existing gate: role `unassigned` → `WelcomeRolePicker` (unchanged).
   - New gate (flag-on): role `learner` + `needs_onboarding === true` → render wizard at new `/welcome`. `/home` redirects to `/welcome` while flag is on and `needs_onboarding`.
   - Returning learners (`needs_onboarding === false`) hit `/home` unchanged.
   - Add `/welcome` to `frontend/src/app/routes.ts`.
5. `frontend/src/learning/routes/StudentLearningHome.tsx`:
   - Swap `useLearnerSetup` → `useLearnerProfile`.
   - The `b2c-learner-setup` card becomes an "edit profile" affordance linking to `/welcome`. No regression for demo flow; weak-topic/revision/career cards read profile fields.
6. Vitest:
   - `LearnerOnboardingWizard.test.tsx`: 3-step happy path, consent required, validation errors, finish PATCHes correct payload, navigates to `/home`.
   - `useLearnerProfile.test.ts`: migration helper drops legacy key only after successful PATCH.
   - `WelcomeRolePicker.test.tsx` regression: learner pick navigates to `/welcome` (not `/home`) when flag on.

### Verification

```bash
cd /home/ayoola/sen/voicelive-api-salescoach/frontend
npx vitest run src/learning/onboarding src/learning/hooks src/learning/components/WelcomeRolePicker
```

Manual: stop backend, set flag, restart; reload `127.0.0.1:5173`; role pick → 3 wizard steps → `/home` with seeded weak topics tied to chosen exam/subjects.

### Files

- New: `frontend/src/learning/onboarding/LearnerOnboardingWizard.tsx` + `.test.tsx`, `frontend/src/learning/hooks/useLearnerProfile.ts` + `.test.ts`.
- Edit: `frontend/src/services/api.ts`, `frontend/src/learning/PathfinderLearnApp.tsx`, `frontend/src/app/routes.ts`, `frontend/src/learning/routes/StudentLearningHome.tsx`.
- Defer-delete: `frontend/src/learning/hooks/useLearnerSetup.ts` (remove in a follow-up cleanup PR after one release).

### Playwright coverage (Slice 2)

The existing `playwright.config.ts` launches the backend with `LOCAL_DEV_USER_ROLE=admin` and the built frontend on port `8001` via `scripts/start-local.sh`. That role default is for legacy admin-facing specs; per-spec role overrides are done in-test (see `pathfinder-account.spec.ts`, `onboarding-tours.spec.ts`). Follow the same pattern — do **not** change the global default.

New file: `frontend/e2e/learner-onboarding-wizard.spec.ts`

- `test.use({ extraHTTPHeaders: { 'X-Test-Flag-Learner-Onboarding': '1' } })` only if you wire a header→flag shim; otherwise rely on env in the webServer.
- For each test, before `page.goto('/')`:
  - `page.route('**/api/auth/session', route => route.fulfill({ json: { id: 'dev-learner-001', role: 'unassigned', email: 'learner@localhost', needs_onboarding: true } }))` to land on `WelcomeRolePicker`.
  - `page.route('**/api/auth/choose-role', route => route.fulfill({ json: { id: 'dev-learner-001', role: 'learner', needs_onboarding: true } }))`.
  - `page.route('**/api/learners/me/profile', ...)` for `GET` (returns empty profile, `needs_onboarding: true`) and `PATCH` (records body, returns updated).
  - `page.route('**/api/learners/me/consent', ...)` recording each POST.
- Specs to author:
  1. **Happy path:** click `[data-testid=welcome-tile-learner]` → land on `/welcome` → walk steps 1→2→3 → assert each PATCH body shape and each consent POST → finish → land on `/home` with `[data-testid=route-student-home]` visible.
  2. **Consent required:** step 1 without checking required boxes → `learner-onboarding-next` disabled.
  3. **Validation:** step 2 with 7 subjects selected → PATCH not fired, inline error visible.
  4. **Returning learner skip:** mock `GET /api/learners/me/profile` with `needs_onboarding: false` → goto `/home` → wizard never mounts (`learner-onboarding-wizard` absent).
  5. **Flag off:** drop the wizard route stub, set webServer env `PATHFINDER_LEARNER_ONBOARDING_ENABLED=false` (via per-project config or a separate spec file) → role pick → goes straight to `/home`, legacy `b2c-learner-setup` card present.

Run:

```bash
cd /home/ayoola/sen/voicelive-api-salescoach/frontend
npx playwright test e2e/learner-onboarding-wizard.spec.ts
```

To test against the live dev stack on port `5173` instead of the built `8001` server:

```bash
PLAYWRIGHT_SKIP_WEBSERVER=true PLAYWRIGHT_BASE_URL=http://127.0.0.1:5173 \
  npx playwright test e2e/learner-onboarding-wizard.spec.ts
```

(Requires Vite on `5173` already proxying `/api/*` to Flask on `8000`, and Flask started with `LOCAL_DEV_USER_ROLE=unassigned` + `PATHFINDER_LEARNER_ONBOARDING_ENABLED=true`.)

---

## Slice 3 — Learner guided tour on `/home`

**Goal:** First time a freshly-onboarded learner lands on `/home`, run a ≤7-step react-joyride tour anchored on existing testids.

### Steps

1. Extend `TourRole` union in `frontend/src/onboarding/tours.ts` to include `'learner'`. Add a one-line comment in `frontend/src/onboarding/tours.test.ts` clarifying that the "Children's Code" assertion (which forbids the *child* persona) does not apply to the authenticated learner persona.
2. New `welcomeLearnerTour` (≤7 steps, each ≤50 words to pass existing contract):
   1. `learner-hero-title` — what Pathfinder does.
   2. `start-checkin` — daily check-in.
   3. `weak-topic-profile` — what we learned about you.
   4. `daily-revision-plan` — today's plan.
   5. `start-learner-tutor` — voice tutor.
   6. `career-pathway-suggestions` — careers (mention the career_consent toggle from wizard step 3).
   7. `parent-share-summary` — sharing with adults.
3. Add learner-role items to `frontend/src/onboarding/checklist.ts` mirroring tour steps (Complete check-in / Try a revision item / Try the voice tutor).
4. Kickoff: on `StudentLearningHome` mount, if `profile.tour_seen_at` is null, fire the bus event that starts joyride; on completion call `PATCH /api/learners/me/profile {tour_seen_at: now}`.
5. Add learner-role help entries to `frontend/src/onboarding/helpContent.ts` so the "?" rail surfaces tour-step copy after dismissal.
6. Vitest:
   - Anchor-rot contract: every `welcomeLearnerTour` step's testid exists in `StudentLearningHome.tsx` (mirrors existing test pattern).
   - Role coverage: `welcomeLearnerTour.role === 'learner'`.
   - Checklist test for learner-role items.

### Verification

```bash
cd /home/ayoola/sen/voicelive-api-salescoach/frontend
npx vitest run src/onboarding
```

Manual: clear `tour_seen_at` via `PATCH`; reload `/home`; walk the 7 steps; confirm `PATCH` fires on finish; reload — tour does not re-run.

### Files

- Edit: `frontend/src/onboarding/tours.ts`, `frontend/src/onboarding/tours.test.ts`, `frontend/src/onboarding/checklist.ts`, `frontend/src/onboarding/helpContent.ts`, `frontend/src/learning/routes/StudentLearningHome.tsx` (wire kickoff).

### Playwright coverage (Slice 3)

Follow the same role-override pattern as Slice 2 (mock `/api/auth/session` to `role: 'learner', needs_onboarding: false`). Extend the existing `frontend/e2e/onboarding-tours.spec.ts` rather than creating a new file — it already exercises welcome tours for therapist/admin/parent roles. Add tests:

1. **Tour runs on first visit:** mock profile with `tour_seen_at: null` → goto `/home` → assert joyride beacon visible → walk all 7 steps via `Next` → on finish, assert `PATCH /api/learners/me/profile` body includes `tour_seen_at`.
2. **Tour does not re-run:** mock profile with `tour_seen_at` set to an ISO timestamp → goto `/home` → assert no joyride DOM (`.react-joyride__beacon` absent).
3. **Anchor existence:** for each of the 7 testids declared in `welcomeLearnerTour`, assert `await page.getByTestId(id).count() > 0`. This is the runtime mirror of the Vitest anchor-rot check.

Run:

```bash
cd /home/ayoola/sen/voicelive-api-salescoach/frontend
npx playwright test e2e/onboarding-tours.spec.ts
```

---

## Cross-cutting decisions

- **Flag:** single env `PATHFINDER_LEARNER_ONBOARDING_ENABLED` (backend) mirrored as `VITE_PATHFINDER_LEARNER_ONBOARDING_ENABLED` (frontend). Default off. Backend returns 404 when off; frontend falls through to today's `useLearnerSetup` behavior. Zero impact on current users until flipped.
- **Persona:** the learner here is the authenticated user themselves (adult studying or self-registering secondary-school student). Parent-supervised child flows are out of scope and `parental_consents` is untouched.
- **Data minimization:** `guardian_email` is optional; only prompted client-side when `age_band == 'under-18'` in v1 (no server enforcement).
- **No new packages.**
- **Source of truth:** new `learner_profiles` table (separate from tenant-scoped `learning_students`), with `learning_students.career_consent` mirrored on write.
- **Branch:** `feat/pathfinder-learner-profile-onboarding` off `feat/pathfinder-learner-voicelive`. One PR per slice.

## Merge order

Slice 1 → Slice 2 → Slice 3 (Slice 2 depends on Slice 1's endpoint shapes; Slice 3 depends on `tour_seen_at` from Slice 1's migration and `needs_onboarding === false` from Slice 2 completion).

## Open questions to confirm before Slice 1

1. **Profile location** — separate `learner_profiles` table (chosen) vs. extending `learning_students` (couples user-level fields to class membership).
2. **Allowed exam set** — lock to the current `StudentLearningHome` set (WAEC, JAMB, NECO, IGCSE, A-level) or pull from a config file?
3. **Tour-seen tracking** — new `tour_seen_at` column (chosen, analytics-friendly) vs. piggyback on existing `ui_state` JSON via `patchUiState` (no migration column).
4. **Under-18 guardian email** — client-side gate only for v1 (chosen) vs. server-enforced when `age_band='under-18'`.
