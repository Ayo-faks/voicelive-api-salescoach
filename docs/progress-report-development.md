# Progress Report Development Guide

Last updated: 2026-04-16

## Purpose

This document explains how the therapist progress-report feature is built today: data model, backend service boundaries, frontend orchestration, export rendering, lifecycle rules, and extension points.

Use it as the engineering-facing companion to the therapist-facing workflow in `docs/therapist-guide.md`.

## What The Feature Does

The report system turns saved dashboard evidence into a reusable child-scoped artifact.

In practical terms, a report is a persisted snapshot plus a workflow state machine:

- the therapist chooses an audience, review window, and exact session set
- the backend derives summary text, metrics, and audience-shaped sections from existing saved artifacts
- the draft can be edited while it is still in `draft`
- therapists can request an AI rewrite suggestion for the summary while the report is still in `draft`
- the draft can then move through `approved`, `signed`, and `archived`
- shared HTML and PDF exports can hide selected fields without destroying the fuller saved draft

The feature is intentionally not a free-form document editor.

The system is optimized for:

- reproducible creation from saved child data
- stable workflow rules
- controlled audience-specific language
- safe sharing through redacted exports

## Core Design Decisions

### 1. Reports are derived artifacts, not primary source data

Reports are generated from persisted sessions, approved child memory, plans, and recommendation history.

That means the authoritative source remains elsewhere:

- sessions stay in session storage
- approved memory stays in child-memory storage
- plans stay in plan storage
- recommendation runs stay in recommendation storage

The report stores a snapshot of derived values so the therapist has a stable artifact to review and share.

### 2. Routes stay thin

The Flask routes validate request shape, enforce auth and child access, and delegate to `ProgressReportService`.

All domain logic for report creation, update regeneration, redaction filtering, and export rendering lives in `backend/src/services/report_service.py`.

### 3. Storage owns persistence and JSON serialization

SQLite and PostgreSQL both expose the same report CRUD methods. The service writes normal Python dictionaries and lists; the storage implementations own the JSON serialization details.

### 4. Redactions affect shared export output, not the underlying report sections

The saved report keeps its full generated sections.

Redaction overrides are applied when building export context. This is why the same report can stay clinically complete inside Wulo while producing a narrower parent or school handoff.

### 5. Workflow state is explicit and enforced

The lifecycle is intentionally strict:

- `draft` can be updated
- `draft` can be approved
- `approved` can be signed
- `approved` and `signed` can be archived

This keeps the report feature closer to a workflow-controlled artifact than a casual note.

## Main File Map

### Backend

- `backend/src/services/report_service.py`
  Core domain logic for list/create/get/update/approve/sign/archive and HTML/PDF export rendering.
- `backend/src/app.py`
  Flask routes for report CRUD, export, and workflow transitions.
- `backend/src/services/storage.py`
  SQLite schema bootstrap and report CRUD operations.
- `backend/src/services/storage_postgres.py`
  PostgreSQL report CRUD operations.
- `backend/alembic/versions/20260416_000019_progress_reports.py`
  PostgreSQL table creation and row-level security.

### Frontend

- `frontend/src/types/index.ts`
  Shared TypeScript contracts for report payloads, sections, snapshots, statuses, audiences, and redaction overrides.
- `frontend/src/services/api.ts`
  Auth-aware REST client methods and export URL helper.
- `frontend/src/app/App.tsx`
  Top-level loading, report state, and handlers.
- `frontend/src/components/ProgressDashboard.tsx`
  Report composer UI, report history, section preview, redaction controls, and export buttons.

### Tests

- `backend/tests/unit/test_report_service.py`
  Unit coverage for service generation, redaction behavior, and lifecycle transitions.
- `backend/tests/integration/test_report_endpoints.py`
  Route-level coverage for auth, export, validation, and lifecycle actions.
- `backend/tests/integration/test_storage_parity.py`
  Cross-backend behavior checks so SQLite and PostgreSQL stay aligned.
- `frontend/src/components/ProgressDashboard.test.tsx`
  UI wiring smoke coverage.

## Domain Model

### Primary identity and ownership

Each report belongs to:

- one child
- one workspace
- one creator
- optionally one signing user

The persisted record contains:

- `id`
- `child_id`
- `workspace_id`
- `created_by_user_id`
- `signed_by_user_id`

### Lifecycle fields

- `status`
- `approved_at`
- `signed_at`
- `archived_at`
- `created_at`
- `updated_at`

### Authoring fields

- `audience`
- `report_type`
- `title`
- `period_start`
- `period_end`
- `included_session_ids`
- `summary_text`

### Derived content fields

- `snapshot`
- `sections`
- `redaction_overrides`

