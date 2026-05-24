# PRD — Pathfinder Learn

**Personalized Student Progress Identifier + Career Navigator for emerging markets, refactored from the Wulo SEN codebase**

| Field | Value |
|---|---|
| Document owner | Ayoola Fakoya |
| Status | Draft v0.1 — for stakeholder review |
| Last updated | 2026-05-23 |
| Source repo | [voicelive-api-salescoach/](../) (fork of Wulo SEN) |
| Target pilot start | 2026-08 (Nigeria, JSS2, 3 schools) |
| Target pilot end | 2026-11 (12 weeks, ~600 students) |

---

## 1. Summary

Refactor the existing Wulo speech-therapy platform into **Pathfinder Learn** — an adaptive diagnostic + intervention + career-navigation tool for secondary schools in emerging markets. The refactor reuses the production-grade multi-tenant, HITL, audit and LLM-orchestration spine from Wulo and the CareOS engagement, and swaps the speech-therapy domain model for an education domain model.

The product evaluates student responses, estimates per-skill mastery with explicit uncertainty, surfaces learning gaps to teachers with full provenance, and — for Year 9+ — recommends career pathways grounded in local labour-market data. Every AI suggestion is **teacher-approved, provenance-stamped, offline-capable, and emitted as xAPI**.

---

## 2. Goals and non-goals

### 2.1 Goals (MVP, 12-week pilot)

- **G1.** Replace `Child / Therapist / Phoneme / Exercise` ontology with `Student / Teacher / Skill / DiagnosticItem` ontology behind a new `learning/` bounded context, without removing the existing `therapy/` context (Wulo pilots keep paying).
- **G2.** Run a JSS2 maths diagnostic (50 items × 4 skills, NERDC-aligned) end-to-end: student response → mastery update → teacher heatmap → AI intervention suggestion → HITL approval → xAPI emission → audit ledger.
- **G3.** Work fully offline on a £80 Android tablet over 2G for the student diagnostic, mastery estimator, intent classifier, policy gate, and last 50 teacher suggestions.
- **G4.** Support English + one launch local language (Yoruba) at MVP, with the architecture proving the multilingual path (planner I/O carries `lang: BCP47`, native-rater eval set ≥ 200 cases per language).
- **G5.** Add a Career Navigator for JSS3+ that ranks pathways using O*NET → ESCO crosswalk + NBS Q4 2025 wage data, gated by the Orchestrator + Advisor safety pattern.
- **G6.** Hit the stakeholder pilot floors (Section 6).

### 2.2 Non-goals (MVP)

- No deep knowledge tracing (DKT/SAKT). Beta-BKT only.
- No phoneme-level pronunciation scoring (remains in `therapy/`, optional add-on for oral-reading-fluency only).
- No multi-country rollout. Nigeria only at MVP.
- No university / scholarship matching engine (career nav stays at pathway shortlist + wage band + demand trend).
- No parent app native build. Mobile web PWA only.
- No automated mutations to student state from AI. Ever.

---

## 3. Personas

| Persona | Primary need | Trust model |
|---|---|---|
| **Student (12–14, JSS2)** | Complete today's path on a shared tablet, in my language, offline | Class code + first name + 4-digit PIN |
| **Student (15+, JSS3–SSS1)** | Same, plus explore career pathways with counsellor sign-off | Same, plus consent state for career features |
| **Teacher (JSS subject teacher)** | See class mastery at a glance, get safe AI suggestions I can approve, edit, or reject | School SSO (Google / Microsoft) |
| **Counsellor (JSS3+)** | Career conversations with provenance, advisor-gated for minors | SSO + step-up |
| **Parent / Guardian** | Read-only progress + recommended home practice in my language over 2G | Phone + OTP |
| **Head teacher / Inspector** | Cohort gap report, signed PDF, xAPI export to district LMS | SSO |
| **DPO (Foundation)** | DPIA evidence, NDPR controls, audit ledger export, data-subject request turnaround | Admin SSO |

---

## 4. Stakeholder brief (Section 7 of the SoW, summarised)

Adaeze Okafor, Director of Product & Learning at Pathfinder Education Foundation (fictional buyer composite). FCDO + Mastercard Foundation co-funded. Has rejected two ChatGPT-wrapper procurements previously. Will renew only if **pilot floors** (Section 6) are met. The full discovery brief is in the conversation thread that produced this PRD.

Her one rule: *"Show me what happens when the AI is wrong, how the teacher finds out, and what it costs to fix."*

---

## 5. User stories

### 5.1 Student

