/**
 * F6 acceptance — student diagnostic → teacher heatmap → approval → xAPI ledger.
 *
 * Drives the wired Pathfinder Learn surfaces against the real Flask backend so
 * that every UI click results in a recorded learning event. Requires the
 * Playwright harness defined in playwright.config.ts (or PLAYWRIGHT_SKIP_WEBSERVER
 * with a manually started backend on baseURL).
 */
import { expect, request, test } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

const LEARNER_PERSONA = {
  userId: 'dev-learner-001',
  name: 'Dev Learner',
  email: 'dev-learner@localhost',
} as const

const PILOT_CLASS_ID = 'class-jss2-a'
const PRACTICE_SKILL_ID = 'ratio-proportion'

type DiagnosticItem = {
  item_id: string
}

type DiagnosticStartResponse = {
  session_id: string
  item: DiagnosticItem | null
}

type DiagnosticAnswerResponse = {
  completed: boolean
  next_item: DiagnosticItem | null
}

function learnerHeaders(): Record<string, string> {
  return {
    'X-MS-CLIENT-PRINCIPAL-ID': LEARNER_PERSONA.userId,
    'X-MS-CLIENT-PRINCIPAL-NAME': LEARNER_PERSONA.name,
    'X-MS-CLIENT-PRINCIPAL-EMAIL': LEARNER_PERSONA.email,
    'X-MS-CLIENT-PRINCIPAL-IDP': 'local-dev',
  }
}

async function completeDiagnosticViaApi(
  api: APIRequestContext,
  options: {
    studentId: string
    classId: string
    itemCount?: number
    skillId?: string
  }
): Promise<void> {
  const startResp = await api.post('/api/learning/diagnostic/start', {
    data: {
      student_id: options.studentId,
      class_id: options.classId,
      item_count: options.itemCount ?? 1,
      skill_id: options.skillId,
    },
  })
  expect(startResp.ok()).toBeTruthy()
  const started = (await startResp.json()) as DiagnosticStartResponse
  let item = started.item
  let step = 0

  while (item) {
    const answerResp = await api.post('/api/learning/diagnostic/answer', {
      data: {
        session_id: started.session_id,
        item_id: item.item_id,
        response_text: `seed-answer-${step}`,
      },
    })
    expect(answerResp.ok()).toBeTruthy()
    const answer = (await answerResp.json()) as DiagnosticAnswerResponse
    if (answer.completed) return
    item = answer.next_item
    step += 1
    if (step > 20) throw new Error('diagnostic API seed did not complete')
  }
}

async function seedStableWeakTopic(
  api: APIRequestContext
): Promise<string> {
  await completeDiagnosticViaApi(api, {
    studentId: LEARNER_PERSONA.userId,
    classId: PILOT_CLASS_ID,
    skillId: PRACTICE_SKILL_ID,
  })
  return PRACTICE_SKILL_ID
}

test.describe('Pathfinder · end-to-end learning loop', () => {
  // The Home hero now enters the tutor path. The backend-wired DiagnosticPanel
  // is reached from the server-backed weak-topic profile, so the test seeds one
  // mastery event first and then clicks the returned "Practise this topic" card.
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
    let practiceSkillId = ''
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
      practiceSkillId = await seedStableWeakTopic(adminRequest)
    } finally {
      await learnerRequest.dispose()
    }

    const learnerContext = await browser.newContext({
      extraHTTPHeaders: learnerHeaders(),
    })
    const page = await learnerContext.newPage()

    await page.goto('/home')
    await page.getByTestId(`practise-topic-${practiceSkillId}`).click()

    const panel = page.getByTestId('diagnostic-panel')
    await expect(panel).toBeVisible()

    for (let i = 0; i < 12; i += 1) {
      const completed = page.getByTestId('diagnostic-completed')
      if (await completed.isVisible().catch(() => false)) break
      const input = page.getByTestId('diagnostic-answer-input')
      await expect(input).toBeEditable()
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
      if (!planId) throw new Error('pending approval did not include a plan id')
      const approveResp = await adminRequest.post(
        `/api/learning/approvals/${encodeURIComponent(planId)}/approve`
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
