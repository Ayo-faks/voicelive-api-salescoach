# Resume staging deploy — handoff prompt

Paste the block below into a new Copilot chat session (inside the
`/home/ayoola/sen/voicelive-api-salescoach` workspace) to continue the
staging rollout.

---

## Context

You are resuming a deploy to the **`salescoach-swe`** Azure env
(Container App `voicelab` in RG `rg-salescoach-swe`,
FQDN `voicelab.wittyground-443dbaba.swedencentral.azurecontainerapps.io`,
custom domain `staging-sen.wulo.ai`).

### What already happened

1. Commit `8723a79` (Apple-HIG UI + memory tab polish + exercise content)
   was pushed to `origin/main`.
2. First `azd deploy voicelab` to `salescoach-swe` succeeded in azd's eyes
   but the new revision **crash-looped**, so `latestReadyRevisionName`
   stayed on the old revision `voicelab--azd-1776413407` (dated
   2026-04-17). That is why `staging-sen.wulo.ai` still serves stale code
   with `last-modified: Fri, 17 Apr 2026 08:05:24 GMT`.
3. Two startup crashes were fixed and committed:
   - `f28251d` — `backend/src/services/report_exporters.py`: Python 3.11
     rejected backslashes inside f-string expression parts. Extracted
     nested f-strings into local variables (`metric_cards_html`,
     `badge_row_html`).
   - `0a30252` — `backend/src/services/email_service.py`: invalid ACS
     connection string raised at boot; now wrapped in `try/except` and
     marks the service disabled.
4. Last deploy attempt failed at the Docker build step with
   `error getting credentials - err: exit status 1, out: """` because
   Docker's credential helper was stale. Running `docker logout` clears
   it. The user cancelled the retry.

### Your job

Get the latest commit (`0a30252` or newer on `origin/main`) running on
`salescoach-swe` and confirm `staging-sen.wulo.ai` serves it.

## Step-by-step

1. **Verify git state**
   ```bash
   cd /home/ayoola/sen/voicelive-api-salescoach
   git status
   git log --oneline -5
   ```
   Expect HEAD = `0a30252` (or later) on `main`, clean tree, pushed.

2. **Clear stale Docker creds and confirm env**
   ```bash
   docker logout
   azd env select salescoach-swe
   azd env get-values | grep -E "^AZURE_(ENV_NAME|LOCATION|CONTAINER_APP_NAME|SUBSCRIPTION_ID)="
   ```
   Expect `AZURE_ENV_NAME="salescoach-swe"`, `AZURE_LOCATION="swedencentral"`,
   `AZURE_CONTAINER_APP_NAME="voicelab"`,
   `AZURE_SUBSCRIPTION_ID="3cb57c01-55ff-4609-8967-c47271818125"`.

3. **Pre-flight: compile backend under Python 3.11** (the prod runtime —
   local python is 3.12 and will NOT catch 3.11 f-string issues):
   ```bash
   docker run --rm -v "$PWD/backend:/b" python:3.11-slim-bullseye \
     python -c "
   import py_compile, os
   errs = 0
   for root, _, files in os.walk('/b/src'):
       for f in files:
           if f.endswith('.py'):
               p = os.path.join(root, f)
               try:
                   py_compile.compile(p, doraise=True)
               except py_compile.PyCompileError as e:
                   print('FAIL', p, str(e).splitlines()[-2:])
                   errs += 1
   print('errors:', errs)
   "
   ```
   Must print `errors: 0`. If not, fix before deploying.

4. **Deploy**
   ```bash
   azd deploy voicelab --no-prompt
   ```
   Wait for `SUCCESS`. Typical duration: 5–7 min (cold) or ~1 min
   (if cache is warm).