- **S1.** Sign in offline with class code + first name + PIN, start today's path.
- **S2.** Answer diagnostic items in English or Yoruba.
- **S3.** Ask the entry box "what does ratio mean?" by text or mic, get a short grounded explanation. No career advice in this surface; no opinions on my future.
- **S4.** [JSS3+] Explore career pathways with a visible "Why this?" and a "Talk to your counsellor" CTA.

### 5.2 Teacher

- **T1.** Open the app → see the class heatmap (skills × students, mastery + uncertainty) within 5 s, offline-capable.
- **T2.** Review AI intervention suggestions, each with: rule fired, skills targeted, students affected, evidence count, approved-memory used. Approve / Edit / Reject — never auto-applied.
- **T3.** Override mastery with a one-line reason; audited.
- **T4.** On reject, give a one-tap reason → feeds the next eval cycle.
- **T5.** Export a class report as a signed PDF for the head / SUBEB inspector.

### 5.3 Counsellor

- **C1.** Pull mastery profile + pathway shortlist with wage band and demand trend, each datapoint stamped with source and recency.
- **C2.** Any narration for a student under 16 passes through Orchestrator + Advisor; refusal is a first-class state with a reason.

### 5.4 Parent

- **P1.** See child progress and home-practice recommendation on a phone over 2G, in chosen language.
- **P2.** File export / erase request; acknowledged in 1 working day, resolved in 5.

### 5.5 Head / district

- **H1.** School heatmap, cohort gap trend, monthly one-page board summary.
- **H2.** Import classes via OneRoster 1.2; export learning events as xAPI to district LRS.

---

## 6. KPIs and acceptance criteria

### 6.1 Pilot success metrics (12 weeks, 3 schools, ~600 students)

| Metric | Target | Hard floor |
|---|---|---|
| Diagnostic completion rate | ≥ 80% | 60% |
| Teacher-approved intervention rate | ≥ 70% | 50% |
| Suggestions with full provenance shown | 100% | 100% |
| Time-to-first-intervention (diag complete → suggestion in queue) | ≤ 5 min | 15 min |
| Works fully offline (diag + mastery + last-N suggestions) | Yes | Yes |
| Cost per student per term (cloud + LLM) | ≤ £0.40 | £1.00 |
| Career conversation safety (red-team eval) | ≥ 99% safe | 99% |
| Data subject request turnaround | ≤ 5 business days | 30 (NDPR ceiling) |
| Teacher NPS after 4 weeks | ≥ +30 | 0 |

### 6.2 Engineering acceptance gates (per phase, CI-as-spec)

- RLS isolation CI test: cross-tenant query returns empty rows (existing pattern from Wulo).
- xAPI emission CI test: every `MasteryEvent`, `Approval`, `Override` produces a schema-valid statement landed in Ralph.
- Offline CI test: Playwright with network disabled completes one diagnostic + one mastery update + one cached suggestion render.
- Provenance lint: any UI rendering an AI suggestion without a `provenance[]` footer fails the build.
- Eval gate: pre-release red-team probe set must score ≥ 99% on safety; planner must score ≥ 70% on offline labelled eval before canary.

---

## 7. Functional requirements

### 7.1 Unified entry surface — `<MultimodalIntentBar>`

- Single rectangular input on the primary screen for student, teacher, counsellor.
- Three modes: idle / typing / listening. Modality detected by first input event (keyboard → text; mic-tap → voice). No always-on mic.
- On-device intent classifier returns `{intent, confidence, role_scope, requires_grounding, requires_approval}`.
- Below confidence threshold → one clarifying question, not a guess.
- Server-side policy gate (authoritative) checks `(role, intent, tenant_policy, student_consent_state)` against `policy.yaml`.
- Workflow dispatch maps `intent → planner`. Result type drives render mode.

### 7.2 Intent taxonomy (MVP)

`practice.start_session`, `practice.explain_concept`, `practice.hint`, `diagnostic.run`, `diagnostic.review_results`, `mastery.show_gaps` (student | class | cohort), `intervention.suggest`, `intervention.assign` (teacher), `career.explore_pathways`, `career.compare_pathways` (counsellor + student), `report.generate`, `meta.help`, `meta.refuse_handled`.

### 7.3 Result rendering states

| State | Component | Used for |
|---|---|---|
| Streaming prose | `<StreamPanel>` | Explanations, hints, narration |
| Structured card | `<ResultCard>` (JSON-Schema-driven) | Mastery tables, pathway lists |
| Approval-required | `<PendingApprovalCard>` | Anything that mutates student state |
| Refusal | `<RefusalCard>` | Policy gate denied, advisor vetoed, grounding failed |

- `<ResultCard>` and `<PendingApprovalCard>` MUST render a provenance footer from `provenance[]`; lint-enforced.
- Mutating intents cannot render as `<StreamPanel>`.

