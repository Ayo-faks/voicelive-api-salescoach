# Security Threat Model

## Scope

This document describes the current security posture of the VoiceLive Sales Coach platform as implemented in this repository and deployed through Azure Developer CLI to Azure Container Apps.

It covers:

- Current architecture and data flows
- Trust boundaries and assets
- Attacker classes, goals, capabilities, and incentives
- STRIDE threat analysis for the current design
- A security control checklist mapped to the repo and Azure resources
- An end-to-end walk-through from therapist login to voice session to transcript storage

This is a current-state threat model, not an ideal-state design. Where the implementation differs from the intended architecture, this document calls that out explicitly.

## Current Architecture

### Runtime and infrastructure

- Frontend and backend are served by a single Flask application from the `backend` service.
- The app is deployed to Azure Container Apps through `azd` using [azure.yaml](../azure.yaml).
- Azure Container Apps Easy Auth is configured in [infra/resources.bicep](../infra/resources.bicep) with Microsoft Entra ID and optional Google login.
- The app uses Azure AI Services / Azure OpenAI, Azure Speech, Application Insights, Azure Blob Storage, Azure Container Registry, and a user-assigned managed identity.
- A Storage Account and Azure Files share are provisioned in [infra/resources.bicep](../infra/resources.bicep), but the current Container App definition does not mount that share into the running container.
- The current runtime storage path is `STORAGE_PATH=/tmp/wulo.db` in [infra/resources.bicep](../infra/resources.bicep), which means the live SQLite database is written to the container filesystem and then backed up best-effort to Azure Blob Storage.

### Key repo components

| Area | Repo location | Role |
|---|---|---|
| Auth extraction and API routes | `backend/src/app.py` | Reads Easy Auth headers, enforces route guards, exposes API and WebSocket endpoints |
| Config and secret loading | `backend/src/config.py` | Loads environment variables and service credentials |
| Voice WebSocket proxy | `backend/src/services/websocket_handler.py` | Proxies browser voice traffic to Azure VoiceLive |
| Persistence | `backend/src/services/storage.py` | Stores users, children, sessions, transcripts, feedback in SQLite |
| Blob backup | `backend/src/services/blob_backup.py` | Uploads and restores the SQLite file from Azure Blob Storage |
| Frontend auth and API calls | `frontend/src/services/api.ts` | Calls authenticated endpoints with cookies |
| Frontend voice connection | `frontend/src/hooks/useRealtime.ts` | Opens `/ws/voice` and forwards session state |
| Infrastructure | `infra/resources.bicep` | Provisions Container App, auth, AI, speech, storage, monitoring, registry, identity |

## Assets and Data Classification

| Asset | Examples | Sensitivity | Why it matters |
|---|---|---|---|
| Child data | child IDs, names, exercises, transcripts, pronunciation scores, therapist notes | High | This is the primary regulated and reputation-sensitive data set |
| Therapist identity | user ID, email, role, provider | High | Used to authorize review and child access |
| Voice session data | live audio stream, transcript deltas, assistant responses | High | Can reveal speech patterns, child information, and session content |
| AI outputs | assessments, notes, pronunciation analysis | High | May contain sensitive derived data and clinician-facing observations |
| Auth context | Easy Auth headers, browser cookies | High | Allows user impersonation if trusted incorrectly |
| Service credentials | AI key, Speech key, blob storage account key | Critical | Enables direct access to cloud services outside the app |
| Deployment credentials | Azure principal, portal and CI/CD access | Critical | Can alter runtime, auth, secrets, or logging |
| Telemetry and logs | request logs, event telemetry, exception traces | Medium to High | Often leaks sensitive operational and user data indirectly |

## Trust Boundaries

