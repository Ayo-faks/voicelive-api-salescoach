# Security Threat Model

Last rescanned: 2026-04-08

## Scope

This document describes the current threat model for the VoiceLive Sales Coach platform as it exists in this repository today.

It covers:

- The current backend, frontend, storage, and Azure deployment shape
- New features added since the earlier review, including child access control, invitations, parental consent, data export and deletion, governed child memory, institutional memory, recommendations, and Copilot planner-backed practice planning
- Threats across both the SQLite path and the PostgreSQL path
- A control checklist mapped to the repo and Azure resources
- Updated priorities based on the current attack surface

This is a current-state model. Where code, docs, and infrastructure disagree, that inconsistency is treated as a security and operations risk rather than ignored.

## What Changed Since The Previous Review

The previous threat model assumed a relatively simple design: Easy Auth, Flask APIs, WebSocket voice proxy, SQLite session storage, and blob backup.

That model is now incomplete. The platform has materially expanded:

- Child access is no longer just a therapist-only UI concern. There is now a user-to-child relationship model through `user_children`.
- Therapists can create invitations for parent access, and authenticated invitees can accept or decline them.
- The app now supports parental consent capture, child data export, and child data deletion workflows.
- The data model now includes child memory items, child memory proposals, memory evidence links, compiled summaries, institutional memory insights, recommendation logs, and practice plans.
- A PostgreSQL backend exists alongside SQLite, with Alembic migrations and row-level security policies.
- The runtime includes invitation email delivery through Azure Communication Services.
- The runtime includes Copilot planner support with either GitHub token auth or Azure BYOK provider settings.

These changes improve some risks, especially around child-level authorization and auditability, but they also create new attack paths and new trust boundaries.

## Current Architecture

### Runtime surfaces

The application now exposes these main runtime surfaces:

- Browser SPA and same-origin authenticated REST APIs in [backend/src/app.py](../backend/src/app.py)
- Realtime voice WebSocket proxy at `/ws/voice`
- Therapist-facing child, session, plan, recommendation, and memory APIs
- Parent-facing invitation acceptance, consent, and child data access flows
- Optional invitation email delivery through Azure Communication Services
- Optional Copilot planner runtime in-process in the backend

### Storage modes

The application supports two persistence modes:

#### SQLite mode

- Implemented by [backend/src/services/storage.py](../backend/src/services/storage.py)
- Still the default config value in [backend/src/config.py](../backend/src/config.py)
- Stores users, children, sessions, user-child relationships, invitations, audit events, plans, memory, recommendations, and consent in a local SQLite file
- Uses blob backup for the database file

#### PostgreSQL mode

- Implemented by [backend/src/services/storage_postgres.py](../backend/src/services/storage_postgres.py)
- Selected through [backend/src/services/storage_factory.py](../backend/src/services/storage_factory.py)
- Uses Alembic migrations in [backend/alembic/versions](../backend/alembic/versions)
- Introduces row-level security through [backend/alembic/versions/20260408_000006_invitation_rls.py](../backend/alembic/versions/20260408_000006_invitation_rls.py)
- Uses request-scoped identity settings `app.current_user_id`, `app.current_user_role`, and `app.current_user_email` to support database-side access control

### Azure deployment shape

The current infrastructure in [infra/resources.bicep](../infra/resources.bicep) provisions:

- Azure Container Apps with Easy Auth
- Azure AI Services / Azure OpenAI
- Azure Speech
- Azure Storage account, file share, and blob backup container
- Optional Azure Database for PostgreSQL Flexible Server
- Optional Azure Communication Services Email wiring
- Application Insights and Log Analytics
- Container Registry and a user-assigned managed identity

Important current details:

- The Container App now uses managed-identity-capable auth for Azure OpenAI and no longer injects `AZURE_OPENAI_API_KEY`, but it still injects long-lived secrets for Azure Speech, the PostgreSQL admin connection string used for migrations, optional Copilot GitHub token, auth provider secrets, and ACS connection strings.
- PostgreSQL is provisioned with public network access enabled and an `AllowAzureServices` firewall rule.
- The Container App still sets `STORAGE_PATH=/tmp/wulo.db` and leaves `volumes` and `volumeMounts` empty in the Bicep shown here.
- Some newer repo documentation describes Azure Files as mounted persistence, but the current Bicep still shows the runtime path as `/tmp/wulo.db` with blob backup.
- Easy Auth excludes these paths from authentication: `/`, `/index.html`, `/assets/*`, `/js/*`, `/manifest.json`, `/api/health`, `/logout`, `/wulo-logo.png`, `/favicon.ico`, `/privacy`, `/terms`, `/ai-transparency`.
- No CSRF protection is present in the application layer.

