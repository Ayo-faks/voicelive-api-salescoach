import { expect, test, type Locator, type Page, type Route } from '@playwright/test'

import {
  installRouteMocks,
  type RouteRole,
} from './fixtures/pathfinder-route-mocks'

const THEME_STORAGE_KEY = 'pathfinder-theme'
const COOKIE_STORAGE_KEY = 'pathfinder.cookie-consent.v1'

type ThemeMode = 'light' | 'dark'

const screenshotOptions = {
  fullPage: true,
  maxDiffPixelRatio: 0.02,
  animations: 'disabled',
} as const

const themedSurfaces: Array<{
  path: string
  testId: string
  role: RouteRole
}> = [
  { path: '/home', testId: 'route-student-home', role: 'learner' },
  { path: '/profile', testId: 'route-student-profile', role: 'learner' },
  { path: '/teacher', testId: 'route-teacher-dashboard', role: 'admin' },
  { path: '/pathways', testId: 'route-pathways-explorer', role: 'learner' },
  { path: '/safety', testId: 'route-trust-safety', role: 'admin' },
  { path: '/observability', testId: 'pf-observability-dashboard', role: 'admin' },
  { path: '/family', testId: 'parent-family-home', role: 'parent' },
]

function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

async function seedTheme(page: Page, mode: ThemeMode): Promise<void> {
  await page.addInitScript(
    ([themeKey, cookieKey, themeMode]) => {
      if (!window.localStorage.getItem(themeKey)) {
        window.localStorage.setItem(themeKey, themeMode)
      }
      window.localStorage.setItem(cookieKey, 'accepted')
    },
    [THEME_STORAGE_KEY, COOKIE_STORAGE_KEY, mode]
  )
}

async function installThemeMocks(
  page: Page,
  role: RouteRole = 'learner'
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
    })
  )
}

async function forceNeedsOnboarding(page: Page): Promise<void> {
  await page.route('**/api/learners/me/profile', (route) =>
    fulfillJson(route, {
      profile: {
        display_name: '',
        exam: null,
        year_group: null,
        age_band: null,
        locale: 'en-NG',
        country: 'NG',
        subjects: [],
        interests: [],
        career_consent: false,
        analytics_consent: false,
        tour_seen_at: null,
      },
      consents: [],
      needs_onboarding: true,
    })
  )
}

async function expectThemeRoot(page: Page, mode: ThemeMode): Promise<void> {
  await expect
    .poll(() =>
      page.getByTestId('pathfinder-learn-app').evaluate((element) =>
        element.closest('[data-theme]')?.getAttribute('data-theme') ?? null
      )
    )
    .toBe(mode)
}

async function expectScrimPalette(
  locator: Locator,
  mode: ThemeMode
): Promise<void> {
  await expect(locator).toBeVisible({ timeout: 15_000 })
  const styles = await locator.evaluate((element) => {
    const style = window.getComputedStyle(element as HTMLElement)
    return {
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      color: style.color,
    }
  })
  const background = `${styles.backgroundImage} ${styles.backgroundColor}`

  if (mode === 'light') {
    expect(styles.color).toBe('rgb(10, 10, 10)')
    expect(background).toContain('rgb(255, 255, 255)')
    return
  }

  expect(styles.color).toMatch(/rgb\((247, 247, 248|255, 255, 255)\)/)
  expect(background).toMatch(
    /rgb\(32, 32, 36\)|rgb\(26, 26, 29\)|rgba\(10, 10, 10, 0\.92\)/
  )
}

