import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import PracticeFullscreen from './PracticeFullscreen'
import * as api from '../api'

const learnerTutorMock = vi.hoisted(() => vi.fn())

vi.mock('./LearnerTutorFullscreen', () => ({
  default: (props: {
    open: boolean
    childId: string
    exam?: string
    classYear?: string
    subject?: string
  }) => {
    learnerTutorMock(props)
    return props.open ? <div data-testid="learner-tutor-mock" /> : null
  },
}))

const mcqCard = {
  card_id: 'practice-card-1',
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
  card_id: 'practice-card-2',
  kind: 'explanation' as const,
  speak: 'Let me walk you through it.',
  title: 'Scaling a ratio',
  steps: ['Step one.', 'Step two.'],
  next_action_label: 'Try the next one',
}

describe('PracticeFullscreen', () => {
  let runTurnSpy: ReturnType<typeof vi.spyOn>
  let pauseSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    runTurnSpy = vi.spyOn(api, 'runLearnerVoiceTurn')
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    pauseSpy = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:practice-audio'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    })
  })

  afterEach(() => {
    runTurnSpy.mockRestore()
    learnerTutorMock.mockClear()
    cleanup()
    vi.restoreAllMocks()
  })

  it('returns null when closed', () => {
    runTurnSpy.mockResolvedValue({ card: mcqCard, session_complete: false })
    const { container } = render(
      <PracticeFullscreen open={false} onClose={() => {}} childId="stu-1" />,
    )
    expect(container.firstChild).toBeNull()
    expect(runTurnSpy).not.toHaveBeenCalled()
  })

  it('seeds the first turn on open and renders the MCQ card', async () => {
    runTurnSpy.mockResolvedValue({ card: mcqCard, session_complete: false })
    render(
      <PracticeFullscreen open={true} onClose={() => {}} childId="stu-1" />,
    )
    await waitFor(() => {
      expect(screen.getByTestId('practice-card')).toBeTruthy()
    })
    expect(runTurnSpy).toHaveBeenCalledWith({
      child_id: 'stu-1',
      lang: undefined,
      exam: null,
      class_year: null,
      subject: null,
    })
    expect(screen.getByText('Pick the right ratio.')).toBeTruthy()
    expect(screen.getByTestId('practice-option-c')).toBeTruthy()
  })

  it('sends the selected option id when the learner taps an answer', async () => {
    runTurnSpy
      .mockResolvedValueOnce({ card: mcqCard, session_complete: false })
      .mockResolvedValueOnce({ card: explanationCard, session_complete: false })
    render(
      <PracticeFullscreen open={true} onClose={() => {}} childId="stu-1" />,
    )
    await waitFor(() => screen.getByTestId('practice-option-a'))
    fireEvent.click(screen.getByTestId('practice-option-a'))
    await waitFor(() => {
      expect(runTurnSpy).toHaveBeenCalledTimes(2)
    })
    expect(runTurnSpy).toHaveBeenLastCalledWith({
      child_id: 'stu-1',
      lang: undefined,
      exam: null,
      class_year: null,
      subject: null,
      last_card_id: 'practice-card-1',
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
      <PracticeFullscreen open={true} onClose={onClose} childId="stu-1" />,
    )
    await waitFor(() => screen.getByTestId('practice-close'))
    fireEvent.click(screen.getByTestId('practice-close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders an error banner when the turn endpoint rejects', async () => {
    runTurnSpy.mockRejectedValue(new Error('boom'))
    render(
      <PracticeFullscreen open={true} onClose={() => {}} childId="stu-1" />,
    )
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy()
    })
  })

  it('renders no mic button', async () => {
    runTurnSpy.mockResolvedValue({ card: mcqCard, session_complete: false })
    render(
      <PracticeFullscreen open={true} onClose={() => {}} childId="stu-1" />,
    )
    await screen.findByTestId('practice-card')
    expect(screen.queryByTestId('practice-mic')).toBeNull()
    expect(screen.queryByLabelText(/microphone/i)).toBeNull()
  })

  it('fetches /api/learning/tts when 🔊 is clicked', async () => {
    runTurnSpy.mockResolvedValue({ card: mcqCard, session_complete: false })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Blob(['FAKE_MP3'], { type: 'audio/mpeg' }), { status: 200 }),
    )
    render(
      <PracticeFullscreen open={true} onClose={() => {}} childId="stu-1" />,
    )

    fireEvent.click(await screen.findByTestId('practice-listen'))

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('/api/learning/tts')
    expect(init).toEqual(expect.objectContaining({ method: 'POST', credentials: 'include' }))
    expect(String((init as RequestInit).body)).toContain(mcqCard.stem)
  })

  it('stops audio on close', async () => {
    runTurnSpy.mockResolvedValue({ card: mcqCard, session_complete: false })
    render(
      <PracticeFullscreen open={true} onClose={() => {}} childId="stu-1" />,
    )

    fireEvent.click(await screen.findByTestId('practice-close'))

    expect(pauseSpy).toHaveBeenCalled()
  })

  it('hides Listen button when backend returns 503', async () => {
    runTurnSpy.mockResolvedValue({ card: mcqCard, session_complete: false })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 503 }))
    render(
      <PracticeFullscreen open={true} onClose={() => {}} childId="stu-1" />,
    )

    fireEvent.click(await screen.findByTestId('practice-listen'))

    await waitFor(() => {
      expect(screen.queryByTestId('practice-listen')).toBeNull()
    })
  })

  it('forwards the taxonomy (exam, classYear, subject) to the turn endpoint', async () => {
    runTurnSpy.mockResolvedValue({ card: mcqCard, session_complete: false })
    render(
      <PracticeFullscreen
        open={true}
        onClose={() => {}}
        childId="stu-1"
        exam="Junior WAEC"
        classYear="JSS2"
        subject="English Language"
      />,
    )
    await waitFor(() => {
      expect(runTurnSpy).toHaveBeenCalledWith({
        child_id: 'stu-1',
        lang: undefined,
        exam: 'Junior WAEC',
        class_year: 'JSS2',
        subject: 'English Language',
      })
    })
  })

    it('opens the learner tutor from the Talk button with the same taxonomy', async () => {
      runTurnSpy.mockResolvedValue({ card: mcqCard, session_complete: false })
      render(
        <PracticeFullscreen
          open={true}
          onClose={() => {}}
          childId="stu-1"
          exam="WAEC"
          classYear="SSS2"
          subject="Mathematics"
        />,
      )

      fireEvent.click(await screen.findByTestId('practice-talk'))

      expect(await screen.findByTestId('learner-tutor-mock')).toBeTruthy()
      const lastProps = learnerTutorMock.mock.calls[learnerTutorMock.mock.calls.length - 1]?.[0]
      expect(lastProps).toEqual(expect.objectContaining({
        open: true,
        childId: 'stu-1',
        exam: 'WAEC',
        classYear: 'SSS2',
        subject: 'Mathematics',
      }))
    })
})