| Boundary | From | To | Main assumption |
|---|---|---|---|
| B1 | Browser | Public Container App ingress | TLS protects transport and Easy Auth is enforced at the edge |
| B2 | Easy Auth edge | Flask app | Identity headers are only present when issued by trusted platform auth |
| B3 | Flask app | Azure VoiceLive / Azure OpenAI / Azure Speech | Outbound calls use trusted credentials and only intended data is sent |
| B4 | Flask app | SQLite database file | The app is the only writer and can protect confidentiality and integrity |
| B5 | Flask app | Azure Blob Storage backup | Backup destination is restricted and not broadly readable |
| B6 | CI/CD and operators | Azure control plane and runtime config | Deployment identities and operators are least-privileged and auditable |

## Data Flow Overview

### High-level flow

1. Therapist opens the app and is redirected to Azure Easy Auth for login.
2. Easy Auth returns the therapist to the app and injects identity headers on authenticated requests.
3. Frontend calls `/api/auth/session` to get the user record and role.
4. Frontend creates an agent through `/api/agents/create`.
5. Frontend opens `wss://.../ws/voice` and sends a `session.update` containing the agent ID.
6. Backend validates that Easy Auth principal headers survived the WebSocket upgrade.
7. Backend connects to Azure VoiceLive using the configured Azure AI endpoint and API key.
8. Voice session traffic flows bidirectionally between browser and Azure VoiceLive through the backend proxy.
9. When the session ends, frontend sends transcript, audio chunks, and context to `/api/analyze`.
10. Backend calls analysis services, saves a session record to SQLite, and triggers a blob backup.
11. Therapist later reviews sessions through therapist-only endpoints.

### Sensitive data in motion

| Flow | Data | Notes |
|---|---|---|
| Browser to `/api/auth/session` | auth cookie, Easy Auth context | Session discovery |
| Browser to `/ws/voice` | live audio, partial transcripts, agent selection | High-volume, high-value real-time channel |
| Backend to Azure VoiceLive | audio, config, tools, instructions | Includes session instructions and voice config |
| Browser to `/api/analyze` | transcript, audio chunks, child ID, exercise metadata | This becomes persistent session data |
| Backend to SQLite | transcripts, assessments, reference text, feedback | Stored locally in `wulo.db` |
| Backend to Blob Storage | whole SQLite file | Expands blast radius if leaked |
| Backend to Application Insights | telemetry events and errors | Must not contain raw regulated payloads |

## Attacker Model

### Attacker classes

| Attacker | Capability | Likely goal | Incentive |
|---|---|---|---|
| Unauthenticated internet attacker | Public network access only | Abuse service, cause outage, exploit auth mistakes | Free compute, disruption, extortion |
| Authenticated low-privilege user | Valid login, browser tools, endpoint enumeration | Read other users' or children's records | Curiosity, privacy abuse, competitive misuse |
| Compromised therapist account | Legitimate session and therapist access | Bulk data extraction, silent misuse | Sensitive data theft, fraud |
| Malicious insider or operator | Portal access or runtime secret visibility | Access data, secrets, or logs; change policy | Data theft, sabotage |
| Supply-chain attacker | Dependency or CI/CD compromise | Inject code or steal deployment secrets | Persistence, cloud abuse |

### Goals, capabilities, incentive framing

This platform should assume attackers want one or more of the following:

- Read child transcripts, assessments, or therapist notes
- Start expensive voice and AI sessions to burn quota and cost
- Steal API keys or storage keys to use services directly
- Modify prompts, scenarios, or session data to influence output
- Use a real user account as cover for data exfiltration
- Use deployment or portal access to persist changes without immediate detection

## STRIDE Analysis

### B1: Browser to public ingress

| STRIDE | Threat | Current state | Impact | Primary defenses |
|---|---|---|---|---|
| Spoofing | Session hijack or replay through stolen browser auth | Easy Auth handles login, but browser session remains a primary trust anchor | Account takeover | Strong identity provider policy, session lifetime, conditional access |
| Tampering | Malicious client sends arbitrary JSON to APIs and WebSocket | App accepts user-controlled request bodies and voice session messages | Prompt abuse, malformed inputs, noisy logs | Server-side validation and schema enforcement |
| Repudiation | User denies action without strong audit trail | Limited route-level audit trail in app code | Weak forensics | Structured audit logs with immutable user ID |
| Information disclosure | Response bodies or config reveal internals | `/api/config` exposes app flags and `ws_endpoint` only; low sensitivity | Low | Keep config payload minimal |
| Denial of service | Connection flood or repeated expensive requests | No visible application-layer rate limiting in repo | High cost and availability risk | Rate limits, quotas, WAF, concurrency controls |
| Elevation of privilege | Client-side therapist UI toggle mistaken for server auth | Server-side therapist guard exists for therapist-only routes | Medium if future routes rely on UI only | Keep authorization on server only |

