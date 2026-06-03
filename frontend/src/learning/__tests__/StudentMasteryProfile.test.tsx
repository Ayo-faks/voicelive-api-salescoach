import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import StudentMasteryProfile from '../routes/StudentMasteryProfile'
import { api } from '../../services/api'
import type { ChildMastery } from '../../types'

vi.mock('../../services/api', () => ({
  api: { getChildMastery: vi.fn() },
}))

const masteryFixture: ChildMastery = {
  has_data: true,
  session_count: 12,
  scored_session_count: 12,
  skills: [
    { skill: 'Plane geometry', mastery: 82, target: 75, sessions: 4 },
    { skill: 'Ratio & proportion', mastery: 45, target: 75, sessions: 4 },
    { skill: 'Algebra basics', mastery: 60, target: 75, sessions: 4 },
  ],
  trajectory: [
    { week: 'W1', score: 50, iso_year: 2026, iso_week: 18 },
    { week: 'W2', score: 58, iso_year: 2026, iso_week: 19 },
    { week: 'W3', score: 66, iso_year: 2026, iso_week: 20 },
  ],
}

beforeEach(() => {
  vi.mocked(api.getChildMastery).mockReset()
  vi.mocked(api.getChildMastery).mockResolvedValue(masteryFixture)
})

describe('StudentMasteryProfile', () => {
  it('renders a one-page parent-ready summary, with the send-home action hidden (parent)', () => {
    // No studentId → no live data → honest empty state, never demo copy.
    render(<StudentMasteryProfile role="parent" learnerName="Ada O." />)

    expect(screen.getByTestId('parent-ready-summary')).toBeTruthy()
    expect(screen.getByText('One-page parent-ready summary')).toBeTruthy()
    expect(screen.getByText('Ready to send home')).toBeTruthy()
    expect(screen.getByText('What we noticed')).toBeTruthy()
    expect(screen.getByText('What Wulo Academy did')).toBeTruthy()
    expect(screen.getByText('What to do at home')).toBeTruthy()
    // With no practice data the summary derives an honest empty state instead
    // of demo copy, and the send-home action is hidden.
    expect(
      screen.getByText(/has not completed any scored practice yet/i)
    ).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: 'Send home summary' })
    ).toBeNull()
  })

  it('derives the parent-ready summary from live mastery data', async () => {
    render(
      <StudentMasteryProfile
        role="parent"
        learnerName="Ada O."
        studentId="child-1"
      />
    )

    // Strongest skill, the top below-target gap and the scored-session count
    // are all read from the live mastery profile rather than fixed copy.
    expect(
      await screen.findByText(/Ada O\. is strongest in plane geometry \(82%\)/i)
    ).toBeTruthy()
    expect(
      screen.getByText(
        /Ratio & proportion is the main learning gap this week \(45% against a 75% target\)/i
      )
    ).toBeTruthy()
    expect(screen.getByText(/12 scored sessions/i)).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: 'Send home summary' })
    ).toBeNull()
  })

  it('shows the selected learner name as the page identity (#7)', () => {
    render(<StudentMasteryProfile role="parent" learnerName="Ada O." />)

    expect(
      screen.getByRole('heading', { level: 1, name: /Ada O\./ })
    ).toBeTruthy()
    expect(
      screen.getByText(/Ada O\. has not completed any scored practice/i)
    ).toBeTruthy()
  })

  it('exposes accessible labels on the mastery charts (#17)', async () => {
    render(
      <StudentMasteryProfile
        role="parent"
        learnerName="Ada O."
        studentId="child-1"
      />
    )

    expect(
      await screen.findByRole('img', { name: /Skill radar/i })
    ).toBeTruthy()
    expect(
      screen.getByRole('img', {
        name: /Mastery trajectory/i,
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