### 7.4 Diagnostic + mastery

- Adaptive item selection via **catsim** (IRT-based CAT).
- `MasteryEstimate` stored as typed JSONB: `{"kind":"beta","a":7.0,"b":2.0}` per `(student, skill)`.
- `MasteryEstimator` Protocol interface; two implementations: `BetaBKT` (MVP), `Elo` (alternate). Deep-KT is a future swap, not MVP.
- Mastery probability + uncertainty rendered in teacher heatmap (3 mastery bands × 2 uncertainty bands = 6 cell states).

### 7.5 LearningPlanner + intervention HITL

- Reuses the **Pydantic-validated JSON + per-turn-budget + fail-closed validator** pattern from [src/services/insights_service.py](../backend/src/services/insights_service.py) and [src/services/insights_copilot_planner.py](../backend/src/services/insights_copilot_planner.py).
- Planner emits a structured `InterventionPlan`: target skills, target students, item types, suggested resources, rationale, provenance.
- Generic `PlanValidator[TPlan]` parametrised by (schema, catalogue-grounding rules, safety rules) — lifted out of the speech planner.
- All suggestions land in the `approvals` queue (existing). State machine: `draft → pending → (approved | edited+approved | rejected)`.

### 7.6 CareerPlanner + Orchestrator + Advisor

- Second planner sharing the egress gateway and audit ledger.
- Two-agent: Orchestrator drafts, Advisor checks grounding, age-appropriateness, safety, PII.
- Refusal is typed and surfaced as `<RefusalCard>` with the policy rule id.
- Data: O*NET → ESCO crosswalk, NBS Q4 2025 wage bands, NBS / NDE demand trend. Each datapoint declares `{source, recency, confidence}`.

### 7.7 Approved memory

- Teacher-approved durable memory (port of therapist-approved pattern): proposed facts must be Approved / Edited / Rejected by a teacher; runtime personalisation limited to a small auditable set.
- No student data enters model memory or cache without explicit teacher approval.

### 7.8 Multilingual

- All planner I/O carries `lang: BCP47`.
- ASR/TTS router: backends include Meta MMS / SeamlessM4T, Piper / XTTS for on-device TTS, Azure Speech for high-resource languages. Existing FastAPI WebSocket proxy used as the transport.
- PLS-lexicon + TTS-cache pattern from Wulo retained as the localisation primitive; lexicons become per-language assets with versioning.
- Per-language eval slices, ≥ 3 native-speaker raters, κ ≥ 0.7 inter-rater.

### 7.9 Roles, identity, and tenancy

- Tenant hierarchy: `School (or District) → Class → Student`. Cross-cutting roles: `Teacher`, `Counsellor`, `Parent`, `Head`, `DistrictAdmin`, `DPO`.
- RLS GUCs: `app.tenant_id`, `app.class_id`, `app.user_id`, `app.role`.
- Teacher / counsellor / head: school SSO (Google / Microsoft) via Entra federation, or self-hosted Keycloak for ministry tenants.
- Student: class code + first name + 4-digit PIN.
- Parent: phone + OTP.

### 7.10 Interoperability

- **xAPI**: every `MasteryEvent`, `Approval`, `Override`, `DiagnosticCompletion` emitted as an xAPI statement; LRS is **Ralph**.
- **OneRoster 1.2** adapter for class / enrolment import.
- **CASE** loader for curriculum frameworks (MVP: NERDC JSS2 Maths).
- **OpenAPI** spec on every internal service; CI diff gate.
- **MCP** tool surface for the agent path (RBAC, RLS, validation, audit all enforced server-side).

### 7.11 Offline-first

- PWA with Service Worker + IndexedDB.
- Content packs (Kolibri-pattern): signed, versioned bundles of items, lexicons, on-device models, policy snapshot.
- Last-write-wins is forbidden for mutating events; offline writes are queued, idempotency-keyed, replayed on reconnect with conflict resolution at the service.
- Planners that require cloud degrade gracefully: "queued — will run when online".

### 7.12 Audit and export

- Append-only audit ledger (Postgres triggers + `REVOKE UPDATE, DELETE`), 7-year retention.
- Inspector-grade signed ZIP export (HMAC-SHA256, deterministic, manifest + ledger slice).
- Data-subject export / erase tooling (port of Wulo GDPR controls; NDPR + Kenya DPA + UK GDPR wording).

---

## 8. Non-functional requirements