5. **Watch revision come up** (azd returns before healthprobes pass):
   ```bash
   sleep 30
   az containerapp show -n voicelab -g rg-salescoach-swe \
     --query "{latestRev:properties.latestRevisionName, latestReady:properties.latestReadyRevisionName}" -o json
   ```
   `latestRev` must equal `latestReady`. If they differ, the new revision
   failed — go to step 6.

6. **If new revision is Failed / Unhealthy**
   ```bash
   NEW_REV=$(az containerapp show -n voicelab -g rg-salescoach-swe \
     --query "properties.latestRevisionName" -o tsv)
   az containerapp revision show -n voicelab -g rg-salescoach-swe \
     --revision "$NEW_REV" \
     --query "{health:properties.healthState, prov:properties.provisioningState, running:properties.runningState}" -o json
   az containerapp logs show -n voicelab -g rg-salescoach-swe \
     --revision "$NEW_REV" --type console --tail 60
   ```
   Read the Python traceback from the console logs. The pattern so far
   has been: import-time side effects in `backend/src/app.py` or its
   transitive imports crash when env vars are missing/invalid. Fix by
   making the offending service resilient (try/except + `_disabled_reason`)
   rather than requiring config to be valid at import time. Commit, push,
   redeploy.

7. **Verify the user-facing domain**
   ```bash
   curl -sI https://staging-sen.wulo.ai/ | grep -iE "HTTP|last-modified"
   curl -s https://voicelab.wittyground-443dbaba.swedencentral.azurecontainerapps.io/ \
     | grep -oE 'assets/[^"]+\.(js|css)' | sort -u
   curl -s https://staging-sen.wulo.ai/ \
     | grep -oE 'assets/[^"]+\.(js|css)' | sort -u
   ```
   - Direct-endpoint and `staging-sen.wulo.ai` asset hashes must match
     the hashes in `frontend/dist/index.html` after a fresh build.
   - If `staging-sen.wulo.ai` asset hashes differ from the swe direct
     endpoint, Cloudflare is routing the domain to a different Container
     App. Check which:
     ```bash
     for rg in rg-salescoach-swe rg-salescoach-prod rg-salescoach-pgstage; do
       echo "=== $rg ==="
       az containerapp show -n voicelab -g $rg \
         --query "properties.configuration.ingress.customDomains[].name" -o tsv
     done
     ```
     **Known collision:** both `rg-salescoach-swe` AND `rg-salescoach-prod`
     have `staging-sen.wulo.ai` bound. If prod is the one Cloudflare
     actually targets, either deploy the same image to prod
     (`azd env select salescoach-prod && azd deploy voicelab`) or remove
     the binding from prod (`az containerapp hostname delete -n voicelab
     -g rg-salescoach-prod --hostname staging-sen.wulo.ai`) after
     confirming with the user.

8. **Done when**: asset hashes match across staging-sen.wulo.ai and the
   swe direct endpoint, `last-modified` is today's date (or Docker mtime
   preserved — acceptable as long as asset hashes updated), and a quick
   browser check of the Memory tab shows the new pill badges + warm
   tokens.

## Guardrails

- User's intended staging env is `salescoach-swe` (user quote:
  "the correct one is -swe"). Don't deploy to `salescoach-prod` without
  explicit confirmation.
- Do not run `az containerapp hostname delete` on prod without asking.
- Don't force-push. Don't amend `origin/main` commits.
- If another startup crash appears, prefer "soft-disable with reason"
  over "require valid config", matching the pattern in
  `AzureCommunicationEmailService`.

## Reference

- Dockerfile: multi-stage, frontend built into backend image. Runtime is
  `python:3.11-slim-bullseye`. No separate Static Web App.
- `azure.yaml`: single service `voicelab`, `host: containerapp`,
  `language: python`, `docker.path: backend/Dockerfile`.
- Last good revision (pre-fix): `voicelab--azd-1776413407`
  (2026-04-17T08:10Z).
- Failed revisions so far: `voicelab--azd-1776697260` (f-string bug),
  `voicelab--azd-1776697989` (ACS bug).
