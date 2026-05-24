# Pathfinder Learn — Next-Session Execution Prompt

> Paste the block below into a fresh chat. It is self-contained: it tells the
> agent where the code lives, what the current state is, what to build, what to
> avoid, and how to verify. Pick **one** of the three "Track" options at the
> bottom (or let the agent choose A4 by default).

---

## Context (paste verbatim)

You are continuing work on **Pathfinder Learn**, a teacher-facing diagnostic +
HITL intervention surface inside the `voicelive-api-salescoach-pathfinder-phase-0`
repo. The codebase lives at:

```
/home/ayoola/sen/voicelive-api-salescoach-pathfinder-phase-0/
```

### Stack

- **Backend**: Python 3.12, Flask + Flask-Sock, Pydantic v2 (`ContractModel` has
  `extra=forbid`, `validate_assignment=True`), psycopg 3.
- **DB**: Postgres with RLS GUCs `app.tenant_id`, `app.class_id`, `app.user_id`,
  `app.role`, `app.system_bypass_rls`. Default in dev is SQLite via
  `DATABASE_BACKEND=sqlite` → `InMemoryLearningRepository`.
- **Alembic head**: `20260524_000026_intervention_plan_parent`.
- **Frontend**: Vite + React + FluentUI; `frontend/src/learning/*`.
- **Venv + tests**:
  ```bash
  cd /home/ayoola/sen/voicelive-api-salescoach-pathfinder-phase-0/backend
  /home/ayoola/sen/.venv/bin/python -m pytest tests/unit/ -q
  ```
  Current baseline: **481 passed**.

### What is already done (do NOT redo)

- **Slice 2** (B-series catalogue, validator) — shipped.
- **Slice 3 / A3** — `RalphXAPISink` HTTP emitter in
  [`backend/src/learning/xapi.py`](backend/src/learning/xapi.py). Stdlib
  `urllib.request`, env factory `build_ralph_sink_from_env()` reading
  `RALPH_BASE_URL`, `RALPH_AUTH_TOKEN`, `RALPH_TIMEOUT_SECONDS`. Per-statement
  status `ralph_synced | ralph_queued | ralph_failed`; failed statements
  enqueued into `learning_offline_queue` via `repository.queue_offline_event`.
- **Slice 3 / A5 (backend)** — `POST /api/learning/approvals/<plan_id>/edit-approve`
  in [`backend/src/learning/api.py`](backend/src/learning/api.py).
- **Slice 3 / Sink wiring** — `LearningApi._emit_xapi` and
  `DiagnosticEngine._emit_xapi` route every emission through the sink, then
  forward the real `sink_status` to `repository.emit_xapi_statement(...)`. No
  more `"ralph_queued"` literals in `api.py` / `diagnostic.py`.
- **Slice 3 / C1–C3** — `GET /api/learning/students/<student_id>/profile`,
  `POST /api/learning/students/<student_id>/override`, `StudentProfileViewEvent`
  xAPI verb. Tests in
  [`backend/tests/unit/test_learning_student_drilldown.py`](backend/tests/unit/test_learning_student_drilldown.py).

### Key invariants (do not break)

1. **xAPI sink status enum**: DB CHECK constrains `sink_status` to
   `audit_ledger | ralph_queued | ralph_synced | ralph_failed`. Any new emission
   path must use these literals.
2. **Repository protocol**: any new persistence method must be added to the
   `LearningRepository` Protocol in
   [`backend/src/learning/repository.py`](backend/src/learning/repository.py)
   AND implemented on both `InMemoryLearningRepository` and
   `LearningPostgresRepository`.
3. **RLS**: any new Postgres-backed table must be added to
   `LEARNING_RLS_PROTECTED_TABLES` and have RLS policies in the Alembic
   migration. The `assert_learning_rls_contract_active()` guard runs at startup.
4. **Pydantic v2**: `extra=forbid` on `ContractModel`. Don't pass unknown
   fields. `Provenance` has fields `source`, `source_id`, `rule_id`, `recency`,
   `confidence`, `evidence_count`, `metadata` — **no `retrieved_at`**.
5. **Pilot constants**: `PILOT_TENANT_ID = "tenant-phase-2"`,
   `PILOT_CLASS_ID = "class-jss2-a"`, `PILOT_STUDENT_ID = "pilot-jss2-student-001"`,
   `PILOT_TEACHER_ID = "pilot-jss2-teacher-001"`.
6. **No new third-party deps** unless absolutely required. Prefer stdlib +
   what's already in `backend/pyproject.toml`.

### Remaining deliverables (full backlog)