| Category | Requirement |
|---|---|
| **Performance** | Entry-bar intent classification ≤ 200 ms on low-end Android. First streamed token ≤ 1.5 s p95. Heatmap render ≤ 1 s. |
| **Cost** | ≤ £0.40 per student per term cloud + LLM at 600-student pilot scale. On-device floor: usable when budget exhausted. |
| **Availability** | 99.5% backend during school hours (08:00–16:00 WAT). Offline-degraded otherwise on the device. |
| **Accessibility** | WCAG 2.2 AA, dyslexia-friendly font option, large-text mode, audio readback for items. |
| **Security** | Managed identity to Azure, secrets in Key Vault, no LLM provider holds student PII (egress gateway redacts + rehydrates). Per-tenant opt-out from provider training data, enforced in contract and code. |
| **Privacy** | NDPR + Kenya DPA + UK GDPR. School-as-controller and parent-as-controller flows both supported. DPIA signed off before pilot start. |
| **Eval** | Labelled offline eval set ≥ 500 cases per language by week 6. LLM-as-judge calibrated against ≥ 3 native-speaker raters, κ ≥ 0.7. Shadow → 5% canary → ramp; auto-rollback on guardrail breach. |
| **Observability** | OTel correlation across web → API → planner → egress gateway, shared `correlation_id`. Per-tenant cost spans. |
| **Open-source posture** | Curriculum loaders, xAPI emitter, mastery estimator interface, lexicons published under permissive licence. Core platform stays closed. |

---

## 9. Architecture — refactor against the existing repo

### 9.1 Retain (already production-grade)

- Multi-tenant Postgres + RLS, append-only audit ledger, approvals queue.
- The Pydantic-validated JSON + per-turn-budget + fail-closed validator pattern at [src/services/insights_service.py](../backend/src/services/insights_service.py), [src/services/insights_copilot_planner.py](../backend/src/services/insights_copilot_planner.py).
- The deterministic recommendation ranker scaffolding (re-aim).
- The therapist-approved durable memory pattern (re-aim as teacher-approved).
- LLM egress gateway pattern (port from CareOS engagement).
- FastAPI WebSocket proxy for voice (provider-pluggable).

### 9.2 Replace with OSS

| Concern | OSS choice |
|---|---|
| Mastery estimator | **pyBKT** (Beta-BKT) behind `MasteryEstimator` interface |
| Adaptive item selection | **catsim** |
| Learning record store | **Ralph LRS** (xAPI) — mandatory day 1 |
| Roster sync | **OneRoster 1.2** library |
| Curriculum framework loader | **CASE** spec ingest |
| Offline / content packs | **Kolibri**-style content-pack format |
| Career taxonomy | **O*NET → ESCO crosswalk + World Bank STEP + NBS / KNBS** |
| ASR / TTS for African + South-Asian languages | **MMS / SeamlessM4T / Piper / XTTS** |
| On-device LLM hot path | **Gemma 3 / Phi-4-mini / Qwen3-small**, quantised, ONNX, in-browser |

### 9.3 Build net-new (this is the IP)

- `learning/` bounded context: `Student / Class / Cohort / Skill / Standard / DiagnosticItem / Response / MasteryEvent` (alongside existing `therapy/`).
- Parametrised `PlanValidator[TPlan]` lifted from the speech planner.
- `LearningPlanner` + `CareerPlanner` behind the existing stateless adapter contract.
- Orchestrator + Advisor pattern (from FE college engagement) applied to career narration.
- `<MultimodalIntentBar>` + 4 result states + on-device intent classifier + server-side policy gate.
- xAPI emission contract for every `MasteryEvent`, `Approval`, `Override`, `DiagnosticCompletion`.
- Labour-market signal loader for NG / KE / GH with provenance and recency.
- Per-language eval slices + native-speaker rater workflow.

### 9.4 The contract that survives every model swap

> Every cloud call has an offline-capable fallback. Every model output declares its language and provenance. Every persisted event is expressible as an xAPI statement.

Enforced as three CI lints.

---

## 10. Phased delivery (CI-as-spec, trace-evidence per phase)

### Phase 0 — Discovery (2 weeks)
- 2 schools, 1 day each, JSS2 Maths + English walk-through.
- DPIA outline. NDPR data-flow map. NERDC licensing conversation.
- Architecture contract (1 page per bounded context).
- **Exit gate:** signed scope, DPIA approved by Foundation DPO.

### Phase 1 — Foundations (3 weeks)
- Fork `learning/` context from Wulo; port RLS, audit, approvals.
- `MasteryEstimator (BetaBKT)` + `PlanValidator[TPlan]` extracted.
- Ralph LRS deployed; xAPI emitted from a stub diagnostic.
- Offline-first PWA skeleton + content-pack sync.
- **Exit gate:** runnable trace-evidence script the Foundation can execute themselves.

