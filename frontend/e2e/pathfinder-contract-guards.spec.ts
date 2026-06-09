import { expect, test, type Page, type Route } from '@playwright/test'

import {
  installRouteMocks,
  type RouteRole,
} from './fixtures/pathfinder-route-mocks'

const THEME_STORAGE_KEY = 'pathfinder-theme'
const COOKIE_STORAGE_KEY = 'pathfinder.cookie-consent.v1'

type ThemeMode = 'light' | 'dark'

const routedSurfaces: Array<{
  path: string
  testId: string
  role: RouteRole
}> = [
  { path: '/welcome', testId: 'voice-onboarding', role: 'learner' },
  { path: '/goals', testId: 'goal-intake-fullscreen', role: 'learner' },
  { path: '/home', testId: 'route-student-home', role: 'learner' },
  { path: '/family', testId: 'parent-family-home', role: 'parent' },
  { path: '/teacher', testId: 'route-teacher-dashboard', role: 'admin' },
  { path: '/exam-prep', testId: 'route-exam-prep', role: 'learner' },
  { path: '/library', testId: 'route-skill-library', role: 'admin' },
  { path: '/profile', testId: 'route-student-profile', role: 'learner' },
  { path: '/pathways', testId: 'route-pathways-explorer', role: 'learner' },
  { path: '/safety', testId: 'route-trust-safety', role: 'admin' },
  { path: '/observability', testId: 'pf-observability-dashboard', role: 'admin' },
  { path: '/account', testId: 'route-account-hub', role: 'admin' },
  { path: '/account/settings', testId: 'route-account-settings', role: 'admin' },
  { path: '/account/privacy', testId: 'route-account-privacy', role: 'admin' },
  { path: '/account/terms', testId: 'route-account-terms', role: 'admin' },
  { path: '/account/ai-notice', testId: 'route-account-ai-notice', role: 'admin' },
]

const disallowedRoutes: Array<{
  path: string
  role: RouteRole
  expectedRedirect: RegExp
}> = [
  { path: '/library', role: 'learner', expectedRedirect: /\/home$/ },
  { path: '/teacher', role: 'parent', expectedRedirect: /\/family$/ },
  { path: '/family', role: 'admin', expectedRedirect: /\/teacher$/ },
]

function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

async function seedAppState(
  page: Page,
  {
    theme = 'light',
    cookieChoice = 'accepted',
  }: { theme?: ThemeMode; cookieChoice?: 'accepted' | null } = {}
): Promise<void> {
  await page.addInitScript(
    ([themeKey, cookieKey, themeMode, cookieValue]) => {
      if (!window.localStorage.getItem(themeKey)) {
        window.localStorage.setItem(themeKey, themeMode)
      }
      if (cookieValue) {
        window.localStorage.setItem(cookieKey, cookieValue)
      } else {
        window.localStorage.removeItem(cookieKey)
      }
    },
    [THEME_STORAGE_KEY, COOKIE_STORAGE_KEY, theme, cookieChoice]
  )
}

async function installContractMocks(
  page: Page,
  role: RouteRole
): Promise<void> {
  await installRouteMocks(page, { role })

  await page.route('**/api/config', (route) =>
    fulfillJson(route, {
      onboarding: { tours_enabled: false },
      insights_rail: { enabled: true, voice_mode: 'push_to_talk' },
      insights_rail_enabled: true,
      insights_voice_mode: 'push_to_talk',
      learner_voice_fullscreen_enabled: true,
      voice_agent_fullscreen_enabled: true,
      voice_agent_actions_enabled: false,
      pathfinder_voicelive_enabled: false,
    })
  )

  await page.route('**/api/children**', (route) =>
    fulfillJson(route, [
      {
        id: `e2e-${role}-learner`,
        name: 'E2E Learner',
        display_name: 'E2E Learner',
      },
    ])
  )
}

