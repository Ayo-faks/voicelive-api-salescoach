# SpeakBright MVP — Auth Setup Plan

> **Status:** Ready to implement  
> **Domain:** `sen.wulo.ai` (Cloudflare) → Container App `voicelab.wittyground-443dbaba.swedencentral.azurecontainerapps.io`  
> **Auth model:** Azure Container Apps Easy Auth + Google OAuth 2.0  
> **Reference implementation:** `transcription-services-demo` (`/home/ayoola/streaming_agents/transcription-services-demo`)

---

## Login Flow

```
wulo.ai (external landing page)
    │  user clicks "Get Started" / "Login"
    ▼
https://sen.wulo.ai/login          ← SPA login page (branded, shows Google button)
    │  user clicks "Sign in with Google"
    ▼
https://sen.wulo.ai/.auth/login/google?post_login_redirect_uri=https://sen.wulo.ai/
    │  (Container App EasyAuth intercepts, redirects to Google)
    ▼
Google OAuth consent screen
    │  user approves
    ▼
https://sen.wulo.ai/.auth/login/google/callback  ← EasyAuth sets session cookie
    │
    ▼
https://sen.wulo.ai/               ← SPA loads, calls /api/auth/session, enters app
```

The Container App EasyAuth intercepts the `/.auth/*` routes before Flask ever sees them. Flask only handles `/api/*` routes and static file serving.

---

## Values You Need to Configure

### 1. Google OAuth Console

