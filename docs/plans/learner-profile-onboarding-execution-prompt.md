# Execution Prompt — Pathfinder Learner Profile + Onboarding Wizard + Guided Tour

Copy everything below the line into a fresh agent session.

---

You are continuing implementation work on the Pathfinder Learn platform. The full plan is committed at [voicelive-api-salescoach/docs/plans/learner-profile-onboarding-plan.md](voicelive-api-salescoach/docs/plans/learner-profile-onboarding-plan.md). **Read that file first** — it is the source of truth for scope, file lists, and verification commands.

## Working environment

- Workspace root: `/home/ayoola/sen`
- Repo: `/home/ayoola/sen/voicelive-api-salescoach` (do **not** use the sibling `voicelive-api-salescoach-pathfinder-phase-0` — it is an older git worktree on a different branch).
- Base branch: `feat/pathfinder-learner-voicelive` (currently checked out).
- Python venv: `/home/ayoola/sen/.venv` (already has alembic, flask, pytest).
- Dev backend command: `cd backend && LOCAL_DEV_AUTH=true LOCAL_DEV_USER_ROLE=learner LOCAL_DEV_USER_ID=dev-learner-001 LOCAL_DEV_USER_NAME='Dev Learner' LOCAL_DEV_USER_EMAIL=learner@localhost /home/ayoola/sen/.venv/bin/python -m src.app`
- Dev frontend: Vite already runs at `http://127.0.0.1:5173` (browser page open).

## Ground rules

1. **One slice = one PR.** Do not start Slice 2 before Slice 1 is merged.
2. **Branch:** create `feat/pathfinder-learner-profile-onboarding` off `feat/pathfinder-learner-voicelive` before any edit.
3. **Flag-gated:** all behavior change sits behind `PATHFINDER_LEARNER_ONBOARDING_ENABLED` (backend) / `VITE_PATHFINDER_LEARNER_ONBOARDING_ENABLED` (frontend). Default **off**. Backend endpoints return 404 when off. Frontend falls through to existing `useLearnerSetup` behavior when off.
4. **No new npm packages.** Do not add `vanilla-cookieconsent` or any other dependency.
5. **Tests must pass before each PR.** Verification commands are in the plan per slice. Run Vitest + Pytest for the slice, and the new Playwright spec(s) added in Slices 2–3. Paste the green output in the PR description.
6. **Playwright role override.** The global `playwright.config.ts` launches Flask with `LOCAL_DEV_USER_ROLE=admin`. Do **not** change the global default. New learner specs override the role per-test via `page.route('**/api/auth/session', ...)`, matching the pattern in `pathfinder-account.spec.ts` and `onboarding-tours.spec.ts`.
6. **Do not touch:** `parental_consents` table, therapist flow, parent/teacher profile shape, the existing role-picker behavior (the new gate runs *after* `WelcomeRolePicker`).
7. **Code style:** follow existing patterns in `app.py` for routes (CSRF + auth decorators), existing patterns in `storage_postgres.py` for SQL, existing patterns in `frontend/src/onboarding/tours.ts` for tour definitions.
8. **Do not write new markdown docs** unless explicitly requested. The plan markdown already exists.
9. Wrap each slice with: confirm open questions (see plan §"Open questions"), implement, run verification, summarize files changed + test output.

## Confirm before starting Slice 1

Ask the user to confirm the four open questions from the plan:
1. Separate `learner_profiles` table (recommended) vs. extending `learning_students`.
2. Allowed exam enum source — hardcode current set or move to config.
3. `tour_seen_at` column (recommended) vs. piggyback on `ui_state`.
4. Under-18 guardian email — client-side gate only (recommended) vs. server-enforced.

After confirmation, proceed with Slice 1 as written in the plan. Do not start Slice 2 or 3 until Slice 1's PR is merged.

## First actions in your turn

1. Read [voicelive-api-salescoach/docs/plans/learner-profile-onboarding-plan.md](voicelive-api-salescoach/docs/plans/learner-profile-onboarding-plan.md) end-to-end.
2. Verify branch state: `cd /home/ayoola/sen/voicelive-api-salescoach && git status --short && git log -1 --oneline` — expect a clean working tree on `feat/pathfinder-learner-voicelive`.
3. Ask the user the four open questions above. Wait for answers.
4. Create the working branch and start Slice 1.

Do not modify any file before steps 1–3 are complete.
