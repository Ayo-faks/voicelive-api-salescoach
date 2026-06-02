/**
 * Pathfinder — Unified Ask Pathfinder drawer.
 *
 * Validates:
 *  1. `POST /api/learning/assistant/ask` accepts a question + learner context.
 *     The assistant grounds strictly on the curriculum corpus and safely defers
 *     on out-of-corpus questions (e.g. careers), never promising outcomes.
 *  2. The Learn home shell renders the Ask Pathfinder FAB for learner roles,
 *     opens the drawer with a transcript area and a text composer (send), and
 *     the drawer transcript streams in the assistant's answer.
 *  3. The legacy `career-navigation-moment` card is gone from the home.
 */
import { expect, request, test } from '@playwright/test'
import { installRouteMocks } from './fixtures/pathfinder-route-mocks'

test.describe('Pathfinder · Ask Pathfinder drawer', () => {
  test('assistant endpoint grounds or defers without promising outcomes', async ({ baseURL }) => {
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
      expect(body.answer.length).toBeGreaterThan(0)
      expect(Array.isArray(body.citations)).toBeTruthy()
      // Career asks sit outside the curriculum corpus, so the grounded
      // assistant must defer rather than fabricate a pathway claim, and it
      // must never promise an outcome.
      if (typeof body.grounded === 'boolean') {
        expect(body.grounded).toBe(false)
      }
      expect(body.answer).not.toMatch(
        /guarantee(d)?\s+(you|your|a\b|admission|pass|success|career|job)/i,
      )
    } finally {
      await api.dispose()
    }
  })

  test('FAB opens drawer and renders assistant reply in transcript', async ({ page, baseURL }) => {
    test.setTimeout(60_000)
    await installRouteMocks(page, { role: 'learner' })
    await page.goto(`${baseURL}/home`)

    const fab = page.getByTestId('ask-pathfinder-fab')
    await expect(fab).toBeVisible({ timeout: 15_000 })
    await fab.click()

    const drawer = page.getByTestId('ask-pathfinder-drawer')
    await expect(drawer).toBeVisible()
    await expect(page.getByTestId('ask-pathfinder-transcript')).toBeVisible()
    await expect(page.getByTestId('ask-pathfinder-input')).toBeVisible()

    await page.getByTestId('ask-pathfinder-input').fill('What should I study today?')
    await page.getByTestId('ask-pathfinder-send').click()

    const transcript = page.getByTestId('ask-pathfinder-transcript')
    await expect(transcript).toContainText(/Ratio and proportion/i, { timeout: 15_000 })
  })

  test('legacy Career Navigator card is removed from the Learn home', async ({ page, baseURL }) => {
    await installRouteMocks(page, { role: 'learner' })
    await page.goto(`${baseURL}/home`)
    await expect(page.getByTestId('route-student-home')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('career-navigation-moment')).toHaveCount(0)
  })
})