**Where:** [console.cloud.google.com](https://console.cloud.google.com) → APIs & Services → Credentials → **Create Credentials → OAuth 2.0 Client ID**

| Field | Value |
|-------|-------|
| Application type | **Web application** |
| Name | `SpeakBright SEN — wulo.ai` |

**Authorized JavaScript origins** — add both:
```
https://sen.wulo.ai
https://voicelab.wittyground-443dbaba.swedencentral.azurecontainerapps.io
```

**Authorized redirect URIs** — add both:
```
https://sen.wulo.ai/.auth/login/google/callback
https://voicelab.wittyground-443dbaba.swedencentral.azurecontainerapps.io/.auth/login/google/callback
```

After saving you will receive:
- `Client ID` — looks like `1234567890-abc123.apps.googleusercontent.com`
- `Client Secret` — a short alphanumeric string

Keep both; you will need them in step 2.

---

### 2. Azure Container Apps Authentication

**Where:** [portal.azure.com](https://portal.azure.com) → Resource group `rg-salescoach-swe` → Container app `voicelab` → **Authentication** → **Add identity provider → Google**

| Field | Value |
|-------|-------|
| **App (client) ID** | `<Client ID from Google>` |
| **App (client) secret** | `<Client Secret from Google>` |
| **Scopes** | `openid profile email` |
| **Restrict access** | **Require authentication** |
| **Unauthenticated requests** | `HTTP 401 Unauthenticated requests` ← important: **not** redirect, let the SPA show its own login page |
| **Token store** | ✅ Enabled |

After saving, click **Edit** on the Google provider and confirm:

| Advanced field | Value |
|----------------|-------|
| **Allowed external redirect URLs** | `https://sen.wulo.ai` |

> **Why Return 401, not redirect?**  
> The SPA has its own branded `/login` route. EasyAuth returning 401 means the frontend detects the 401 response from `/api/auth/session` and renders the login page component — no double redirect, no loop.

---

## Cloudflare DNS Setup

> **Order matters — do not skip ahead.** Azure must issue its managed certificate before Cloudflare is set to Proxied. If you flip Cloudflare to Proxied first, Azure's CNAME validation sees Cloudflare's IP instead of the Container App, the cert never issues, and `/.auth/` routes fail silently.

**Step 1 — Cloudflare: add CNAME as DNS Only (grey cloud)**

| Type | Name | Target | Proxy status |
|------|------|--------|--------------|
| CNAME | `sen` | `voicelab.wittyground-443dbaba.swedencentral.azurecontainerapps.io` | ☁️ DNS Only (grey cloud) |

**Step 2 — Azure: add and bind the custom domain**
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

Wait ~5 minutes for the Azure-managed certificate to issue. Verify:
```bash
az containerapp hostname list \
  --resource-group rg-salescoach-swe \
  --name voicelab \
  --query "[?name=='sen.wulo.ai'].{name:name, bindingType:bindingType, provisioningState:provisioningState}" \
  -o table
```
Wait until `provisioningState` shows `Succeeded`.

**Step 3 — Cloudflare: switch to Proxied (orange cloud) only after cert is issued**

Edit the CNAME record → set Proxy status to **Proxied**.

**SSL/TLS mode:** Full (not Full Strict — the Container App cert is Azure-managed, not a CA-signed cert on `sen.wulo.ai`).

---

## What Needs to Change in the Codebase

### Backend — `backend/src/app.py`

Three changes:

**1. Add `LOCAL_DEV_AUTH` guard (mirrors transcription-services-demo pattern)**
```python
import os, base64, json

LOCAL_DEV_AUTH = os.environ.get("LOCAL_DEV_AUTH", "").lower() == "true"
AZURE_FUNCTIONS_ENVIRONMENT = os.environ.get("AZURE_FUNCTIONS_ENVIRONMENT", "Production")

if LOCAL_DEV_AUTH and AZURE_FUNCTIONS_ENVIRONMENT == "Production":
    raise RuntimeError("FATAL: LOCAL_DEV_AUTH=true is forbidden in Production.")

FRONTEND_ALLOWED_REDIRECT_ORIGINS = {
    "https://sen.wulo.ai",
    "https://voicelab.wittyground-443dbaba.swedencentral.azurecontainerapps.io",
}
```

**2. Add two auth endpoints (replace after existing `/api/therapist/auth`)**
```python
@app.route("/api/auth/callback", methods=["GET"])
def auth_callback():
    redirect_target = request.args.get("redirect", "").strip().rstrip("/")
    if redirect_target not in FRONTEND_ALLOWED_REDIRECT_ORIGINS:
        redirect_target = next(iter(FRONTEND_ALLOWED_REDIRECT_ORIGINS))
    return redirect(redirect_target + "/", code=302)


@app.route("/api/auth/session", methods=["GET"])
def get_auth_session():
    principal_header = request.headers.get("X-MS-CLIENT-PRINCIPAL")
    if principal_header:
        padding = "=" * (-len(principal_header) % 4)
        principal = json.loads(base64.b64decode(f"{principal_header}{padding}").decode())
        claims = {c["typ"].split("/")[-1]: c["val"] for c in principal.get("claims", [])}
        user_id = request.headers.get("X-MS-CLIENT-PRINCIPAL-ID", claims.get("sub", ""))
        name = request.headers.get("X-MS-CLIENT-PRINCIPAL-NAME", claims.get("name", ""))
        email = claims.get("emailaddress", claims.get("email", ""))
        return jsonify({"authenticated": True, "user_id": user_id, "name": name, "email": email})

    if LOCAL_DEV_AUTH:
        return jsonify({
            "authenticated": True,
            "user_id": os.environ.get("LOCAL_DEV_USER_ID", "local-dev"),
            "name": os.environ.get("LOCAL_DEV_USER_NAME", "Local Dev"),
            "email": os.environ.get("LOCAL_DEV_USER_EMAIL", "dev@localhost"),
        })

    return jsonify({"authenticated": False}), 401
```

**3. Replace `_therapist_authorized()` PIN check**  
Remove the `DEFAULT_THERAPIST_PIN` check. Replace with `X-MS-CLIENT-PRINCIPAL-ID` presence check (EasyAuth already enforced authentication before Flask sees the request):
```python
def _therapist_authorized(req=None):
    return bool(request.headers.get("X-MS-CLIENT-PRINCIPAL-ID"))
```
For local dev, also return `True` when `LOCAL_DEV_AUTH=true`.

---

### Frontend — Add Login Page and Auth Provider

Create `frontend/src/components/LoginPage.tsx` (modelled on `transcription-services-demo/frontend-react/src/app/providers/AuthSessionProvider.tsx`):

```tsx
// LoginPage.tsx — shown when /api/auth/session returns 401
export function LoginPage() {
  const apiBase = import.meta.env.VITE_API_BASE_URL ?? ""
  const loginUrl = `${apiBase}/.auth/login/google?post_login_redirect_uri=${encodeURIComponent(window.location.origin + "/")}`

  return (
    <div className="login-page">
      <img src="/wulo-logo.png" alt="Wulo" />
      <h1>SpeakBright</h1>
      <p>Speech practice for every child</p>
      <a href={loginUrl} className="google-sign-in-btn">
        Sign in with Google
      </a>
    </div>
  )
}
```

In `frontend/src/app/App.tsx`, add a session check on mount:
```tsx
const [authStatus, setAuthStatus] = useState<"loading" | "authenticated" | "unauthenticated">("loading")

useEffect(() => {
  fetch("/api/auth/session", { credentials: "include" })
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(() => setAuthStatus("authenticated"))
    .catch(() => setAuthStatus("unauthenticated"))
}, [])

if (authStatus === "loading") return <Spinner />
if (authStatus === "unauthenticated") return <LoginPage />
// ...rest of app
```

Update `frontend/src/services/api.ts`: add `credentials: "include"` to every `fetch()` call so the EasyAuth session cookie is sent.

---

### Infra — `infra/resources.bicep`

Add two parameters at the top of `resources.bicep`:
```bicep
@description('Google OAuth client ID for Container Apps Easy Auth.')
param googleOAuthClientId string = ''

@secure()
@description('Google OAuth client secret for Container Apps Easy Auth.')
param googleOAuthClientSecret string = ''
```

Add a secret to the Container App for the client secret, then add the auth config resource after the Container App:
```bicep
resource containerAppAuth 'Microsoft.App/containerApps/authConfigs@2024-03-01' = if (!empty(googleOAuthClientId)) {
  parent: voicelab
  name: 'current'
  properties: {
    platform: { enabled: true }
    globalValidation: {
      unauthenticatedClientAction: 'Return401'
      excludedPaths: ['/api/health']
    }
    identityProviders: {
      google: {
        enabled: true
        registration: {
          clientId: googleOAuthClientId
          clientSecretSettingName: 'GOOGLE_PROVIDER_AUTHENTICATION_SECRET'
        }
        login: { scopes: ['openid', 'profile', 'email'] }
      }
    }
    login: {
      tokenStore: { enabled: true }
      allowedExternalRedirectUrls: ['https://sen.wulo.ai']
    }
  }
}
```

Add to the Container App `env` array:
```bicep
{ name: 'GOOGLE_PROVIDER_AUTHENTICATION_SECRET', secretRef: 'google-oauth-secret' }
```

---

### Environment Variables to Add

**In Container App settings (after deploy) or `main.parameters.json`:**

| Variable | Value | Where stored |
|----------|-------|--------------|
| `GOOGLE_PROVIDER_AUTHENTICATION_SECRET` | `<Google Client Secret>` | Container App Secret |

**For local development only (never deploy):**

| Variable | Value |
|----------|-------|
| `LOCAL_DEV_AUTH` | `true` |
| `LOCAL_DEV_USER_ID` | `dev-therapist-001` |
| `LOCAL_DEV_USER_NAME` | `Dev Therapist` |
| `LOCAL_DEV_USER_EMAIL` | `dev@localhost` |

---

## What Stays the Same

- Session data, exercises, and all `/api/analyze`, `/api/sessions`, `/api/children/*` endpoints are unchanged
- The PIN-based auth is replaced by EasyAuth — therapist identity comes from `X-MS-CLIENT-PRINCIPAL-ID` header
- All existing SEN exercise YAML files, the ConversationAnalyzer, PronunciationAssessor, and StorageService are untouched
- The ProgressDashboard and AssessmentPanel components need no structural changes — just the auth gate around them

---

## What the Landing Page (wulo.ai) Must Contain

On `wulo.ai` (external site), the "Login" / "Get Started" button must link to:
```
https://sen.wulo.ai/login
```
Not directly to Google OAuth — the SPA login page handles the provider selection and branding.

---

## Sequence to Go Live

1. Configure Google OAuth credentials (step 1 above) — 5 min
2. Add DNS CNAME in Cloudflare and bind custom domain on Container App — 5 min
3. Configure Azure Container Apps Authentication in portal (step 2 above) — 5 min
4. Update `backend/src/app.py` with auth endpoints and EasyAuth header check
5. Add `LoginPage` component and session check to frontend
6. Add `credentials: "include"` to all fetch calls in `api.ts`
7. `AZURE_EXTENSION_DIR=/tmp/az-noext DOCKER_CONFIG=$(mktemp -d) azd deploy --environment salescoach-prod` to push the updated container
8. Verify: visit `sen.wulo.ai`, confirm redirect to login page, sign in with Google, enter app
