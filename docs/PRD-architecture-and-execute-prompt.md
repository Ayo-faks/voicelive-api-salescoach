# Execution prompt — Architecture contract → phased refactor

Paste the block below into a fresh agent session at repo root `/home/ayoola/sen/`. The session has two stages: **(A) author the architecture contract and phased plan, get approval, then (B) execute the refactor on a new branch.** Do not skip Stage A.

---

You are the implementation engineer for **Pathfinder Learn**, a refactor of the Wulo SEN speech-therapy platform into a Personalized Student Progress Identifier + Career Navigator for emerging markets.

## Authoritative inputs (read in this order, do not skim)

1. PRD: [voicelive-api-salescoach/docs/PRD-pathfinder-learn.md](voicelive-api-salescoach/docs/PRD-pathfinder-learn.md)
2. Engineer CV (named patterns to reuse verbatim): [CV-Ayoola-2026.md](CV-Ayoola-2026.md)
3. Retained reference code (do not rewrite):
   - [voicelive-api-salescoach/backend/src/services/insights_service.py](voicelive-api-salescoach/backend/src/services/insights_service.py)
   - [voicelive-api-salescoach/backend/src/services/insights_copilot_planner.py](voicelive-api-salescoach/backend/src/services/insights_copilot_planner.py)
   - [voicelive-api-salescoach/backend/src/services/storage.py](voicelive-api-salescoach/backend/src/services/storage.py)

## Stack reality (non-negotiable)

Wulo backend is **Flask 3.1 + flask-sock + SQLAlchemy 2.0 + Alembic + Azure Voice Live + azure-cognitiveservices-speech + openai SDK + GitHub Copilot SDK + psycopg + Azure Monitor OpenTelemetry**. There is **no Temporal, NestJS, Hermes, Keycloak, or MinIO** in this repo. Do not introduce them. Those belong to the CareOS engagement on the CV.

## Architectural rule (CI-enforced from Phase 0)

Every cloud call has an offline-capable fallback. Every model output declares its language and provenance. Every persisted event is expressible as an xAPI statement.

---

## STAGE A — Author the architecture contract (no code yet)

Produce a single document at `voicelive-api-salescoach/docs/architecture-contract.md` containing the eight sections below. Cite PRD section numbers next to every requirement you carry forward.

### A.1 Architecture contract (the binding promises)
- Bounded contexts: existing `therapy/` (retain, frozen API surface) + new `learning/` (career sub-module inside it). Define the import direction rule (`learning/` MUST NOT import from `therapy/` and vice versa; shared primitives live in `common/`).
- Invariants the system upholds (e.g. "no AI suggestion reaches a teacher without passing `PlanValidator[TPlan]`", "no persisted event without an xAPI shape", "no cross-tenant read possible at the DB layer").
- Public interface contracts (Pydantic models + protocol classes) listed by file path.

### A.2 Components
Table with one row per component: name, path, language, owner context, retain/replace-OSS/build verdict, source pattern from CV (verbatim phrase), upstream/downstream. Components must include at minimum: `MultimodalIntentBar`, `IntentClassifier`, `PolicyGate`, `LearningPlanner`, `CareerPlanner`, `PlanValidator[TPlan]`, `MasteryEstimator` (Beta-BKT + Elo), `OrchestratorAdvisor`, `ApprovedMemoryStore`, `xAPIEmitter`, `OneRosterAdapter`, `CASEAdapter`, `LabourMarketLoader`, `OfflineSyncQueue`, `AuditLedger`.

### A.3 Data flow
A numbered narrative + mermaid `flowchart LR` of the canonical happy path: student response → intent classification → mastery update → planner → validator → orchestrator+advisor → HITL approval → xAPI emit → audit ledger → teacher UI. Mark every step with the latency budget and the offline fallback.

### A.4 Trust boundary
- Identity zones: device (untrusted), tenant API (trusted post-JWT), planner (sandboxed, no DB creds), tool surface (MCP-bounded), DB (RLS-enforced via session GUC).
- Egress rules: which components may call which external services; PII redaction points; provenance stamping points.
- AuthN/AuthZ matrix: actor × action × scope.

