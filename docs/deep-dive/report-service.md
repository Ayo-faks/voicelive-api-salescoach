# The Wulo Progress Report Service — Deep Dive

The progress report service in [backend/src/services/report_service.py](../../backend/src/services/report_service.py) produces audience-aware progress reports (therapist / parent / school) from saved sessions, approved memory, plans, and recommendation runs. It is **deterministic by default**; an Azure OpenAI summary rewrite is offered as an opt-in *suggestion* the therapist must review before saving. The compilation logic lives in [report_pipeline.py](../../backend/src/services/report_pipeline.py), audience-time visibility in [report_redaction.py](../../backend/src/services/report_redaction.py), and HTML/PDF rendering in `report_exporters.py`.

---

## 1. Inputs

Triggered from `POST /api/children/<child_id>/progress-reports` and related endpoints in [backend/src/app.py#L2842](../../backend/src/app.py#L2842).

**a. Direct request inputs:**
- `child_id` — scopes the run.
- `audience` — `therapist | parent | school` (validated against `VALID_AUDIENCES`).
- `report_type` — defaults to `progress_summary`.
- `title` (optional) — auto-generated if omitted.
- `period_start`, `period_end` (optional ISO timestamps) — define the reporting window.
- `included_session_ids` (optional) — explicit selection; if omitted, the resolver auto-picks up to 6 most recent sessions.
- `summary_text` (optional) — therapist-supplied override; otherwise the deterministic builder produces it.
- `redaction_overrides` (optional) — per-export visibility flags.
- `source` — `pipeline | ai_insight | manual` (defaults to `pipeline`).

**b. Server-loaded context** (`ReportCompilationPipeline.build_report_artifacts`):
- `child` row — required, otherwise `ValueError`.
- All saved sessions for the child, filtered by `SessionSelectionResolver` against explicit IDs and/or the `[period_start, period_end]` window.
- `child_memory_summary` (compiled summary text + source item count) — read-only.
- `practice_plans` for the child — picks the latest **approved** plan; falls back to the most recent plan otherwise.
- Up to 3 recent `recommendation_logs` plus the top candidate of the most recent log.
- Per-session metrics: `overall_score`, `accuracy_score`, `pronunciation_score`, `exercise_metadata.targetSound`, `exercise.name`, `timestamp`.

**c. AI rewrite inputs** (only on `POST /api/.../suggest-summary-rewrite`, draft only):
- The current `summary_text`, audience, child name, snapshot fields, and up to 6 truncated session entries — passed to `AzureOpenAIReportSummaryAssistant.rewrite_summary`.

If no sessions exist, no sessions match the window, or the audience is invalid → `ValueError` → HTTP 400.

---

## 2. Outputs

**a. The persisted `progress_report` row** (`storage.save_progress_report`):
- `id` = `report-<uuid12>`, `child_id`, `workspace_id`, `created_by_user_id`
- `audience`, `report_type`, `title`, `status` (`draft` → `approved` → `signed` → `archived`), `source`
- `period_start`, `period_end`, `included_session_ids`
- `snapshot` — frozen evidence (see Memory section)
- `sections` — list of `{ key, title, narrative?, metrics?, bullets? }` shaped for the audience
- `summary_text` — narrative paragraph
- `redaction_overrides` — per-report visibility flags

**b. Suggestion endpoint output** — does **not** persist; returns:
```
{ report_id, source_summary_text, suggested_summary_text, review_required: true, draft_only: true }
```
The rewritten paragraph is shown to the therapist for explicit accept/reject before any update.

**c. Export artefacts** (`render_report_html`, `render_report_pdf`):
- HTML or PDF document built from a `ReportExportContext` that has been passed through `ReportRedactionPolicy.apply` to honour visibility flags. Returned via the `/export` route with appropriate content type.

**d. Audit / telemetry events:** `progress_report_created` telemetry; `report.create`, `report.read`, `report.list`, `report.export` audit events. Approve/sign/archive transitions update `status`, `approved_at`, `signed_by_user_id`, `archived_at`.

---

## 3. Algorithm

`ProgressReportService` orchestrates; the pipeline is **a deterministic compile, with an optional human-reviewed AI rewrite layered on top**. No LLM is invoked unless the therapist explicitly requests a summary rewrite.

**Step 1 — Resolve sessions** (`SessionSelectionResolver.resolve_included_sessions`):
- Validate `period_start <= period_end`.
- If explicit `included_session_ids` provided: filter to that set; if none match → empty list (caller raises).
- Else apply window filter; if still empty and no explicit selection → fall back to the 6 most recent sessions.
- This is intentionally fail-open for the no-window case but fail-closed for explicit selections / windows.

**Step 2 — Build summary text** (`ReportSummaryBuilder.build_summary_text`):
- Audience-specific templates. Examples:
  - **Parent:** *"Ada completed 4 reviewed sessions focused on /s/, /th/, with an average session score of 72.5."*
  - **School:** *"This report summarizes 4 therapy review sessions connected to /s/, /th/, with an average reviewed session score of 72.5."*
  - **Therapist:** *"Ada has 4 reviewed sessions in this reporting window, focused on /s/, /th/, with an average overall score of 72.5."*
- Pure string templating from `mean()` and `collect_target_sounds()` — no model.

**Step 3 — Build snapshot** (`SnapshotBuilder.build_snapshot`):
Reads child memory summary, practice plans, and recent recommendation logs; computes:
- `session_count`, `latest_session_at`
- `average_overall_score`, `average_accuracy_score`, `average_pronunciation_score` (rounded to 1 dp)
- `focus_targets` (≤ 4)
- `memory_summary_text`, `memory_source_item_count`
- `plan_title`, `plan_status`, `plan_objective` from latest approved plan (or fallback)
- `top_recommendation_name`, `top_recommendation_rationale` from the most recent recommendation log's top candidate
- `generated_at` (UTC ISO)

**Step 4 — Build sections** (`SectionBuilder.build_sections`):
- All audiences get `Overview` (with metric tiles) + `Session highlights` (≤ 4 bullets via `format_session_bullet`).
- **Therapist:** `Clinical focus` + `Next steps` — references `target_copy`, `summary_text`, `plan_objective`, recommendation rationale.
- **Parent:** `What is going well` + `How to support at home` — softened tone, links to plan objective and recommendation.
- **School:** `School participation impact` + `Suggested classroom supports` — tied to classroom communication.

**Step 5 — Persist as draft.** Title generated as `"<Child> <Audience> Progress Report · <date>"` if not supplied. Status starts at `draft`.

**Step 6 — Update** (`update_report`, draft-only):
- Detects whether audience/window/session selection changed (`context_changed`). If so, recompiles snapshot/sections via the pipeline.
- Important behaviour: if the prior `title` matches the previously *generated* title, the new generated title replaces it; same for `summary_text`. Manually edited titles/summaries are preserved.

**Step 7 — Suggest rewrite** (`suggest_summary_rewrite`, draft-only):
- Calls `AzureOpenAIReportSummaryAssistant.rewrite_summary` with `temperature=0.2`, `response_format=json_schema` (strict, single property `rewritten_summary`), system message: *"You rewrite therapist-authored progress report summaries for human review. Keep the rewrite grounded only in the provided source summary and structured evidence. Do not add diagnoses, promises, new metrics, or unsupported claims. Return one concise paragraph in the requested audience tone."*
- Returns the suggestion with `review_required: true`. The therapist decides whether to call `update_report` with the suggested text.

**Step 8 — Lifecycle transitions:**
- `approve_report`: `draft → approved`, only if currently draft.
- `sign_report(signed_by_user_id)`: `approved → signed`, captures the signer.
- `archive_report`: `approved | signed → archived`.
- All transitions are guarded with explicit status checks.

**Step 9 — Export** (`render_report_html` / `render_report_pdf`):
- `ReportExportContextBuilder` re-resolves the included sessions and applies `ReportRedactionPolicy.apply` using the report's `redaction_overrides` and audience defaults to remove sections/metrics/summary as configured. Then the HTML or PDF exporter renders.

---

## 4. Memory

The service consumes memory but never writes durable memory:

**a. Child memory summary** — read-only via `storage.get_child_memory_summary(child_id)`. Only the compiled `summary_text` and `source_item_count` are exposed; raw items are not embedded into the report.

**b. Practice plan** — latest approved plan's `title`, `status`, and `draft.objective` are surfaced in snapshot and `Next steps`/`How to support at home`.

**c. Recommendation log** — most recent log's top candidate's `exercise_name` and `rationale`.

**d. Session memory** — last 6 sessions (or filtered window) provide the per-session bullets and the metric averages.

**e. Snapshot as frozen evidence** — `snapshot` is persisted alongside the report, so even when memory/plans/recommendations change later, the report remains explainable from the version it was generated against.

There is **no LLM session memory** anywhere. The summary rewrite is stateless — each call is a one-shot `chat.completions.create` with strict JSON schema; no conversation persists.

---

## 5. Protection (security & safety)

**AuthZ at the route level** — therapist/admin role + child-relationship gate via `_require_child_access(child_id, allowed_roles={ROLE_THERAPIST, ROLE_ADMIN}, allowed_relationships=["therapist"])` on create/update/approve/sign/archive/export. Read endpoints re-check child access after fetching the report so a stolen `report_id` is not enough.

**State-machine protection** — every transition method (`update_report`, `approve_report`, `sign_report`, `archive_report`, `suggest_summary_rewrite`) checks the current `status` and rejects illegal transitions with `ValueError`. You cannot edit an approved report; you cannot rewrite a signed summary; archived is terminal.

**LLM safety contract** — the rewrite assistant is **opt-in** (`report_summary_rewrite_enabled` setting, plus a configured Azure OpenAI client via `build_openai_client`, plus a `report_summary_rewrite_model` deployment). When disabled or unconfigured, `rewrite_summary_text` raises `RuntimeError("AI summary rewrite is not configured")` and the endpoint surfaces 503-style errors.
- `temperature=0.2` keeps output close to the source.
- Strict JSON schema with `additionalProperties: false` prevents the model from emitting extra fields.
- System message forbids diagnoses, promises, new metrics, or unsupported claims.
- Output is grounded only on the source summary and structured snapshot — raw transcripts and child memory items are **not** in the prompt.
- Empty rewrites raise; the original summary is preserved.
- **Crucially the rewrite is a suggestion, not an action**: nothing is persisted from the rewrite endpoint; the therapist must explicitly call `update_report` with the suggested text.

**Audience-aware redaction** (`ReportRedactionPolicy`) — booleans for `hide_summary_text`, `hide_overview_metrics`, `hide_session_list`, `hide_internal_metadata`, plus `hidden_section_keys` array. Applied at export time so the same draft can be released to parent/school with different visibility while the therapist still sees everything.

**Input validation** — `normalize_audience`, `normalize_status`, `normalize_session_ids` all coerce/validate; period crossover check raises early; explicit empty selection raises rather than silently widening.

**No raw transcript leakage to AI** — the rewrite prompt only includes per-session `timestamp`, `exercise_name`, and three numeric scores. Transcripts and audio never reach Azure OpenAI through this service.

**Determinism as defence** — same inputs produce the same draft. The non-AI path is fully reproducible from the snapshot; the AI path is bounded and reviewer-gated.

---

## 6. Auditability

**Persisted report record** is the primary artefact — full `snapshot`, `sections`, `summary_text`, `included_session_ids`, `period_start`/`end`, `audience`, `source`, `redaction_overrides`, plus lifecycle stamps `created_at`, `approved_at`, `signed_at`, `signed_by_user_id`, `archived_at`. A reviewer can see exactly what evidence the report was built from and who acted on it.

**`source` field** distinguishes `pipeline | ai_insight | manual`, recording how the report originated.

**Audit events** via `_log_audit_event`:
- `report.create` (with `audience`, `report_id`, `child_id`)
- `report.list` (with count)
- `report.read`
- `report.export` (with format)
- Approve/sign/archive transitions update the row and are recoverable from status timestamps.

**Telemetry events** via `telemetry_service.track_event`:
- `progress_report_created` → Application Insights with `child_id`, `report_id`, `audience`, `source`.

**AI suggestion is auditable by exclusion** — because `suggest_summary_rewrite` does not persist, a rewritten summary only appears in the audit trail if the therapist subsequently calls `update_report`, which is itself a logged action. The original `source` does not silently flip to `ai_insight`; the therapist's action is the audit anchor.

**Snapshot reproducibility** — every report carries its own `snapshot` plus the list of `included_session_ids`, so even months later you can:
1. Re-run `SectionBuilder.build_sections` against the persisted snapshot to confirm the deterministic sections.
2. Compare against the saved `sections` to detect any tampering.
3. Recompute the deterministic `build_summary_text` from the cached sessions to verify the original (pre-rewrite) summary.

**Human-visible audit surface** — the dashboard renders signed/approved/archived state, signer identity, version history, and (where the rewrite was applied) the diff between source and rewritten summary, so therapists and reviewers can see the human-AI handoff trail directly. This pairs with the planner (LLM-grounded drafts) and recommendation service (deterministic ranking) to give Wulo a three-tier audit story: deterministic evidence → therapist-authored narrative → optional AI rewrite, each with explicit provenance.
