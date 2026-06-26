/**
 * Home activation surfaces (PRD: intent chips · actionable stats · voice
 * entry card), all flags ON. The flags-off baseline is covered by
 * StudentLearningHome.test.tsx, which runs with every activation flag at its
 * default (false) and asserts the legacy home renders unchanged.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import type { LearnerDailyPlanResponse } from '../api'

vi.mock('../../utils/featureFlags', () => ({
  featureFlags: {
    pathfinder_learner_onboarding_enabled: true,
    pathfinder_goal_intake_enabled: false,
    pathfinder_home_chips_enabled: true,
    pathfinder_actionable_stats_enabled: true,
    pathfinder_voice_entry_card_enabled: true,
  },
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
  default: (props: { open: boolean; skillId?: string }) =>
    props.open ? (
      <div data-testid="practice-fullscreen-mock" data-skill={props.skillId} />
    ) : null,
}))

vi.mock('../components/LearnerTutorFullscreen', () => ({
  default: (props: { open: boolean; focusItem?: { stem?: string } | null }) =>
    props.open ? (
      <div
        data-testid="learner-tutor-mock"
        data-focus-stem={props.focusItem?.stem ?? ''}
      />
    ) : null,
}))

import StudentLearningHome from '../routes/StudentLearningHome'
import {
  AskSurfaceProvider,
  useAskSurface,
} from '../contexts/AskSurfaceContext'

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

function mockConfigFetch({ voiceEnabled = true } = {}) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(input => {
    const url = String(input)
    if (url === '/api/learning/voice/config') {
      return Promise.resolve(
        jsonResponse({
          enabled: voiceEnabled,
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
          safety: {
            learner_voice_disabled: false,
            session_turn_cap: null,
            session_token_cap: null,
            production_content_review_required: false,
          },
        })
      )
    }
    if (url.startsWith('/api/learning/learner/careers')) {
      return Promise.resolve(jsonResponse({ profiles: [], pathways: [] }))
    }
    if (url === '/api/events') {
      return Promise.resolve(jsonResponse({ ok: true }))
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
      label: 'Differentiation',
      mastery: 18,
      gap: 'Applying the limit definition under time pressure',
      next_action: 'Work one limit example, then answer two timed cards.',
    },
  ],
}

const warmStats = {
  sessions: { completed: 2, target: 5 },
  streak_days: 3,
  current_mastery_pct: 62,
  mastery_delta_pct: 4,
  mastery_focus_label: 'Algebra',
}

/** Exposes the latest programmatic ask-open request for assertions. */
function AskProbe() {
  const ask = useAskSurface()
  return (
    <div data-testid="ask-probe">{ask?.openRequest?.mode ?? 'none'}</div>
  )
}

function renderHome() {
  return render(
    <MemoryRouter>
      <AskSurfaceProvider>
        <StudentLearningHome studentId="student-001" />
        <AskProbe />
      </AskSurfaceProvider>
    </MemoryRouter>
  )
}

function loggedEvents(): Array<{ name: string; props?: Record<string, unknown> }> {
  try {
    return JSON.parse(
      window.localStorage.getItem('pathfinder-events') ?? '[]'
    )
  } catch {
    return []
  }
}

afterEach(() => {
  window.localStorage.clear()
  fetchLearnerPlanMock.mockReset()
  fetchWeeklyStatsMock.mockReset()
  vi.restoreAllMocks()
})

