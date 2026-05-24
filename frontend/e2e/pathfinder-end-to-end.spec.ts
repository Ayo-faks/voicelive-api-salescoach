/**
 * F6 acceptance — student diagnostic → teacher heatmap → approval → xAPI ledger.
 *
 * Drives the wired Pathfinder Learn surfaces against the real Flask backend so
 * that every UI click results in a recorded learning event. Requires the
 * Playwright harness defined in playwright.config.ts (or PLAYWRIGHT_SKIP_WEBSERVER
 * with a manually started backend on baseURL).
 */
import { expect, request, test } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

test.describe('Pathfinder · end-to-end learning loop', () => {
  test('student check-in updates teacher heatmap and approval is audited', async ({
    page,
    baseURL,
  }) => {
    await page.goto('/home')
    await page.getByTestId('start-checkin').click()

    const panel = page.getByTestId('diagnostic-panel')
    await expect(panel).toBeVisible()

    for (let i = 0; i < 12; i += 1) {
      const completed = page.getByTestId('diagnostic-completed')
      if (await completed.isVisible().catch(() => false)) break
      const input = page.getByTestId('diagnostic-answer-input')
      await input.fill(`answer-${i}`)
      await page.getByTestId('diagnostic-submit').click()
      await expect(page.getByTestId('diagnostic-feedback')).toBeVisible()
    }

    await expect(page.getByTestId('diagnostic-completed')).toBeVisible()
    await expect(page.getByTestId('diagnostic-pending-banner')).toBeVisible()

    await page.goto('/teacher')
    const liveCell = page.locator(
      '[data-testid^="mastery-cell-student-001-"]'
    )
    await expect(liveCell.first()).toBeVisible({ timeout: 15_000 })

    await expect(page.getByTestId('phase2-pending-approval-card')).toBeVisible({
      timeout: 15_000,
    })
    await page
      .getByTestId('phase2-pending-approval-card')
      .getByRole('button', { name: /^Approve/i })
      .click()

    const audit = page.getByTestId('audit-events')
    await expect(audit).toContainText(/Approved plan/i, { timeout: 15_000 })

    const api = await request.newContext({ baseURL })
    const auditResp = await api.get('/api/learning/audit')
    expect(auditResp.ok()).toBeTruthy()
    const auditJson = await auditResp.json()
    const kinds = (auditJson.events ?? []).map(
      (e: { kind?: string }) => e.kind ?? ''
    )
    expect(kinds).toContain('plan_approved')
    await api.dispose()
  })
})
