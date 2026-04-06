Use these instructions for every coding agent working in this repository.

## Azure Deployment

When the user asks to deploy, release, push to staging, push to production, or run `azd deploy` for this repository, use the confirmed WSL-safe deploy commands below instead of inventing alternate command forms.

Staging:

```bash
cd /home/ayoola/sen/voicelive-api-salescoach && AZURE_EXTENSION_DIR=/tmp/az-noext DOCKER_CONFIG=$(mktemp -d) azd deploy --environment salescoach-swe
```

Production:

```bash
cd /home/ayoola/sen/voicelive-api-salescoach && AZURE_EXTENSION_DIR=/tmp/az-noext DOCKER_CONFIG=$(mktemp -d) azd deploy --environment salescoach-prod
```

Rules:

1. Do not use bare `azd deploy --environment ...` in this repo.
2. Do not replace the deploy step with ad hoc `az containerapp` update commands unless the user explicitly asks for an alternate path.
3. For infrastructure-affecting changes, run `azd provision --preview --environment <env>` before deployment.
4. After deployment, verify `/api/health` on the Azure Container Apps hostname and on any bound custom domain for the target environment.
5. Never commit `data/wulo.db`.

If Docker build behavior needs diagnosis, use:

```bash
cd /home/ayoola/sen/voicelive-api-salescoach && DOCKER_BUILDKIT=1 docker build --progress=plain -f backend/Dockerfile .
```