---
name: azure-deployment-guardrails
description: "Use when preparing or reviewing Azure deployments for this repo, checking what should not be committed, validating azd environment conventions, reviewing domain-safe previews, or avoiding local-dev auth and runtime artifact mistakes. Triggers: deployment guardrails, release checklist, Azure deploy safety, azd env checks, custom domain safety, what not to commit."
---

# Azure Deployment Guardrails

Use this skill before any Azure deployment or release review in this repository.

## Hard Rules

1. Do not commit `data/wulo.db`.
2. Do not enable `LOCAL_DEV_AUTH=true` in Azure-hosted environments.
3. Do not deploy infra-affecting changes without `azd provision --preview`.
4. Use `AZURE_EXTENSION_DIR=/tmp/az-noext DOCKER_CONFIG=$(mktemp -d)` for `azd deploy` commands in this repo.
5. Do not proceed to production if staging health checks fail.
6. Do not ignore custom-domain drift in preview output.

## Repo-Specific Environment Conventions

- Staging environment: `salescoach-swe`
- Production environment: `salescoach-prod`
- Canonical env keys for `infra/main.parameters.json` are uppercase, including:
  - `VOICELAB_CUSTOM_DOMAINS`
  - `DATABASE_BACKEND`
  - `DATABASE_RUN_MIGRATIONS_ON_STARTUP`
  - `DATABASE_MIGRATION_ALLOWED_ENVIRONMENTS`

## Preview Review Checklist

Before deployment, inspect preview output for:

- removal of `properties.configuration.ingress.customDomains`
- unexpected auth configuration changes
- unexpected storage or database backend changes
- destructive resource replacement where only update is expected

If preview shows custom domain removal, stop and fix the env inputs before deployment.

## Runtime Verification Checklist

After deployment, verify:

1. `/api/health` returns success on the ACA hostname.
2. `/api/health` returns success on bound custom domains.
3. Container app env values still match intended runtime mode.

Example query:

```bash
az containerapp show -g rg-salescoach-prod -n voicelab --query '{customDomains:properties.configuration.ingress.customDomains,databaseBackend:properties.template.containers[0].env[?name==`DATABASE_BACKEND`].value|[0],runMigrations:properties.template.containers[0].env[?name==`DATABASE_RUN_MIGRATIONS_ON_STARTUP`].value|[0]}' -o json
```

## Auth Safety

Protected route and websocket tests must run with `LOCAL_DEV_AUTH=false` unless a test explicitly opts into local dev auth. If auth behavior looks inconsistent across shells, fix the test fixture or env setup rather than weakening route protection.

## Commit Hygiene

When the working tree mixes product work and commercial research artifacts, split them into separate commits so deployment history stays understandable.