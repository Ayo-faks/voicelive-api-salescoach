import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import StudentMasteryProfile from '../routes/StudentMasteryProfile'

describe('StudentMasteryProfile', () => {
  it('renders a one-page parent-ready summary that can be sent home (parent)', () => {
    render(<StudentMasteryProfile role="parent" learnerName="Ada O." />)

    expect(screen.getByTestId('parent-ready-summary')).toBeTruthy()
    expect(screen.getByText('One-page parent-ready summary')).toBeTruthy()
    expect(screen.getByText('Ready to send home')).toBeTruthy()
    expect(screen.getByText('What we noticed')).toBeTruthy()
    expect(screen.getByText('What Pathfinder did')).toBeTruthy()
    expect(screen.getByText('What to do at home')).toBeTruthy()
    expect(screen.getByText('Next school action')).toBeTruthy()
    expect(
      screen.getByText(/Ran a short diagnostic and adapted the next item/i)
    ).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Send home summary' }))
  })

  it('shows the selected learner name as the page identity (#7)', () => {
    render(<StudentMasteryProfile role="parent" learnerName="Ada O." />)

    expect(
      screen.getByRole('heading', { level: 1, name: /Ada O\./ })
    ).toBeTruthy()
    expect(screen.getByText(/Ada O\. is strongest in geometry/i)).toBeTruthy()
  })

  it('exposes accessible labels on the mastery charts (#17)', () => {
    render(<StudentMasteryProfile role="parent" learnerName="Ada O." />)

    expect(screen.getByRole('img', { name: /Skill radar/i })).toBeTruthy()
    expect(
      screen.getByRole('img', {
        name: /Mastery trajectory over the last 6 weeks/i,
      })
    ).toBeTruthy()
  })

  it('gives learners a read-only encouraging view without counsellor controls (#3)', () => {
    render(<StudentMasteryProfile role="learner" learnerName="Ada O." />)

    // Staff-only controls are hidden for learners.
    expect(screen.queryByText('Ready to send home')).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Send home summary' })
    ).toBeNull()
    expect(screen.queryByText('Teacher checked')).toBeNull()
    expect(screen.queryByText('Risks & flags')).toBeNull()

    // The learner still sees their progress and an encouraging focus card.
    expect(
      screen.getByRole('heading', { level: 1, name: /Ada O\./ })
    ).toBeTruthy()
    expect(screen.getByText('Your focus this week')).toBeTruthy()
  })
})
