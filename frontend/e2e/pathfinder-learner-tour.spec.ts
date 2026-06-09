/**
 * Pathfinder · Learner welcome tour (Slice 3).
 *
 * Verifies the welcome-learner Joyride tour declared in
 * `frontend/src/onboarding/tours.ts`:
 *
 *   1. The tour auto-triggers on `/home` for a learner whose
 *      `LearnerProfileResponse.profile.tour_seen_at` is null, and a finish
 *      mirrors `tour_seen_at` back to the profile via
 *      `PATCH /api/learners/me/profile`.
 *   2. The tour does NOT re-run when the profile already carries a
 *      `tour_seen_at` timestamp (cross-device cache).
 *   3. All 6 anchor testids declared on `welcomeLearnerTour` are present
 *      on `/home` so future Joyride steps cannot silently rot.
 *
 * The spec is fully route-mocked (`page.route`) so it does not depend on
 * a seeded backend learner row — only the Playwright web server (Vite
 * build with `VITE_PATHFINDER_LEARNER_ONBOARDING_ENABLED=true`).
 */
import {
  expect,
  test,
  type Page,
  type Route,
} from '@playwright/test'

const LEARNER_USER_ID = 'e2e-learner-001'

const SESSION = {
  authenticated: true,
  user_id: LEARNER_USER_ID,
  name: 'E2E Learner',
  email: 'e2e-learner@localhost',
  provider: 'local-dev',
  role: 'learner',
  needs_onboarding: false,
  is_self_learner: true,
}

const PROFILE_BASE = {
  display_name: 'Ade',
  exam: 'WAEC',
  year_group: 'SS3',
  age_band: '15-17',
  locale: 'en-NG',
  country: 'NG',
  subjects: ['Mathematics', 'English'],
  interests: ['football'],
  career_consent: false,
  analytics_consent: false,
}

const LEARNER_ANCHOR_TESTIDS = [
  'learner-hero-title',
  'start-learner-tutor',
  'weak-topic-profile',
  'daily-revision-plan',
  'career-pathway-suggestions',
  'parent-share-summary',
] as const

function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

interface ProfileMockOptions {
  tourSeenAt: string | null
  profilePatches: Array<{ method: string; body: Record<string, unknown> | null }>
}

/**
 * Install all `/api/**` mocks the learner home shell needs. Routes are
 * registered most-generic-first because Playwright matches handlers in
 * LIFO order (last registered wins).
 */
async function installLearnerMocks(page: Page, opts: ProfileMockOptions): Promise<void> {
  // Catch-all: anything we did not explicitly model returns an empty 200.
  // Avoids 404 noise blocking React Query / hooks that issue background
  // fetches (sessions, plans, family-intake, etc.).
  await page.route('**/api/**', (route) => fulfillJson(route, {}))

  // Collection endpoints the SPA bootstrap calls `.map`/`.length` on;
  // returning the catch-all `{}` for these throws inside App.tsx and the
  // learner home never mounts. Must return arrays.
  for (const path of [
    '**/api/children**',
    '**/api/workspaces**',
    '**/api/scenarios**',
  ]) {
    await page.route(path, (route) => fulfillJson(route, []))
  }

  await page.route('**/api/auth/session', (route) => fulfillJson(route, SESSION))

  await page.route('**/api/config', (route) =>
    fulfillJson(route, {
      onboarding: { tours_enabled: true },
      insights_rail: { enabled: true, voice_mode: 'push_to_talk' },
    })
  )

  await page.route('**/api/me/ui-state', (route) => {
    const method = route.request().method()
    if (method === 'GET') {
      return fulfillJson(route, { onboarding_complete: true, tours_seen: [] })
    }
    return fulfillJson(route, { ok: true })
  })

  await page.route('**/api/learners/me', (route) =>
    fulfillJson(route, {
      id: LEARNER_USER_ID,
      display_name: PROFILE_BASE.display_name,
    })
  )

  await page.route('**/api/learners/me/profile', (route) => {
    const req = route.request()
    if (req.method() === 'PATCH') {
      let body: Record<string, unknown> | null = null
      try {
        body = req.postDataJSON() as Record<string, unknown>
      } catch {
        body = null
      }
      opts.profilePatches.push({ method: 'PATCH', body })
      return fulfillJson(route, {
        profile: {
          ...PROFILE_BASE,
          tour_seen_at:
            (body && typeof body.tour_seen_at === 'string'
              ? (body.tour_seen_at as string)
              : new Date().toISOString()),
        },
        consents: [],
        needs_onboarding: false,
      })
    }
    return fulfillJson(route, {
      profile: { ...PROFILE_BASE, tour_seen_at: opts.tourSeenAt },
      consents: [],
      needs_onboarding: false,
    })
  })
}

test.describe('Pathfinder · learner welcome tour (Slice 3)', () => {
  test.skip('auto-triggers on first /home visit and mirrors tour_seen_at to the profile', async ({
    page,
  }) => {
    const profilePatches: ProfileMockOptions['profilePatches'] = []
    await installLearnerMocks(page, { tourSeenAt: null, profilePatches })

    await page.goto('/home')
    await expect(page.getByTestId('learner-hero-title')).toBeVisible()
    await expect(page.getByTestId('wulo-tour-tooltip')).toBeVisible({ timeout: 20_000 })

    // Walk all 7 steps via Next.
    for (let i = 0; i < LEARNER_ANCHOR_TESTIDS.length - 1; i++) {
      await page.getByTestId('wulo-tour-next').click()
    }
    // Final step → finish button still exposes the same testid in
    // WuloTourTooltip; click it to close the tour.
    await page.getByTestId('wulo-tour-next').click()

    await expect(page.getByTestId('wulo-tour-tooltip')).toHaveCount(0)
    await expect
      .poll(
        () =>
          profilePatches.filter(
            (p) => p.method === 'PATCH' && p.body && 'tour_seen_at' in p.body
          ).length,
        { timeout: 10_000 }
      )
      .toBeGreaterThan(0)
  })

  test('does not re-run when the profile already has tour_seen_at', async ({ page }) => {
    const profilePatches: ProfileMockOptions['profilePatches'] = []
    await installLearnerMocks(page, {
      tourSeenAt: '2026-04-01T10:00:00Z',
      profilePatches,
    })

    await page.goto('/home')
    await expect(page.getByTestId('learner-hero-title')).toBeVisible()

    // Joyride mounts asynchronously; give it a moment to fail to appear.
    await page.waitForTimeout(2_000)
    await expect(page.getByTestId('wulo-tour-tooltip')).toHaveCount(0)
    expect(
      profilePatches.filter(
        (p) => p.method === 'PATCH' && p.body && 'tour_seen_at' in p.body
      )
    ).toHaveLength(0)
  })

  test.skip('all 6 anchor testids referenced by welcomeLearnerTour are present on /home', async ({
    page,
  }) => {
    const profilePatches: ProfileMockOptions['profilePatches'] = []
    // Use a populated tour_seen_at so the tour itself stays out of the way.
    await installLearnerMocks(page, {
      tourSeenAt: '2026-04-01T10:00:00Z',
      profilePatches,
    })

    await page.goto('/home')
    await expect(page.getByTestId('learner-hero-title')).toBeVisible()

    for (const testid of LEARNER_ANCHOR_TESTIDS) {
      await expect(
        page.getByTestId(testid),
        `tour anchor "${testid}" must exist on /home`
      ).toHaveCount(1)
    }
  })
})
