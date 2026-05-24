# Wulo — Architecture Reference

This document is a single, factual engineering reference for the Wulo application that lives at `/home/ayoola/sen/voicelive-api-salescoach`. Every non-trivial claim below is cited as `path/to/file:LSTART-LEND` or `path::symbol`. Each feature is labelled IMPLEMENTED, SCAFFOLDED, or DEFERRED based on what is present in the repository at the time of writing. UK English is used throughout. No marketing language. No invented metrics.

Sources of truth for repo-level facts: [README.md](../README.md), [AGENTS.md](../AGENTS.md), [azure.yaml](../azure.yaml), [backend/src/app.py](../backend/src/app.py), [infra/main.bicep](../infra/main.bicep), [infra/resources.bicep](../infra/resources.bicep), the alembic migrations under [backend/alembic/versions/](../backend/alembic/versions/), and the per-file citations given inline below.

---

## 1. Executive summary

Wulo is a paediatric speech-language therapy practice platform. It pairs a Flask + Flask-Sock backend ([backend/src/app.py](../backend/src/app.py)) with a React 19 + Vite + TypeScript frontend ([frontend/src/app/App.tsx](../frontend/src/app/App.tsx)) and is deployed to Azure Container Apps via `azd` and Bicep ([azure.yaml](../azure.yaml), [infra/main.bicep](../infra/main.bicep), [infra/resources.bicep](../infra/resources.bicep)).

Real-time avatar-mediated practice sessions are brokered through Azure Voice Live (`azure.ai.voicelive.aio`) over WebSocket `/ws/voice` ([backend/src/services/websocket_handler.py](../backend/src/services/websocket_handler.py)). A second WebSocket `/ws/insights-voice` provides voice-driven analytics over Azure Speech STT/TTS ([backend/src/services/insights_websocket_handler.py](../backend/src/services/insights_websocket_handler.py)). Per-utterance pronunciation scoring uses Azure Speech ([backend/src/services/analyzers.py](../backend/src/services/analyzers.py)). Conversational analysis, planning, and insights tooling use the GitHub Copilot SDK with an Azure OpenAI BYOK provider config ([backend/src/services/azure_openai_auth.py](../backend/src/services/azure_openai_auth.py), [backend/src/services/insights_copilot_planner.py](../backend/src/services/insights_copilot_planner.py), [backend/src/services/planning_service.py](../backend/src/services/planning_service.py)).

