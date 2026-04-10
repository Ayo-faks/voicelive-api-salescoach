# Security Remediation Tracker

Last updated: 2026-04-09 (SR-02 staging cutover and SR-03 OpenAI managed-identity rollout)

## Purpose

This document is the working tracker for security threats identified in [docs/security-threat-model.md](docs/security-threat-model.md).

Use it to track:

- Which threats are still open
- Which fixes have already been implemented
- What evidence exists for each fix
- What remains to be done before production rollout is considered acceptable

This is intended to be updated incrementally as security work lands.

## Status Legend

- `Open`: Threat is known and not yet materially mitigated
- `In progress`: Fix work has started but is not complete
- `Partially mitigated`: Some controls are in place, but important gaps remain
- `Mitigated`: Primary control is implemented and verified
- `Accepted risk`: Risk is consciously accepted with rationale

## Update Rules

When updating this document:

1. Change the `Status`
2. Add or update the `Implemented / current control`
3. Add verification evidence in `Evidence`
4. Add the next concrete action in `Remaining work`
5. Keep links to code, tests, infra, or review artifacts current

## Production Gate

No production rollout should be treated as approved while any of `SR-01` through `SR-08` remains anything other than `Mitigated` or a formally reviewed `Accepted risk`.

## Current Rollout Status

### Fully mitigated now

- `SR-01`: Azure-hosted runtime rejects SQLite
- `SR-05`: API rate limiting is in place for high-risk routes
- `SR-06`: state-changing API requests enforce origin/referer and JSON-body checks
- `SR-07`: child data export now requires confirmation and reason
- `SR-08`: therapist users can no longer assign the admin role

### Partially mitigated now

- `SR-02`: staging now runs with a distinct `wuloapp` runtime role, but production still needs the same runtime-credential rollout and validation
- `SR-03`: Azure OpenAI key injection is removed, but Speech and ACS still rely on injected secrets and Speech managed identity is intentionally deferred

### Still blocking rollout

- `SR-02`
- `SR-03`
- `SR-04`

## Threat And Fix Tracker

| ID | Threat / requirement | Status | Implemented / current control | Remaining work | Evidence |
|---|---|---|---|---|---|
| SR-01 | Production must not run SQLite; production persistence must use PostgreSQL with RLS | Mitigated | Azure-hosted startup now rejects `DATABASE_BACKEND=sqlite` in storage factory | Keep environment templates and deployment validation aligned with this rule | [backend/src/services/storage_factory.py](backend/src/services/storage_factory.py), [backend/tests/unit/test_storage_factory.py](backend/tests/unit/test_storage_factory.py) |
| SR-02 | Runtime must not use an admin-grade PostgreSQL connection | Partially mitigated | Runtime and admin DB URLs are split; migrations run from `DATABASE_ADMIN_URL`; startup can provision a separate runtime role and grant table/sequence access; staging now deploys separate runtime credentials and validates `wuloapp` as the live runtime role with `rolcreatedb=false`, `rolcreaterole=false`, and `rolinherit=false` | Roll the same runtime-credential cutover into production and keep runtime-role provisioning explicit when Azure startup migrations remain disabled | [backend/src/services/storage_factory.py](backend/src/services/storage_factory.py), [backend/src/services/postgres_migrations.py](backend/src/services/postgres_migrations.py), [backend/src/services/storage_postgres.py](backend/src/services/storage_postgres.py), [infra/resources.bicep](infra/resources.bicep), [backend/tests/unit/test_storage_factory.py](backend/tests/unit/test_storage_factory.py) |
| SR-03 | Runtime secret blast radius is too broad | Partially mitigated | Blob backup no longer requires an injected storage account key; infra now supports separate runtime/admin DB secrets instead of a single broad DB connection; Azure OpenAI analyzer, Voice Live, and planner paths now use managed-identity-capable auth and the Container App no longer receives `AZURE_OPENAI_API_KEY` | Remove remaining broad Speech and ACS secrets where the SDKs and deployment model allow it; keep Speech on key auth as an explicitly documented residual risk until a lower-risk managed-identity path is ready | [backend/src/services/blob_backup.py](backend/src/services/blob_backup.py), [backend/src/services/azure_openai_auth.py](backend/src/services/azure_openai_auth.py), [infra/resources.bicep](infra/resources.bicep), [backend/tests/unit/test_storage_factory.py](backend/tests/unit/test_storage_factory.py), [backend/tests/unit/test_analyzers.py](backend/tests/unit/test_analyzers.py), [backend/tests/unit/test_websocket_handler.py](backend/tests/unit/test_websocket_handler.py), [backend/tests/unit/test_azure_openai_auth.py](backend/tests/unit/test_azure_openai_auth.py) |
| SR-04 | PostgreSQL is too broadly exposed on the network | Open | Postgres exists with RLS, but public network access remains enabled in infra and there is no private networking seam yet for the current Container Apps environment | Design and implement VNet/private-access topology for Container Apps plus PostgreSQL; remove broad Azure-services firewall rule after connectivity validation | [infra/resources.bicep](infra/resources.bicep) |
| SR-05 | High-risk endpoints lack abuse throttling and quota controls | Mitigated | Endpoint-aware in-memory rate limits now cover analyze, plans, invitations, export, delete, and generic state-changing API traffic with `429` responses and `Retry-After` | Add shared telemetry or edge-based limits if production traffic volume outgrows in-process rate limiting | [backend/src/app.py](backend/src/app.py), [backend/tests/unit/test_app.py](backend/tests/unit/test_app.py) |
| SR-06 | State-changing endpoints lack CSRF mitigation | Mitigated | State-changing API requests now enforce trusted origin/referer checks when provided and reject non-JSON request bodies | Consider a stronger explicit CSRF token or custom-header requirement if browser behavior or reverse-proxy behavior changes | [backend/src/app.py](backend/src/app.py), [backend/tests/unit/test_app.py](backend/tests/unit/test_app.py) |
| SR-07 | Child data export was a one-step exfiltration path without confirmation | Mitigated | Export now requires `POST` plus `confirm=true` and a non-empty `reason`; audit metadata records the reason | Fix the separate SQLite export schema-drift bug so local/test export path is healthy | [backend/src/app.py](backend/src/app.py), [backend/tests/integration/test_auth_roles.py](backend/tests/integration/test_auth_roles.py), [backend/src/services/storage.py](backend/src/services/storage.py) |
| SR-08 | Therapists could assign admin role without stronger governance | Mitigated | Admin assignment is now restricted to admin callers; audit metadata includes acting role and previous role | Consider adding explicit admin-review workflow if role elevation becomes more complex | [backend/src/app.py](backend/src/app.py), [backend/tests/integration/test_auth_roles.py](backend/tests/integration/test_auth_roles.py) |

