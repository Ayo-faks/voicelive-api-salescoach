/**
 * ParentFamilyHome activation surfaces (PRD: parent intent chips + per-child
 * stat cards), flags ON. With flags at their defaults (false) the dashboard
 * renders no chips and no stats section — same DOM as before this feature.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import type { ChildProfile } from '../../types'

vi.mock('../../utils/featureFlags', () => ({
  featureFlags: {
    pathfinder_learner_onboarding_enabled: true,
    pathfinder_home_chips_enabled: true,
    pathfinder_actionable_stats_enabled: true,
  },
}))

const fetchWeeklyStatsMock = vi.hoisted(() => vi.fn())

vi.mock('../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    fetchWeeklyStats: fetchWeeklyStatsMock,
  }
})

import ParentFamilyHome from './ParentFamilyHome'

const children: ChildProfile[] = [
  { id: 'child-1', name: 'Amara Obi' } as ChildProfile,
  { id: 'child-2', name: 'Tobi Obi' } as ChildProfile,
]

function renderFamily(
  overrides: Partial<React.ComponentProps<typeof ParentFamilyHome>> = {}
) {
  return render(
    <MemoryRouter>
      <ParentFamilyHome
        learners={children}
        selectedLearnerId="child-1"
        onSelectLearner={() => {}}
        onChildCreated={() => {}}
        {...overrides}
      />
    </MemoryRouter>
  )
}

afterEach(() => {
  window.localStorage.clear()
  fetchWeeklyStatsMock.mockReset()
  vi.restoreAllMocks()
})

describe('ParentFamilyHome activation surfaces (flags on)', () => {
  it('renders parent chips named for the selected child', async () => {
    fetchWeeklyStatsMock.mockResolvedValue({
      sessions: { completed: 1, target: 5 },
      streak_days: 0,
      current_mastery_pct: null,
      mastery_delta_pct: 0,
      mastery_focus_label: '',
    })
    renderFamily({ onAskAboutResults: () => {} })

    expect(screen.getByTestId('family-chip-progress')).toBeTruthy()
    expect(
      screen.getByTestId('family-chip-practise').textContent
    ).toContain('What should Amara practise?')
    expect(screen.getByTestId('family-chip-ask').textContent).toContain(
      "Ask about Amara's results"
    )
    expect(screen.getByTestId('family-chip-add-child')).toBeTruthy()
  })

  it('hides the ask chip when no chat panel is available', async () => {
    fetchWeeklyStatsMock.mockResolvedValue({
      sessions: { completed: 0, target: 5 },
      streak_days: 0,
      current_mastery_pct: null,
      mastery_delta_pct: 0,
      mastery_focus_label: '',
    })
    renderFamily()
    expect(screen.queryByTestId('family-chip-ask')).toBeNull()
  })

  it('opens the Wulo Tutor panel from the ask chip and logs telemetry', async () => {
    fetchWeeklyStatsMock.mockResolvedValue({
      sessions: { completed: 0, target: 5 },
      streak_days: 0,
      current_mastery_pct: null,
      mastery_delta_pct: 0,
      mastery_focus_label: '',
    })
    const onAsk = vi.fn()
    renderFamily({ onAskAboutResults: onAsk })

    fireEvent.click(screen.getByTestId('family-chip-ask'))
    expect(onAsk).toHaveBeenCalledTimes(1)
    const events = JSON.parse(
      window.localStorage.getItem('pathfinder-events') ?? '[]'
    ) as Array<{ name: string; props?: Record<string, unknown> }>
    expect(
      events.some(
        e =>
          e.name === 'home_chip_click' &&
          e.props?.persona === 'parent' &&
          e.props?.chip_id === 'ask-about-results' &&
          e.props?.child_id === 'child-1'
      )
    ).toBe(true)
  })

  it('renders honest per-child stat cards for the selected child', async () => {
    fetchWeeklyStatsMock.mockResolvedValue({
      sessions: { completed: 2, target: 5 },
      streak_days: 3,
      current_mastery_pct: 62,
      mastery_delta_pct: 4,
      mastery_focus_label: 'Algebra',
    })
    renderFamily()

    const sessions = await screen.findByTestId('parent-stat-sessions')
    expect(sessions.textContent).toContain('2 / 5')
    expect(sessions.textContent).toContain(
      "3 more sessions to hit Amara's weekly goal."
    )
    expect(
      screen.getByTestId('parent-stat-mastery').textContent
    ).toContain('62%')
    expect(screen.getByTestId('parent-stat-streak').textContent).toContain(
      '3 days'
    )
    // No weak-topics card — this surface has no skill-profile data.
    expect(screen.queryByTestId('parent-stat-weak-topics')).toBeNull()
    expect(fetchWeeklyStatsMock).toHaveBeenCalledWith({
      student_id: 'child-1',
    })
  })

  it('renders encouraging empty stats on a cold start — never demo numbers', async () => {
    fetchWeeklyStatsMock.mockResolvedValue({
      sessions: { completed: 0, target: 5 },
      streak_days: 0,
      current_mastery_pct: null,
      mastery_delta_pct: 0,
      mastery_focus_label: '',
    })
    renderFamily()

    const sessions = await screen.findByTestId('parent-stat-sessions')
    expect(sessions.textContent).toContain('0 / 5')
    expect(sessions.textContent).toContain('No sessions yet this week')
    expect(
      screen.getByTestId('parent-stat-mastery').textContent
    ).toContain('—')
    expect(screen.getByTestId('parent-stat-streak').textContent).toContain(
      '0 days'
    )
  })

  it('shows an honest unavailable message when the stats fetch fails', async () => {
    fetchWeeklyStatsMock.mockRejectedValue(new Error('boom'))
    renderFamily()
    expect(
      await screen.findByText(/stats aren't available right now/i)
    ).toBeTruthy()
  })
})
