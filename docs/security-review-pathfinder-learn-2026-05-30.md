# Pathfinder Learn MVP — Pre-Pilot Security Review

**Reviewer:** Senior Application-Security Engineer (read-only assessment)
**Date:** 2026-05-30
**Scope:** `voicelive-api-salescoach/` (Flask 3.1 + flask-sock backend, React/Vite frontend, Azure Container Apps + Postgres Flexible Server)
**Audience of product:** MINORS (JSS3/SS3, ~Year 9 and Year 13). Child safety, PII protection, and tenant isolation are treated as the highest-severity classes.
**Standards mapped:** OWASP Top 10 (2021), OWASP LLM Top 10 (2023).
**Constraint honoured:** No code was modified. No secrets are reproduced — only `file:line` references.

---

## 1. Executive Summary

**Overall risk posture: HIGH. Recommendation for an MVP pilot with minors: NO-GO until the Critical and the safeguarding/tenant-isolation High findings are remediated.**

The product is built with several genuinely good controls: a fail-closed local-dev auth bypass, global CSRF origin + rate-limit enforcement on `/api/*`, properly authenticated and role-scoped WebSocket voice endpoints, fail-closed offline-pack signature verification, fail-closed RAG grounding, cookie-based (non-spoofable) client auth, append-only safeguarding event tables, and no unsafe deserialization. The Postgres row-level-security (RLS) design is well-intentioned.

However, the **core Pathfinder Learn API surface (`/api/learning/*`) has no authentication or authorization at all** (F1). Every learning handler trusts `tenant_id`, `student_id`, `teacher_id`/`actor_id` supplied in the **request body**, and the RLS session variable that is supposed to enforce tenant isolation is **never bound from an authenticated identity** on that surface. This means any caller who can reach the API can read or mutate any tenant's children's data — diagnostics, mastery, approvals, student profiles, memory, and audit records. For a product serving minors, this is a disqualifying defect on its own.

Compounding this: safeguarding intervention is advisory rather than server-enforced (F2); the Postgres server is exposed to the public Azure network and the **admin (RLS-bypassing) database URL is injected into the runtime container** (F3, F4); there are no HTTP security headers / CSP (F5); and minors' raw transcripts/PII are sent to LLM and Speech services before redaction (F6).

**Go/No-Go:** **NO-GO** for a pilot involving real minors until F1–F6 are addressed. F1 alone is a hard blocker.

---

## 2. Findings Table (ordered by severity)

