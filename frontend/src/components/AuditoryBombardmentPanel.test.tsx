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

    const startButton = await screen.findByRole('button', { name: /Start listening/i })
    fireEvent.click(startButton)

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
    let resolveFirstSynth: ((value: string) => void) | null = null
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

    const startButton = await screen.findByRole('button', { name: /Start listening/i })
    fireEvent.click(startButton)

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

    resolveFirstSynth?.('dGVzdA==')
  })

  it('does not require the microphone (Stage 0 listening-only)', () => {
    render(<AuditoryBombardmentPanel metadata={baseMetadata} audience="therapist" />)
    expect(screen.queryByRole('button', { name: /record/i })).toBeNull()
    expect(baseMetadata.requiresMic).toBe(false)
  })
})
