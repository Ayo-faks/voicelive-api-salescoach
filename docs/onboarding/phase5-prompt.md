# Phase 5 Build Prompt — Admin Content Editor (`ui_content_overrides`)

> **Plan of record:** [docs/onboarding/onboarding-plan-v2.md](./onboarding-plan-v2.md) — Tier A §3 (`ui_content_overrides`), §Content governance, §Rollback, Phase 5 rollout (item 17). This is the **optional** final phase.
> **Status going into Phase 5:** Phases 1–4 shipped. The Phase 1 migration created `ui_content_overrides` as nullable/empty, but no read-through, no admin UI, no editor endpoints. All copy currently flows through `frontend/src/onboarding/t.ts` with code defaults.

You are completing the v2 onboarding system. Phase 5 delivers the optional admin-only content editor: a surface where an authenticated admin can override the English (and eventually localised) copy for any `t(key, defaultEnglish)` key without a code deploy. This is a product-ops tool; the bar is "safe, auditable, instantly revertible" rather than "rich".

**Scope discipline:** Phase 5 is explicitly optional per v2 §Phased rollout and v2 §Rollback. If the product owner has not explicitly asked to ship it, stop at §2 (design review) and ask before writing code.

---

## 1. Non-negotiable constraints

- **Admin-only.** Every new endpoint is gated by `role === 'admin'` via the existing auth dependency (follow `_require_admin` or the pattern used for workspace admin endpoints — grep `backend/src/app.py` for `allowed_roles={ADMIN}`). Therapists, parents, pending_therapists, and the child persona must all receive 403.
- **No child exposure.** The editor surface is rendered only inside the therapist/admin app shell. The child tablet never fetches overrides for keys used in `childOnboarding/*`. Render-time lookup in child mode must continue to fall through to the code default — document this explicitly in the read-through helper.
- **Content registry remains source of truth.** `frontend/src/onboarding/*.ts` + `t.ts` defaults stay in the repo. `ui_content_overrides` is a read-through cache layer; if the table is empty or unreachable, the app renders identically to today. Never mutate the TS registry from the editor.
- **No new telemetry properties beyond the existing taxonomy.** Emit `onboarding.content_override_saved` (admin-only) with `{ content_key, locale, action: 'upsert' | 'delete', actor_role: 'admin' }`. No free-text fields, no preview of `body`. Keep cardinality bounded (enum `action`, enum `actor_role`).
- **No bundle cost on the child / therapist / parent entry.** The editor UI lazy-loads behind `React.lazy` at `/admin/onboarding-content` and is gated out of the main chunk.
- **No schema loosening.** The Phase 1 migration already created `ui_content_overrides(content_key TEXT, locale TEXT, body TEXT, updated_by TEXT, updated_at TEXT)` with a composite PK on `(content_key, locale)`. Phase 5 only *activates* it — do not add columns; if you genuinely need one, write a new migration following the raw-SQL style per `/memories/repo/voicelive-api-salescoach.md`.
- **SQLite + Postgres parity (repo memory #31).** Any new read/write path must pass `pytest backend/tests/test_ui_content_overrides.py` under both backends.
- **RLS / Easy Auth.** `/api/admin/onboarding-content` is authenticated (do NOT add to `excludedPaths` in [infra/resources.bicep](../../infra/resources.bicep), per repo memory #41/#43). Postgres enforces role gate in Python, not RLS — keep consistent with other admin endpoints.
- **Audit every write.** Insert into `ui_state_audit` with `event='content_override.upsert'` or `'content_override.delete'`, payload `{ content_key, locale }` (never the `body`). Audit retention is 90 days (v2 §GDPR).
- **Legal copy is out of scope.** Consent / privacy / TOS copy lives under `frontend/src/components/legal/*` and must NOT be addressable by the editor. Enforce with a deny-list of `content_key` prefixes (e.g., `legal.*`, `consent.*`, `privacy.*`).

---

## 2. Context to load first

Read in full:

- [docs/onboarding/onboarding-plan-v2.md](./onboarding-plan-v2.md) §Tier A #3 (migration shape), §Content governance, §Rollback, §Verification #9, §Security, Phase 5 item 17.
- [backend/alembic/versions/20260423_000023_user_ui_state.py](../../backend/alembic/versions/20260423_000023_user_ui_state.py) — confirm `ui_content_overrides` columns and PK.
- [backend/src/schemas/ui_state.py](../../backend/src/schemas/ui_state.py) — pattern for JSON Schema validation.
- [backend/src/app.py](../../backend/src/app.py) — grep `_require_admin` (or the equivalent `allowed_roles={ADMIN}`), `@require_role`, `_log_audit_event`; reuse the existing admin endpoint mounting convention.
- [backend/src/services/storage_sqlite.py](../../backend/src/services/storage_sqlite.py) and [storage_postgres.py](../../backend/src/services/storage_postgres.py) — follow `dict_row` cursor convention (repo memory: tuple indexing has caused 500s).
- [frontend/src/onboarding/t.ts](../../frontend/src/onboarding/t.ts) — where the read-through override lookup must land.
- `frontend/src/onboarding/tours.ts`, `helpContent.ts`, `announcements.ts`, `checklist.ts` — enumerate all `content_key`s that the editor will see; the editor's pick list comes from a generated index, not a free-text field.
- [frontend/src/services/api.ts](../../frontend/src/services/api.ts) — pattern for typed fetchers + error handling.
- [frontend/src/components/SettingsView.tsx](../../frontend/src/components/SettingsView.tsx) — existing admin-routed page for layout convention.
- `/memories/repo/voicelive-api-salescoach.md`, `/memories/repo/security-model-current.md`, `/memories/repo/deploy-arm64-binfmt.md`.

Skim:

- [infra/resources.bicep](../../infra/resources.bicep) `excludedPaths` — confirm `/api/admin/onboarding-content` is **not** added. `/admin/onboarding-content` (SPA route) IS added to excluded paths (it is an SPA route, per repo memory #41).
- [docs/onboarding/phase3-prompt.md](./phase3-prompt.md) and [phase4-prompt.md](./phase4-prompt.md) for tone + section layout parity.

---

## 3. Deliverables

### 3.1 Content-key index generator

`frontend/src/onboarding/contentKeys.ts` (new):

- A build-time-flat export `export const CONTENT_KEYS: ReadonlyArray<{ key: string; defaultEnglish: string; surface: string; role?: Role }>` derived from the existing registries (`tours.ts`, `helpContent.ts`, `announcements.ts`, `checklist.ts`, and child copy via `childOnboarding/copy.ts`).
- Generate by **static import** from those modules (do not walk the filesystem at runtime). Each registry already has a `t(key, default)` call; introduce a small `makeContentEntry({ key, default, surface, role })` helper so the index is a byproduct of the existing call sites — do NOT duplicate the strings. The editor's picker renders this list.
- Add a deny-list: entries whose `surface` starts with `legal.`, `consent.`, `privacy.`, or `admin.` are excluded from the editor UI (server-side enforced as well).

Tests (`contentKeys.test.ts`):
- No duplicate `(key, locale)` pairs.
- All exported keys are prefixed by an approved surface.
- Deny-listed keys are absent.

### 3.2 Backend endpoints

Mount under `/api/admin/onboarding-content`. Gated by `_require_admin` (or equivalent; confirm the actual helper name by grep). All responses JSON.

1. `GET /api/admin/onboarding-content?locale=en` — returns `Array<{ content_key, locale, body, updated_by, updated_at }>`. Supports `?content_key=…` filter.
2. `PUT /api/admin/onboarding-content/{content_key}` — body `{ locale: string, body: string }`. Upserts a row.
   - JSON Schema validation (`backend/src/schemas/ui_content_overrides.py`, new):
     - `locale`: enum of supported locales (start with `['en']`; keep extensible).
     - `body`: non-empty string, length ≤ 2000 chars.
     - `content_key`: must match pattern `^[a-z0-9][a-z0-9._-]{1,127}$` and must not start with a deny-listed prefix.
   - Rate limit: `30/min` per admin, below the `120/min` global mutation bucket.
   - Sets `updated_by` to the calling admin's user id, `updated_at` to `datetime.now(UTC).isoformat()`.
   - Emits audit row via `_log_audit_event` + `ui_state_audit` insert, payload `{ content_key, locale }` (no `body`).
3. `DELETE /api/admin/onboarding-content/{content_key}?locale=en` — removes override. Returns 204 whether or not a row existed (idempotent).
4. `GET /api/content/onboarding?locale=en` — **public-authenticated** read-through feed for the running app. Returns a flat `{ [content_key]: body }` map for the requested locale, filtered to non-legal surfaces. Cached in memory at the backend with a 60-second TTL invalidated on any admin mutation.
   - This is the only endpoint any non-admin will hit.
   - It must NOT include entries whose `surface` matches the deny-list (enforce server-side in addition to the editor filter).

Backend tests (`backend/tests/test_ui_content_overrides.py`):
- Role gating: therapist/parent/pending_therapist → 403 on admin endpoints; child → 403.
- Deny-list: `PUT /api/admin/onboarding-content/legal.tos` → 422.
- Schema: oversize `body` → 422; unknown key pattern → 422; missing `locale` → 422.
- Rate limit: 31st PUT/min → 429.
- Audit: each upsert/delete creates a `ui_state_audit` row with `event` and key-only payload.
- Parity: SQLite + Postgres (repo memory #31).
- Cache invalidation: PUT then immediate GET reflects new body on the public feed.
- Idempotent delete: DELETE a non-existent key → 204.

### 3.3 Frontend read-through

Modify `frontend/src/onboarding/t.ts`:

- Add a module-level `overrides: Record<string, string> | null = null`.
- Export `hydrateContentOverrides(map: Record<string, string>)` called once at app boot after authentication (wire from `App.tsx` boot effect, only for non-child contexts — the boot loader calls `GET /api/content/onboarding?locale=en` and hydrates).
- `t(key, defaultEnglish)` returns `overrides?.[key] ?? defaultEnglish`.
- Must remain synchronous and pure for existing call sites; never throw if overrides are null.
- In child-mode render paths, skip hydration entirely — `t()` falls through to defaults. Assert this with a test: spy `fetch` inside a child-rendered fixture; `/api/content/onboarding` must not be called.

Tests (`t.test.ts`):
- Returns default when overrides null.
- Returns override when hydrated.
- `hydrateContentOverrides` with an empty object clears previous values.
- Deny-list keys are silently ignored even if the server were to return them.

### 3.4 Admin UI

`frontend/src/components/admin/OnboardingContentEditor.tsx` (new, lazy-loaded):

- Route: `/admin/onboarding-content`. Add to the SPA router and to `excludedPaths` in `infra/resources.bicep` (SPA routes ARE excluded; API routes are NOT — repo memory #41/#43). Add a brief comment next to the bicep entry referencing this prompt.
- Nav entry: surface in `SidebarNav` only when `role === 'admin'`.
- UI (Fluent UI v9; reuse existing tokens):
  - Left pane: searchable list of `CONTENT_KEYS` (from §3.1), grouped by `surface`, showing override status (dot if overridden).
  - Right pane: selected key shows `default` (read-only, monospace), `body` (textarea, ≤2000 chars, live count), `locale` dropdown (initially only `en`).
  - Actions: **Save**, **Revert to default** (DELETE), **Preview** (opens a side panel rendering the string inside the closest component snapshot — accept a static preview for now, do not build a live render harness; simple `<p>` render is sufficient for Phase 5).
  - Show `updated_by` + relative `updated_at` on overridden rows.
  - Unsaved-changes guard on route leave.
- All strings in the editor itself go through `t()` with `admin.content-editor.*` keys (which are themselves deny-listed so the editor cannot edit its own UI — avoid the footgun where an admin bricks the editor by overriding its Save button label).
- Accessibility: keyboard navigation, labelled form controls, live region announces save/delete success.

Tests (`OnboardingContentEditor.test.tsx`):
- Non-admin cannot render (guard renders null + redirect).
- Save calls `PUT` with exact payload; revert calls `DELETE`.
- Unsaved-changes guard fires on route change.
- Deny-listed keys absent from the picker.
- 429 response surfaces a non-blocking toast and preserves form state.

### 3.5 Telemetry

Extend `frontend/src/onboarding/events.ts`:

- Add `onboarding.content_override_saved { content_key, locale, action, actor_role }`.
- Enum-constrain `action: 'upsert' | 'delete'`, `actor_role: 'admin'`.
- Emit from the editor after a successful save/delete (not from the backend).
- No event on the public `GET /api/content/onboarding` feed.

Tests: event emitted with bounded properties; child-mode spy asserts it never fires.

### 3.6 Infra & deploy

- `infra/resources.bicep` — add `/admin/onboarding-content` to SPA `excludedPaths` only. Do not add `/api/admin/onboarding-content` or `/api/content/onboarding`.
- Bundle budget: `admin/OnboardingContentEditor` must appear as a lazy chunk (`dist/assets/admin-onboarding-*.js`). Main-entry budget stays within +15 KB gzipped of the pre-Phase-5 baseline.
- No new runtime deps. Fluent UI v9 + existing utilities cover the UI; use existing `api.ts` fetcher helpers.
- arm64 binfmt-safe: pure-JS only (`/memories/repo/deploy-arm64-binfmt.md`).

### 3.7 Verification

**Automated**

1. Parity: `pytest backend/tests/test_ui_content_overrides.py` under `DATABASE_BACKEND=sqlite` **and** `DATABASE_BACKEND=postgres`.
2. Role gating across all four admin endpoints.
3. Deny-list enforcement (server + editor index).
4. Cache TTL + invalidation on admin mutation.
5. Schema rejection: oversized body, malformed key, unknown locale.
6. Audit-row emission without body values.
7. Rate limit 31st/min → 429.
8. Frontend: `t.test.ts` hydration behaviour; `OnboardingContentEditor.test.tsx` admin flows; child-context spy asserting no `/api/content/onboarding` fetch.
9. Bundle assertion: admin chunk exists and main entry delta ≤ 15 KB gzipped.

**Manual**

10. Admin logs in → navigates to `/admin/onboarding-content` → overrides the `welcome-therapist` step 1 body → new therapist in an incognito session sees the override (after 60-second TTL) without a deploy.
11. Admin reverts → default restored.
12. Non-admin directly navigates to `/admin/onboarding-content` → redirected.
13. Child session → network inspector: no call to `/api/content/onboarding`.
14. Kill switch: `ONBOARDING_TOURS_ENABLED=false` still overrides the editor's live effect (tours don't render regardless of overrides).

### 3.8 Rollback

- Override rows can be deleted via the editor itself (no deploy needed).
- Full disable: remove the `/admin/onboarding-content` SPA route from `excludedPaths` and redeploy — the API stays dormant if no UI reaches it. Override reads from `/api/content/onboarding` can be force-disabled by setting a new env `ONBOARDING_CONTENT_OVERRIDES_ENABLED=false` (default `true`) consumed by both the endpoint (returns `{}`) and the frontend boot (skips hydration). Add this env + `/api/config` surfacing in a tiny follow-up commit; keep it independently flippable.

---

## 4. Out of scope (defer beyond Phase 5)

- Multi-locale translation runtime (v2 explicitly keeps `t()` dumb; locale set stays `['en']` until the first non-English locale is formally requested).
- Versioning / history beyond the audit log (no diff UI, no rollback-to-version-N tool — delete + re-save is the workflow).
- Rich-text editing, Markdown rendering in `body`, media embeds — `body` is plain text.
- Editing child-mode copy through the editor (`childOnboarding/copy.ts` keys are not in the picker; they remain code-only for Children's Code audit clarity).
- Any legal/consent/privacy copy (deny-listed).
- Impersonation / view-as-user preview.
- Bulk import/export (CSV). Phase 5 is one-at-a-time editing.

---

## 5. Execution plan (track with `manage_todo_list`)

1. Confirm `ui_content_overrides` migration shape matches the plan; add a follow-up migration only if a column is genuinely missing.
2. Build `CONTENT_KEYS` index via static imports from existing registries; add `contentKeys.test.ts`.
3. Implement backend JSON schema + admin endpoints + public read-through endpoint + audit + rate limit.
4. Parity tests under both backends.
5. Wire read-through into `t.ts`; add hydration call at adult-app boot; verify child paths skip hydration.
6. Build `OnboardingContentEditor` (lazy chunk) + route + sidebar gating.
7. Extend telemetry taxonomy.
8. Bicep update: SPA route in `excludedPaths` (not API).
9. Kill-switch env variable (`ONBOARDING_CONTENT_OVERRIDES_ENABLED`) wired through `/api/config`.
10. Run `pytest` (both backends) and `npx vitest run`; confirm baseline regressions only include the two pre-existing `InsightsRail.voice` cases.
11. `npm run build` bundle-delta check.
12. Update `/memories/repo/voicelive-api-salescoach.md` if a durable fact was discovered (e.g., new admin endpoint pattern).

---

## 6. Done criteria

- Admin can upsert + delete overrides for any non-denylisted `content_key` without a deploy, and the change appears for a fresh session within ≤ 60 seconds (cache TTL).
- Non-admin personas (therapist, parent, pending_therapist, child) cannot reach any admin endpoint and do not fetch overrides in child mode.
- `t()` remains synchronous and returns code defaults when overrides are absent or disabled.
- Legal / consent / privacy / child-mode copy cannot be edited through this surface (server + UI + deny-list test).
- All new endpoints audited into `ui_state_audit` with key-only payloads.
- Parity green under SQLite and Postgres.
- Admin editor is a lazy chunk; main-entry bundle budget respected.
- `ONBOARDING_CONTENT_OVERRIDES_ENABLED=false` disables the feature end-to-end without a code change.
- Full frontend suite no worse than baseline; backend suite fully green.
- No changes to legal copy, child-mode code paths, Phase 1–4 components, or `excludedPaths` beyond the single SPA-route addition.

When done: post a concise summary (endpoints added, components added, tests added, bundle delta, any follow-ups for v3) and stop for user review.