| ID | Title | Severity | OWASP | File:line | Status |
|----|-------|----------|-------|-----------|--------|
| F1 | No authN/authZ on `/api/learning/*`; tenant/actor taken from request body; RLS never bound | **Critical** | A01:2021 / LLM06 | `backend/src/learning/api.py:2192,2210,514,743,973,1058` | Confirmed |
| F2 | Safeguarding pause is fire-and-forget/advisory; server keeps streaming; single env kill-switch | **High** | A04:2021 (safety) | `backend/src/services/websocket_handler.py:254-336`; `pipeline.py:18,39` | Confirmed |
| F3 | Postgres `publicNetworkAccess: Enabled` + `AllowAzureServices` 0.0.0.0 firewall rule | **High** | A05:2021 | `infra/resources.bicep:382,399-405,434` | Confirmed |
| F4 | Admin (RLS-bypassing) DB connection string injected into runtime container env | **High** | A01/A05:2021 | `infra/resources.bicep:535,762-763` | Confirmed |
| F5 | No HTTP security headers and no CSP (server-side or `index.html`) | **High** | A05:2021 | `backend/src/app.py` (no `after_request`); `frontend/index.html` | Confirmed |
| F6 | Minors' raw transcripts/PII sent to LLM + Speech before redaction | **High** | A03:2021 / LLM06 | `backend/src/services/analyzers.py:164-192`; `app.py:670-671` | Confirmed |
| F7 | No `Origin` check on WebSocket upgrades (Cross-Site WebSocket Hijacking) | **Medium** | A01:2021 (CSRF) | `backend/src/app.py:4935,5025` | Confirmed |
| F8 | Prompt injection: untrusted free-text embedded into LLM prompts without delimiting | **Medium** | A03:2021 / LLM01 | `report_pipeline.py:240-265`; `planning_service.py:717-724` | Confirmed |
| F9 | LLM/back-end markdown rendered without `rehype-sanitize`/DOMPurify | **Medium** | A03:2021 | `frontend/src/components/InsightsRail.tsx:915-920` | Confirmed |
| F10 | Default repo backend is in-memory; sqlite also in-memory → zero RLS if misconfigured | **Medium** | A05:2021 | `backend/src/learning/repository_factory.py` | Confirmed |
| F11 | Secrets passed as plaintext Bicep params (no Key Vault) → live in azd/deploy history | **Medium** | A05:2021 | `infra/main.bicep:28,35,64`; `infra/resources.bicep:520-592` | Confirmed |
| F12 | `child_id`/`conversation_id` placed in WebSocket query string → logged as PII | **Medium** | A09:2021 (privacy) | `frontend/src/hooks/useInsightsVoice.ts:91-120` | Confirmed |
| F13 | Image asset endpoint path param; relies on Flask normalisation, no explicit guard | **Low** | A01:2021 | `backend/src/app.py:4926-4932` | Confirmed (mitigated) |
| F14 | SQLite f-string PRAGMA/ALTER interpolation (hardcoded callers only) | **Low** | A03:2021 | `backend/src/services/storage.py:94,1008,1012` | Confirmed (safe in practice) |
| G1 | CSRF origin + rate limiting present on `/api/*` | Info (good) | — | `backend/src/app.py:905,954` | Confirmed |
| G2 | `LOCAL_DEV_AUTH` fail-closed in Azure | Info (good) | — | `backend/src/app.py` (import guard) | Confirmed |
| G3 | WebSocket endpoints authenticate + role/scope check | Info (good) | — | `backend/src/app.py:4952-4970,5025-5078` | Confirmed |
| G4 | Offline-pack signature verification fail-closed | Info (good) | — | `backend/src/learning/offline_pack.py:265-410` | Confirmed |
| G5 | RAG grounding fail-closed ("no citation, no answer") | Info (good) | — | `backend/src/learning/rag.py:190-237` | Confirmed |
| G6 | No unsafe deserialization (`pickle`/`yaml.load`/`eval`) | Info (good) | — | (0 matches) | Confirmed |

---

## 3. Per-Finding Detail

### F1 — Critical — Broken access control on the entire Pathfinder Learn API
**OWASP:** A01:2021 Broken Access Control (also LLM06 Sensitive Information Disclosure)
**Files:** `backend/src/learning/api.py:2192` (`register_learning_api`), `:2210` (`_wrap`), identity-from-body at `:514, 743, 782, 973, 1058, 1070, 1086, 1215, 1326, 1337`; RLS binding gap in `backend/src/services/storage_postgres.py:165-195`.

**Description.** `register_learning_api()` registers ~50 `/api/learning/*` routes. Each handler is wrapped by `_wrap`, which provides **only** OpenTelemetry observability and payload reading — **no authentication and no authorization**. Every handler derives the security principal from the request body, e.g. `tenant_id = str(payload.get("tenant_id") or PILOT_TENANT_ID)` and equivalent for `actor_id`/`teacher_id`/`student_id`. The module docstring (`api.py:11-13`) explicitly states identity comes from the body and relies on "the API CA … enforcing tenant scope at the storage layer via row-level security." That assumption is false: `set_learning_scope` / the RLS GUC `app.tenant_id` is **never set from an authenticated identity** in the request path (`storage_postgres._connect()` leaves `app.tenant_id` empty for these routes). In the default in-memory backend there is no isolation at all (see F10).

**Attack scenario.** A user (or any party who can reach the ingress) sends:
`POST /api/learning/approvals/<plan_id>/approve` with body `{"tenant_id":"victim-school","actor_id":"head-teacher","plan_id":"…"}` — approving an AI-generated learning plan for another school's child. The same body-spoofing reads/writes `/students/<id>/profile`, `/students/<id>/override`, `/student-facts/*/approve`, `/class/mastery`, `/memory*`, and `/audit` across **any** tenant. There is no role gate, so a learner-level session (or none) can perform teacher/admin-only mutations.

