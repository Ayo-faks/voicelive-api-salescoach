# Pathfinder Learn — Architecture Reference

> **Scope:** Bounded context `backend/src/learning/` and `backend/src/common/`. Wulo SEN platform context (auth, multi-tenant RLS, Alembic migrations, Flask app, storage bootstrap) is out of scope here but is the host environment.

---

## 1. Top-level structure

```
backend/src/
├── learning/
│   ├── models.py          # All Pydantic contracts — the canonical data dictionary
│   ├── mastery.py         # MasteryEstimator protocol + BetaBKT / Elo implementations
│   ├── diagnostic.py      # DiagnosticEngine, DiagnosticItemBank, item selector, heatmap
│   ├── planner.py         # LearningPlanner / CareerPlanner protocols + StubLearningPlanner
│   ├── validator.py       # PlanValidator — semantic + safety + grounding rules
│   ├── repository.py      # LearningRepository protocol + InMemoryLearningRepository
│   ├── xapi.py            # xAPI statement builders + approval/override event types
│   ├── api.py             # Flask HTTP surface (stateless adapter)
│   ├── voice.py           # Voice transport adapter (WebSocket / Flask-Sock)
│   ├── operations.py      # KPI / metric snapshot loader
│   ├── multilingual.py    # Content-pack manifests, Cohen's kappa, Yoruba pack loader
│   └── career/
│       ├── advisor.py     # OrchestratorAdvisor — safety gate for career narration
│       └── planner.py     # DeterministicCareerPlanner — mastery × labour-market ranker
└── common/
    ├── labour_market.py   # LabourMarketRecord / LabourMarketDataset / LabourMarketLoader
    ├── oneroster.py       # OneRoster 1.2 CSV import adapter
    └── case_loader.py     # Generic eval case loader
```

---

## 2. Architectural principles

| Principle | Implementation |
|---|---|
| **Stateless adapters** | `api.py` and `voice.py` own no state. Persistence lives in `LearningRepository`. Mirrors `insights_service` pattern from Wulo. |
| **Protocols for every swappable engine** | `MasteryEstimator`, `DiagnosticItemSelector`, `LearningPlanner`, `CareerPlanner`, `XAPIEmitter`, `LearningRepository` are all Python `Protocol` classes. Concrete implementations are injected. |
| **Pydantic fail-closed contracts** | `ContractModel` uses `extra="forbid"` and `validate_assignment=True`. Every model output carries `provenance: List[Provenance]`. Validation fails at the boundary, never silently. |
| **Provenance on everything** | `Provenance` (source, rule_id, confidence, evidence_count) is appended at each processing step. The full chain is queryable on any output. |
| **Offline-first** | `PlannerResult.queued` / `offline_fallback` fields. `DeterministicItemSelector.offline_fallback_available = True`. `OfflineQueuedEvent` for replay. Content packs are SHA-256 verified local files. |
| **HITL by construction** | `InterventionPlan.requires_approval = True` by default. `CareerPlan.requires_counsellor_signoff = True` by default. `AdvisorDecision` is a typed return — no implicit rendering of a refused plan. |
| **Language-tagged outputs** | `LanguageAndProvenanceModel` base carries `lang: str` (BCP-47 pattern). Every planner output, mastery event, and xAPI statement is locale-tagged. |

---

## 3. Data contracts (models.py — canonical dictionary)

### Base types

```
ContractModel               — strict Pydantic base (extra=forbid, validate_assignment)
LanguageAndProvenanceModel  — ContractModel + lang (BCP-47) + provenance: List[Provenance]

Provenance
  source: str               — e.g. "BetaBKT", "DeterministicCareerPlanner"
  source_id: str | None
  rule_id: str | None       — e.g. "beta_increment_correctness"
  recency: str | None
  confidence: float [0,1]
  evidence_count: int ≥ 0
  metadata: dict
```

### Domain entities

```
Student           — student_id, tenant_id, class_id, display_name, year_group, career_consent: bool
Teacher           — teacher_id, tenant_id, display_name, class_ids
Class             — class_id, tenant_id, name, year_group
Skill             — skill_id, standard_id, name, description
Standard          — standard_id, source, name, version
DiagnosticItem    — item_id, skill_id, prompt, item_type, difficulty [-5,5], correct_answer
```

### Mastery state

