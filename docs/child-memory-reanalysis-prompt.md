# Child Memory Reanalysis Prompt

Use this prompt in a future session to reassess the codebase against the child memory implementation plan.

## Purpose

This prompt is designed to help a new session reanalyze the repository, compare the actual implementation state to the plan, identify drift or gaps, and recommend the next highest-value steps.

It should be used after changes have landed or when implementation has partially progressed and a fresh architecture review is needed.

## Prompt

```text
You are reviewing the current state of the voicelive-api-salescoach repository against the child memory rollout plan.

Primary reference documents:
- docs/child-memory-architecture.md
- docs/child-memory-implementation-plan.md

Your task is to reanalyze the current codebase and determine:

1. What parts of the child memory plan are already implemented.
2. What parts are partially implemented but inconsistent or incomplete.
3. What planned components are still missing entirely.
4. Whether the current implementation still matches the intended architecture.
5. Whether any new code introduces risks, drift, or contradictions relative to the plan.
6. What the next best implementation step should be.

Review the real code, not just the docs. Ground every conclusion in the repository.

Focus especially on:
- backend storage schema and migrations
- child memory domain models and services
- analyze flow and post-session synthesis hooks
- therapist review APIs for memory proposals
- planner context construction and whether approved memory is read before raw history
- recommendation ranking and explanation logic
- frontend dashboard state and memory review UI
- evidence provenance and auditability
- separation between approved memory and pending proposals
- whether runtime/live-session agents are reading or writing memory unsafely

Constraints:
- Do not assume work is complete just because docs exist.
- Do not assume planner memory is working unless the code path is real and connected.
- Distinguish clearly between implemented, stubbed, partial, unused, and planned-only code.
- Call out any hidden complexity caused by SQLite/Postgres parity, latency in the analyze path, or inconsistent data shapes.

Expected output format:

Section 1: Current implementation status
- implemented
- partially implemented
- missing

Section 2: Architectural drift or risks
- list concrete mismatches between code and plan

Section 3: File-level evidence
- name the most important files and functions involved

Section 4: Recommended next step
- choose the single best next implementation milestone
- explain why it is the best next step now

Section 5: Verification checklist
- list the tests, inspections, and validations needed before proceeding further

Be precise, skeptical, and architecture-aware. Treat this as a senior engineering design review of real implementation state against a previously approved plan.
```

## How To Use It

Recommended workflow for a future session:

1. Read `docs/child-memory-architecture.md`.
2. Read `docs/child-memory-implementation-plan.md`.
3. Inspect the current repository implementation.
4. Compare real code paths to the intended rollout phases.
5. Produce a grounded implementation-status review.

## What A Good Reanalysis Should Catch

A good reanalysis should identify things like:

- schema added but not actually wired into services
- backend APIs added but unused in the frontend
- planner context changed in docs but not in runtime code
- pending proposal states present in storage but not visible in UI
- recommendation explanation claims without provenance links
- runtime personalization added without proper review boundaries
- duplicated logic across SQLite and Postgres with drift

## Review Standard

The review should be considered complete only if it answers:

- What is actually implemented?
- What is still missing?
- What is misleadingly partial?
- What is the next highest-leverage step?
- What are the main technical risks if development continues from the current state?

## Notes

This prompt is intentionally strict. Its purpose is not to produce optimistic status summaries. Its purpose is to force a reality-based architecture review against the agreed plan.