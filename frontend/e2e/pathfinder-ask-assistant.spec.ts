/**
 * Pathfinder — Unified Ask Pathfinder drawer (text-only phase 1).
 *
 * Validates:
 *  1. `POST /api/learning/assistant/ask` accepts a question + learner context
 *     and answers without making outcome guarantees.
 *  2. The Learn home shell renders the Ask Pathfinder FAB for learner roles,
 *     opens the drawer with a transcript area, mic placeholder, and send
 *     control, and the drawer transcript shows the assistant's answer.
 *  3. The legacy `career-navigation-moment` card is gone from the home.
 */
import { expect, request, test } from '@playwright/test'

test.describe('Pathfinder · Ask Pathfinder drawer', () => {
  test('assistant endpoint quotes career fits without promising outcomes', async ({ baseURL }) => {
    const api = await request.newContext({ baseURL })
    try {
      const resp = await api.post('/api/learning/assistant/ask', {
        data: {
          user_id: 'e2e-learner',
          question: 'What careers might fit me?',
          career_fits: [
            { label: 'Civil engineer', url: 'https://example.test/civeng' },
            { label: 'Data analyst', url: 'https://example.test/da' },
          ],
          weak_topics: [{ skill_id: 'ratio-proportion', label: 'Ratio and proportion' }],
        },
      })
      expect(resp.ok(), `assistant ask failed: ${resp.status()}`).toBeTruthy()
      const body = await resp.json()
      expect(typeof body.answer).toBe('string')
      expect(body.answer).toMatch(/Civil engineer/)
      expect(body.answer.toLowerCase()).toContain('no outcome guarantee')
      expect(Array.isArray(body.citations)).toBeTruthy()
    } finally {
      await api.dispose()
    }
  })

  test('FAB opens drawer and renders assistant reply in transcript', async ({ page, baseURL }) => {
    test.setTimeout(60_000)
    await page.goto(`${baseURL}/home`)

    const fab = page.getByTestId('ask-pathfinder-fab')
    await expect(fab).toBeVisible({ timeout: 15_000 })
    await fab.click()

    const drawer = page.getByTestId('ask-pathfinder-drawer')
    await expect(drawer).toBeVisible()
    await expect(page.getByTestId('ask-pathfinder-transcript')).toBeVisible()
    await expect(page.getByTestId('ask-pathfinder-mic')).toBeDisabled()

    await page.getByTestId('ask-pathfinder-input').fill('What should I study today?')
    await page.getByTestId('ask-pathfinder-send').click()

    const transcript = page.getByTestId('ask-pathfinder-transcript')
    await expect(transcript).toContainText(/Ratio and proportion/i, { timeout: 15_000 })
  })

  test('legacy Career Navigator card is removed from the Learn home', async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/home`)
    await expect(page.getByTestId('route-student-home')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('career-navigation-moment')).toHaveCount(0)
  })
})
