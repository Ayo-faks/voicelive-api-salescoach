/**
 * Premium Wulo demo recording: MCQ evidence to teacher action to movement.
 *
 * Run with:
 * PLAYWRIGHT_RECORD_VIDEO=true npx playwright test e2e/pathfinder-five-step-video.spec.ts --headed
 */
import { expect, request, test } from '@playwright/test'
import type { APIRequestContext, Locator, Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'

test.describe.configure({ mode: 'serial' })

test.use({
  viewport: { width: 1920, height: 1080 },
  colorScheme: 'light',
})

const PILOT_CLASS_ID = 'class-jss2-a'
const PILOT_PENDING_PLAN_ID = 'plan-jss2-ratio-recovery'
const PRACTICE_SKILL_ID = 'ratio-proportion'
const SHOULD_RECORD_VIDEO = process.env.PLAYWRIGHT_RECORD_VIDEO === 'true'
const VIDEO_OUTPUT_DIR = 'test-results/wulo-five-step-video'
const TUTOR_AUDIO_PATH = `${VIDEO_OUTPUT_DIR}/tutor-first-scene.mp3`
const TUTOR_INTRO_TEXT =
  'Wulo tutor. Let us solve this ratio question together. A recipe uses three cups of water for two cups of rice. If the rice becomes six cups, tap the matching water amount.'

const LEARNER_PERSONA = {
  userId: 'dev-learner-video-001',
  name: 'Video Demo Learner',
  email: 'video-demo-learner@localhost',
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

function learnerHeaders(): Record<string, string> {
  return {
    'X-MS-CLIENT-PRINCIPAL-ID': LEARNER_PERSONA.userId,
    'X-MS-CLIENT-PRINCIPAL-NAME': LEARNER_PERSONA.name,
    'X-MS-CLIENT-PRINCIPAL-EMAIL': LEARNER_PERSONA.email,
    'X-MS-CLIENT-PRINCIPAL-IDP': 'local-dev',
  }
}

async function pause(page: Page, ms = 900): Promise<void> {
  await page.waitForTimeout(ms)
}

async function installVideoStyles(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (document.getElementById('wulo-video-style')) return
    const style = document.createElement('style')
    style.id = 'wulo-video-style'
    style.textContent = `
      [data-wulo-video-focus="true"] {
        position: relative !important;
        z-index: 20 !important;
        outline: 4px solid rgba(17, 17, 17, 0.82) !important;
        outline-offset: 8px !important;
        box-shadow: 0 24px 72px rgba(0, 0, 0, 0.18) !important;
        transition: outline-color 180ms ease, box-shadow 180ms ease !important;
      }
      #wulo-video-chapter {
        position: fixed;
        inset: 0;
        z-index: 2147483000;
        display: grid;
        place-items: center;
        padding: 72px;
        background:
          radial-gradient(circle at 20% 20%, rgba(255, 255, 255, 0.96), transparent 34%),
          linear-gradient(135deg, rgba(255, 255, 255, 0.96), rgba(229, 231, 235, 0.94));
        color: #050505;
        text-align: center;
        font-family: 'Helvetica Neue', 'Avenir Next', sans-serif;
        backdrop-filter: blur(18px);
        animation: wuloChapterIn 260ms ease-out both;
      }
      #wulo-video-chapter-card {
        width: min(1120px, 88vw);
        padding: 54px 60px;
        border: 1px solid rgba(0, 0, 0, 0.12);
        border-radius: 32px;
        background: rgba(255, 255, 255, 0.72);
        box-shadow: 0 30px 80px rgba(0, 0, 0, 0.14);
      }
      #wulo-video-eyebrow {
        margin: 0 0 18px;
        color: #4b5563;
        font-family: 'Helvetica Neue', 'Avenir Next', sans-serif;
        font-size: 15px;
        font-weight: 800;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }
      #wulo-video-title {
        margin: 0;
        font-size: 64px;
        line-height: 1.02;
        font-weight: 800;
        letter-spacing: 0;
      }
      #wulo-video-subtitle {
        margin: 22px auto 0;
        max-width: 900px;
        color: rgba(31, 41, 55, 0.92);
        font-family: 'Helvetica Neue', 'Avenir Next', sans-serif;
        font-size: 24px;
        line-height: 1.45;
      }
      @keyframes wuloChapterIn {
        from { opacity: 0; transform: scale(1.015); }
        to { opacity: 1; transform: scale(1); }
      }
    `
    document.head.appendChild(style)
  })
}

