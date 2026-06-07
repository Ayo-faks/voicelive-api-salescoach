import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import type {
  LearnerDailyPlanResponse,
  LearnerWeeklyStatsResponse,
} from '../api'

// Flag ON so the adaptive plan fetch runs.
vi.mock('../../utils/featureFlags', () => ({
  featureFlags: { pathfinder_learner_onboarding_enabled: true },
}))

const fetchLearnerPlanMock = vi.hoisted(() => vi.fn())
const fetchWeeklyStatsMock = vi.hoisted(() => vi.fn())

vi.mock('../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    fetchLearnerPlan: fetchLearnerPlanMock,
    fetchWeeklyStats: fetchWeeklyStatsMock,
  }
})

vi.mock('../components/PracticeFullscreen', () => ({
  default: (props: { open: boolean }) =>
    props.open ? <div data-testid="practice-fullscreen-mock" /> : null,
}))

vi.mock('../components/LearnerTutorFullscreen', () => ({
  default: (props: { open: boolean }) =>
    props.open ? <div data-testid="learner-tutor-mock" /> : null,
}))

import StudentLearningHome from '../routes/StudentLearningHome'

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

function mockConfigFetch() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(input => {
    const url = String(input)
    if (url === '/api/learning/voice/config') {
      return Promise.resolve(
        jsonResponse({
          enabled: false,
          transport: 'flask-sock',
          offline_fallback: 'queued_multilingual_voice_frame',
        })
      )
    }
    if (url === '/api/config') {
      return Promise.resolve(
        jsonResponse({
          status: 'ok',
          proxy_enabled: false,
          ws_endpoint: '/ws',
          storage_ready: true,
          telemetry_enabled: false,
          image_base_path: '/static/images',
        })
      )
    }
    return Promise.reject(new Error(`Unexpected URL ${url}`))
  })
}

const adaptivePlan: LearnerDailyPlanResponse = {
  student_id: 'student-001',
  exam: 'WAEC',
  class_year: 'SSS2',
  subject: 'Mathematics',
  source: 'mastery',
  generated_at: '2026-01-01T00:00:00Z',
  today: [
    {
      id: 'adaptive-check',
      title: 'Adaptive differentiation check-in',
      meta: 'Differentiation · adaptive',
      minutes: 5,
      type: 'check-in',
      skill_id: 'differentiation',
      subject: 'mathematics',
    },
  ],
  weak_topics: [
    {
      skill_id: 'differentiation',
      label: 'Differentiation from first principles',
      mastery: 18,
      gap: 'Applying the limit definition under time pressure',
      next_action: 'Work one limit example, then answer two timed cards.',
    },
  ],
}

afterEach(() => {
  window.localStorage.clear()
  fetchLearnerPlanMock.mockReset()
  fetchWeeklyStatsMock.mockReset()
  vi.restoreAllMocks()
})

describe('StudentLearningHome adaptive plan wiring', () => {
  it('replaces the hardcoded weak-topic profile with the fetched plan when the flag is on', async () => {
    mockConfigFetch()
    fetchLearnerPlanMock.mockResolvedValue(adaptivePlan)
    fetchWeeklyStatsMock.mockResolvedValue({
      sessions: { completed: 0, target: 5 },
      streak_days: 0,
      mastery_delta_pct: 0,
      mastery_focus_label: '',
    })

    render(
      <MemoryRouter>
        <StudentLearningHome studentId="student-001" />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(fetchLearnerPlanMock).toHaveBeenCalledWith({
        student_id: 'student-001',
      })
    })

    await waitFor(() => {
      expect(
        screen.getAllByText('Differentiation from first principles').length
      ).toBeGreaterThan(0)
    })
    // The legacy fallback weak topic is gone once the plan loads.
    expect(screen.queryByText('Ratio and proportion')).toBeNull()
  })

  it('keeps the legacy fallback when the plan fetch fails', async () => {
    mockConfigFetch()
    fetchLearnerPlanMock.mockRejectedValue(new Error('boom'))
    fetchWeeklyStatsMock.mockResolvedValue({
      sessions: { completed: 0, target: 5 },
      streak_days: 0,
      mastery_delta_pct: 0,
      mastery_focus_label: '',
    })

    render(
      <MemoryRouter>
        <StudentLearningHome studentId="student-001" />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(fetchLearnerPlanMock).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(
        screen.getAllByText('Ratio and proportion').length
      ).toBeGreaterThan(0)
    })
  })
})

describe('StudentLearningHome weekly stats wiring', () => {
  const realWeeklyStats: LearnerWeeklyStatsResponse = {
    sessions: { completed: 3, target: 5 },
    streak_days: 5,
    mastery_delta_pct: 8,
    mastery_focus_label: 'Differentiation',
  }

  it('replaces the hardcoded "This week" tiles with real per-learner stats', async () => {
    mockConfigFetch()
    fetchLearnerPlanMock.mockResolvedValue(adaptivePlan)
    fetchWeeklyStatsMock.mockResolvedValue(realWeeklyStats)

    render(
      <MemoryRouter>
        <StudentLearningHome studentId="student-001" />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(fetchWeeklyStatsMock).toHaveBeenCalledWith({
        student_id: 'student-001',
      })
    })

    await waitFor(() => {
      expect(screen.getByText('3 / 5')).toBeTruthy()
    })
    expect(screen.getByText('5 days')).toBeTruthy()
    expect(screen.getByText('+8%')).toBeTruthy()
    expect(screen.getByText('Differentiation')).toBeTruthy()
    // The fabricated demo numbers must be gone.
    expect(screen.queryByText('4 / 5')).toBeNull()
    expect(screen.queryByText('7 days')).toBeNull()
    expect(screen.queryByText('+12%')).toBeNull()
  })

  it('shows an honest empty state for a cold-start learner (no fabricated progress)', async () => {
    mockConfigFetch()
    fetchLearnerPlanMock.mockResolvedValue(adaptivePlan)
    fetchWeeklyStatsMock.mockResolvedValue({
      sessions: { completed: 0, target: 5 },
      streak_days: 0,
      mastery_delta_pct: 0,
      mastery_focus_label: '',
    })

    render(
      <MemoryRouter>
        <StudentLearningHome studentId="student-001" />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('No sessions yet')).toBeTruthy()
    })
    expect(screen.getByText('0 / 5')).toBeTruthy()
    expect(screen.getByText('0 days')).toBeTruthy()
    // No invented mastery delta on a learner with no history.
    expect(screen.queryByText('+12%')).toBeNull()
  })

  it('keeps the empty state when the weekly-stats fetch fails', async () => {
    mockConfigFetch()
    fetchLearnerPlanMock.mockResolvedValue(adaptivePlan)
    fetchWeeklyStatsMock.mockRejectedValue(new Error('boom'))

    render(
      <MemoryRouter>
        <StudentLearningHome studentId="student-001" />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(fetchWeeklyStatsMock).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(screen.getByText('No sessions yet')).toBeTruthy()
    })
    expect(screen.queryByText('+12%')).toBeNull()
  })
})
