/**
 * Observability acceptance — the admin observability dashboard renders the
 * product / health / safety-agent sections from the backend aggregation
 * endpoint, with each tile badged by provenance (live / pilot data / no data).
 */
import { expect, request, test } from '@playwright/test'

test.describe('Pathfinder · observability dashboard', () => {
  test('renders backend-sourced product, health and safety sections', async ({
    page,
    baseURL,
  }) => {
    await page.goto('/observability')

    const dashboard = page.getByTestId('pf-observability-dashboard')
    await expect(dashboard).toBeVisible()

    // Overall roll-up pill is always present.
    await expect(page.getByTestId('pf-obs-overall-status')).toBeVisible()

    // The three required sections must render.
    await expect(page.getByTestId('pf-obs-section-product')).toBeVisible()
    await expect(page.getByTestId('pf-obs-section-health')).toBeVisible()
    await expect(page.getByTestId('pf-obs-section-safety-agent')).toBeVisible()

    // Representative tiles from each section.
    await expect(page.getByTestId('pf-obs-tile-north-star-retry')).toBeVisible()
    await expect(page.getByTestId('pf-obs-tile-api-error-rate')).toBeVisible()
    await expect(
      page.getByTestId('pf-obs-tile-citation-coverage')
    ).toBeVisible()

    // Each visible tile exposes a value and a status badge.
    await expect(
      page.getByTestId('pf-obs-tile-north-star-retry-value')
    ).toBeVisible()
    await expect(
      page.getByTestId('pf-obs-tile-north-star-retry-status')
    ).toBeVisible()

    // Generated-at footer confirms the payload was rendered.
    await expect(page.getByTestId('pf-obs-generated-at')).toBeVisible()

    // No error state.
    await expect(page.getByTestId('pf-obs-error')).toHaveCount(0)

    // Validate the backing API contract directly.
    const api = await request.newContext({ baseURL })
    const resp = await api.get('/api/learning/observability/dashboard')
    expect(resp.ok()).toBeTruthy()
    const body = await resp.json()
    expect(['ok', 'warn', 'crit', 'nodata']).toContain(body.overall_status)
    const sectionIds = body.sections.map((s: { id: string }) => s.id)
    expect(sectionIds).toEqual(
      expect.arrayContaining(['product', 'health', 'safety-agent'])
    )
    const tileIds = body.sections.flatMap((s: { tiles: { id: string }[] }) =>
      s.tiles.map((t) => t.id)
    )
    expect(tileIds).toEqual(
      expect.arrayContaining([
        'north-star-retry',
        'api-error-rate',
        'citation-coverage',
      ])
    )
    for (const section of body.sections) {
      for (const tile of section.tiles) {
        expect(['ok', 'warn', 'crit', 'nodata']).toContain(tile.status)
        expect(['live', 'kql', 'snapshot', 'fixture', 'nodata']).toContain(tile.source)
      }
    }
    await api.dispose()
  })
})
