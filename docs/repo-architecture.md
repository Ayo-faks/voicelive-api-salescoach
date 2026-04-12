# Repository Architecture

Last updated: 2026-04-07

## Purpose

This document describes the repository as it exists today: the current application surfaces, service boundaries, persistence model, and deployment shape.

Use it as the engineering-facing companion to the top-level README.

## What The Repository Ships Today

This codebase is no longer just a voice demo or a thin speech-practice sample.

It currently ships a therapist-supervised speech practice platform with:

- realtime child practice sessions over Azure Voice Live
- therapist-authored and built-in exercise flows
- pronunciation assessment and post-session AI analysis
- authenticated therapist workspace flows
- workspace-aware access control, therapist invite-code claiming, and parent invitation workflows
- persisted children, sessions, plans, and therapist feedback
- governed child memory with proposal review
- recommendation ranking with inspectable evidence
- Copilot SDK-backed next-session planning
- Azure Container Apps deployment with Bicep and `azd`

## Top-Level Repository Map

```text
backend/
  src/
    app.py                        Flask entrypoint and API surface
    config.py                     environment-driven runtime configuration
    bootstrap_storage.py          SQLite bootstrap and blob restore helper
    services/                     domain and integration services
  tests/                          backend unit and integration tests
  Dockerfile                      backend runtime image

frontend/
  src/
    app/                          routing and top-level app state
    components/                   child and therapist UI surfaces
    hooks/                        realtime, recording, audio, and WebRTC hooks
    services/api.ts               REST client and auth-aware fetch wrapper
    types/                        shared UI contracts

infra/
  main.bicep                      subscription-scope entrypoint
  resources.bicep                 resource group resources and wiring
  modules/                        helper deployment modules

data/
  exercises/                      therapist exercise definitions and prompt assets
  images/                         exercise-associated image assets
  scenarios/                      older scenario content retained in-repo

docs/
  therapist-guide.md              therapist-facing product guide
  child-memory-*.md               architecture and rollout notes for memory features
  *.md                            product plans, migration notes, and rollout docs

scripts/
  build.sh                        frontend build and backend static copy
  test.sh                         broad backend pytest runner
  migrate_sqlite_to_postgres.py   persistence migration helper
```

## Runtime Architecture

### Frontend

The frontend is a React 19 + Vite + TypeScript application.

Primary runtime responsibilities:

- authenticate the therapist session through same-origin API calls
- load app configuration and child/session state
- reconcile active workspace state and workspace-scoped child access
- orchestrate child-mode and therapist-mode navigation
- establish the realtime WebSocket connection to the backend proxy
- bootstrap WebRTC video playback for avatar sessions
- render the therapist workspace for memory, recommendation, and planning review

Key frontend files:

- `frontend/src/app/App.tsx`
  Owns route transitions, auth session handling, active child state, launch flow, and therapist dashboard data loading.
- `frontend/src/components/SessionScreen.tsx`
  The live session composition layer with avatar-first layout and inline exercise feedback.
- `frontend/src/components/DashboardHome.tsx`
  Therapist home/preparation surface.
- `frontend/src/components/ProgressDashboard.tsx`
  Deep review workspace for sessions, charts, memory, recommendations, and plans.
- `frontend/src/hooks/useRealtime.ts`
  Same-origin WebSocket lifecycle, reconnect logic, and transcript/message accumulation.
- `frontend/src/hooks/useWebRTC.ts`
  Receives avatar media after Voice Live session bootstrap.

### Backend

The backend is a Flask application with Flask-Sock for the realtime proxy path.

Primary runtime responsibilities:

- serve the built frontend and JSON APIs
- enforce therapist-role checks and Easy Auth-backed session access
- provide workspace, invitation, parental-consent, and child data portability endpoints
- proxy the realtime voice session to Azure Voice Live
- analyze completed sessions and persist results
- provide therapist review APIs for sessions, plans, memory, and recommendations
- initialize storage and dependent services at process startup

Key backend files:

- `backend/src/app.py`
  Entry point, API routes, auth/session helpers, and runtime service initialization.
- `backend/src/services/websocket_handler.py`
  Voice Live connection setup, typed session configuration, and principal-header enforcement on WebSocket upgrade.
- `backend/src/services/storage_factory.py`
  Selects SQLite or PostgreSQL at runtime and controls whether startup migrations are allowed.
- `backend/src/services/child_memory_service.py`
  Handles proposal synthesis, approval/rejection workflow, summary compilation, and safe runtime personalization inputs.
- `backend/src/services/recommendation_service.py`
  Produces explainable next-exercise recommendations.
- `backend/src/services/planning_service.py`
  Hosts the GitHub Copilot SDK planner runtime and readiness model.
- `backend/src/services/institutional_memory_service.py`
  Builds de-identified clinic-level insights from approved evidence and reviewed outcomes.

## Core User Flows

### 1. Child practice session

