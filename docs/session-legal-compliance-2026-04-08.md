# Session Summary — 8 April 2026

## Objective

Bring the Wulo SEN speech therapy app into legal compliance ahead of pilot launch with UK therapists and families.

## What We Shipped

### 1. Legal Pages (Frontend)

- **Privacy Policy** (`/privacy`) — UK GDPR & Children's Code compliant, covers data collection, AI processing, retention periods, parental rights, cookie disclosure
- **Terms of Service** (`/terms`) — liability limitations, acceptable use, account termination
- **AI Transparency Notice** (`/ai-transparency`) — explains how AI is used in sessions, what data feeds the models, human oversight commitments

### 2. Parental Consent Flow

- New `parental_consents` table (Alembic migration `20260408_000009`)
- Backend endpoints: `GET/POST/DELETE /api/children/<id>/consent`
- Consent gate in the frontend — therapists cannot start a session until a parent has consented
- `ParentalConsentDialog` component with clear, plain-English explanations

### 3. Data Subject Rights (GDPR Articles 15–17)

- **Data Export** — `GET /api/children/<id>/data-export` returns a full JSON bundle (child profile, sessions, plans, memory summaries)
- **Data Deletion** — `DELETE /api/children/<id>/data` cascades across 10 tables with audit logging
- Settings UI for therapists to trigger export/deletion per child

### 4. Automated Data Retention

- `scripts/enforce_retention.py` — standalone CLI script
- Phase 1: soft-deletes children with no session activity in 6 months
- Phase 2: hard-deletes soft-deleted records after a 1-month grace period
- Dry-run by default (`--apply` flag to execute), configurable thresholds
- `DATA_RETENTION_MONTHS` env var added to backend config

### 5. Cookie Consent + Microsoft Clarity

- Integrated `vanilla-cookieconsent@3` (Orestbida, MIT) with two categories: essential (always on) and analytics (opt-in)
- Clarity (`w8lm78zo88`) loads dynamically **only** after the user opts into analytics cookies
- Auto-clears `_cl*` cookies on revocation
- Privacy Policy updated with a dedicated cookies section (Section 6)

### 6. Housekeeping

- All `[INSERT EMAIL]` placeholders replaced with `privacy@wulo.ai`
- Legal routes bypass auth so unauthenticated visitors can read policies

## Deployment

- Commit `6448d1e` — 23 files changed, 1,940 insertions, 12 deletions
- Deployed to staging (`salescoach-swe`) via `azd deploy` — completed in 5m 50s
- Health check confirmed: `{"status":"ok"}` on `https://staging-sen.wulo.ai`
- Parental consents migration auto-applied on container startup

## Known Items / Deferred

| Item | Status | Notes |
|------|--------|-------|
| 3 pre-existing test failures | Known | Role rename (`user` → `parent`) from earlier refactor; unrelated to this work |
| Data Processing Agreement (DPA) | Deferred | Legal contract needed when selling B2B to NHS/LAs |
| Data Protection Impact Assessment (DPIA) | Deferred | Internal compliance doc; ICO template available |
| Solicitor review of legal text | Required before production | All pages marked as drafts |

## Tech Stack Touched

- **Frontend:** React 18, TypeScript, Vite, Fluent UI, React Router v6
- **Backend:** Flask, PostgreSQL, Alembic, psycopg
- **Infra:** Azure Container Apps, ACR, azd CLI
