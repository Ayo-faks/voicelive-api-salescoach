# Handoff prompt — Provision & deploy `academy.wulo.ai` (new production env)

> Paste everything below the line into a fresh agent session. It is self-contained:
> it tells the agent what exists, what to change, the exact order, and the
> guardrails. Do NOT let the agent skip the approval gates.

---

You are picking up a production-deployment task for the `voicelive-api-salescoach`
repo (Pathfinder Learn / Wulo). Work from `/home/ayoola/sen/voicelive-api-salescoach`.
Python venv: `/home/ayoola/sen/.venv` (activate it). Run the backend with
`PYTHONPATH=.` from `backend/`.

## Goal
Stand up a NEW, isolated production environment for a new product surface served at
**`academy.wulo.ai`**, fronted by Cloudflare exactly like the existing prod
(`sen.wulo.ai`) and staging (`staging-sen.wulo.ai`). Deploy it with a hardened,
"security-laden" posture. Do the Bicep parameterization first (reversible, no
deploy), then provision/deploy behind explicit approval gates.

## Ground truth about the current setup (verified — do not re-litigate)
- **One subscription-scoped Bicep template serves all envs.** `infra/main.bicep`
  creates `rg-${environmentName}` then calls `infra/resources.bicep`. Each azd env is
  the same template with different env vars:
  - `salescoach-swe`  → staging (`rg-salescoach-swe`, `staging-sen.wulo.ai`)
  - `salescoach-prod` → prod (`rg-salescoach-prod`, `sen.wulo.ai`)
  - `salescoach-pgstage` → a pg staging variant
- **Subscription**: "Microsoft Azure Sponsorship"
  (`3cb57c01-55ff-4609-8967-c47271818125`), region **swedencentral**. `az`/`azd` are
  authenticated. Network-bound `az`/`azd`/`git push`/`curl`/`bicep` calls need
  `requestUnsandboxedExecution=true`.
- **Two things are HARDCODED by env name** and must be generalized before academy
  can work:
  1. `customRedirectHost` in `infra/resources.bicep` (~L202-206): only maps
     `salescoach-swe`/`salescoach-prod`. There is already a `publicAppUrl` /
     `PUBLIC_APP_URL` param that overrides it — prefer making the host fully
     env-driven via that param instead of adding a third hardcoded branch.
  2. CORS `allowedOrigins` in `infra/resources.bicep` (~L544-547): hardcoded to the
     two existing hosts + the default ACA host. Must include the env's own public
     host.
- **Custom domain binding** comes from the `voicelabCustomDomains` array param
  (`VOICELAB_CUSTOM_DOMAINS` env var, default `[]`) applied at
  `infra/resources.bicep` (~L529).
- **Auth today = Container Apps Easy Auth** (Entra ID + Google), with
  `unauthenticatedClientAction=Return401` (see `infra/main.json` ~L1075). Easy Auth
  sits at the platform edge: it 401s unauthenticated requests AND strips
  client-supplied `X-MS-CLIENT-PRINCIPAL*` headers. The app itself auto-provisions
  users via `storage_service.get_or_create_user` in
  `backend/src/app.py:_get_authenticated_user_from_headers` (~L791).
- **Managed identity**: user-assigned, `infra/resources.bicep` (~L507-513).
- **Content Safety**: wired but OFF by default (`azureContentSafety*` params,
  `infra/resources.bicep` ~L616).
- **Scale**: `scaleMinReplicas:1`, `scaleMaxReplicas:1` (single-replica ceiling).
  A draft autoscale diff exists at `infra/loadtest-autoscale.bicep-diff.md`
  (NOT applied; multi-replica safety unvalidated — voicelab has in-process state:
  in-memory rate limiter + voice WS session state).
- Per-env config flows: azd env var → `infra/main.parameters.json` `${TOKEN=default}`
  substitution → Bicep param.

## Architectural decision (already made — implement it, don't redesign)
Create a **dedicated azd environment** `academy-prod` → its own `rg-academy-prod`,
own DB, own identity, own scaling, own Entra app registration. Do NOT just add
`academy.wulo.ai` as a second domain on the existing prod app. Reason: data
isolation, independent blast radius, separate cost/scaling, clean RBAC.

