# SpeakBright Pre-Launch MVP Plan

> **Goal:** Ship a publicly accessible, authenticated, data-persistent SpeakBright at `sen.wulo.ai` so that therapists (and eventually any subscriber) can run real speech sessions with children.  
> **Target users:** Anyone who registers — therapists, parents, schools. Not a closed pilot.  
> **Security posture:** Public internet app handling children's voice data. Security is paramount.  
> **Auth model:** Dual provider — Google OAuth + Microsoft Entra ID (mirrors `transcription-services-demo`)  
> **Reference implementation:** `/home/ayoola/streaming_agents/transcription-services-demo`

---

## Launch Blockers — 3 Items

| # | Blocker | Risk if skipped | Effort |
|---|---------|-----------------|--------|
| 1 | **Authentication (Google + Entra ID)** | App is open to the entire internet with PIN `2468` | ~1 day |
| 2 | **Data persistence (Azure File Share)** | All sessions, child profiles, exercises lost on every container restart | ~2 hours |
| 3 | **Custom domain `sen.wulo.ai`** | No stable URL for users | ~1 hour |

Everything else from the 11-section PRODUCTION-MVP-UPGRADE-PROMPT ships post-launch. See [POST-MVP items](#post-mvp-roadmap) at the bottom.

---

## Blocker 1: Dual-Provider Authentication

### 1.1 Architecture Decision

Use **Azure Container Apps EasyAuth** with both **Google** and **Microsoft Entra ID** — same pattern as `transcription-services-demo`.

- EasyAuth sits in front of the entire Container App
- `unauthenticatedClientAction: Return401` — the SPA detects 401 and shows its own login screen
- `excludedPaths` must include static assets so the login page itself loads without auth
- `post_login_redirect_uri` goes straight back to SPA root — no `/api/auth/callback` needed
- `/api/auth/session` endpoint reads `X-MS-CLIENT-PRINCIPAL` header to return user info

### 1.2 Known Issues to Resolve

| Issue | Resolution |
|-------|------------|
| **Return401 blocks SPA login page** — unauthenticated users can't load `/`, CSS, JS | Add `excludedPaths: ['/', '/index.html', '/assets/*', '/js/*', '/manifest.json', '/api/health']` in Bicep authConfig |
| **No `/api/auth/callback` needed** — auth plan describes one, but `post_login_redirect_uri` goes to SPA root | Remove `/api/auth/callback` endpoint from plan. Keep only `/api/auth/session`. |
| **`credentials: "include"` missing** — no fetch call sends cookies | Add to every `fetch()` in `frontend/src/services/api.ts` (use wrapper like reference impl's `withApiRequestInit`) |
| **WebSocket upgrade + EasyAuth** — `/ws/voice` must pass EasyAuth cookie on upgrade | Test explicitly after enabling. Browser sends cookies on same-origin WebSocket upgrade. Add to `excludedPaths` only if it fails. |
| **Session cookie expiry mid-exercise** — next `/api/analyze` call will 401 | Add 401 interceptor in frontend that shows "Session expired — please sign in again" |

### 1.3 Infrastructure Changes — `infra/resources.bicep`

Add parameters (mirror reference impl):

```bicep
@description('Microsoft Entra app registration client ID for Easy Auth.')
param microsoftProviderClientId string = ''

@secure()
@description('Microsoft Entra client secret (Key Vault reference).')
param microsoftProviderClientSecretReference string = ''

@description('Google OAuth client ID for Easy Auth.')
param googleProviderClientId string = ''

@secure()
@description('Google OAuth client secret (Key Vault reference).')
param googleProviderClientSecretReference string = ''

var easyAuthEnabled = !empty(microsoftProviderClientId) || !empty(googleProviderClientId)
```

Add secrets to Container App `secrets.secureList`:

```bicep
{
  name: 'microsoft-provider-auth-secret'
  value: microsoftProviderClientSecretReference
}
{
  name: 'google-provider-auth-secret'
  value: googleProviderClientSecretReference
}
```

Add env vars to container:

```bicep
{ name: 'MICROSOFT_PROVIDER_AUTHENTICATION_SECRET', secretRef: 'microsoft-provider-auth-secret' }
{ name: 'GOOGLE_PROVIDER_AUTHENTICATION_SECRET', secretRef: 'google-provider-auth-secret' }
```

Add authConfig resource (after Container App, using `Microsoft.App/containerApps/authConfigs`):

```bicep
resource voicelabAuth 'Microsoft.App/containerApps/authConfigs@2024-03-01' = if (easyAuthEnabled) {
  parent: voicelab  // reference to the container app module output
  name: 'current'
  properties: {
    platform: {
      enabled: true
    }
    globalValidation: {
      unauthenticatedClientAction: 'Return401'
      excludedPaths: [
        '/'
        '/index.html'
        '/assets/*'
        '/js/*'
        '/manifest.json'
        '/api/health'
      ]
    }
    identityProviders: {
      azureActiveDirectory: {
        enabled: !empty(microsoftProviderClientId)
        registration: {
          clientId: microsoftProviderClientId
          clientSecretSettingName: 'MICROSOFT_PROVIDER_AUTHENTICATION_SECRET'
          openIdIssuer: '${environment().authentication.loginEndpoint}organizations/v2.0'
        }
        login: {
          loginParameters: ['scope=openid profile email']
        }
      }
      google: {
        enabled: !empty(googleProviderClientId)
        registration: {
          clientId: googleProviderClientId
          clientSecretSettingName: 'GOOGLE_PROVIDER_AUTHENTICATION_SECRET'
        }
        login: {
          scopes: ['openid', 'profile', 'email']
        }
      }
    }
    login: {
      tokenStore: { enabled: true }
      allowedExternalRedirectUrls: ['https://sen.wulo.ai']
    }
  }
}
```

> **Note:** Container Apps uses `Microsoft.App/containerApps/authConfigs` (not `Microsoft.Web/sites/config` like the Function App reference). The schema is the same for identity providers.

### 1.4 External Setup Required

**Google OAuth Console** ([console.cloud.google.com](https://console.cloud.google.com)):
- Create OAuth 2.0 Client ID (Web application)
- Authorized JS origins: `https://sen.wulo.ai`, `https://voicelab.wittyground-443dbaba.swedencentral.azurecontainerapps.io`
- Authorized redirect URIs: `https://sen.wulo.ai/.auth/login/google/callback`, `https://voicelab.wittyground-443dbaba.swedencentral.azurecontainerapps.io/.auth/login/google/callback`

**Microsoft Entra ID** ([entra.microsoft.com](https://entra.microsoft.com)):
- Register new app → Web → redirect URI: `https://sen.wulo.ai/.auth/login/aad/callback`
- Also add: `https://voicelab.wittyground-443dbaba.swedencentral.azurecontainerapps.io/.auth/login/aad/callback`
- API permissions: `openid`, `profile`, `email`
- Create client secret
- Note: use `organizations` issuer (not `common`) if you want to restrict to org accounts, or `common` to allow personal Microsoft accounts too

### 1.5 Backend Changes — `backend/src/app.py`

**Add `/api/auth/session` endpoint:**

```python
@app.route("/api/auth/session", methods=["GET"])
def get_auth_session():
    principal_header = request.headers.get("X-MS-CLIENT-PRINCIPAL")
    if principal_header:
        import base64
        padding = "=" * (-len(principal_header) % 4)
        principal = json.loads(base64.b64decode(f"{principal_header}{padding}").decode())
        claims = {c["typ"].split("/")[-1]: c["val"] for c in principal.get("claims", [])}
        user_id = request.headers.get("X-MS-CLIENT-PRINCIPAL-ID", claims.get("sub", ""))
        name = request.headers.get("X-MS-CLIENT-PRINCIPAL-NAME", claims.get("name", ""))
        email = claims.get("emailaddress", claims.get("email", ""))
        provider = request.headers.get("X-MS-CLIENT-PRINCIPAL-IDP", "unknown")
        return jsonify({"authenticated": True, "user_id": user_id, "name": name, "email": email, "provider": provider})

    if LOCAL_DEV_AUTH:
        return jsonify({
            "authenticated": True,
            "user_id": os.environ.get("LOCAL_DEV_USER_ID", "local-dev"),
            "name": os.environ.get("LOCAL_DEV_USER_NAME", "Local Dev"),
            "email": os.environ.get("LOCAL_DEV_USER_EMAIL", "dev@localhost"),
            "provider": "local-dev",
        })

    return jsonify({"authenticated": False}), 401
```

**Replace `_therapist_authorized()` PIN check:**

```python
def _therapist_authorized() -> bool:
    if LOCAL_DEV_AUTH:
        return True
    return bool(request.headers.get("X-MS-CLIENT-PRINCIPAL-ID"))
```

**Add safety guard:**

```python
LOCAL_DEV_AUTH = os.environ.get("LOCAL_DEV_AUTH", "").lower() == "true"
if LOCAL_DEV_AUTH and os.environ.get("WEBSITE_SITE_NAME"):  # Azure sets this in production
    raise RuntimeError("FATAL: LOCAL_DEV_AUTH=true is forbidden in production.")
```

### 1.6 Frontend Changes

**Create `frontend/src/components/AuthGateScreen.tsx`** — login page with both Google and Microsoft buttons (adapt from reference impl's `AuthGateScreen.tsx`):

```tsx
export function AuthGateScreen({ onMicrosoftSignIn, onGoogleSignIn }: {
  onMicrosoftSignIn: () => void
  onGoogleSignIn: () => void
}) {
  return (
    <div className="auth-gate">
      <h1>SpeakBright</h1>
      <p>Speech practice for every child</p>
      <button onClick={onMicrosoftSignIn}>Sign in with Microsoft</button>
      <button onClick={onGoogleSignIn}>Sign in with Google</button>
    </div>
  )
}
```

**Add auth check in App.tsx:**

```tsx
const [authStatus, setAuthStatus] = useState<"loading" | "authenticated" | "unauthenticated">("loading")

useEffect(() => {
  fetch("/api/auth/session", { credentials: "include" })
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(() => setAuthStatus("authenticated"))
    .catch(() => setAuthStatus("unauthenticated"))
}, [])

if (authStatus === "loading") return <Spinner />
if (authStatus === "unauthenticated") return <AuthGateScreen
  onMicrosoftSignIn={() => window.location.href = `/.auth/login/aad?post_login_redirect_uri=${encodeURIComponent(window.location.origin + "/")}`}
  onGoogleSignIn={() => window.location.href = `/.auth/login/google?post_login_redirect_uri=${encodeURIComponent(window.location.origin + "/")}`}
/>
```

**Add `credentials: "include"` to all fetch calls** in `frontend/src/services/api.ts`. Use a wrapper pattern (like reference impl's `withApiRequestInit`):

```typescript
function withCredentials(init?: RequestInit): RequestInit {
  return { ...init, credentials: 'include' }
}

// Then wrap every fetch:
// fetch('/api/config')  →  fetch('/api/config', withCredentials())
// fetch(url, { method: 'POST', ... })  →  fetch(url, withCredentials({ method: 'POST', ... }))
```

**Add 401 interceptor** — wrap the fetch helper to detect expired sessions:

```typescript
async function fetchWithAuth<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, withCredentials(init))
  if (response.status === 401) {
    // Session expired — trigger re-login
    window.dispatchEvent(new CustomEvent('auth:expired'))
    throw new Error('Session expired')
  }
  return response
}
```

### 1.7 Verification Checklist

- [ ] Unauthenticated user can load `sen.wulo.ai` (HTML/CSS/JS load without 401)
- [ ] Login page shows both Google and Microsoft sign-in buttons
- [ ] Clicking Google → Google OAuth consent → redirect back to SPA → app loads
- [ ] Clicking Microsoft → Entra login → redirect back to SPA → app loads
- [ ] `/api/auth/session` returns user info with `credentials: "include"`
- [ ] `/api/analyze` returns 401 without valid session cookie
- [ ] WebSocket `/ws/voice` connects successfully with valid session cookie
- [ ] Cookie expiry mid-session shows "session expired" instead of cryptic error
- [ ] `LOCAL_DEV_AUTH=true` works locally, crashes if set in production

---

## Blocker 2: Data Persistence (Azure File Share)

### Problem

SQLite database at `data/wulo.db` lives on ephemeral container filesystem. Every container restart (deploy, scale, crash) loses all data. For a public app, this is unacceptable.

### Solution

Mount an Azure File Share at `/app/data/` inside the Container App. SQLite is fine for current scale — the issue is durability, not database choice.

### 2.1 Infrastructure Changes — `infra/resources.bicep`

Add a storage account + file share:

```bicep
resource persistenceStorage 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: 'st${resourceToken}data'
  location: location
  tags: tags
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource fileService 'Microsoft.Storage/storageAccounts/fileServices/shares@2023-01-01' = {
  name: '${persistenceStorage.name}/default/wulo-data'
  properties: {
    shareQuota: 1  // 1 GB — plenty for SQLite
  }
}
```

Add storage to Container Apps Environment:

```bicep
// In containerAppsEnvironment params, add:
storages: [
  {
    name: 'wulo-data'
    properties: {
      azureFile: {
        accountName: persistenceStorage.name
        accountKey: persistenceStorage.listKeys().keys[0].value
        shareName: 'wulo-data'
        accessMode: 'ReadWrite'
      }
    }
  }
]
```

Add volume mount to Container App:

```bicep
// In voicelab container app, add volumes and volumeMounts:
volumes: [
  {
    name: 'wulo-data'
    storageName: 'wulo-data'
    storageType: 'AzureFile'
  }
]
// In container definition, add:
volumeMounts: [
  {
    volumeName: 'wulo-data'
    mountPath: '/app/data'
  }
]
```

### 2.2 Backend Config

No code change needed — `DEFAULT_STORAGE_PATH` in `backend/src/config.py` already resolves to `data/wulo.db` relative to the project root, which maps to `/app/data/wulo.db` inside the container.

**Verify:** The Dockerfile's `WORKDIR` must be `/app` and the `data/` folder must resolve to `/app/data/` inside the container.

### 2.3 Verification

- [ ] Deploy → create a child profile → redeploy → child profile persists
- [ ] Run a session → restart container → session history is still there
- [ ] Check Azure Portal → Storage account → File share → `wulo.db` file visible

---

## Blocker 3: Custom Domain `sen.wulo.ai`

### 3.1 Steps (order matters)

**Step 1 — Cloudflare: add CNAME as DNS Only (grey cloud)**

| Type | Name | Target | Proxy |
|------|------|--------|-------|
| CNAME | `sen` | `voicelab.wittyground-443dbaba.swedencentral.azurecontainerapps.io` | DNS Only ☁️ |

**Step 2 — Azure: add and bind custom domain**

```bash
az containerapp hostname add \
  --resource-group rg-salescoach-swe \
  --name voicelab \
  --hostname sen.wulo.ai

az containerapp hostname bind \
  --resource-group rg-salescoach-swe \
  --name voicelab \
  --hostname sen.wulo.ai \
  --validation-method CNAME
```

Wait for `provisioningState: Succeeded`:

```bash
az containerapp hostname list \
  --resource-group rg-salescoach-swe \
  --name voicelab \
  --query "[?name=='sen.wulo.ai']" -o table
```

**Step 3 — Cloudflare: switch to Proxied (orange cloud)**

SSL/TLS mode: **Full** (not Full Strict).

### 3.2 Verification

- [ ] `https://sen.wulo.ai` loads the SPA
- [ ] `https://sen.wulo.ai/.auth/login/google` redirects to Google OAuth
- [ ] `https://sen.wulo.ai/.auth/login/aad` redirects to Microsoft login
- [ ] Certificate is valid (no browser warnings)

---

## Execution Order

```
Day 1 (morning):
  1. Create Google OAuth credentials
  2. Create Microsoft Entra app registration
  3. Add auth params + authConfig to resources.bicep
  4. Add Azure File Share + volume mount to resources.bicep
  5. Deploy infra: azd provision

Day 1 (afternoon):
  6. Backend: add /api/auth/session, replace _therapist_authorized(), add LOCAL_DEV_AUTH guard
  7. Frontend: add AuthGateScreen, auth check in App.tsx, credentials: "include" wrapper, 401 interceptor
  8. Build + deploy: scripts/build.sh && azd deploy

Day 1 (evening):
  9. Cloudflare DNS setup (CNAME → grey cloud → wait for cert → orange cloud)
  10. Verification: run through all checklists above

Day 2:
  11. Test WebSocket voice session through EasyAuth
  12. Test session cookie expiry handling
  13. Test data persistence across container restart
  14. Fix any issues found
```

---

## Post-MVP Roadmap

These items from the PRODUCTION-MVP-UPGRADE-PROMPT are important but do NOT block launch:

| Section | Item | Ship after |
|---------|------|------------|
| §1 | Product scope document | First 10 sessions |
| §2 | Agent architecture redesign (persona/strategy/context/tool layers) | First 10 sessions |
| §3 | Memory architecture (working/episodic/semantic) | First 10 sessions |
| §4 | Evaluation harness + CI/CD quality gates + prompt regression | First 20 sessions |
| §5 | Full threat model, SAST/DAST, dependency scanning | First month |
| §7 | API hardening (CORS, rate limiting, versioning, security headers) | First month |
| §8 | Database migration (SQLite → PostgreSQL/Cosmos) | When >50 concurrent users |
| §9 | Full Azure production architecture (Key Vault for all secrets, private endpoints) | First month |
| §10 | CI/CD pipeline with branch protections, PR checks, security scans | First month |
| §11 | Phased roadmap with milestones | After launch |

> **wulo.ai landing page:** Not needed for launch. Users go directly to `sen.wulo.ai`. Build the landing page when you're ready for public marketing.

---

## Security Notes for a Public App

Since this is publicly accessible (not a closed pilot), these controls become important sooner:

| Control | Priority | When |
|---------|----------|------|
| Rate limiting on `/api/analyze`, `/api/assess-utterance` | High | Within 2 weeks of launch |
| Input validation on all API endpoints | High | Within 2 weeks |
| WebSocket connection limits per user | Medium | Within 1 month |
| CORS restricted to `sen.wulo.ai` only | High | At launch (add to Flask config) |
| Security headers (CSP, HSTS, X-Frame-Options) | Medium | Within 2 weeks |
| Secret rotation (move API keys to Key Vault) | Medium | Within 1 month |
| Audit logging for session creation/deletion | Medium | Within 1 month |
| Dependency scanning in CI | Medium | Within 1 month |
| GDPR/child data retention policy | High | Within 2 weeks |
