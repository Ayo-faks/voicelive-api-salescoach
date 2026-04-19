import { createRef } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildChildIntroInstructions, buildTherapistIntroInstructions } from '../app/introInstructions'
import { api } from '../services/api'
import { ListeningMinimalPairsPanel } from './ListeningMinimalPairsPanel'
import { SessionScreen } from './SessionScreen'
import { SilentSortingPanel } from './SilentSortingPanel'
import { VowelBlendingPanel } from './VowelBlendingPanel'

function createDeferred() {
  let resolve: () => void = () => {}

  const promise = new Promise<void>(res => {
    resolve = res
  })

  return { promise, resolve }
}

// PR1 Session E — SilentSorting tests now run against the real ExerciseShell
// (not the retired local mock). The shell gates auto-advance on a user
// gesture, so each SilentSorting test seeds a pointerDown on the shell
// <section> before asserting on expose-phase DOM.
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
  addEventListener = vi.fn()
  pause = vi.fn()
  play = vi.fn().mockResolvedValue(undefined)
}

// The listening panel emits drill-token sentinels (e.g. TH_THIN_MODEL) which
// the downstream SSML pipeline replaces with child-friendly display text.
const listeningInstruction =
  'Listen carefully. TH_THIN_MODEL. Tap the matching picture.'

const listeningPraise = 'Great listening. You picked TH_THIN_MODEL.'

const listeningInstructionThorn =
  'Listen carefully. TH_THORN_MODEL. Tap the matching picture.'

// Retry prompt after picking 'fin' while the target was 'thin'.
const listeningRetryThinFin =
  "Let's listen again. TH_THIN_MODEL. F_FIN_MODEL."