```
MasteryEstimate
  kind: "beta" | "elo"
  probability: float [0,1]
  uncertainty: float [0,1]
  a, b: float > 0          — Beta params (kind=beta only)
  rating, deviation: float — Elo params (kind=elo only)

MasteryEvent (LanguageAndProvenanceModel)
  event_id, event_type="mastery_event"
  tenant_id, student_id, skill_id, response_id
  estimate: MasteryEstimate
```

### Diagnostic workflow types

```
StudentResponse (LanguageAndProvenanceModel)
  response_id, tenant_id, student_id, item_id, skill_id
  response_text: str
  correct: bool

DiagnosticItemBank (LanguageAndProvenanceModel)
  diagnostic_id, tenant_id, title, subject
  skills: List[Skill]
  items: List[DiagnosticItem]

DiagnosticSession (LanguageAndProvenanceModel)
  session_id, diagnostic_id, tenant_id, class_id, student_id
  status: "started" | "completed"
  selected_item_ids: List[str]

HeatmapCell (LanguageAndProvenanceModel)
  student_id, skill_id, skill_label
  probability [0,1], uncertainty [0,1]
  status: "secure" | "developing" | "needs_support"

TeacherHeatmap (LanguageAndProvenanceModel)
  tenant_id, class_id, diagnostic_id
  cells: List[HeatmapCell]

DiagnosticRunResult (LanguageAndProvenanceModel)
  session: DiagnosticSession
  responses: List[StudentResponse]
  mastery_events: List[MasteryEvent]
  xapi_statements: List[XAPIStatement]
  heatmap: TeacherHeatmap
  pending_plan: InterventionPlan
```

### Planner types

```
PlannerRequest (LanguageAndProvenanceModel)
  request_id, tenant_id, actor_id, role
  prompt: str
  scope: dict             — carries skill_ids, student_ids, mastery_profile, career_consent etc.
  offline: bool
  tool_call_budget: int   — mirrors InsightsPlanner contract
  wall_clock_budget_seconds: float

PlannerResult[T] (Generic)
  plan: T
  lang, provenance
  tool_calls_count: int
  queued: bool
  offline_fallback: str   — required when queued=True
  error_text: str | None

InterventionPlan (LanguageAndProvenanceModel)
  plan_id
  target_skill_ids: List[str]       — skills needing remediation
  target_student_ids: List[str]
  item_types: List[str]             — e.g. ["reteach", "guided_practice"]
  suggested_resources: List[str]   — Kolibri channel keys / content node ids (future)
  rationale: str
  requires_approval: bool = True   — HITL gate, always on by default
```

### Career types

```
LabourMarketSignal
  source: str              — must be non-empty; advisor refuses to narrate if missing
  recency: str
  confidence: float [0,1]
  value: dict              — {"band": "₦120k-₦180k/mo"} or {"score": 0.72}

CareerPathway
  pathway_id, title
  fit_score: float [0,1]
  wage_band: LabourMarketSignal
  demand_trend: LabourMarketSignal
  rationale: str

CareerPlan (LanguageAndProvenanceModel)
  plan_id, student_id
  pathways: List[CareerPathway]
  requires_counsellor_signoff: bool = True

AdvisorDecision (LanguageAndProvenanceModel)
  allowed: bool
  risk_level: "allow" | "review" | "refuse"
  reasons: List[str]
  typed_refusal: str | None
  safe_for_under_16: bool

CareerNarration (LanguageAndProvenanceModel)   — rendered when allowed=True
CareerRefusal (LanguageAndProvenanceModel)     — rendered when allowed=False; UI handles this type
```

### Infrastructure types

```
ContentPackManifest (LanguageAndProvenanceModel)
  manifest_id, tenant_id, pack_key, version
  source_uri: str
  sha256: str (64 chars)   — verified on load
  payload: dict

OfflineQueuedEvent
  queue_id, tenant_id, actor_id
  idempotency_key: str
  event_type, payload: dict
  status: "queued" | "replayed" | "failed" | "manual_review"
```

---

## 4. Workflow 1 — Diagnostic (skill check)

### Flow

