-- SQLite variant for local dev (data/wulo.db).
-- Scope: wipe users + ALL user-generated rows; preserve seed children and ALL content
-- (exercises, listening_eval_items, listening_eval_rewards, app_settings).
--
-- Local schema has NO ACTION on every FK, so order matters. Run as a single
-- transaction so any FK violation rolls back the whole wipe.

PRAGMA foreign_keys = ON;

BEGIN TRANSACTION;

-- chat / insight history (insight_messages cascades from insight_conversations)
DELETE FROM insight_messages;
DELETE FROM insight_conversations;
DELETE FROM institutional_memory_insights;

-- child memory chain (FK to users + children)
DELETE FROM child_memory_evidence_links;
DELETE FROM child_memory_proposals;
DELETE FROM child_memory_items;
DELETE FROM child_memory_summaries;

-- recommendations / practice (FK to users + children)
DELETE FROM recommendation_candidates;
DELETE FROM recommendation_logs;
DELETE FROM practice_plans;

-- sessions (FK to children + exercises) — exercises are preserved
DELETE FROM sessions;

-- consent / reports / audit (FK to users + children)
DELETE FROM progress_reports;
DELETE FROM parental_consents;
DELETE FROM audit_log;
DELETE FROM ui_state_audit;
DELETE FROM child_ui_state;

-- per-user profile/consent
DELETE FROM learner_profiles;
DELETE FROM user_consents;

-- workspace / membership
DELETE FROM user_children;
DELETE FROM workspace_members;
DELETE FROM therapist_invite_codes;

-- invitations (delete email deliveries before parent invitations)
DELETE FROM child_invitation_email_deliveries;
DELETE FROM child_invitations;
DELETE FROM family_intake_invitations;
DELETE FROM child_intake_proposals;

-- per-user activity on content (votes are user-generated; eval items + rewards preserved)
DELETE FROM listening_eval_votes;

-- seeded children currently point at a workspace that belongs to a user we are
-- about to delete; null the link so the workspace row can go away while the
-- seeded children survive
UPDATE children SET workspace_id = NULL
WHERE id IN ('child-ayo', 'child-noah', 'child-zuri');

-- remove non-seeded children (their per-child rows are already wiped above)
DELETE FROM children
WHERE id NOT IN ('child-ayo', 'child-noah', 'child-zuri');

-- now safe to remove orphaned workspaces and the user accounts
DELETE FROM therapist_workspaces;
DELETE FROM users;

COMMIT;

-- verification: user/activity tables should be zero; content tables unchanged
SELECT 'users'                       AS table_name, COUNT(*) AS rows FROM users
UNION ALL SELECT 'children (kept seeds)',          COUNT(*) FROM children
UNION ALL SELECT 'sessions',                       COUNT(*) FROM sessions
UNION ALL SELECT 'child_memory_items',             COUNT(*) FROM child_memory_items
UNION ALL SELECT 'insight_conversations',          COUNT(*) FROM insight_conversations
UNION ALL SELECT 'audit_log',                      COUNT(*) FROM audit_log
UNION ALL SELECT '--- content (must be unchanged) ---', 0
UNION ALL SELECT 'exercises',                      COUNT(*) FROM exercises
UNION ALL SELECT 'listening_eval_items',           COUNT(*) FROM listening_eval_items
UNION ALL SELECT 'listening_eval_rewards',         COUNT(*) FROM listening_eval_rewards
UNION ALL SELECT 'app_settings',                   COUNT(*) FROM app_settings;
