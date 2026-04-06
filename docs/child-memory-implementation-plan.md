# Child Memory Implementation Plan

Date: 2026-04-06
Status: Living roadmap and implementation status document
Related: [child-memory-architecture.md](./child-memory-architecture.md)

## Purpose

This document turns the proposed child memory architecture into an implementation-facing plan for the current codebase.

It also serves as the current status snapshot for what is already implemented versus what remains as hardening or follow-on work.

It is intended to guide a phased rollout that starts with a safe therapist-facing V1 and expands later into recommendation ranking, live-session personalization, and clinic-level institutional memory.

This plan assumes the current system already has:

- durable child/session/plan persistence
- post-session AI assessment
- therapist review flows
- a therapist planning service

This plan originally assumed that a semantic child memory layer did not yet exist. That assumption is no longer true.

## Implementation Status Snapshot

### Current shipped status

- Phase 1 is implemented end-to-end:
	- governed child memory persistence
	- post-session proposal generation
	- therapist review and manual memory entry
	- compiled child memory summaries
	- planner consumption of approved memory
	- therapist dashboard memory review UI
- Phase 2 is implemented end-to-end:
	- deterministic recommendation ranking
	- durable recommendation logs and candidate provenance
	- therapist-facing recommendation explanation UI with evidence and rationale
- Phase 3 is implemented for the intended low-risk scope:
	- runtime read-only consumption of approved child memory
	- low-risk cue and constraint injection during live session setup
	- durable memory writes remain outside runtime agents
- Phase 4 is partially implemented:
	- de-identified institutional-memory insights are generated and surfaced
	- recommendation ranking can consume institutional-memory signals
	- remaining work is primarily governance, tuning, and measurement rather than first-time feature creation

### How to read the roadmap below

- Treat Phase 1 and Phase 2 as achieved phases.
- Treat Phase 3 as achieved for the originally planned MVP scope.
- Treat Phase 4 as started and usable, but still open for hardening and policy refinement.
- Treat most remaining work as product coherence, observability, governance clarity, and documentation accuracy rather than missing core memory architecture.

## Current Context

### Current architecture baseline

The current platform already persists important event-level history such as:

- children
- exercises
- sessions
- transcripts
- AI assessments
- pronunciation assessments
- therapist feedback
- practice plans

The planner can already read a source session and recent sessions when generating a next-session plan.

### Current problem

The system stores raw event history but does not maintain a governed child knowledge layer.

That means the system can remember that something happened, but not maintain a durable, inspectable, and explainable model of what it currently believes about the child.

### Why this matters

Without a semantic memory layer:

- planning quality relies too much on repeated raw-history retrieval
- recommendation explanations are weaker than they should be
- preferences and effective cues do not compound cleanly over time
- the system cannot clearly distinguish therapist-approved knowledge from weak inferences

## Planning Principles

### 1. Preserve raw events as source of truth

Raw session evidence should remain durable and auditable.

### 2. Add a separate governed semantic layer

Child memory should not be mixed into raw session tables in an ad hoc way.

### 3. Start with therapist-facing V1

The first rollout should improve therapist review and planning before attempting full live-session personalization.

### 4. Require review for higher-risk writes

Not all inferred memory should become durable automatically.

### 5. Keep planner and recommendation logic explainable

Every recommendation should be traceable to approved memory items and source evidence.

### 6. Prefer relational storage plus summaries first

Do not introduce a graph database or a large new infrastructure dependency in V1.

## Scope Summary

### Phase 1 scope

Phase 1 delivered the minimum governed memory loop:

- new storage for child memory artifacts
- post-session memory proposal generation
- therapist review and approval workflow
- child memory summaries
- planner consumption of approved child memory
- dashboard UI for memory summary and proposal review

### Phase 2 scope

Phase 2 added recommendation ranking and explanation:

- deterministic next-exercise recommendation logic
- recommendation logs with source evidence
- explanation surfaces in therapist UI

### Phase 3 scope

Phase 3 added live-session personalization:

- read-only runtime consumption of approved child memory
- low-risk cue/constraint injection into live agent/session setup

### Phase 4 scope

Phase 4 adds clinic-level institutional memory:

- de-identified cross-child strategy insights
- recommendation tuning based on reviewed outcomes

## Non-Goals For V1

The following should not be treated as part of the initial implementation scope:

- graph database adoption
- full clinic knowledge graph
- broad autonomous memory writing without review
- diagnostic or developmental labeling
- direct durable writes from live child-facing agents
- fully autonomous recommendation policy without therapist visibility

## Key Repository Constraints

### Dual storage backends

The codebase currently supports both SQLite and PostgreSQL storage paths. Memory persistence work must maintain parity across both implementations.

Implication:

- new schema and storage methods must land in both storage implementations
- Postgres migration support must be updated alongside storage contracts

### Current synchronous analyze flow

The post-session analyze path is synchronous today.

Implication:

