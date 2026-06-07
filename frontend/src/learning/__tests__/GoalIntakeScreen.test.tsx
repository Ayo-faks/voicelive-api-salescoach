import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { recommendFromGoal } = vi.hoisted(() => ({
  recommendFromGoal: vi.fn(),
}))

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return { ...actual, recommendFromGoal }
})

// TTS narration hits /api/learning/tts; stub it so the stepped flow runs offline.
vi.mock('../hooks/useTtsPlayer', () => ({
  useTtsPlayer: () => ({
    supported: true,
    playing: false,
    play: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
  }),
}))

import GoalIntakeScreen from '../GoalIntakeScreen'

afterEach(() => {
  vi.clearAllMocks()
})

function walkToNote() {
  fireEvent.click(screen.getByTestId('goal-begin'))
  fireEvent.click(screen.getByText('Maths'))
  fireEvent.click(screen.getByText('WAEC'))
  fireEvent.click(screen.getByText('This term'))
}

describe('GoalIntakeScreen (stepped flow)', () => {
  it('reveals questions one at a time and submits the collected goal', async () => {
    recommendFromGoal.mockResolvedValue({
      session_complete: true,
      blocks: [
        { kind: 'prose', speak: '', text: "Let's start with Mathematics.", citations: [] },
        {
          kind: 'plan',
          speak: '',
          headline: 'Start here: Mathematics',
          steps: [{ title: 'Differentiation', skill_id: 'diff', done: false }],
        },
      ],
    })

    render(<GoalIntakeScreen studentId="stu-1" onDone={vi.fn()} />)

    // Intro: questions are not yet revealed (progressive disclosure).
    expect(screen.queryByText('Maths')).toBeNull()
    fireEvent.click(screen.getByTestId('goal-begin'))

    // Q1 visible; Q2 not yet.
    expect(screen.getByText('Maths')).toBeTruthy()
    expect(screen.queryByText('WAEC')).toBeNull()
    fireEvent.click(screen.getByText('Maths'))

    expect(screen.getByText('WAEC')).toBeTruthy()
    fireEvent.click(screen.getByText('WAEC'))

    expect(screen.getByText('This term')).toBeTruthy()
    fireEvent.click(screen.getByText('This term'))

    fireEvent.click(screen.getByTestId('goal-note-continue'))

    await waitFor(() => expect(recommendFromGoal).toHaveBeenCalledTimes(1))
    expect(recommendFromGoal).toHaveBeenCalledWith({
      student_id: 'stu-1',
      subject: 'Maths',
      exam: 'WAEC',
      target_date: 'this_term',
      note: undefined,
    })

    expect(await screen.findByTestId('goal-results')).toBeTruthy()
    expect(screen.getByText('Start here: Mathematics')).toBeTruthy()
    expect(screen.getByTestId('goal-start-now')).toBeTruthy()
    expect(screen.getByTestId('goal-save-later')).toBeTruthy()
  })

  it('treats "Something else" and "None yet" as skip sentinels', async () => {
    recommendFromGoal.mockResolvedValue({ session_complete: true, blocks: [] })
    render(<GoalIntakeScreen studentId="stu-2" onDone={vi.fn()} />)

    fireEvent.click(screen.getByTestId('goal-begin'))
    fireEvent.click(screen.getByText('Something else'))
    fireEvent.click(screen.getByText('None yet'))
    fireEvent.click(screen.getByText('No deadline'))
    fireEvent.click(screen.getByTestId('goal-note-skip'))

    await waitFor(() => expect(recommendFromGoal).toHaveBeenCalledTimes(1))
    expect(recommendFromGoal).toHaveBeenCalledWith({
      student_id: 'stu-2',
      subject: undefined,
      exam: undefined,
      target_date: 'no_deadline',
      note: undefined,
    })
  })

  it('passes the typed note through and fires onStart from results', async () => {
    recommendFromGoal.mockResolvedValue({
      session_complete: true,
      blocks: [{ kind: 'prose', speak: '', text: 'Okay.', citations: [] }],
    })
    const onStart = vi.fn()
    render(
      <GoalIntakeScreen studentId="stu-3" onStart={onStart} onDone={vi.fn()} />
    )

    walkToNote()
    fireEvent.change(screen.getByTestId('goal-note'), {
      target: { value: 'I find word problems hard' },
    })
    fireEvent.click(screen.getByTestId('goal-note-continue'))

    await waitFor(() => expect(recommendFromGoal).toHaveBeenCalledTimes(1))
    expect(recommendFromGoal).toHaveBeenCalledWith(
      expect.objectContaining({ note: 'I find word problems hard' })
    )

    fireEvent.click(await screen.findByTestId('goal-start-now'))
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it('forwards the first recommended skill id to onStart', async () => {
    recommendFromGoal.mockResolvedValue({
      session_complete: true,
      blocks: [
        { kind: 'prose', speak: '', text: 'Okay.', citations: [] },
        {
          kind: 'plan',
          speak: '',
          headline: 'Start here: Mathematics',
          steps: [
            { title: 'Differentiation', skill_id: 'differentiation', done: false },
            { title: 'Trigonometry', skill_id: 'trigonometry', done: false },
          ],
        },
      ],
    })
    const onStart = vi.fn()
    render(
      <GoalIntakeScreen studentId="stu-5" onStart={onStart} onDone={vi.fn()} />
    )

    walkToNote()
    fireEvent.click(screen.getByTestId('goal-note-skip'))

    fireEvent.click(await screen.findByTestId('goal-start-now'))
    expect(onStart).toHaveBeenCalledWith('differentiation')
  })

  it('skips from the intro without calling the API', () => {
    const onDone = vi.fn()
    render(<GoalIntakeScreen studentId="stu-4" onDone={onDone} />)
    fireEvent.click(screen.getByText('Skip for now'))
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(recommendFromGoal).not.toHaveBeenCalled()
  })
})
