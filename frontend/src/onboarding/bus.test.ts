import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getTourById } = vi.hoisted(() => ({
  getTourById: vi.fn(),
}))

vi.mock('./tours', () => ({
  getTourById,
}))

import { consumePendingReplayTour, onReplayTourRequested, requestReplayTour } from './bus'

describe('onboarding replay bus', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    window.history.replaceState({}, '', '/home?childId=child-123')
    getTourById.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('dispatches immediately when already on the replay route', () => {
    getTourById.mockReturnValue({ replayPath: '/home' })
    const handler = vi.fn()
    const dispose = onReplayTourRequested(handler)

    requestReplayTour('welcome-therapist')

    expect(handler).toHaveBeenCalledWith('welcome-therapist')
    expect(consumePendingReplayTour()).toBeNull()
    dispose()
  })

  it('consumes a queued replay only after the destination route becomes active', () => {
    window.sessionStorage.setItem(
      'wulo.onboarding.pending-replay-tour',
      JSON.stringify({ replayPath: '/dashboard', tourId: 'dashboard-tour' })
    )

    expect(consumePendingReplayTour()).toBeNull()

    window.history.replaceState({}, '', '/dashboard?childId=child-123')

    expect(consumePendingReplayTour()).toBe('dashboard-tour')
    expect(consumePendingReplayTour()).toBeNull()
  })
})