That means the storage architecture must be treated as:

- SQLite path: local container filesystem plus blob backup
- PostgreSQL path: external managed database over public network access with password auth

## Assets

| Asset | Examples | Sensitivity | Notes |
|---|---|---|---|
| Child profile data | child name, DOB, notes, relationship links | High | Directly identifying and regulated |
| Session data | transcripts, reference text, pronunciation, AI assessment, therapist feedback | High | Core sensitive therapy data |
| Child memory | approved items, proposals, evidence links, summaries | High | Durable derived knowledge about a child |
| Institutional memory | de-identified clinic-level patterns | Medium to High | Intended to be de-identified, but still needs re-identification controls |
| Practice plans | plan drafts, therapist messages, planner session IDs | High | Contains clinical context and future session design |
| Invitations and consent | invited email, guardian name, guardian email, consent flags | High | Sensitive relationship and compliance data |
| Audit events | who accessed which child, when, and why | High | Sensitive but also necessary for security and compliance |
| Auth context | Easy Auth headers, browser session cookies | High | Identity anchor for both REST and WebSocket paths |
| Cloud credentials | Speech key, Postgres admin password, Copilot GitHub token, ACS connection string | Critical | Direct cloud abuse if leaked |
| Control-plane access | Azure principals, deploy credentials, portal access | Critical | Can change auth, secrets, networking, and data handling |

## Trust Boundaries

| Boundary | From | To | Main risk |
|---|---|---|---|
| B1 | Browser | Public Container App ingress | Session theft, abuse, malformed requests, replay |
| B2 | Easy Auth edge | Flask app | Header trust, role bootstrap, auth bypass invariants |
| B3 | Flask authz layer | Child-scoped app operations | Broken access control across therapist, parent, and admin roles |
| B4 | Flask app | VoiceLive / Azure AI / Speech | Data over-sharing, quota abuse, key theft |
| B5 | Flask app | SQLite or PostgreSQL | Confidentiality, integrity, isolation, and deletion correctness |
| B6 | Flask app | Invitation email and external messaging | Email disclosure, invitation misuse, identity binding |
| B7 | Flask app | Copilot planner runtime | Prompt/data leakage, token misuse, planner drift |
| B8 | App / operators | Azure control plane | Secret exposure, network overexposure, weak RBAC, unsafe deploys |

## Key Data Flows

### 1. Therapist session and child access

1. User signs in through Easy Auth.
2. Backend creates or updates the local user record from Easy Auth headers.
3. Frontend calls `/api/auth/session`.
4. Child access is resolved through `user_children` relationships.

### 2. Invitation and parent onboarding

1. Therapist creates a child invitation through `/api/invitations`.
2. Invitation is stored with invited email and relationship.
3. Optional email is sent through Azure Communication Services.
4. Invitee signs in and accepts or declines using authenticated endpoints.

### 3. Live session and post-session persistence

1. Client opens `/ws/voice`.
2. Backend validates principal headers and proxies traffic to Azure VoiceLive.
3. Client later submits transcript and session context to `/api/analyze`.
4. Backend saves session data and may synthesize child memory proposals.

### 4. Therapist review and planning

1. Therapist fetches child sessions, memory summary, proposals, recommendations, and plans.
2. Therapist can create manual memory, approve or reject proposals, generate recommendations, and create or refine plans.
3. Planner may call Copilot SDK and Azure OpenAI or GitHub-backed auth depending on configuration.

### 5. Compliance and privacy operations

1. Therapist or parent with child access can manage parental consent.
2. Therapist, parent, or admin with child access can export child data. Export is a simple GET with no confirmation step.
3. Therapist, parent, or admin with child access can delete child data. Delete requires `{"confirm": true}` in the request body.

## Attacker Model

### Attacker classes