## Security services to integrate (the "security-laden" requirement)
Tier 1 (must): **Azure Key Vault** for all secrets (today they are inline
`listKeys()`/`@secure` params — biggest gap); **arm Azure AI Content Safety**
(kids' product → moderation mandatory); **own Entra app registration** for Easy
Auth; **Managed Identity + least-privilege RBAC** to KV (Key Vault Secrets User),
Azure OpenAI (Cognitive Services User), Postgres (Entra auth).
Tier 2 (should): **ACA ingress IP-allowlist restricted to Cloudflare published IP
ranges** (closes the direct-origin WAF-bypass hole — the default FQDN is currently
reachable directly); keep **Cloudflare WAF/bot rules**; **Private Endpoints + VNet
integration** for Postgres/OpenAI/Key Vault/Storage.
Tier 3 (hardening): **Microsoft Defender for Cloud** (Containers, Key Vault,
Databases plans); **Log Analytics + App Insights** (extend `infra/monitoring-alerts.bicep`);
**Azure Policy** guardrails (require HTTPS, deny public IP on data stores).

## Execution plan — follow in order, STOP at each gate

### Phase 0 — Bicep parameterization (CODE ONLY, no deploy, flag-gated)
All changes must be **default-off / backward-compatible** so existing
staging/prod render identically. Verify with `az bicep build` / `azd provision
--preview` (what-if) that the existing envs are unchanged.
1. Generalize `customRedirectHost` to be driven by `publicAppUrl`/`PUBLIC_APP_URL`
   (fall back to existing behavior when unset).
2. Generalize CORS `allowedOrigins` to include the env's own public host.
3. Add a **Key Vault** module + move secrets to KV secret references behind a
   feature flag (e.g. `useKeyVault`, default false). Grant the managed identity
   Key Vault Secrets User.
4. Add **ingress IP-allowlist** param (e.g. `ingressAllowedSourceRanges`, default
   empty = no restriction) wired to the container app ingress.
5. Keep Content Safety params; ensure they can be armed via env vars.
GATE 0: show a diff summary + `azd provision --preview` proving existing envs
unchanged. Get explicit approval before any deploy.

### Phase 1 — New azd environment (no provision yet)
```bash
azd env new academy-prod
azd env set AZURE_LOCATION swedencentral
azd env set PUBLIC_APP_URL https://academy.wulo.ai
azd env set VOICELAB_CUSTOM_DOMAINS '[]'        # bind domain AFTER cert (Phase 3)
azd env set ENABLE_POSTGRES_PERSISTENCE true
azd env set DATABASE_BACKEND postgres
azd env set USE_KEY_VAULT true                  # if implemented in Phase 0
# Content Safety + safeguarding + Easy Auth secrets set in Phase 2
```

### Phase 2 — Identity & secrets
- Create a NEW Entra app registration for academy Easy Auth (own client ID/secret,
  own redirect URIs for `https://academy.wulo.ai`). Set
  `microsoftProviderClientId/Secret` (+ Google if used) as azd env vars.
- Set safeguarding env vars (admin email/SMS) and Content Safety endpoint/key.
GATE 2: confirm app registration + secrets are set (do not print secret values).

### Phase 3 — Provision + domain + Cloudflare (REAL Azure spend — APPROVAL GATE)
1. `azd provision` (first pass, `VOICELAB_CUSTOM_DOMAINS=[]`) → capture the ACA
   default FQDN.
2. Cloudflare DNS: add `CNAME academy → <aca-default-fqdn>`, **proxied (orange
   cloud)**, SSL mode **Full (strict)**, mirroring the existing `staging-sen` /
   `sen` records.
3. Bind the custom domain on the ACA app (managed cert or the CF origin cert used
   by the other envs), then
   `azd env set VOICELAB_CUSTOM_DOMAINS '[{...academy.wulo.ai binding...}]'` and
   re-provision.
4. After validation, set `INGRESS_ALLOWED_SOURCE_RANGES` to Cloudflare's published
   IP ranges and re-provision (lock the origin to Cloudflare).
GATE 3: stop for approval before `azd provision` (creates billable resources).

### Phase 4 — Deploy + validate
1. `azd deploy` the container image.
2. Validate Easy Auth (unauth → 401), health, and a synthetic
   **diagnostic-only** ramp using the existing harness pattern
   (`backend/loadtest/run_staging_ramp.sh` is a self-reverting reference; adapt
   target to academy, keep diagnostic-only = no Azure OpenAI spend).
3. Confirm Content Safety is armed and Defender/Log Analytics are receiving data.
GATE 4: report SLOs + security posture before announcing go-live.

## Guardrails (hard rules)
- No `azd provision`/`azd up`/`az ... update` on live infra without an explicit
  approval at the gate. Phase 0 (code) is fine without a gate; deploys are not.
- Never weaken auth on existing `salescoach-*` envs. Academy changes must be
  backward-compatible (default-off flags) — prove it with what-if.
- Push to `origin` (Ayo-faks fork) ONLY, never upstream. Don't commit scratch
  `*.md`/`*.prompt.md`.
- Synthetic data only for any load validation. Never stream real audio to
  VoiceLive. Diagnostic-only ramps (no model spend) unless explicitly approved.
- Don't print secret values. Use managed identity / Key Vault, not inline keys,
  for anything new.
- If an interactive prompt or a real cost decision appears and the user is away,
  STOP and report rather than guessing.

## What to deliver back
1. Phase 0 diff + what-if proof existing envs unchanged.
2. The `academy-prod` env config (redacted).
3. Provisioned resource list for `rg-academy-prod` + the live `academy.wulo.ai`
   health/auth check.
4. Security posture summary (KV, Content Safety, IP-allowlist, Defender, RBAC).
