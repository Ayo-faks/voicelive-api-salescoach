/**
 * Smoke tests for LearnerVoiceFullscreen: greeting → answer → loading,
 * close button, error path. The realtime mic remains disabled in phase
 * 2.0 so we only assert the tap path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import LearnerVoiceFullscreen from './LearnerVoiceFullscreen'
import * as api from '../api'

const mcqCard = {
  card_id: 'lv-card-1',
  kind: 'mcq-tap' as const,
  speak: 'Question 1 of 3. Pick the right ratio.',
  stem: 'Pick the right ratio.',
  options: [
    { id: 'a', label: 'A', text: 'Two' },
    { id: 'b', label: 'B', text: 'Three' },
    { id: 'c', label: 'C', text: 'Four' },
    { id: 'd', label: 'D', text: 'Nine' },
  ],
  skill_id: 'ratio',
}

const explanationCard = {
  card_id: 'lv-card-2',
  kind: 'explanation' as const,
  speak: 'Let me walk you through it.',
  title: 'Scaling a ratio',
  steps: ['Step one.', 'Step two.'],
  next_action_label: 'Try the next one',
}

describe('LearnerVoiceFullscreen', () => {
  let runTurnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    runTurnSpy = vi.spyOn(api, 'runLearnerVoiceTurn')
  })

  afterEach(() => {
    runTurnSpy.mockRestore()
    cleanup()
  })

  it('returns null when closed', () => {
    runTurnSpy.mockResolvedValue({ card: mcqCard, session_complete: false })
    const { container } = render(
      <LearnerVoiceFullscreen open={false} onClose={() => {}} childId="stu-1" />,
    )
    expect(container.firstChild).toBeNull()
    expect(runTurnSpy).not.toHaveBeenCalled()
  })

  it('seeds the first turn on open and renders the MCQ card', async () => {
    runTurnSpy.mockResolvedValue({ card: mcqCard, session_complete: false })
    render(
      <LearnerVoiceFullscreen open={true} onClose={() => {}} childId="stu-1" />,
    )
    await waitFor(() => {
      expect(screen.getByTestId('learner-voice-card')).toBeTruthy()
    })
    expect(runTurnSpy).toHaveBeenCalledWith({ child_id: 'stu-1', lang: undefined })
    expect(screen.getByText('Pick the right ratio.')).toBeTruthy()
    expect(screen.getByTestId('learner-voice-option-c')).toBeTruthy()
  })

  it('sends the selected option id when the learner taps an answer', async () => {
    runTurnSpy
      .mockResolvedValueOnce({ card: mcqCard, session_complete: false })
      .mockResolvedValueOnce({ card: explanationCard, session_complete: false })
    render(
      <LearnerVoiceFullscreen open={true} onClose={() => {}} childId="stu-1" />,
    )
    await waitFor(() => screen.getByTestId('learner-voice-option-a'))
    fireEvent.click(screen.getByTestId('learner-voice-option-a'))
    await waitFor(() => {
      expect(runTurnSpy).toHaveBeenCalledTimes(2)
    })
    expect(runTurnSpy).toHaveBeenLastCalledWith({
      child_id: 'stu-1',
      lang: undefined,
      last_card_id: 'lv-card-1',
      last_kind: 'mcq-tap',
      answer_option_id: 'a',
    })
    await waitFor(() => {
      expect(screen.getByText('Scaling a ratio')).toBeTruthy()
    })
  })

  it('calls onClose when the close button is clicked', async () => {
    runTurnSpy.mockResolvedValue({ card: mcqCard, session_complete: false })
    const onClose = vi.fn()
    render(
      <LearnerVoiceFullscreen open={true} onClose={onClose} childId="stu-1" />,
    )
    await waitFor(() => screen.getByTestId('learner-voice-close'))
    fireEvent.click(screen.getByTestId('learner-voice-close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders an error banner when the turn endpoint rejects', async () => {
    runTurnSpy.mockRejectedValue(new Error('boom'))
    render(
      <LearnerVoiceFullscreen open={true} onClose={() => {}} childId="stu-1" />,
    )
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy()
    })
  })

  it('keeps the mic button disabled in phase 2.0', async () => {
    runTurnSpy.mockResolvedValue({ card: mcqCard, session_complete: false })
    render(
      <LearnerVoiceFullscreen open={true} onClose={() => {}} childId="stu-1" />,
    )
    const mic = await screen.findByTestId('learner-voice-mic')
    expect((mic as HTMLButtonElement).disabled).toBe(true)
  })
})