1. Therapist or child selects an exercise.
2. Frontend requests agent/session setup from the backend.
3. Frontend connects to `/ws/voice`.
4. Backend opens a Voice Live connection and applies session config.
5. Frontend receives avatar media through WebRTC.
6. The child practises through guided voice turns.
7. Supported exercise types can show immediate utterance scoring.

### 2. Post-session analysis and persistence

1. Frontend submits transcript, audio references, and exercise metadata.
2. Backend runs conversation analysis and pronunciation assessment.
3. The storage layer saves the session record and linked outputs.
4. Child-memory proposal synthesis can generate pending or auto-approved items.

### 3. Therapist review and planning

1. Therapist opens the dashboard for an active child.
2. Frontend loads session history, session detail, memory summary, proposals, recommendations, and plans.
3. Therapist can review or write memory items.
4. Recommendation flows rank candidate exercises with visible evidence.
5. Planning flows use saved context and approved memory to generate or refine the next-session draft.

### 4. Access, workspaces, and privacy

1. Authenticated users receive role and workspace context from `/api/auth/session`.
2. Pending therapists can redeem an invite code before entering full therapist workflows.
3. Therapists can create child profiles and invite parents into a linked child workspace.
4. Parents can accept or decline invitations from the same authenticated product shell.
5. Therapists and authorized parents can export or delete child data through the protected privacy endpoints.

## Persistence Model

### SQLite path

SQLite remains the default runtime backend.

Current behavior:

- the image includes a baked bootstrap database
- startup can restore from blob backup before first open
- if the mounted database is missing or empty, the bootstrap copy is used
- Azure Container Apps mounts Azure Files at runtime for persistence

### PostgreSQL path

The repository also includes a PostgreSQL storage backend and migration seam.

Current behavior:

- `DATABASE_BACKEND=postgres` activates the PostgreSQL service path
- `DATABASE_URL` is required for PostgreSQL runtime
- startup migrations are guarded by environment checks to avoid unsafe production drift
- Bicep already provisions PostgreSQL Flexible Server when enabled

This allows staged rollout while keeping SQLite as the default operating mode.

## Authentication Model

The app uses Azure Container Apps Easy Auth for hosted environments and local development auth flags for local testing.

Important runtime rules:

- local auth is forbidden when Azure-hosted runtime markers are present
- REST APIs use authenticated session checks and therapist-role checks where required
- the WebSocket upgrade path also validates the principal header unless local auth is explicitly enabled
- authenticated session payloads also include workspace membership and current workspace context
- pending therapists can be upgraded through invite-code redemption instead of being granted therapist access immediately

## Infrastructure Model

Azure deployment is driven by `azd` plus Bicep.

The current infrastructure includes:

- Azure AI Services / Azure OpenAI deployments
- Azure Speech resource
- Azure Container Registry
- Azure Container Apps environment and app
- Application Insights and Log Analytics
- Azure Storage for file-share persistence and blob backup
- optional Azure Database for PostgreSQL Flexible Server
- Easy Auth parameters for Microsoft and Google providers
- planner-specific environment variable wiring
- custom domain configuration inputs

## Data And Governance Layers

The repository now has three distinct evidence layers:

- **Event/session history**
  Saved sessions, transcripts, assessments, and therapist feedback.
- **Governed child memory**
  Durable child-level knowledge that can be approved, rejected, summarized, and reused.
- **Institutional memory**
  De-identified cross-child insight derived from reviewed evidence.

This separation matters because the app intentionally avoids letting live child-facing runtime agents write durable memory directly.

## Access And Privacy Controls

The current repository also includes operational controls around child access and privacy:

- therapist workspaces and membership roles
- parent invitation creation, acceptance, decline, revoke, and resend flows
- parental-consent records per child
- child data export for portability and subject-access workflows
- child data deletion for erasure workflows
- audit logging around access, invitation, and export/delete operations

## Development Notes

### Build and run

```bash
./scripts/build.sh
cd backend && python -m src.app
```

### Focused validation

```bash
cd frontend && npx tsc --noEmit && npm run build
cd ../backend && /home/ayoola/sen/.venv/bin/python -m pytest tests/unit/test_app.py tests/unit/test_websocket_handler.py tests/integration/test_auth_roles.py
```

### WSL-safe Azure deploy pattern

```bash
AZURE_EXTENSION_DIR=/tmp/az-noext DOCKER_CONFIG=$(mktemp -d) azd deploy --environment <env>
```

Use the same environment-variable prefix for `azd provision` in WSL when Azure CLI extension state or Docker credential helpers are unreliable.

## Related Documents

- `README.md` for the repo overview
- `AGENTS.md` for repo-specific deployment rules and validation commands
- `docs/therapist-guide.md` for therapist workflow documentation
- `docs/child-memory-architecture.md` and `docs/child-memory-implementation-plan.md` for deeper memory-system reasoning