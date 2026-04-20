import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../services/api'
import { AuditoryBombardmentPanel } from './AuditoryBombardmentPanel'
import type { ExerciseExemplar } from '../types'

/*---------------------------------------------------------------------------------------------
 *  PR2 commit 8 — unit tests for AuditoryBombardmentPanel (Stage 0).
 *--------------------------------------------------------------------------------------------*/

function seedShellGesture(): void {
  const section = document.querySelector('section.exercise-shell')
  if (section) {
    fireEvent.pointerDown(section)
  }
}

vi.mock('../services/api', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      synthesizeSpeech: vi.fn().mockResolvedValue('dGVzdA=='),
    },
  }
})

class AudioMock {
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  pause = vi.fn()
  play = vi.fn().mockImplementation(function (this: AudioMock) {
    queueMicrotask(() => {
      this.onended?.()
    })
    return Promise.resolve()
  })
  addEventListener = vi.fn()
}

function makeExemplars(words: string[]): ExerciseExemplar[] {
  return words.map((word) => ({
    word,
    imageAssetId: `th-initial-${word}-card`,
    audioSource: 'tts' as const,
    position: 'initial' as const,
  }))
}

const baseMetadata = {
  type: 'auditory_bombardment' as const,
  targetSound: 'th',
  targetWords: ['thin', 'thumb', 'thick'],
  difficulty: 'easy' as const,
  durationSeconds: 90,
  repetitionTarget: 20,
  requiresMic: false,
  masteryThreshold: null,
  stepNumber: 0,
  exemplars: makeExemplars(['thin', 'thumb', 'thick']),
  imageAssets: [
    'objects/th-initial-thin-card.webp',
    'objects/th-initial-thumb-card.webp',
    'objects/th-initial-thick-card.webp',
  ],
}

