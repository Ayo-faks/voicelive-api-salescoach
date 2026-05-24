# Deployment Guide For Coding Agents

## Repository Snapshot

This repository currently contains three major layers:

1. `frontend/`: React 19 + Vite + TypeScript therapist and child-facing UI.
2. `backend/`: Flask + Flask-Sock runtime, storage, AI orchestration, planner, recommendation, and memory services.
3. `infra/`: `azd` + Bicep deployment to Azure Container Apps, AI Services, Speech, Storage, and optional PostgreSQL.

Product capabilities now include authenticated therapist flows, child-session persistence, governed child memory, inspectable recommendations, and Copilot-backed next-session planning.

When changing repo-facing behavior, review at least:

- `backend/src/app.py`
- `backend/src/services/`
- `frontend/src/app/App.tsx`
- `frontend/src/components/ProgressDashboard.tsx`
- `infra/resources.bicep`

This repository deploys with Azure Developer CLI and has two important environment states:

1. `salescoach-swe`: the currently provisioned working environment.
2. `salescoach-prod`: the preferred future environment name for production deploys.

Follow these rules exactly.

## Safe Workflow

1. Validate before any Azure deploy.
2. Do not commit generated local artifacts.
3. Use `salescoach-prod` only after it has been provisioned successfully.
4. If `salescoach-prod` is not yet provisioned, either provision it first or deploy to the known working env `salescoach-swe`.

## Never Commit These

Do not commit local runtime or deploy scratch files:

- `data/wulo.db`
- `.docker-azd/`
- temporary local databases under `/tmp`

Before committing, check:

```bash
git status --short
```

Stage only intended source files.

## Validation Commands

Run the minimal validation set before deploy:

```bash
cd frontend && npx tsc --noEmit && npm run build
cd ../backend && /home/ayoola/sen/.venv/bin/python -m pytest tests/unit/test_app.py tests/unit/test_websocket_handler.py tests/integration/test_auth_roles.py
```

## Environment Variables

- `LTI_SESSION_SECRET`: HS256 signing secret for short-lived Pathfinder Learn LTI launch session tokens.
- `PATHFINDER_LEARN_OBSERVABILITY_ENABLED`: Set to `0`/`false` to disable Pathfinder Learn route metrics and spans.
- `PATHFINDER_LEARN_PROMETHEUS_ENABLED`: Set to `0`/`false` to disable `/api/learning/metrics` and Prometheus counters while leaving other observability on.
- `PATHFINDER_LEARN_OTEL_ENABLED`: Set to `0`/`false` to disable Pathfinder Learn OpenTelemetry spans and Azure Monitor custom metrics while leaving Prometheus counters on.

## Pathfinder Learn Postgres/RLS Verification

Run live Postgres/RLS verification after migrations and before pilot rollout:

```bash
cd /home/ayoola/sen/voicelive-api-salescoach-pathfinder-phase-0
DATABASE_URL='<runtime-postgres-url>' /home/ayoola/sen/.venv/bin/python backend/scripts/verify_learning_postgres_rls.py --json
```

The verifier checks Alembic head `20260524_000026`, forced RLS on every learning table, tenant policy coverage, A5/B1 columns, storage GUC propagation, and a rollback-only tenant-isolation probe.

## Deploy Existing Provisioned Environment

If the target environment is already provisioned:

```bash
cd /home/ayoola/sen/voicelive-api-salescoach
AZURE_EXTENSION_DIR=/tmp/az-noext DOCKER_CONFIG=$(mktemp -d) azd deploy --environment salescoach-prod
```

If `salescoach-prod` fails with `ERROR: infrastructure has not been provisioned`, use the currently provisioned environment:

```bash
cd /home/ayoola/sen/voicelive-api-salescoach
AZURE_EXTENSION_DIR=/tmp/az-noext DOCKER_CONFIG=$(mktemp -d) azd deploy --environment salescoach-swe
```

## Provision `salescoach-prod`

If `salescoach-prod` is blank or new, seed the required env values first:

```bash
cd /home/ayoola/sen/voicelive-api-salescoach
azd env set AZURE_LOCATION swedencentral --environment salescoach-prod
azd env set AZURE_SUBSCRIPTION_ID 3cb57c01-55ff-4609-8967-c47271818125 --environment salescoach-prod
azd env set AZURE_PRINCIPAL_ID 55fb23f5-1740-4474-9887-6a900f95cfb7 --environment salescoach-prod
azd env set AZURE_PRINCIPAL_TYPE User --environment salescoach-prod
azd env set MICROSOFT_PROVIDER_CLIENT_ID <value> --environment salescoach-prod
azd env set MICROSOFT_PROVIDER_CLIENT_SECRET <value> --environment salescoach-prod
azd env set GOOGLE_PROVIDER_CLIENT_ID <value> --environment salescoach-prod
azd env set GOOGLE_PROVIDER_CLIENT_SECRET <value> --environment salescoach-prod
```

Preview first, then provision:

```bash
cd /home/ayoola/sen/voicelive-api-salescoach
AZURE_EXTENSION_DIR=/tmp/az-noext azd provision --preview --environment salescoach-prod
AZURE_EXTENSION_DIR=/tmp/az-noext DOCKER_CONFIG=$(mktemp -d) azd provision --environment salescoach-prod
```

After successful provision, deploy:

```bash
cd /home/ayoola/sen/voicelive-api-salescoach
AZURE_EXTENSION_DIR=/tmp/az-noext DOCKER_CONFIG=$(mktemp -d) azd deploy --environment salescoach-prod
```

## Post-Deploy Verification

Verify health and root response:

```bash
FQDN=$(AZURE_EXTENSION_DIR=/tmp/az-noext az containerapp show --name voicelab --resource-group rg-salescoach-prod --query 'properties.configuration.ingress.fqdn' -o tsv)
curl --max-time 20 -s -o /dev/null -w 'health_http=%{http_code}\n' "https://$FQDN/api/health"
curl --max-time 20 -s -o /dev/null -w 'root_http=%{http_code}\n' "https://$FQDN/"
```

For the current legacy environment, the resource group is `rg-salescoach-swe`.

## Current Reality

At the time this guide was added:

1. `salescoach-swe` was the live working environment.
2. `salescoach-prod` needed provisioning before direct deploys would work.
3. The repo already contains auth and persistence infrastructure in Bicep, so `azd provision` is the correct way to create the new environment.