test.describe('Pathfinder · frozen contract handles', () => {
  test('preserves desktop shell handles, launchers, and trust chrome', async ({
    page,
  }) => {
    await seedAppState(page)
    await installContractMocks(page, 'learner')

    await page.goto('/home')
    await expect(page.getByTestId('pathfinder-learn-app')).toBeVisible({
      timeout: 15_000,
    })
    await expect(
      page.locator('aside[aria-label="Wulo Academy primary"]')
    ).toBeVisible()
    await expect(
      page.getByRole('navigation', { name: 'Wulo Academy views' })
    ).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'Wulo Academy — go to home' }).first()
    ).toBeVisible()

    for (const testId of [
      'pf-nav-home',
      'pf-nav-exam-prep',
      'pf-nav-profile',
      'pf-nav-pathways',
      'sidebar-practice-link',
      'pathfinder-theme-toggle',
      'sidebar-user-card',
      'account-actions-trigger',
      'account-action-sign-out',
      'practice-launcher',
      'voice-agent-launcher',
      'pathfinder-chat-launcher',
    ]) {
      await expect(page.getByTestId(testId).first()).toBeVisible()
    }

    await expect(page.getByTestId('offline-ready-pill')).toContainText(
      'Works offline'
    )
  })

  test('preserves mobile shell handles and bottom navigation', async ({
    page,
  }) => {
    await seedAppState(page)
    await installContractMocks(page, 'learner')
    await page.setViewportSize({ width: 390, height: 844 })

    await page.goto('/home')
    await expect(page.getByTestId('pathfinder-learn-app')).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByTestId('pathfinder-theme-toggle-mobile')).toBeVisible()
    await expect(page.getByTestId('mobile-account-settings')).toHaveAttribute(
      'href',
      '/account'
    )
    await expect(page.getByTestId('mobile-account-sign-out')).toHaveAttribute(
      'href',
      '/logout'
    )
    await expect(
      page.getByRole('navigation', { name: 'Wulo Academy bottom nav' })
    ).toBeVisible()
  })

  test('preserves launcher open and close behavior', async ({ page }) => {
    await seedAppState(page)
    await installContractMocks(page, 'learner')

    await page.goto('/home')
    await expect(page.getByTestId('route-student-home')).toBeVisible({
      timeout: 15_000,
    })

    await page.getByTestId('pathfinder-chat-launcher').click()
    await expect(page.getByTestId('pathfinder-chat-panel')).toBeVisible()
    await page.getByTestId('pathfinder-chat-minimize').click()
    await expect(page.getByTestId('pathfinder-chat-panel')).toHaveCount(0)

    await page.getByTestId('voice-agent-launcher').click()
    await expect(page.getByTestId('voice-agent-fullscreen')).toBeVisible()
    await page.getByTestId('voice-agent-close').click()
    await expect(page.getByTestId('voice-agent-fullscreen')).toHaveCount(0)

    await page.getByTestId('sidebar-practice-link').click()
    await expect(page.getByTestId('practice-fullscreen')).toBeVisible()
    await page.getByTestId('practice-close').click()
    await expect(page.getByTestId('practice-fullscreen')).toHaveCount(0)
  })

  test('preserves cookie and theme localStorage contracts', async ({ page }) => {
    await seedAppState(page, { cookieChoice: null })
    await installContractMocks(page, 'learner')

    await page.goto('/home')
    await expect(page.getByTestId('cookie-consent-banner')).toBeVisible({
      timeout: 15_000,
    })
    await page.getByTestId('cookie-consent-accept').click()
    await expect(page.getByTestId('cookie-consent-banner')).toHaveCount(0)
    await expect
      .poll(() =>
        page.evaluate((key) => window.localStorage.getItem(key), COOKIE_STORAGE_KEY)
      )
      .toBe('accepted')

    await page
      .getByTestId('pathfinder-theme-toggle')
      .getByRole('button', { name: /dark/i })
      .click()
    await expect
      .poll(() =>
        page.evaluate((key) => window.localStorage.getItem(key), THEME_STORAGE_KEY)
      )
      .toBe('dark')

    await page.reload()
    await expect(
      page
        .getByTestId('pathfinder-theme-toggle')
        .getByRole('button', { name: /dark/i })
    ).toHaveAttribute('aria-pressed', 'true')
  })

  for (const surface of routedSurfaces) {
    test(`preserves route contract for ${surface.path}`, async ({ page }) => {
      await seedAppState(page)
      await installContractMocks(page, surface.role)

      await page.goto(surface.path)
      await expect(page.getByTestId(surface.testId)).toBeVisible({
        timeout: 15_000,
      })
    })
  }

  for (const route of disallowedRoutes) {
    test(`keeps ${route.path} gated away from ${route.role}`, async ({
      page,
    }) => {
      await seedAppState(page)
      await installContractMocks(page, route.role)

      await page.goto(route.path)
      await expect(page).toHaveURL(route.expectedRedirect)
    })
  }
})