| Attacker | Capability | Likely goal |
|---|---|---|
| Unauthenticated attacker | Public HTTP and WebSocket access | Cost burn, outage, auth discovery, exploit misconfiguration |
| Authenticated parent user | Valid account tied to one or more children | Horizontal access to other children, session or invitation misuse |
| Authenticated therapist user | Valid account with therapist privileges | Excessive data access, abusive exports, role misuse |
| Admin or operator | Portal or deploy access | Secret access, data exfiltration, policy weakening |
| Supply-chain attacker | Dependency, CLI token, or build pipeline compromise | Runtime secret theft, malicious deploy, persistence |

### Incentives

Realistic motivations now include:

- Extracting therapy data, consent data, or child identifiers
- Using expensive AI and voice services at the platform's cost
- Misusing invitation flows to widen access to child records
- Pulling durable memory and plans that reveal sensitive child patterns
- Exfiltrating data through export endpoints or institutional memory summaries
- Harvesting secrets from runtime config, logs, or deployment surfaces

## STRIDE Analysis

### B1. Browser to public ingress

| STRIDE | Threat | Current state | Risk |
|---|---|---|---|
| Spoofing | Stolen browser session or replay | Easy Auth is the main session boundary | High |
| Tampering | Arbitrary JSON payloads to analyze, invite, plan, consent, and delete flows | App validates required fields but not full schemas or broad payload bounds | High |
| Repudiation | User disputes actions | Audit logging now exists, which is better than before | Medium |
| Information disclosure | Browser responses reveal internal details | `/api/config` remains low sensitivity | Low |
| Denial of service | Flood `/ws/voice`, `/api/analyze`, `/api/plans`, `/api/recommendations` | No visible application-layer rate limiting | High |
| Elevation of privilege | Relying on UI mode instead of server access control | Server-side child access checks now exist | Lower than before, still needs discipline |

### B2. Easy Auth edge to Flask app

| STRIDE | Threat | Current state | Risk |
|---|---|---|---|
| Spoofing | Forged `X-MS-CLIENT-PRINCIPAL-*` headers if platform auth is bypassed | App still trusts platform headers directly | Critical if ingress trust breaks |
| Tampering | Malformed principal payload or missing claims | App decodes best-effort and falls back | Medium |
| Repudiation | Silent role or user bootstrap changes | User records are created or updated from auth headers | Medium |
| Information disclosure | Email and identity stored locally | Present in both storage modes | Medium |
| Denial of service | Repeated auth-driven user bootstrap or auth churn | Limited direct impact | Low |
| Elevation of privilege | First-user or therapist-driven role changes | `/api/users/<user_id>/role` can set therapist, parent, or admin | High |

### B3. Child-scoped authorization model

| STRIDE | Threat | Current state | Risk |
|---|---|---|---|
| Spoofing | User claims access to child through crafted IDs | App checks `user_has_child_access` before sensitive child operations | Lower than before |
| Tampering | Unauthorized changes to child data, consent, or plans | Child access checks now exist, but permissions are broad once access is granted | Medium to High |
| Repudiation | Actor denies exporting or deleting child data | Audit log exists for key flows | Medium |
| Information disclosure | Parent or therapist accesses data outside intended relationship | Access model depends on correct `user_children` mapping | High if mappings are wrong |
| Denial of service | Invite spam, repeated export/delete attempts | No visible rate limits or abuse throttles | Medium |
| Elevation of privilege | Therapist can invite parent, parent can gain child access, admin can see all | Intentional model, but invitation and role governance are sensitive | High |

Important update:

- The PostgreSQL path now has row-level security policies in [backend/alembic/versions/20260408_000006_invitation_rls.py](../backend/alembic/versions/20260408_000006_invitation_rls.py).
- That materially reduces risk for the Postgres backend because database-side enforcement exists for children, sessions, plans, memory, recommendations, audit logs, and invitations.
- The SQLite path still relies entirely on application code for isolation.

### B4. Voice and AI boundary

| STRIDE | Threat | Current state | Risk |
|---|---|---|---|
| Spoofing | Service use outside app via leaked credentials | Azure OpenAI now uses managed identity-capable auth, but Speech keys and other runtime secrets remain | High |
| Tampering | Prompt or plan manipulation via custom scenarios or therapist messages | Therapist-authored scenario and planner inputs are accepted | Medium |
| Repudiation | Weak mapping from AI usage to user action | Some telemetry exists, but cloud-cost accountability is still partial | Medium |
| Information disclosure | Child transcripts, memory context, or plan context sent to external AI | Present in voice, analysis, and planner workflows | High |
| Denial of service | AI cost exhaustion through repeated requests | No visible quotas on voice, analysis, or planning | High |
| Elevation of privilege | Tooling or planner surfaces grant unintended capability | Voice tools and planner context now widen the consequence of prompt abuse | Medium |

