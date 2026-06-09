import { expect, test, type Page, type Route } from '@playwright/test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const repoRoot = path.resolve(process.cwd(), '..')
const assetRoot = path.join(
  repoRoot,
  'branding and marketing',
  'wulo-flow-ad-assets'
)
const imageDir = path.join(assetRoot, 'images')
const childId = 'flow-demo-learner-001'

function fulfillJson(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

async function installFlowCaptureSeed(page: Page) {
  await page.route('**/api/**', route => fulfillJson(route, {}))

  await page.route('**/api/auth/session', route =>
    fulfillJson(route, {
      authenticated: true,
      user_id: 'flow-demo-learner',
      name: 'Ayoola',
      email: 'flow-demo-learner@localhost',
      provider: 'local-dev',
      role: 'learner',
      needs_onboarding: false,
      is_self_learner: true,
    })
  )

  await page.route('**/api/config', route =>
    fulfillJson(route, {
      onboarding: { tours_enabled: false },
      insights_rail: { enabled: false, voice_mode: 'push_to_talk' },
    })
  )

  await page.route('**/api/me/ui-state', route =>
    fulfillJson(route, { onboarding_complete: true, tours_seen: ['welcome-learner'] })
  )

  await page.route('**/api/children**', route =>
    fulfillJson(route, [
      {
        id: childId,
        name: 'Ayoola',
        created_at: '2026-06-01T09:00:00Z',
        session_count: 12,
        last_session_at: '2026-06-08T10:00:00Z',
      },
    ])
  )

  await page.route('**/api/learners/me/profile', route =>
    fulfillJson(route, {
      profile: {
        display_name: 'Ayoola',
        exam: 'WAEC',
        year_group: 'JSS3',
        age_band: '12-14',
        locale: 'en-NG',
        country: 'NG',
        subjects: ['Mathematics'],
        interests: ['robotics', 'data', 'games'],
        career_consent: true,
        analytics_consent: true,
        tour_seen_at: '2026-06-08T10:00:00Z',
      },
      consents: [],
      needs_onboarding: false,
    })
  )

  await page.route('**/api/learners/me', route =>
    fulfillJson(route, { id: childId, display_name: 'Ayoola', role: 'learner' })
  )

  await page.route('**/api/learning/weekly-stats**', route =>
    fulfillJson(route, {
      sessions: { completed: 4, target: 5 },
      streak_days: 7,
      mastery_delta_pct: 12,
      mastery_focus_label: 'Ratio focus',
    })
  )

  await page.route('**/api/learning/voice/config', route =>
    fulfillJson(route, {
      enabled: true,
      transport: 'push_to_talk',
      offline_fallback: 'queued_voice_frame',
    })
  )

  await page.route('**/api/learning/voice/turn', async route => {
    const payload = route.request().postDataJSON() as {
      answer_option_id?: string | null
      advance?: boolean | null
    }
    const answered = Boolean(payload.answer_option_id || payload.advance)
    return fulfillJson(route, {
      session_complete: false,
      card: answered
        ? {
            card_id: 'ratio-explanation-card',
            kind: 'explanation',
            speak:
              'Let us slow that down. The tutor noticed a ratio-table slip and is giving you the next smaller step.',
            title: 'Dig deeper: why the answer is 9 cups',
            steps: [
              'Find the scale factor first: 2 cups of rice became 6 cups, so the multiplier is 3.',
              'Use the same multiplier for water: 3 cups times 3 is 9 cups.',
              'The intervention is not another hard question; it is a scaffold that repairs the exact misconception.',
            ],
            next_action_label: 'Try the next scaffold',
          }
        : {
            card_id: 'ratio-voice-mcq-card',
            kind: 'mcq-tap',
            speak:
              'Voice is on. I will read the question, listen for your answer, and explain the misconception if you miss it.',
            stem: 'A recipe uses 2 cups of rice and 3 cups of water. If Ayoola uses 6 cups of rice, how much water should he use?',
            skill_id: 'ratio-proportion',
            options: [
              { id: 'a', label: 'A', text: '6 cups' },
              { id: 'b', label: 'B', text: '9 cups' },
              { id: 'c', label: 'C', text: '12 cups' },
              { id: 'd', label: 'D', text: '18 cups' },
            ],
          },
    })
  })

  await page.route('**/api/learning/learner/plan**', route =>
    fulfillJson(route, {
      student_id: childId,
      exam: 'WAEC',
      class_year: 'JSS3',
      subject: 'Mathematics',
      source: 'mastery',
      generated_at: '2026-06-08T10:00:00Z',
      today: [
        {
          id: 'ratio-check',
          title: 'Ratio mini check-in',
          meta: 'Ratio & proportion - adaptive',
          minutes: 5,
          type: 'check-in',
          skill_id: 'ratio-proportion',
          subject: 'Mathematics',
        },
        {
          id: 'fraction-bar',
          title: 'Fraction bar repair',
          meta: 'Fraction operations - worked example',
          minutes: 8,
          type: 'practice',
          skill_id: 'fraction-operations',
          subject: 'Mathematics',
        },
        {
          id: 'exit-ticket',
          title: 'Exit ticket: scaling recipes',
          meta: 'Teacher reviewed',
          minutes: 3,
          type: 'exit-ticket',
          skill_id: 'linear-equations',
          subject: 'Mathematics',
        },
      ],
      weak_topics: [
        {
          skill_id: 'ratio-proportion',
          label: 'Ratio and proportion',
          mastery: 42,
          gap: 'Confuses part-to-whole with part-to-part comparison.',
          next_action: 'Start with a short diagnostic and one visual worked example.',
        },
        {
          skill_id: 'fraction-operations',
          label: 'Fraction operations',
          mastery: 61,
          gap: 'Treats division by two as doubling when notation changes.',
          next_action: 'Use a fraction bar, then retry a parallel problem.',
        },
        {
          skill_id: 'linear-equations',
          label: 'Linear equations',
          mastery: 68,
          gap: 'Needs more fluency moving from word problems to symbols.',
          next_action: 'Connect ratios to simple equations after the check-in.',
        },
      ],
    })
  )

  await page.route('**/api/learning/learner/careers**', route =>
    fulfillJson(route, {
      student_id: childId,
      source: 'mastery',
      career_consent: true,
      generated_at: '2026-06-08T10:00:00Z',
      pathways: [
        {
          id: 'data-analyst',
          title: 'Data analyst apprenticeship',
          fit: 86,
          wage_band: { currency: 'NGN', min_monthly: 180000, max_monthly: 420000 },
          wage_source: 'Labour market outlook - 2026 Q2',
          demand_trend: 'growing',
          demand_source: 'Labour market outlook - 2026 Q2',
          rationale: 'Strong fit with ratio progress, statistics readiness, and spreadsheet interest.',
          skills: [
            { skill_id: 'ratio-proportion', label: 'Ratio and proportion', weight: 0.32, mastery: 61, is_gap: true },
            { skill_id: 'statistics', label: 'Statistics', weight: 0.28, mastery: 74, is_gap: false },
          ],
        },
        {
          id: 'robotics-technician',
          title: 'Robotics technician',
          fit: 78,
          wage_band: { currency: 'NGN', min_monthly: 160000, max_monthly: 360000 },
          wage_source: 'Technical pathway fixture',
          demand_trend: 'growing',
          demand_source: 'Technical pathway fixture',
          rationale: 'Geometry and measurement strengths can transfer into robotics and control systems.',
          skills: [
            { skill_id: 'plane-geometry', label: 'Plane geometry', weight: 0.34, mastery: 86, is_gap: false },
            { skill_id: 'ratio-proportion', label: 'Ratio and proportion', weight: 0.22, mastery: 61, is_gap: true },
          ],
        },
        {
          id: 'ai-engineer',
          title: 'AI engineer',
          fit: 71,
          wage_band: { currency: 'NGN', min_monthly: 240000, max_monthly: 620000 },
          wage_source: 'Digital skills pathway fixture',
          demand_trend: 'growing',
          demand_source: 'Digital skills pathway fixture',
          rationale: 'Pattern recognition and algebra readiness make this a stretch pathway.',
          skills: [
            { skill_id: 'linear-equations', label: 'Linear equations', weight: 0.3, mastery: 68, is_gap: true },
            { skill_id: 'statistics', label: 'Statistics', weight: 0.3, mastery: 74, is_gap: false },
          ],
        },
      ],
    })
  )

  await page.route('**/api/children/*/mastery', route =>
    fulfillJson(route, {
      has_data: true,
      session_count: 12,
      scored_session_count: 10,
      skills: [
        { skill: 'Fractions', mastery: 72, target: 75, sessions: 5 },
        { skill: 'Ratios', mastery: 61, target: 75, sessions: 4 },
        { skill: 'Word problems', mastery: 48, target: 75, sessions: 3 },
        { skill: 'Geometry', mastery: 86, target: 75, sessions: 6 },
        { skill: 'Statistics', mastery: 74, target: 75, sessions: 4 },
      ],
      trajectory: [
        { week: 'W18', score: 52, iso_year: 2026, iso_week: 18 },
        { week: 'W19', score: 58, iso_year: 2026, iso_week: 19 },
        { week: 'W20', score: 61, iso_year: 2026, iso_week: 20 },
        { week: 'W21', score: 68, iso_year: 2026, iso_week: 21 },
        { week: 'W22', score: 72, iso_year: 2026, iso_week: 22 },
      ],
    })
  )

  await page.route('**/api/learning/diagnostic/start', route =>
    fulfillJson(route, {
      session_id: 'flow-diagnostic-session',
      diagnostic_id: 'flow-fraction-diagnostic',
      lang: 'en-NG',
      item: {
        item_id: 'fraction-divide-by-two',
        skill_id: 'fraction-operations',
        prompt: 'What is 3/4 divided by 2?',
        item_type: 'short_answer',
        difficulty: 0.46,
        lang: 'en-NG',
      },
      items_remaining: 2,
      items_total: 3,
    })
  )

  await page.route('**/api/learning/diagnostic/answer', route =>
    fulfillJson(route, {
      session_id: 'flow-diagnostic-session',
      item_id: 'fraction-divide-by-two',
      correct: false,
      expected_answer: '3/8',
      mastery_estimate: {
        kind: 'beta',
        probability: 0.61,
        uncertainty: 0.13,
        a: 8,
        b: 5,
      },
      next_item: {
        item_id: 'fraction-bar-retry',
        skill_id: 'fraction-operations',
        prompt: 'If you take half of 1/2, what fraction do you get?',
        item_type: 'short_answer',
        difficulty: 0.38,
        lang: 'en-NG',
      },
      items_remaining: 1,
      completed: false,
      pending_plan: null,
      pending_facts: [],
      completion_xapi: null,
    })
  )
}

async function installCaptureBrowserDoubles(page: Page) {
  await page.addInitScript({
    content: `
      (() => {
        window.localStorage.setItem('pathfinder.cookie-consent.v1', 'accepted');

        const originalWebSocket = window.WebSocket;
        class FlowVoiceWebSocket extends EventTarget {
          static CONNECTING = 0;
          static OPEN = 1;
          static CLOSING = 2;
          static CLOSED = 3;
          readyState = 0;
          bufferedAmount = 0;
          extensions = '';
          protocol = '';
          binaryType = 'blob';
          onopen = null;
          onmessage = null;
          onerror = null;
          onclose = null;
          constructor(url) {
            super();
            this.url = String(url);
            window.setTimeout(() => {
              this.readyState = FlowVoiceWebSocket.OPEN;
              const openEvent = new Event('open');
              this.onopen?.(openEvent);
              this.dispatchEvent(openEvent);
            }, 50);
          }
          send(message) {
            let type = '';
            try { type = JSON.parse(String(message)).type; } catch {}
            if (type !== 'response.create') return;
            window.setTimeout(() => {
              const messageEvent = new MessageEvent('message', {
                data: JSON.stringify({
                  type: 'wulo.learner_card',
                  payload: {
                    session_complete: false,
                    card: {
                      card_id: 'dig-deeper-live-tutor',
                      kind: 'explanation',
                      speak: 'I can dig deeper while staying grounded in the learner profile and the exact question they missed.',
                      title: 'Live tutor: dig deeper on the misconception',
                      steps: [
                        'I heard the learner ask for help on ratio scaling.',
                        'I connect the mistake to the mastery profile: part-to-whole confusion.',
                        'I give one smaller scaffold, then update the next intervention.',
                      ],
                      next_action_label: 'Ask another follow-up',
                    },
                  },
                }),
              });
              this.onmessage?.(messageEvent);
              this.dispatchEvent(messageEvent);
            }, 250);
          }
          close() {
            this.readyState = FlowVoiceWebSocket.CLOSED;
            const closeEvent = new Event('close');
            this.onclose?.(closeEvent);
            this.dispatchEvent(closeEvent);
          }
        }

        function FlowCaptureWebSocket(url, protocols) {
          if (!String(url).includes('/ws/voice')) {
            return protocols === undefined
              ? new originalWebSocket(url)
              : new originalWebSocket(url, protocols);
          }
          return new FlowVoiceWebSocket(url);
        }
        FlowCaptureWebSocket.CONNECTING = originalWebSocket.CONNECTING ?? 0;
        FlowCaptureWebSocket.OPEN = originalWebSocket.OPEN ?? 1;
        FlowCaptureWebSocket.CLOSING = originalWebSocket.CLOSING ?? 2;
        FlowCaptureWebSocket.CLOSED = originalWebSocket.CLOSED ?? 3;
        FlowCaptureWebSocket.prototype = originalWebSocket.prototype;
        window.WebSocket = FlowCaptureWebSocket;

        class FlowAudioContext {
          state = 'running';
          destination = {};
          audioWorklet = { addModule: async () => undefined };
          resume = async () => undefined;
          createMediaStreamSource() {
            return { connect() {}, disconnect() {} };
          }
          createAnalyser() {
            return {
              fftSize: 1024,
              smoothingTimeConstant: 0,
              getFloatTimeDomainData(buffer) { buffer.fill(0.08); },
              disconnect() {},
            };
          }
        }
        class FlowAudioWorkletNode {
          port = { onmessage: null, postMessage() {} };
          connect() {}
          disconnect() {}
        }
        Object.defineProperty(window, 'AudioContext', { value: FlowAudioContext, configurable: true });
        Object.defineProperty(window, 'AudioWorkletNode', { value: FlowAudioWorkletNode, configurable: true });
        Object.defineProperty(navigator, 'mediaDevices', {
          configurable: true,
          value: {
            getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }),
          },
        });
      })();
    `,
  })
}

async function capture(page: Page, name: string, manifest: Array<Record<string, string>>) {
  const fileName = `${name}.png`
  await page.screenshot({ path: path.join(imageDir, fileName), fullPage: false })
  manifest.push({ shot: name, file: `images/${fileName}`, size: '1920x1080' })
}

test.describe('Wulo Flow ad real app captures', () => {
  test('captures seeded Wulo app screens for Flow', async ({ page }) => {
    test.setTimeout(120_000)
    await rm(imageDir, { recursive: true, force: true })
    await mkdir(imageDir, { recursive: true })
    await page.setViewportSize({ width: 1920, height: 1080 })
    await installCaptureBrowserDoubles(page)
    await installFlowCaptureSeed(page)

    await page.addStyleTag({
      content: `
        [data-testid="wulo-tour-tooltip"],
        [data-testid="help-menu-trigger"],
        [data-testid="cookie-consent-banner"],
        .toast,
        .cookie-banner { display: none !important; }
      `,
    })

    const manifest: Array<Record<string, string>> = []

    await page.goto('/home', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('route-student-home')).toBeVisible()
    await expect(page.getByTestId('start-learner-tutor')).toBeVisible()
    await capture(page, '01-real-app-voice-tutor-entry', manifest)

    await page.goto('/home?startPractice=1&skillId=ratio-proportion', {
      waitUntil: 'domcontentloaded',
    })
    await expect(page.getByTestId('practice-fullscreen')).toBeVisible()
    await expect(page.getByTestId('practice-card')).toHaveAttribute(
      'data-card-kind',
      'mcq-tap'
    )
    await expect(page.getByTestId('practice-voice-toggle')).toContainText(
      /Voice on|Speaking/
    )
    await capture(page, '02-real-app-voice-practice-question', manifest)

    const firstPracticeOption = page
      .locator('[data-testid^="practice-option-"]')
      .first()
    await expect(firstPracticeOption).toBeEnabled()
    await firstPracticeOption.click()
    await expect(page.getByTestId('practice-card')).toHaveAttribute(
      'data-card-kind',
      'explanation'
    )
    await capture(page, '03-real-app-voice-explanation-tutor', manifest)

    await page.goto('/home', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('learner-help-fab')).toBeVisible()
    await page.getByTestId('learner-help-fab').click()
    await expect(page.getByTestId('learner-tutor')).toBeVisible()
    await expect(page.getByTestId('learner-tutor')).toHaveAttribute(
      'data-mode',
      'floating'
    )
    await capture(page, '04-real-app-live-tutor-dig-deeper', manifest)

    await page.goto('/home', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('route-student-home')).toBeVisible()
    await page.getByTestId('practise-topic-ratio-proportion').click()
    await expect(page.getByTestId('diagnostic-panel')).toBeVisible()
    await page.getByTestId('diagnostic-answer-input').fill('3/2')
    await page.getByTestId('diagnostic-submit').click()
    await expect(page.getByTestId('diagnostic-feedback')).toBeVisible()
    await page.getByTestId('diagnostic-explain').click()
    await expect(page.getByTestId('diagnostic-explain-text')).toBeVisible()
    await capture(page, '05-real-app-diagnostic-explain-mistake', manifest)

    await page.goto('/pathways', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('route-pathways-explorer')).toBeVisible()
    await capture(page, '06-real-app-career-pathways', manifest)

    await page.goto('/home', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('route-student-home')).toBeVisible()
    const parentShareSummary = page.getByTestId('parent-share-summary')
    await expect(parentShareSummary).toBeVisible()
    await parentShareSummary.scrollIntoViewIfNeeded()
    await page.getByTestId('parent-disclosure-summary').click()
    await expect(page.getByTestId('parent-share-preview')).toBeVisible()
    await parentShareSummary.evaluate(element => {
      const rect = element.getBoundingClientRect()
      const targetTop =
        window.scrollY + rect.top - Math.max(24, (window.innerHeight - rect.height) / 2)
      window.scrollTo(0, Math.max(0, targetTop))
    })
    await expect(parentShareSummary).toBeInViewport({
      ratio: 0.95,
    })
    await capture(page, '07-real-app-parent-summary', manifest)

    await writeFile(
      path.join(assetRoot, 'manifest.json'),
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          source: 'frontend/e2e/capture-wulo-flow-real-app.spec.ts',
          intent:
            'Google Flow Omni reference screenshots for Wulo voice-agent, tutor explanation, mastery, career, and parent-summary moments rendered from real app routes with seeded demo API data.',
          shots: manifest,
        },
        null,
        2
      )}\n`
    )
  })
})