import { createRef } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildChildIntroInstructions, buildTherapistIntroInstructions } from '../app/App'
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
  play = vi.fn().mockResolvedValue(undefined)
}

const listeningInstruction =
  'Listen for the TH sound. The word is thin. Tap the picture that matches the TH sound.'

const listeningPraise = "Great listening! That's the TH sound."

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
      expect(screen.getByText('Tap the picture that matches the sound.')).toBeTruthy()
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
    expect(handleSpeakExerciseText).toHaveBeenNthCalledWith(2, 'Try again. Listen carefully.')
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
      'Listen for the TH sound. The word is thorn. Tap the picture that matches the TH sound.'
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
      expect(screen.getByText('Tap the picture that matches the sound.')).toBeTruthy()
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
        'Listen for the TH sound. The word is thorn. Tap the picture that matches the TH sound.'
      )
    })

    expect(screen.getByText('thorn')).toBeTruthy()
    expect(screen.getByText('fawn')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Skip pair' })).toBeNull()

    secondInstruction.resolve()

    await waitFor(() => {
      expect(screen.getByText('Tap the picture that matches the sound.')).toBeTruthy()
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
      expect(screen.getByText('Tap the picture that matches the sound.')).toBeTruthy()
    })

    for (let turn = 1; turn <= 12; turn += 1) {
      fireEvent.click(screen.getByText('thin'))

      if (turn < 12) {
        await waitFor(() => {
          expect(handleSpeakExerciseText).toHaveBeenCalledTimes(turn * 2 + 1)
        })

        expect(handleSpeakExerciseText).toHaveBeenLastCalledWith(listeningInstruction)

        await waitFor(() => {
          expect(screen.getByText('Tap the picture that matches the sound.')).toBeTruthy()
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

  it('builds microphone-free listening intro copy while preserving mic prompts for speaking turns', () => {
    const childListeningIntro = buildChildIntroInstructions({
      childName: 'Mia',
      avatarName: 'Meg',
      avatarPersona: 'a warm adult speech-practice buddy',
      scenarioName: 'R and W listening',
      scenarioDescription: 'Listen for the clue and tap the matching picture.',
      requiresMic: false,
    })
    const therapistListeningIntro = buildTherapistIntroInstructions({
      childName: 'Mia',
      avatarName: 'Meg',
      avatarPersona: 'a warm adult speech-practice buddy',
      scenarioName: 'R and W listening',
      scenarioDescription: 'Listen for the clue and tap the matching picture.',
      requiresMic: false,
    })
    const childSpeakingIntro = buildChildIntroInstructions({
      childName: 'Mia',
      avatarName: 'Meg',
      avatarPersona: 'a warm adult speech-practice buddy',
      scenarioName: 'R sound practice',
      scenarioDescription: 'Say the R sound clearly.',
      requiresMic: true,
    })

    expect(childListeningIntro).toContain('listen for the clue and tap the matching picture')
    expect(therapistListeningIntro).toContain('tap-only listening turn')
    expect(childListeningIntro).not.toMatch(/microphone/i)
    expect(therapistListeningIntro).not.toMatch(/microphone/i)
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
      expect(screen.getByText('Tap the picture that matches the sound.')).toBeTruthy()
    })

    expect(screen.queryByRole('button', { name: /start recording/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /stop recording/i })).toBeNull()
    expect(screen.queryByText(/microphone/i)).toBeNull()
    expect(screen.getByText('Listen for the clue, then tap the matching picture.')).toBeTruthy()
  })

  it('sends a sorting message when a card moves into a sound home', () => {
    const handleSendMessage = vi.fn()

    render(
      <SilentSortingPanel
        metadata={{
          targetSound: 'th',
          errorSound: 'f',
          targetWords: ['thin'],
        }}
        onSendMessage={handleSendMessage}
      />,
    )

    fireEvent.click(screen.getByText('thin'))

    expect(handleSendMessage).toHaveBeenCalledWith('I sorted thin into the TH home.')
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