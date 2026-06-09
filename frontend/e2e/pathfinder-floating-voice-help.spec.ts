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

function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

async function installFloatingMocks(page: Page): Promise<void> {
  await installRouteMocks(page, { role: 'learner' })
  await page.route('**/api/config', (route) =>
    fulfillJson(route, {
      onboarding: { tours_enabled: false },
      insights_rail: { enabled: true, voice_mode: 'push_to_talk' },
      learner_voice_fullscreen_enabled: true,
      voice_agent_fullscreen_enabled: true,
    })
  )
}

test.describe('Pathfinder floating voice help assistant', () => {
  test('global Help FAB opens floating tutor and preserves one WS session across expand/collapse', async ({
    page,
  }) => {
    await installFloatingMocks(page)
    let connectionCount = 0

    await page.routeWebSocket('**/ws/voice**', (ws) => {
      connectionCount += 1
      ws.onMessage((message) => {
        let type: string | undefined
        try {
          type = JSON.parse(String(message)).type
        } catch {
          type = undefined
        }
        if (type === 'response.create') {
          ws.send(
            JSON.stringify({
              type: 'wulo.learner_card',
              payload: {
                session_complete: false,
                card: {
                  card_id: 'help-card-1',
                  kind: 'mark-known',
                  speak: 'What would you like help with?',
                  prompt: 'What would you like help with?',
                  confirm_label: 'Show me a practice card',
                },
              },
            })
          )
        }
      })
    })

    await page.goto('/home')
    await expect(page.getByTestId('route-student-home')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('ask-pathfinder-fab')).toBeVisible()

    await page.getByTestId('learner-help-fab').click()
    const tutor = page.getByTestId('learner-tutor')
    await expect(tutor).toBeVisible()
    await expect(tutor).toHaveAttribute('data-mode', 'floating')
    await expect.poll(() => connectionCount).toBe(1)

    await page.getByTestId('learner-tutor-expand').click()
    await expect(tutor).toHaveAttribute('data-mode', 'fullscreen')
    await expect(page.getByTestId('learner-tutor-orb')).toBeVisible()
    await expect.poll(() => connectionCount).toBe(1)

    await page.getByTestId('learner-tutor-collapse').click()
    await expect(tutor).toHaveAttribute('data-mode', 'floating')
    await expect.poll(() => connectionCount).toBe(1)

    await page.getByTestId('learner-tutor-close').click()
    await expect(tutor).toHaveCount(0)
    await expect(page.getByTestId('ask-pathfinder-fab')).toBeVisible()
  })
})
