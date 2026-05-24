# Execution prompt — Fix 5 outstanding gaps + dead interactions

Paste this into a fresh agent session opened at repo root `/home/ayoola/sen/`. Two stages: **(A) triage doc and acceptance criteria, get approval, then (B) execute fixes on a new branch.** Do not skip Stage A.

---

You are the implementation engineer for **Pathfinder Learn** (refactor of the Wulo SEN codebase). The branch [`refactor/pathfinder-learn-phase-1`](voicelive-api-salescoach-pathfinder-phase-0/) has Phases 0–4 stacked. Five engineering gaps and one user-visible interaction bug remain.

## Authoritative inputs (read in order, do not skim)

1. PRD: [voicelive-api-salescoach-pathfinder-phase-0/docs/PRD-pathfinder-learn.md](voicelive-api-salescoach-pathfinder-phase-0/docs/PRD-pathfinder-learn.md) — sections §6 KPI gates, §7 functional requirements, §10 phased delivery, §11 risks, §12 open questions.
2. Architecture contract: [voicelive-api-salescoach-pathfinder-phase-0/docs/architecture-contract.md](voicelive-api-salescoach-pathfinder-phase-0/docs/architecture-contract.md).
3. UI shell that already renders the 5 surfaces: [voicelive-api-salescoach-pathfinder-phase-0/frontend/src/learning/PathfinderLearnApp.tsx](voicelive-api-salescoach-pathfinder-phase-0/frontend/src/learning/PathfinderLearnApp.tsx) and [frontend/src/learning/routes/](voicelive-api-salescoach-pathfinder-phase-0/frontend/src/learning/routes/).
4. Backend learning context: [voicelive-api-salescoach-pathfinder-phase-0/backend/src/learning/](voicelive-api-salescoach-pathfinder-phase-0/backend/src/learning/).
5. CV patterns to reuse verbatim: [CV-Ayoola-2026.md](CV-Ayoola-2026.md) (Pydantic-validated JSON, per-turn tool-call budget, stateless adapter, fail-closed PlanValidator, Orchestrator + Advisor, append-only audit ledger, MCP-bounded tool surface).

## Stack reality (non-negotiable)

Flask 3.1 + flask-sock + SQLAlchemy 2.0 + Alembic + Azure Voice Live + azure-cognitiveservices-speech + openai SDK + GitHub Copilot SDK + psycopg + Azure Monitor OpenTelemetry. **No Temporal, NestJS, Hermes, Keycloak, MinIO.**

## The six issues to fix

| # | Gap | Symptom / source |
|---|---|---|
| **F1** | Uncommitted working tree on `refactor/pathfinder-learn-phase-1` | `git status` shows `frontend/src/main.tsx` + `index.html` modified and entire `frontend/src/learning/` untracked. One `git checkout .` deletes the visible UI. |
| **F2** | Pilot KPIs are synthetic fixture numbers | KPI strip in `PathfinderLearnApp` reads from `frontend/src/learning/fixtures.ts`. Not wired to a backend endpoint and not documented as fixture-driven in the UI. |
| **F3** | Voice in MVP not wired | [backend/src/learning/voice.py](voicelive-api-salescoach-pathfinder-phase-0/backend/src/learning/voice.py) (~73 LOC) exists but no UI entry point invokes it. PRD §12 open question. |
| **F4** | No DPO / NDPR / OneRoster / CASE compliance evidence | `evidence/phase_*/` contains only trace zips. No signed compliance artefact. |
| **F5** | Branch-hygiene drift from execution prompt | Original prompt said `refactor/pathfinder-learn-phase-0`; phases stacked onto `phase-1`. Tag the merge points so the pilot demo can be reproduced. |
| **F6** | **Dead interactions in the UI** | User clicks "Start today's check-in", "Approve", "Reject", surface-switch buttons → nothing happens. Snapshot confirms the buttons render but handlers are no-ops or missing. Open-source diagnostic items, ASR (Vosk / Meta MMS), TTS (Piper), and content packs (Kolibri / NERDC OER) are already referenced in `data/learning/` but not invoked by the click paths. |

## Open-source materials already in the repo / referenced — use these, do NOT introduce new SaaS

- **Items**: [data/learning/jss2_maths_diagnostic_phase_2.json](voicelive-api-salescoach-pathfinder-phase-0/data/learning/jss2_maths_diagnostic_phase_2.json) (50 items × 4 skills, NERDC-aligned).
- **Mastery**: pyBKT (Beta-BKT) and Elo via [backend/src/learning/mastery.py](voicelive-api-salescoach-pathfinder-phase-0/backend/src/learning/mastery.py).
- **Item selection**: catsim (IRT) — wire into `diagnostic.next_item()`.
- **xAPI**: Ralph LRS shape via [backend/src/learning/xapi.py](voicelive-api-salescoach-pathfinder-phase-0/backend/src/learning/xapi.py).
- **Multilingual ASR/TTS**: Meta MMS / SeamlessM4T (server-side fallback) + Piper (on-device TTS). On-device LLM: Gemma 3 / Phi-4-mini / Qwen3-small via ONNX or wasm.
- **Content packs**: Kolibri-style offline bundles under [data/learning/content_packs/](voicelive-api-salescoach-pathfinder-phase-0/data/learning/content_packs/).
- **Career**: O*NET → ESCO crosswalk + NBS Q4 2025 wage data (already loaded by [career/planner.py](voicelive-api-salescoach-pathfinder-phase-0/backend/src/learning/career/planner.py)).

---

## STAGE A — Triage and acceptance criteria (no code yet)