### B5. Persistence and data lifecycle

| STRIDE | Threat | Current state | Risk |
|---|---|---|---|
| Spoofing | Records written against wrong child | `_save_completed_session` now requires `child_id`, which is better than the earlier fallback model | Medium |
| Tampering | Sessions, plans, memory, and consent modified by authorized but abusive users | More durable entities mean more high-value write paths | High |
| Repudiation | Export, delete, approve, reject, and plan changes disputed later | Audit log helps, but needs retention and review policy | Medium |
| Information disclosure | Sensitive data stored durably in sessions, plans, memory, consent, invitations, audit logs | Plaintext application-level content still exists in both storage modes | Critical |
| Denial of service | Large or repeated writes, delete operations, export operations | Moderate | Medium |
| Elevation of privilege | Bypass through storage backend differences | Postgres path benefits from RLS; SQLite path does not | High residual risk in SQLite |

### B6. Invitations and email delivery

| STRIDE | Threat | Current state | Risk |
|---|---|---|---|
| Spoofing | Accept invitation by matching invited email under a compromised account | Invitation visibility and updates depend on authenticated email equality or inviter/admin role | Medium |
| Tampering | Invitation reuse, resend, revoke, or status manipulation | Invitation lifecycle is explicit and audited | Medium |
| Repudiation | Invitee denies receipt or response | Email delivery records exist in storage | Lower than before |
| Information disclosure | Invitation emails leak child name, therapist identity, or relationship context | Email is an external disclosure channel by design | High |
| Denial of service | Invitation spam or resend abuse | No visible throttling | Medium |
| Elevation of privilege | Invitation grants child access to a new actor | This is an intended privilege expansion and must be tightly governed | High |

### B7. Copilot planner runtime

| STRIDE | Threat | Current state | Risk |
|---|---|---|---|
| Spoofing | Misuse of GitHub token or Azure BYOK provider | Optional Copilot token and Azure provider settings are present | High |
| Tampering | Therapist messages steer plans unsafely | Expected behavior, but needs validation and clinician review | Medium |
| Repudiation | Plan generation source unclear | Plans include planner session and conversation state, but not a full immutable reasoning record | Medium |
| Information disclosure | Sensitive child/session context sent into planner runtime | High-value context crosses another outbound trust boundary | High |
| Denial of service | Planner endpoint used heavily or blocks runtime | Planner readiness exists, but no visible rate controls | Medium to High |
| Elevation of privilege | Planner output trusted too much in downstream decisions | Human approval exists for plan approval, which is a useful control | Medium |

### B8. Azure control plane and infrastructure

| STRIDE | Threat | Current state | Risk |
|---|---|---|---|
| Spoofing | Unauthorized operator or deploy identity | Standard Azure risk; not directly mitigated in repo | High |
| Tampering | Bicep or env changes weaken auth, networking, or secrets | Infra now controls more sensitive resources, including Postgres and ACS | High |
| Repudiation | Secret and RBAC changes are not reviewed | Depends on Azure activity logs and repo discipline | High |
| Information disclosure | Secrets include Speech key, Postgres admin URL, Copilot token, provider secrets, and ACS connection string | Broad secret surface in Container App remains | Critical |
| Denial of service | Postgres public exposure, bad deploys, or single-replica outages | Still single replica; Postgres public network access is enabled | High |
| Elevation of privilege | Over-broad RBAC or admin DB credentials in app | Postgres admin connection string in runtime is a notable escalation risk | Critical |

## Current Strengths

The platform is stronger than the previous review in several important ways:

- Child access control now exists at the application layer. All child-scoped endpoints consistently call `_require_child_access()` before accessing data.
- PostgreSQL has real row-level security policies. The `system_bypass_rls` flag is properly controlled — it is only activated when no authenticated user is present (i.e., during system-level operations like migrations), and cannot be set by application code during normal request handling.
- WebSocket connections at `/ws/voice` properly validate Easy Auth headers and close immediately if the user is unauthenticated.
- Sensitive child operations such as export, delete, consent, invitation, and review are explicit flows rather than ad hoc behavior.
- Audit logging exists for many sensitive operations including export, delete, consent changes, and invitation lifecycle.
- Local dev auth still fails closed in Azure-hosted environments.
- The delete endpoint requires explicit confirmation (`{"confirm": true}`), which is a useful friction control.