async function showChapter(
  page: Page,
  eyebrow: string,
  title: string,
  subtitle: string,
  duration = 2200
): Promise<void> {
  await installVideoStyles(page)
  await page.evaluate(
    ({ eyebrowText, titleText, subtitleText }) => {
      document.getElementById('wulo-video-chapter')?.remove()
      const overlay = document.createElement('div')
      overlay.id = 'wulo-video-chapter'

      const card = document.createElement('div')
      card.id = 'wulo-video-chapter-card'

      const eyebrowNode = document.createElement('p')
      eyebrowNode.id = 'wulo-video-eyebrow'
      eyebrowNode.textContent = eyebrowText

      const heading = document.createElement('h1')
      heading.id = 'wulo-video-title'
      heading.textContent = titleText

      const body = document.createElement('p')
      body.id = 'wulo-video-subtitle'
      body.textContent = subtitleText

      card.append(eyebrowNode, heading, body)
      overlay.appendChild(card)
      document.body.appendChild(overlay)
    },
    { eyebrowText: eyebrow, titleText: title, subtitleText: subtitle }
  )
  await pause(page, duration)
  await page.evaluate(() => {
    document.getElementById('wulo-video-chapter')?.remove()
  })
  await pause(page, 450)
}

async function focusPanel(page: Page, locator: Locator, hold = 1300): Promise<void> {
  await locator.scrollIntoViewIfNeeded()
  await expect(locator).toBeVisible()
  await installVideoStyles(page)
  await page.evaluate(() => {
    for (const element of document.querySelectorAll('[data-wulo-video-focus]')) {
      element.removeAttribute('data-wulo-video-focus')
    }
  })
  await locator.evaluate(element => {
    element.setAttribute('data-wulo-video-focus', 'true')
  })
  await pause(page, hold)
}

async function clearFocus(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const element of document.querySelectorAll('[data-wulo-video-focus]')) {
      element.removeAttribute('data-wulo-video-focus')
    }
  })
}

async function acceptCookieBanner(page: Page): Promise<void> {
  const banner = page.getByTestId('cookie-consent-banner')
  if (await banner.isVisible().catch(() => false)) {
    await page.getByTestId('cookie-consent-accept').click()
    await expect(banner).toBeHidden()
  }
}

