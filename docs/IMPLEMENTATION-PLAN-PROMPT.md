# Implementation Planning Prompt — Pathfinder Learn Phase 1

> Hand this prompt to a planning agent. Output should be `docs/IMPLEMENTATION-PLAN.md` with phased tasks, file-level changes, contracts, tests, and acceptance gates. **Do not write code in this step — produce the plan only.**

---

## Role

You are a senior staff engineer planning Phase 1 of Pathfinder Learn. The Phase 0 codebase is documented in [docs/ARCHITECTURE.md](ARCHITECTURE.md) — read it before planning. The repository sits at `voicelive-api-salescoach-pathfinder-phase-0/`. The host platform (Wulo / CareOS) provides: Flask app, multi-tenant Postgres with RLS, Alembic, Pydantic-v2 contracts, `LearningRepository` Protocol, `MasteryEstimator` Protocol, `DiagnosticItemSelector` Protocol, `XAPIEmitter` Protocol, `OrchestratorAdvisor` pattern, and an `InMemoryLearningRepository` pilot stub.

## Hard constraints

1. **Do not plan labour-market data ingestion (O*NET / ESCO / NBS / WB STEP).** That is deferred to Phase 2. The career planner continues to consume fixture `LabourMarketDataset` JSON.
2. Every new output type must extend `LanguageAndProvenanceModel` and carry a `Provenance` chain.
3. Every new engine must be injected behind an existing Protocol (or a new Protocol you justify). No direct instantiation in `api.py`.
4. HITL invariants must hold: `InterventionPlan.requires_approval = True`, `CareerPlan.requires_counsellor_signoff = True`. New surfaces that show student-level data to teachers must include an audit event (`OverrideEvent` or new typed event).
5. Tenant isolation: every new route must enforce tenant scope via the existing RLS session-GUC pattern (`SET app.tenant_id = ...`). Plan the test that proves cross-tenant leakage is blocked.
6. Offline-first: every new engine declares `offline_fallback_available: bool` and every `PlannerResult` populates `offline_fallback` when `queued=True`.
7. No code changes in this step. The plan is the deliverable.

## Plan scope — three workstreams

Plan each workstream independently, then plan their integration. Order them by dependency (smallest blocking set first).

---

### Workstream A — Phase 1 verdicts (excluding labour-market data)