- memory synthesis added to this path must be lightweight at first
- if latency grows too much, later phases should introduce deferred or async processing

### Planner context shape already exists

The current planner already builds a context object.

Implication:

- approved child memory should be added to that context instead of bolted onto prompts separately

### Dashboard is already the therapist control surface

The current frontend already centralizes therapist review in the dashboard.

Implication:

- V1 memory review should live there first
- do not create a separate large feature area unless needed later

## Phase 1: Governed Child Memory V1

### Goal

Introduce a durable child memory layer that is:

- source-linked
- reviewable by therapists
- planner-readable
- safe enough for production iteration

### Deliverables

1. Storage schema for child memory artifacts
2. Backend memory service layer
3. Post-session memory proposal synthesis
4. Therapist-only memory APIs
5. Planner integration with approved memory summaries
6. Frontend dashboard summary and proposal review UI
7. Test coverage for policy, storage, planner context, and UI

### Data model additions

Recommended artifacts:

- `child_profiles` or profile extension fields
- `child_memory_items`
- `child_memory_proposals`
- `child_memory_evidence_links`
- `child_memory_summaries`
- `recommendation_logs`

These should support:

- categories such as targets, effective cues, ineffective cues, blockers, preferences, constraints
- memory types such as fact, inference, recommendation, constraint
- statuses such as pending, active, approved, rejected, superseded, expired, disputed
- confidence and provenance metadata

### Backend workstreams

#### 1. Storage layer

Add schema and CRUD support in both storage implementations.

Primary work:

- define memory table contracts
- add create/read/update/review operations
- support summary rebuild reads
- support evidence links back to sessions and plans

Primary files:

- `backend/src/services/storage.py`
- `backend/src/services/storage_postgres.py`
- `backend/alembic/versions/20260405_000001_initial_postgres_schema.py`

#### 2. ChildMemoryService

Create a dedicated service that hides storage details and provides a stable domain API.

Responsibilities:

- get active child memory
- get child memory summary
- save proposals
- approve or reject proposals
- rebuild summaries
- return recommendation provenance inputs

This service should become the only place where memory rules are assembled at the application layer.

#### 3. Post-session synthesis

After session persistence, generate memory proposals from the completed session.

Inputs:

- saved session
- AI assessment
- pronunciation assessment
- therapist feedback if present
- exercise metadata

Outputs:

- low-risk auto-applied operational facts where allowed
- higher-risk proposed memory updates in pending review state
- refreshed child summary artifact

Primary integration point:

- `backend/src/app.py` analyze flow

#### 4. Memory APIs

Add therapist-only endpoints for:

- child memory summary read
- memory items read
- memory proposals read
- approve proposal
- reject proposal
- optional manual memory edits

These routes must preserve clear separation between approved memory and pending proposals.

#### 5. Planner integration

Update planner context generation so the planner reads:

1. approved child memory summary
2. approved active constraints
3. relevant recent sessions
4. source session detail

The planner should also log which approved memory items were used to support a plan or recommendation.

Primary file:

- `backend/src/services/planning_service.py`

### Frontend workstreams

#### 1. Shared contracts and state

Add frontend types and API client methods for:

- child memory summary
- child memory items
- child memory proposals
- evidence links
- recommendation explanation payloads

Primary files:

- `frontend/src/types/index.ts`
- `frontend/src/services/api.ts`
- `frontend/src/app/App.tsx`

#### 2. Therapist dashboard UI

Add to the dashboard:

- child memory summary panel
- proposal review list or panel
- approved vs pending distinction
- recommendation explanation block tied to approved memory

Primary file:

- `frontend/src/components/ProgressDashboard.tsx`

#### 3. Lightweight therapist entry points

Add compact summary signals to existing entry points such as:

- active target
- pending review count
- last memory review date

Primary file:

- `frontend/src/components/DashboardHome.tsx`

#### 4. Optional post-session confirmation surface

If Phase 1 dashboard review proves stable, later extend the assessment review flow with immediate proposal confirmation.

Primary file:

- `frontend/src/components/AssessmentPanel.tsx`

### Suggested implementation order inside Phase 1

1. Define memory schema and storage interfaces.
2. Add ChildMemoryService over both storage implementations.
3. Add post-session synthesis hook in the analyze flow.
4. Add therapist-only memory APIs.
5. Update planner context to read approved memory.
6. Add frontend contracts and app-level state.
7. Add dashboard UI for memory summary and proposal review.
8. Add test coverage and performance validation.

### Success criteria for Phase 1

Phase 1 is successful when all of the following are true:

- completed sessions create durable memory proposals or summary updates
- therapists can review pending proposals and approve or reject them
- planners consume approved child memory before raw history
- therapists can see what the system believes about a child
- recommendation or plan rationale can point to approved memory and source sessions

Current status: achieved.

## Phase 2: Recommendation Ranking And Explanation

### Goal