### B2: Easy Auth edge to Flask app

| STRIDE | Threat | Current state | Impact | Primary defenses |
|---|---|---|---|---|
| Spoofing | App trusts `X-MS-CLIENT-PRINCIPAL-*` headers if platform auth is bypassed or misconfigured | App directly reads these headers in [backend/src/app.py](../backend/src/app.py) | Catastrophic if ingress trust fails | Restrict ingress paths, verify platform auth invariants, avoid alternate bypass paths |
| Tampering | Malformed principal header causes inconsistent identity parsing | Base64 payload is decoded best-effort and falls back gracefully | Medium | Fail closed on malformed auth where appropriate |
| Repudiation | User creation and role changes are not strongly audited | `get_or_create_user` and role changes update SQLite without immutable audit record | Medium | Audit user provisioning and role changes |
| Information disclosure | Auth-derived identity stored locally in user table | Stored in SQLite and backup blob | Medium | Protect DB and backup path |
| Denial of service | Repeated auth-session bootstrap creates local user rows or load | Limited impact | Low | Standard throttling |
| Elevation of privilege | Therapist role escalation through `/api/users/<user_id>/role` by any therapist | Therapist-only, but no second-person approval or audit trail | High insider risk | Limit role admin, audit, approval workflow |

### B3: App to Azure AI and Speech services

| STRIDE | Threat | Current state | Impact | Primary defenses |
|---|---|---|---|---|
| Spoofing | Attacker uses stolen service key outside app | Keys are injected as secrets and read from env vars | Direct cloud abuse | Prefer managed identity where possible, rotate keys |
| Tampering | Prompt injection or scenario manipulation through custom scenario content | Custom scenarios are accepted from authenticated clients | Output manipulation, unsafe responses | Validate allowed scenario fields, role restrictions, content policy |
| Repudiation | No robust mapping from cloud usage to end-user action | Telemetry exists but not full cost-to-user traceability | Medium | Correlate user/session IDs to outbound usage |
| Information disclosure | More data than necessary sent to external AI services | Transcript, audio, and exercise metadata can be sent | High | Data minimization and explicit data-sharing policy |
| Denial of service | Repeated analyze, TTS, and WebSocket voice sessions consume quota | No visible per-user quotas | High | Per-user and per-tenant rate limits |
| Elevation of privilege | Agent or tool misuse changes session capability | Voice session includes tool configuration and optional Azure agent mode | Medium | Restrict tool surface and validate agent creation |

### B4: App to SQLite session store

| STRIDE | Threat | Current state | Impact | Primary defenses |
|---|---|---|---|---|
| Spoofing | Session data saved under attacker-controlled child identifiers | Client can submit `child_id` and `child_name` to `/api/analyze` | Data integrity issue | Server-side ownership checks and canonical child lookup |
| Tampering | Session, feedback, or role data modified by authorized but abusive user | Therapist-only protects some routes; DB is app-writable | High | Fine-grained authorization and immutable audit trail |
| Repudiation | No append-only audit log for session edits and feedback | Feedback updates overwrite current values | Medium | Separate audit log for review actions |
| Information disclosure | Plaintext transcripts and assessments in SQLite | Data stored in `sessions.transcript` and JSON columns | Critical | Encrypt at rest, minimize storage, define retention |
| Denial of service | SQLite lock contention or storage churn | Global lock reduces concurrency but limits scale | Medium | Move to managed database for production scale |
| Elevation of privilege | Horizontal access if lookup endpoints are not scoped correctly | Session detail and child session routes are therapist-only, but no tenant partitioning exists | High in multi-tenant future | Tenant-aware schema and row ownership checks |

