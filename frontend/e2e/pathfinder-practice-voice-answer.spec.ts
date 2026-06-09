import { expect, test, type Page, type Route } from '@playwright/test'

import { installRouteMocks } from './fixtures/pathfinder-route-mocks'

test.use({
  permissions: ['microphone'],
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
    ],
  },
})

const firstCard = {
  card_id: 'practice-card-1',
  kind: 'mcq-tap',
  speak: 'Choose the ratio answer.',
  stem: '2 cups rice need 3 cups water. What do 6 cups need?',
  options: [
    { id: 'a', label: 'A', text: '6 cups' },
    { id: 'b', label: 'B', text: '9 cups' },
  ],
  skill_id: 'ratio-proportion',
}

const secondCard = {
  card_id: 'practice-card-2',
  kind: 'mcq-tap',
  speak: 'Try the follow-up ratio.',
  stem: '4 books cost 800 naira. What do 2 books cost?',
  options: [
    { id: 'a', label: 'A', text: '400 naira' },
    { id: 'b', label: 'B', text: '1600 naira' },
  ],
  skill_id: 'ratio-proportion',
}

function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

async function installPracticeMocks(page: Page): Promise<void> {
  await installRouteMocks(page, { role: 'learner' })
  await page.route('**/api/config', (route) =>
    fulfillJson(route, {
      onboarding: { tours_enabled: false },
      insights_rail: { enabled: true, voice_mode: 'push_to_talk' },
      learner_voice_fullscreen_enabled: true,
      voice_agent_fullscreen_enabled: true,
    })
  )
  await page.route('**/api/learning/voice/turn', async (route) => {
    const payload = route.request().postDataJSON() as {
      last_card_id?: string
      answer_option_id?: string
    }
    if (payload.last_card_id === firstCard.card_id && payload.answer_option_id) {
      return fulfillJson(route, { card: secondCard, session_complete: false })
    }
    return fulfillJson(route, { card: firstCard, session_complete: false })
  })
}

test.describe('Pathfinder practice voice answers', () => {
  test('inline mic advances the card through mocked /ws/voice while tap answers still work', async ({
    page,
  }) => {
    await installPracticeMocks(page)

    let activeSocket: { send: (message: string) => void } | null = null
    let capturedLastCardId: string | null = null

    await page.routeWebSocket('**/ws/voice**', (ws) => {
      activeSocket = ws
      const url = new URL(ws.url())
      capturedLastCardId = url.searchParams.get('last_card_id')
      ws.onMessage(() => undefined)
    })

    await page.goto('/home?startPractice=1')

    const cardSlot = page.getByTestId('practice-card-slot')
    const card = page.getByTestId('practice-card')
    await expect(card).toBeVisible({ timeout: 15_000 })
    await expect(card).toHaveAttribute('data-card-id', firstCard.card_id)
    await expect(page.getByTestId('practice-voice-mic')).toBeVisible()
    await expect(page.getByTestId('practice-talk')).toHaveCount(0)

    const voiceToggle = page.getByTestId('practice-voice-toggle')
    await expect(voiceToggle).toBeVisible()
    await voiceToggle.click()
    await expect(voiceToggle).toContainText('Voice off')
    await voiceToggle.click()
    await expect(voiceToggle).toContainText(/Voice on|Speaking/)

    await expect.poll(() => capturedLastCardId).toBe(firstCard.card_id)

    const slotHandle = await cardSlot.elementHandle()
    activeSocket?.send(
      JSON.stringify({
        type: 'wulo.learner_card',
        payload: { card: secondCard, session_complete: false },
      })
    )

    await expect(card).toHaveAttribute('data-card-id', secondCard.card_id)
    const sameSlot = await cardSlot.evaluate(
      (node, previous) => node.isSameNode(previous as Node),
      slotHandle
    )
    expect(sameSlot).toBe(true)
    await slotHandle?.dispose()

    await page.getByTestId('practice-option-a').click()
    await expect(page.getByTestId('practice-card')).toBeVisible()
  })

  test('mic permission denial shows a visible inline error', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          getUserMedia: () => Promise.reject(new DOMException('denied', 'NotAllowedError')),
        },
      })
    })
    await installPracticeMocks(page)
    await page.routeWebSocket('**/ws/voice**', (ws) => {
      ws.onMessage(() => undefined)
    })

    await page.goto('/home?startPractice=1')
    await expect(page.getByTestId('practice-card')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('practice-voice-mic').click()
    await expect(page.getByTestId('practice-voice-error')).toContainText(
      'Tutor needs your microphone to listen'
    )
  })
})
