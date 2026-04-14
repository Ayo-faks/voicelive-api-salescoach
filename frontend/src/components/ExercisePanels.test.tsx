import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../services/api'
import { ListeningMinimalPairsPanel } from './ListeningMinimalPairsPanel'
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
        'Listen for the TH sound. The word is thin. Tap the picture that matches the TH sound.'
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
      'Listen for the TH sound. The word is thin. Tap the picture that matches the TH sound.'
    )
    expect(handleSpeakExerciseText).toHaveBeenNthCalledWith(2, 'Try again. Listen carefully.')
    expect(handleSpeakExerciseText).toHaveBeenNthCalledWith(
      3,
      'Listen for the TH sound. The word is thin. Tap the picture that matches the TH sound.'
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
      'Listen for the TH sound. The word is thin. Tap the picture that matches the TH sound.'
    )
    expect(handleSpeakExerciseText).toHaveBeenNthCalledWith(2, "Great listening! That's the TH sound.")
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
        'Listen for the TH sound. The word is thin. Tap the picture that matches the TH sound.'
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

  it('sends a segment-tap message from the vowel blending panel', () => {
    const handleSendMessage = vi.fn()

    render(
      <VowelBlendingPanel
        attempts={0}
        metadata={{
          targetSound: 's',
          targetWords: ['sa', 'see'],
        }}
        onSendMessage={handleSendMessage}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'ee' }))

    expect(handleSendMessage).toHaveBeenCalledWith('I tapped segment 2: ee.')
  })
})