These are real improvements and materially reduce the likelihood of the simplest horizontal-access failures, especially in PostgreSQL mode.

## Current Highest-Risk Findings

### 1. Secrets are still too broad and too powerful in runtime

Evidence:

- [infra/resources.bicep](../infra/resources.bicep) no longer injects an Azure OpenAI key, but it still injects the Speech key, optional Postgres admin URL, optional Copilot GitHub token, provider secrets, and ACS connection string into the container.

Why it matters:

- A runtime compromise can still expose invitation delivery, database administration, Speech usage, and provider credentials.

### 2. PostgreSQL uses public network access plus privileged migration access in runtime

Evidence:

- [infra/resources.bicep](../infra/resources.bicep) provisions PostgreSQL Flexible Server with `publicNetworkAccess: 'Enabled'` and `AllowAzureServices` firewall rule.
- The app still receives `DATABASE_ADMIN_URL` as a secret for migrations, even though the staged runtime connection now uses a separate `wuloapp` role.

Why it matters:

- Even though staging now proves the live application can run as `wuloapp`, the network surface is still broad and the runtime still carries a privileged admin URL.

### 3. SQLite remains a weaker security mode than PostgreSQL

Evidence:

- [backend/src/config.py](../backend/src/config.py) still defaults `DATABASE_BACKEND` to `sqlite`.
- SQLite has no database-enforced tenant isolation.

Why it matters:

- If some environments still run SQLite, access control depends entirely on the Flask layer.

### 4. The attack surface now includes export, delete, invitation, consent, memory, recommendations, and plans

Evidence:

- New endpoints in [backend/src/app.py](../backend/src/app.py) expose more privileged workflows.

Why it matters:

- There are more irreversible or compliance-sensitive actions now, and more places where authorization or abuse controls must be correct.

### 5. Export endpoint lacks confirmation safeguard

Evidence:

- The `/api/children/<child_id>/data-export` endpoint is a simple GET that returns all child data immediately. Unlike the delete endpoint, it does not require a `confirm` flag or any secondary confirmation.
- Any user with child access can trigger a full data export with a single unauthenticated-looking request (auth is handled at the Easy Auth edge).

Why it matters:

- Data export is a high-value exfiltration vector. The delete endpoint already requires `{"confirm": true}`, but export does not. This asymmetry is a gap.

### 6. No CSRF protection on state-changing endpoints

Evidence:

- No CSRF tokens, middleware, or libraries are present in `requirements.txt` or `app.py`.
- The application is a same-origin SPA, which provides some natural protection, but state-changing POST/PUT/DELETE endpoints accept JSON without origin or referer validation.

Why it matters:

- A malicious page could potentially trigger state-changing actions (invitation creation, consent updates, child deletion) if a user's browser has an active Easy Auth session. The risk is moderate because JSON content-type requests are harder to forge cross-origin, but it is not zero.

### 7. No visible abuse throttling for expensive or high-risk actions

Evidence:

- No app-level rate limiting is visible for `/ws/voice`, `/api/analyze`, `/api/plans`, `/api/invitations`, `/api/children/<id>/data-export`, or `/api/children/<id>/data`.

Why it matters:

- Cost exhaustion and operational abuse remain straightforward.

### 8. Institutional memory and de-identified insight add re-identification risk

Evidence:

- [backend/src/services/institutional_memory_service.py](../backend/src/services/institutional_memory_service.py) intentionally derives clinic-level insights from approved child memory and reviewed sessions.

Why it matters:

- In small clinics or low-volume target sounds, de-identification may be weaker than intended.

### 9. Planner integration adds a new outbound sensitive-data boundary

Evidence:

- [backend/src/services/planning_service.py](../backend/src/services/planning_service.py) sends planning context to the Copilot SDK runtime and can use GitHub token auth or Azure BYOK.

Why it matters:

- Child/session context can leave the core app boundary in a new way, and token misuse risk increases.

## Security Control Checklist

Status values:

- Present: visible and implemented
- Partial: implemented with important gaps
- Missing: not visible in current repo or infra

