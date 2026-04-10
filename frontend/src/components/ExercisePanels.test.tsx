import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../services/api'
import { ListeningMinimalPairsPanel } from './ListeningMinimalPairsPanel'
import { SilentSortingPanel } from './SilentSortingPanel'
import { VowelBlendingPanel } from './VowelBlendingPanel'

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

  it('sends a correct-pick message from the listening minimal pairs panel', async () => {
    const handleSendMessage = vi.fn()
    const handleInterruptAvatar = vi.fn()

    vi.spyOn(Math, 'random').mockReturnValue(0.9)

    render(
      <ListeningMinimalPairsPanel
        audience="therapist"
        metadata={{
          pairs: [{ word_a: 'thin', word_b: 'fin' }],
          speechLanguage: 'en-US',
        }}
        onSendMessage={handleSendMessage}
        onInterruptAvatar={handleInterruptAvatar}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('Prompt word: thin')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('thin'))

    expect(handleInterruptAvatar).toHaveBeenCalledTimes(1)
    expect(handleSendMessage).toHaveBeenCalledWith("I picked thin. That's the right answer!")
  })

  it('sends an incorrect-pick message from the listening minimal pairs panel', async () => {
    const handleSendMessage = vi.fn()

    vi.spyOn(Math, 'random').mockReturnValue(0.1)

    render(
      <ListeningMinimalPairsPanel
        audience="therapist"
        metadata={{
          pairs: [{ word_a: 'thin', word_b: 'fin' }],
          speechLanguage: 'en-US',
        }}
        onSendMessage={handleSendMessage}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('Prompt word: fin')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('thin'))

    expect(handleSendMessage).toHaveBeenCalledWith('I picked thin. The correct answer was fin.')
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