### B5: App to Blob backup

| STRIDE | Threat | Current state | Impact | Primary defenses |
|---|---|---|---|---|
| Spoofing | Attacker with key writes a forged backup | Account key auth is used in [backend/src/services/blob_backup.py](../backend/src/services/blob_backup.py) | Restore poisoning | Managed identity and restricted write scope |
| Tampering | Backup blob replaced or deleted | Full DB backup is a single object name | High | Versioning, immutability, scoped roles |
| Repudiation | Limited audit from app layer for backup operations | App logs success/failure only | Medium | Storage audit logs and operation tracing |
| Information disclosure | Whole database exposed if blob or key leaks | Backup includes all session and user records | Critical | Eliminate account keys, private access, encryption, lifecycle policy |
| Denial of service | Backup path failures slow or disrupt writes indirectly | Backup is best-effort after writes | Low to Medium | Async queue or scheduled backup strategy |
| Elevation of privilege | Key reuse grants broad storage access | Account key is broad and long-lived | High | Replace with managed identity + narrow RBAC |

### B6: CI/CD and Azure control plane

| STRIDE | Threat | Current state | Impact | Primary defenses |
|---|---|---|---|---|
| Spoofing | Unauthorized deploy identity acts as trusted operator | `azd` and Azure principal access govern deploys | Catastrophic | Protected environments and least privilege |
| Tampering | Bicep or env values changed to weaken auth or leak secrets | Infra defines auth, secrets, and redirect hosts | High | Change review, branch protection, deployment approvals |
| Repudiation | Weak traceability for infra and secret changes | Depends on Azure activity logs and repo controls | High | Enforced audit retention and review |
| Information disclosure | Secrets leak via env files, deployment logs, portal visibility | Service keys and provider secrets exist in deployment path | High | Secret scanning, Key Vault, reduced portal exposure |
| Denial of service | Bad deploy breaks auth, storage, or AI connectivity | Single-replica app increases blast radius | High | Preview validation, staged rollout, rollback plan |
| Elevation of privilege | Over-broad RBAC on identity or operators | Managed identity has multiple Cognitive roles; storage uses account key | High | Role review and scoping |

## Current Top Risks

### 1. Sensitive session data is stored in plaintext

Evidence:

- [backend/src/services/storage.py](../backend/src/services/storage.py) stores transcript, reference text, AI assessment JSON, and pronunciation JSON directly in SQLite.
- [backend/src/services/blob_backup.py](../backend/src/services/blob_backup.py) uploads the same database file to blob storage.

Why it matters:

- A single database leak exposes the full history of user, child, and assessment data.

### 2. Long-lived service keys remain in the runtime path

Evidence:

- [backend/src/config.py](../backend/src/config.py) loads `AZURE_OPENAI_API_KEY`, `AZURE_SPEECH_KEY`, and blob storage account key.
- [infra/resources.bicep](../infra/resources.bicep) injects these as Container App secrets.

Why it matters:

- If runtime secrets leak through diagnostics, portal access, or memory disclosure, services can be called directly outside app controls.

### 3. No visible rate limiting on expensive operations

Evidence:

- Authenticated users can call `/api/analyze`, `/api/assess-utterance`, `/api/tts`, and `/ws/voice` repeatedly.
- No rate limiting or quota middleware is visible in the repo.

Why it matters:

- This is a direct availability and cost-exhaustion risk.

### 4. Identity trust depends heavily on correct Easy Auth deployment invariants

Evidence:

- [backend/src/app.py](../backend/src/app.py) trusts `X-MS-CLIENT-PRINCIPAL-*` headers and creates users from them.
- [backend/src/services/websocket_handler.py](../backend/src/services/websocket_handler.py) accepts WebSocket auth based on `HTTP_X_MS_CLIENT_PRINCIPAL_ID`.

