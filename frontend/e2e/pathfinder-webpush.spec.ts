/**
 * W8 acceptance — Web Push spaced-retrieval reminders.
 *
 * Validates the four moving parts shipped in commits 1–5:
 *  1. `/sw.js` is served by the production bundle (frontend/public/sw.js).
 *  2. `GET  /api/learning/notifications/push/vapid-public-key` reports config.
 *  3. `POST /api/learning/notifications/push/subscribe` accepts a Web Push
 *     subscription envelope.
 *  4. `POST /api/learning/notifications/revision-cards/schedule` persists the
 *     3-card spaced-retrieval schedule and `GET …/revision-cards` returns it.
 *
 * Runs end-to-end against the harness in playwright.config.ts.
 */
import { expect, request, test } from '@playwright/test'

test.describe('Pathfinder W8 · Web Push reminders', () => {
  test('service worker is reachable from /sw.js', async ({ page, baseURL }) => {
    const resp = await page.request.get(`${baseURL}/sw.js`)
    expect(resp.ok(), `expected 200 from /sw.js, got ${resp.status()}`).toBeTruthy()
    const body = await resp.text()
    expect(body).toContain("addEventListener('push'")
    expect(body).toContain("addEventListener('notificationclick'")
  })

  test('vapid-public-key endpoint reports configuration state', async ({ baseURL }) => {
    const api = await request.newContext({ baseURL })
    try {
      const resp = await api.get('/api/learning/notifications/push/vapid-public-key')
      expect(resp.ok()).toBeTruthy()
      const body = await resp.json()
      expect(body).toHaveProperty('publicKey')
      expect(body).toHaveProperty('configured')
      expect(typeof body.configured).toBe('boolean')
    } finally {
      await api.dispose()
    }
  })

  test('subscribe → schedule → list round-trip persists cards', async ({ baseURL }) => {
    const api = await request.newContext({ baseURL })
    try {
      // The learner-policy gate requires the payload `user_id` to be an
      // owned child id; admin sessions bypass it. Resolve dynamically so the
      // spec works against both the canonical Playwright harness (admin) and
      // a hand-started learner stack.
      const session = await api.get('/api/auth/session').then(r => r.json())
      let userId: string
      if (String(session.role ?? '') === 'learner') {
        const childrenResp = await api.get('/api/children')
        expect(childrenResp.ok(), 'cannot list children for learner').toBeTruthy()
        const childrenBody = await childrenResp.json()
        const firstChild = (childrenBody.children ?? childrenBody ?? [])[0]
        expect(firstChild?.id, 'no child available for learner session').toBeTruthy()
        userId = String(firstChild.id)
      } else {
        userId = `w8-e2e-${Date.now()}`
      }
      const endpoint = `https://fcm.example.invalid/${userId}-${Date.now()}`

      const sub = await api.post('/api/learning/notifications/push/subscribe', {
        data: {
          user_id: userId,
          subscription: {
            endpoint,
            keys: {
              p256dh: 'BMOck-public-key-base64url-padding-omitted',
              auth: 'MOck-auth-secret',
            },
          },
          user_agent: 'pathfinder-e2e/1.0',
        },
      })
      expect(sub.ok(), `subscribe failed: ${sub.status()}`).toBeTruthy()
      const subBody = await sub.json()
      expect(subBody.ok).toBe(true)
      expect(subBody.endpoint).toBe(endpoint)

      const now = Date.now()
      const iso = (msOffset: number) => new Date(now + msOffset).toISOString()
      const cards = [
        { topic_id: 'ratio-proportion', label: 'Today · 10 min', due_at: iso(10 * 60_000) },
        { topic_id: 'ratio-proportion', label: 'Tomorrow · 5 min', due_at: iso(24 * 3_600_000) },
        { topic_id: 'ratio-proportion', label: 'In 4 days · 5 min', due_at: iso(4 * 24 * 3_600_000) },
      ]
      const sched = await api.post(
        '/api/learning/notifications/revision-cards/schedule',
        { data: { user_id: userId, cards } }
      )
      expect(sched.ok(), `schedule failed: ${sched.status()}`).toBeTruthy()
      const schedBody = await sched.json()
      expect(schedBody.ok).toBe(true)
      expect(schedBody.scheduled).toBe(3)
      expect(Array.isArray(schedBody.card_ids)).toBe(true)
      expect(schedBody.card_ids).toHaveLength(3)

      const list = await api.get(
        `/api/learning/notifications/revision-cards?user_id=${encodeURIComponent(userId)}`
      )
      expect(list.ok()).toBeTruthy()
      const listBody = await list.json()
      const labels = (listBody.cards ?? []).map((c: { label: string }) => c.label).sort()
      expect(labels).toEqual(
        ['In 4 days · 5 min', 'Today · 10 min', 'Tomorrow · 5 min']
      )
      const statuses = new Set((listBody.cards ?? []).map((c: { status: string }) => c.status))
      expect(statuses.has('pending')).toBe(true)
    } finally {
      await api.dispose()
    }
  })
})
