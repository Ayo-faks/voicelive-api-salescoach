import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { FluentProvider, teamsLightTheme } from '@fluentui/react-components'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import LearnerOnboardingWizard, {
  isGuardianEmailRequired,
  isMinorAgeBand,
} from './LearnerOnboardingWizard'
import type {
  ConsentInput,
  LearnerProfilePatch,
  LearnerProfileResponse,
} from '../../services/api'

type PatchFn = (patch: LearnerProfilePatch) => Promise<LearnerProfileResponse>
type RecordConsentFn = (input: ConsentInput) => Promise<LearnerProfileResponse>

const navigateMock = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => navigateMock,
  }
})

function emptyResponse(needsOnboarding = false): LearnerProfileResponse {
  return { profile: {}, consents: [], needs_onboarding: needsOnboarding }
}

function renderWizard(
  overrides: Partial<{
    patch: PatchFn
    recordConsent: RecordConsentFn
  }> = {}
) {
  const patch = vi.fn<PatchFn>(
    overrides.patch ?? (async () => emptyResponse(false))
  )
  const recordConsent = vi.fn<RecordConsentFn>(
    overrides.recordConsent ?? (async () => emptyResponse(true))
  )
  const utils = render(
    <MemoryRouter>
      <FluentProvider theme={teamsLightTheme}>
        <LearnerOnboardingWizard
          profile={null}
          isLoading={false}
          patch={patch}
          recordConsent={recordConsent}
        />
      </FluentProvider>
    </MemoryRouter>
  )
  return { ...utils, patch, recordConsent }
}

async function fillStep1(ageBand = '13-15') {
  fireEvent.change(screen.getByTestId('onboarding-display-name'), {
    target: { value: 'Tomi' },
  })
  fireEvent.change(screen.getByTestId('onboarding-age-band'), {
    target: { value: ageBand },
  })
  fireEvent.click(screen.getByTestId('consent-checkbox-terms'))
  fireEvent.click(screen.getByTestId('consent-checkbox-privacy'))
  fireEvent.click(screen.getByTestId('consent-checkbox-ai_notice'))
}

async function advanceToStep3(ageBand = '13-15') {
  await fillStep1(ageBand)
  fireEvent.click(screen.getByTestId('learner-onboarding-next'))
  await waitFor(() =>
    expect(screen.queryByTestId('learner-onboarding-step-2')).toBeTruthy()
  )
  fireEvent.click(screen.getByTestId('onboarding-subject-Mathematics'))
  fireEvent.click(screen.getByTestId('learner-onboarding-next'))
  await waitFor(() =>
    expect(screen.queryByTestId('learner-onboarding-step-3')).toBeTruthy()
  )
}