| Control | Status | Mapping | Notes |
|---|---|---|---|
| Easy Auth at ingress | Present | [infra/resources.bicep](../infra/resources.bicep) | Core auth boundary remains in place |
| HTTPS required | Present | [infra/resources.bicep](../infra/resources.bicep) | Good baseline |
| Child-scoped authorization in app | Present | [backend/src/app.py](../backend/src/app.py) | Major improvement over earlier model |
| Database-enforced tenant isolation | Partial | [backend/alembic/versions/20260408_000006_invitation_rls.py](../backend/alembic/versions/20260408_000006_invitation_rls.py) | Present for Postgres only, absent for SQLite |
| Audit logging for sensitive child operations | Present | [backend/src/app.py](../backend/src/app.py), [backend/src/services/storage.py](../backend/src/services/storage.py), [backend/src/services/storage_postgres.py](../backend/src/services/storage_postgres.py) | Good progress |
| Explicit invitation lifecycle | Present | [backend/src/app.py](../backend/src/app.py) | Includes resend, revoke, accept, decline |
| Email delivery tracking | Present | storage invitation delivery tables | Useful forensic control |
| Parental consent capture | Present | [backend/src/app.py](../backend/src/app.py) | Good compliance step |
| Child data export and deletion | Present | [backend/src/app.py](../backend/src/app.py) | Delete requires confirmation; export does not |
| Role governance | Partial | `/api/users/<user_id>/role` | Still sensitive; needs stronger admin controls |
| Rate limiting and abuse quotas | Missing | app layer and edge | Still a major gap |
| Secret minimization | Partial | [infra/resources.bicep](../infra/resources.bicep) | Azure OpenAI key is gone, but Speech, ACS, and migration/admin secrets remain |
| Managed identity for storage/database | Partial | infra + runtime | Blob and Postgres still rely on secrets/passwords |
| Planner approval gate | Present | plan approval endpoint | Human approval is required before final plan use |
| Data minimization to AI/planner/email | Partial | app services | Needs clearer policy and enforcement |
| Postgres network hardening | Partial | [infra/resources.bicep](../infra/resources.bicep) | RLS is strong, but public access remains enabled |
| Invitation abuse controls | Missing | app layer | No visible throttling or risk scoring |
| CSRF protection | Missing | app layer | No tokens, origin checks, or middleware |
| Export/delete safeguard controls | Partial | confirm flag, authz, audit | Delete has confirm flag; export has none |
| Institutional memory re-identification controls | Partial | service logic | De-identification intent exists, but small-population risk remains |

## Azure Resource Checklist

| Resource | Current role | Main security concern |
|---|---|---|
| Container App `voicelab` | Runs API, SPA, planner, and proxy | Large secret surface and single runtime blast radius |
| PostgreSQL Flexible Server | Optional primary persistent store | Public network access and admin-password connection string |
| Storage account | Blob backup and file share | Account-key auth remains broad |
| Azure AI / OpenAI | Voice and analysis | Managed-identity-capable auth is in place, but data-sharing scope still needs review |
| Speech Services | TTS and assessment | Key-based abuse and cost burn |
| ACS Email | Invitation delivery | Sensitive outbound identity and invitation data |
| Application Insights / Log Analytics | Telemetry and diagnostics | Sensitive event and exception leakage |
| User-assigned managed identity | Runtime identity | Underused relative to remaining secrets |

## Updated Priority Plan

### P0

1. Make PostgreSQL with RLS the only production persistence mode.
2. Reduce runtime secret blast radius further: keep Azure OpenAI on managed identity, remove Speech key injection when the SDK path is lower risk, and narrow the remaining admin-level Postgres secret exposure.
3. Add rate limiting and quota controls for `/ws/voice`, `/api/analyze`, `/api/plans`, `/api/invitations`, data export, and data deletion.
4. Tighten role governance so therapist users cannot casually escalate to admin-like capabilities without stronger controls.

### P1

1. Harden PostgreSQL networking: private access or narrower firewall strategy instead of broad public access plus `AllowAzureServices`.
2. Add confirmation safeguard to the export endpoint to match the delete endpoint.
3. Add CSRF mitigation: at minimum, validate `Content-Type: application/json` on state-changing endpoints and consider origin header checks.
4. Review invitation email content and retention to ensure minimum necessary disclosure.
5. Add explicit privacy review for planner data and institutional memory re-identification risk.

