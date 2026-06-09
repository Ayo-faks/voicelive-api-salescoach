import { expect, test } from './fixtures/adultShell'

test.describe('adult onboarding tours', () => {
  test.describe.configure({ mode: 'serial' })

  test('therapist help menu only shows eligible tours and replays dashboard from Home', async ({ therapistShell }) => {
    const { page } = therapistShell

    await page.getByTestId('help-menu-trigger').click()

    await expect(page.getByTestId('help-menu-item-replay-welcome-therapist')).toBeVisible()
    await expect(page.getByTestId('help-menu-item-replay-dashboard')).toBeVisible()
    await expect(page.getByTestId('help-menu-item-replay-insights-rail')).toBeVisible()
    await expect(page.getByTestId('help-menu-item-privacy-and-data')).toBeVisible()
    await expect(page.getByTestId('help-menu-item-replay-welcome-admin')).toHaveCount(0)
    await expect(page.getByTestId('help-menu-item-replay-welcome-parent')).toHaveCount(0)

    await Promise.all([
      page.waitForURL(/\/teacher(?:\?.*)?$/),
      page.getByTestId('help-menu-item-replay-dashboard').click(),
    ])

    // Wait for the Pathfinder teacher dashboard shell to mount before
    // Joyride mounts the tooltip.
    await expect(page.getByTestId('route-teacher-dashboard')).toBeVisible()
    // Wait for Joyride to settle on the first dashboard-tour step before
    // asserting text. The custom WuloTourTooltip writes data-tour-step-active
    // once the step is mounted, so this defeats the cross-shell remount race
    // that flaked on the bare text assertion during /teacher hydration.
    const dashboardTooltip = page.locator(
      '[data-testid="wulo-tour-tooltip"][data-tour-step-active="route-teacher-dashboard"]'
    )
    await expect(dashboardTooltip).toBeVisible({ timeout: 20_000 })
    await expect(dashboardTooltip).toContainText('Progress and planning')
  })

  test('therapist can replay the Insights rail entry point from Home', async ({ therapistShell }) => {
    const { page } = therapistShell

    await page.getByTestId('help-menu-trigger').click()
    await Promise.all([
      page.waitForURL(/\/dashboard(?:\?.*)?$/),
      page.getByTestId('help-menu-item-replay-insights-rail').click(),
    ])

    // Wait for the insights-rail anchors to mount after the cross-shell hop.
    await expect(page.getByTestId('insights-rail')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('insights-rail-input')).toBeVisible()
    await expect(page.getByTestId('insights-rail-voice-action')).toBeVisible()
  })

  test.skip('admin shell auto-triggers the welcome admin tour and keeps admin-only topics', async ({ adminShell }) => {
    const { page } = adminShell

    // Admins land on /teacher via PathfinderLearnApp role-gated routing.
    await expect(page).toHaveURL(/\/teacher(?:\?.*)?$/)
    await expect(page.getByTestId('wulo-tour-tooltip')).toBeVisible()
    await expect(page.getByTestId('wulo-tour-title')).toHaveText('Welcome, admin')

    // Joyride positions its tooltip relative to the page anchor, which on the
    // redesigned /teacher dashboard can land outside the viewport. dispatchEvent
    // bypasses Playwright's viewport-stability check while still firing the
    // real React click handler.
    await page.getByTestId('wulo-tour-skip').dispatchEvent('click')
    await expect(page.getByTestId('wulo-tour-tooltip')).toHaveCount(0)

    await page.getByTestId('help-menu-trigger').click()
    await expect(page.getByTestId('help-menu-item-replay-welcome-admin')).toBeVisible()
    await expect(page.getByTestId('help-menu-item-replay-dashboard')).toBeVisible()
    await expect(page.getByTestId('help-menu-item-replay-insights-rail')).toBeVisible()
    await expect(page.getByTestId('help-menu-item-replay-welcome-therapist')).toHaveCount(0)
    await expect(page.getByTestId('help-menu-item-replay-welcome-parent')).toHaveCount(0)
  })

  test.skip('parent shell auto-triggers the welcome parent tour and hides therapist-only topics', async ({ parentShell }) => {
    const { page } = parentShell

    // Parents land on /profile via PathfinderLearnApp role-gated routing.
    await expect(page).toHaveURL(/\/profile(?:\?.*)?$/)
    await expect(page.getByTestId('wulo-tour-tooltip')).toBeVisible()
    await expect(page.getByTestId('wulo-tour-body')).toContainText('Wulo helps your child practise speech between therapy sessions.')

    await page.getByTestId('wulo-tour-skip').dispatchEvent('click')
    await expect(page.getByTestId('wulo-tour-tooltip')).toHaveCount(0)

    await page.getByTestId('help-menu-trigger').click()
    await expect(page.getByTestId('help-menu-item-replay-welcome-parent')).toBeVisible()
    await expect(page.getByTestId('help-menu-item-privacy-and-data')).toBeVisible()
    await expect(page.getByTestId('help-menu-item-replay-dashboard')).toHaveCount(0)
    await expect(page.getByTestId('help-menu-item-replay-insights-rail')).toHaveCount(0)
    await expect(page.getByTestId('help-menu-item-replay-welcome-admin')).toHaveCount(0)
    await expect(page.getByTestId('help-menu-item-replay-welcome-therapist')).toHaveCount(0)
  })
})