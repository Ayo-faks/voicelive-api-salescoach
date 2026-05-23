/**
 * F3 acceptance — voice entry point is wired but gated behind a feature flag.
 *
 * Pilot default is OFF. This spec asserts that:
 *   - the Voice check-in button is not rendered on the Student Home,
 *   - GET /api/learning/voice/config reports `enabled: false`,
 *   - POST /api/learning/voice/frame is refused with 403.
 *
 * When PATHFINDER_VOICE_ENABLED=1 is set on the backend, the button appears
 * and submissions are queued via the offline-fallback adapter — this is
 * covered by the backend unit tests in test_learning_api.py.
 */
import { expect, request, test } from '@playwright/test'

test.describe('Pathfinder · voice entry point (F3)', () => {
  test('voice button is hidden when flag is off and API refuses frames', async ({
    page,
    baseURL,
  }) => {
    await page.goto('/home')
    await expect(page.getByTestId('start-checkin')).toBeVisible()
    await expect(page.getByTestId('start-voice-checkin')).toHaveCount(0)

    const api = await request.newContext({ baseURL })
    const cfg = await api.get('/api/learning/voice/config')
    expect(cfg.ok()).toBeTruthy()
    const cfgBody = await cfg.json()
    expect(cfgBody.enabled).toBe(false)
    expect(cfgBody.transport).toBe('flask-sock')
    expect(cfgBody.offline_fallback).toBe('queued_multilingual_voice_frame')

    const frame = await api.post('/api/learning/voice/frame', {
      data: { mode: 'text', payload: 'hello' },
    })
    expect(frame.status()).toBe(403)
    await api.dispose()
  })
})