Plan implementations for the P1 pending items from [docs/ARCHITECTURE.md §14](ARCHITECTURE.md#14-pending-implementations), specifically:

A1. **Postgres-backed `LearningRepository`**
- SQLAlchemy implementation backed by tables introduced in migration `20260523_000024_learning_foundations.py`.
- Replace `InMemoryLearningRepository` in `api.py` via a `make_repository()` factory keyed on `DATABASE_BACKEND` env var (sqlite | postgres).
- Tenant-scoped queries with `SET app.tenant_id` per request.
- Test plan: per-method parity tests against `InMemoryLearningRepository`; an RLS leakage test that proves tenant-B cannot read tenant-A `mastery_estimates`.

A2. **catsim `DiagnosticItemSelector` adapter**
- New module `backend/src/learning/cat.py`.
- Class `CatsimItemSelector` implementing `DiagnosticItemSelector` Protocol.
- Map `MasteryEstimate.probability` → IRT ability `theta` via logit transform; map `DiagnosticItem.difficulty` (logit scale already) directly to item parameter `b`.
- Use `catsim.selection.MaxInfoSelector` for adaptive next-item; fall back to `DeterministicItemSelector` when `offline=True` or `len(item_bank.items) < threshold`.
- `offline_fallback_available = True` (deterministic fallback exists).
- Test plan: deterministic fixture verifying selected sequence matches expected order for a known prior-mastery profile; offline-fallback parity test.

A3. **ralph `XAPIEmitter` adapter**
- New module `backend/src/learning/lrs.py`.
- Class `RalphXAPIEmitter` implementing `XAPIEmitter` Protocol, HTTP POST to ralph LRS over `LRS_BASE_URL` + Basic auth from Key Vault.
- Class `BufferedXAPIEmitter` wrapper: flushes to ralph if reachable, else enqueues `OfflineQueuedEvent{event_type="xapi_statement", idempotency_key=statement.id}` for replay.
- Wire into `api.py` so `DiagnosticRunResult.xapi_statements` are emitted, not just returned in JSON.
- Test plan: mock LRS via `responses` library; verify retry-then-queue behaviour when LRS returns 503.

A4. **Kolibri LTI / REST adapter**
- New module `backend/src/learning/kolibri.py`.
- Given an approved `InterventionPlan` with `suggested_resources: List[str]` (Kolibri content node IDs), return `LaunchTicket` (new model, `LanguageAndProvenanceModel`): `node_id`, `launch_url`, `expires_at`, `student_id`, `signed_token`.
- LTI 1.3 deep-linking preferred; REST fallback for self-hosted Kolibri without LTI configured.
- New route: `POST /api/learning/intervention/launch` — input `{plan_id, student_id}`, output `LaunchTicket`. Approval gate: only callable after `ApprovalEvent.action == "approved"` for the plan.
- Test plan: approval-required test (reject if no `ApprovalEvent`); ticket expiry test; signed-token verification.

A5. **Approval queue UI wiring**
- Frontend: new `ApprovalQueue` view consuming `GET /api/learning/intervention/pending?teacher_id=…`.
- New backend route `GET /api/learning/intervention/pending` — returns list of `InterventionPlan` rows where `requires_approval=True` AND no terminal `ApprovalEvent` exists.
- Each row shows: target skills, target students (display names only), rationale, originating diagnostic.
- Actions: Approve, Edit-and-approve (opens diff editor pre-populated with plan JSON), Reject (requires reason).
- Each action emits `ApprovalEvent` → xAPI statement.
- Test plan: edit-and-approve diff retention test (the edited plan version must be stored, not just the original); reject-without-reason rejection test.

A6. **HITL types: `OverrideEvent` xAPI mapping**
- `OverrideEvent` exists in `xapi.py` but has no xAPI mapping function. Plan `override_event_to_xapi()` (verb: `http://activitystrea.ms/schema/1.0/override` or equivalent), and wire it into the teacher drill-down (Workstream C) for any manual mastery override.

For each of A1–A6 produce:
- Files added / modified (exact paths)
- Public contracts (Pydantic models, Protocol methods, route signatures)
- Migration plan (none expected for A2–A6; A1 uses existing migration `000024`)
- Test list (unit + integration + a one-line RLS / tenant-isolation test where applicable)
- Acceptance gate (what command proves it works)

---

### Workstream B — Skills library

Goal: replace ad-hoc `Skill` references (currently embedded inside item bank JSONs) with a tenant-aware, searchable, pickable catalogue. Both teachers (when assigning interventions or building diagnostics) and students (when self-selecting practice topics, where consent allows) must be able to browse and pick skills.

Plan must cover:

B1. **Data model**
- New table `skills_catalogue` (migration `000025_skills_catalogue.py`).
- Columns: `skill_id` (PK), `tenant_id` (nullable — null = global / shared library), `standard_id`, `name`, `description`, `subject`, `year_group_min`, `year_group_max`, `parent_skill_id` (self-FK for hierarchy), `prerequisites: JSONB` (List[skill_id]), `kc_tags: JSONB`, `localisations: JSONB` ({lang: {name, description}}), `status` ("draft" | "published" | "archived"), `created_at`, `updated_at`, `provenance: JSONB`.
- Pydantic model `CatalogueSkill(LanguageAndProvenanceModel)` mirroring the table, plus computed fields `is_global: bool`, `available_languages: List[str]`.
- Pydantic model `SkillSearchResult` for paginated search responses.

B2. **Seed strategy**
- A `scripts/seed_skills.py` that loads from `data/learning/skills/{subject}_{standard}.json` files (e.g. `maths_jss_curriculum.json`, `english_ks3.json`).
- Each seed file declares its `standard_id` (e.g. `ng-jss-maths-2020`, `uk-ks3-maths-2014`) and `Provenance` (source = curriculum document URL, recency, confidence).
- Idempotent: re-running upserts by `(tenant_id NULL, standard_id, skill_id)`.
- Plan one starter seed: JSS2 Maths (already partially in `data/learning/jss2_maths_diagnostic_phase_2.json` — extract skill list from there).

B3. **Repository + service**
- Extend `LearningRepository` Protocol with: `list_skills(filters) -> List[CatalogueSkill]`, `get_skill(skill_id) -> CatalogueSkill | None`, `create_tenant_skill(...)`, `archive_skill(skill_id)`.
- Service module `backend/src/learning/skills.py` for cross-cutting logic: prerequisite-chain resolver, hierarchical tree expansion (`get_skill_tree(root_id)`), search with `subject + year_group + lang + query string`.
- All reads tenant-scoped: returns global rows (tenant_id IS NULL) UNION tenant rows.

B4. **HTTP API**
- `GET /api/learning/skills?subject=&year_group=&lang=&q=&page=&page_size=` → paginated `SkillSearchResult`.
- `GET /api/learning/skills/{skill_id}` → `CatalogueSkill` with expanded prerequisites.
- `GET /api/learning/skills/tree?root=&depth=` → hierarchical tree.
- `POST /api/learning/skills` (teacher/admin only) → create tenant-scoped skill. Returns 403 for student role.
- `PATCH /api/learning/skills/{skill_id}` (teacher/admin only, tenant skills only — global rows immutable per request).
- `POST /api/learning/skills/{skill_id}/archive` (teacher/admin only).

B5. **Wiring**
- `DiagnosticItemBank.skills` becomes a list of `skill_id` references resolved at read time against `skills_catalogue`. Add a migration step that backfills any inline `Skill` objects in existing item banks.
- Frontend `SkillPicker` component (autocomplete + tree-browse + filter chips). Spec the input/output contract and the loading/empty/error states.
- `InterventionPlan.target_skill_ids` must validate that every referenced skill exists in the catalogue (extend `PlanValidator` with `catalogue_skill_existence_rule`).

B6. **Test plan**
- Pagination correctness, language fallback (`yo-NG` → `en-NG` if localisation missing), hierarchy depth limit, RLS test (tenant-A cannot see tenant-B private skills), prerequisite cycle detection (must reject self-FK loops), validator hook test (plan with non-existent skill_id is rejected).

B7. **Acceptance gate**
- A teacher can search "ratio" → pick the JSS2 ratio skill → assign an intervention referencing it → the plan validates and persists.

---

### Workstream C — Teacher → student drill-down

Goal: from the existing `TeacherHeatmap` (class × skill matrix), let a teacher drill into an individual student and see their mastery profile, response history, intervention history, and (if `career_consent=True`) a career-fit preview. Must respect under-16 safeguarding rules and emit audit events.

C1. **Aggregate query layer**
- New service `backend/src/learning/drilldown.py`.
- Function `build_student_profile(tenant_id, teacher_id, student_id, audience="teacher") -> StudentProfile`.
- New Pydantic model `StudentProfile(LanguageAndProvenanceModel)` with:
  - `student: Student` (display name only — never PII beyond that for the teacher surface)
  - `mastery_by_skill: List[MasteryByCatalogueSkill]` — joins `mastery_estimates` × `skills_catalogue` (Workstream B dependency)
  - `recent_responses: List[StudentResponse]` (last N, configurable; default 50)
  - `intervention_history: List[InterventionPlanSummary]` — past plans referencing this student with approval status
  - `pending_interventions: List[InterventionPlanSummary]`
  - `career_preview: CareerNarration | CareerRefusal | None` — populated only when `student.career_consent=True` AND `student.age >= 16` OR counsellor-signoff exists
  - `safeguarding_flags: List[SafeguardingFlag]` (future hook; empty list in Phase 1)
- `MasteryByCatalogueSkill`: `skill: CatalogueSkill`, `estimate: MasteryEstimate`, `evidence_count`, `last_evidence_at`, `status: "secure" | "developing" | "needs_support"` (reuses `heatmap_status` thresholds).

C2. **Audit event**
- New `StudentProfileViewEvent(LanguageAndProvenanceModel)`: `event_id`, `tenant_id`, `teacher_id`, `student_id`, `viewed_at`, `audience`, `reason: str | None`.
- Emitted on every drill-down call. Maps to xAPI verb `viewed`.
- Counts toward GDPR / NDPR Article 15 access log requirements.

C3. **HTTP API**
- `GET /api/learning/teacher/student/{student_id}` (teacher role only).
- Authorisation: teacher must have `student_id` in a class they own (check via `Teacher.class_ids` ∩ `Student.class_id`). Reject 403 otherwise.
- Optional query `?reason=…` — surfaced in audit event.
- Response: `StudentProfile`.

C4. **Manual mastery override**
- `POST /api/learning/teacher/student/{student_id}/skill/{skill_id}/override` — body: `{probability, uncertainty, reason}`.
- Emits `OverrideEvent` → `override_event_to_xapi()` (Workstream A6).
- Updates `mastery_estimates` row with a new event of `kind=estimate.kind` but provenance source = "TeacherOverride".
- Optional: gate behind `requires_approval` if another teacher / head must confirm (configurable per tenant; default off).

C5. **Frontend**
- `HeatmapCell` becomes clickable → opens `StudentDrilldownDrawer` (panel, not full route, so the teacher keeps heatmap context).
- Sections in the drawer:
  1. **Header**: name, year group, last active. **No** photo, address, phone.
  2. **Mastery bars** per skill with `secure/developing/needs_support` colour band and uncertainty whisker.
  3. **Recent responses**: scrollable list of last 50 items with skill tag, item prompt, correct/incorrect, timestamp.
  4. **Intervention history**: list of past plans with approval status badge.
  5. **Pending interventions**: actionable list with quick approve / reject.
  6. **Career preview** (conditional, see C1): renders `CareerNarration.text` with provenance footer OR `CareerRefusal.typed_refusal` banner. Never both.
  7. **Override action**: small "Adjust mastery estimate" button → opens `OverrideForm` requiring reason.
- Empty / loading / error / unauthorised states specified per section.

C6. **Privacy and safeguarding rules to encode**
- Under-16 students: `career_preview = None` unless counsellor-signoff exists for that plan version.
- A teacher viewing a student outside their assigned class → 403 + log `StudentProfileViewEvent` with `audience="denied"` for audit (yes, log denials too).
- Mastery override on a student outside teacher's class → 403.
- Display strings should be locale-aware (`student.lang` fallback chain).

C7. **Test plan**
- Authorisation matrix test (own-class vs other-class teacher).
- Under-16 career preview suppression test.
- Audit event emission test (every view → exactly one event).
- Override → mastery update → mastery event chain test (provenance must contain `source="TeacherOverride"` plus the prior provenance chain).
- Frontend visual regression for each drawer section state.

C8. **Acceptance gate**
- From the JSS2 class heatmap, clicking the "needs_support / ratio" cell for pilot-jss2-student-001 opens a drawer showing: 4 mastery bars, 12 recent responses, 1 pending intervention, no career preview (consent=False in pilot), and the override button. Closing the drawer + reopening does NOT double-count `StudentProfileViewEvent` (use a debounced single emission per drawer-open).

---

## Cross-workstream integration

Plan a single integration section covering:

I1. **Dependency order**: Workstream A1 (Postgres repository) is a prerequisite for B and C. Workstream B (skills library) is a prerequisite for C (drill-down joins to `skills_catalogue`). A2–A6 are independent of B and C.

I2. **Shared migrations**: confirm migration numbering (`000025` for skills, `000026` for any new audit tables) and rollback strategy.

I3. **Shared frontend**: `SkillPicker` (Workstream B) is reused inside the override form (C4) and inside the edit-approval diff editor (A5).

I4. **Shared events stream**: `ApprovalEvent`, `OverrideEvent`, `StudentProfileViewEvent`, `DiagnosticCompletionEvent` all flow through the same `BufferedXAPIEmitter` (A3). Spec a single emission helper to avoid duplication.

I5. **Feature flags**: every new route gated behind an env flag (`PATHFINDER_PHASE1_SKILLS_API`, `PATHFINDER_PHASE1_DRILLDOWN`, `PATHFINDER_PHASE1_KOLIBRI`) so partial rollout is possible. Default off in production until acceptance gates pass.

I6. **Eval / observability**:
- Counter metrics: `pathfinder_intervention_approvals_total{action}`, `pathfinder_mastery_overrides_total`, `pathfinder_student_profile_views_total{audience}`, `pathfinder_lrs_emit_failures_total`.
- Trace span per drill-down call with `student_id` hashed (not raw).
- A `GET /api/learning/ops/kpi` extension that adds the new counters.

---

## Out of scope (defer to Phase 2)

- Labour-market data ingestion (O*NET / ESCO / NBS / WB STEP).
- EduCDM / pyKT mastery upgrade.
- Voice intent detection.
- DPO / parent self-service consent UI.
- Multi-region active-active.
- LLM-as-judge eval pipeline.

State these explicitly in the plan so reviewers don't expect them.

---

## Deliverable format

Produce `docs/IMPLEMENTATION-PLAN.md` with this structure:

1. Summary table (workstream × task × dependency × estimated days × risk).
2. One section per workstream (A, B, C) with subsections per task (A1, A2, …) using the bullets above.
3. Integration section (I1–I6).
4. Risks and mitigations (LRS unavailable, Kolibri LTI mis-config, RLS regression, under-16 consent edge cases).
5. Acceptance gate checklist (one line per gate referenced above).
6. Open questions for the founding team (max 6).

Do not include code. Do not include effort estimates beyond rough day-counts. Do not invent OSS libraries that are not already in the architecture doc.