describe('AuditoryBombardmentPanel (Stage 0)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.synthesizeSpeech).mockReset()
    vi.mocked(api.synthesizeSpeech).mockResolvedValue('dGVzdA==')

    Object.defineProperty(globalThis, 'Audio', {
      writable: true,
      value: AudioMock,
    })
    Object.defineProperty(globalThis.URL, 'createObjectURL', {
      writable: true,
      value: vi.fn(() => 'blob:test-audio'),
    })
    Object.defineProperty(globalThis.URL, 'revokeObjectURL', {
      writable: true,
      value: vi.fn(),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders one ImageCard cell per exemplar in order', async () => {
    render(<AuditoryBombardmentPanel metadata={baseMetadata} audience="child" />)
    seedShellGesture()

    await waitFor(() => {
      expect(screen.getByTestId('bombardment-cell-0')).toBeTruthy()
    })
    expect(screen.getByTestId('bombardment-cell-1')).toBeTruthy()
    expect(screen.getByTestId('bombardment-cell-2')).toBeTruthy()
    expect(screen.queryByTestId('bombardment-cell-3')).toBeNull()
  })

  it('synthesizes each exemplar in order', async () => {
    render(<AuditoryBombardmentPanel metadata={baseMetadata} audience="child" />)
    seedShellGesture()

    // PR3 — no second-tap gate. Playback auto-starts when the EXPOSE slot mounts.
    await waitFor(
      () => {
        expect(vi.mocked(api.synthesizeSpeech)).toHaveBeenCalledTimes(3)
      },
      { timeout: 3000 },
    )

    const calls = vi.mocked(api.synthesizeSpeech).mock.calls
    expect((calls[0][0] as { text: string }).text).toBe('thin')
    expect((calls[1][0] as { text: string }).text).toBe('thumb')
    expect((calls[2][0] as { text: string }).text).toBe('thick')
  })

  it('aborts in-flight playback when unmounted mid-exemplar', async () => {
    let resolveFirstSynth: (value: string) => void = () => {}
    vi.mocked(api.synthesizeSpeech).mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveFirstSynth = resolve
        }),
    )

    const { unmount } = render(
      <AuditoryBombardmentPanel metadata={baseMetadata} audience="child" />,
    )
    seedShellGesture()

    // PR3 — auto-start fires first synth call; no button click needed.
    await waitFor(() => {
      expect(vi.mocked(api.synthesizeSpeech)).toHaveBeenCalledTimes(1)
    })

    const inFlightSignal = (vi.mocked(api.synthesizeSpeech).mock.calls[0][1] as
      | { signal?: AbortSignal }
      | undefined)?.signal
    expect(inFlightSignal).toBeDefined()
    expect(inFlightSignal?.aborted).toBe(false)

    unmount()
    expect(inFlightSignal?.aborted).toBe(true)

    resolveFirstSynth('dGVzdA==')
  })

  it('does not require the microphone (Stage 0 listening-only)', () => {
    render(<AuditoryBombardmentPanel metadata={baseMetadata} audience="therapist" />)
    expect(screen.queryByRole('button', { name: /record/i })).toBeNull()
    expect(baseMetadata.requiresMic).toBe(false)
  })

  // -------------------------------------------------------------------------
  // "Play again / End session" decision beat (therapist mode only).
  // -------------------------------------------------------------------------

  it('shows Play again and End session buttons after the round finishes (therapist)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<AuditoryBombardmentPanel metadata={baseMetadata} audience="therapist" />)
    seedShellGesture()

    // Wait for all 3 exemplars to synthesise, then the shell to advance to
    // REINFORCE (expose → bridge → reinforce via collapsePerform).
    await waitFor(
      () => {
        expect(vi.mocked(api.synthesizeSpeech)).toHaveBeenCalledTimes(3)
      },
      { timeout: 3000 },
    )

    await waitFor(() => {
      expect(screen.getByTestId('reinforce-decision')).toBeTruthy()
    })

    // Buttons are rendered but hidden until REINFORCE_DECISION_DELAY_MS elapses.
    expect(screen.getByTestId('reinforce-decision').getAttribute('data-visible')).toBe('false')

    vi.advanceTimersByTime(2600)

    await waitFor(() => {
      expect(screen.getByTestId('reinforce-decision').getAttribute('data-visible')).toBe('true')
    })
    expect(screen.getByTestId('reinforce-play-again')).toBeTruthy()
    expect(screen.getByTestId('reinforce-end-session')).toBeTruthy()
  })

  it('Play again re-triggers the full playback loop (6 total TTS calls for 3 exemplars × 2 rounds)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<AuditoryBombardmentPanel metadata={baseMetadata} audience="therapist" />)
    seedShellGesture()

    await waitFor(
      () => {
        expect(vi.mocked(api.synthesizeSpeech)).toHaveBeenCalledTimes(3)
      },
      { timeout: 3000 },
    )

    // Wait for the shell to finish advancing expose → bridge → reinforce
    // before we fast-forward the 2.5 s button-reveal timer.
    await waitFor(() => {
      expect(screen.getByTestId('reinforce-decision')).toBeTruthy()
    })

    vi.advanceTimersByTime(2600)

    await waitFor(
      () => {
        expect(screen.getByTestId('reinforce-decision').getAttribute('data-visible')).toBe('true')
      },
      { timeout: 3000 },
    )

    fireEvent.click(screen.getByTestId('reinforce-play-again'))

    // Second round: PlaybackSlot remounts, auto-starts again → 3 more calls.
    await waitFor(
      () => {
        expect(vi.mocked(api.synthesizeSpeech)).toHaveBeenCalledTimes(6)
      },
      { timeout: 3000 },
    )
  })

  it('End session calls onExerciseComplete immediately (therapist)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const onComplete = vi.fn()
    render(
      <AuditoryBombardmentPanel
        metadata={baseMetadata}
        audience="therapist"
        onExerciseComplete={onComplete}
      />,
    )
    seedShellGesture()

    await waitFor(
      () => {
        expect(vi.mocked(api.synthesizeSpeech)).toHaveBeenCalledTimes(3)
      },
      { timeout: 3000 },
    )

    await waitFor(() => {
      expect(screen.getByTestId('reinforce-decision')).toBeTruthy()
    })

    vi.advanceTimersByTime(2600)

    await waitFor(
      () => {
        expect(screen.getByTestId('reinforce-decision').getAttribute('data-visible')).toBe('true')
      },
      { timeout: 3000 },
    )

    expect(onComplete).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('reinforce-end-session'))

    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete).toHaveBeenCalledWith({ immediate: true })
  })

  it('auto-ends after 20s if the therapist makes no choice', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const onComplete = vi.fn()
    render(
      <AuditoryBombardmentPanel
        metadata={baseMetadata}
        audience="therapist"
        onExerciseComplete={onComplete}
      />,
    )
    seedShellGesture()

    await waitFor(
      () => {
        expect(vi.mocked(api.synthesizeSpeech)).toHaveBeenCalledTimes(3)
      },
      { timeout: 3000 },
    )

    await waitFor(() => {
      expect(screen.getByTestId('reinforce-decision')).toBeTruthy()
    })

    expect(onComplete).not.toHaveBeenCalled()

    // Fast-forward past the 20s auto-end timeout.
    vi.advanceTimersByTime(20_100)

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1)
    })
    // Auto-end uses the default (no immediate flag) so the host applies its
    // normal SESSION_WRAP_UP_DELAY_MS grace window.
    expect(onComplete).toHaveBeenCalledWith()
  })

  it('child mode keeps today behavior: no decision beat, onExerciseComplete fires on REINFORCE', async () => {
    const onComplete = vi.fn()
    render(
      <AuditoryBombardmentPanel
        metadata={baseMetadata}
        audience="child"
        onExerciseComplete={onComplete}
      />,
    )
    seedShellGesture()

    await waitFor(
      () => {
        expect(vi.mocked(api.synthesizeSpeech)).toHaveBeenCalledTimes(3)
      },
      { timeout: 3000 },
    )

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalled()
    })

    // Child mode fires complete without the immediate flag (warm auto-wrap).
    expect(onComplete).toHaveBeenCalledWith()
    expect(screen.queryByTestId('reinforce-decision')).toBeNull()
  })

  // -------------------------------------------------------------------------
  // End-of-session TTS suppression (therapist): the three-line audio cluster
  // "Keep listening." + "Lovely listening! See you next time." + "Shall we
  // listen again, or wrap up?" collapses to just the decision prompt.
  // -------------------------------------------------------------------------

  it('therapist mode suppresses BRIDGE and REINFORCE beat TTS; only the decision prompt is spoken', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const onSpeak = vi.fn().mockResolvedValue(undefined)
    render(
      <AuditoryBombardmentPanel
        metadata={baseMetadata}
        audience="therapist"
        onSpeakExerciseText={onSpeak}
      />,
    )
    seedShellGesture()

    await waitFor(() => {
      expect(screen.getByTestId('reinforce-decision')).toBeTruthy()
    })

    // Flush the REINFORCE_DECISION_DELAY_MS (2500ms) showTimer deterministically.
    // advanceTimersByTimeAsync awaits microtasks between timer firings, which is
    // required because the showTimer callback calls a Promise-returning onSpeak;
    // the sync advanceTimersByTime variant occasionally raced the effect
    // registration in the full-suite run, leaving data-visible="false" at the
    // waitFor timeout.
    await vi.advanceTimersByTimeAsync(2600)

    await waitFor(() => {
      expect(onSpeak).toHaveBeenCalledWith('Shall we listen again, or wrap up?')
    })

    const spokenTexts = onSpeak.mock.calls.map((call) => call[0] as string)
    expect(spokenTexts).not.toContain('Keep listening.')
    expect(spokenTexts).not.toContain('Lovely listening! See you next time.')
  })

  it('child mode still speaks BRIDGE and REINFORCE beats (warm pacing retained)', async () => {
    const onSpeak = vi.fn().mockResolvedValue(undefined)
    render(
      <AuditoryBombardmentPanel
        metadata={baseMetadata}
        audience="child"
        onSpeakExerciseText={onSpeak}
      />,
    )
    seedShellGesture()

    await waitFor(() => {
      const spokenTexts = onSpeak.mock.calls.map((call) => call[0] as string)
      expect(spokenTexts).toContain('Lovely listening! See you next time.')
    })

    const spokenTexts = onSpeak.mock.calls.map((call) => call[0] as string)
    // Child mode never renders the decision beat.
    expect(spokenTexts).not.toContain('Shall we listen again, or wrap up?')
  })
})