### P2

1. Reconcile repo docs and Bicep around SQLite and Azure Files persistence so operators and engineers have one true model.
2. Add structured security alerting on exports, deletes, role changes, invitation spikes, and recommendation/plan generation anomalies.
3. Review whether all audit log metadata is necessary and ensure it does not become a secondary data leak.
4. Add input validation library (e.g., marshmallow or pydantic) for structured schema enforcement on all API endpoints, replacing manual `.get()` and `.strip()` checks.

## Explicit Security Requirements

The highest-risk findings above should be treated as explicit engineering requirements rather than advisory guidance.

Owner labels in this section mean the primary implementation owner:

- Backend: Flask app, authz, request validation, audit events, API behavior
- Platform: Azure infrastructure, runtime identity, secret delivery, network topology, deployment controls
- Data: persistence model, database roles, RLS, export and delete semantics
- Security/Compliance: control design review, evidence review, privacy and regulatory sign-off

| ID | Requirement | Primary owner | Acceptance criteria |
|---|---|---|---|
| SR-01 | Production environments must use PostgreSQL with RLS as the only supported persistence mode. SQLite may remain for local development or isolated non-production use only. | Platform + Data | Production config rejects `DATABASE_BACKEND=sqlite`; deployment docs and environment templates set Postgres by default; startup or deploy validation fails if production points at SQLite; at least one automated test verifies Postgres request actor context and RLS-backed access to child-scoped records. |
| SR-02 | The application runtime must not use an admin-grade PostgreSQL connection string. It must connect with a least-privilege application role that cannot bypass RLS or perform unmanaged schema changes. | Platform + Data | Runtime secret no longer contains admin credentials; a dedicated application database role exists with only required table and sequence permissions; application queries succeed under that role; migration tasks run under a separate privileged identity; a documented check confirms the runtime role cannot set `app.system_bypass_rls` to an unsafe value or disable RLS. |
| SR-03 | Runtime secret blast radius must be reduced by replacing broad shared secrets with managed identity or scoped credentials wherever the platform supports it. | Platform | Container App no longer receives unused or over-broad secrets; blob access uses managed identity or a narrowly scoped alternative instead of an account key; planner, AI, and email integrations each use the minimum credential scope available; secret inventory in infra is documented and each secret has a justification. |
| SR-04 | PostgreSQL network exposure must be narrowed so the database is not broadly reachable over public network access in steady state. | Platform | `publicNetworkAccess` is disabled or replaced with a narrowly controlled private access pattern; the `AllowAzureServices` firewall rule is removed from steady-state production; deployment documentation explains emergency access procedure; connectivity checks confirm the app still works through the intended path. |
| SR-05 | High-cost and high-risk endpoints must enforce abuse controls at the edge or application layer. | Backend + Platform | `/ws/voice`, `/api/analyze`, `/api/plans`, `/api/invitations`, export, and delete flows have request throttles or quotas; limits are differentiated by actor or endpoint sensitivity where appropriate; over-limit responses are observable in telemetry; automated tests cover at least one throttled REST path. |
| SR-06 | State-changing endpoints must implement CSRF mitigation suitable for the Easy Auth session model. | Backend + Security/Compliance | POST, PUT, PATCH, and DELETE routes reject requests that fail the chosen CSRF policy; the policy is documented; at minimum, the app enforces JSON-only state-changing requests and validates trusted origin or equivalent signal; regression tests prove cross-site style requests without the required signal are rejected. |
| SR-07 | Child data export must require explicit privileged-action confirmation and produce an auditable reason trail comparable to child deletion. | Backend + Data | Export is no longer a one-step GET returning full data; export requires an explicit confirmation step or signed action token; the request records actor, child, timestamp, and reason in audit storage; automated tests verify export without confirmation is rejected and export with confirmation succeeds. |
| SR-08 | Role management must be restricted so therapist users cannot grant admin-equivalent access without stronger governance. | Backend + Security/Compliance | `/api/users/<user_id>/role` no longer allows ordinary therapist users to assign `admin`; role elevation rules are documented; privileged role changes are audited with actor and target; automated tests verify unauthorized role escalation attempts fail. |
| SR-09 | Planner, invitation email, and institutional-memory flows must enforce minimum necessary disclosure. | Backend + Security/Compliance | Planner requests exclude unnecessary child/session fields; invitation emails disclose only the minimum needed to complete onboarding; institutional-memory generation documents its de-identification rules and rejects outputs below minimum aggregation thresholds; at least one review artifact exists for planner/privacy decisions. |
| SR-10 | API request bodies for sensitive workflows must be schema-validated rather than relying on ad hoc field checks. | Backend | Sensitive endpoints such as invitations, consent updates, plan generation, recommendation generation, export, and delete use a shared validation layer; malformed payloads fail consistently with bounded error responses; tests cover missing required fields, wrong types, and oversized values for at least one endpoint in each sensitive workflow family. |
| SR-11 | Security-significant actions must emit reviewable telemetry and alerts. | Platform + Security/Compliance | Exports, deletes, role changes, invitation spikes, and unusual plan or recommendation generation volumes are queryable in telemetry; at least one alerting rule exists for anomalous privileged activity; the runbook identifies who reviews those alerts and how often. |

