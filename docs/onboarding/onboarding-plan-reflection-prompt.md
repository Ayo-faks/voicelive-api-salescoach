# Prompt: Reflect on and improve the Wulo onboarding plan

Paste this prompt into a fresh chat session (or a new agent mode conversation) inside the `voicelive-api-salescoach` workspace. It gives the assistant everything it needs to stress-test and improve the plan without re-doing the discovery work.

---

## Prompt to paste

You are reviewing a pre-written implementation plan for Wulo's premium onboarding and in-app guidance system. The plan lives at `docs/onboarding/onboarding-plan.md` in this workspace. Wulo is a therapist-supervised child speech-practice SaaS with four personas (therapist, admin, parent, pending_therapist) plus a child mode. Stack: React + Fluent UI + Vite frontend, FastAPI-style Python + Alembic backend with dual SQLite/Postgres parity, Azure Container Apps + Easy Auth + VoiceLive + Copilot SDK.

**Your job is to critique and improve the plan, not rewrite from scratch.** Do not implement any code. Produce a revised plan document.

### Step 1 — Load & summarise
1. Read `docs/onboarding/onboarding-plan.md` in full.
2. Read the repository memory files under `/memories/repo/` (especially `voicelive-api-salescoach.md`, `child-practice-flow.md`, `security-model-current.md`, `wulo-design-system.md`, `deploy-arm64-binfmt.md`) to ground yourself in repo constraints.
3. In ≤150 words, summarise the plan's thesis, tiered architecture (A/B/C), and phased rollout.

### Step 2 — Stress-test assumptions
For each of the following, state whether you agree, and if not, propose a concrete alternative with tradeoffs:
- **Library choice** — `react-joyride` vs `@reactour/tour` vs `driver.js` vs `shepherd.js` vs fully custom. Check current npm health (last publish, open issues, React 19 / Vite compat, bundle size, a11y story). Confirm or overturn the choice with evidence.
- **Child mode custom build** — is reinventing spotlight/mascot justified, or could `@reactour/mask` or a minimal custom `<dialog>` pattern suffice? Factor in Children's Code (UK ICO) compliance, reduced-motion, and the existing `WuloRobot` asset.
- **Server-side persistence schema** — is a single `user.ui_state` JSONB column right, or should tours/announcements/checklist be normalised into their own tables for auditability? How does Postgres JSONB behave under SQLite parity (JSON1 extension)? Will Alembic migrations run cleanly on both?
- **Phase ordering** — Phase 1 ships Foundation + therapist MVP tour. Is there a higher-ROI first slice (e.g. empty states alone, or checklist alone) that de-risks faster?
- **i18n from day one** — is this premature given pilot is English-only? Or correct given Wulo targets UK + multilingual families?

### Step 3 — Identify gaps
Check whether the plan covers each of the below. Flag anything missing with a short proposal:
- **Personas/features not inventoried**: re-run an inventory pass on `frontend/src/app/routes.ts` and `frontend/src/components/` — has the plan missed any view, setting, or dialog? Check admin-only screens, impersonation, workspace switcher, billing if present.
- **Accessibility**: WCAG 2.2 AA tour requirements — focus management, `aria-live` for step changes, keyboard escape, screen-reader dialogue for child mascot, `prefers-reduced-motion`, high contrast, tap-target size on child mode.
- **GDPR / UK Children's Code**: lawful basis for telemetry events on minors (children should never emit), DPIA touchpoints, data minimisation for tour telemetry, retention of `ui_state` on account deletion, right-to-erasure impact.
- **Telemetry funnel design**: what are the three headline funnel metrics (activation, time-to-first-session, checklist completion rate)? Are event names consistent, documented, and queryable? Does Clarity actually support custom events with low-cardinality properties, or is App Insights mandatory?
- **Error states & offline**: what happens when `PATCH /api/me/ui-state` 5xx's mid-tour? Does the tour re-fire next login? Is there a dead-letter for lost dismissals?
- **Security**: is `ui_state` user-scoped only (no cross-user leaks via PATCH)? Rate limiting? Schema validation server-side to stop bloat attacks?
- **Performance**: bundle size impact of `react-joyride` + `@floating-ui/react` + `framer-motion` on the child tablet critical path. Lazy-load strategy.
- **Content governance**: who owns copy, how is it reviewed, how are translations versioned?
- **Rollback story**: if `welcome-therapist` tour regresses UX in pilot, how is it disabled quickly without a release?

### Step 4 — Propose concrete improvements
Output a prioritised list of 5–10 improvements. Each entry:
- Title
- Motivation (1 sentence)
- Change (concrete file/API/decision delta)
- Cost (S/M/L)
- Risk if we skip it

### Step 5 — Re-verify against repo constraints
Confirm or flag issues against these repo-specific constraints:
- SQLite + Postgres parity is non-negotiable — any migration, any JSON path query, any index must work on both.
- Easy Auth `excludedPaths` — new `/api/me/ui-state` endpoint must be enumerated correctly so it stays behind auth.
- Deploy pattern — `AZURE_EXTENSION_DIR=/tmp/az-noext DOCKER_CONFIG=$(mktemp -d) azd deploy --environment salescoach-swe` must still succeed; no new native deps that break linux/arm64 binfmt setup.
- Frontend testing seam — Vitest + jsdom pinned to `jsdom@26.1.0`; new tours must have a headless-testable contract.

### Step 6 — Deliverable
Produce `docs/onboarding/onboarding-plan-v2.md` as a **full replacement** (not a diff) incorporating all agreed improvements. Preserve the original structure (inventory → tiers → phases → files → verification → decisions → considerations). Call out changed sections with a leading `> **Revised:** …` note so reviewers can scan the diff. Also append a short `## Changelog vs v1` section at the bottom listing the material changes.

Do **not** modify `docs/onboarding/onboarding-plan.md`; leave v1 untouched for comparison. Do **not** start implementing code — produce only the revised plan document and a summary message.
