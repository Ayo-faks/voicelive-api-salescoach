import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { StructuredConversationPanel } from './StructuredConversationPanel'
import type { ExerciseMetadata, TargetTally } from '../types'

/*---------------------------------------------------------------------------------------------
 *  PR5 Stage 8 — unit tests for StructuredConversationPanel (structured_conversation).
 *--------------------------------------------------------------------------------------------*/

const baseMetadata: Partial<ExerciseMetadata> = {
  type: 'structured_conversation',
  targetSound: 'sh',
  difficulty: 'medium',
  scoreScope: 'target_sound_in_utterance',
  targetCountGate: 15,
  durationFloorSeconds: 120,
  topics: [
    {
      topicId: 'beach',
      title: 'Beach day',
      imageAssetId: 'beach',
      openPrompts: ['What do you like at the beach?'],
      targetBiasedPrompts: ['Tell me about shells.'],
      suggestedTargetWords: ['shell', 'ship', 'shore'],
    },
    {
      topicId: 'farm',
      title: 'Farm visit',
      imageAssetId: 'farm',
      openPrompts: ['What do you see on the farm?'],
      targetBiasedPrompts: ['Tell me about sheep.'],
      suggestedTargetWords: ['sheep', 'shed'],
    },
  ],
}

function makeTally(overrides: Partial<TargetTally> = {}): TargetTally {
  return {
    correctCount: 0,
    incorrectCount: 0,
    totalCount: 0,
    accuracy: 0,
    elapsedSeconds: 0,
    scaffoldEscalated: false,
    ...overrides,
  }
}

function skipIntro(): void {
  const btn = screen.getByLabelText(/Skip introduction/i)
  fireEvent.click(btn)
}

describe('StructuredConversationPanel (Stage 8)', () => {
  it('renders fallback hint when topics are empty', async () => {
    render(
      <StructuredConversationPanel
        metadata={{ ...baseMetadata, topics: [] }}
        audience="therapist"
      />,
    )
    skipIntro()
    await waitFor(() => {
      expect(screen.getByText(/No topics configured/i)).toBeTruthy()
    })
  })

  it('emits wulo.tally_configure on mount when topics provided and realtime ready', () => {
    const onSendRealtime = vi.fn()
    render(
      <StructuredConversationPanel
        metadata={baseMetadata}
        audience="therapist"
        realtimeReady
        onSendRealtime={onSendRealtime}
      />,
    )
    const configure = onSendRealtime.mock.calls.find(
      ([p]) => (p as { type: string }).type === 'wulo.tally_configure',
    )
    expect(configure).toBeTruthy()
    if (!configure) return
    const payload = (configure[0] as { payload: { suggestedTargetWords: string[] } }).payload
    expect(payload.suggestedTargetWords).toEqual(
      expect.arrayContaining(['shell', 'ship', 'shore', 'sheep', 'shed']),
    )
  })

  it('renders tally meter numbers from targetTally once in perform phase', async () => {
    render(
      <StructuredConversationPanel
        metadata={baseMetadata}
        audience="therapist"
        readyToStart
        targetTally={makeTally({
          correctCount: 7,
          incorrectCount: 2,
          totalCount: 9,
          accuracy: 7 / 9,
          elapsedSeconds: 45,
        })}
      />,
    )
    skipIntro()
    const topic = await screen.findByRole('button', { name: /Pick topic Beach day/i })
    fireEvent.click(topic)
    const start = await screen.findByTestId('structured-conversation-start')
    await waitFor(() => {
      expect((start as HTMLButtonElement).disabled).toBe(false)
    })
    fireEvent.click(start)
    await waitFor(() => {
      expect(screen.getByText(/9\/15 productions/i)).toBeTruthy()
    })
    expect(screen.getByText(/Correct: 7/i)).toBeTruthy()
    expect(screen.getByText(/Incorrect: 2/i)).toBeTruthy()
  })

  it('shows scaffold-escalate badge when tally flag is set', async () => {
    render(
      <StructuredConversationPanel
        metadata={baseMetadata}
        audience="therapist"
        readyToStart
        targetTally={makeTally({ scaffoldEscalated: true })}
      />,
    )
    skipIntro()
    const topic = await screen.findByRole('button', { name: /Pick topic Beach day/i })
    fireEvent.click(topic)
    const start = await screen.findByTestId('structured-conversation-start')
    fireEvent.click(start)
    await waitFor(() => {
      expect(
        document.querySelector('[data-slot="scaffold-escalate-badge"]'),
      ).toBeTruthy()
    })
  })

  it('therapist override buttons emit wulo.therapist_override with correct deltas', async () => {
    const onSendRealtime = vi.fn()
    render(
      <StructuredConversationPanel
        metadata={baseMetadata}
        audience="therapist"
        readyToStart
        onSendRealtime={onSendRealtime}
      />,
    )
    skipIntro()
    const topic = await screen.findByRole('button', { name: /Pick topic Beach day/i })
    fireEvent.click(topic)
    fireEvent.click(await screen.findByTestId('structured-conversation-start'))
    const incCorrect = await screen.findByTestId('override-inc-correct')
    fireEvent.click(incCorrect)
    fireEvent.click(screen.getByTestId('override-inc-incorrect'))
    const overrides = onSendRealtime.mock.calls
      .map(c => c[0] as { type: string; payload?: Record<string, number> })
      .filter(p => p.type === 'wulo.therapist_override')
    expect(overrides).toHaveLength(2)
    expect(overrides[0].payload).toEqual({ correctDelta: 1 })
    expect(overrides[1].payload).toEqual({ incorrectDelta: 1 })
  })

  it('Model it pauses tally, speaks first suggested word, then resumes', async () => {
    const onSendRealtime = vi.fn()
    const onSpeakExerciseText = vi.fn().mockResolvedValue(undefined)
    render(
      <StructuredConversationPanel
        metadata={baseMetadata}
        audience="therapist"
        readyToStart
        onSendRealtime={onSendRealtime}
        onSpeakExerciseText={onSpeakExerciseText}
      />,
    )
    skipIntro()
    const farm = await screen.findByRole('button', { name: /Pick topic Farm visit/i })
    fireEvent.click(farm)
    fireEvent.click(await screen.findByTestId('structured-conversation-start'))
    fireEvent.click(await screen.findByTestId('structured-conversation-model-it'))
    await waitFor(() => {
      expect(onSpeakExerciseText).toHaveBeenCalledWith('sheep')
    })
    const eventTypes = onSendRealtime.mock.calls.map(
      c => (c[0] as { type: string }).type,
    )
    expect(eventTypes).toContain('wulo.request_pause')
    expect(eventTypes).toContain('wulo.request_resume')
  })
})
