/**
 * Pathfinder safety surfaces — kill switch + admin trust banner.
 *
 * Exercises the runtime safety controls wired into /api/config (the new
 * `safety` payload) and asserts the learner /home + admin /safety routes
 * react to them. Uses the shared `installRouteMocks` helper and overlays
 * a stricter /api/config response so we can assert both states without
 * relying on the backend.
 */
import { expect, test, type Page } from '@playwright/test'

import { installRouteMocks } from './fixtures/pathfinder-route-mocks'

async function overrideConfig(
  page: Page,
  safety: {
    learner_voice_disabled: boolean
    production_content_review_required?: boolean
  }
) {
  await page.route('**/api/config', async route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        proxy_enabled: true,
        ws_endpoint: '/ws',
        storage_ready: true,
        telemetry_enabled: false,
        image_base_path: '/img',
        onboarding: { tours_enabled: false },
        insights_rail: { enabled: true, voice_mode: 'push_to_talk' },
        safety: {
          learner_voice_disabled: safety.learner_voice_disabled,
          session_turn_cap: null,
          session_token_cap: null,
          production_content_review_required:
            safety.production_content_review_required ?? false,
        },
      }),
    })
  )
}

test.describe('Pathfinder · safety controls', () => {
  test('/home hides the voice check-in CTA when learner voice is disabled', async ({
    page,
  }) => {
    await installRouteMocks(page, { role: 'learner' })
    await overrideConfig(page, { learner_voice_disabled: true })

    await page.goto('/home')
    await expect(page.getByTestId('pathfinder-learn-app')).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByTestId('route-student-home')).toBeVisible({
      timeout: 15_000,
    })

    await expect(page.getByTestId('start-voice-checkin')).toHaveCount(0)
    // The notice may or may not render depending on whether the underlying
    // voiceConfig.enabled flag is true in mocks; either way we must not see
    // the CTA itself.
  })

  test('/safety surfaces the admin safety banner when voice is disabled', async ({
    page,
  }) => {
    await installRouteMocks(page, { role: 'admin' })
    await overrideConfig(page, {
      learner_voice_disabled: true,
      production_content_review_required: true,
    })

    await page.goto('/safety')
    await expect(page.getByTestId('pathfinder-learn-app')).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByTestId('route-trust-safety')).toBeVisible({
      timeout: 15_000,
    })

    const status = page.getByTestId('admin-safety-status')
    await expect(status).toBeVisible()
    await expect(page.getByTestId('admin-safety-voice')).toHaveText(
      /temporarily unavailable/i
    )
    await expect(page.getByTestId('admin-safety-content-review')).toHaveText(
      /Content review: required/i
    )
    await expect(page.getByTestId('admin-safety-export')).toHaveText(
      /blocked while safety review is open/i
    )
    const exportBtn = page.getByTestId('admin-export-report')
    await expect(exportBtn).toBeDisabled()
  })

  test('/safety reports available state when /api/config reports voice enabled', async ({
    page,
  }) => {
    await installRouteMocks(page, { role: 'admin' })
    await overrideConfig(page, { learner_voice_disabled: false })

    await page.goto('/safety')
    await expect(page.getByTestId('route-trust-safety')).toBeVisible({
      timeout: 15_000,
    })

    await expect(page.getByTestId('admin-safety-voice')).toHaveText(
      /Learner voice: available/i
    )
    await expect(page.getByTestId('admin-safety-export')).toHaveText(
      /Report export: enabled/i
    )
    await expect(page.getByTestId('admin-export-report')).toBeEnabled()
  })
})