test.describe('Pathfinder Learn theme system', () => {
  test.describe.configure({ mode: 'parallel' })

  test('defaults light and restores the persisted dark mode', async ({
    page,
  }) => {
    await seedTheme(page, 'light')
    await installThemeMocks(page)

    await page.goto('/home')
    await expect(page.getByTestId('pathfinder-learn-app')).toBeVisible({
      timeout: 15_000,
    })
    await expectThemeRoot(page, 'light')

    const toggle = page.getByTestId('pathfinder-theme-toggle')
    await expect(
      toggle.getByRole('button', { name: /light/i })
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(toggle.getByRole('button', { name: /dark/i })).toBeEnabled()

    await page.evaluate(
      (key) => window.localStorage.setItem(key, 'dark'),
      THEME_STORAGE_KEY
    )

    await page.reload()
    await expectThemeRoot(page, 'dark')
    await expect(
      page
        .getByTestId('pathfinder-theme-toggle')
        .getByRole('button', { name: /dark/i })
    ).toHaveAttribute('aria-pressed', 'true')
  })

  for (const mode of ['light', 'dark'] as const) {
    for (const surface of themedSurfaces) {
      test(`${surface.path} matches ${mode} theme visual baseline`, async ({
        page,
      }) => {
        await seedTheme(page, mode)
        await installThemeMocks(page, surface.role)
        await page.setViewportSize({ width: 1440, height: 1080 })

        await page.goto(surface.path)
        await expectThemeRoot(page, mode)
        await expect(page.getByTestId(surface.testId)).toBeVisible({
          timeout: 15_000,
        })
        await expect(page).toHaveScreenshot(
          `${surface.testId}-${mode}-desktop.png`,
          screenshotOptions
        )
      })
    }
  }

  for (const mode of ['light', 'dark'] as const) {
    test(`practice fullscreen uses ${mode} scrim palette`, async ({ page }) => {
      await seedTheme(page, mode)
      await installThemeMocks(page)

      await page.goto('/home?startPractice=1')
      await expectThemeRoot(page, mode)
      await expect(page.getByTestId('route-student-home')).toBeVisible({
        timeout: 15_000,
      })
      await expectScrimPalette(page.getByTestId('practice-fullscreen'), mode)
      await expect(page).toHaveScreenshot(
        `practice-fullscreen-${mode}.png`,
        screenshotOptions
      )
    })

    test(`learner tutor fullscreen uses ${mode} scrim palette`, async ({
      page,
    }) => {
      await seedTheme(page, mode)
      await installThemeMocks(page)

      await page.goto('/home')
      await expectThemeRoot(page, mode)
      await page.getByTestId('start-learner-tutor').click()
      await expectScrimPalette(page.getByTestId('learner-tutor'), mode)
      await expect(page).toHaveScreenshot(
        `learner-tutor-${mode}.png`,
        screenshotOptions
      )
    })

    test(`voice agent fullscreen uses ${mode} scrim palette`, async ({
      page,
    }) => {
      await seedTheme(page, mode)
      await installThemeMocks(page)

      await page.goto('/home')
      await expectThemeRoot(page, mode)
      await page.getByTestId('voice-agent-launcher').click()
      await expectScrimPalette(page.getByTestId('voice-agent-fullscreen'), mode)
      await expect(page).toHaveScreenshot(
        `voice-agent-fullscreen-${mode}.png`,
        screenshotOptions
      )
    })

    test(`goal intake fullscreen uses ${mode} scrim palette`, async ({
      page,
    }) => {
      await seedTheme(page, mode)
      await installThemeMocks(page)

      await page.goto('/goals')
      await expectScrimPalette(page.getByTestId('goal-intake-fullscreen'), mode)
      await expect(page).toHaveScreenshot(
        `goal-intake-fullscreen-${mode}.png`,
        screenshotOptions
      )
    })

    test(`voice onboarding uses ${mode} scrim palette`, async ({ page }) => {
      await seedTheme(page, mode)
      await installThemeMocks(page)
      await forceNeedsOnboarding(page)

      await page.goto('/welcome')
      await expectScrimPalette(page.getByTestId('voice-onboarding'), mode)
      await expect(page).toHaveScreenshot(
        `voice-onboarding-${mode}.png`,
        screenshotOptions
      )
    })
  }
})