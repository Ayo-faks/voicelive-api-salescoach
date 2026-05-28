/**
 * Pathfinder · Account & settings navigation.
 *
 * Verifies that the learner sidebar opens a Pathfinder-themed account hub
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
  { testId: 'account-action-ai-notice', path: '/account/ai-notice', routeTestId: 'route-account-ai-notice', heading: 'How Pathfinder uses AI' },
]

test.describe('Pathfinder · Account & settings', () => {
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
    await expect(page.getByText('Pathfinder · Account')).toBeVisible()

    for (const link of accountLinks) {
      await expect(page.getByTestId(link.testId)).toBeVisible()
    }
    await expect(page.getByTestId('account-action-sign-out')).toHaveAttribute('href', '/logout')
  })

  for (const link of accountLinks) {
    test(`account hub links to Pathfinder ${link.heading}`, async ({ page }) => {
      await page.goto('/account')
      await expect(page.getByTestId('route-account-hub')).toBeVisible()

      await page.getByTestId(link.testId).click()
      await expect(page).toHaveURL(new RegExp(`${link.path.replace(/\//g, '\\/')}$`))
      await expect(page.getByTestId(link.routeTestId)).toBeVisible()
      await expect(page.getByRole('heading', { name: link.heading })).toBeVisible()
      // Each Pathfinder page wears the Pathfinder eyebrow, not the legacy chrome.
      await expect(page.getByText(/Pathfinder ·/)).toBeVisible()
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