| ID | Title | Layer | Priority |
| --- | --- | --- | --- |
| **A4** | Kolibri LTI 1.3 launch flow | backend | **HIGH** |
| **C4–C8** | Student drilldown drawer + override UX (frontend) | frontend | HIGH |
| **A5-fe** | Wire `/edit-approve` into `ApprovalQueue` (FluentUI inline edit) | frontend | HIGH |
| **I1–I6** | Feature flags + Prometheus counters + OpenTelemetry spans | cross-cutting | MED |
| **B3** | `backend/scripts/seed_skills.py` | backend | LOW |
| **PG-bug** | `LearningPostgresRepository.save_intervention_plan` sparse return | backend | MED (latent — only fires when `DATABASE_BACKEND=postgres`) |

---

## Track A — A4: Kolibri LTI 1.3 launch flow (recommended)

Implement LTI 1.3 Resource Link Launch and Deep-Link Response so a Kolibri
Lesson can be embedded inside Pathfinder Learn (and vice versa). Pilot-only —
**offline-first**, no live IMS registration in tests.

### Scope

1. **New module** `backend/src/learning/lti.py`:
   - `LTIPlatformConfig` (Pydantic): `issuer`, `client_id`, `auth_login_url`,
     `auth_token_url`, `jwks_url`, `deployment_ids: List[str]`,
     `audience` (optional override).
   - `LTILaunchClaims` (Pydantic): parsed claims for the LTI 1.3 message.
     Required claims:
     - `iss`, `aud`, `sub`, `nonce`, `exp`, `iat`
     - `https://purl.imsglobal.org/spec/lti/claim/deployment_id`
     - `https://purl.imsglobal.org/spec/lti/claim/message_type` =
       `LtiResourceLinkRequest`
     - `https://purl.imsglobal.org/spec/lti/claim/version` = `1.3.0`
     - `https://purl.imsglobal.org/spec/lti/claim/resource_link` (`id`,
       optionally `title`)
     - `https://purl.imsglobal.org/spec/lti/claim/roles` (list of role URIs)
     - `https://purl.imsglobal.org/spec/lti/claim/context` (id, label, title)
   - `LTILaunchVerifier`:
     - Constructor takes a list of `LTIPlatformConfig` and a JWKS provider
       callable (so tests can inject in-memory keys).
     - `verify(id_token: str) -> LTILaunchClaims` validates signature, `iss`,
       `aud` matches `client_id` (or audience override), `exp`/`iat` within
       skew (default 60s), `nonce` not previously seen (in-memory replay cache
       OK for pilot), `deployment_id` in the configured set.
     - Raises `LTIValidationError` (new exception subclass of
       `LearningApiError` with status 401) for any failure.
   - Use `python-jose` if already in deps; otherwise fall back to `PyJWT`
     (check `backend/pyproject.toml`). If neither is present, prefer adding
     `pyjwt[crypto]` — single dep, well maintained.

2. **OIDC login initiation** (`POST /api/learning/lti/login`):
   - Accept form params `iss`, `login_hint`, `target_link_uri`,
     optional `lti_message_hint`, `client_id`, `lti_deployment_id`.
   - Find matching `LTIPlatformConfig`. Generate `state` + `nonce` (random,
     stored in an in-memory `LTIStateStore`, TTL 10 min).
   - Build the `auth_login_url` redirect: query params `response_type=id_token`,
     `response_mode=form_post`, `scope=openid`, `client_id`, `redirect_uri`,
     `login_hint`, `lti_message_hint`, `state`, `nonce`, `prompt=none`.
   - Return `{ "redirect_url": "<full URL>" }` (let the FE do `window.location`).

3. **Launch callback** (`POST /api/learning/lti/launch`):
   - Accept form-post body with `id_token`, `state`.
   - Resolve & invalidate `state` from the store; raise on mismatch.
   - `verify(id_token)` → `LTILaunchClaims`.
   - Map: `tenant_id = claims.context.label or PILOT_TENANT_ID`,
     `class_id = claims.context.id`, `student_id = claims.sub`,
     `role = "teacher" if any role URI contains "Instructor" else "learner"`.
   - Emit a new `LTILaunchEvent` xAPI statement (add to `xapi.py`,
     verb `https://pathfinder.learn/xapi/verbs/launched-lti`).
   - Return `302` redirecting to a frontend deep link:
     `/learning/launch?session={signed_token}` where `signed_token` is a
     short-lived JWT (HS256, secret from `LTI_SESSION_SECRET` env) carrying
     `tenant_id`, `class_id`, `student_id`, `role`, `exp` (15 min).

4. **Tests** (`backend/tests/unit/test_learning_lti.py`):
   - Generate an RSA keypair in-memory (`cryptography`), inject as JWKS.
   - Happy path: build a signed `id_token`, login → launch → verify response
     status 302, location starts with `/learning/launch?session=`, decoded
     session token has expected claims.
   - Failure cases: wrong `aud`, expired `exp`, unknown `deployment_id`,
     reused `nonce` (second launch with same nonce → 401), state mismatch.
   - At least **6 tests**.

### Acceptance

