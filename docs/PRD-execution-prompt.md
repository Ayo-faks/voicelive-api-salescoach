# Execution prompt — Pathfinder Learn refactor

Paste the block below into a fresh agent session opened at the repo root (`/home/ayoola/sen/`). It is self-contained: the agent reads the PRD, audits the current code, and proceeds in small verifiable steps with confirmation gates.

---

You are the implementation engineer for **Pathfinder Learn**, a refactor of the Wulo SEN speech-therapy platform into a Personalized Student Progress Identifier + Career Navigator for emerging markets.

## Authoritative inputs

1. **PRD (single source of truth):** [voicelive-api-salescoach/docs/PRD-pathfinder-learn.md](voicelive-api-salescoach/docs/PRD-pathfinder-learn.md). Read sections 1–13 + appendix before writing code.
2. **Engineer CV (patterns to reuse, named verbatim):** [CV-Ayoola-2026.md](CV-Ayoola-2026.md). Specifically reuse: custom orchestration over provider SDK, Pydantic-validated JSON, per-turn tool-call budget, stateless planner adapter, plan-validation + normalisation layer that fails closed with audit reason, therapist-approved durable memory, deterministic recommendation ranker with provenance, Orchestrator + Advisor two-agent safety pattern, append-only audit ledger, multi-tenant RLS via session GUCs, MCP-bounded tool surface, schema-driven UI.
3. **Reference files in the existing repo (retain — do not rewrite):**
   - [voicelive-api-salescoach/backend/src/services/insights_service.py](voicelive-api-salescoach/backend/src/services/insights_service.py) — frozen prompt, tool catalog, scope enforcement, `DEFAULT_TOOL_CALL_BUDGET = 6`, `DEFAULT_WALL_CLOCK_BUDGET_SECONDS = 20.0`.
   - [voicelive-api-salescoach/backend/src/services/insights_copilot_planner.py](voicelive-api-salescoach/backend/src/services/insights_copilot_planner.py) — stateless adapter, `skip_permission=True`, `on_pre_tool_use` budget enforcement, defensive JSON parsing.
   - [voicelive-api-salescoach/backend/src/services/storage.py](voicelive-api-salescoach/backend/src/services/storage.py) — audit columns including `tool_calls_count`.

## Architectural rule (CI-enforced)

Every cloud call has an offline-capable fallback. Every model output declares its language and provenance. Every persisted event is expressible as an xAPI statement.

## Stack reality (do not assume otherwise)

The Wulo backend is **Flask 3.1 + flask-sock + SQLAlchemy 2.0 + Alembic + Azure Voice Live + azure-cognitiveservices-speech + openai SDK + GitHub Copilot SDK + psycopg + Azure Monitor OpenTelemetry**. There is **no Temporal, NestJS, Hermes, Keycloak, or MinIO** in this repo — those belong to the separate CareOS engagement on the CV. Do not import them.

## Execution plan

Work the phases from PRD §10 in order. Do not skip ahead.

**Phase 0 — Foundations (start here):**
1. Create the `learning/` bounded context alongside the existing `therapy/` context. Do not delete `therapy/`.
2. Add a parametrised `PlanValidator[TPlan]` that generalises the existing fail-closed validator, with `LearningPlan` and `CareerPlan` Pydantic models.
3. Add a `MasteryEstimator` Protocol with `BetaBKT` (pyBKT-backed) and `Elo` implementations.
4. Add an xAPI emitter wired into the audit ledger.
5. Add the three CI lints that enforce the architectural rule above.

**Exit gate for Phase 0:** a runnable trace-evidence script under `voicelive-api-salescoach/scripts/` that drives one student diagnostic response → mastery update → teacher suggestion → HITL approval → xAPI statement → audit row, with the entire run reproducible offline.

## Working rules

- Before each phase: list the files you will touch and wait for my confirmation.
- Reuse the existing patterns from `insights_service.py` and `insights_copilot_planner.py` — do not reinvent budgets, scope enforcement, or stateless adapter shape.
- New planners must subclass / compose the existing pattern, not replace it.
- Every new module gets a unit test. Every new persisted event gets an xAPI shape test.
- No new top-level dependencies without flagging them with a one-line justification tied to a PRD section.
- Do not produce architecture diagrams, SoW, or further PRD revisions unless I ask.
- When in doubt, cite the PRD section number and ask.

## First action

1. Read [voicelive-api-salescoach/docs/PRD-pathfinder-learn.md](voicelive-api-salescoach/docs/PRD-pathfinder-learn.md) end to end.
2. Read the three retained files listed above.
3. Reply with: (a) the proposed `learning/` package layout, (b) the diff plan for parametrising `PlanValidator[TPlan]` against the current speech planner, (c) the exact list of new files you will create in Phase 0, and (d) any contradictions you spot between the PRD and the current code.

Then stop and wait for my go-ahead.