## Allowed Audiences And Statuses

The current backend constants are:

- audiences: `therapist`, `parent`, `school`
- statuses: `draft`, `approved`, `signed`, `archived`

The frontend mirrors these as literal TypeScript unions. If you add a new audience or status, backend and frontend must be updated together.

## Database Shape

### SQLite

SQLite creates `progress_reports` lazily during bootstrap in `StorageService._ensure_progress_report_table(...)`.

Structured fields are stored as JSON text columns:

- `included_session_ids_json`
- `snapshot_json`
- `sections_json`
- `redaction_overrides_json`

### PostgreSQL

PostgreSQL creates the same table through Alembic, but uses JSONB for the structured fields.

The migration also enables row-level security and adds a child-scoped access policy. The policy allows access when one of these is true:

- the system is explicitly bypassing RLS
- the current role is `admin`
- the current user is linked to the child through `user_children`

That is the database-layer complement to the Flask role and child-access checks.

## End-To-End Creation Flow

### 1. The dashboard loads report context with the child workspace

When the selected child changes, `frontend/src/app/App.tsx` loads the child-specific review context in parallel. Reports are loaded alongside:

- sessions
- plans
- child memory summary and items
- child memory proposals
- recommendation history

This is important because report generation depends on the same saved artifacts the dashboard already exposes.

### 2. The report composer stores local draft inputs in the dashboard

`ProgressDashboard.tsx` owns the report composer state:

- audience
- title
- executive summary note
- review-window start and end dates
- selected session IDs
- normalized redaction overrides

If the therapist opens an existing report, the dashboard restores the saved report state into the composer.

If no report is selected, the composer initializes from the current session list and a default date range.

### 3. The frontend sends a create request

The main create endpoint is:

```text
POST /api/children/<child_id>/reports
```

The frontend payload is built from `buildReportComposerPayload()` and contains:

- audience
- optional title
- optional summary text
- period start and end
- explicit included session IDs
- persisted redaction overrides

### 4. The route validates request shape and access

The route in `backend/src/app.py` does four things before creation:

1. Requires therapist or admin role.
2. Requires child-scoped access.
3. Validates that `included_session_ids` is a list if present.
4. Validates that `redaction_overrides` is an object if present.

Once those checks pass, the route delegates to `report_service.create_report(...)`.

### 5. The service derives report artifacts

`ProgressReportService.create_report(...)` calls `_build_report_artifacts(...)`.

This method is the core of report creation.

It performs the following steps:

1. Load the child.
2. Normalize the audience.
3. Normalize the selected session IDs.
4. Load the child session summaries.
5. Resolve the included sessions through `_resolve_included_sessions(...)`.
6. Build the generated summary text.
7. Build the snapshot.
8. Build the audience-specific sections.

### 6. Session selection rules are explicit

`_resolve_included_sessions(...)` applies these rules:

- if explicit session IDs are given, only those sessions are eligible
- if a date range is given, sessions outside the range are excluded
- if `period_start > period_end`, creation fails
- if the therapist explicitly selected sessions or a filtered range and nothing matches, creation fails
- if nothing was explicitly selected and no date range was supplied, the service falls back to the first six saved sessions

That fallback is intentional. It gives the feature a sensible default while still making explicit selection strict.

### 7. The service builds a snapshot

`_build_snapshot(...)` captures a summarized view of the evidence used at creation time.

Today the snapshot includes:

- child name
- generation timestamp
- session count
- latest session timestamp
- average overall score
- average accuracy score
- average pronunciation score
- focus targets derived from selected sessions
- child memory summary text and source item count
- latest approved plan title, status, and objective
- top recommendation name and rationale from recent recommendation history

This is a denormalized convenience layer. It exists so the report can carry a coherent summary without re-querying every downstream object on every render.

### 8. The service builds audience-specific sections

`_build_sections(...)` always starts with two common sections:

- `overview`
- `session-highlights`

After that, the generated section set depends on audience.

Current audience-specific sections are:

- therapist:
  - `clinical-focus`
  - `next-steps`
- parent:
  - `family-wins`
  - `home-support`
- school:
  - `school-impact`
  - `classroom-support`

The section copy is intentionally simple and deterministic. This is not an LLM-generated document layer.

### 9. The report is persisted as a draft

The storage layer saves the report with:

- `status = draft`
- normalized authoring fields
- included session IDs
- snapshot
- sections
- redaction overrides
- summary text

At this point the report is a persisted workflow artifact, not just transient UI state.

## Update Flow

### Update endpoint

Draft updates go through:

```text
POST /api/reports/<report_id>/update
```

### Update rules

