# Debug session prompt — fresh-learner onboarding broken on staging

Paste this entire file into a new chat session. Do **not** start in this current
session — context here is already heavy.

---

## Environment

- Repo: `/home/ayoola/sen/voicelive-api-salescoach` (branch `main`,
  HEAD = `824b649`, deployed to staging just now)
- Staging URL: <https://staging-sen.wulo.ai/> (alias of
  `https://voicelab.wittyground-443dbaba.swedencentral.azurecontainerapps.io/`)
- Staging Postgres was just wiped: `users=0`, `children=3` (seed
  `child-ayo`/`child-noah`/`child-zuri` with `workspace_id=NULL`),
  `therapist_workspaces=0`, all content tables (`exercises`,
  `learning_*`, `listening_eval_*`, `app_settings`) preserved.
- Backup: `backups/wulo.staging.20260530T010110Z.sql.gz`.
- Auth: Azure Container Apps Easy Auth + Microsoft Entra (Microsoft +
  Google providers). No password DB in the app — Entra owns sign-up
  and sign-in.
- `azd` env: `salescoach-swe` (resource group `rg-salescoach-swe`).
- Deploy command (no local Docker; remote ACR build is configured):
  `~/.local/bin/azd deploy --no-prompt` after `~/.local/bin/azd env select salescoach-swe`.

## Observed bugs

### Bug 1 — "I only see a sign-in page, never a sign-up / registration page"

Reported user expectation: on first visit they should be offered a way
to **register** (create a new account), not only sign in.

Actual: <https://staging-sen.wulo.ai/> shows only the login screen with
"Continue with Microsoft" and "Continue with Google" buttons. There is
no in-app "Create account" / "Sign up" affordance.

### Bug 2 — Fresh learner sees the admin "No learners linked" empty state instead of a learner profile / onboarding form

Reported with screenshot: after signing in as
`ayoolafakoya@gmail.com` on the freshly wiped staging DB, the user
lands at `/home` with the LEARNER role badge in the sidebar (so the
backend assigned LEARNER correctly), but the main panel shows the
**therapist/admin** empty state: an icon + "No learners linked to this
account" + "Once a learner is linked, their diagnostic check-ins …
voice practice will appear here."

A fresh LEARNER on a wiped DB should hit either:

1. a learner profile / intake form (so they can tell us name, age,
   focus areas, consent, etc.), **or**
2. the learner's own home (Welcome to Wulo Academy, today's plan,
   start practice).

They should **never** see "No learners linked to this account" — that
is copy meant for a therapist/parent looking at an empty workspace.

## Initial codebase map (verified, but treat as hypothesis — verify line numbers before editing)

### Bug 1 evidence

- Frontend login screen: `frontend/src/app/App.tsx` ~L4527 (`/.auth/login/aad`)
  and ~L4545 (`/.auth/login/google`). No "Register" / "Sign up" button.
- Backend auto-provisions a user row on first authenticated request:
  - `backend/src/app.py` `_get_authenticated_user_from_headers()` (~L756–L810)
    calls `storage_service.get_or_create_user(user_id, email, name, provider)`.
  - `backend/src/services/storage.py` `get_or_create_user()` (~L1398–L1450):
    - If there is a pending `child_invitations` / `family_intake_invitations`
      row matching the email → `ROLE_PARENT`.
    - Else if `_b2c_onboarding_enabled()` → `ROLE_UNASSIGNED` (frontend
      then shows `WelcomeRolePicker`).
    - Else → `ROLE_THERAPIST` (this is suspicious — see Bug 2 hypothesis).
