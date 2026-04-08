# Wulo — Data Collection & Legal Review Pack

**Prepared:** 8 April 2026
**For:** Legal counsel / Privacy officer review
**App:** Wulo SEN Speech Therapy Platform
**Staging URL:** https://staging-sen.wulo.ai

---

## Legal Documents (live on staging)

| Document | URL | Source file |
|----------|-----|-------------|
| Privacy Policy | https://staging-sen.wulo.ai/privacy | `frontend/src/components/legal/PrivacyPolicy.tsx` |
| Terms of Service | https://staging-sen.wulo.ai/terms | `frontend/src/components/legal/TermsOfService.tsx` |
| AI Transparency Notice | https://staging-sen.wulo.ai/ai-transparency | `frontend/src/components/legal/AITransparencyNotice.tsx` |

All three pages are accessible without authentication.

---

## 1. Personal Data Collected — Database

🔴 = personal / sensitive &nbsp;&nbsp; ⚪ = non-personal

### `users` — Therapist / parent accounts

| Column | Type | Personal | Notes |
|--------|------|----------|-------|
| `id` | text PK | 🔴 | Entra Object ID |
| `email` | text | 🔴 | From Azure Easy Auth |
| `name` | text | 🔴 | Display name |
| `provider` | text | 🔴 | Identity provider (e.g. `aad`) |
| `role` | text | ⚪ | `therapist`, `parent`, `admin` |
| `created_at` | text | ⚪ | |

### `children` — Child profiles

| Column | Type | Personal | Notes |
|--------|------|----------|-------|
| `id` | text PK | ⚪ | UUID |
| `name` | text | 🔴 | Child's first name |
| `date_of_birth` | text | 🔴 | **Sensitive** — used for age-appropriate exercises |
| `notes` | text | 🔴 | Free-text clinical notes entered by therapist |
| `created_at` | text | ⚪ | |
| `deleted_at` | text | ⚪ | Soft-delete timestamp |

### `user_children` — User ↔ child relationships

| Column | Type | Personal | Notes |
|--------|------|----------|-------|
| `user_id` | text FK | 🔴 | |
| `child_id` | text FK | 🔴 | |
| `relationship` | text | 🔴 | `therapist` or `parent` |
| `created_at` | text | ⚪ | |

### `sessions` — Practice session records

| Column | Type | Personal | Notes |
|--------|------|----------|-------|
| `id` | text PK | ⚪ | |
| `child_id` | text FK | 🔴 | |
| `exercise_id` | text | ⚪ | |
| `timestamp` | text | ⚪ | |
| `transcript` | text | 🔴 | **Sensitive** — child's spoken words |
| `pronunciation_json` | text | 🔴 | Azure Speech pronunciation scores |
| `ai_assessment_json` | text | 🔴 | AI-generated evaluation of the child's speech |
| `reference_text` | text | ⚪ | Target sentence |
| `feedback_rating` | integer | ⚪ | |
| `feedback_note` | text | 🔴 | Therapist's free-text feedback |
| `feedback_submitted_at` | text | ⚪ | |
| `exercise_metadata_json` | text | ⚪ | |

### `practice_plans` — AI-generated practice plans

| Column | Type | Personal | Notes |
|--------|------|----------|-------|
| `id` | text PK | ⚪ | |
| `child_id` | text FK | 🔴 | |
| `created_by_user_id` | text FK | 🔴 | |
| `conversation_json` | text | 🔴 | Full LLM conversation history |
| `constraints_json` | text | 🔴 | May contain child-specific clinical context |
| `draft_json` | text | 🔴 | May contain child-specific clinical context |
| `title`, `status`, `plan_type`, timestamps | various | ⚪ | |

### `child_memory_items` — Longitudinal child observations

| Column | Type | Personal | Notes |
|--------|------|----------|-------|
| `id` | text PK | ⚪ | |
| `child_id` | text FK | 🔴 | |
| `statement` | text | 🔴 | **Sensitive** — observation about the child |
| `detail_json` | text | 🔴 | Clinical detail |
| `author_user_id` | text FK | 🔴 | |
| `confidence`, `provenance_json`, timestamps | various | ⚪ | |

### `child_memory_proposals` — Pending memory review

Same schema as `child_memory_items` plus:

| Column | Type | Personal | Notes |
|--------|------|----------|-------|
| `reviewer_user_id` | text FK | 🔴 | |
| `review_note` | text | 🔴 | |

### `child_memory_evidence_links` — Session excerpts linked to memories

| Column | Type | Personal | Notes |
|--------|------|----------|-------|
| `child_id` | text FK | 🔴 | |
| `snippet` | text | 🔴 | Extract from session transcript |

### `child_memory_summaries` — Aggregated child profiles

| Column | Type | Personal | Notes |
|--------|------|----------|-------|
| `child_id` | text FK | 🔴 | |
| `summary_json` | text | 🔴 | **Sensitive** — aggregated clinical profile |
| `summary_text` | text | 🔴 | **Sensitive** — human-readable summary |

### `parental_consents` — Consent records

| Column | Type | Personal | Notes |
|--------|------|----------|-------|
| `child_id` | text FK | 🔴 | |
| `guardian_name` | text | 🔴 | Parent/guardian name |
| `guardian_email` | text | 🔴 | Parent/guardian email |
| `recorded_by_user_id` | text FK | 🔴 | Therapist who recorded |
| `consent_type`, `privacy_accepted`, `terms_accepted`, `ai_notice_accepted` | various | ⚪ | Consent flags |
| `consented_at`, `withdrawn_at` | text | ⚪ | |