Only `draft` reports can be updated.

This matters because the backend treats approval and signing as workflow milestones. Once a report leaves `draft`, the update route will reject further edits.

### Context-sensitive regeneration

The most important implementation detail in `update_report(...)` is that it distinguishes between:

- cosmetic edits, and
- context changes

Context changes are:

- audience changed
- review-window start changed
- review-window end changed
- selected session IDs changed

When the reporting context changes, the service rebuilds the derived artifacts.

That means it regenerates:

- snapshot
- sections
- period bounds
- included session IDs

It also tries to preserve user edits intelligently.

If the current title or summary still matches the previously generated default, the service replaces it with the new generated default.

If the therapist had already overwritten those fields manually, the update flow keeps the manual edits.

That behavior prevents accidental clobbering of therapist-written copy while still keeping the defaults fresh when the report scope changes.

### Draft-only summary rewrite suggestion

The summary rewrite path is deliberately separate from normal create and update flow.

The endpoint is:

```text
POST /api/reports/<report_id>/summary-rewrite
```

Important constraints:

- it only works for `draft` reports
- it never mutates the saved report automatically
- it returns a suggested summary plus the current saved summary for review
- the therapist must explicitly apply the suggestion in the UI and then save the draft if they want to persist it

This keeps AI assistance bounded to copy improvement without turning the report workflow into an agentic system.

## Workflow State Machine

The workflow actions are exposed as dedicated endpoints:

```text
POST /api/reports/<report_id>/approve
POST /api/reports/<report_id>/sign
POST /api/reports/<report_id>/archive
```

### State transitions

- `draft -> approved`
- `approved -> signed`
- `approved -> archived`
- `signed -> archived`

### Enforcement

The service enforces transitions directly:

- only draft reports can be approved
- only approved reports can be signed
- only approved or signed reports can be archived

The route layer does not duplicate these rules. It just converts service `ValueError`s into HTTP errors.

## Export Pipeline

### Export endpoint

Shared export goes through:

```text
GET /api/reports/<report_id>/export?format=html|pdf&download=1
```

The current supported formats are:

- `html`
- `pdf`

### Access model

Export requires:

- authentication
- therapist or admin role
- child-scoped access

Parents cannot export reports even if they have child access elsewhere in the product. That is a deliberate policy choice in the current implementation.

### Export context

Exports are built through `_build_export_context(...)`.

This method:

1. Loads the saved report.
2. Re-loads the child for display fallback.
3. Re-resolves the included sessions.
4. Normalizes redaction overrides.
5. Builds metric cards, badges, and visibility flags.
6. Filters sections through redaction rules.
7. Produces a final context dictionary for HTML or PDF rendering.

### Redaction model

Current redaction controls are:

- `hide_summary_text`
- `hide_overview_metrics`
- `hide_session_list`
- `hide_internal_metadata`
- `hidden_section_keys`

Important behavior:

- redactions are normalized before use
- hidden section keys are filtered against the actual audience-supported section list in the UI
- exports hide content without removing the underlying saved sections
- if all sections are hidden, export rendering inserts a fallback "Export view" section instead of returning an empty body

### HTML export

HTML export is fully server-rendered.

The service builds:

- hero header
- optional executive summary
- optional overview metrics
- optional included-session panel
- section blocks
- share-safe footer

The output also includes a print button so the HTML export doubles as a print-friendly browser view.

### PDF export

PDF export is also server-rendered.

It uses ReportLab when available and returns a raw PDF byte stream.

If ReportLab is unavailable, the backend raises a runtime error and the route returns HTTP 503 with an explicit message.

This is the correct failure mode because the feature is optional at dependency level but the route contract is explicit.

## Frontend Orchestration

### Types

The frontend types in `frontend/src/types/index.ts` mirror the backend model closely.

That includes:

- audience and status unions
- `ProgressReport`
- `ProgressReportSnapshot`
- `ProgressReportSection`
- `ProgressReportRedactionOverrides`
- create and update request payloads
- export format union

Keep these aligned with backend payloads. A silent mismatch here causes hard-to-debug UI issues because the report screens rely heavily on structured section and snapshot data.

### App-level state

`frontend/src/app/App.tsx` owns:

- `progressReports`
- `selectedReport`
- `loadingReports`
- `reportSaving`
- `reportError`

It also exposes the dashboard handlers for:

- open detail
- create
- update
- suggest summary rewrite
- approve
- sign
- archive
- open export

### Why export uses a URL instead of `fetch`

`getReportExportUrl(...)` returns a route URL rather than a fetch promise.

This is the correct choice because preview and download behave like document navigation, not JSON mutation calls.

The app can therefore:

