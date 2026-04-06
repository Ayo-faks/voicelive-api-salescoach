---
name: azure-staged-release
description: "Use when releasing this app to Azure staging and production, committing validated changes, pushing main, running azd preview or deploy, verifying custom domains, or promoting a staging-tested change to production. Triggers: deploy staging, deploy production, push to Azure, release main, azd deploy, staging verification, production rollout."
---

# Azure Staged Release

Use this skill for the repo's normal release path from validated source changes to Azure staging and production.

## Scope

- Commit intended source changes in coherent batches.
- Push the current branch before deployment.
- Deploy `salescoach-swe` first.
- Verify staging health before production.
- Deploy `salescoach-prod` only after staging is healthy.

## Release Rules

1. Never commit local runtime artifacts such as `data/wulo.db`.
2. Prefer multiple coherent commits over a single mixed commit when product work and business docs are unrelated.
3. Run validation before deployment.
4. Always run `azd provision --preview` before infrastructure-affecting deploys.
5. Verify both the ACA hostname and bound custom domains after each deployment.

## Standard Validation Set

Run the fastest high-signal checks first:

```bash
cd /home/ayoola/sen/voicelive-api-salescoach/frontend
npm test
npm run build

cd /home/ayoola/sen/voicelive-api-salescoach/backend
/home/ayoola/sen/.venv/bin/python -m pytest \
  tests/unit/test_app.py \
  tests/unit/test_websocket_handler.py \
  tests/integration/test_auth_roles.py \
  tests/integration/test_child_memory_endpoints.py \
  tests/integration/test_recommendation_endpoints.py \
  tests/unit/test_storage.py \
  tests/unit/test_child_memory_service.py \
  tests/unit/test_institutional_memory_service.py \
  tests/unit/test_recommendation_service.py
```

Optional deeper validation:

```bash
cd /home/ayoola/sen/voicelive-api-salescoach/backend
/home/ayoola/sen/.venv/bin/python -m pytest tests/integration/test_storage_parity.py -vv
```

Use the parity test only when Docker-backed PostgreSQL validation is available and time permits.

## Commit Workflow

1. Review `git status --short`.
2. Exclude runtime artifacts.
3. Group commits by concern, for example:
   - product and platform changes
   - prospecting or research assets
   - repo automation or deployment skills
4. Use explicit commit messages.

Example:

```bash
cd /home/ayoola/sen/voicelive-api-salescoach
git add <intended paths>
git commit -m "Add child memory and therapist recommendation workflow"
```

## Push Workflow

```bash
cd /home/ayoola/sen/voicelive-api-salescoach
git push origin main
```

## Staging Deployment

Preview first:

```bash
cd /home/ayoola/sen/voicelive-api-salescoach
azd provision --preview --environment salescoach-swe
```

Deploy:

```bash
cd /home/ayoola/sen/voicelive-api-salescoach
AZURE_EXTENSION_DIR=/tmp/az-noext DOCKER_CONFIG=$(mktemp -d) azd deploy --environment salescoach-swe
```

Verify:

```bash
curl -fsS https://voicelab.wittyground-443dbaba.swedencentral.azurecontainerapps.io/api/health
curl -fsS https://staging-sen.wulo.ai/api/health
```

## Production Deployment

Preview first:

```bash
cd /home/ayoola/sen/voicelive-api-salescoach
azd provision --preview --environment salescoach-prod
```

Deploy:

```bash
cd /home/ayoola/sen/voicelive-api-salescoach
AZURE_EXTENSION_DIR=/tmp/az-noext DOCKER_CONFIG=$(mktemp -d) azd deploy --environment salescoach-prod
```

Verify:

```bash
curl -fsS https://voicelab.ambitiousmeadow-130d4e95.swedencentral.azurecontainerapps.io/api/health
curl -fsS https://sen.wulo.ai/api/health
curl -fsS https://staging-sen.wulo.ai/api/health
```

## Release Output

Report back with:

- commit SHAs
- pushed branch
- staging result and URLs checked
- production result and URLs checked
- any skipped validation and why