- All 481 existing tests still pass.
- New `test_learning_lti.py` adds 6+ tests, all green.
- No new top-level routes outside `/api/learning/lti/*`.
- `LTI_SESSION_SECRET` documented in `AGENTS.md` env table (one line).
- A4 task in the conversation summary marked done.

---

## Track B — C4–C8: Student drilldown frontend (alternative)

Build the teacher-side UI that consumes the new C1/C2 endpoints.

### Scope

1. **`frontend/src/learning/StudentProfileDrawer.tsx`** — FluentUI `Drawer`
   that opens from the `ClassMasteryHeatmap` cell click. Sections:
   - Header: student id, tenant id badge, "view profile" timestamp.
   - **Skill mastery table** (`DataGrid` from `@fluentui/react-components`):
     columns skill_label, probability (with progress bar), uncertainty, status
     badge (color: secure=green, developing=amber, needs_support=red).
   - **Recent responses** list (last 20, latest first).
   - **Recent mastery events** list with sparkline if time permits.
   - "Override mastery" button per row → opens `OverrideMasteryDialog`.

2. **`frontend/src/learning/OverrideMasteryDialog.tsx`** — modal form:
   - Fields: `probability` (slider 0–1 step 0.01), `uncertainty` (slider 0–1
     step 0.01, default 0.1), `reason` (textarea, min 5 chars, required).
   - Submit → `POST /api/learning/students/<id>/override` with
     `{ skill_id, probability, uncertainty, reason, tenant_id, actor_id }`.
   - On 200: toast "Mastery overridden", refresh profile.
   - On 4xx: surface error inline.

3. **Hook** `frontend/src/learning/useStudentProfile.ts`:
   - SWR-style fetcher around `/api/learning/students/<id>/profile`.
   - Mutate on override success.

4. **Wire-up**: in the existing `ClassMasteryHeatmap`, make each cell button-
   like; on click set `selectedStudentId` and open the drawer.

5. **Tests** (`frontend/src/learning/__tests__/StudentProfileDrawer.test.tsx`):
   - Vitest + React Testing Library. At least 5 tests:
     - Drawer renders skills from mocked profile response.
     - Override dialog opens with correct skill_id pre-filled.
     - Submitting valid form posts to the override endpoint.
     - Invalid probability disables submit.
     - Server error message is surfaced.

### Acceptance

- `npm --prefix frontend run lint && npm --prefix frontend run test` green.
- Backend tests still 481/481.
- No new env vars required.
- Use existing FluentUI v9 components only (already in `package.json`).

---

## Track C — PG sparse-return + Postgres parity (small, focused)

Latent bug: `LearningPostgresRepository.save_intervention_plan` returns
`{id, tenant_id, status, created_at}` only. The approval flow expects
`{plan, lang, provenance, ...}`. Fix and add Postgres parity tests.

### Scope

1. Fix `save_intervention_plan` in
   [`backend/src/learning/repository.py`](backend/src/learning/repository.py)
   so the returned dict matches the in-memory shape (include `plan`, `lang`,
   `provenance`, `created_by_user_id`, `updated_at`).
2. Add a regression test in `backend/tests/integration/` that runs the
   approve / reject / edit-approve roundtrip against a `testcontainers`
   Postgres (skip with `pytest.importorskip("testcontainers")`).
3. If `testcontainers` is unavailable, write a unit test using a
   `psycopg.connection`-style fake that records the SQL and returns a row
   matching the column list expected by the function.

### Acceptance

- Backend tests still pass.
- New regression covers the four call sites that consume the returned dict.

---

## How to execute (instructions to the new-session agent)

1. **Read `AGENTS.md`** at the repo root and
   `docs/onboarding/phase{3,4,5}-prompt.md` first for any extra context.
2. Confirm baseline before changing code:
   ```bash
   cd /home/ayoola/sen/voicelive-api-salescoach-pathfinder-phase-0/backend
   /home/ayoola/sen/.venv/bin/python -m pytest tests/unit/ -q
   ```
   Expect **481 passed**. If not, stop and report.
3. Pick **one Track** (A by default; ask the user if ambiguous).
4. Implement in small commits: contracts → repository plumbing → route →
   tests. Keep diffs minimal and surgical; do **not** refactor unrelated code.
5. Run the full unit suite after each meaningful change. Do not call
   `task_complete` until the suite is green.
6. End-of-session: update this prompt or the conversation summary with the
   freshly-completed track and the new remaining-deliverables list.

## Out of scope (do NOT touch this session)

- Phase 4 career planning module (`backend/src/learning/career/*`).
- Voice transport (`FlaskSockVoiceTransportAdapter`).
- `azure.yaml` / infra changes.
- Frontend e2e Playwright suite.
- Any modification to `Provenance` model fields.
- Any change to the xAPI sink_status enum / DB CHECK constraint.
