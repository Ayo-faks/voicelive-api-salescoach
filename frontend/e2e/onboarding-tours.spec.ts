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
      page.waitForURL(/\/dashboard(?:\?.*)?$/),
      page.getByTestId('help-menu-item-replay-dashboard').click(),
    ])

    // Wait for the dashboard root anchor to mount before Joyride mounts the tooltip.
    await expect(page.getByTestId('progress-dashboard-heading')).toBeVisible()
    await expect(page.getByTestId('wulo-tour-tooltip')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('wulo-tour-tooltip')).toContainText('Progress and planning')
  })

  test('therapist can replay the Insights rail walkthrough from Home', async ({ therapistShell }) => {
    const { page } = therapistShell

    await page.getByTestId('help-menu-trigger').click()
    await Promise.all([
      page.waitForURL(/\/dashboard(?:\?.*)?$/),
      page.getByTestId('help-menu-item-replay-insights-rail').click(),
    ])

    await expect(page.getByTestId('wulo-tour-tooltip')).toBeVisible()
    await expect(page.getByTestId('wulo-tour-tooltip')).toContainText('Ask Wulo anything')
    await expect(page.getByTestId('insights-rail')).toBeVisible()

    await page.getByTestId('wulo-tour-next').click()
    await expect(page.getByTestId('wulo-tour-tooltip')).toContainText('Type a prompt')
    await expect(page.getByTestId('insights-rail-input')).toBeVisible()

    await page.getByTestId('wulo-tour-next').click()
    await expect(page.getByTestId('wulo-tour-tooltip')).toContainText('Or speak instead')
    await expect(page.getByTestId('insights-rail-voice-action')).toBeVisible()
  })

  test('admin shell auto-triggers the welcome admin tour and keeps admin-only topics', async ({ adminShell }) => {
    const { page } = adminShell

    await expect(page).toHaveURL(/\/home(?:\?.*)?$/)
    await expect(page.getByTestId('wulo-tour-tooltip')).toBeVisible()
    await expect(page.getByTestId('wulo-tour-title')).toHaveText('Welcome, admin')

    await page.getByTestId('wulo-tour-skip').click()
    await expect(page.getByTestId('wulo-tour-tooltip')).toHaveCount(0)

    await page.getByTestId('help-menu-trigger').click()
    await expect(page.getByTestId('help-menu-item-replay-welcome-admin')).toBeVisible()
    await expect(page.getByTestId('help-menu-item-replay-dashboard')).toBeVisible()
    await expect(page.getByTestId('help-menu-item-replay-insights-rail')).toBeVisible()
    await expect(page.getByTestId('help-menu-item-replay-welcome-therapist')).toHaveCount(0)
    await expect(page.getByTestId('help-menu-item-replay-welcome-parent')).toHaveCount(0)
  })

  test('parent shell auto-triggers the welcome parent tour and hides therapist-only topics', async ({ parentShell }) => {
    const { page } = parentShell

    await expect(page).toHaveURL(/\/home(?:\?.*)?$/)
    await expect(page.getByTestId('wulo-tour-tooltip')).toBeVisible()
    await expect(page.getByTestId('wulo-tour-body')).toContainText('Wulo helps your child practise speech between therapy sessions.')

    await page.getByTestId('wulo-tour-skip').click()
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