async function saveTutorIntroAudio(api: APIRequestContext): Promise<void> {
  if (!SHOULD_RECORD_VIDEO) return
  const audioResp = await api.post('/api/learning/tts', {
    data: {
      text: TUTOR_INTRO_TEXT,
      voice: 'en-NG-EzinneNeural',
      lang: 'en-NG',
    },
  })
  expect(audioResp.ok()).toBeTruthy()
  await mkdir(VIDEO_OUTPUT_DIR, { recursive: true })
  await writeFile(TUTOR_AUDIO_PATH, await audioResp.body())
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
        response_text: `video-seed-answer-${step}`,
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

async function seedPilotGroups(api: APIRequestContext): Promise<void> {
  for (const seed of [
    {
      studentId: 'video-reteach-001',
      probability: 0.32,
      uncertainty: 0.2,
      reason: 'Low mastery evidence from class assessment',
    },
    {
      studentId: 'video-practice-001',
      probability: 0.55,
      uncertainty: 0.34,
      reason: 'Developing mastery with thin evidence',
    },
    {
      studentId: 'video-extension-001',
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

async function approveFirstPendingPlan(api: APIRequestContext): Promise<string> {
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
        reason: 'Teacher reviewed the Wulo video demonstration plan',
      },
    }
  )
  expect(approveResp.ok()).toBeTruthy()
  return planId
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

test('records a premium Wulo five-step teacher-action demo', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(180_000)
  if (!baseURL) throw new Error('baseURL is required')

  const adminRequest = await request.newContext({ baseURL })
  const learnerRequest = await request.newContext({
    baseURL,
    extraHTTPHeaders: learnerHeaders(),
  })

  const videoContext = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: SHOULD_RECORD_VIDEO
      ? {
          dir: 'test-results/wulo-five-step-video',
          size: { width: 1920, height: 1080 },
        }
      : undefined,
  })
  const page = await videoContext.newPage()

  try {
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
    await saveTutorIntroAudio(adminRequest)

    await page.setExtraHTTPHeaders(learnerHeaders())
    await page.goto('/home')
    await page.evaluate(() => {
      window.localStorage.setItem('pf-practice-voice-enabled', '1')
    })
    await acceptCookieBanner(page)
    await showChapter(
      page,
      'Wulo Academy',
      'From MCQ evidence to teacher action',
      'A learner answers. Wulo estimates mastery and uncertainty. The teacher decides what happens next.',
      2600
    )

    const practiceButton = page.getByRole('button', {
      name: 'Open practice: Ratio mini check-in',
    })
    await focusPanel(page, practiceButton, 900)
    await practiceButton.click()
    const practiceFullScreen = page.getByTestId('practice-fullscreen')
    await expect(practiceFullScreen).toBeVisible({ timeout: 15_000 })
    const voiceToggle = page.getByTestId('practice-voice-toggle')
    await expect(voiceToggle).toBeVisible()
    await expect(voiceToggle).toHaveAttribute('aria-pressed', 'true')
    await focusPanel(page, voiceToggle, 1600)
    const mcqCard = page.getByTestId('practice-card')
    await focusPanel(page, mcqCard, 1800)
    await showChapter(
      page,
      '1. Learner evidence',
      'The learner answers a ratio MCQ',
      'A choice becomes evidence. Wulo does not treat one answer as the whole story.',
      1900
    )
    await page.locator('[data-testid^="practice-option-"]').first().click()
    await pause(page, 1500)
    await clearFocus(page)
    await page.getByTestId('practice-close').click()
    await expect(practiceFullScreen).toBeHidden()

    await page.setExtraHTTPHeaders({})
    await page.goto('/teacher')
    await expect(page.getByTestId('route-teacher-dashboard')).toBeVisible()
    await expect(page.locator('[data-testid^="mastery-cell-"]').first()).toBeVisible({
      timeout: 15_000,
    })

    await showChapter(
      page,
      '2. Assessment results',
      'Mastery plus uncertainty appears for the class',
      'Wulo separates what learners likely understand from how strong the evidence is.',
      2200
    )
    await focusPanel(page, page.locator('[data-testid^="mastery-cell-"]').first(), 1200)
    await focusPanel(page, page.getByTestId('weakest-subskills-list'), 1800)

    const groupsResp = await adminRequest.get(
      `/api/learning/class/groups?class_id=${PILOT_CLASS_ID}`
    )
    expect(groupsResp.ok()).toBeTruthy()
    const groups = (await groupsResp.json()) as ClassGroupsResponse
    expect(groups.count ?? 0).toBeGreaterThanOrEqual(3)
    expect((groups.groups ?? []).map(group => group.support_type ?? '')).toEqual(
      expect.arrayContaining(['reteach', 'targeted_practice', 'extension'])
    )

    await showChapter(
      page,
      '3. Learner groups',
      'Wulo groups learners by need',
      'Reteach, targeted practice, extension, or more evidence - the group is editable, not a fixed label.',
      2100
    )
    const groupsPanel = page.getByTestId('differentiation-groups')
    await focusPanel(page, groupsPanel, 2600)

    const approvalCard = page.getByTestId('phase2-pending-approval-card').first()
    await showChapter(
      page,
      '4. Teacher review',
      'The intervention is proposed, not auto-applied',
      'The teacher reviews the plan before it becomes learner-facing support.',
      2200
    )
    await focusPanel(page, approvalCard, 1800)
    await approvalCard.getByRole('button', { name: 'Review plan' }).click()
    await focusPanel(page, page.getByTestId('phase2-plan-review'), 1900)
    await approveFirstPendingPlan(adminRequest)
    await ensurePilotPlanApproved(adminRequest)

    await showChapter(
      page,
      '5. Follow-up movement',
      'Wulo tracks whether support moved mastery',
      'Before and after evidence stays visible, with uncertainty, so the teacher can decide the next move.',
      2300
    )
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
    expect(pilotFollowUp?.movements?.length ?? 0).toBeGreaterThan(0)

    await page.reload()
    const followUpPanel = page.getByTestId('follow-up-tracker')
    await focusPanel(page, followUpPanel, 2600)
    await showChapter(
      page,
      'Teacher stays in control',
      'Wulo turns evidence into action, then checks movement',
      'Assessment results become a reviewed support plan, not an invisible automated decision.',
      2800
    )
    await clearFocus(page)
  } finally {
    await videoContext.close()
    await learnerRequest.dispose()
    await adminRequest.dispose()
  }
})
