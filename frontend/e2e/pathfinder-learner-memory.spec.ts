/**
 * Pathfinder learner-memory B2C panel + consent modal end-to-end.
 *
 * Assumes a Vite dev server is already running at PLAYWRIGHT_BASE_URL
 * (defaults to http://localhost:5173) — the spec does not start one.
 * Run with:
 *   PLAYWRIGHT_SKIP_WEBSERVER=true PLAYWRIGHT_BASE_URL=http://localhost:5173 \
 *     npx playwright test e2e/pathfinder-learner-memory.spec.ts
 */
import { expect, test, type Route } from '@playwright/test'

import { installRouteMocks } from './fixtures/pathfinder-route-mocks'

test.use({ baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173' })

interface MemoryFact {
  id: string
  tenant_id: string
  student_id: string
  status: string
  fact: { key: string; value: string }
  expires_at: string | null
  created_at: string
  updated_at: string
}

function fact(
  id: string,
  key: string,
  value: string,
  opts: { expires_at?: string | null } = {}
): MemoryFact {
  return {
    id,
    tenant_id: 'tenant-phase-2',
    student_id: 'e2e-learner-001',
    status: opts.expires_at ? 'auto_approved' : 'approved',
    fact: { key, value },
    expires_at: opts.expires_at ?? null,
    created_at: '2026-05-29T10:00:00Z',
    updated_at: '2026-05-29T10:00:00Z',
  }
}

test('learner can consent, see remembered facts, and delete one', async ({ page }) => {
  await installRouteMocks(page, { role: 'learner' })

  let consentAccepted = false
  let facts: MemoryFact[] = []
  const deleteCalls: Array<{ url: string; body: string }> = []

  await page.route('**/api/learning/memory/consent**', async (route: Route) => {
    const method = route.request().method()
    if (method === 'POST') {
      const body = route.request().postDataJSON?.() ?? {}
      consentAccepted = Boolean(body.accepted)
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        learner_id: 'e2e-learner-001',
        accepted: consentAccepted,
        accepted_at: consentAccepted ? '2026-05-29T10:01:00Z' : null,
        withdrawn_at: null,
        policy_version: 'v1',
      }),
    })
  })

  await page.route('**/api/learning/memory**', async (route: Route) => {
    const method = route.request().method()
    const url = route.request().url()
    if (url.includes('/memory/consent')) return route.fallback()

    if (method === 'DELETE') {
      const match = url.match(/\/api\/learning\/memory\/([^/?]+)/)
      const factId = match ? decodeURIComponent(match[1]) : ''
      deleteCalls.push({ url, body: route.request().postData() ?? '' })
      facts = facts.filter((f) => f.id !== factId)
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, fact_id: factId }),
      })
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        learner_id: 'e2e-learner-001',
        consent: {
          learner_id: 'e2e-learner-001',
          accepted: consentAccepted,
          accepted_at: consentAccepted ? '2026-05-29T10:01:00Z' : null,
          withdrawn_at: null,
          policy_version: 'v1',
        },
        facts,
        count: facts.length,
      }),
    })
  })

  await page.goto('/home')

  // Consent modal opens because GET /consent returned accepted:false.
  const dialog = page.getByRole('dialog', { name: /Remember a few things about you/i })
  await expect(dialog).toBeVisible({ timeout: 15_000 })

  await dialog.getByLabel(/Yes, remember these things/i).check()
  await dialog.getByRole('button', { name: /Turn on memory/i }).click()
  await expect(dialog).toBeHidden()

  // Re-stub the memory list with two facts and reload to refetch the panel.
  facts = [
    fact('fact-subject-1', 'preferred_subject', 'Physics'),
    fact('fact-mood-1', 'mood', 'curious', { expires_at: '2026-06-01T10:00:00Z' }),
  ]

  await page.reload()

  const panel = page.getByRole('region', { name: /Learner memory/i })
  await expect(panel).toBeVisible({ timeout: 15_000 })

  // Categories appear with correct labels.
  await expect(panel.getByText('Subjects & goals')).toBeVisible()
  await expect(panel.getByText('Mood (last 3 days)')).toBeVisible()

  // Both chips render with values.
  await expect(panel.getByText('Physics')).toBeVisible()
  await expect(panel.getByText('curious')).toBeVisible()

  // Delete the persistent fact.
  await panel.getByRole('button', { name: /Delete preferred subject/i }).click()

  await expect.poll(() => deleteCalls.length).toBeGreaterThan(0)
  const call = deleteCalls[deleteCalls.length - 1]
  expect(call.url).toContain('/api/learning/memory/fact-subject-1')
  expect(call.body).toContain('"learner_id"')
  expect(JSON.parse(call.body)).toMatchObject({ learner_id: expect.any(String) })

  await expect(panel.getByText('Physics')).toBeHidden()
  await expect(panel.getByText('curious')).toBeVisible()
})
