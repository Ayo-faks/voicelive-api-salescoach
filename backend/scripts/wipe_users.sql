-- Wipe all USERS and their user-generated rows from the wulo Postgres database.
-- Preserves ALL seeded content/reference data:
--   * seed demo children (child-ayo, child-noah, child-zuri) and everything keyed off them
--   * exercises (both seeded and custom — user said "no content removed")
--   * learning_classes / learning_students / learning_cohorts catalogue
--     (learning_teachers is per-user and is wiped in step 2)
--   * learning_skills / learning_standards / learning_diagnostic_items
--   * learning_content_pack_manifests / app_settings
--   * listening_eval_items / listening_eval_rewards
--
-- Wrap callers in BEGIN/COMMIT (driver script handles that). Designed to run inside
-- a single transaction with ON_ERROR_STOP so any FK violation aborts cleanly.

-- 1. Bypass RLS for this session (admin/wuloadmin)
SELECT set_config('app.system_bypass_rls', 'on', false);

-- 2. Pre-delete tables whose FK -> users / children has no ON DELETE CASCADE.
--    These would block DELETE FROM users otherwise. therapist_workspaces is
--    deferred until after children are dealt with (see step 5b/6) because
--    children.workspace_id references it.
DELETE FROM therapist_invite_codes;
DELETE FROM institutional_memory_insights;
DELETE FROM child_invitation_email_deliveries;
DELETE FROM child_invitations;
DELETE FROM family_intake_invitation_email_deliveries;
DELETE FROM family_intake_invitations;
DELETE FROM child_intake_proposals;
DELETE FROM learner_memory_consent;
-- audit_log, ui_state, progress, parental_consents and per-user catalogue rows
-- all hold user_id / child_id FKs with NO ACTION and must be cleared first.
DELETE FROM audit_log;
DELETE FROM ui_state_audit;
DELETE FROM child_ui_state;
DELETE FROM parental_consents;
DELETE FROM progress_reports;
DELETE FROM recommendation_logs;
DELETE FROM child_memory_proposals;
DELETE FROM child_memory_evidence_links;
DELETE FROM child_memory_summaries;
DELETE FROM child_memory_items;
DELETE FROM practice_plans;
DELETE FROM sessions;
DELETE FROM user_children;
-- learning_teachers maps real app users -> teacher records; once users are gone
-- the rows are dangling, so drop them. learning_students/classes/cohorts are
-- preserved as catalogue.
DELETE FROM learning_teachers;

-- 3. User-generated learning rows (per-tenant, RLS-protected, not seeded).
--    Done before user delete because some carry a created_by_user_id FK.
DELETE FROM learning_student_fact_decisions;
DELETE FROM learning_student_facts;
DELETE FROM learning_xapi_statements;
DELETE FROM learning_approvals;
DELETE FROM learning_intervention_plans;
DELETE FROM learning_mastery_events;
DELETE FROM learning_student_responses;
DELETE FROM listening_eval_votes;
DELETE FROM learning_offline_queue;

-- 4. Children & workspaces must go BEFORE users because
--    therapist_workspaces.owner_user_id and children.workspace_id are both
--    NO ACTION FKs back to users / therapist_workspaces.
--    Null the seed children's workspace_id so deleting therapist_workspaces
--    doesn't try to cascade through them.
UPDATE children SET workspace_id = NULL
WHERE id IN ('child-ayo', 'child-noah', 'child-zuri');

DELETE FROM children
WHERE id NOT IN ('child-ayo', 'child-noah', 'child-zuri');

DELETE FROM therapist_workspaces;

-- 5. Delete users. Remaining FKs (workspace_members, learner_profiles,
--    user_consents, learning_push_subscriptions, learning_revision_cards,
--    insight_conversations -> insight_messages, user_children) cascade.
--    Local dev user 'dev-therapist-001' is also wiped — LOCAL_DEV_AUTH recreates
--    it on the next /api/auth/session call.
DELETE FROM users;

-- 6. Verification: user-data tables should be 0; seed/content tables unchanged.
SELECT 'users'                       AS table_name, COUNT(*) AS rows FROM users
UNION ALL SELECT 'children (kept seeded)',          COUNT(*) FROM children
UNION ALL SELECT 'sessions',                        COUNT(*) FROM sessions
UNION ALL SELECT 'learner_profiles',                COUNT(*) FROM learner_profiles
UNION ALL SELECT 'learning_student_responses',      COUNT(*) FROM learning_student_responses
UNION ALL SELECT 'learning_mastery_events',         COUNT(*) FROM learning_mastery_events
UNION ALL SELECT 'learning_intervention_plans',     COUNT(*) FROM learning_intervention_plans
UNION ALL SELECT 'listening_eval_votes',            COUNT(*) FROM listening_eval_votes
UNION ALL SELECT '--- seed/content (must be unchanged) ---', 0
UNION ALL SELECT 'exercises',                       COUNT(*) FROM exercises
UNION ALL SELECT 'learning_skills',                 COUNT(*) FROM learning_skills
UNION ALL SELECT 'learning_standards',              COUNT(*) FROM learning_standards
UNION ALL SELECT 'learning_diagnostic_items',       COUNT(*) FROM learning_diagnostic_items
UNION ALL SELECT 'learning_classes',                COUNT(*) FROM learning_classes
UNION ALL SELECT 'learning_teachers',               COUNT(*) FROM learning_teachers
UNION ALL SELECT 'learning_students',               COUNT(*) FROM learning_students
UNION ALL SELECT 'learning_content_pack_manifests', COUNT(*) FROM learning_content_pack_manifests
UNION ALL SELECT 'listening_eval_items',            COUNT(*) FROM listening_eval_items
UNION ALL SELECT 'listening_eval_rewards',          COUNT(*) FROM listening_eval_rewards
UNION ALL SELECT 'app_settings',                    COUNT(*) FROM app_settings
ORDER BY 1;