- `window.open(...)` for preview
- `window.location.assign(...)` for download

without building custom blob handling code in the client.

### Dashboard-specific behavior

The dashboard adds two important behaviors on top of the raw API surface:

1. It restores an existing report draft back into the composer when selected.
2. It auto-saves draft state before opening HTML or PDF export.

There is also a third report-specific behavior now:

3. It saves the current draft before requesting a summary rewrite suggestion, so the suggestion is grounded in the same report scope and saved summary the therapist is currently editing.

That second behavior matters. Without it, the therapist could preview an outdated export while looking at unsaved composer changes.

## Persistence Responsibilities

The storage layer exposes a consistent interface across SQLite and PostgreSQL:

- `save_progress_report(...)`
- `list_progress_reports_for_child(...)`
- `get_progress_report(...)`
- `update_progress_report(...)`
- `approve_progress_report(...)`
- `sign_progress_report(...)`
- `archive_progress_report(...)`

The service does not know whether the backend is SQLite or PostgreSQL.

That separation is what makes the parity test coverage valuable.

## Security And Access Model

There are two layers of protection.

### Application layer

Routes require:

- authenticated user
- therapist or admin role for report operations
- verified access to the child

### Database layer

PostgreSQL additionally enforces child-scoped row-level security.

That means the report feature does not rely only on Flask route correctness. The storage layer also runs inside database-side access boundaries.

## Testing Strategy

### Unit tests

`backend/tests/unit/test_report_service.py` covers:

- report creation
- report update and regeneration
- redacted HTML export
- PDF generation
- approve, sign, and archive transitions

### Integration tests

`backend/tests/integration/test_report_endpoints.py` covers:

- create/list/detail/update/export workflow
- invalid export format rejection
- PDF export response type
- parent access rejection
- unscoped therapist rejection

### Storage parity tests

`backend/tests/integration/test_storage_parity.py` is critical for this feature because the report system stores structured JSON payloads and workflow timestamps. The parity test protects the repo from SQLite/PostgreSQL behavioral drift.

### Frontend tests

The frontend coverage is intentionally lighter. It focuses on wiring and dashboard behavior rather than reproducing the backend generation logic in UI tests.

## Recommended Validation Commands

For report-specific work, start with:

```bash
cd backend
/home/ayoola/sen/.venv/bin/python -m pytest tests/unit/test_report_service.py tests/integration/test_report_endpoints.py tests/integration/test_storage_parity.py

cd ../frontend
npm run test -- src/components/ProgressDashboard.test.tsx
npm run build
```

If you changed Flask route wiring or global app boot behavior, also run the existing app-level backend tests.

## How To Extend The Feature Safely

### Add a new audience

You must update all of the following together:

1. `VALID_AUDIENCES` in `report_service.py`
2. TypeScript audience unions in `frontend/src/types/index.ts`
3. frontend audience dropdown options in `ProgressDashboard.tsx`
4. `_build_sections(...)` audience branch
5. any audience-specific redaction section options in the dashboard
6. backend and frontend tests

If you skip any of these, the UI and backend will drift immediately.

### Add a new generated section

Update:

1. `_build_sections(...)`
2. shared redaction options if the section should be hideable
3. tests asserting audience-specific section presence or hiding
4. any documentation that describes parent or school exports

### Add a new export format

Update:

1. the route format validation in `app.py`
2. the render method surface in `ProgressReportService`
3. the frontend `ReportExportFormat` union
4. the export buttons in `ProgressDashboard.tsx`
5. endpoint integration tests

### Add a new snapshot field

Update:

1. `_build_snapshot(...)`
2. TypeScript `ProgressReportSnapshot`
3. storage serializers only if the structure type changes materially
4. report previews if the field is surfaced in the UI or export

## Common Failure Modes

### "No saved sessions matched the selected report window"

This means the therapist selected an explicit range or session set that produced an empty result after filtering.

This is usually correct behavior, not a bug.

### "Only draft reports can be updated"

The workflow state machine is being violated. The fix is not to bypass the guard casually; decide whether the product should support revisioned approved reports or cloned edits instead.

### PDF export returns 503

ReportLab is missing from the runtime environment.

### Parent access gets 403 on report routes

That is current policy. Parents are not first-class report operators in this implementation.

## Mental Model For Future Work

The simplest accurate way to think about this feature is:

1. The dashboard chooses scope.
2. The service compiles a child-scoped reporting artifact from saved evidence.
3. Storage freezes that artifact with workflow timestamps.
4. Export rendering projects the saved artifact into share-safe HTML or PDF.

If a future change does not fit cleanly into one of those four buckets, it probably belongs in a different layer than the one you are currently editing.