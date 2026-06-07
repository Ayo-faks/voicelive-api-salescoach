/**
 * Shared per-test API mocks for the Pathfinder routed surfaces specs.
 *
 * The Playwright web server boots with `LOCAL_DEV_USER_ROLE=admin`. Several
 * Pathfinder routes (`/home`, `/teacher`, `/safety`, ...) are role-gated, so
 * the live admin cookie redirects away from learner-only surfaces. Tests that
 * need a specific role install these mocks before `page.goto()` to override
 * `/api/auth/session` and the handful of bootstrap endpoints the SPA must see
 * non-empty to mount the requested route.
 */
import type { Page, Route } from '@playwright/test'

export type RouteRole = 'learner' | 'admin' | 'therapist'

interface MockOptions {
  role: RouteRole
  /** Override the test user id (defaults are role-specific). */
  userId?: string
}

function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

function sessionFor({ role, userId }: MockOptions) {
  const id = userId ?? `e2e-${role}-001`
  return {
    authenticated: true,
    user_id: id,
    name: `E2E ${role}`,
    email: `${id}@localhost`,
    provider: 'local-dev',
    role,
    needs_onboarding: false,
    is_self_learner: role === 'learner',
  }
}

/**
 * Install the minimal mocks required for the routed shell to mount a chosen
 * surface end-to-end. Order matters: the most specific routes are registered
 * last so they take precedence (Playwright matches LIFO).
 */
export async function installRouteMocks(
  page: Page,
  opts: MockOptions
): Promise<void> {
  const session = sessionFor(opts)

  // Catch-all so background fetches (audit, plans, etc.) return a valid empty
  // body instead of 404s that crash hooks.
  await page.route('**/api/**', (route) => fulfillJson(route, {}))

  // Collection endpoints the SPA `.map`/`.length`s — empty object from the
  // catch-all throws. Must be arrays.
  for (const path of [
    '**/api/children**',
    '**/api/workspaces**',
    '**/api/scenarios**',
  ]) {
    await page.route(path, (route) => fulfillJson(route, []))
  }

  await page.route('**/api/auth/session', (route) => fulfillJson(route, session))

  await page.route('**/api/config', (route) =>
    fulfillJson(route, {
      onboarding: { tours_enabled: false },
      insights_rail: { enabled: true, voice_mode: 'push_to_talk' },
    })
  )

  await page.route('**/api/me/ui-state', (route) => {
    if (route.request().method() === 'GET') {
      return fulfillJson(route, { onboarding_complete: true, tours_seen: [] })
    }
    return fulfillJson(route, { ok: true })
  })

  // Learner profile gate — return a complete profile so `needsOnboarding`
  // stays false and `/home` doesn't bounce to `/welcome`.
  await page.route('**/api/learners/me/profile', (route) =>
    fulfillJson(route, {
      profile: {
        display_name: 'E2E Learner',
        exam: 'WAEC',
        year_group: 'SS3',
        age_band: '15-17',
        locale: 'en-NG',
        country: 'NG',
        subjects: ['Mathematics'],
        interests: [],
        career_consent: false,
        analytics_consent: false,
        tour_seen_at: '2026-04-01T10:00:00Z',
      },
      consents: [],
      needs_onboarding: false,
    })
  )

  // Self-learner auto-provisioning (`effectiveRole === 'learner'` + empty
  // children list) POSTs here and expects a `ChildProfile`-shaped body back;
  // GETs on the same path are used by other shell hooks.
  await page.route('**/api/learners/me', (route) =>
    fulfillJson(route, {
      id: `${session.user_id}-self`,
      display_name: session.name,
      role: 'learner',
    })
  )

  // Deterministic Ask Pathfinder reply — the catch-all returns `{}` which the
  // drawer surfaces as the generic 'could not answer' fallback. Tests assert
  // on "Ratio and proportion" in the transcript.
  await page.route('**/api/learning/assistant/ask', (route) =>
    fulfillJson(route, {
      answer:
        'Focus on Ratio and proportion this week — it is your weakest topic. No outcome guarantee, just where to spend study time.',
      citations: [
        { skill_id: 'ratio-proportion', label: 'Ratio and proportion' },
      ],
    })
  )

  // The unified drawer sends turns to `/assistant/turn` and renders the shared
  // AssistantBlock contract (`{ blocks, session_complete }`). The catch-all
  // returns `{}`, whose missing `blocks` crashes the renderer, so mock a single
  // grounded prose block. Tests assert on "Ratio and proportion" in the
  // streamed transcript.
  await page.route('**/api/learning/assistant/turn', (route) =>
    fulfillJson(route, {
      blocks: [
        {
          kind: 'prose',
          speak:
            'Focus on Ratio and proportion this week — it is your weakest topic.',
          text: 'Focus on Ratio and proportion this week — it is your weakest topic. No outcome guarantee, just where to spend study time.',
          citations: [
            { skill_id: 'ratio-proportion', label: 'Ratio and proportion' },
          ],
          grounded: true,
        },
      ],
      session_complete: false,
    })
  )

  await page.route('**/api/learning/learner/plan**', (route) =>
    fulfillJson(route, {
      student_id: `${session.user_id}-self`,
      exam: 'WAEC',
      class_year: 'SS3',
      subject: 'Mathematics',
      source: 'fallback',
      generated_at: '2026-04-01T10:00:00Z',
      today: [],
      weak_topics: [],
    })
  )
  await page.route('**/api/learning/learner/careers**', (route) =>
    fulfillJson(route, {
      student_id: `${session.user_id}-self`,
      source: 'demand',
      career_consent: false,
      generated_at: '2026-04-01T10:00:00Z',
      pathways: [],
    })
  )
  await page.route('**/api/learning/weekly-stats**', (route) =>
    fulfillJson(route, {
      sessions: { completed: 0, target: 5 },
      streak_days: 0,
      mastery_delta_pct: 0,
      mastery_focus_label: '',
    })
  )

  // Teacher dashboard endpoints — empty payloads of the *correct shape* so the
  // component renders without crashing on `cells.map` / `plans.length`.
  await page.route('**/api/learning/class/mastery**', (route) =>
    fulfillJson(route, {
      tenant_id: 'e2e',
      class_id: 'class-jss2-a',
      diagnostic_id: 'diag-e2e',
      cells: [],
      source: 'fixture',
    })
  )
  await page.route('**/api/learning/approvals/pending**', (route) =>
    fulfillJson(route, { plans: [], count: 0 })
  )
  await page.route('**/api/learning/student-facts/pending**', (route) =>
    fulfillJson(route, { facts: [], count: 0 })
  )
  await page.route('**/api/learning/audit**', (route) =>
    fulfillJson(route, { events: [] })
  )

  // Trust & Safety console KPI endpoint — needs `provenance` array present
  // (TrustSafetyConsole reads `kpis.provenance.length` unconditionally when
  // kpis is non-null).
  await page.route('**/api/learning/kpis**', (route) =>
    fulfillJson(route, {
      source: 'fixture',
      tenant_id: 'e2e',
      week_count: 0,
      meets_pilot_thresholds: false,
      cards: [],
      lang: 'en',
      provenance: [],
      report: {
        diagnostic_completion_rate: 0,
        approved_intervention_rate: 0,
        provenance_coverage: 0,
        safety_rate: 0,
        dsr_turnaround_rate: 0,
        cost_per_student_gbp: 0,
        meets_pilot_thresholds: false,
      },
    })
  )
}
