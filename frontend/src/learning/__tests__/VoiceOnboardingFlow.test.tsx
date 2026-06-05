import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { recommendFromGoal } = vi.hoisted(() => ({
  recommendFromGoal: vi.fn(),
}))

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return { ...actual, recommendFromGoal }
})

vi.mock('../hooks/useTtsPlayer', () => ({
  useTtsPlayer: () => ({
    supported: true,
    playing: false,
    play: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
  }),
}))

import VoiceOnboardingFlow from '../VoiceOnboardingFlow'

function setup(overrides: Record<string, unknown> = {}) {
  const patch = vi.fn().mockResolvedValue({ profile: {}, consents: [], needs_onboarding: false })
  const recordConsent = vi
    .fn()
    .mockResolvedValue({ profile: {}, consents: [], needs_onboarding: false })
  const onComplete = vi.fn()
  const onUseTextInstead = vi.fn()
  render(
    <VoiceOnboardingFlow
      studentId="stu-1"
      profile={null}
      patch={patch}
      recordConsent={recordConsent}
      onComplete={onComplete}
      onUseTextInstead={onUseTextInstead}
      {...overrides}
    />
  )
  return { patch, recordConsent, onComplete, onUseTextInstead }
}

async function passConsent() {
  fireEvent.change(screen.getByTestId('onboarding-name'), {
    target: { value: 'Ada' },
  })
  fireEvent.click(screen.getByText('18–24'))
  fireEvent.click(screen.getByTestId('onboarding-terms'))
  fireEvent.click(screen.getByTestId('onboarding-privacy'))
  fireEvent.click(screen.getByTestId('onboarding-ai'))
  fireEvent.click(screen.getByTestId('onboarding-consent-continue'))
}

afterEach(() => vi.clearAllMocks())

describe('VoiceOnboardingFlow', () => {
  it('gates on consent, then walks profile + goal and recommends', async () => {
    recommendFromGoal.mockResolvedValue({
      session_complete: true,
      blocks: [
        { kind: 'plan', speak: '', headline: 'Start here: Mathematics', steps: [] },
      ],
    })
    const { patch, recordConsent } = setup()

    // Continue is disabled until required consents + name + age are present.
    expect(screen.getByTestId('onboarding-consent-continue')).toHaveProperty(
      'disabled',
      true
    )

    await passConsent()

    // 3 required consents recorded; profile patched with identity.
    await waitFor(() => expect(recordConsent).toHaveBeenCalledTimes(3))
    expect(patch).toHaveBeenCalledWith(
      expect.objectContaining({ display_name: 'Ada', age_band: '18-24' })
    )

    // Profile steps: exam → year → subjects → interests.
    fireEvent.click(await screen.findByText('WAEC'))
    fireEvent.click(await screen.findByText('SS2'))
    fireEvent.click(await screen.findByText('Mathematics'))
    fireEvent.click(screen.getByTestId('onboarding-subjects-continue'))
    fireEvent.click(screen.getByTestId('onboarding-interests-skip'))

    // Goal steps: focus subject → timeframe → note.
    fireEvent.click(await screen.findByText('Mathematics'))
    fireEvent.click(await screen.findByText('This term'))
    fireEvent.click(screen.getByTestId('onboarding-note-continue'))

    await waitFor(() => expect(recommendFromGoal).toHaveBeenCalledTimes(1))
    expect(recommendFromGoal).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Mathematics',
        exam: 'WAEC',
        target_date: 'this_term',
      })
    )
    expect(await screen.findByTestId('onboarding-results')).toBeTruthy()
    expect(screen.getByTestId('onboarding-start-now')).toBeTruthy()
  })

  it('requires guardian email for a minor before continuing', () => {
    setup()
    fireEvent.change(screen.getByTestId('onboarding-name'), {
      target: { value: 'Kid' },
    })
    fireEvent.click(screen.getByText('Under 13'))
    fireEvent.click(screen.getByTestId('onboarding-terms'))
    fireEvent.click(screen.getByTestId('onboarding-privacy'))
    fireEvent.click(screen.getByTestId('onboarding-ai'))
    // Guardian email field appears and gate stays disabled until filled.
    expect(screen.getByTestId('onboarding-guardian')).toBeTruthy()
    expect(screen.getByTestId('onboarding-consent-continue')).toHaveProperty(
      'disabled',
      true
    )
  })

  it('falls back to the typed wizard', () => {
    const { onUseTextInstead } = setup()
    fireEvent.click(screen.getByTestId('onboarding-use-text'))
    expect(onUseTextInstead).toHaveBeenCalledTimes(1)
  })
})
