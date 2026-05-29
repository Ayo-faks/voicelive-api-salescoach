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

const LEARNER_PERSONA = {
  userId: 'dev-learner-001',
  name: 'Dev Learner',
  email: 'dev-learner@localhost',
} as const

function learnerHeaders(): Record<string, string> {
  return {
    'X-MS-CLIENT-PRINCIPAL-ID': LEARNER_PERSONA.userId,
    'X-MS-CLIENT-PRINCIPAL-NAME': LEARNER_PERSONA.name,
    'X-MS-CLIENT-PRINCIPAL-EMAIL': LEARNER_PERSONA.email,
    'X-MS-CLIENT-PRINCIPAL-IDP': 'local-dev',
  }
}

test.describe('Pathfinder · end-to-end learning loop', () => {
  // The Home hero's `start-checkin` button now launches the short-demo
  // diagnostic which only persists to localStorage. The backend-wired
  // DiagnosticPanel is still reachable from the weak-topic profile
  // ("Practise this topic"), so the end-to-end loop is exercised by
  // clicking into one of those topic cards instead of the hero CTA.
  test('student check-in updates teacher heatmap and approval is audited', async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000)
    if (!baseURL) throw new Error('baseURL is required')

    // The Playwright web server boots LOCAL_DEV_USER_ROLE=admin; seed an
    // explicit learner persona so /home renders StudentLearningHome with the
    // weak-topic "Practise this topic" buttons.
    const adminRequest = await request.newContext({ baseURL })
    const learnerRequest = await request.newContext({
      baseURL,
      extraHTTPHeaders: learnerHeaders(),
    })
    try {
      const session = await learnerRequest.get('/api/auth/session')
      expect(session.ok()).toBeTruthy()
      const roleResp = await adminRequest.post(
        `/api/users/${LEARNER_PERSONA.userId}/role`,
        { data: { role: 'learner' } }
      )
      expect(roleResp.ok()).toBeTruthy()
      // Suppress the welcome-learner auto-trigger tour; its Joyride
      // overlay otherwise intercepts the "Practise this topic" click.
      const uiResp = await learnerRequest.patch('/api/me/ui-state', {
        data: {
          onboarding_complete: true,
          tours_seen: ['welcome-learner'],
        },
      })
      expect(uiResp.ok()).toBeTruthy()
    } finally {
      await learnerRequest.dispose()
    }

    const learnerContext = await browser.newContext({
      extraHTTPHeaders: learnerHeaders(),
    })
    const page = await learnerContext.newPage()

    await page.goto('/home')
    await page.getByTestId('practise-topic-ratio-proportion').click()

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

    await learnerContext.close()

    // /teacher is admin-gated; reopen a fresh context with no principal
    // headers so the default LOCAL_DEV_USER_ROLE=admin identity is used.
    const adminContext = await browser.newContext()
    const adminPage = await adminContext.newPage()

    try {
      await adminPage.goto('/teacher')
      const liveCell = adminPage.locator('[data-testid^="mastery-cell-"]')
      await expect(liveCell.first()).toBeVisible({ timeout: 15_000 })

      // Approve via API: the dashboard UI filters by class_id and the
      // learner's auto-created plan may live in a different class than
      // the default filter. Drive approval through the backend so the
      // audit ledger entry is deterministic.
      const pendingResp = await adminRequest.get(
        '/api/learning/approvals/pending'
      )
      expect(pendingResp.ok()).toBeTruthy()
      const pendingJson = await pendingResp.json()
      const plans = (pendingJson.plans ?? []) as Array<{
        id?: string
        plan?: { plan_id?: string }
      }>
      expect(plans.length).toBeGreaterThan(0)
      const planId = plans[0].plan?.plan_id ?? plans[0].id
      expect(planId).toBeTruthy()
      const approveResp = await adminRequest.post(
        `/api/learning/approvals/${encodeURIComponent(planId!)}/approve`
      )
      expect(approveResp.ok()).toBeTruthy()

      const auditResp = await adminRequest.get('/api/learning/audit')
      expect(auditResp.ok()).toBeTruthy()
      const auditJson = await auditResp.json()
      const kinds = (auditJson.events ?? []).map(
        (e: { kind?: string }) => e.kind ?? ''
      )
      expect(kinds).toContain('plan_approved')
    } finally {
      await adminContext.close()
      await adminRequest.dispose()
    }
  })
})