Move from memory-aware planning to memory-aware next-exercise recommendation.

### Deliverables

1. Deterministic recommendation ranking using approved child memory and recent evidence
2. Recommendation logs with rationale and provenance
3. Therapist-facing recommendation explanation UI

### Design guidance

The ranking engine should be primarily deterministic.

Use structured inputs such as:

- current target sound
- approved effective cues
- recent engagement trends
- recent exercise outcomes
- difficulty progression
- therapist constraints

LLM usage should be focused on:

- rationale generation
- explanation framing
- optional plan wording

It should not be the sole ranking engine.

### Success criteria for Phase 2

- the system can explain why a specific exercise was recommended
- the explanation names supporting memory items and sessions
- therapists can compare recommendation output to approved memory
- recommendation logs are durable and auditable

Current status: achieved.

## Phase 3: Live-Session Personalization

### Goal

Use approved low-risk child memory during live session setup without turning the runtime agent into an unconstrained writer of durable memory.

### Deliverables

1. Inject approved current targets and constraints into live session setup
2. Inject approved effective cues where appropriate
3. Keep live-session durable memory writes disabled at runtime

### Guardrails

- runtime agents may read approved memory
- runtime agents may emit raw events
- runtime agents may not directly commit durable child memory
- durable writes remain a post-session synthesis and review responsibility

### Success criteria for Phase 3

- live session personalization improves child-facing continuity
- no unsafe or unreviewed durable memory writes originate from runtime agent behavior

Current status: achieved for the original low-risk runtime scope.

## Phase 4: Clinic-Level Institutional Memory

### Goal

Build de-identified operational knowledge across reviewed child outcomes.

### Deliverables

1. cross-child strategy insights
2. reviewed pattern summaries
3. recommendation tuning inputs derived from approved evidence

### Guardrails

- institutional memory must be de-identified where appropriate
- clinic-level insights must not silently become child-level facts
- child-specific recommendations must still be grounded in that child’s approved memory and recent evidence

## Risk Register

### 1. Storage parity risk

Memory features may drift across SQLite and Postgres if not implemented through a shared contract.

Mitigation:

- define storage interface first
- validate with parity tests

### 2. Planner context mismatch risk

If planner context shapes remain inconsistent, memory additions may not actually influence planning behavior.

Mitigation:

- inspect context payloads during tests
- log memory items used in plan creation

### 3. Analyze-route latency risk

Post-session synthesis can increase latency if it is too heavy.

Mitigation:

- keep V1 synthesis bounded
- measure latency before and after
- move heavier work to deferred processing if needed

### 4. Governance confusion risk

If pending proposals look like approved facts, therapists will not trust the system.

Mitigation:

- use explicit review states everywhere
- visually distinguish pending vs approved in UI

### 5. Summary drift risk

If memory write-back is weakly governed, the summary may stop reflecting the evidence.

Mitigation:

- require provenance
- separate observation from inference
- support rejection, supersession, and expiry

### 6. Scope creep risk

Trying to ship planner memory, recommendation ranking, runtime personalization, and institutional memory at once will likely stall delivery.

Mitigation:

- keep Phase 1 focused on therapist workflow and planner integration
- defer runtime and clinic-level features intentionally

## Verification Plan

### Backend verification

1. Verify schema creation and migration behavior for memory tables.
2. Verify storage parity across SQLite and Postgres.
3. Verify proposal generation from representative sessions.
4. Verify approve/reject transitions and provenance links.
5. Verify planner context contains approved memory before raw history.

### Frontend verification

1. Verify child memory loads when selected child changes.
2. Verify empty and sparse states render safely.
3. Verify proposal review actions update the dashboard correctly.
4. Verify recommendation explanation shows approved memory and evidence clearly.

### Product verification

A therapist should be able to answer the following from the product:

- What do we currently believe about this child?
- Which beliefs are approved?
- Why did the system recommend this next step?
- Which sessions support that recommendation?
- What evidence would change the current recommendation?

## Decision Log

- Use relational storage plus summary artifacts first.
- Do not require a graph database in the initial rollout.
- Treat raw session history as immutable event memory.
- Treat child memory as a governed semantic layer.
- Require therapist review for higher-risk inferred memory.
- Prioritize therapist-facing workflow and planner quality before live runtime personalization.

## Exit Criteria For Moving Beyond Phase 1

This section is now historical. Those gates were crossed in implementation.

Before expanding Phase 4 further, keep the following true:

- therapists trust the proposal review flow
- planner outputs demonstrably use approved memory
- recommendation provenance is inspectable
- post-session synthesis latency is acceptable
- approved memory remains consistent with source evidence under review

## Final Recommendation

Implement this as a staged evolution of the current architecture, not as a parallel system rewrite.

The current codebase already has enough persistence and planning structure to support a safe V1. The right path is to add a governed semantic memory layer after session persistence and before planning, then build recommendation and runtime personalization on top of that foundation.