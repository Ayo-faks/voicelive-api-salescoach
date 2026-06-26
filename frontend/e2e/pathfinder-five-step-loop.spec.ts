/**
 * Wulo narrative — assessment results → mastery + uncertainty → groups →
 * teacher-reviewed intervention → follow-up mastery movement.
 */
import { expect, request, test } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

const PILOT_CLASS_ID = 'class-jss2-a'
const PILOT_PENDING_PLAN_ID = 'plan-jss2-ratio-recovery'
const PRACTICE_SKILL_ID = 'ratio-proportion'

const LEARNER_PERSONA = {
  userId: 'dev-learner-five-step-001',
  name: 'Five Step Learner',
  email: 'five-step-learner@localhost',
} as const

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

type PendingApprovalsResponse = {
  plans?: Array<{
    id?: string
    plan?: { plan_id?: string }
  }>
}

type ClassGroupsResponse = {
  count?: number
  groups?: Array<{ support_type?: string }>
}

type ClassFollowUpResponse = {
  count?: number
  follow_ups?: Array<{
    plan_id?: string
    delta_mastery?: number
    uncertainty_label?: string
    movements?: unknown[]
  }>
}

type AuditResponse = {
  events?: Array<{ kind?: string }>
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

async function completeDiagnosticInUi(page: Page): Promise<void> {
  const panel = page.getByTestId('diagnostic-panel')
  await expect(panel).toBeVisible()

  for (let i = 0; i < 12; i += 1) {
    const completed = page.getByTestId('diagnostic-completed')
    if (await completed.isVisible().catch(() => false)) return
    const input = page.getByTestId('diagnostic-answer-input')
    await expect(input).toBeEditable()
    await input.fill(`five-step-answer-${i}`)
    await page.getByTestId('diagnostic-submit').click()
    await expect(page.getByTestId('diagnostic-feedback')).toBeVisible()
  }
}

async function acceptCookieBanner(page: Page): Promise<void> {
  const banner = page.getByTestId('cookie-consent-banner')
  if (await banner.isVisible().catch(() => false)) {
    await page.getByTestId('cookie-consent-accept').click()
    await expect(banner).toBeHidden()
  }
}

async function approveFirstPendingPlan(
  api: APIRequestContext
): Promise<string> {
  const pendingResp = await api.get('/api/learning/approvals/pending')
  expect(pendingResp.ok()).toBeTruthy()
  const pending = (await pendingResp.json()) as PendingApprovalsResponse
  const plans = pending.plans ?? []
  expect(plans.length).toBeGreaterThan(0)
  const planId = plans[0].plan?.plan_id ?? plans[0].id
  if (!planId) throw new Error('pending approval did not include a plan id')

  const approveResp = await api.post(
    `/api/learning/approvals/${encodeURIComponent(planId)}/approve`,
    {
      data: {
        class_id: PILOT_CLASS_ID,
        reason: 'Teacher reviewed the Wulo five-step intervention plan',
      },
    }
  )
  expect(approveResp.ok()).toBeTruthy()
  return planId
}

async function seedPilotGroups(api: APIRequestContext): Promise<void> {
  for (const seed of [
    {
      studentId: 'five-step-reteach-001',
      probability: 0.32,
      uncertainty: 0.2,
      reason: 'Low mastery evidence from class assessment',
    },
    {
      studentId: 'five-step-practice-001',
      probability: 0.55,
      uncertainty: 0.34,
      reason: 'Developing mastery with thin evidence',
    },
    {
      studentId: 'five-step-extension-001',
      probability: 0.86,
      uncertainty: 0.18,
      reason: 'Secure class assessment evidence',
    },
  ]) {
    const overrideResp = await api.post(
      `/api/learning/students/${encodeURIComponent(seed.studentId)}/override`,
      {
        data: {
          skill_id: PRACTICE_SKILL_ID,
          probability: seed.probability,
          uncertainty: seed.uncertainty,
          reason: seed.reason,
        },
      }
    )
    expect(overrideResp.ok()).toBeTruthy()
  }
}

async function ensurePilotPlanApproved(api: APIRequestContext): Promise<void> {
  const approveResp = await api.post(
    `/api/learning/approvals/${PILOT_PENDING_PLAN_ID}/approve`,
    {
      data: {
        class_id: PILOT_CLASS_ID,
        reason: 'Teacher reviewed the pilot ratio recovery intervention',
      },
    }
  )
  if (approveResp.ok()) return
  expect(approveResp.status()).toBe(409)
  const body = (await approveResp.json()) as { error?: string }
  expect(body.error ?? '').toContain('already')
}

test.describe('Pathfinder · five-step Wulo learning loop', () => {
  test('shows assessment results becoming grouped intervention and follow-up movement', async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(150_000)
    if (!baseURL) throw new Error('baseURL is required')

    const adminRequest = await request.newContext({ baseURL })
    const learnerRequest = await request.newContext({
      baseURL,
      extraHTTPHeaders: learnerHeaders(),
    })

    try {
      await test.step('setup learner persona and stable practice topic', async () => {
        const session = await learnerRequest.get('/api/auth/session')
        expect(session.ok()).toBeTruthy()
        const roleResp = await adminRequest.post(
          `/api/users/${LEARNER_PERSONA.userId}/role`,
          { data: { role: 'learner' } }
        )
        expect(roleResp.ok()).toBeTruthy()
        const uiResp = await learnerRequest.patch('/api/me/ui-state', {
          data: {
            onboarding_complete: true,
            tours_seen: ['welcome-learner'],
          },
        })
        expect(uiResp.ok()).toBeTruthy()
        await completeDiagnosticViaApi(adminRequest, {
          studentId: LEARNER_PERSONA.userId,
          classId: PILOT_CLASS_ID,
          skillId: PRACTICE_SKILL_ID,
        })
        await seedPilotGroups(adminRequest)
      })

      const learnerContext = await browser.newContext({
        extraHTTPHeaders: learnerHeaders(),
      })
      const learnerPage = await learnerContext.newPage()
      try {
        await test.step('1. class assessment results are produced from a learner check-in', async () => {
          await learnerPage.goto('/home')
          await acceptCookieBanner(learnerPage)
          await learnerPage.getByTestId(`practise-topic-${PRACTICE_SKILL_ID}`).click()
          await completeDiagnosticInUi(learnerPage)
          await expect(learnerPage.getByTestId('diagnostic-completed')).toBeVisible()
          await expect(learnerPage.getByTestId('diagnostic-pending-banner')).toBeVisible()
        })
      } finally {
        await learnerContext.close()
      }

      const adminContext = await browser.newContext()
      const adminPage = await adminContext.newPage()
      try {
        await test.step('2. teacher sees mastery and uncertainty evidence', async () => {
          await adminPage.goto('/teacher')
          await expect(adminPage.getByTestId('route-teacher-dashboard')).toBeVisible()
          await expect(adminPage.locator('[data-testid^="mastery-cell-"]').first()).toBeVisible({
            timeout: 15_000,
          })
          await expect(adminPage.getByTestId('weakest-subskills-list')).toBeVisible()
          await expect(adminPage.getByTestId('differentiation-groups')).toContainText(
            /Strong evidence|Thin evidence|Needs more evidence/
          )
        })

        await test.step('3. Wulo forms learner groups from the mastery picture', async () => {
          const groupsResp = await adminRequest.get(
            `/api/learning/class/groups?class_id=${PILOT_CLASS_ID}`
          )
          expect(groupsResp.ok()).toBeTruthy()
          const groups = (await groupsResp.json()) as ClassGroupsResponse
          expect(groups.count ?? 0).toBeGreaterThanOrEqual(3)
          expect((groups.groups ?? []).map(group => group.support_type ?? '')).toEqual(
            expect.arrayContaining(['reteach', 'targeted_practice', 'extension'])
          )

          const groupsPanel = adminPage.getByTestId('differentiation-groups')
          await expect(groupsPanel).toBeVisible()
          await expect(groupsPanel).toContainText('Reteach')
          await expect(groupsPanel).toContainText('Targeted practice')
          await expect(groupsPanel).toContainText('Extension')
        })

        await test.step('4. teacher review approves an intervention plan', async () => {
          await approveFirstPendingPlan(adminRequest)
          await ensurePilotPlanApproved(adminRequest)
          const auditResp = await adminRequest.get('/api/learning/audit')
          expect(auditResp.ok()).toBeTruthy()
          const audit = (await auditResp.json()) as AuditResponse
          expect((audit.events ?? []).map(event => event.kind ?? '')).toContain(
            'plan_approved'
          )
        })

        await test.step('5. follow-up shows mastery movement after support', async () => {
          const followResp = await adminRequest.get(
            `/api/learning/class/follow-up?class_id=${PILOT_CLASS_ID}`
          )
          expect(followResp.ok()).toBeTruthy()
          const follow = (await followResp.json()) as ClassFollowUpResponse
          expect(follow.count ?? 0).toBeGreaterThanOrEqual(1)
          const pilotFollowUp =
            (follow.follow_ups ?? []).find(
              record => record.plan_id === PILOT_PENDING_PLAN_ID
            ) ?? follow.follow_ups?.[0]
          expect(pilotFollowUp).toBeTruthy()
          expect(pilotFollowUp?.delta_mastery ?? 0).toBeGreaterThan(0)
          expect([
            'strong_evidence',
            'thin_evidence',
            'needs_more_evidence',
          ]).toContain(pilotFollowUp?.uncertainty_label)
          expect(pilotFollowUp?.movements?.length ?? 0).toBeGreaterThan(0)

          await adminPage.reload()
          const followUpPanel = adminPage.getByTestId('follow-up-tracker')
          await expect(followUpPanel).toBeVisible()
          await expect(followUpPanel).toContainText('Movement +')
        })
      } finally {
        await adminContext.close()
      }
    } finally {
      await learnerRequest.dispose()
      await adminRequest.dispose()
    }
  })
})