### A.5 IaC scope
- What is provisioned by IaC (Bicep + azd) vs. what stays config/manual.
- Resource list with SKUs and per-environment overrides (dev, pilot, prod).
- Managed identities, RBAC role assignments, Key Vault secret names, network posture.
- Explicit out-of-scope list (e.g. on-device tablet provisioning, school LAN).

### A.6 In / out of scope (MVP, 12-week pilot)
Two columns: **In** and **Out**. Bullet, terse. Every "Out" item names the phase it could land in later, or "never".

### A.7 Phased delivery with verification gates
Phases 0–4 from PRD §10. For each phase produce:
- Goal (1 sentence)
- Deliverables (file paths)
- **Verification gate** — a runnable command (`pytest -k …`, `python scripts/trace_evidence_phase_N.py`, `make verify-phase-N`) and the exact pass criterion in plain English. Gate must be reproducible offline.
- Exit artefact (e.g. signed trace bundle, CI green badge, demo recording).
- Rollback procedure.

### A.8 Risks and kill switches
Carry the 5-tier risk register from PRD §11. For each row, add the kill-switch command/feature flag name and who can pull it.

**Stop after Stage A. Reply with the file created, a 10-line summary of decisions you made, and any contradictions you found with the PRD or the existing code. Wait for my explicit "approved, proceed to Stage B" before doing anything else.**

---

## STAGE B — Execute the refactor (only after Stage A is approved)

### B.0 Branch hygiene (do this first, before any file change)

Run, in order, and paste the output back:

```bash
cd /home/ayoola/sen/voicelive-api-salescoach
git status --porcelain
git rev-parse --abbrev-ref HEAD
git fetch --all --prune
git checkout -b refactor/pathfinder-learn-phase-0 origin/main || git checkout -b refactor/pathfinder-learn-phase-0
git push -u origin refactor/pathfinder-learn-phase-0
git rev-parse --abbrev-ref HEAD
```

If `git status --porcelain` is non-empty, **stop and ask** — do not stash, commit, or discard pre-existing changes. If `origin/main` does not exist, branch from the current default branch and tell me which one.

### B.1 Execute Phase 0 only

Phase 0 deliverables (per Stage A doc):
1. Create `backend/src/learning/` bounded context skeleton with `__init__.py`, `models.py`, `planner.py`, `validator.py`, `mastery.py`, `xapi.py`.
2. Implement parametrised `PlanValidator[TPlan]` (generalised from the existing fail-closed validator).
3. Implement `MasteryEstimator` Protocol with `BetaBKT` and `Elo` concrete classes.
4. Wire an `xAPIEmitter` into the existing audit ledger pathway.
5. Add three CI lints enforcing the architectural rule (offline fallback / language+provenance / xAPI shape).
6. Add the Phase 0 trace-evidence script at `voicelive-api-salescoach/scripts/trace_evidence_phase_0.py` that runs a synthetic student response end-to-end and prints a signed evidence bundle path.

### B.2 Working rules during execution

- One logical change per commit. Conventional Commits (`feat:`, `refactor:`, `test:`, `ci:`, `docs:`).
- Every new module gets at least one pytest unit test. Every new persisted event shape gets an xAPI conformance test.
- Reuse — do not reimplement — `DEFAULT_TOOL_CALL_BUDGET`, `DEFAULT_WALL_CLOCK_BUDGET_SECONDS`, scope enforcement, stateless adapter shape, defensive JSON parsing from `insights_service.py` / `insights_copilot_planner.py`. Import or subclass; do not copy-paste.
- No new top-level dependencies without flagging them with a one-line justification tied to a PRD section.
- After each commit, run the Phase 0 verification gate and paste the output.
- Do not touch `therapy/`. Do not run destructive git commands (`reset --hard`, `push --force`, `clean -fdx`).
- Do not open a PR yet. Stop after Phase 0 is green on the verification gate and summarise:
  - commits made (hashes + subjects),
  - files added/modified,
  - verification gate output,
  - any deviations from the architecture contract and why.

Wait for my go-ahead before starting Phase 1.

---

## First action

1. Confirm you have read all three reference files and the PRD.
2. Produce Stage A's `architecture-contract.md`.
3. Stop.
