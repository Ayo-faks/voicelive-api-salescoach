import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../services/api'
import { WordPositionPracticePanel } from './WordPositionPracticePanel'
import type { ExerciseMetadata, PronunciationAssessment } from '../types'

/*---------------------------------------------------------------------------------------------
 *  PR3 Stage 5b — unit tests for WordPositionPracticePanel (word_position_practice).
 *--------------------------------------------------------------------------------------------*/

function seedShellGesture(): void {
  const section = document.querySelector('section.exercise-shell')
  if (section) {
    fireEvent.pointerDown(section)
  }
}

vi.mock('../services/api', async (importOriginal) => {
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

const medialMetadata: Partial<ExerciseMetadata> = {
  type: 'word_position_practice',
  targetSound: 'sh',
  targetWords: ['fishing', 'washing', 'cushion'],
  difficulty: 'medium',
  wordPosition: 'medial',
  subStep: 'medial',
  scoreScope: 'target_only',
  expectedSubstitutions: ['s'],
  masteryThreshold: 80,
  repetitionTarget: 6,
  requiresMic: true,
  stepNumber: 5,
  imageAssets: [
    'object-cards/sh/sh-medial-fishing.webp',
    'object-cards/sh/sh-medial-washing.webp',
    'object-cards/sh/sh-medial-cushion.webp',
  ],
}

function makeAssessment(pronunciation: number): PronunciationAssessment {
  return {
    pronunciation_score: pronunciation,
    accuracy_score: pronunciation,
    completeness_score: 100,
    fluency_score: 100,
    prosody_score: 100,
    words: [
      {
        word: 'test',
        accuracy: pronunciation,
        error_type: 'None',
        target_word: 'test',
      },
    ],
  } as unknown as PronunciationAssessment
}

describe('WordPositionPracticePanel (Stage 5b)', () => {
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

  it('renders a preview cell per target word', async () => {
    render(
      <WordPositionPracticePanel
        scenarioName="SH medial practice"
        metadata={medialMetadata}
        audience="child"
      />,
    )
    seedShellGesture()
    await waitFor(() => {
      expect(screen.getByTestId('wpp-preview-0')).toBeTruthy()
    })
    expect(screen.getByTestId('wpp-preview-1')).toBeTruthy()
    expect(screen.getByTestId('wpp-preview-2')).toBeTruthy()
    expect(screen.queryByTestId('wpp-preview-3')).toBeNull()
  })

  it('gates Start practice until at least one word has been previewed', async () => {
    render(
      <WordPositionPracticePanel metadata={medialMetadata} audience="child" />,
    )
    seedShellGesture()

    const preview0 = await screen.findByTestId('wpp-preview-0')
    const imgCard = preview0.firstElementChild as HTMLElement
    fireEvent.click(imgCard)

    await waitFor(() => {
      expect(preview0.getAttribute('data-previewed')).toBe('true')
    })

    const startButton = await screen.findByRole('button', {
      name: /Start practice/i,
    })
    await waitFor(() => {
      expect((startButton as HTMLButtonElement).disabled).toBe(false)
    })
  })

  it('narrows the active target word via onActiveTargetWordChange on enter and advance', async () => {
    const onActiveTargetWordChange = vi.fn()
    render(
      <WordPositionPracticePanel
        metadata={medialMetadata}
        audience="child"
        onActiveTargetWordChange={onActiveTargetWordChange}
      />,
    )
    seedShellGesture()

    const preview0 = await screen.findByTestId('wpp-preview-0')
    fireEvent.click(preview0.firstElementChild as HTMLElement)
    await waitFor(() => expect(vi.mocked(api.synthesizeSpeech)).toHaveBeenCalled())

    const startButton = await screen.findByRole('button', {
      name: /Start practice/i,
    })
    await waitFor(() => expect((startButton as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(startButton)

    await waitFor(() => {
      expect(onActiveTargetWordChange).toHaveBeenCalledWith('fishing')
    })
  })

  it('advances to the next word once the active word meets per-word successes', async () => {
    const metadata: Partial<ExerciseMetadata> = {
      ...medialMetadata,
      targetWords: ['fishing', 'washing'],
      imageAssets: [
        'object-cards/sh/sh-medial-fishing.webp',
        'object-cards/sh/sh-medial-washing.webp',
      ],
      repetitionTarget: 2, // successesPerWord = ceil(2/2) = 1
    }

    const onActiveTargetWordChange = vi.fn()
    const { rerender } = render(
      <WordPositionPracticePanel
        metadata={metadata}
        audience="child"
        onActiveTargetWordChange={onActiveTargetWordChange}
      />,
    )
    seedShellGesture()

    const preview0 = await screen.findByTestId('wpp-preview-0')
    fireEvent.click(preview0.firstElementChild as HTMLElement)
    await waitFor(() => expect(vi.mocked(api.synthesizeSpeech)).toHaveBeenCalled())

    const startButton = await screen.findByRole('button', { name: /Start practice/i })
    await waitFor(() => expect((startButton as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(startButton)

    onActiveTargetWordChange.mockClear()

    // Feed a passing score → should flip to next word.
    rerender(
      <WordPositionPracticePanel
        metadata={metadata}
        audience="child"
        onActiveTargetWordChange={onActiveTargetWordChange}
        utteranceFeedback={makeAssessment(92)}
      />,
    )

    await waitFor(() => {
      expect(onActiveTargetWordChange).toHaveBeenCalledWith('washing')
    })
  })

  it('counts low scores as attempts but not successes (soft gate)', async () => {
    const metadata: Partial<ExerciseMetadata> = {
      ...medialMetadata,
      targetWords: ['fishing'],
      imageAssets: ['object-cards/sh/sh-medial-fishing.webp'],
      masteryThreshold: 80,
      repetitionTarget: 2,
    }

    const { rerender } = render(
      <WordPositionPracticePanel metadata={metadata} audience="child" />,
    )
    seedShellGesture()

    const preview0 = await screen.findByTestId('wpp-preview-0')
    fireEvent.click(preview0.firstElementChild as HTMLElement)
    await waitFor(() => expect(vi.mocked(api.synthesizeSpeech)).toHaveBeenCalled())

    const startButton = await screen.findByRole('button', { name: /Start practice/i })
    await waitFor(() => expect((startButton as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(startButton)

    // Low score — should increment attempts but NOT mark word complete.
    rerender(
      <WordPositionPracticePanel
        metadata={metadata}
        audience="child"
        utteranceFeedback={makeAssessment(45)}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText(/Tries: 1 · Successes: 0\/2/)).toBeTruthy()
    })

    const activeCell = screen.getByTestId('wpp-active-0')
    expect(activeCell.getAttribute('data-complete')).toBe('false')
  })

  it('does not use letter names or the word "test" in beat copy', async () => {
    render(
      <WordPositionPracticePanel
        scenarioName="SH medial practice"
        metadata={medialMetadata}
        audience="child"
      />,
    )
    seedShellGesture()

    await waitFor(() => {
      // Subtitle should reference the percept, not the spelling.
      expect(screen.getByText(/say it back/i)).toBeTruthy()
    })
    const textContent = document.body.textContent || ''
    expect(/\btest\b/i.test(textContent)).toBe(false)
    // No uppercase letter-name like "the letter S" or "the letter H".
    expect(/the letter [a-z]/i.test(textContent)).toBe(false)
  })

  it('includes "middle" beat copy for medial subStep', async () => {
    render(
      <WordPositionPracticePanel
        metadata={medialMetadata}
        audience="child"
      />,
    )
    seedShellGesture()
    await waitFor(() => {
      expect(document.body.textContent || '').toMatch(/middle/i)
    })
  })

  it('includes "end" beat copy for final subStep', async () => {
    const finalMetadata: Partial<ExerciseMetadata> = {
      ...medialMetadata,
      wordPosition: 'final',
      subStep: 'final',
      targetWords: ['fish', 'dish'],
      imageAssets: [
        'object-cards/sh/sh-final-fish.webp',
        'object-cards/sh/sh-final-dish.webp',
      ],
    }
    render(
      <WordPositionPracticePanel metadata={finalMetadata} audience="child" />,
    )
    seedShellGesture()
    await waitFor(() => {
      expect(document.body.textContent || '').toMatch(/end/i)
    })
  })
})