### `child_invitations` — Parent/collaborator invitations

| Column | Type | Personal | Notes |
|--------|------|----------|-------|
| `child_id` | text FK | 🔴 | |
| `invited_email` | text | 🔴 | Invitee email address |
| `relationship` | text | 🔴 | |
| `invited_by_user_id` | text FK | 🔴 | |
| `accepted_by_user_id` | text FK | 🔴 | |

### `audit_log` — Data access / deletion audit trail

| Column | Type | Personal | Notes |
|--------|------|----------|-------|
| `user_id` | text | 🔴 | Who performed the action |
| `child_id` | text | 🔴 | |
| `metadata_json` | text | 🔴 | May contain personal context |
| `action`, `resource_type`, `resource_id` | text | ⚪ | |

### Tables with no personal data

- `exercises` — exercise templates (content only)
- `app_settings` — application configuration
- `alembic_version` — migration tracking

---

## 2. Data Collected from HTTP Headers

Authentication is handled by Azure Easy Auth (server-side). The app reads the following headers injected by the platform:

| Header | Maps to | Personal |
|--------|---------|----------|
| `X-MS-CLIENT-PRINCIPAL` | Base64 JWT | 🔴 |
| `X-MS-CLIENT-PRINCIPAL-ID` | `users.id` (Entra Object ID) | 🔴 |
| `X-MS-CLIENT-PRINCIPAL-NAME` | `users.name` | 🔴 |
| `X-MS-CLIENT-PRINCIPAL-EMAIL` | `users.email` | 🔴 |
| `X-MS-CLIENT-PRINCIPAL-IDP` | `users.provider` | 🔴 |

No passwords are stored. Authentication is delegated entirely to Microsoft Entra ID.

---

## 3. Cookies & Browser Storage

### Cookies

| Cookie | Category | Source | Contains personal data |
|--------|----------|--------|----------------------|
| `cc_cookie` | Strictly necessary | vanilla-cookieconsent | No — stores consent preferences only |
| `_clck` | Analytics (opt-in) | Microsoft Clarity | No — anonymous visitor ID |
| `_clsk` | Analytics (opt-in) | Microsoft Clarity | No — session clustering |
| Other `_cl*` | Analytics (opt-in) | Microsoft Clarity | No |

Clarity cookies are **only set after explicit user opt-in** via the cookie consent banner. They are auto-cleared on revocation.

### localStorage

| Key | Contents | Personal |
|-----|----------|----------|
| `wulo.onboarding.complete` | Boolean flag | No |
| `wulo.user.mode` | `"child"` or `"workspace"` | No |
| `wulo_custom_exercises` | Custom exercise JSON | No |

### sessionStorage

| Key | Contents | Personal |
|-----|----------|----------|
| `wulo.selectedScenario` | Selected scenario ID | No |

---

## 4. Third-Party Data Processors

| Service | Provider | Data shared | Purpose | Data region |
|---------|----------|-------------|---------|-------------|
| Azure OpenAI | Microsoft | Child transcripts, session data, memory summaries | AI speech assessment, practice plan generation | Sweden Central |
| Microsoft Clarity | Microsoft | Anonymised session replays, clicks | Usage analytics (opt-in only) | EU |
| Azure Communication Services | Microsoft | Invitation recipient email addresses | Sending parent invitation emails | Sweden Central |
| Azure Entra ID | Microsoft | OAuth tokens | Authentication | Global |
| Azure Database for PostgreSQL | Microsoft | All database tables listed above | Primary data store | Sweden Central |

---

## 5. Data Retention Policy

| Data type | Retention period | Mechanism |
|-----------|-----------------|-----------|
| Active child profiles | Indefinite while in use | — |
| Inactive child profiles | 6 months after last session | Soft-deleted by `scripts/enforce_retention.py` |
| Soft-deleted data | 1 month grace period | Hard-deleted (cascade across all tables) |
| Audit log | Retained indefinitely | Required for GDPR accountability |
| Parental consent records | Retained after withdrawal | Required to demonstrate lawful basis was obtained |

---

## 6. Data Subject Rights Implementation

| Right | Endpoint | Status |
|-------|----------|--------|
| Right of access (Art. 15) | `GET /api/children/<id>/data-export` | ✅ Implemented — returns full JSON bundle |
| Right to erasure (Art. 17) | `DELETE /api/children/<id>/data` | ✅ Implemented — cascading delete with audit |
| Consent withdrawal | `DELETE /api/children/<id>/consent` | ✅ Implemented |

---

## 7. Special Category Data (Article 9)

The app processes data that may constitute **health data** under UK GDPR:

- Speech transcripts and pronunciation assessments (children with speech/language difficulties)
- Clinical notes entered by therapists
- AI-generated observations about a child's speech development
- Aggregated child memory summaries

**Lawful basis:** Explicit parental consent (Art. 9(2)(a)), recorded in the `parental_consents` table.

---

## 8. Action Items for Legal Review

- [ ] Review Privacy Policy text at https://staging-sen.wulo.ai/privacy
- [ ] Review Terms of Service text at https://staging-sen.wulo.ai/terms
- [ ] Review AI Transparency Notice at https://staging-sen.wulo.ai/ai-transparency
- [ ] Confirm lawful basis (explicit consent) is appropriate for health data processing
- [ ] Confirm data retention periods (6 months inactive + 1 month grace) are adequate
- [ ] Advise on whether a DPIA is required before production launch
- [ ] Advise on DPA requirements for NHS/LA B2B customers
- [ ] Confirm cookie consent implementation meets UK PECR requirements