```
[Teacher or auto-trigger]
        │
        ▼
POST /api/learning/diagnostic/start
  input: tenant_id, class_id, student_id, teacher_id, diagnostic_id (optional)
        │
        ▼
DiagnosticEngine.run_offline()
  1. Load DiagnosticItemBank from JSON (ITEM_BANK_PATH or DIAGNOSTICS_DIR)
  2. DiagnosticItemSelector.select_items(bank, prior_mastery={}, limit=12)
     → DeterministicItemSelector: round-robin by skill, sorted by (difficulty, item_id)
  3. Create DiagnosticSession{status="started", selected_item_ids=[...]}
  4. Persist session via LearningRepository.save_session()
        │
        ▼
[Client iterates items: GET /api/learning/diagnostic/item/{index}]
[Client submits answers: POST /api/learning/diagnostic/answer]
        │ answers: List[DiagnosticAnswer{item_id, response_text}]
        ▼
POST /api/learning/diagnostic/complete
  For each answer:
    correct = normalize_answer(response_text) == normalize_answer(item.correct_answer)
    StudentResponse created
    MasteryEstimator.update(MasteryUpdateInput{correct, prior_estimate, item_difficulty})
      → BetaBKT: a += 1 if correct else b += 1
               probability = a / (a + b)
               uncertainty = min(1, sqrt(variance) * 4)
    MasteryEvent created with updated MasteryEstimate
    xapi_statement = mastery_event_to_xapi(event, actor, activity)

  HeatmapCell per student×skill:
    status = "secure" if p ≥ 0.75 and uncertainty ≤ 0.35
           | "developing" if p ≥ 0.5
           | "needs_support" otherwise

  StubLearningPlanner.run_turn(PlannerRequest{scope={skill_ids, student_ids}})
    → InterventionPlan{target_skill_ids, requires_approval=True, rationale}

  DiagnosticCompletionEvent → xAPI statement emitted

  DiagnosticRunResult returned:
    {session, responses, mastery_events, xapi_statements, heatmap, pending_plan}
```

### Algorithms

| Component | Current implementation | Target OSS swap |
|---|---|---|
| Item selector | `DeterministicItemSelector` — round-robin per skill, difficulty-ascending | catsim `UrrySelector` / `MaximumLikelihoodEstimator` |
| Mastery estimator | `BetaBKT` — Bayesian Beta update per response | EduCDM DINA/NeuralCDM for KC graphs; pyKT DKT for sequences |
| Heatmap threshold | Fixed: p≥0.75 + u≤0.35 = secure; p≥0.5 = developing | Calibrate from pilot data |

### Input/output summary

| | Type |
|---|---|
| Input | `DiagnosticItemBank` (JSON file) + `List[DiagnosticAnswer]` |
| Output | `DiagnosticRunResult` → wraps session, mastery events, heatmap, pending plan |
| Side effects | `LearningRepository` persists session and mastery estimates; xAPI statements emitted |

---

## 5. Workflow 2 — Mastery estimation

### Flow

```
MasteryUpdateInput
  tenant_id, student_id, skill_id
  correct: bool
  prior_estimate: MasteryEstimate | None
  item_difficulty: float [-5, 5]
        │
        ▼
BetaBKT.update()                       Elo.update()
  a = prior.a or 1.0                     rating = prior.rating or 1000.0
  b = prior.b or 1.0                     difficulty_rating = 1000 + difficulty*100
  if correct: a += 1 else b += 1         expected = 1/(1+10^((d-r)/400))
  p = a/(a+b)                            rating += K*(actual - expected)
  var = a*b / ((a+b)^2 * (a+b+1))        p = 1/(1+10^((d-r)/400))
  u = min(1, sqrt(var)*4)                u = min(1, deviation/400)
        │
        ▼
MasteryUpdateResult
  estimate: MasteryEstimate{kind, probability, uncertainty, a, b | rating, deviation}
  evidence_count: int
  provenance: [prior...] + [Provenance{source="BetaBKT", rule_id="beta_increment_correctness"}]
```

### Repository persistence

`LearningRepository.save_mastery_event(event)` and `get_mastery_estimates(tenant_id, student_id)` — the prior estimate for the next question is loaded from the repository, making the estimator stateless.

---

## 6. Workflow 3 — Intervention planning

### Flow

```
DiagnosticRunResult.pending_plan
        │
        ▼  (requires teacher approval — HITL gate)
POST /api/learning/intervention/approve
  input: plan_id, teacher_id, action: "approved" | "edited_approved" | "rejected"
        │
        ▼
ApprovalEvent created → approval_event_to_xapi() → XAPIStatement emitted
        │
        ▼  (if approved)
InterventionPlan dispatched to content delivery layer
  suggested_resources: List[str]  ← Kolibri channel keys (future)
```

### PlanValidator (validator.py)

Every `InterventionPlan` passes through `PlanValidator` before reaching a teacher:

```
ValidationRule[T]
  check: Callable[[T], bool]
  error_code: str
  message: str

PlanValidator.validate(plan) → ValidationResult
  runs: catalogue_grounding_rule (skill_ids must exist in known catalogue)
  fails closed: if any rule fails → ValidationResult{valid=False, error_code, message, audit_reason}
  audit_reason is always populated, even on success
```

The `catalogue_grounding_rule` is the semantic safety equivalent of Wulo's plan-validation layer — it enforces that no intervention references a skill outside the loaded item bank.

---

## 7. Workflow 4 — Career navigation

### Flow

```
[Student completes sufficient skill checks — policy: career_consent=True required]
        │
        ▼
POST /api/learning/career/plan
  input: PlannerRequest{
    actor_id: student_id,
    scope: {
      mastery_profile: {skill_id: probability, ...},
      student_id,
      career_consent: bool,
      student_age: int
    }
  }
        │
        ▼
DeterministicCareerPlanner.run_turn(request)
  For each LabourMarketRecord in dataset:
    mastery_fit = Σ (mastery_profile[skill_id] * weight) / total_weight
    demand_score = record.demand_trend.value["score"]
    consent_multiplier = 1.0 if career_consent else 0.75
    fit_score = min(1.0, (mastery_fit*0.7 + demand_score*0.3) * consent_multiplier)
  Sort pathways by fit_score descending
  CareerPlan{pathways, requires_counsellor_signoff=True}
        │
        ▼
OrchestratorAdvisor.render(plan, audience, student_age, prompt)
  Checks (all must pass or → CareerRefusal):
    1. No unsafe terms in prompt (drop out, guarantee, loan shark, etc.)
    2. If audience=student and age<16: requires_counsellor_signoff must be cleared by a counsellor first
    3. All pathways must have wage_band.source AND demand_trend.source (grounding check)
  If pass → CareerNarration{text, advisor_decision}
  If fail → CareerRefusal{typed_refusal, advisor_decision}  ← UI renders this as distinct state
        │
        ▼
[requires_counsellor_signoff=True → queued for counsellor approval before shown to student]
```

### Scoring formula

```
fit_score = min(1.0, (mastery_fit × 0.7 + demand_score × 0.3) × consent_multiplier)

mastery_fit = Σ_k (mastery_profile[k] × skill_weights[k]) / Σ_k skill_weights[k]
  where k = knowledge component IDs mapped from O*NET task categories
  missing skill_id treated as 0.5 (neutral prior)

consent_multiplier:
  career_consent=True  → 1.0  (full score)
  career_consent=False → 0.75 (score penalty, less confident recommendation shown)
```

### LabourMarketRecord schema

```json
{
  "pathway_id": "healthcare-assistant-ng",
  "title": "Healthcare Assistant",
  "skill_weights": {"biology-kc1": 0.4, "practical-kc2": 0.35, "numeracy-kc3": 0.25},
  "wage_band": {
    "source": "NBS Nigeria Q4 2025",
    "recency": "2025-Q4",
    "confidence": 0.82,
    "value": {"band": "₦120k-₦180k/mo", "percentile_50": 148000}
  },
  "demand_trend": {
    "source": "World Bank STEP Nigeria 2024",
    "recency": "2024",
    "confidence": 0.75,
    "value": {"score": 0.71, "growth_3y_pct": 18}
  },
  "provenance": [{"source": "O*NET-27.0", "rule_id": "onet_esco_crosswalk_v1", ...}]
}
```

---

## 8. Workflow 5 — xAPI / LRS event emission

### Event types emitted

| Event | Trigger | xAPI verb |
|---|---|---|
| `mastery_event_to_xapi` | Every item response scored | `http://adlnet.gov/expapi/verbs/answered` |
| `diagnostic_completion_event_to_xapi` | Session completed | `http://adlnet.gov/expapi/verbs/completed` |
| `approval_event_to_xapi` | Teacher approves/rejects plan | Custom verb: `approved` / `rejected` |
| `OverrideEvent` | Mastery estimate manually overridden | Typed event (not yet xAPI-mapped) |

### XAPIStatement contract

```
XAPIStatement
  id: UUID
  actor: {objectType, name, mbox}       — tenant-scoped student/teacher identity
  verb: {id: URI, display: dict}
  object: {objectType, id: URI, definition: dict}
  result: {success, score, response}
  context: {platform, extensions: {tenant_id, skill_id, estimate}}
  timestamp: ISO-8601 UTC
```

### LRS backend — shipped

