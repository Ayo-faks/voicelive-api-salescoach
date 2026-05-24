# Pathfinder Learn Demo / Pilot Script

Use this path for a stakeholder walkthrough after the backend is running with `DATABASE_BACKEND=postgres` in the target environment.

1. Open the teacher workspace at `/teacher`.
2. Select a learner mastery cell in the heatmap, for example Tobi A. / Ratio.
3. In the student profile drawer, review skill mastery, recent responses, and recent mastery events.
4. Choose `Override mastery`, adjust probability or uncertainty, enter a short evidence-backed reason, and save the override.
5. In `Plan an intervention`, submit a teacher request such as `Create a short ratio reteach plan for students below 60% mastery`.
6. In `Pending teacher approval`, choose `Edit plan`, tighten the target skills or rationale, enter the approval reason, then choose `Save edits and approve`.
7. Confirm the audit event list shows the profile view, override, pending plan, and edited approval activity.
8. Open `/api/learning/audit` and `/api/learning/metrics` to show the backend trace: approval decision counters and xAPI emission counters should have moved.

Acceptance notes:

- The learner diagnostic path starts from `/home` with `Start today's check-in`; completion should create a pending teacher plan.
- The demo should feel fast enough for a live walkthrough: no manual page refresh should be required after approval or edit-approve, and the audit list should update within the dashboard polling window.
- For Postgres/RLS validation, run `backend/scripts/verify_learning_postgres_rls.py --json` against the runtime database before relying on the demo for pilot acceptance.