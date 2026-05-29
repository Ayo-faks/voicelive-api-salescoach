/**
 * F2 acceptance — pilot KPI strip is sourced from the backend and shows the
 * "fixture" provenance badge until live pilot data exists.
 */
import { expect, request, test } from '@playwright/test'

test.describe('Pathfinder · pilot KPI strip', () => {
  test('renders backend KPI cards with a fixture badge', async ({
    page,
    baseURL,
  }) => {
    await page.goto('/safety')

    const strip = page.getByTestId('pilot-kpi-strip')
    await expect(strip).toBeVisible()

    const cards = page.getByTestId('pilot-kpi-card')
    await expect(cards).toHaveCount(6)

    const badges = page.getByTestId('pilot-kpi-source-badge')
    // UI label for non-live KPIs is "Snapshot"; backend `source` is still "fixture".
    await expect(badges.first()).toHaveText(/snapshot|fixture/i)

    await expect(page.getByTestId('pilot-kpi-provenance')).toBeVisible()

    const api = await request.newContext({ baseURL })
    const resp = await api.get('/api/learning/kpis')
    expect(resp.ok()).toBeTruthy()
    const body = await resp.json()
    expect(body.source).toBe('fixture')
    expect(body.cards).toHaveLength(6)
    expect(typeof body.report.meets_pilot_thresholds).toBe('boolean')
    expect(Array.isArray(body.provenance)).toBe(true)
    expect(body.provenance.length).toBeGreaterThan(0)
    await api.dispose()
  })
})