Produce a single document at `voicelive-api-salescoach-pathfinder-phase-0/docs/fix-plan-2026-05-23.md` with these sections:

### A.1 Root-cause matrix
One row per fix F1–F6. Columns: gap, the exact file(s) and line numbers responsible, root cause in one sentence, smallest possible change.

### A.2 Click-path audit (F6) — required, do this thoroughly
List every interactive element rendered by `PathfinderLearnApp` and its child route components. For each: element label, file:line of the JSX, current `onClick` (or absence), expected behaviour per PRD §7, what the click should call (backend endpoint or local fixture function), and whether the behaviour can be served offline.

Include at minimum: "Start today's check-in", every diagnostic item answer button, "Approve", "Reject", surface-switch nav buttons, "Send request" on the intent bar, career shortlist row clicks.

### A.3 Acceptance criteria
Per fix, a runnable command (`pytest -k …`, `npx playwright test …`, `python scripts/trace_evidence_phase_N.py`) plus the pass criterion in plain English. F6's acceptance is end-to-end: starting from a fresh page load, a Playwright test drives one diagnostic item → mastery update visible in the heatmap → pending-approval card appears → click Approve → audit row visible → xAPI statement emitted to the trace bundle.

### A.4 Out of scope for this fix pass
List anything tempting you will NOT do (UI redesign, new surfaces, new dependencies beyond the OSS list above, refactoring `therapy/`).

### A.5 Risk if a fix is wrong
For each fix, the worst-case rollback path.

**Stop. Reply with the file created, a 10-line decision summary, and any contradictions with the PRD or current code. Wait for my explicit "approved, proceed to Stage B" before any further action.**

---

## STAGE B — Execute fixes (only after Stage A is approved)

### B.0 Branch hygiene (do this first, before any file change)

```bash
cd /home/ayoola/sen/voicelive-api-salescoach-pathfinder-phase-0
git status --porcelain
git rev-parse --abbrev-ref HEAD
git fetch --all --prune
# Branch off the current phase-1 tip so existing stacked work is preserved.
git checkout -b fix/pathfinder-pilot-gaps-2026-05-23
git push -u origin fix/pathfinder-pilot-gaps-2026-05-23
git rev-parse --abbrev-ref HEAD
```

If `git status --porcelain` is non-empty (it will be — the untracked UI tree), **commit those uncommitted changes as the FIRST commit on the new branch** with subject `feat(frontend): land PathfinderLearnApp shell and learning routes`. Do not stash, reset, or discard. If anything is unclear about ownership of an uncommitted file, stop and ask.

### B.1 Fix order (one logical change per commit, Conventional Commits)

1. **F1 commit** — land the working tree (above).
2. **F5 tags** — `git tag pilot/phase-0 …`, through `pilot/phase-4`, on the existing merge commits. Push tags. Document in `docs/fix-plan-2026-05-23.md`.
3. **F6 interactions** — wire every dead click. Use the OSS materials listed above. Reuse the existing `PlanValidator`, budget constants, and stateless adapter pattern from [insights_service.py](voicelive-api-salescoach-pathfinder-phase-0/backend/src/services/insights_service.py) / [insights_copilot_planner.py](voicelive-api-salescoach-pathfinder-phase-0/backend/src/services/insights_copilot_planner.py). Do not invent new orchestration.
4. **F2 KPIs** — add a `GET /api/learning/kpis` endpoint backed by [operations.py](voicelive-api-salescoach-pathfinder-phase-0/backend/src/learning/operations.py). UI consumes it. Until live pilot data exists, response declares `source: "fixture"` and the KPI strip shows a small "fixture" badge. Provenance rule, enforced.
5. **F3 voice** — add a single voice entry point on the Student Learning Home that uses the existing `voice.py`. Behind a feature flag, off by default in the pilot demo unless I say otherwise. Honour the offline-fallback architectural rule.
6. **F4 compliance pack** — add `evidence/compliance/` with: NDPR + UK GDPR DPIA outline, OneRoster 1.2 CSV import smoke test, CASE framework adapter conformance test. Signed bundle script.

### B.2 Working rules

- One logical change per commit. Conventional Commits.
- Every new module gets a pytest unit test. Every new persisted event shape gets an xAPI conformance test. Every new interactive UI path gets a Playwright e2e under [frontend/e2e/](voicelive-api-salescoach-pathfinder-phase-0/frontend/e2e/).
- Reuse, do not reimplement, `DEFAULT_TOOL_CALL_BUDGET`, `DEFAULT_WALL_CLOCK_BUDGET_SECONDS`, scope enforcement, fail-closed validator, defensive JSON parsing.
- No new top-level dependencies without a one-line justification tied to a PRD section.
- After every commit, run that fix's acceptance command from Stage A and paste the output.
- Do not touch `therapy/`. Do not run destructive git (`reset --hard`, `push --force`, `clean -fdx`). Do not bump vite, react, or fluentui versions.
- Do not open a PR yet. After F6 is green (the end-to-end Playwright passes), stop and summarise:
  - commits made (hashes + subjects),
  - acceptance command output per fix,
  - tags created and pushed,
  - what's deferred and why.

Wait for my go-ahead before F2–F4.

---

## First action

1. Confirm you have read the PRD, the architecture contract, `PathfinderLearnApp.tsx`, and the two retained Wulo planner files.
2. Open the running app at `http://localhost:5174/home` (or 5173) with Playwright snapshot, click each interactive element once, record what happens (or doesn't), and use that as raw input for the A.2 click-path audit.
3. Produce `docs/fix-plan-2026-05-23.md`.
4. Stop.