describe('LearnerOnboardingWizard', () => {
  beforeEach(() => {
    navigateMock.mockReset()
  })

  it('shows step 1 first and blocks Next without consents', async () => {
    renderWizard()
    expect(screen.getByTestId('learner-onboarding-step-1')).toBeTruthy()
    fireEvent.change(screen.getByTestId('onboarding-display-name'), {
      target: { value: 'Tomi' },
    })
    fireEvent.change(screen.getByTestId('onboarding-age-band'), {
      target: { value: '13-15' },
    })
    fireEvent.click(screen.getByTestId('learner-onboarding-next'))
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/terms/i)
    )
  })

  it('walks through the 3-step happy path and finishes with the expected payload', async () => {
    const { patch, recordConsent } = renderWizard()

    // Step 1 (minor age band — guardian section shows in step 3)
    await fillStep1('13-15')
    fireEvent.click(screen.getByTestId('learner-onboarding-next'))
    await waitFor(() =>
      expect(screen.queryByTestId('learner-onboarding-step-2')).toBeTruthy()
    )
    expect(recordConsent).toHaveBeenCalledWith({
      kind: 'terms',
      version: expect.any(String),
      granted: true,
    })
    expect(recordConsent).toHaveBeenCalledWith({
      kind: 'privacy',
      version: expect.any(String),
      granted: true,
    })
    expect(recordConsent).toHaveBeenCalledWith({
      kind: 'ai_notice',
      version: expect.any(String),
      granted: true,
    })

    // Step 2
    fireEvent.click(screen.getByTestId('onboarding-subject-Mathematics'))
    fireEvent.click(screen.getByTestId('onboarding-subject-Biology'))
    fireEvent.click(screen.getByTestId('learner-onboarding-next'))

    await waitFor(() =>
      expect(screen.queryByTestId('learner-onboarding-step-3')).toBeTruthy()
    )
    expect(patch).toHaveBeenCalledWith({
      exam: 'WAEC',
      year_group: 'SS2',
      subjects: ['Mathematics', 'Biology'],
    })

    // Step 3 — guardian section visible for 13-15 but not required; finish without guardian email
    expect(screen.getByTestId('onboarding-guardian-section')).toBeTruthy()
    fireEvent.click(screen.getByTestId('onboarding-interest-Engineering'))
    fireEvent.click(screen.getByTestId('consent-checkbox-career'))
    fireEvent.click(screen.getByTestId('learner-onboarding-finish'))

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/home'))
    expect(recordConsent).toHaveBeenCalledWith({
      kind: 'career',
      version: expect.any(String),
      granted: true,
    })
    expect(patch).toHaveBeenLastCalledWith({ interests: ['Engineering'] })
  })

  it('back button returns from step 2 to step 1', async () => {
    renderWizard()
    await fillStep1()
    fireEvent.click(screen.getByTestId('learner-onboarding-next'))
    await waitFor(() => screen.getByTestId('learner-onboarding-step-2'))
    fireEvent.click(screen.getByTestId('learner-onboarding-back'))
    expect(screen.getByTestId('learner-onboarding-step-1')).toBeTruthy()
  })

  it('surfaces step 2 validation when no subject is chosen', async () => {
    renderWizard()
    await fillStep1()
    fireEvent.click(screen.getByTestId('learner-onboarding-next'))
    await waitFor(() => screen.getByTestId('learner-onboarding-step-2'))
    fireEvent.click(screen.getByTestId('learner-onboarding-next'))
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/subject/i)
    )
  })

  // ---------------------------------------------------------------------------
  // Age-tiered guardian email gate
  // ---------------------------------------------------------------------------

  describe('age-tiered helpers', () => {
    it.each(['under-13', '13-15', '16-17'])(
      'isMinorAgeBand returns true for minor band %s',
      band => {
        expect(isMinorAgeBand(band)).toBe(true)
      }
    )

    it.each(['18-24', '25-plus'])(
      'isMinorAgeBand returns false for adult band %s',
      band => {
        expect(isMinorAgeBand(band)).toBe(false)
      }
    )

    it('isGuardianEmailRequired returns true only for under-13', () => {
      expect(isGuardianEmailRequired('under-13')).toBe(true)
      expect(isGuardianEmailRequired('13-15')).toBe(false)
      expect(isGuardianEmailRequired('16-17')).toBe(false)
      expect(isGuardianEmailRequired('18-24')).toBe(false)
    })
  })

  it('shows guardian section in step 3 for minor age bands', async () => {
    for (const band of ['under-13', '13-15', '16-17']) {
      const { unmount } = render(
        <MemoryRouter>
          <FluentProvider theme={teamsLightTheme}>
            <LearnerOnboardingWizard
              profile={null}
              isLoading={false}
              patch={async () => emptyResponse(false)}
              recordConsent={async () => emptyResponse(true)}
            />
          </FluentProvider>
        </MemoryRouter>
      )
      await advanceToStep3(band)
      expect(screen.getByTestId('onboarding-guardian-section')).toBeTruthy()
      unmount()
    }
  })

  it('hides guardian section in step 3 for adult age bands', async () => {
    for (const band of ['18-24', '25-plus']) {
      const { unmount } = render(
        <MemoryRouter>
          <FluentProvider theme={teamsLightTheme}>
            <LearnerOnboardingWizard
              profile={null}
              isLoading={false}
              patch={async () => emptyResponse(false)}
              recordConsent={async () => emptyResponse(true)}
            />
          </FluentProvider>
        </MemoryRouter>
      )
      await advanceToStep3(band)
      expect(
        screen.queryByTestId('onboarding-guardian-section')
      ).toBeNull()
      unmount()
    }
  })

  it('blocks finish for under-13 without guardian email', async () => {
    renderWizard()
    await advanceToStep3('under-13')
    // Do NOT fill guardian email
    fireEvent.click(screen.getByTestId('learner-onboarding-finish'))
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/guardian/i)
    )
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('allows finish for under-13 when guardian email is provided', async () => {
    const { patch } = renderWizard()
    await advanceToStep3('under-13')
    fireEvent.change(screen.getByTestId('onboarding-guardian-email'), {
      target: { value: 'parent@example.com' },
    })
    fireEvent.click(screen.getByTestId('learner-onboarding-finish'))
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/home'))
    expect(patch).toHaveBeenLastCalledWith(
      expect.objectContaining({ guardian_email: 'parent@example.com' })
    )
  })
})
