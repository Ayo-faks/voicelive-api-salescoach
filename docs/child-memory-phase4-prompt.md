# Child Memory Phase 4 Execution Prompt

Use this prompt in a new session to execute Phase 4 of the child-memory roadmap, then run the app locally and perform a real browser-based end-to-end check to catch runtime errors.

## Purpose

This prompt is for implementing Phase 4: clinic-level institutional memory in the real repository, not for writing a speculative design.

It is intentionally strict about:

- reading the roadmap and architecture docs first
- inspecting real code paths before editing
- preserving governance boundaries between child memory and institutional memory
- keeping SQLite and Postgres behavior aligned
- validating the finished work with both code-level tests and a local browser walkthrough

## Prompt

```text
You are implementing Phase 4 of the child-memory roadmap in the voicelive-api-salescoach repository.

Repository root:
- /home/ayoola/sen/voicelive-api-salescoach

Read these first before editing anything:
- docs/child-memory-implementation-plan.md
- docs/child-memory-architecture.md
- docs/child-memory-reanalysis-prompt.md

Then inspect the real code paths that are likely to matter, including at minimum:
- backend/src/app.py
- backend/src/services/storage.py
- backend/src/services/storage_postgres.py
- backend/src/services/child_memory_service.py
- backend/src/services/recommendation_service.py
- backend/src/services/planning_service.py
- backend/src/services/websocket_handler.py
- backend/src/services/managers.py
- frontend/src/app/App.tsx
- frontend/src/services/api.ts
- frontend/src/types/index.ts
- the relevant frontend dashboard or recommendation components actually connected to this flow

Do not assume the docs are enough. Trace the real code and only implement what is actually grounded in the repository.

Phase 4 scope from the roadmap:
- build de-identified operational knowledge across reviewed child outcomes
- add cross-child strategy insights
- add reviewed pattern summaries
- add recommendation tuning inputs derived from approved evidence

Mandatory guardrails:
- institutional memory must be de-identified where appropriate
- clinic-level insights must not silently become child-level facts
- child-specific recommendations must still be grounded in that child's approved memory and recent evidence
- preserve therapist trust, inspectability, and review boundaries
- preserve SQLite/Postgres parity where storage behavior is involved
- do not weaken the approved-vs-pending distinction already established in earlier phases
- do not add vague prompt stuffing when a structured contract is possible

Implementation requirements:

1. Reassess the current repository state against Phase 4 before changing code.
2. Identify the minimum integrated implementation that actually delivers Phase 4 value.
3. Prefer explicit structured institutional-memory contracts over hidden prompt text.
4. Keep institutional memory clearly separate from child-level durable memory.
5. Ensure institutional insights are derived only from reviewed or approved evidence, not pending proposals or raw unchecked runtime behavior.
6. Preserve provenance so a therapist can understand where institutional insights came from.
7. If recommendation or planning behavior changes, make the institutional input inspectable in code and, where appropriate, in the therapist-facing surface.
8. Keep changes minimal but complete. Do not drift into unrelated product work.

Your deliverable is not just code edits. You must complete all of the following:

Section A: Grounded implementation
- implement the Phase 4 backend changes
- implement any necessary frontend changes for inspectability or therapist-facing visibility
- add or update focused tests for the new behavior

Section B: Validation
- run the focused backend tests relevant to your changes
- run the focused frontend tests relevant to your changes
- run a frontend build if frontend code changed

Section C: Local run
- build and run the app locally using the repo's actual local path
- prefer the documented local workflow unless the codebase has clearly moved elsewhere
- use these commands unless inspection proves a different local path is now correct:

  1. ./scripts/build.sh
  2. cd backend && python src/app.py

- if local auth or env setup is required, use the repository's existing local-development path rather than introducing new shortcuts in code

Section D: Browser-based end-to-end check
- after the implementation is complete and the app is running locally, run a real browser walkthrough against http://localhost:8000
- use browser automation tools or Playwright-style browser control available in the coding environment; do not stop at unit tests
- at minimum, exercise the therapist flow that touches the new Phase 4 behavior
- inspect browser console errors, failed network requests, broken UI states, and obvious runtime regressions
- if you find issues, fix them and rerun the browser check

The browser walkthrough must verify the following where applicable to the implementation you land:
- institutional memory is visible only in the intended therapist-facing or system-facing places
- institutional insights are de-identified
- institutional insights do not appear as if they are child-specific approved facts
- child-specific recommendations remain grounded in the selected child's approved memory and recent evidence
- no obvious runtime errors occur in the changed flow

Do not end after making code edits. Continue through validation, local run, browser walkthrough, and any fixes required from what you observe.

Output requirements:

1. Start with a short implementation plan grounded in the files you inspected.
2. Then make the code changes.
3. Then show the exact validation you ran.
4. Then summarize the browser walkthrough results.
5. End with:

Section 1: What Phase 4 changed
- concise summary of the real implemented behavior

Section 2: Risks or follow-ups
- any remaining caveats

Section 3: Validation completed
- backend tests run
- frontend tests run
- frontend build run or not run
- local app run
- browser end-to-end walkthrough run

Be precise, skeptical, and architecture-aware. Finish the work end-to-end inside the repository.
```

## Notes

- This prompt assumes there is no committed dedicated end-to-end test suite yet. The required browser check is therefore a real local walkthrough using browser automation tools available in the coding environment.
- If the repository already contains a valid Phase 4 partial implementation, the task is to complete, correct, and validate it rather than rewrite it.
- If the executing session discovers that the documented local run path has changed, it should use the real current path and explain why.