Why it matters:

- If ingress auth is bypassed or misconfigured, identity spoofing becomes catastrophic.

### 5. Storage implementation differs from intended persistent-file-share design

Evidence:

- [infra/resources.bicep](../infra/resources.bicep) provisions Azure Files and environment storage.
- The same file sets `volumes: []`, `volumeMounts: []`, and `STORAGE_PATH=/tmp/wulo.db`.

Why it matters:

- Runtime durability and confidentiality assumptions are different from a mounted persistent store. The current design relies on blob backup rather than a mounted share.

## Recommended Priority Plan

| Priority | Action | Outcome |
|---|---|---|
| P0 | Define the authorization model: therapist, child, org, owner relationships | Prevent horizontal and vertical access mistakes before growth |
| P0 | Add rate limiting and abuse quotas for AI and voice endpoints | Reduce direct cost and availability attacks |
| P0 | Replace broad storage and AI keys with managed identity where supported | Shrink secret blast radius |
| P1 | Decide durable storage architecture and retention rules | Remove ambiguity around `/tmp` DB, backup behavior, and restore model |
| P1 | Add structured audit logging for role changes, consent, session review, and high-cost calls | Improve detection and forensics |
| P1 | Review custom-scenario and agent creation permissions | Reduce prompt and instruction abuse |
| P2 | Encrypt or tokenize especially sensitive persisted content | Reduce breach impact |
| P2 | Add environment and deployment protections for auth config and secrets | Reduce control-plane compromise risk |

## Security Control Checklist

Status values:

- Present: visible in current repo or Bicep
- Partial: some support exists but material gaps remain
- Missing: not visible in current repo or infra definition

| Control | Status | Repo / resource mapping | Notes |
|---|---|---|---|
| Edge authentication with Microsoft Entra / Google | Present | `infra/resources.bicep` authConfigs | Easy Auth returns 401 for protected paths |
| HTTPS required at app ingress | Present | `infra/resources.bicep` authConfigs.httpSettings.requireHttps | Good baseline |
| Server-side route authorization | Partial | `backend/src/app.py` | Therapist guards exist on review and admin-like routes, but broader ownership model is not defined |
| WebSocket authentication guard | Partial | `backend/src/services/websocket_handler.py` | Checks principal ID header only |
| Dev auth bypass protected in Azure-hosted runtime | Present | `backend/src/app.py` | `LOCAL_DEV_AUTH` is blocked in Azure-hosted environments |
| Per-user or per-route rate limiting | Missing | App layer | Needed for `/ws/voice`, `/api/analyze`, `/api/assess-utterance`, `/api/tts` |
| Input validation on JSON request bodies | Partial | `backend/src/app.py` | Required fields are checked, but schema and size controls are limited |
| Authorization model for child/session ownership | Partial | `backend/src/app.py`, `backend/src/services/storage.py` | Therapist-only review exists, but no tenant-aware ownership structure |
| Secure storage for child/session data | Partial | `backend/src/services/storage.py` | Stored locally in SQLite; no field-level protection visible |
| Durable storage architecture aligned to infra intent | Partial | `infra/resources.bicep`, `backend/src/config.py` | Azure Files is provisioned but not mounted; current live DB path is `/tmp/wulo.db` |
| Backup confidentiality and integrity protection | Partial | `backend/src/services/blob_backup.py`, Storage Account | Blob backup exists, but uses account key auth and no visible immutability/versioning controls |
| Managed identity for outbound service access | Partial | `infra/resources.bicep` | Identity exists and roles are assigned, but app still uses service keys for AI and storage |
| Secrets not exposed in source | Present | Repo | Secrets are read from env / Container App secrets, not hardcoded |
| Secrets minimized and rotated | Partial | `backend/src/config.py`, `infra/resources.bicep` | Several long-lived keys remain in runtime config |
| Audit logging for security-relevant actions | Partial | `backend/src/services/telemetry.py`, `backend/src/app.py` | Business events logged, but no full security audit trail |
| Azure Monitor / App Insights enabled | Present | `infra/resources.bicep` monitoring module | Must ensure telemetry does not leak regulated content |
| Role change governance | Partial | `/api/users/<user_id>/role` in `backend/src/app.py` | Therapist can change user role; stronger approval and logging recommended |
| Consent capture for therapist-led use | Present | `/api/pilot/state`, `/api/pilot/consent` | Stored in app settings table |
| CORS policy configured | Present | `infra/resources.bicep` | Limited origins set, but review needed for staging and custom hosts |
| Single-replica blast-radius awareness | Partial | `infra/resources.bicep` | `scaleMaxReplicas: 1` simplifies state but raises availability risk |
| Supply-chain controls for deploy path | Missing in repo evidence | Repo and Azure DevOps / GitHub controls | Needs explicit branch protection, secret scanning, env approval, and artifact trust controls |
| Activity-log review for Azure RBAC and config changes | Missing in repo evidence | Azure subscription / resource group | Operational control, not app code |