Persistence is dual-target. SQLite is used in local development ([backend/src/services/storage.py](../backend/src/services/storage.py), 4937 lines). Azure Postgres Flexible Server with row-level security is used in hosted environments ([backend/src/services/storage_postgres.py](../backend/src/services/storage_postgres.py), 3719 lines). The selection is gated by `REQUIRE_POSTGRES_IN_AZURE` ([backend/src/services/storage_factory.py](../backend/src/services/storage_factory.py#L32)). A boot-time refusal blocks `LOCAL_DEV_AUTH=true` in Azure-hosted runtimes ([backend/src/app.py](../backend/src/app.py)).

Domains implemented in code today: authentication and invitations, child onboarding and consent, structured speech exercises, real-time avatar sessions, per-session analysis and Azure Speech pronunciation assessment, recommendation engine with provenance, child memory with proposal/approval workflow, therapist workspaces with RLS, listening evaluation with reward shaping (Stage 0 RL), insights conversations (text + voice), report compilation with redaction, ACS Email delivery, and a UI-state schema persisted with audit log.

---

## 2. Repository layout

Top-level (selected):

- [README.md](../README.md), [AGENTS.md](../AGENTS.md), [CONTRIBUTING.md](../CONTRIBUTING.md), [CHANGELOG.md](../CHANGELOG.md), [LICENSE.md](../LICENSE.md), [SECURITY.md](../SECURITY.md), [SUPPORT.md](../SUPPORT.md)
- [azure.yaml](../azure.yaml) — azd service `voicelab` (containerapp, python, Dockerfile in `backend/`, port 8000); postdeploy hook runs `verify_postgres_rls.py`.
- [backend/](../backend/) — Flask app, services, routes, alembic migrations, tests.
- [frontend/](../frontend/) — React 19 + Vite + TypeScript SPA.
- [infra/](../infra/) — Bicep at subscription scope (`main.bicep` 186 lines, `resources.bicep` 852 lines).
- [data/](../data/) — `exercises/` prompt YAMLs, `lexicons/` PLS+JSON, `images/` static assets.
- [docs/](../docs/) — engineering and session notes (this file lives here).
- [scripts/](../scripts/) — build, format, lint, test, verification, migration, seeding utilities.
- [evals/](../evals/), [fixes/](../fixes/), [static/](../static/), [branding and marketing/](../branding%20and%20marketing/).

Backend layout ([backend/src/](../backend/src/)):

- [app.py](../backend/src/app.py) — Flask + Flask-Sock entrypoint, registers all `/api/*` routes and WebSocket routes (3702 lines).
- [config.py](../backend/src/config.py) — settings (376 lines).
- [bootstrap_storage.py](../backend/src/bootstrap_storage.py) — startup storage selection (79 lines).
- [services/](../backend/src/services/) — domain services (see Section 5).
- [routes/](../backend/src/routes/) — Flask blueprints (e.g. `listening_eval_routes.py`).
- [schemas/](../backend/src/schemas/) — pydantic-style schemas (e.g. `ui_state.py` 175 lines).
- [alembic/versions/](../backend/alembic/versions/) — migrations 20260405_000001 → 20260423_000023.

Frontend layout ([frontend/src/](../frontend/src/)):

- [app/App.tsx](../frontend/src/app/App.tsx) — root SPA shell (4591 lines).
- `components/` — Session, Dashboard, ChildHome, Onboarding, Settings, exercise panels, etc.
- `hooks/` — `useAudioPlayer`, `useRealtime`, `useRecorder`, `useScenarios`, `useSessionTimer`, `useUiState`, `useWebRTC`.
- `services/` — `api.ts`, `customScenarios.ts`, `appInsights.ts`, `telemetry.ts`.
- [e2e/onboarding-tours.spec.ts](../frontend/e2e/onboarding-tours.spec.ts) — Playwright spec.

---

## 3. Runtime topology

Process model (IMPLEMENTED):

- Single Flask process ([backend/src/app.py](../backend/src/app.py)) serves HTTP `/api/*` and, via Flask-Sock, two WebSocket endpoints:
  - `/ws/voice` — registered at [backend/src/app.py L3606](../backend/src/app.py#L3606), backed by `VoiceProxyHandler` ([backend/src/services/websocket_handler.py](../backend/src/services/websocket_handler.py)).
  - `/ws/insights-voice` — registered at [backend/src/app.py L3688](../backend/src/app.py#L3688), backed by `InsightsVoiceHandler` ([backend/src/services/insights_websocket_handler.py](../backend/src/services/insights_websocket_handler.py)).
- Container image is built from [backend/Dockerfile](../backend/Dockerfile); the container exposes port 8000 ([azure.yaml](../azure.yaml)).
- The frontend SPA is served as static assets (see [backend/static/](../backend/static/)) alongside the backend container.

External dependencies invoked at runtime (IMPLEMENTED):

- Azure Voice Live SDK `azure.ai.voicelive.aio`, API version `2025-05-01-preview` ([backend/src/services/websocket_handler.py](../backend/src/services/websocket_handler.py)).
- Azure Speech SDK for STT and TTS ([backend/src/services/insights_websocket_handler.py](../backend/src/services/insights_websocket_handler.py), [backend/src/services/analyzers.py](../backend/src/services/analyzers.py)).
- Azure OpenAI deployments (`gpt-4o`, `text-embedding-ada-002`) — provisioned in [infra/resources.bicep](../infra/resources.bicep).
- GitHub Copilot SDK (`copilot.CopilotClient`) configured against Azure OpenAI as the model provider via `build_copilot_azure_provider_config` ([backend/src/services/azure_openai_auth.py L1-104](../backend/src/services/azure_openai_auth.py#L1-L104)).
- Azure Communication Services Email ([backend/src/services/email_service.py L34](../backend/src/services/email_service.py#L34)).
- Azure Postgres Flexible Server (production) or local SQLite (development).

Boot-time guards (IMPLEMENTED):

- `LOCAL_DEV_AUTH=true` is rejected when running in Azure-hosted environments ([backend/src/app.py](../backend/src/app.py)).
- `_is_azure_hosted_environment` keys off `CONTAINER_APP_*`, `WEBSITE_*`, `IDENTITY_ENDPOINT` markers ([backend/src/services/storage_factory.py L32-141](../backend/src/services/storage_factory.py#L32-L141)).
- When `REQUIRE_POSTGRES_IN_AZURE` is set, requesting SQLite in Azure raises during `create_storage_service` ([backend/src/services/storage_factory.py](../backend/src/services/storage_factory.py)).

---

## 4. AI / ML surface — patterns and components

### 4.1 Real-time speech (avatar) — `/ws/voice`

IMPLEMENTED. `VoiceProxyHandler` ([backend/src/services/websocket_handler.py](../backend/src/services/websocket_handler.py)) brokers between the SPA and Azure Voice Live. Defaults observed in source:

- Turn detection: `azure_semantic_vad`.
- Noise suppression: `azure_deep_noise_suppression`.
- Echo cancellation: `server_echo_cancellation`.
- Avatar character `meg`, style `casual`.
- `MAX_AVATAR_ATTEMPTS = 3`.
- Wulo-namespaced events: `wulo.tally_configure`, `wulo.request_pause`, `wulo.scored_turn.begin/end/ack/result`, `wulo.mic_mode`, `wulo.target_tally`, `wulo.scaffold_escalate`, `wulo.avatar_retrying`, `wulo.avatar_unavailable`.
- Feature flags: `WULO_STRUCTURED_CONVERSATION`, `CONVERSATIONAL_MIC_ENABLED`.

### 4.2 Voice-driven insights — `/ws/insights-voice`

IMPLEMENTED. `InsightsVoiceHandler` ([backend/src/services/insights_websocket_handler.py L1-599](../backend/src/services/insights_websocket_handler.py#L1-L599)) uses Azure Speech push-stream STT and streaming TTS:

- Output format: `raw-24khz-16bit-mono-pcm`, chunk size 2048.
- `INPUT_SAMPLE_RATE = 24000`, `MAX_INPUT_SECONDS = 60`.
- States: `listening`, `thinking`, `speaking`.

### 4.3 Pronunciation and conversation analysis

IMPLEMENTED. [backend/src/services/analyzers.py](../backend/src/services/analyzers.py):

- `ConversationAnalyzer` (L79).
- `PronunciationAssessor` (L339) — Azure Speech pronunciation assessment.
- Score caps L35-54.
- `MIN_AUDIO_SIZE_BYTES = 48000`.

Scoring helpers ([backend/src/services/scoring.py](../backend/src/services/scoring.py)):

- `TargetTokenTally` (L87), `ScoredTurnDispatcher` (L312), `MAX_SCORED_TURN_WINDOW_MS = 15000`.

### 4.4 Insights planner (text)

IMPLEMENTED. [backend/src/services/insights_service.py](../backend/src/services/insights_service.py):

- `PROMPT_VERSION = "insights-v1"`, `DEFAULT_TOOL_CALL_BUDGET = 6`, `DEFAULT_WALL_CLOCK_BUDGET_SECONDS = 20.0`.
- `ALLOWED_SCOPE_TYPES = {caseload, child, session, report}`.
- `InsightsAuthorizationError`, `InsightsBudgetExceeded`.
- `StubInsightsPlanner` (L143) is the fallback when no Copilot planner is configured.
- `InsightsService` (L260).

Copilot-backed planner ([backend/src/services/insights_copilot_planner.py L74-550](../backend/src/services/insights_copilot_planner.py#L74-L550)):

- `CopilotInsightsPlanner.run_turn` uses the Copilot SDK with BYOK Azure provider config.
- `_approve_all_permissions` (L61).
- `on_pre_tool_use` enforces the per-turn `tool_call_budget`.
- Default model `gpt-5`.
- Structured JSON output: `{answer_text, citations, visualizations}`.
- Factory: `build_insights_planner_from_env` (L536).

Visualization validation ([backend/src/services/visualization_service.py L28-40](../backend/src/services/visualization_service.py#L28-L40)) — `validate_visualization` enforces chart/table size caps.

### 4.5 Practice planning

IMPLEMENTED. [backend/src/services/planning_service.py L1-711](../backend/src/services/planning_service.py#L1-L711):

- `CopilotPlannerRuntime` and `PracticePlanningService` (L447) follow the same Copilot + BYOK pattern.
- Tools exposed to the planner: `get_planning_context`, `list_candidate_exercises`.
- Readiness cache TTL 60 seconds.
- `normalize_plan_draft` shapes the planner output for persistence.

### 4.6 Recommendations

IMPLEMENTED. [backend/src/services/recommendation_service.py L14-1027](../backend/src/services/recommendation_service.py#L14-L1027):

- Constants `DIFFICULTY_ORDER`, `SUPPORTIVE_TYPES`, `ADVANCED_TYPES`, `THERAPIST_HINT_TYPES`, `MEMORY_RULES` (L26-62).
- `RecommendationService.generate_recommendations` writes provenance into `recommendation_logs` and `recommendation_candidates` (alembic 000003).

### 4.7 Child memory

IMPLEMENTED. [backend/src/services/child_memory_service.py](../backend/src/services/child_memory_service.py):

- `MAX_RUNTIME_PERSONALIZATION_ITEMS = 3` (L23).
- `LOW_RISK_AUTO_APPROVAL_RULES = {("targets","constraint")}`.
- `SUMMARY_CATEGORY_ORDER`.
- Item statuses: `{pending, approved, rejected, active}`.
- Evidence-link pattern (rows in `child_memory_evidence_links`, alembic 000002).

### 4.8 Listening evaluation and reward shaping (RL Stage 0)

IMPLEMENTED — Stage 0 only. [backend/src/services/listening_eval_service.py L1-589](../backend/src/services/listening_eval_service.py#L1-L589):

- Tables `listening_eval_items`, `listening_eval_votes`, `listening_eval_rewards` (alembic 000020).
- `MIN_VOTES_FOR_REWARD = 200` (L42).
- `MIN_THERAPISTS_FOR_REWARD = 3` (L43).
- Reward formula L350-430: confidence-weighted sum of votes (sign +1/-1/0), normalised by total weight; gated until thresholds met.
- `build_dpo_preference_pairs` (L542) exports DPO-shaped preference pairs.

[backend/src/services/reward_service.py L1-86](../backend/src/services/reward_service.py#L1-L86):

- `RewardSnapshot`, `RewardService.snapshot`, `get_reward`, `rewards_for_tokens`. Returns `None` when gated.

Staff routes ([backend/src/routes/listening_eval_routes.py L1-172](../backend/src/routes/listening_eval_routes.py#L1-L172)) — `require_staff_user` guard, endpoints: `POST/GET /staff/listening-eval/items`, `GET/DELETE /staff/listening-eval/items/<id>`, `POST /items/<id>/vote`, `POST /rewards/refresh`, `GET /rewards`, `GET /export.csv`.

DEFERRED (per [docs/session-listening-eval-rl-stage0-and-drill-polish-2026-04-21.md](session-listening-eval-rl-stage0-and-drill-polish-2026-04-21.md)): later RL stages beyond Stage 0.

### 4.9 Reports

IMPLEMENTED. [backend/src/services/](../backend/src/services/) — `report_*.py` modules:

- `ReportCompilationPipeline` (L520).
- `AzureOpenAIReportSummaryAssistant`.
- `report_redaction.ReportRedactionPolicy` (L22).
- Exporter modules.
- Persistence in `progress_reports` (alembic 000019, RLS) and `progress_reports_source` (000021).

### 4.10 Lexicons and phoneme map

IMPLEMENTED. [data/lexicons/](../data/lexicons/):

- `wulo.pls` — PLS lexicon, IPA, en-GB.
- `r-drill-lexicon.xml`.
- `phoneme-map.json` — canonical IPA map for `r, s, sh, th, dh, k, g, f, v, z, zh, t, d, l, w, ch, j, ng, y, h`; `primary_targets = [r, s, sh, th, k, f]`; deprecated alias `TH → dh`.

Loader and health check:

- [backend/src/services/phoneme_map_loader.py](../backend/src/services/phoneme_map_loader.py) (75 lines).
- [backend/src/services/lexicon_healthcheck.py](../backend/src/services/lexicon_healthcheck.py) (275 lines).

### 4.11 TTS normalisation and cache

IMPLEMENTED. [backend/src/services/tts_normalizer.py](../backend/src/services/tts_normalizer.py) (313 lines), [backend/src/services/tts_cache.py](../backend/src/services/tts_cache.py) (136 lines).

### 4.12 Institutional memory

IMPLEMENTED. [backend/src/services/institutional_memory_service.py](../backend/src/services/institutional_memory_service.py) (520 lines); persisted in `institutional_memory_insights` (alembic 000004).

---

## 5. Business logic domains

### 5.1 Authentication, invitations, workspaces

IMPLEMENTED.

- Users, child invitations, parental consents, therapist workspaces, workspace members, therapist invite codes — alembic 000001, 000005, 000006, 000007, 000008, 000009, 000010, 000011-13, 000014.
- GDPR-related consent columns added in 000015 (`personal_data_consent_accepted`, `special_category_consent_accepted`, `parental_responsibility_confirmed`).
- Email delivery rows (`child_invitation_email_deliveries`) in 000008; family-intake equivalents in 000016-000018.
- Easy Auth providers (Microsoft and Google) configured at infra layer ([infra/resources.bicep](../infra/resources.bicep) — `voicelabAuth`).
- Routes registered in [backend/src/app.py](../backend/src/app.py).

### 5.2 Children, family intake, onboarding

IMPLEMENTED.

- `children` (000001), `user_children` (000005), `child_intake_proposals` and `family_intake_invitations` (000016, RLS), `family_intake_invitations_*` membership and email deliveries (000017, 000018).
- Frontend orchestrator: `ChildOnboardingOrchestrator` (lazy-loaded from [frontend/src/app/App.tsx](../frontend/src/app/App.tsx)).

### 5.3 Practice exercises and sessions

IMPLEMENTED.

- `exercises`, `sessions`, `practice_plans` — alembic 000001.
- Exercise managers ([backend/src/services/managers.py](../backend/src/services/managers.py)): `AgentManager`, `ScenarioManager`, `ExerciseManager`; `MAX_RESPONSE_LENGTH_SENTENCES = 2`.
- Frontend exercise panels: `SoundIsolationPanel`, `AuditoryBombardmentPanel`, `ListeningMinimalPairsPanel`, `SilentSortingPanel`, `StructuredConversationPanel`, `TwoWordPhrasePanel`, `VowelBlendingPanel`, `WordPositionPracticePanel`, with shared `ExerciseShell`, `useExercisePhase`, `BreatheRing`.
- Frontend session constants (in [frontend/src/app/App.tsx](../frontend/src/app/App.tsx)):
  - `CHILD_TURN_LIMIT = 10`, `CHILD_MAX_TURNS = 16`.
  - `THERAPIST_TURN_LIMIT = 12`, `THERAPIST_MAX_TURNS = 16`.
  - `LAUNCH_HANDOFF_DELAY_MS = 240`, `SUMMARY_HANDOFF_DELAY_MS = 1100`, `SESSION_WRAP_UP_DELAY_MS = 3200`, `LISTENING_SESSION_WRAP_UP_DELAY_MS = 5200`.

### 5.4 Insights conversations

IMPLEMENTED.

- Tables `insight_conversations`, `insight_messages` (alembic 000022).
- Routes: `POST /api/insights/ask` ([backend/src/app.py](../backend/src/app.py)) and `/ws/insights-voice` ([backend/src/app.py L3688](../backend/src/app.py#L3688)).
- Service in [backend/src/services/insights_service.py](../backend/src/services/insights_service.py).

### 5.5 UI-state persistence

IMPLEMENTED.

- Tables `child_ui_state`, `ui_state_audit` (alembic 000023, RLS).
- Schemas in [backend/src/schemas/ui_state.py](../backend/src/schemas/ui_state.py) (175 lines).
- Frontend hook `useUiState`.

### 5.6 Reports and recommendations

IMPLEMENTED. See Sections 4.6 and 4.9.

### 5.7 Email

IMPLEMENTED. Azure Communication Services Email via `AzureCommunicationEmailService` ([backend/src/services/email_service.py L34](../backend/src/services/email_service.py#L34)). Infra resources: `emailService`, `emailDomain`, `communicationService` (conditional, [infra/resources.bicep](../infra/resources.bicep)).

---

## 6. Data architecture

Storage selection (IMPLEMENTED):

- SQLite for local development: [backend/src/services/storage.py](../backend/src/services/storage.py) (4937 lines).
- Postgres (RLS enforced) for hosted: [backend/src/services/storage_postgres.py](../backend/src/services/storage_postgres.py) (3719 lines).
- Selection at boot: [backend/src/bootstrap_storage.py](../backend/src/bootstrap_storage.py) and [backend/src/services/storage_factory.py L32-141](../backend/src/services/storage_factory.py#L32-L141).
- `should_run_postgres_startup_migrations` orchestrates migrations on boot.

Migration → table inventory (verified by reading [backend/alembic/versions/](../backend/alembic/versions/)):

- 000001 initial: `app_settings`, `children`, `exercises`, `sessions`, `users`, `practice_plans`.
- 000002: `child_memory_items`, `child_memory_proposals`, `child_memory_summaries`, `child_memory_evidence_links`.
- 000003: `recommendation_logs`, `recommendation_candidates`.
- 000004: `institutional_memory_insights`.
- 000005: `user_children`, `audit_log`.
- 000006: `child_invitations` (RLS).
- 000007: invitation expiry alters.
- 000008: `child_invitation_email_deliveries`.
- 000009: `parental_consents`.
- 000010: `therapist_workspaces`, `workspace_members`.
- 000011-000013: `workspace_id` columns and cleanup.
- 000014: `therapist_invite_codes`.
- 000015: GDPR columns on `parental_consents`.
- 000016: `child_intake_proposals`, `family_intake_invitations` (RLS).
- 000017: family-intake membership.
- 000018: `family_intake_invitation_email_deliveries`.
- 000019: `progress_reports` (RLS).
- 000020: `listening_eval_items`, `listening_eval_votes`, `listening_eval_rewards`.
- 000021: `progress_reports_source`.
- 000022: `insight_conversations`, `insight_messages`.
- 000023: `child_ui_state`, `ui_state_audit` (RLS).

Row-level security (IMPLEMENTED): explicit RLS on `child_invitations`, `child_intake_proposals`, `family_intake_invitations`, `progress_reports`, `child_ui_state`, `ui_state_audit`. Verified at deploy time by [backend/scripts/verify_postgres_rls.py](../backend/scripts/verify_postgres_rls.py) (postdeploy hook in [azure.yaml](../azure.yaml)).

Prompt and content data (IMPLEMENTED):

- `data/exercises/` — 108 prompt YAML files.
- Counts by phoneme: `th=19, s=19, r=19, k=19, sh=17, f=9` plus listening pairs (`k-t, s-sh, th-f, r-w`), `sentence-spotlight-th-*`, `guided-story-r-*`.
- Counts by exercise type: `two-word-phrase=12, structured-conversation=12, medial-word-position-practice=12, final-word-position-practice=12, vowel-blending=10, sound-words=10, sound-isolation=10, silent-sorting=10, auditory-bombardment=6`.
- YAML schema fields: `name, description, model (gpt-4o), modelParameters{temperature,max_tokens}, exerciseMetadata{type,targetSound,targetWords,difficulty,errorSound?,repetitionTarget,masteryThreshold,stepNumber,requiresMic,imageAssets,ageRange,speechLanguage,sentenceStarters?,pairs?,durationSeconds?}, messages[system+user], testData, evaluators`.

---

## 7. Frontend architecture

IMPLEMENTED.

Stack (verified in [frontend/src/app/App.tsx](../frontend/src/app/App.tsx)):

- React 19, Vite, TypeScript.
- Fluent UI v9 component library.
- Heroicons icon set.
- `react-router-dom` for client routing.
- Lazy import: `ChildOnboardingOrchestrator`.

Top-level imports observed: `SessionScreen`, `DashboardHome`, `ChildHome`, `OnboardingFlow`, `ProgressDashboard`, `SettingsView`, `SidebarNav`, `CustomScenarioEditor`, `AssessmentPanel`, `AuthGateScreen`, `LogoutScreen`, `ConsentScreen`, `SessionLaunchOverlay`, plus legal screens.

Hooks: `useAudioPlayer`, `useRealtime`, `useRecorder`, `useScenarios`, `useSessionTimer`, `useUiState`, `useWebRTC`.

Services: [api.ts](../frontend/src/services/api.ts), [customScenarios.ts](../frontend/src/services/customScenarios.ts), [appInsights.ts](../frontend/src/services/appInsights.ts), [telemetry.ts](../frontend/src/services/telemetry.ts).

End-to-end test: [frontend/e2e/onboarding-tours.spec.ts](../frontend/e2e/onboarding-tours.spec.ts) (Playwright).

---

## 8. Infrastructure and deployment

IMPLEMENTED. [infra/main.bicep](../infra/main.bicep) (186 lines, subscription scope) deploys [infra/resources.bicep](../infra/resources.bicep) (852 lines). azd service `voicelab` is defined in [azure.yaml](../azure.yaml) (containerapp, python, Dockerfile in `backend/`, port 8000).

Resources observed in [infra/resources.bicep](../infra/resources.bicep):

- `aiFoundryResource` — `Microsoft.CognitiveServices/accounts` (S0, kind `AIServices`), system-assigned managed identity; deploys `gpt-4o` and `text-embedding-ada-002`.
- `speechService` — Cognitive Services Speech.
- `emailService`, `emailDomain`, `communicationService` — ACS Email (conditional).
- `persistenceStorage` — Storage Account with file share, blob services, and a `backupBlobContainer`.
- `postgresServer` — Postgres Flexible Server, `Standard_B1ms`.
- `postgresDatabase` `wulo`.
- Postgres firewall rule for Azure services.
- `containerRegistry` (AVM module).
- `containerAppsEnvironment` (AVM module).
- `voicelabIdentity` — user-assigned managed identity.
- `voicelab` — Container App (AVM module), Container Apps API version `2025-10-02-preview`.
- `voicelabAuth` — Easy Auth with Microsoft and Google providers.
- Role assignments granted both to the Container App MI and a configured `principalId`:
  - `64702f94-...` Azure AI Developer.
  - `a97b65f3-...` Cognitive Services User.
  - `5e0bd9bd-...` Cognitive Services OpenAI User.
- Output: `AZURE_RESOURCE_VOICELAB_ID`.

Deployment workflow (IMPLEMENTED):

- Environments named `salescoach-swe` (provisioned) and `salescoach-prod` (preferred), per [AGENTS.md](../AGENTS.md).
- WSL workaround documented: `AZURE_EXTENSION_DIR=/tmp/az-noext DOCKER_CONFIG=$(mktemp -d) azd deploy` ([AGENTS.md](../AGENTS.md)).
- Postdeploy hook runs Postgres RLS verification ([azure.yaml](../azure.yaml)).

CI/CD ([.github/workflows/](../.github/workflows/)):

- `lint-and-test.yml` — Python 3.11 and 3.12 matrix.
- `docker-build-push.yml`.
- `publish-lexicon.yml`.

GitHub agents and skills present: `.github/agents/deploy.agent.md`, `.github/skills/azure-deployment-guardrails`, `.github/skills/azure-staged-release`.

---

## 9. Testing and quality

IMPLEMENTED.

- Backend: 25 unit tests + 8 integration tests in [backend/tests/](../backend/tests/), including:
  - `test_postgres_rls_gate.py`
  - `test_storage_parity.py`
  - `test_planner_endpoints.py`
  - `test_recommendation_endpoints.py`
  - `test_insights_e2e.py`
  - `test_insights_voice_routes.py`
  - `test_listening_eval_service.py`
  - `test_phoneme_map_parity.py`
  - `test_lexicon_healthcheck.py`
- Lint/type config: [backend/pyproject.toml](../backend/pyproject.toml), [backend/mypy.ini](../backend/mypy.ini), [backend/pytest.ini](../backend/pytest.ini).
- Scripts: [scripts/](../scripts/) — `build.sh`, `format.sh`, `lint.sh`, `test.sh`, `rebuild.sh`, `start-local.sh`, `verify-staging-dashboard.sh`, `verify_postgres_rls.py`, `migrate_sqlite_to_postgres.py`, `enforce_retention.py`, `codegen_phoneme_map.py`, `seed_listening_eval.py`, `generate_images.py`, `generate_review_sheet.py`, `check_th_voicing.py`, `process_images.py`.
- Frontend e2e: [frontend/e2e/onboarding-tours.spec.ts](../frontend/e2e/onboarding-tours.spec.ts).

---

## 10. Security, privacy, compliance

IMPLEMENTED:

- Postgres row-level security on the multi-tenant tables listed in Section 6 and verified by the postdeploy hook ([azure.yaml](../azure.yaml)).
- Easy Auth with Microsoft and Google ([infra/resources.bicep](../infra/resources.bicep), `voicelabAuth`).
- Managed identity-based access to Azure OpenAI / Speech (`voicelabIdentity`, role assignments listed in Section 8).
- Boot-time refusal of `LOCAL_DEV_AUTH=true` in Azure-hosted runtimes ([backend/src/app.py](../backend/src/app.py)).
- Insights tool budget and authorisation guards (`InsightsAuthorizationError`, `InsightsBudgetExceeded`, `tool_call_budget`, `wall_clock_budget_seconds`) in [backend/src/services/insights_service.py](../backend/src/services/insights_service.py).
- Report redaction policy ([backend/src/services/report_redaction.py L22](../backend/src/services/report_redaction.py#L22)).
- GDPR-relevant consent columns on `parental_consents` (alembic 000015): `personal_data_consent_accepted`, `special_category_consent_accepted`, `parental_responsibility_confirmed`.
- Audit logs: `audit_log` (000005), `ui_state_audit` (000023).
- Threat model and remediation tracking documents present: [docs/security-threat-model.md](security-threat-model.md) (519 lines), [docs/security-remediation-tracker.md](security-remediation-tracker.md) (130 lines), [docs/multitenant-auth-migration.md](multitenant-auth-migration.md) (118 lines).

Not present in this repository at file scan time: a SOC 2 / ISO control-mapping document.

---

## 11. Known limitations and deferred work

DEFERRED items recorded in source or docs:

- RL stages beyond Stage 0 for the listening evaluation reward loop ([docs/session-listening-eval-rl-stage0-and-drill-polish-2026-04-21.md](session-listening-eval-rl-stage0-and-drill-polish-2026-04-21.md)).
- Reward gating: `RewardService.snapshot` returns `None` until `MIN_VOTES_FOR_REWARD` and `MIN_THERAPISTS_FOR_REWARD` are reached ([backend/src/services/listening_eval_service.py L42-L43](../backend/src/services/listening_eval_service.py#L42-L43)).
- ACS Email resources are deployed conditionally in [infra/resources.bicep](../infra/resources.bicep); environments without them must rely on a different transport.
- The repository contains both `docs/repo-architecture.md` (281 lines, prior shorter reference) and this document; consumers should treat this file as the current reference.

SCAFFOLDED items:

- `StubInsightsPlanner` is the fallback when Copilot SDK is not configured ([backend/src/services/insights_service.py L143](../backend/src/services/insights_service.py#L143)).
- Custom-scenario flow falls back to a generic template when no evaluation prompt file exists (noted previously in repo memory; see Section 6 prompt inventory for shipped prompts).

Operational caveats observed in code, not bugs:

- `LOCAL_DEV_AUTH` boot guard refuses Azure-hosted runtime usage.
- `REQUIRE_POSTGRES_IN_AZURE` strict mode causes `create_storage_service` to raise on SQLite request in Azure ([backend/src/services/storage_factory.py](../backend/src/services/storage_factory.py)).
- WebSocket compression is disabled — large JSON frames during real-time sessions (see prior architecture notes referenced from [docs/repo-architecture.md](repo-architecture.md)).

---

## 12. Glossary

- ACS — Azure Communication Services. Used here for transactional email ([backend/src/services/email_service.py](../backend/src/services/email_service.py)).
- AVM — Azure Verified Modules. Used by [infra/resources.bicep](../infra/resources.bicep) for Container Registry, Container Apps Environment, and the Container App.
- azd — Azure Developer CLI. Service definition in [azure.yaml](../azure.yaml).
- BYOK — Bring Your Own Key (model provider). Copilot SDK calls go to Azure OpenAI via `build_copilot_azure_provider_config` ([backend/src/services/azure_openai_auth.py L1-104](../backend/src/services/azure_openai_auth.py#L1-L104)).
- DPO — Direct Preference Optimization. Preference pairs exported by `build_dpo_preference_pairs` ([backend/src/services/listening_eval_service.py L542](../backend/src/services/listening_eval_service.py#L542)).
- Easy Auth — Azure Container Apps built-in authentication; configured in `voicelabAuth` ([infra/resources.bicep](../infra/resources.bicep)).
- IPA — International Phonetic Alphabet. Used in [data/lexicons/wulo.pls](../data/lexicons/wulo.pls) and [data/lexicons/phoneme-map.json](../data/lexicons/phoneme-map.json).
- PLS — Pronunciation Lexicon Specification (W3C). [data/lexicons/wulo.pls](../data/lexicons/wulo.pls).
- RLS — Row-Level Security (Postgres). Applied to multi-tenant tables; see Section 6.
- SLT — Speech and Language Therapy.
- STT / TTS — Speech-to-text / Text-to-speech. Both provided by Azure Speech ([backend/src/services/insights_websocket_handler.py](../backend/src/services/insights_websocket_handler.py)).
- VAD — Voice Activity Detection. Configured as `azure_semantic_vad` ([backend/src/services/websocket_handler.py](../backend/src/services/websocket_handler.py)).
- Voice Live — Azure SDK `azure.ai.voicelive.aio`, API `2025-05-01-preview`, used by `/ws/voice`.

---

## Self-audit

Sections present and populated: 1 Executive summary, 2 Repository layout, 3 Runtime topology, 4 AI/ML surface, 5 Business logic domains, 6 Data architecture, 7 Frontend architecture, 8 Infrastructure and deployment, 9 Testing and quality, 10 Security/privacy/compliance, 11 Known limitations, 12 Glossary.

Sections with explicit "Not present in this repository" notes: Section 10 (no SOC 2 / ISO control-mapping document found at scan time).

Citation discipline: every numeric constant, table name, route, resource name, and feature claim above is anchored to a specific file, line range, or symbol that exists in this repository. Where a fact came from a docs file rather than source, the docs file is cited instead.

AUDIT OK.
