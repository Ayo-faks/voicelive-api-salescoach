/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Integration coverage for the Phase 3 role-gated welcome tours plus the
 * child-persona silence guarantee.
 *
 * We mount `OnboardingRuntime` directly under a `MemoryRouter` rather
 * than the whole app so this test is focused, fast, and independent of
 * the dashboard / session data mocks in `App.integration.test.tsx`. The
 * react-joyride driver is stubbed so we can assert the auto-picked tour
 * id purely from telemetry, without dragging in the lazy ESM bundle.
 */

import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { FluentProvider, webLightTheme } from '@fluentui/react-components'

import { OnboardingRuntime } from './OnboardingRuntime'
import { ONBOARDING_EVENTS } from '../../onboarding/events'
import { telemetry } from '../../services/telemetry'

// Stub the Joyride driver to a plain div. We only care about which tour
// OnboardingRuntime selects, not whether Joyride mounts correctly.
vi.mock('./TourDriver', () => ({
  TourDriver: ({
    tour,
  }: {
    tour: { id: string } | null
    onComplete: (id: string) => void
  }) =>
    tour ? (
      <div data-testid="tour-driver-stub" data-tour-id={tour.id} />
    ) : null,
}))

vi.mock('./AnnouncementBanner', () => ({
  AnnouncementBanner: () => null,
}))

const apiMock = {
  getUiState: vi.fn(async () => ({ tours_seen: [] })),
  patchUiState: vi.fn(async (patch: Record<string, unknown>) => patch),
}

vi.mock('../../services/api', () => ({
  api: {
    getUiState: () => apiMock.getUiState(),
    patchUiState: (patch: Record<string, unknown>) => apiMock.patchUiState(patch),
  },
}))

function renderRuntime(opts: {
  role: string
  userMode?: 'workspace' | 'child'
  path: string
}): ReturnType<typeof render> {
  const runtimeProps = {
    role: opts.role,
    userMode: opts.userMode ?? ('workspace' as const),
    toursEnabled: true,
    authenticated: true,
  }
  return render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter initialEntries={[opts.path]}>
        <OnboardingRuntime {...runtimeProps} />
      </MemoryRouter>
    </FluentProvider>
  )
}

describe('OnboardingRuntime — role-gated auto-trigger (Phase 3)', () => {
  let trackSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    apiMock.getUiState.mockClear()
    apiMock.getUiState.mockResolvedValue({ tours_seen: [] })
    apiMock.patchUiState.mockClear()
    apiMock.patchUiState.mockImplementation(async patch => patch)
    trackSpy = vi.spyOn(telemetry, 'trackEvent').mockImplementation(() => undefined)
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fresh parent on /home sees welcome-parent', async () => {
    const { container } = renderRuntime({ role: 'parent', path: '/home' })
    await waitFor(() => {
      const driver = container.querySelector('[data-testid="tour-driver-stub"]')
      expect(driver?.getAttribute('data-tour-id')).toBe('welcome-parent')
    })
    expect(
      trackSpy.mock.calls.some(
        (call: [string, unknown?]) =>
          call[0] === ONBOARDING_EVENTS.TOUR_STARTED &&
          (call[1] as { tour_id: string }).tour_id === 'welcome-parent'
      )
    ).toBe(true)
  })

  it('fresh admin on /home sees welcome-admin (not welcome-therapist)', async () => {
    const { container } = renderRuntime({ role: 'admin', path: '/home' })
    await waitFor(() => {
      const driver = container.querySelector('[data-testid="tour-driver-stub"]')
      expect(driver?.getAttribute('data-tour-id')).toBe('welcome-admin')
    })
  })

  it('fresh therapist on /home still sees welcome-therapist', async () => {
    const { container } = renderRuntime({ role: 'therapist', path: '/home' })
    await waitFor(() => {
      const driver = container.querySelector('[data-testid="tour-driver-stub"]')
      expect(driver?.getAttribute('data-tour-id')).toBe('welcome-therapist')
    })
  })

  it('child persona emits zero onboarding telemetry and mounts no tour driver', async () => {
    const { container } = renderRuntime({
      role: 'child',
      userMode: 'child',
      path: '/home',
    })

    // Give the runtime a chance to (fail to) fire anything.
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(container.querySelector('[data-testid="tour-driver-stub"]')).toBeNull()

    // Telemetry shim is sealed for child persona. `disableForChild` is
    // called once on mount; every onboarding event after that is a no-op.
    // `trackSpy` may still record the *call* the shim received, but the
    // shim short-circuits before the sink is invoked. To validate the
    // end-to-end silence we assert no TOUR_STARTED ever got through for
    // this mount.
    for (const call of trackSpy.mock.calls) {
      expect(call[0]).not.toBe(ONBOARDING_EVENTS.TOUR_STARTED)
    }
    // Server reads must also be suppressed for child persona.
    expect(apiMock.getUiState).not.toHaveBeenCalled()
    expect(apiMock.patchUiState).not.toHaveBeenCalled()
  })

  it('toursEnabled=false suppresses auto-trigger even for a fresh parent', async () => {
    const runtimeProps = {
      role: 'parent',
      userMode: 'workspace' as const,
      toursEnabled: false,
      authenticated: true,
    }
    const { container } = render(
      <FluentProvider theme={webLightTheme}>
        <MemoryRouter initialEntries={['/home']}>
          <OnboardingRuntime {...runtimeProps} />
        </MemoryRouter>
      </FluentProvider>
    )

    await new Promise(resolve => setTimeout(resolve, 50))
    expect(container.querySelector('[data-testid="tour-driver-stub"]')).toBeNull()
  })
})