## Control Checklist by Azure Resource

| Azure resource | Current use | Main risks | Controls to verify |
|---|---|---|---|
| Container App `voicelab` | Hosts frontend and backend | Auth misconfig, secret exposure, DoS, bad deploy | Easy Auth policy, ingress restrictions, secret access review, scaling policy |
| Managed environment | Hosts Container App | Log exposure, storage attachment drift | Diagnostic settings, environment storage usage, network posture |
| AI Services / Azure OpenAI account | Voice and analysis | Key theft, quota abuse, data sharing | Role assignments, key rotation, data-sharing policy, quotas |
| Speech Services account | TTS and pronunciation | Key theft, abuse, cost burn | Key minimization, monitor usage, private endpoint decision |
| Storage account | Blob backup and prepared file share | DB disclosure, forged backup, over-broad access | Private access, blob versioning, key elimination, role scoping |
| Application Insights / Log Analytics | Telemetry and diagnostics | Sensitive data in traces, insider visibility | Sampling, redaction, retention, RBAC review |
| Container Registry | Image source | Malicious image or pull misuse | Least privilege pull role, image signing/scanning |
| User-assigned managed identity | Runtime identity | Over-broad RBAC | Role inventory and justification |

## End-to-End Flow Walk-Through

### Flow: therapist login to voice session to transcript storage

#### Step 1: Therapist arrives at the app

- Browser requests `/`.
- Public assets and `/api/health` are excluded from auth in `authConfigs`.
- Frontend uses Easy Auth login URLs such as `/.auth/login/aad` and `/.auth/login/google` from [frontend/src/app/App.tsx](../frontend/src/app/App.tsx).

Threats:

- Session theft in browser
- Weak identity-provider policy
- Misconfigured redirect hosts

Defenses:

- Easy Auth
- HTTPS required
- Restricted redirect URLs in `infra/resources.bicep`

Gaps:

- No repo-visible session anomaly detection or strong auth policy configuration beyond platform defaults

#### Step 2: Frontend discovers user identity and role

- Frontend calls `/api/auth/session` via [frontend/src/services/api.ts](../frontend/src/services/api.ts).
- Backend reads `X-MS-CLIENT-PRINCIPAL-*` headers in [backend/src/app.py](../backend/src/app.py).
- If a user record does not exist, backend creates one in SQLite and gives the first user the `therapist` role.

Threats:

- Auth header trust failure
- Accidental or malicious first-user bootstrap becoming therapist
- Poor auditability of role creation

Defenses:

- Easy Auth gate
- Local dev auth blocked in Azure-hosted environments

Gaps:

- No explicit invite or approval flow for initial therapist assignment
- No immutable audit trail for user provisioning and role changes

#### Step 3: Therapist starts a session and creates an agent

- Frontend calls `/api/agents/create`.
- Backend allows any authenticated user to create an agent.
- For custom scenarios, backend accepts therapist-authored prompt content and merges extra instructions.

Threats:

- Prompt tampering
- Excessive AI usage by low-privilege users
- Instruction abuse through custom scenarios