describe('StudentLearningHome activation surfaces (flags on)', () => {
  it('renders the warm chip set and opens the tutor hub anchored on the focus skill', async () => {
    mockConfigFetch()
    fetchLearnerPlanMock.mockResolvedValue(adaptivePlan)
    fetchWeeklyStatsMock.mockResolvedValue(warmStats)
    renderHome()

    const studyChip = await screen.findByTestId('home-chip-study-with-wulo')
    await waitFor(() =>
      expect(studyChip.textContent).toContain(
        'Study Differentiation with Wulo'
      )
    )
    expect(screen.getByTestId('home-chip-how-am-i-doing')).toBeTruthy()
    expect(screen.getByTestId('home-chip-ask-wulo')).toBeTruthy()
    expect(screen.queryByTestId('home-chip-talk-it-through')).toBeNull()
    // The chip supersedes the Today's-path "Study with Wulo" button — one
    // flagship entry, not two.
    expect(screen.queryByTestId('start-learner-tutor')).toBeNull()

    fireEvent.click(studyChip)
    const tutor = await screen.findByTestId('learner-tutor-mock')
    expect(tutor.getAttribute('data-focus-stem')).toContain('Differentiation')
    const events = loggedEvents()
    expect(events.some(e => e.name === 'home_chip_click')).toBe(true)
    expect(
      events.some(
        e =>
          e.name === 'tutor_opened' &&
          (e.props as { entry_point?: string })?.entry_point === 'chip'
      )
    ).toBe(true)
  })

  it('routes the typed ask chip into the Ask surface', async () => {
    mockConfigFetch()
    fetchLearnerPlanMock.mockResolvedValue(adaptivePlan)
    fetchWeeklyStatsMock.mockResolvedValue(warmStats)
    renderHome()

    fireEvent.click(await screen.findByTestId('home-chip-ask-wulo'))
    expect(screen.getByTestId('ask-probe').textContent).toBe('text')
  })

  it('renders actionable stat cards with meaning lines and practice-opening CTAs', async () => {
    mockConfigFetch()
    fetchLearnerPlanMock.mockResolvedValue(adaptivePlan)
    fetchWeeklyStatsMock.mockResolvedValue(warmStats)
    renderHome()

    const sessionsCard = await screen.findByTestId('stat-card-sessions')
    expect(sessionsCard.textContent).toContain('2 / 5')
    expect(sessionsCard.textContent).toContain(
      '3 more sessions to hit your weekly goal.'
    )
    expect(screen.getByTestId('stat-card-mastery').textContent).toContain(
      '+4%'
    )
    expect(screen.getByTestId('stat-card-streak').textContent).toContain(
      '3 days'
    )

    fireEvent.click(screen.getByTestId('stat-card-cta-sessions'))
    await screen.findByTestId('practice-fullscreen-mock')
    expect(
      loggedEvents().some(
        e =>
          e.name === 'stat_card_cta_click' &&
          (e.props as { card_id?: string })?.card_id === 'sessions'
      )
    ).toBe(true)
  })

  it('shows the voice entry card and opens the Ask surface in voice mode', async () => {
    mockConfigFetch()
    fetchLearnerPlanMock.mockResolvedValue(adaptivePlan)
    fetchWeeklyStatsMock.mockResolvedValue(warmStats)
    renderHome()

    const card = await screen.findByTestId('voice-entry-card')
    expect(card.textContent).toContain('Talk it through with Wulo')
    fireEvent.click(screen.getByTestId('voice-entry-start'))
    expect(screen.getByTestId('ask-probe').textContent).toBe('voice')
    const events = loggedEvents()
    expect(events.some(e => e.name === 'voice_card_impression')).toBe(true)
    expect(events.some(e => e.name === 'voice_card_start')).toBe(true)
  })

  it('hides the voice entry card when learner voice is unavailable', async () => {
    mockConfigFetch({ voiceEnabled: false })
    fetchLearnerPlanMock.mockResolvedValue(adaptivePlan)
    fetchWeeklyStatsMock.mockResolvedValue(warmStats)
    renderHome()

    await screen.findByTestId('home-chip-study-with-wulo')
    expect(screen.queryByTestId('voice-entry-card')).toBeNull()
    expect(screen.queryByTestId('home-chip-talk-it-through')).toBeNull()
  })

  it('resumes a pending tutor exercise from the voice entry card', async () => {
    window.localStorage.setItem(
      'pathfinder-pending-exercise:student-001',
      JSON.stringify({
        stem: 'Differentiate y = 3x^2.',
        skillId: 'differentiation',
        cardId: 'mcq-7',
        savedAt: new Date().toISOString(),
      })
    )
    mockConfigFetch()
    fetchLearnerPlanMock.mockResolvedValue(adaptivePlan)
    fetchWeeklyStatsMock.mockResolvedValue(warmStats)
    renderHome()

    const card = await screen.findByTestId('voice-entry-card')
    await waitFor(() =>
      expect(card.textContent).toContain('Pick up where you left off')
    )
    expect(card.textContent).toContain('Differentiate y = 3x^2.')
    const start = screen.getByTestId('voice-entry-start')
    expect(start.textContent).toBe('Resume exercise')

    fireEvent.click(start)
    const tutor = await screen.findByTestId('learner-tutor-mock')
    expect(tutor.getAttribute('data-focus-stem')).toBe(
      'Differentiate y = 3x^2.'
    )
    expect(
      loggedEvents().some(
        e =>
          e.name === 'tutor_opened' &&
          (e.props as { entry_point?: string })?.entry_point === 'resume_card'
      )
    ).toBe(true)
  })

  it('ignores an expired pending exercise — the card offers a fresh voice chat', async () => {
    window.localStorage.setItem(
      'pathfinder-pending-exercise:student-001',
      JSON.stringify({
        stem: 'Differentiate y = 3x^2.',
        skillId: 'differentiation',
        cardId: 'mcq-7',
        savedAt: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(),
      })
    )
    mockConfigFetch()
    fetchLearnerPlanMock.mockResolvedValue(adaptivePlan)
    fetchWeeklyStatsMock.mockResolvedValue(warmStats)
    renderHome()

    const card = await screen.findByTestId('voice-entry-card')
    expect(card.textContent).toContain('Talk it through with Wulo')
    expect(screen.getByTestId('voice-entry-start').textContent).toBe(
      'Start talking'
    )
  })

  it('serves cold-start chips when stats are honest zeros and the plan is empty', async () => {
    mockConfigFetch()
    fetchLearnerPlanMock.mockResolvedValue({
      ...adaptivePlan,
      today: [],
      weak_topics: [],
    })
    fetchWeeklyStatsMock.mockResolvedValue({
      sessions: { completed: 0, target: 5 },
      streak_days: 0,
      current_mastery_pct: null,
      mastery_delta_pct: 0,
      mastery_focus_label: '',
    })
    renderHome()

    await screen.findByTestId('home-chip-first-goal')
    expect(screen.getByTestId('home-chip-quick-quiz')).toBeTruthy()
    // The tutor hub stays reachable cold — plain label, no focus skill.
    expect(
      screen.getByTestId('home-chip-study-with-wulo').textContent
    ).toContain('Study with Wulo')
    expect(screen.queryByTestId('home-chip-how-am-i-doing')).toBeNull()
  })
})