**Evidence.**
```python
# backend/src/learning/api.py (~514)
tenant_id = str(payload.get("tenant_id") or PILOT_TENANT_ID)
actor_id  = str(payload.get("actor_id") or payload.get("teacher_id") or "")
# _wrap (~2210) adds only telemetry + _read_payload — no auth/authz
```

**Remediation.** Bind identity server-side: in `_wrap` (or a `before_request` scoped to `/api/learning/*`) resolve the principal from `_get_authenticated_user_from_headers()`, reject unauthenticated requests, and **override** any body-supplied `tenant_id`/`class_id`/`actor_id` with the authenticated values. Call `set_learning_scope()` so the RLS GUCs (`app.tenant_id`, `app.class_id`, `app.user_id`, `app.role`) are populated on every connection. Add per-route role enforcement (approvals/overrides/audit = teacher/admin only). Treat body-supplied tenant/actor as advisory display data only. **Effort: L.**

---

### F2 — High — Safeguarding intervention is advisory, not enforced server-side
**OWASP:** A04:2021 Insecure Design (child-safety control)
**Files:** `backend/src/services/websocket_handler.py:254-336` (`_dispatch_safeguarding`, `_safeguarding_task`); `backend/src/safeguarding/pipeline.py:18` (`SAFEGUARDING_DISABLED`), `:39` (`enabled`).

**Description.** Safeguarding analysis runs as fire-and-forget (`asyncio.create_task`) and, on a CRITICAL inbound verdict, only **emits a `wulo.safeguarding_pause` frame** to the client. The realtime forwarding loop is **never stopped server-side** and the upstream model connection is **not closed** by the server — the comment states a detector failure "must not interrupt the child's session." Enforcement of the pause depends entirely on the frontend honouring the frame (`useRealtime.ts` does close the socket, which is good — but it is client-side and bypassable by any non-conforming client). Additionally:
- Outbound (model-generated) harm is escalated to an admin but **never paused to the child** (`websocket_handler.py:317-320`), so a harmful AI utterance still reaches the minor.
- The entire pipeline can be silenced by a single env var `SAFEGUARDING_DISABLED` (`pipeline.py:18,39`); a misconfiguration disables all three detection layers silently.
- Detection latency: L2 (Content Safety) + L3 (LLM classifier) are network round-trips; the model may already have responded before a verdict returns.

**Attack/failure scenario.** A modified or non-browser client (or a tampered front-end) ignores the pause frame and continues the crisis conversation; the server keeps relaying audio because it never tore down the session. Or `SAFEGUARDING_DISABLED=true` is set in one environment and no crisis is ever detected.

