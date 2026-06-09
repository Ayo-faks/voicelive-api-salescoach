/**
 * Pathfinder · Account & settings navigation.
 *
 * Verifies that the learner sidebar opens a Wulo Academy account hub
 * (not the legacy SalesCoach Settings page) and that each linked surface
 * — Settings, Privacy, Terms, AI notice — renders the Pathfinder content
 * we ship for learners.
 *
 * Run with PLAYWRIGHT_SKIP_WEBSERVER=true and a dev server already on
 * baseURL, or rely on playwright.config.ts's webServer.
 */
import { expect, test } from '@playwright/test'

const accountLinks = [
  { testId: 'account-action-settings', path: '/account/settings', routeTestId: 'route-account-settings', heading: 'Settings' },
  { testId: 'account-action-privacy', path: '/account/privacy', routeTestId: 'route-account-privacy', heading: 'Privacy' },
  { testId: 'account-action-terms', path: '/account/terms', routeTestId: 'route-account-terms', heading: 'Terms of use' },
  { testId: 'account-action-ai-notice', path: '/account/ai-notice', routeTestId: 'route-account-ai-notice', heading: 'How Wulo Academy uses AI' },
]

test.describe('Pathfinder · Account & settings', () => {
  // Admin lands on /teacher where the welcome-admin tour auto-fires; the
  // Joyride overlay (rendered full-page when the anchor is still mounting)
  // intercepts pointer events on the account trigger. Disable tours for this
  // spec — it isn't exercising onboarding.
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/config', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ onboarding: { tours_enabled: false } }),
      })
    )
  })

  test('account trigger opens the Pathfinder account hub page', async ({ page }) => {
    await page.goto('/home')
    await expect(page.getByTestId('pathfinder-learn-app')).toBeVisible()

    const trigger = page.getByTestId('account-actions-trigger')
    await expect(trigger).toBeVisible()
    await expect(trigger).toHaveAttribute('href', '/account')
    await trigger.click()

    await expect(page).toHaveURL(/\/account$/)
    await expect(page.getByTestId('route-account-hub')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Account & settings' })).toBeVisible()
    await expect(page.getByText('Wulo Academy · Account')).toBeVisible()

    const hub = page.getByTestId('route-account-hub')
    for (const link of accountLinks) {
      await expect(hub.getByTestId(link.testId)).toBeVisible()
    }
    await expect(hub.getByTestId('account-action-sign-out')).toHaveAttribute('href', '/logout')
  })

  for (const link of accountLinks) {
    test(`account hub links to Pathfinder ${link.heading}`, async ({ page }) => {
      await page.goto('/account')
      await expect(page.getByTestId('route-account-hub')).toBeVisible()

      await page.getByTestId(link.testId).click()
      await expect(page).toHaveURL(new RegExp(`${link.path.replace(/\//g, '\\/')}$`))
      await expect(page.getByTestId(link.routeTestId)).toBeVisible()
      await expect(page.getByRole('heading', { name: link.heading })).toBeVisible()
      // Each page wears the Wulo Academy eyebrow, not the legacy chrome.
      await expect(page.getByText(/Wulo Academy ·/)).toBeVisible()
      // Pathfinder shell should still be mounted around the page.
      await expect(page.getByTestId('pathfinder-learn-app')).toBeVisible()

      await page.getByTestId('account-back').click()
      await expect(page).toHaveURL(/\/account$/)
      await expect(page.getByTestId('route-account-hub')).toBeVisible()
    })
  }

  test('legacy /settings, /privacy, /terms, /ai-transparency paths are not used by Pathfinder links', async ({ page }) => {
    await page.goto('/account')
    for (const link of accountLinks) {
      const href = await page.getByTestId(link.testId).getAttribute('href')
      expect(href).toBe(link.path)
      expect(href).not.toMatch(/^\/settings$|^\/privacy$|^\/terms$|^\/ai-transparency$/)
    }
  })
})