Defenses:

- Authentication required

Gaps:

- No rate limits
- No role-based restriction for custom or costly agent creation

#### Step 4: Browser opens the voice WebSocket

- Frontend resolves the WebSocket URL in [frontend/src/hooks/useRealtime.ts](../frontend/src/hooks/useRealtime.ts).
- Browser connects to `/ws/voice` and sends `session.update` with the selected `agent_id`.
- Backend checks for `HTTP_X_MS_CLIENT_PRINCIPAL_ID` in [backend/src/services/websocket_handler.py](../backend/src/services/websocket_handler.py).
- Backend opens an outbound VoiceLive session using the Azure AI endpoint and API key.

Threats:

- WebSocket flood
- Reuse of authenticated browser context to open many sessions
- Service-key theft enabling direct external cloud calls

Defenses:

- WebSocket principal header check
- Authenticated session requirement at ingress

Gaps:

- No per-user concurrency cap
- No quota or abuse controls
- API key still in runtime path

#### Step 5: Live session traffic flows

- User audio and transcript deltas flow from browser to backend and onward to Azure VoiceLive.
- Assistant audio and transcript events flow back through the backend to the browser.
- The backend can attach tools and scenario instructions to the VoiceLive session.

Threats:

- Sensitive speech content leaves the app boundary
- Prompt and tool misuse
- Verbose logs capturing sensitive session fragments

Defenses:

- TLS in transit
- Minimal server logic in forwarding path

Gaps:

- No explicit data minimization policy before sending to external AI services
- Need review of logging policy for real-time flows

#### Step 6: Session completion triggers transcript analysis

- Frontend sends `/api/analyze` with transcript, audio chunks, reference text, child metadata, and exercise context.
- Backend calls conversation analysis and pronunciation assessment.
- Backend saves the result through `StorageService.save_session()`.

Threats:

- User submits another child's identifiers
- Very large payloads cause cost or performance stress
- Sensitive data now becomes durable data

Defenses:

- Authentication required
- Some required-field validation

Gaps:

- No explicit payload size limits visible in code
- No ownership validation on submitted child identifiers

#### Step 7: Session data is written locally and backed up

- SQLite record includes transcript, reference text, AI assessment, pronunciation assessment, and therapist feedback fields.
- After writes, the app attempts a blob backup of the database file.

Threats:

- Plaintext data disclosure
- Backup poisoning or theft
- Durability confusion because live DB is on `/tmp`

Defenses:

- Blob container has `publicAccess: None`
- Storage account requires HTTPS and TLS 1.2+

Gaps:

- Account key auth is still used
- No visible blob immutability or versioning
- No clear retention and deletion policy

#### Step 8: Therapist reviews the saved session

- Therapist-only routes `/api/children`, `/api/children/<child_id>/sessions`, `/api/sessions/<session_id>`, and `/api/sessions/<session_id>/feedback` expose session history and notes.

Threats:

- Insider misuse by a therapist account
- Weak forensics on who viewed what

Defenses:

- Therapist role checks on review routes

Gaps:

- No detailed access audit trail
- No tenant partitioning if the app grows beyond a single small pilot model

## Questions to Resolve in the Next Threat-Model Review

1. Is this intended to remain a single-organization pilot or become multi-tenant?
2. What is the authoritative relationship between therapist, child, and session ownership?
3. Should raw audio ever be stored, or only transiently processed?
4. What are the retention and deletion requirements for child transcripts and assessments?
5. Which Azure services can move from key-based auth to managed identity now?
6. Is Azure Files meant to be the durable store, or is blob-backed local SQLite the intended production design?
7. What security events must alert an operator within minutes rather than be reviewed later?

## Immediate Next Steps

1. Decide and document the production data-store design.
2. Define the authorization model for therapist, child, and session ownership.
3. Add rate limiting and quota controls for voice and AI endpoints.
4. Replace broad storage and AI keys with managed identity where supported.
5. Add security audit logging for role changes, consent, session review, and high-cost calls.