### Phase 2 — Diagnostic + teacher view (3 weeks)
- JSS2 Maths item bank (50 × 4 skills, NERDC-aligned).
- catsim adaptive selection; mastery updates; teacher class heatmap.
- `LearningPlanner` + intervention suggestions, HITL queue, provenance footer.
- On-device intent classifier + entry bar (text path); voice path stubbed.
- **Exit gate:** 1 school dry-run, 1 class, 1 week.

### Phase 3 — Multilingual + Career nav (3 weeks)
- Yoruba language pack (planner I/O + advisor + native-rater eval set ≥ 200).
- Voice path live via MMS / Seamless on the existing FastAPI WebSocket proxy.
- `CareerPlanner` (JSS3+) with O*NET–ESCO + NBS data, Orchestrator + Advisor.
- Counsellor view + parent view.
- **Exit gate:** 3 schools, 600 students, 12 weeks elapsed; KPIs measured.

### Phase 4 — Pilot operations (separately funded)
- Weekly red-team probes, monthly board pack, quarterly DPIA review.
- Eval rolls; canary release for any planner / prompt / model change.

---

## 11. Risk register (5-tier, per-workflow kill switch)

| Tier | Risk | Mitigation | Kill switch |
|---|---|---|---|
| **Safeguarding** | Career narration gives harmful or off-policy advice to a minor | Advisor gate; refusal-first UX; native-rater eval ≥ 99% safe | Disable CareerPlanner per-tenant via policy flag |
| **Accuracy** | Mastery estimator mis-flags a high-performing student | BKT uncertainty surfaced in UI; teacher override audited; eval gate before release | Roll back to previous prompt version; mastery reset path |
| **Compliance** | Student PII leaks to LLM provider training | Egress gateway redacts + rehydrates; per-tenant opt-out in contract; DPIA evidence | Block LLM egress for tenant; route all to on-device fallback |
| **Operational** | Tablet offline for 3+ days; sync conflicts | Idempotency keys + conflict resolution at service; queued writes with TTL; sync UI | Force re-sync; manual conflict review in approvals queue |
| **Reputational** | Inspector cites unsupported AI suggestion in report | Provenance footer non-optional; signed export bundle; rejection feeds eval | Disable AI suggestions for tenant; deterministic ranker only |

---

## 12. Open questions for the next stakeholder meeting (2026-06-06)

1. **Curriculum licensing** — NERDC partnership or openly-licensed item bank for JSS2 Maths? Locks Phase 2 scope.
2. **Identity for student devices** — class-code + PIN sufficient for NDPR, or do we need parental consent before first sign-in? DPO call.
3. **Career data recency** — NBS Q4 2025 is the latest. Acceptable through end of 2026, or do we need a refresh plan?
4. **Tenancy at district scale** — does the Foundation pay per tenant (per school) or per district MoE umbrella tenant? Affects RLS GUC strategy and pricing.
5. **Voice in MVP** — keep voice live in Phase 3 (Yoruba) or push to Phase 4? Native-rater capacity is the constraint.
6. **What the demo on 2026-06-06 must show:** the "what happens when the AI is wrong" path, end-to-end, on a real tablet.

---

## 13. Appendix — file-level refactor map

| Existing file | Action |
|---|---|
| [src/services/insights_service.py](../backend/src/services/insights_service.py) | **Retain.** Generalise `InsightsTool` registry to accept domain-bound scope (was `child_id`, becomes `student_id` \| `class_id`). Keep budgets, fail-closed, audit. |
| [src/services/insights_copilot_planner.py](../backend/src/services/insights_copilot_planner.py) | **Retain.** Move JSON-shape contract into a parametrised `PlanResult[TSchema]`. |
| `src/services/storage.py` | **Extend.** Add `learning/` tables + RLS policies. Do not modify existing `therapy/` tables. |
| `src/schemas/` | **Extend.** New schemas: `LearningPlan`, `InterventionPlan`, `CareerPlan`, `MasteryEstimate`. |
| `src/services/planning_service.py` (Copilot planner runtime) | **Reuse.** Same SDK adapter, new system prompts + tool catalogues. |
| `frontend/` | **New package.** PWA + Service Worker + IndexedDB + `<MultimodalIntentBar>` + 4 render states. |
| `infra/` | **Extend.** Add Ralph LRS, content-pack object storage, on-device model CDN. Reuse Bicep + managed identity. |
| `evals/` | **Extend.** Per-language eval slices, native-rater workflow, red-team probe set per locale. |

---

*End of PRD v0.1. Next revision after stakeholder review on 2026-06-06.*
