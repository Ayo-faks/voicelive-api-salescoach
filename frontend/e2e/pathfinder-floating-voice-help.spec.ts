import { expect, test, type Page, type Route } from '@playwright/test'

import { installRouteMocks } from './fixtures/pathfinder-route-mocks'

const THEME_STORAGE_KEY = 'pathfinder-theme'
const COOKIE_STORAGE_KEY = 'pathfinder.cookie-consent.v1'

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

async function seedTheme(page: Page, mode: 'light' | 'dark'): Promise<void> {
  await page.addInitScript(
    ([themeKey, cookieKey, themeMode]) => {
      window.localStorage.setItem(themeKey, themeMode)
      window.localStorage.setItem(cookieKey, 'accepted')
    },
    [THEME_STORAGE_KEY, COOKIE_STORAGE_KEY, mode]
  )
}

async function installHomeMocks(page: Page): Promise<void> {
  await installRouteMocks(page, { role: 'learner' })
  await page.route('**/api/config', (route) =>
    fulfillJson(route, {
      onboarding: { tours_enabled: false },
      insights_rail: { enabled: true, voice_mode: 'push_to_talk' },
      learner_voice_fullscreen_enabled: true,
      voice_agent_fullscreen_enabled: true,
    })
  )
  await page.route('**/api/learning/voice/turn', (route) =>
    fulfillJson(route, {
      session_complete: false,
      card: {
        card_id: 'practice-card-1',
        kind: 'mcq-tap',
        speak: 'Choose the ratio answer.',
        stem: '2 cups rice need 3 cups water. What do 6 cups need?',
        options: [
          { id: 'a', label: 'A', text: '6 cups' },
          { id: 'b', label: 'B', text: '9 cups' },
        ],
        skill_id: 'ratio-proportion',
      },
    })
  )
  await page.routeWebSocket('**/ws/voice**', (ws) => {
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
}

/** Relative luminance of a computed `rgb(...)` colour. */
function luminanceOf(rgb: string): number {
  const match = rgb.match(/(\d+(?:\.\d+)?)/g)
  if (!match || match.length < 3) return 0
  const [r, g, b] = match.slice(0, 3).map(Number)
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

test.describe('Learner home voice entry points', () => {
  test('home exposes one primary voice tutor and no standalone floating voice FAB', async ({
    page,
  }) => {
    await seedTheme(page, 'light')
    await installHomeMocks(page)

    await page.goto('/home')
    await expect(page.getByTestId('route-student-home')).toBeVisible({
      timeout: 15_000,
    })

    // The old bottom-left floating voice FAB is gone.
    await expect(page.getByTestId('learner-help-fab')).toHaveCount(0)

    // The bottom-right text assistant remains the only persistent FAB.
    const askFab = page.getByTestId('ask-pathfinder-fab')
    await expect(askFab).toBeVisible()

    // In light theme it belongs to the light UI (light surface, not hard black).
    const lightBg = await askFab.evaluate(
      (el) => getComputedStyle(el).backgroundColor
    )
    expect(luminanceOf(lightBg)).toBeGreaterThan(0.6)

    // "Study with Wulo" still opens the voice tutor.
    await page.getByRole('button', { name: /Study with Wulo/i }).first().click()
    const tutor = page.getByTestId('learner-tutor')
    await expect(tutor).toBeVisible()
    await expect(tutor).toHaveAttribute('data-mode', 'fullscreen')
  })

  test('Ask Wulo Academy FAB adapts to dark theme', async ({ page }) => {
    await seedTheme(page, 'dark')
    await installHomeMocks(page)

    await page.goto('/home')
    await expect(page.getByTestId('route-student-home')).toBeVisible({
      timeout: 15_000,
    })

    const askFab = page.getByTestId('ask-pathfinder-fab')
    await expect(askFab).toBeVisible()
    const darkBg = await askFab.evaluate(
      (el) => getComputedStyle(el).backgroundColor
    )
    expect(luminanceOf(darkBg)).toBeLessThan(0.4)
  })

  test('practice keeps inline voice answer controls', async ({ page }) => {
    await seedTheme(page, 'light')
    await installHomeMocks(page)

    await page.goto('/home?startPractice=1')

    await expect(page.getByTestId('practice-card')).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByTestId('practice-voice-mic')).toBeVisible()
  })
})