`RalphXAPISink` (xapi.py) is the concrete [ralph](https://github.com/openfun/ralph)-compatible `XAPIEmitter`. It is wired into `LearningApi` via `build_ralph_sink_from_env(repository=...)`, which reads `RALPH_BASE_URL` / `RALPH_AUTH_TOKEN` / `RALPH_TIMEOUT_SECONDS`. Every emit goes sink → `repository.emit_xapi_statement(...)` (persisted to `learning_xapi_statements` with a `sink_status`) → `observability.record_xapi(...)`.

Per-statement `sink_status`:

| Status | Meaning |
|---|---|
| `ralph_synced` | POST to `{RALPH_BASE_URL}/xAPI/statements` returned 2xx |
| `ralph_queued` | No endpoint configured or `offline=True` — buffered for `flush()` |
| `ralph_failed` | POST attempted and failed — buffered and appended to `learning_offline_queue` for replay |

Transport is the `XAPITransport` Protocol (`UrllibXAPITransport` in prod, `InMemoryXAPITransport` in tests). Offline-first by default: with no `RALPH_BASE_URL` set, statements queue and replay on reconnect. Covered by `test_learning_ralph_sink.py` and `test_learning_offline_drainer.py`.

**Remaining (deployment, not code):** provision a Ralph instance (FastAPI + Pydantic over Elasticsearch/ClickHouse) and set `RALPH_BASE_URL` so `sink_status` flips from `ralph_queued` to `ralph_synced`.

---

## 9. Workflow 6 — Multilingual content packs

### Flow

```
Content pack JSON file (e.g. yo_NG_content_pack.json)
        │
        ▼
load_yoruba_content_pack(path, tenant_id)
  → ContentPackManifest{sha256=SHA256(file_bytes), source_uri="local://...", payload}

SHA-256 verification on load — any tampered pack raises ValueError
        │
        ▼
LanguageEvalSlice — per-locale eval dataset
  cases: List[LanguageEvalCase{prompt, expected_intent, rater_labels: List[str]}]
  cohens_kappa: computed from rater_labels pairs (min 2 raters required)
```

### Cohen's kappa formula (implemented in multilingual.py)

```
κ = (p_o - p_e) / (1 - p_e)

p_o = observed agreement = count(rater1==rater2) / n_pairs
p_e = expected agreement = Σ_label (freq_rater1[label]/2n) × (freq_rater2[label]/2n)
```

Target: κ ≥ 0.7 per locale before a language pack ships to production (mirrors Wulo FE college eval bar).

---

## 10. Workflow 7 — OneRoster roster import

### Flow

```
OneRoster 1.2 CSV bundle (zip or directory)
  orgs.csv, classes.csv, users.csv, enrollments.csv, academicSessions.csv
        │
        ▼
OneRosterImportAdapter.import_bundle(path)
  Validates required column sets per OR 1.2 CSV binding
  SHA-256 digest per file → ImportManifest
  Returns: {orgs, classes, users, enrollments, academic_sessions}
  Offline-first: no network call, deterministic, re-verifiable
```

This is the ingest path for school MIS data (UK SIMS, Nigerian EMIS, Kenyan NEMIS). The manifest SHA-256s allow evidence bundles to prove which roster was in use during any given diagnostic run.

---

## 11. HTTP API surface (api.py)

All routes are in the `learning` blueprint. The module is a stateless adapter — it holds a process-local `InMemoryLearningRepository` and item bank for the pilot demo; in production these are replaced by the Postgres-backed repository and Azure Blob item bank loader.

| Route | Method | Purpose |
|---|---|---|
| `/api/learning/health` | GET | Liveness check |
| `/api/learning/diagnostic/banks` | GET | List loaded item banks |
| `/api/learning/diagnostic/start` | POST | Start diagnostic session, select items |
| `/api/learning/diagnostic/item/{index}` | GET | Retrieve nth item for current session |
| `/api/learning/diagnostic/answer` | POST | Submit answer, update mastery estimate |
| `/api/learning/diagnostic/complete` | POST | Complete session, generate heatmap + plan |
| `/api/learning/diagnostic/heatmap` | GET | Teacher heatmap for class × diagnostic |
| `/api/learning/diagnostic/approve` | POST | Teacher approves/rejects intervention plan |
| `/api/learning/career/plan` | POST | Generate career plan from mastery profile |
| `/api/learning/career/narrate` | POST | Narrate career plan through advisor gate |
| `/api/learning/content-packs` | GET | List loaded content pack manifests |
| `/api/learning/xapi/statements` | GET | Retrieve emitted xAPI statements (in-memory) |
| `/api/learning/ops/kpi` | GET | KPI report from pilot metrics snapshot |
| `/api/learning/voice/session` | WS | Voice transport session (feature-flagged) |

---

## 12. OSS tools — current, planned, and patterns copied

### Currently used

| Tool | Where | Purpose |
|---|---|---|
| Pydantic v2 | All models | Strict contract validation, `extra=forbid`, provenance chain |
| Flask | `api.py` | HTTP surface (inherited from Wulo host) |
| Flask-Sock | `voice.py` | WebSocket voice transport |
| Alembic | `alembic/versions/` | Schema migrations — `20260523_000024_learning_foundations.py` adds learning tables |

### Planned OSS integrations

| Tool | Where it plugs in | What it replaces |
|---|---|---|
| **catsim** | `DiagnosticItemSelector` Protocol | `DeterministicItemSelector` (round-robin) |
| **EduCDM** (DINA / NeuralCDM) | `MasteryEstimator` Protocol | `BetaBKT` (no KC graphs, no slip/guess) |
| **pyKT** (DKT) | `MasteryEstimator` Protocol | `BetaBKT` (no sequence modelling) |
| **ralph** (xAPI LRS) | `XAPIEmitter` Protocol | In-memory statement list |
| **Kolibri** | `InterventionPlan.suggested_resources` → Kolibri REST / LTI | No content delivery exists yet |
| **O*NET 27.0 data** | `LabourMarketDataset` JSON files | Fixture/stub records |
| **ESCO v1.2** | `LabourMarketDataset` + crosswalk | Occupational taxonomy for EU/Africa |
| **World Bank STEP** | `LabourMarketSignal.source` values | Regional wage/demand signals |
| **TAO / QTI** | `DiagnosticItemBank` JSON | Item authoring tool + item bank format |

### Patterns copied from Wulo / CareOS

| Pattern | Origin | Where used in Pathfinder |
|---|---|---|
| Orchestrator + Advisor | Wulo FE college engagement | `OrchestratorAdvisor` in `career/advisor.py` |
| Deterministic recommendation ranker with provenance | Wulo `insights_service` | `DeterministicCareerPlanner` |
| Plan-validation / fail-closed with audit reason | Wulo plan-validation layer | `PlanValidator` + `catalogue_grounding_rule` |
| Stateless planner adapter (persistence with caller) | Wulo `InsightsPlanner` contract | `LearningPlanner` Protocol + `PlannerRequest/Result` |
| Per-turn tool-call budget + wall-clock budget | Wulo orchestration | `PlannerRequest.tool_call_budget` / `wall_clock_budget_seconds` |
| HITL requires_approval flag | CareOS approval queue | `InterventionPlan.requires_approval = True` |
| Typed refusal (refusal is a return type, not an exception) | CareOS refusal-aware UI | `CareerRefusal` as sibling type to `CareerNarration` |
| xAPI approval events | CareOS audit ledger | `ApprovalEvent` / `OverrideEvent` |
| Cohen's kappa eval bar (κ ≥ 0.7) | Wulo FE college eval pipeline | `LanguageEvalSlice.cohens_kappa` |
| SHA-256 content pack verification | CareOS signed export bundles | `ContentPackManifest.sha256` |
| `offline_fallback` declared on planner result | CareOS offline patterns | `PlannerResult.offline_fallback` |
| `OfflineQueuedEvent` with idempotency key | CareOS Temporal workflow replay | `OfflineQueuedEvent` model |

---

## 13. Database migrations (learning context)

Migration `20260523_000024_learning_foundations.py` creates the persistent learning tables:

| Table | Purpose |
|---|---|
| `learning_sessions` | `DiagnosticSession` persistence — tenant_id, class_id, student_id, status, selected_item_ids (JSONB) |
| `mastery_estimates` | Per-student per-skill `MasteryEstimate` — `kind`, `a`, `b`, `rating`, `deviation`, `probability`, `uncertainty`, `evidence_count` |
| `mastery_events` | Append-only event log — one row per item response |
| `intervention_plans` | `InterventionPlan` + approval status + approving_teacher_id |
| `career_plans` | `CareerPlan` + counsellor_signoff status |
| `xapi_statements` | Persisted statement log (complement to ralph LRS) |
| `content_pack_manifests` | `ContentPackManifest` — sha256, version, tenant_id |
| `offline_queued_events` | `OfflineQueuedEvent` replay queue |

All tables carry `tenant_id` and are subject to the existing multi-tenant RLS policy via session GUCs (`SET app.tenant_id = ...`).

---

## 14. Pending implementations

### P1 — Required for pilot

| Item | File | What's needed |
|---|---|---|
| Postgres-backed `LearningRepository` | `repository.py` | `InMemoryLearningRepository` is pilot-only. Replace with SQLAlchemy implementation backed by migration tables. |
| catsim `DiagnosticItemSelector` adapter | new `learning/cat.py` | Wrap `catsim.simulation.item_selector.UrrySelector` behind `DiagnosticItemSelector` Protocol. Map `MasteryEstimate.probability` → logit `theta`. |
| ralph `XAPIEmitter` | new `learning/lrs.py` | HTTP POST to ralph LRS. Use `XAPIEmitter` Protocol. |
| Kolibri LTI / REST adapter | new `learning/kolibri.py` | Given `InterventionPlan.suggested_resources` (Kolibri content node IDs), return launch URLs or embed tokens. |
| Labour market data pipeline | new `scripts/ingest_labour_market.py` | Fetch O*NET 27.0 occupational data, crosswalk to ESCO v1.2, overlay NBS/WB STEP wage bands, emit `LabourMarketDataset` JSON per market. |
| Approval queue UI wiring | `api.py` + frontend | `POST /api/learning/diagnostic/approve` exists. Frontend approval queue (CareOS pattern) not yet wired. |

### P2 — Required for production

| Item | Notes |
|---|---|
| EduCDM DINA/NeuralCDM `MasteryEstimator` | Replaces `BetaBKT`. Requires item bank with Q-matrix (KC mapping per item). |
| QTI item bank import | Items currently hand-authored JSON. TAO item bank → QTI → converter → `DiagnosticItemBank`. |
| Multi-subject item banks | `DIAGNOSTICS_DIR` loader exists. Need banks per subject × year group × market. |
| Voice intent detection | `voice.py` WebSocket transport exists. Intent classification (text vs voice, which workflow) not implemented. |
| Streaming SSE for career narration | Career narration is currently synchronous JSON. Should stream via SSE (CareOS Care Assistant pattern). |
| NDPR / Nigeria data-residency posture | DPIA covers UK GDPR. NDPR (Nigeria) addendum needed for Lagos/Abuja deployments. |
| pyKT DKT upgrade | `MasteryEstimator` Protocol ready. DKT needs sequence of (item_id, correct) per student — `mastery_events` table provides this. |

### P3 — Future / moat work

| Item | Notes |
|---|---|
| A/B preference data for planner fine-tuning | Teacher approval/edit/reject events → DPO preference pairs (mirrors Wulo). `ApprovalEvent` with `edited_approved` action is the data source. |
| Eval pipeline (LLM-as-judge) | Offline eval set per skill × locale, kappa ≥ 0.7 bar, auto-page on regression. Framework exists in `multilingual.py`. Needs labelled set. |
| Canary release for planner | Shadow → 5% canary → ramp with auto-rollback on guardrail breach. `PlanValidator` is the guardrail; needs feature-flag wiring. |
| bob-emploi reference architecture review | bob-emploi's career advisor graph model is the OSS reference for the career recommendation layer. Worth a fork-vs-integrate decision once O*NET/ESCO data is loaded. |

---

## 15. Integration map

```
                    ┌───────────────────────────────────────────────────────┐
                    │                  Frontend (Next.js / PWA)              │
                    │  Learner: skill check flow, mastery bars, career card  │
                    │  Teacher: heatmap, approval queue, intervention assign  │
                    └─────────────────────┬─────────────────────────────────┘
                                          │ HTTP / SSE / WebSocket
                    ┌─────────────────────▼─────────────────────────────────┐
                    │              api.py  (Flask stateless adapter)         │
                    │  /diagnostic/*  /career/*  /xapi/*  /ops/*  /voice/*   │
                    └──┬──────────┬────────────┬──────────┬─────────────────┘
                       │          │            │          │
          ┌────────────▼──┐  ┌────▼─────┐  ┌──▼──────┐  ┌▼──────────────────┐
          │DiagnosticEngine│  │Career    │  │PlanVal- │  │VoiceTransport      │
          │               │  │Planner + │  │idator   │  │(Flask-Sock WS)     │
          │Item selector  │  │Advisor   │  │         │  └────────────────────┘
          │Mastery estim. │  └────┬─────┘  └─────────┘
          └────────┬──────┘       │
                   │              │
     ┌─────────────▼──────────────▼──────────────────────────────────────────┐
     │                    LearningRepository                                  │
     │  InMemoryLearningRepository (pilot) → PostgreSQL + RLS (production)    │
     └───────────────────────────────────────────────────────────────────────┘
                   │              │                │
        ┌──────────▼──┐  ┌────────▼────┐  ┌───────▼─────────┐
        │ xAPI emitter│  │Labour market│  │ Content packs   │
        │ (in-memory) │  │ JSON loader │  │ (SHA-256 local) │
        │ → ralph LRS │  │ → O*NET/ESCO│  │ → Kolibri LTI  │
        │  (pending)  │  │  pipeline   │  │  (pending)      │
        └─────────────┘  │  (pending)  │  └─────────────────┘
                         └─────────────┘
```

---

## 16. Learning paradigm & terminology

This section fixes the **correct learning-science and ML terminology** for what
Pathfinder Learn actually implements, so product, pitch, and engineering docs
stay precise. The core paradigm is **adaptive learning** built on a
psychometrics + knowledge-tracing stack, with a separate human-gated LLM tutor
layered on top for explanation and dialogue.

### 16.1 What it is

| Loose phrase | Correct term | Where it lives |
|---|---|---|
| "Adaptive learning" | **Computerized Adaptive Testing (CAT)** driven by **Item Response Theory (IRT)** — each item is chosen to maximise information about the learner's latent ability `θ` | `DeterministicItemSelector` (round-robin, difficulty-ascending) → target swap `catsim` `MaxInfoSelector` / `UrrySelector` — §4 |
| "It learns the student" | **Knowledge tracing** via **Bayesian Knowledge Tracing (BKT)** — a Beta-Bernoulli conjugate update per `(student, skill)` response | `BetaBKT` in `mastery.py`; alternate **Elo rating** estimator — §5 |
| "Mastery" | **Mastery estimation with explicit uncertainty** (mastery-learning pedagogy) — probability + calibrated uncertainty, rendered as 3 mastery × 2 uncertainty heatmap bands | `MasteryEstimate{kind:"beta", a, b}` in `models.py` |
| "It forgets / revises" | **Forgetting-curve decay** (spaced-repetition principle) — confidence decays by half-life over elapsed time | `MasteryEstimate.age_adjusted_uncertainty()` (`0.5 ** (elapsed_days / half_life_days)`); Web Push revision nudges |
| "Personalised daily plan" | **Adaptive sequencing** — weakest-skill-first ranking from the learner's own mastery history | `LearningApi.build_learner_plan` → `LearnerDailyPlan` (`source="mastery"` vs `"fallback"`) |
| "Diagnostic" | **Formative / diagnostic assessment** ("skill check") | Workflow 1 — §4 |
| "Career match" | **Deterministic, provenance-stamped recommendation ranking** (weighted mastery × labour-market demand, consent-gated) | `DeterministicCareerPlanner` — §7 |
| "AI tutor" | **Instruction-tuned, retrieval-grounded LLM generation with HITL gating** — *not* the learning algorithm; the pedagogy is the CAT/BKT loop above | Voice tutor profiles + `OrchestratorAdvisor` / `CriticAgent` quality gate |

### 16.2 What it is NOT

- **Not self-supervised / "self-learning"** in the ML sense — no model trains
  itself online on learner data. The learner *model* (BKT) updates via closed-form
  Bayesian arithmetic, not gradient descent.
- **Not reinforcement learning** for sequencing — the planner is deterministic,
  provenance-stamped, and teacher-approved (fail-closed), never an RL policy.
- **Not "in-context learning" as the core method.** ICL / few-shot prompting only
  describes the *LLM tutor's* prompting layer, not the mastery engine. Do not use
  "in-context learning" to describe the adaptive pedagogy.

### 16.3 One-line description

> An **adaptive-learning** system using **IRT-based computerized adaptive testing**
> for item selection, **Bayesian Knowledge Tracing** for the learner/mastery model
> (with explicit uncertainty and forgetting-curve decay), **deterministic
> mastery-ranked adaptive sequencing** for the daily plan, and a separate
> **human-gated LLM tutor** for explanation and dialogue.

---

*Generated from source analysis of `voicelive-api-salescoach-pathfinder-phase-0`. No code was modified.*