- So "registration" is intentionally outsourced to Entra. **Question to
  answer in this session:** is the missing affordance the user is asking
  for actually (a) a copy/UX change on the login screen ("New here? Just
  click Continue with Microsoft — we'll create your account
  automatically"), or (b) a real missing in-app sign-up form, or (c) a
  missing Entra self-service sign-up policy (External ID user flow)?
  Confirm with the user, then fix accordingly.

### Bug 2 evidence

- `frontend/src/learning/PathfinderLearnApp.tsx`:
  - ~L960–L968 unconditionally calls `api.getChildren(session.current_workspace_id)`
    for `['parent', 'learner', 'kid', 'student'].includes(nextRole)` and
    stores the result in `learnerChildren`. For a fresh learner on a
    wiped DB this is `[]`.
  - ~L1049–L1075 `learnerHomeElement()` does
    `if (learnerChildren.length === 0) return <LearnerEmptyState />`.
  - ~L1080–L1092 already computes `learnerNeedsOnboarding =
    onboardingFlagEnabled && isLearnerLikeRole &&
    learnerProfileGate.needsOnboarding`, but the `/home` empty branch
    above runs **before** that gate is consulted.
- `frontend/src/learning/components/LearnerEmptyState.tsx` ~L48 contains
  the literal text "No learners linked to this account yet".
- `frontend/src/learning/hooks/useLearnerProfile.ts` reads
  `/api/learners/me/profile` and exposes `needsOnboarding`. This is
  the correct entry point for a learner on first login.

### Likely root cause of Bug 2 (verify, don't trust)

The home renderer never branches `learner` vs `parent/therapist`. For a
LEARNER role with no `learner_profile` row, it should either route to
the intake form (when `pathfinder_learner_onboarding_enabled` is on) or
to the learner home; instead it falls through to the
parent/therapist-style "no children linked" empty state.

Also possible: `_b2c_onboarding_enabled()` is **false** in staging, so
new users get assigned `ROLE_THERAPIST` (not LEARNER). Re-check the
sidebar badge in the screenshot says LEARNER — so role was assigned
correctly — but verify by querying staging Postgres for the new user's
row after sign-in.

## Your job

1. **Reproduce both bugs end-to-end against staging with Playwright before
   touching any code.** Use the headed/headless Playwright already wired
   into the repo (look in `frontend/` and `voicelive-api-salescoach/` for
   existing playwright config; node + npx is on PATH). Capture a
   screenshot of the broken `/home` page for the record. Do not try to
   bypass Easy Auth — drive the real flow. If you cannot complete an
   Entra sign-in headless, document the steps you took and ask the user
   to complete the sign-in once so you can resume from an authenticated
   storage state.
2. After reproducing, query staging Postgres directly to confirm what
   role + row was created for the new user. Use:
   - host `psql-voicelab-e5dj24rvkgx2c.postgres.database.azure.com`
   - db `wulo`, user `wuloadmin`
   - password is in `azd env get-values -e salescoach-swe`
     (`POSTGRES_ADMIN_PASSWORD`), `PGSSLMODE=require`.
   - Run `SELECT set_config('app.system_bypass_rls','on',false);` first,
     then `SELECT id, email, role, workspace_id, created_at FROM users
     ORDER BY created_at DESC LIMIT 5;` and `SELECT * FROM
     learner_profiles WHERE user_id = '…' LIMIT 1;` and any related
     `workspace_members` / `user_children` rows.
   - This client IP (83.218.139.74) is already whitelisted as firewall
     rule `wipe-users-temp` on `rg-salescoach-swe` /
     `psql-voicelab-e5dj24rvkgx2c`.
3. Decide the minimal fix for each bug:
   - **Bug 1:** confirm with the user whether they want a copy/UX
     change on the existing login screen or a real Entra self-service
     sign-up policy. Do not invent a username/password registration
     form — Entra owns identity.
   - **Bug 2:** fix the `/home` branch so a LEARNER with no learner
     profile goes to the intake form, and a LEARNER with a profile but
     no linked children goes to a learner-appropriate home (not the
     "no children linked" admin copy). Keep the existing
     parent/therapist empty state intact for those roles.
4. **Validate the fix with Playwright before declaring done.** The
   smoke must be:
   - Fresh sign-in as a never-seen learner email lands on the intake
     form (or learner home), **not** "No learners linked to this
     account".
   - Existing parent/therapist with an empty workspace still sees the
     correct empty state (don't regress that path).
   - Take screenshots of both flows and attach them to the final
     summary.
5. Run the existing frontend test for the touched code path before
   committing:
   `cd frontend && npx --no-install vitest run src/learning` (or the
   narrower file for whatever you changed). Fix any new failures.
6. Commit on `main` with a clear message, push, and redeploy to
   staging using the exact command above. Re-run the Playwright smoke
   against the deployed URL to confirm.

## Constraints

- Do not touch Entra app registrations or Easy Auth config without
  explicit user approval — that's identity-layer change.
- Do not modify seed data (`child-ayo`/`noah`/`zuri`) or run another
  wipe.
- Do not weaken role checks on the backend (RLS / `current_actor`).
  Backend already returns role correctly; the fix is almost certainly
  in `frontend/src/learning/PathfinderLearnApp.tsx`.
- Local dev quirk: `LOCAL_DEV_AUTH=true` recreates `dev-therapist-001`
  on `/api/auth/session`. That env var is **not** set on staging — so
  staging really is using Easy Auth headers.
- Backups dir `backups/` is gitignored — do not commit DB dumps.

## Definition of done

- Bug 2: a fresh LEARNER sign-in on staging lands on a learner-appropriate
  screen (intake form or learner home), verified by Playwright +
  screenshot. No regression for parent/therapist empty state.
- Bug 1: either user-confirmed copy/UX change merged + deployed, or a
  written recommendation in the chat for the user to enable Entra
  External ID self-service sign-up if that's what they actually want.
- Both verified against the **deployed** staging URL, not just localhost.