## Additional Security Findings

These are important but currently secondary to the `SR-01` to `SR-08` rollout gate.

| Finding | Status | Current state | Next action |
|---|---|---|---|
| Institutional-memory re-identification risk | Open | De-identification intent exists, but small-population inference risk remains | Define minimum aggregation thresholds and review process |
| Planner data disclosure risk | Open | Planner integration can receive sensitive child/session context | Define minimum necessary planner payload and privacy review |
| Input validation is mostly ad hoc | Open | No shared schema validation layer across sensitive endpoints | Introduce request schema validation and endpoint-level tests |
| SQLite export path has schema drift | Open | `export_child_data` queries columns that do not exist in SQLite `sessions` table | Reconcile SQLite schema and export query or retire SQLite export path |

## Current Evidence Snapshot

### Implemented now

- Production SQLite guard in [backend/src/services/storage_factory.py](backend/src/services/storage_factory.py)
- Runtime/admin PostgreSQL URL split in [backend/src/services/storage_factory.py](backend/src/services/storage_factory.py) and [backend/src/services/postgres_migrations.py](backend/src/services/postgres_migrations.py)
- Managed-identity-capable blob backup in [backend/src/services/blob_backup.py](backend/src/services/blob_backup.py)
- Managed-identity-capable Azure OpenAI auth in [backend/src/services/azure_openai_auth.py](backend/src/services/azure_openai_auth.py), [backend/src/services/analyzers.py](backend/src/services/analyzers.py), [backend/src/services/websocket_handler.py](backend/src/services/websocket_handler.py), and [backend/src/services/planning_service.py](backend/src/services/planning_service.py)
- Rate limiting in [backend/src/app.py](backend/src/app.py)
- CSRF/origin and JSON-body enforcement in [backend/src/app.py](backend/src/app.py)
- Export confirmation and reason requirement in [backend/src/app.py](backend/src/app.py)
- Role-governance hardening in [backend/src/app.py](backend/src/app.py)
- Release gate language in [docs/security-threat-model.md](docs/security-threat-model.md)

### Verified tests

- [backend/tests/unit/test_storage_factory.py](backend/tests/unit/test_storage_factory.py)
- [backend/tests/unit/test_analyzers.py](backend/tests/unit/test_analyzers.py)
- [backend/tests/unit/test_websocket_handler.py](backend/tests/unit/test_websocket_handler.py)
- [backend/tests/unit/test_azure_openai_auth.py](backend/tests/unit/test_azure_openai_auth.py)
- [backend/tests/unit/test_app.py](backend/tests/unit/test_app.py)
- [backend/tests/integration/test_auth_roles.py](backend/tests/integration/test_auth_roles.py)

### Other validation evidence

- `az bicep build --file infra/resources.bicep` completed successfully after the runtime/admin DB secret and Azure OpenAI auth changes
- Focused backend validation passed for the latest SR-02/SR-03 batch (`56 passed` across analyzer, websocket, storage-factory, and auth-helper tests)
- Staging `salescoach-swe` now deploys without `AZURE_OPENAI_API_KEY` in the live Container App env/secret inventory, and direct PostgreSQL validation confirms the runtime connection authenticates as `wuloapp` instead of `wuloadmin`

## Current Blockers

| Area | Why it is still blocked | What unlocks it |
|---|---|---|
| SR-02 full closure | Staging is validated, but production still has not been cut over to the separate runtime DB credential and live runtime-role proof | Roll the staged `wuloapp` credential pattern into production and repeat the live runtime-role validation there |
| SR-03 full closure | Azure OpenAI is narrowed, but Speech and ACS still rely on injected secrets | Migrate each remaining integration to managed identity or another narrower auth path where supported, or explicitly accept the residual risk |
| SR-04 implementation | Current Container Apps environment and Postgres config do not yet define private networking components | Add VNet/private-access design and rollout plan in infra |
| SQLite export health | Export path still has schema drift in SQLite | Reconcile SQLite schema/export query or retire SQLite export path |

## Suggested Next Updates

Update this document whenever one of the following happens:

- A security control lands in code or infra
- A requirement changes from `Open` to `In progress`, `Partially mitigated`, or `Mitigated`
- A new test or verification artifact exists
- A risk is explicitly accepted rather than fixed
- A threat-model finding is superseded or narrowed