**Remediation.** Enforce the pause on the server: on CRITICAL inbound, stop forwarding and close the upstream + client sockets server-side (don't rely on the client). Gate outbound CRITICAL to suppress/replace the model utterance before it is relayed to the child. Remove or strongly guard the global kill-switch (require an explicit, alarmed, non-prod-only flag) and emit a startup warning + health signal when safeguarding is disabled. **Effort: M.**

---

### F3 — High — Postgres exposed to the public Azure network
**OWASP:** A05:2021 Security Misconfiguration
**Files:** `infra/resources.bicep:382` and `:434` (`publicNetworkAccess: 'Enabled'`), `:399-405` (`AllowAzureServices` firewall rule `0.0.0.0`–`0.0.0.0`).

**Description.** The Flexible Server has public network access enabled and an `AllowAzureServices` rule (`0.0.0.0/0.0.0.0`) that permits connections from **any Azure resource in any subscription/tenant**, not just this app. The only remaining control is the admin password. For a database holding minors' PII and mastery/safeguarding data, this is an over-broad exposure.

**Attack scenario.** Combined with F4 (admin URL leakage) or any credential leak, the database is directly reachable from arbitrary Azure compute, bypassing the Container App entirely (and therefore all app-layer controls and RLS scoping).

**Remediation.** Set `publicNetworkAccess: 'Disabled'`, remove the `AllowAzureServices` rule, and connect the Container Apps environment to the server over a private endpoint / VNet integration. If public access must remain temporarily, restrict the firewall to the Container App's egress IP only. **Effort: M.**

---

### F4 — High — Admin (RLS-bypassing) database URL injected into the runtime container
**OWASP:** A01/A05:2021
**Files:** `infra/resources.bicep:535` (secret `postgres-admin-database-url`), `:762-763` (`DATABASE_ADMIN_URL` → `secretRef: postgres-admin-database-url`).

**Description.** The runtime container receives both `DATABASE_URL` (least-privileged runtime role) **and** `DATABASE_ADMIN_URL` (the table-owner/admin role used for migrations). The admin role is the one that owns the tables and is **not subject to forced RLS the same way** — possessing it allows full cross-tenant reads/writes. Although `storage_factory` only enables `allow_system_bypass` when `database_url == database_admin_url` (currently false), the admin connection string is physically present in the process environment, so any code-execution, SSRF-to-metadata, log leak, or dependency compromise yields a full RLS bypass.

**Remediation.** Do not inject `DATABASE_ADMIN_URL` into the long-running app container. Run migrations as a separate one-shot job/identity (or a deploy-time step) that has the admin secret, and keep only the runtime least-privileged URL in the app. **Effort: M.**

---

### F5 — High — No HTTP security headers / Content-Security-Policy
**OWASP:** A05:2021 Security Misconfiguration
**Files:** `backend/src/app.py` (no `after_request` header injection — grep for `Content-Security-Policy|Strict-Transport|X-Frame-Options|X-Content-Type-Options` returns 0 matches); `frontend/index.html` (no CSP meta).

**Description.** Neither the Flask app nor the front-end sets a CSP, HSTS, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, or `Permissions-Policy`. For an app rendering LLM-generated and back-end-supplied content (see F9) to minors, the absence of CSP removes the main defence-in-depth against XSS, and the absence of `X-Frame-Options`/frame-ancestors allows clickjacking.

**Remediation.** Add an `after_request` hook setting a strict CSP (`default-src 'self'`, locked `script-src`, `connect-src` limited to the API + required Azure/voice origins, `frame-ancestors 'none'`), plus HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and a minimal `Permissions-Policy` (allow microphone only as needed). **Effort: S.**

---

### F6 — High — Minors' raw transcripts/PII egressed to LLM + Speech before redaction
**OWASP:** A03:2021 / LLM06 Sensitive Information Disclosure
**Files:** `backend/src/services/analyzers.py:164-192` (raw transcript embedded into evaluation prompt); `backend/src/app.py:670-671` (`redact_transcript` applied only at storage time, after analysis).

**Description.** Conversation transcripts (which can contain a child's name, personal details, and spoken disclosures) are embedded verbatim into LLM prompts and sent to Azure OpenAI / Speech for analysis. Redaction (`redact_transcript`) is applied only later when persisting. So the unredacted PII is what leaves the trust boundary. (The same direct-client pattern exists across `azure_openai_auth.py`, `websocket_handler.py`, and the Speech configs; there is no redaction/DLP layer in front of egress.)

> Note: the analyze path cited is shared by the therapist/sales-coach flow; because the same deployment serves minors, unredacted minor PII follows the same route. Confirm whether the Pathfinder Learn child flows reach this analyzer before relying on it being out of scope.

**Remediation.** Redact/pseudonymise PII **before** building any LLM/Speech prompt, not just before storage; pass name-hints and apply `redact_transcript` at the egress boundary. Document the data-flow and residency for minors' audio/text in the DPIA. **Effort: M.**

---

### F7 — Medium — No `Origin` validation on WebSocket upgrades (CSWSH)
**OWASP:** A01:2021 (CSRF-class)
**Files:** `backend/src/app.py:4935` (`voice_proxy`), `:5025` (`insights_voice_socket`).

**Description.** Both WS handlers authenticate via Easy-Auth `X-MS-CLIENT-PRINCIPAL-*` headers and check role/scope (good), but neither validates the `Origin` of the upgrade request. The HTTP `_check_csrf_policy` (`app.py:905`) applies to `/api/*` state-changing requests, not the WS handshake. Because Easy Auth attaches the victim's identity from their session cookie on a cross-site WS handshake, a malicious page the victim visits could open a WebSocket to the backend and act as the victim (Cross-Site WebSocket Hijacking).

**Remediation.** Validate `Origin` against the trusted-origins allowlist in both WS handlers and reject mismatches before processing. **Effort: S.**

---

### F8 — Medium — Prompt injection via untrusted free-text in LLM prompts
**OWASP:** A03:2021 / LLM01 Prompt Injection
**Files:** `backend/src/services/report_pipeline.py:240-265` (`source_summary`, `child_name` embedded in a JSON user message); `backend/src/services/planning_service.py:717-724` (therapist message concatenated into the prompt).

**Description.** Human-authored fields (therapist summary text, planning requests, child name) are embedded into model prompts without clear delimiting/escaping or instruction/data separation. JSON-encoding the payload does not stop injection when the untrusted text *is* the message content. A user could embed "ignore previous instructions…" to subvert the summariser/planner (e.g. to bypass phoneme/redaction rules or surface other context).

**Remediation.** Separate instructions from data: keep system instructions in the system role, put untrusted content in a clearly fenced data block, and add an output policy/guardrail check. Constrain the planner with schema-validated output (you already have `PlanValidator`; ensure it is fail-closed downstream). **Effort: M.**

---

### F9 — Medium — Markdown rendered without sanitisation
**OWASP:** A03:2021 Injection (XSS)
**Files:** `frontend/src/components/InsightsRail.tsx:915-920` (`ReactMarkdown` with only `remark-gfm`, no `rehype-sanitize`).

**Description.** LLM/back-end text is rendered through `react-markdown` without `rehype-sanitize`/DOMPurify. `react-markdown` escapes raw HTML by default, so this is not exploitable today, but it is one config/plugin change (or `rehype-raw`) away from stored XSS aimed at minors — and there is no CSP backstop (F5).

**Remediation.** Add `rehype-sanitize` to the markdown pipeline with a strict schema; never add `rehype-raw`. **Effort: S.**

---

### F10 — Medium — Default repository backend has no tenant isolation
**OWASP:** A05:2021
**Files:** `backend/src/learning/repository_factory.py` (defaults to `InMemoryLearningRepository`; sqlite also resolves to in-memory).

**Description.** When the backend env is unset/misconfigured, learning data uses an in-memory (or sqlite-in-memory) store with **no RLS and no tenant isolation**. Combined with F1, a misconfigured environment has zero data-segregation. Production sets `DATABASE_BACKEND=postgres` with `REQUIRE_POSTGRES_IN_AZURE=true`, which mitigates this in prod, but the safe-by-default posture is weak.

**Remediation.** Fail closed when running outside local dev: refuse to start the learning API with a non-Postgres backend unless an explicit `ALLOW_INSECURE_LOCAL_STORE` dev flag is set. **Effort: S.**

---

### F11 — Medium — Secrets as plaintext Bicep params (no Key Vault)
**OWASP:** A05:2021
**Files:** `infra/main.bicep:28,35,64` (`microsoftProviderClientSecret`, `googleProviderClientSecret`, `postgresAdminPassword`); `infra/resources.bicep:520-592` (secrets `secureList`).

**Description.** OAuth client secrets, the Postgres admin password, Twilio token, Speech key, and Content-Safety key are supplied as deployment parameters / Container App secrets rather than referenced from Key Vault. Plaintext parameters persist in azd env files and ARM deployment history, widening exposure.

**Remediation.** Store secrets in Key Vault and reference them via Container App Key Vault secret references + managed identity; mark params `@secure()` (verify) and avoid persisting them in azd env. **Effort: M.**

---

### F12 — Medium — PII (`child_id`/`conversation_id`) in WebSocket query string
**OWASP:** A09:2021 (logging/privacy)
**Files:** `frontend/src/hooks/useInsightsVoice.ts:91-120`.

**Description.** `child_id` and `conversation_id` are placed in the WS URL query string, which is routinely captured by reverse-proxy/WAF/ingress access logs and browser history — exposing minor identifiers in plaintext logs.

**Remediation.** Pass these identifiers in the first authenticated WS message (post-handshake) rather than the URL, or use opaque, short-lived tokens. Scrub query strings from ingress logs. **Effort: S.**

---

### F13 — Low — Image asset path parameter (mitigated)
**OWASP:** A01:2021
**Files:** `backend/src/app.py:4926-4932` (`/api/images/<path:image_path>` → `send_from_directory`). Authenticated (`_require_authenticated`) and protected by Flask/Werkzeug path normalisation, so traversal is not currently exploitable. Add an explicit allowlist/`..` rejection for defence-in-depth. **Effort: S.**

### F14 — Low — SQLite f-string PRAGMA/ALTER (safe in practice)
**OWASP:** A03:2021
**Files:** `backend/src/services/storage.py:94,1008,1012`. Identifiers are interpolated via f-strings but all callers pass hardcoded values; no user input reaches them. Parameterise/quote identifiers for defence-in-depth. **Effort: S.**

---

## 4. Fix-Before-Pilot List (Critical + High only)

These must be remediated before any pilot involving real minors:

1. **F1 (Critical)** — Add server-side authentication + authorization to **all** `/api/learning/*` routes; bind tenant/class/actor from the authenticated principal and call `set_learning_scope()` so RLS is actually enforced; override body-supplied identity. *(Effort L)*
2. **F2 (High)** — Enforce safeguarding pause server-side (tear down the session on CRITICAL inbound; suppress CRITICAL outbound before it reaches the child); harden/alarm the `SAFEGUARDING_DISABLED` kill-switch. *(Effort M)*
3. **F3 (High)** — Disable Postgres public network access and remove the `AllowAzureServices` 0.0.0.0 rule; use a private endpoint. *(Effort M)*
4. **F4 (High)** — Remove `DATABASE_ADMIN_URL` from the runtime container; run migrations as a separate identity/job. *(Effort M)*
5. **F5 (High)** — Add CSP + standard security headers (server `after_request`). *(Effort S)*
6. **F6 (High)** — Redact/pseudonymise minors' PII before LLM/Speech egress, not only at storage. *(Effort M)*

---

## 5. Explicit Gaps / Limitations of This Review

- **Runtime not exercised.** This is a static, read-only code/IaC review. F1, F3, F4, F7 should be confirmed with live tests (e.g. cross-tenant request from an authenticated low-privilege account; external DB connection attempt; cross-origin WS handshake).
- **F6 data-flow ambiguity.** The unredacted-egress finding was confirmed on the shared analyzer path used by the therapist/sales-coach flow. I did not fully trace whether every Pathfinder Learn *child* conversation reaches that exact analyzer before redaction — verify the minor flows explicitly.
- **Secret values not inspected.** Per instruction, no secret values were read or printed; only their wiring in IaC. Whether deployed secrets are strong/rotated was not assessed.
- **Easy Auth / Entra configuration not reviewed at the platform level** (token audience, allowed IdPs, session cookie flags, token lifetimes) — only the app's header handling was reviewed.
- **Alembic RLS policies** (`20260529_000031` append-only `safeguarding_events`) were referenced from prior context but not line-by-line re-verified in this pass; confirm DELETE is blocked and UPDATE restricted as intended.
- **Dependency CVE scan** was a manifest review only (versions look current; no lockfile/SCA scan such as `pip-audit`/`npm audit` was run).
- **Authorization matrix** (which roles may call which `/api/learning/*` route) does not exist in code today because F1 removes the gate entirely; a full role/route matrix should be defined as part of the F1 fix and re-reviewed.
- **DoS/rate-limit tuning** and **PlanValidator fail-closed behaviour** for the draft→pending→approved state machine were noted as good-by-design but not exhaustively fuzzed.

---

*End of report. No code was modified during this assessment.*