## Suggested Ownership Mapping

If the project needs concrete accountable functions rather than generic owner labels, use this mapping:

- Backend owner: the engineer changing [backend/src/app.py](../backend/src/app.py) and related services
- Platform owner: the engineer changing [infra/resources.bicep](../infra/resources.bicep), `azure.yaml`, and deployment environment settings
- Data owner: the engineer responsible for [backend/src/services/storage_postgres.py](../backend/src/services/storage_postgres.py) and Alembic migrations in [backend/alembic/versions](../backend/alembic/versions)
- Security/Compliance owner: the reviewer responsible for threat model updates, privacy review, and release gating for privileged data flows

## Production Release Checklist

**Rule: No production rollout is permitted while any SR-01 through SR-08 requirement has status "Not met."**

Each row must show evidence (test name, config proof, or review artifact) before status changes to "Met."

| Requirement | Status | Evidence |
|---|---|---|
| SR-01 Postgres-only production | Met | `test_create_storage_service_rejects_sqlite_in_azure` in `test_storage_factory.py`; `_is_azure_hosted_environment()` guard in `storage_factory.py` |
| SR-02 Least-privilege DB role | Partially met | Runtime/admin DB URLs are split; migrations now run from `DATABASE_ADMIN_URL`; runtime role provisioning is supported in [backend/src/services/postgres_migrations.py](../backend/src/services/postgres_migrations.py); staging now validates `wuloapp` as the live runtime role |
| SR-03 Secret blast radius reduction | Partially met | Blob backup key injection removed; separate runtime/admin DB secrets added in [infra/resources.bicep](../infra/resources.bicep); Azure OpenAI runtime auth now uses managed identity-capable auth without `AZURE_OPENAI_API_KEY` |
| SR-04 Postgres network hardening | Not met | — |
| SR-05 Rate limiting | Met | Rate limiting added in [backend/src/app.py](../backend/src/app.py); verified by [backend/tests/unit/test_app.py](../backend/tests/unit/test_app.py) |
| SR-06 CSRF mitigation | Met | Origin/referer and JSON-body checks added in [backend/src/app.py](../backend/src/app.py); verified by [backend/tests/unit/test_app.py](../backend/tests/unit/test_app.py) |
| SR-07 Export confirmation | Met | `test_export_rejects_get_request`, `test_export_rejects_without_confirm`, `test_export_rejects_without_reason`, `test_export_succeeds_with_confirm_and_reason` in `test_auth_roles.py` |
| SR-08 Role governance | Met | `test_therapist_cannot_assign_admin_role`, `test_admin_can_assign_admin_role`, `test_therapist_can_still_assign_therapist_and_parent` in `test_auth_roles.py` |

## Bottom Line

The platform is materially more mature than the last review suggested.

The biggest positive change is the shift from broad therapist-only access toward a child-scoped authorization model, plus PostgreSQL row-level security.

The biggest remaining risks are not simple missing auth checks anymore. They are:

- Broad runtime secrets
- Publicly reachable PostgreSQL with password auth
- Expanded privileged workflows without abuse throttling
- New sensitive outbound channels through email and planner integrations
- Uneven security posture between SQLite mode and PostgreSQL mode
- No CSRF protection and no structured input validation

The right next move is not another generic STRIDE pass. It is to harden the production mode around Postgres + RLS, reduce secret scope, add abuse controls to the new privileged endpoints, and close the CSRF and export-confirmation gaps.