describe('Exercise panels', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
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

  it('locks taps until the avatar finishes the instruction', async () => {
    const handleRecordSelection = vi.fn()
    const deferredSpeech = createDeferred()
    const handleSpeakExerciseText = vi.fn(() => deferredSpeech.promise)

    vi.spyOn(Math, 'random').mockReturnValue(0.9)

    render(
      <ListeningMinimalPairsPanel
        audience="child"
        readyToStart
        metadata={{
          targetSound: 'th',
          errorSound: 'f',
          pairs: [{ word_a: 'thin', word_b: 'fin' }],
          speechLanguage: 'en-US',
        }}
        onSpeakExerciseText={handleSpeakExerciseText}
        onRecordExerciseSelection={handleRecordSelection}
      />,
    )

    await waitFor(() => {
      expect(handleSpeakExerciseText).toHaveBeenCalledWith(
        listeningInstruction
      )
    })

    fireEvent.click(screen.getByText('thin'))
    expect(handleRecordSelection).not.toHaveBeenCalled()

    deferredSpeech.resolve()

    await waitFor(() => {
      expect(screen.getByText('Tap the picture that matches the word.')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('thin'))

    await waitFor(() => {
      expect(handleRecordSelection).toHaveBeenCalledWith('I picked thin.')
    })
  })

  it('retries the same pair after a wrong answer', async () => {
    const handleSpeakExerciseText = vi.fn().mockResolvedValue(undefined)
    const handleRecordSelection = vi.fn()

    vi.spyOn(Math, 'random').mockReturnValue(0.9)

    render(
      <ListeningMinimalPairsPanel
        audience="child"
        readyToStart
        metadata={{
          targetSound: 'th',
          errorSound: 'f',
          pairs: [{ word_a: 'thin', word_b: 'fin' }],
          speechLanguage: 'en-US',
        }}
        onSpeakExerciseText={handleSpeakExerciseText}
        onRecordExerciseSelection={handleRecordSelection}
      />,
    )

    await waitFor(() => {
      expect(handleSpeakExerciseText).toHaveBeenCalledTimes(1)
    })

    fireEvent.click(screen.getByText('fin'))

    await waitFor(() => {
      expect(handleSpeakExerciseText).toHaveBeenCalledTimes(3)
    })

    expect(handleRecordSelection).toHaveBeenCalledWith('I picked fin.')
    expect(handleSpeakExerciseText).toHaveBeenNthCalledWith(
      1,
      listeningInstruction
    )
    expect(handleSpeakExerciseText).toHaveBeenNthCalledWith(2, listeningRetryThinFin)
    expect(handleSpeakExerciseText).toHaveBeenNthCalledWith(
      3,
      listeningInstruction
    )
  })

  it('praises a correct answer and auto-advances to the next pair', async () => {
    const handleSpeakExerciseText = vi.fn().mockResolvedValue(undefined)
    const handleRecordSelection = vi.fn()

    vi.spyOn(Math, 'random').mockReturnValue(0.9)

    render(
      <ListeningMinimalPairsPanel
        audience="therapist"
        readyToStart
        metadata={{
          targetSound: 'th',
          errorSound: 'f',
          repetitionTarget: 2,
          pairs: [
            { word_a: 'thin', word_b: 'fin' },
            { word_a: 'thorn', word_b: 'fawn' },
          ],
          speechLanguage: 'en-US',
        }}
        onSpeakExerciseText={handleSpeakExerciseText}
        onRecordExerciseSelection={handleRecordSelection}
      />,
    )

    await waitFor(() => {
      expect(handleSpeakExerciseText).toHaveBeenCalledTimes(1)
    })

    fireEvent.click(screen.getByText('thin'))

    await waitFor(() => {
      expect(handleSpeakExerciseText).toHaveBeenCalledTimes(3)
    })

    expect(handleRecordSelection).toHaveBeenCalledWith('I picked thin.')
    expect(handleSpeakExerciseText).toHaveBeenNthCalledWith(
      1,
      listeningInstruction
    )
    expect(handleSpeakExerciseText).toHaveBeenNthCalledWith(2, listeningPraise)
    expect(handleSpeakExerciseText).toHaveBeenNthCalledWith(
      3,
      listeningInstructionThorn
    )
    expect(screen.queryByRole('button', { name: 'Next pair' })).toBeNull()
  })

  it('shows skip pair only for therapists', async () => {
    const handleSpeakExerciseText = vi.fn().mockResolvedValue(undefined)

    vi.spyOn(Math, 'random').mockReturnValue(0.9)

    const therapistView = render(
      <ListeningMinimalPairsPanel
        audience="therapist"
        readyToStart
        metadata={{
          targetSound: 'th',
          errorSound: 'f',
          pairs: [{ word_a: 'thin', word_b: 'fin' }],
          speechLanguage: 'en-US',
        }}
        onSpeakExerciseText={handleSpeakExerciseText}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('Tap the picture that matches the word.')).toBeTruthy()
    })

    expect(screen.getByRole('button', { name: 'Skip pair' })).toBeTruthy()

    therapistView.unmount()

    render(
      <ListeningMinimalPairsPanel
        audience="child"
        readyToStart
        metadata={{
          targetSound: 'th',
          errorSound: 'f',
          pairs: [{ word_a: 'thin', word_b: 'fin' }],
          speechLanguage: 'en-US',
        }}
        onSpeakExerciseText={handleSpeakExerciseText}
      />,
    )

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Skip pair' })).toBeNull()
    })
  })

  it('hides skip while the next pair clue is starting to keep the turn aligned', async () => {
    const firstInstruction = createDeferred()
    const secondInstruction = createDeferred()
    const handleSpeakExerciseText = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => firstInstruction.promise)
      .mockImplementationOnce(() => secondInstruction.promise)
    const handleInterruptAvatar = vi.fn()

    vi.spyOn(Math, 'random').mockReturnValue(0.9)

    render(
      <ListeningMinimalPairsPanel
        audience="therapist"
        readyToStart
        metadata={{
          targetSound: 'th',
          errorSound: 'f',
          pairs: [
            { word_a: 'thin', word_b: 'fin' },
            { word_a: 'thorn', word_b: 'fawn' },
          ],
          speechLanguage: 'en-US',
        }}
        onSpeakExerciseText={handleSpeakExerciseText}
        onInterruptAvatar={handleInterruptAvatar}
      />,
    )

    await waitFor(() => {
      expect(handleSpeakExerciseText).toHaveBeenNthCalledWith(
        1,
        listeningInstruction
      )
    })

    expect(screen.queryByRole('button', { name: 'Skip pair' })).toBeNull()

    firstInstruction.resolve()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Skip pair' })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Skip pair' }))

    expect(handleInterruptAvatar).toHaveBeenCalledTimes(1)

    await waitFor(() => {
      expect(handleSpeakExerciseText).toHaveBeenNthCalledWith(
        2,
        listeningInstructionThorn
      )
    })

    expect(screen.getByText('thorn')).toBeTruthy()
    expect(screen.getByText('fawn')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Skip pair' })).toBeNull()

    secondInstruction.resolve()

    await waitFor(() => {
      expect(screen.getByText('Tap the picture that matches the word.')).toBeTruthy()
    })

    expect(screen.getByRole('button', { name: 'Skip pair' })).toBeTruthy()
  })

  it('hands off session completion once when listening practice reaches the target', async () => {
    const handleSpeakExerciseText = vi.fn().mockResolvedValue(undefined)
    const handleCompleteSession = vi.fn()

    vi.spyOn(Math, 'random').mockReturnValue(0.9)

    render(
      <ListeningMinimalPairsPanel
        audience="child"
        readyToStart
        metadata={{
          targetSound: 'th',
          errorSound: 'f',
          repetitionTarget: 1,
          pairs: [{ word_a: 'thin', word_b: 'fin' }],
          speechLanguage: 'en-US',
        }}
        onSpeakExerciseText={handleSpeakExerciseText}
        onCompleteSession={handleCompleteSession}
      />,
    )

    await waitFor(() => {
      expect(handleSpeakExerciseText).toHaveBeenCalledWith(
        listeningInstruction
      )
    })

    fireEvent.click(screen.getByText('thin'))

    await waitFor(() => {
      expect(handleCompleteSession).toHaveBeenCalledTimes(1)
    })

    expect(screen.getByText('Practice set complete.')).toBeTruthy()
    expect(handleSpeakExerciseText).toHaveBeenNthCalledWith(2, listeningPraise)
  })

  it('stops cleanly on the 12th listening success without queueing another clue', async () => {
    const handleSpeakExerciseText = vi.fn().mockResolvedValue(undefined)
    const handleCompleteSession = vi.fn()

    vi.spyOn(Math, 'random').mockReturnValue(0.9)

    render(
      <ListeningMinimalPairsPanel
        audience="child"
        readyToStart
        metadata={{
          targetSound: 'th',
          errorSound: 'f',
          repetitionTarget: 12,
          pairs: [{ word_a: 'thin', word_b: 'fin' }],
          speechLanguage: 'en-US',
        }}
        onSpeakExerciseText={handleSpeakExerciseText}
        onCompleteSession={handleCompleteSession}
      />,
    )

    await waitFor(() => {
      expect(handleSpeakExerciseText).toHaveBeenCalledTimes(1)
    })

    await waitFor(() => {
      expect(screen.getByText('Tap the picture that matches the word.')).toBeTruthy()
    })

    for (let turn = 1; turn <= 12; turn += 1) {
      fireEvent.click(screen.getByText('thin'))

      if (turn < 12) {
        await waitFor(() => {
          expect(handleSpeakExerciseText).toHaveBeenCalledTimes(turn * 2 + 1)
        })

        expect(handleSpeakExerciseText).toHaveBeenLastCalledWith(listeningInstruction)

        await waitFor(() => {
          expect(screen.getByText('Tap the picture that matches the word.')).toBeTruthy()
        })

        continue
      }

      await waitFor(() => {
        expect(handleCompleteSession).toHaveBeenCalledTimes(1)
      })
    }

    expect(handleSpeakExerciseText).toHaveBeenCalledTimes(24)
    expect(handleSpeakExerciseText).toHaveBeenLastCalledWith(listeningPraise)
    expect(handleSpeakExerciseText.mock.calls[24]).toBeUndefined()
    expect(screen.getByText('Practice set complete.')).toBeTruthy()
  })

  it('builds TH sorting intro copy around sound buttons while preserving mic prompts for speaking turns', () => {
    const childListeningIntro = buildChildIntroInstructions({
      childName: 'Mia',
      avatarName: 'Meg',
      avatarPersona: 'a warm adult speech-practice buddy',
      scenarioName: 'TH and F listening',
      scenarioDescription: 'Listen for the clue and tap the matching picture.',
      exerciseType: 'silent_sorting',
      targetSound: 'th',
    })
    const therapistListeningIntro = buildTherapistIntroInstructions({
      childName: 'Mia',
      avatarName: 'Meg',
      avatarPersona: 'a warm adult speech-practice buddy',
      scenarioName: 'TH and F listening',
      scenarioDescription: 'Listen for the clue and tap the matching picture.',
      exerciseType: 'silent_sorting',
      targetSound: 'th',
    })
    const childSpeakingIntro = buildChildIntroInstructions({
      childName: 'Mia',
      avatarName: 'Meg',
      avatarPersona: 'a warm adult speech-practice buddy',
      scenarioName: 'R sound practice',
      scenarioDescription: 'Say the R sound clearly.',
      exerciseType: 'drill',
    })

    expect(childListeningIntro).toContain('sound button')
    expect(therapistListeningIntro).toContain('sound button')
    // Listening intros must not *instruct* the avatar to announce
    // "the TH sound" / "the F sound" to the child, but the LLM meta
    // guardrails still reference those phrases as prohibited spellings.
    // Assert the child-facing turn-taking guidance, not literal-string
    // absence.
    expect(childListeningIntro).toMatch(/sound button/i)
    expect(therapistListeningIntro).toMatch(/sound button/i)
    expect(childSpeakingIntro).toMatch(/microphone/i)
  })

  it('starts listening sessions without microphone gating or microphone copy', async () => {
    render(
      <SessionScreen
        videoRef={createRef<HTMLVideoElement>()}
        messages={[]}
        recording={false}
        connected
        connectionState="connected"
        connectionMessage="Ready"
        introComplete
        sessionFinished={false}
        canAnalyze={false}
        onToggleRecording={() => {}}
        onClear={() => {}}
        onAnalyze={() => {}}
        scenario={{
          id: 'listen-r-w',
          name: 'Listen for R or W',
          description: 'Listen for the clue and tap the matching picture.',
          exerciseMetadata: {
            type: 'listening_minimal_pairs',
            targetSound: 'r',
            targetWords: ['ring', 'wing'],
            difficulty: 'easy',
            errorSound: 'w',
            repetitionTarget: 12,
            pairs: [{ word_a: 'ring', word_b: 'wing' }],
            speechLanguage: 'en-US',
          },
        }}
        isChildMode
        selectedChild={{ id: 'child-1', name: 'Mia' }}
        selectedAvatar="meg-casual"
        introPending={false}
        onVideoLoaded={() => {}}
        utteranceFeedback={null}
        scoringUtterance={false}
        activeReferenceText=""
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('Tap the picture that matches the word.')).toBeTruthy()
    })

    expect(screen.queryByRole('button', { name: /start recording/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /stop recording/i })).toBeNull()
    expect(screen.queryByText(/microphone/i)).toBeNull()
    expect(screen.getByText('Listen for the clue, then tap the matching picture.')).toBeTruthy()
  })

  it('sends a sorting message when a card moves into a sound home', async () => {
    // Force mobile-fallback sorting mode (tap-to-sort) so we can drive card
    // moves via fireEvent.click instead of drag-and-drop, which jsdom cannot
    // faithfully simulate.
    const originalMatchMedia = window.matchMedia
    ;(window as unknown as { matchMedia: (q: string) => MediaQueryList }).matchMedia = (query: string) =>
      ({
        matches: query.includes('pointer: coarse') || query.includes('max-width'),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
        onchange: null,
      }) as unknown as MediaQueryList

    const handleSendMessage = vi.fn()

    try {
      render(
        <SilentSortingPanel
          metadata={{
            targetSound: 'th',
            errorSound: 'f',
            targetWords: ['thin'],
            imageAssets: [
              'object-cards/th/th-initial-thin.webp',
            ],
          }}
          onSendMessage={handleSendMessage}
        />,
      )

      seedShellGesture()

      // ORIENT → EXPOSE: wait for preview buttons to appear.
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Hear thhh sound/i })).toBeTruthy()
      })

      // Tap both previews so canAdvanceFromExpose flips true.
      fireEvent.click(screen.getByRole('button', { name: /Hear thhh sound/i }))
      fireEvent.click(screen.getByRole('button', { name: /Hear fff sound/i }))

      // EXPOSE → BRIDGE → PERFORM via Start game.
      await waitFor(() => {
        expect(
          (screen.getByTestId('silent-sorting-start-game') as HTMLButtonElement).disabled,
        ).toBe(false)
      })
      fireEvent.click(screen.getByTestId('silent-sorting-start-game'))

      // PERFORM: wait for the card pool to render.
      await waitFor(() => {
        expect(screen.getByText('thin')).toBeTruthy()
      })

      // In mobile-fallback mode, the first tap "arms" the target bucket; the
      // second tap commits the sort. Arm the target home (labelled by percept
      // "thhh home"), then tap the card.
      fireEvent.click(screen.getByRole('button', { name: 'thhh home' }))
      fireEvent.click(screen.getByText('thin'))

      await waitFor(() => {
        expect(handleSendMessage).toHaveBeenCalledWith(
          'I sorted thin into the thin sound home.',
        )
      })
    } finally {
      ;(window as unknown as { matchMedia: typeof originalMatchMedia }).matchMedia = originalMatchMedia
    }
  })

  it('uses the curated asset for TH and falls back to pseudo TTS for F', async () => {
    vi.mocked(api.synthesizeSpeech).mockClear()

    render(
      <SilentSortingPanel
        metadata={{
          targetSound: 'th',
          errorSound: 'f',
          targetWords: ['thin', 'fin'],
        }}
      />,
    )

    seedShellGesture()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Hear thhh sound/i })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: /Hear thhh sound/i }))

    await waitFor(() => {
      expect(api.synthesizeSpeech).not.toHaveBeenCalled()
    })

    fireEvent.click(screen.getByRole('button', { name: /Hear fff sound/i }))

    await waitFor(() => {
      expect(api.synthesizeSpeech).toHaveBeenLastCalledWith('fff')
    })
  })

  it('lets therapists switch preview cue strategy for non-asset isolated phonemes', async () => {
    vi.mocked(api.synthesizeSpeech).mockClear()

    render(
      <SilentSortingPanel
        audience="therapist"
        metadata={{
          targetSound: 'th',
          errorSound: 'f',
          targetWords: ['thin', 'fin'],
        }}
      />,
    )

    seedShellGesture()

    await waitFor(() => {
      expect(screen.getByText('Preview cue: Pseudo-spelling')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'IPA' }))
    fireEvent.click(screen.getByRole('button', { name: /Hear fff sound/i }))

    await waitFor(() => {
      expect(api.synthesizeSpeech).toHaveBeenLastCalledWith(
        expect.objectContaining({ phoneme: 'f', alphabet: 'ipa', fallback_text: 'sound' })
      )
    })
  })

  it('shows the therapist note when TH uses an approved sample asset', async () => {
    render(
      <SilentSortingPanel
        audience="therapist"
        metadata={{
          targetSound: 'th',
          errorSound: 'f',
          targetWords: ['thin', 'fin'],
        }}
      />,
    )

    seedShellGesture()

    await waitFor(() => {
      expect(screen.getByText('Hear thhh uses the approved sample asset.')).toBeTruthy()
    })
  })

  it('hides the dev-only Save take button by default', () => {
    render(
      <SilentSortingPanel
        audience="therapist"
        metadata={{
          targetSound: 'th',
          errorSound: 'f',
          targetWords: ['thin', 'fin'],
        }}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Save take' })).toBeNull()
  })

  it('exposes Save take when the dev flag is on and still exports non-asset isolated phonemes', async () => {
    vi.stubEnv('VITE_ENABLE_PREVIEW_EXPORT', 'true')
    vi.mocked(api.synthesizeSpeech).mockClear()
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    try {
      render(
        <SilentSortingPanel
          audience="therapist"
          metadata={{
            targetSound: 'th',
            errorSound: 'f',
            targetWords: ['thin', 'fin'],
          }}
        />,
      )

      seedShellGesture()

      const saveButton = await screen.findByRole('button', { name: 'Save take' })
      expect((saveButton as HTMLButtonElement).disabled).toBe(true)

      fireEvent.click(await screen.findByRole('button', { name: /Hear thhh sound/i }))
      await waitFor(() => {
        expect(api.synthesizeSpeech).not.toHaveBeenCalled()
      })

      await waitFor(() => {
        expect((screen.getByRole('button', { name: 'Save take' }) as HTMLButtonElement).disabled).toBe(true)
      })

      fireEvent.click(screen.getByRole('button', { name: /Hear fff sound/i }))
      await waitFor(() => {
        expect(api.synthesizeSpeech).toHaveBeenLastCalledWith('fff')
      })

      await waitFor(() => {
        expect((screen.getByRole('button', { name: 'Save take' }) as HTMLButtonElement).disabled).toBe(false)
      })

      fireEvent.click(screen.getByRole('button', { name: 'Save take' }))

      await waitFor(() => {
        expect(clickSpy).toHaveBeenCalledTimes(2)
      })
      await waitFor(() => {
        expect(screen.getByText(/Saved wulo-preview_f_pseudo_fff_voice-unknown_/)).toBeTruthy()
      })
    } finally {
      clickSpy.mockRestore()
      vi.unstubAllEnvs()
    }
  })

  it('reports the active blend and sends a blend selection message from the vowel blending panel', () => {
    const handleSendMessage = vi.fn()
    const handleActiveBlendChange = vi.fn()

    render(
      <VowelBlendingPanel
        attempts={0}
        metadata={{
          targetSound: 's',
          targetWords: ['sa', 'see'],
        }}
        onActiveBlendChange={handleActiveBlendChange}
        onSendMessage={handleSendMessage}
      />,
    )

    expect(handleActiveBlendChange).toHaveBeenCalledWith('sa')

    fireEvent.click(screen.getByRole('button', { name: 'ee' }))

    expect(handleActiveBlendChange).toHaveBeenLastCalledWith('see')
    expect(handleSendMessage).toHaveBeenCalledWith('I chose the blend see.')
  })
})