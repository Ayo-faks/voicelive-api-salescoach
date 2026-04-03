import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ProgressDashboard } from './ProgressDashboard'
import type { PlannerReadiness, PracticePlan, SessionDetail, SessionSummary } from '../types'

vi.mock('recharts', async importOriginal => {
  const actual = await importOriginal<typeof import('recharts')>()

  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) => (
      <div style={{ width: 960, height: 540 }}>{children}</div>
    ),
  }
})

const sessions: SessionSummary[] = [
  {
    id: 'session-1',
    timestamp: '2026-03-01T10:00:00.000Z',
    overall_score: 62,
    accuracy_score: 58,
    pronunciation_score: 55,
    exercise_metadata: { targetSound: 'k' },
    exercise: {
      id: 'exercise-1',
      name: 'K words',
      description: 'Practice K in initial position',
      exerciseMetadata: { targetSound: 'k' },
    },
  },
  {
    id: 'session-2',
    timestamp: '2026-03-08T10:00:00.000Z',
    overall_score: 74,
    accuracy_score: 72,
    pronunciation_score: 69,
    exercise_metadata: { targetSound: 'k' },
    therapist_feedback: { rating: 'up' },
    exercise: {
      id: 'exercise-2',
      name: 'K phrases',
      description: 'Practice K in short phrases',
      exerciseMetadata: { targetSound: 'k' },
    },
  },
  {
    id: 'session-3',
    timestamp: '2026-03-15T10:00:00.000Z',
    overall_score: 83,
    accuracy_score: 80,
    pronunciation_score: 78,
    exercise_metadata: { targetSound: 't' },
    exercise: {
      id: 'exercise-3',
      name: 'T phrases',
      description: 'Practice T in short phrases',
      exerciseMetadata: { targetSound: 't' },
    },
  },
]

const selectedSession: SessionDetail = {
  id: 'session-3',
  timestamp: '2026-03-15T10:00:00.000Z',
  child: { id: 'child-1', name: 'Amina' },
  exercise: {
    id: 'exercise-3',
    name: 'T phrases',
    description: 'Practice T in short phrases',
    exerciseMetadata: { targetSound: 't' },
  },
  assessment: {
    ai_assessment: {
      articulation_clarity: {
        target_sound_accuracy: 8,
        overall_clarity: 7,
        consistency: 8,
        total: 23,
      },
      engagement_and_effort: {
        task_completion: 9,
        willingness_to_retry: 8,
        self_correction_attempts: 7,
        total: 24,
      },
      overall_score: 83,
      celebration_points: ['Clear /t/ in words', 'Strong focus', 'Good retrying'],
      practice_suggestions: ['Keep short carrier phrases', 'Review /t/ contrast sets'],
      therapist_notes: 'Confidence rose once the task shifted to phrases.',
    },
    pronunciation_assessment: {
      accuracy_score: 80,
      fluency_score: 78,
      completeness_score: 82,
      pronunciation_score: 79,
      words: [
        { word: 'top', accuracy: 92, error_type: 'none' },
        { word: 'tap', accuracy: 84, error_type: 'minor' },
        { word: 'cat', accuracy: 64, error_type: 'substitution' },
      ],
    },
  },
  therapist_feedback: { rating: 'up', note: 'Useful session for generalisation.' },
  transcript: 'Amina produced stronger /t/ targets in phrases than in isolation.',
}

const selectedPlan: PracticePlan = {
  id: 'plan-1',
  child_id: 'child-1',
  status: 'draft',
  title: 'Next session',
  plan_type: 'follow-up',
  constraints: {},
  draft: {
    objective: 'Stabilise /t/ in short phrases and early conversation turns.',
    focus_sound: 't',
    rationale: 'Recent sessions show upward accuracy with strong engagement.',
    estimated_duration_minutes: 20,
    activities: [
      {
        title: 'Warm-up phrases',
        exercise_id: 'exercise-3',
        exercise_name: 'T phrases',
        reason: 'Maintain success while increasing repetitions.',
        target_duration_minutes: 8,
      },
    ],
    therapist_cues: ['Model once, then fade cues.'],
    success_criteria: ['80%+ /t/ accuracy in phrases.'],
    carryover: ['Use two target phrases at home.'],
  },
  conversation: [],
  created_at: '2026-03-15T11:00:00.000Z',
  updated_at: '2026-03-15T11:00:00.000Z',
}

const plannerReadiness: PlannerReadiness = {
  ready: true,
  model: 'gpt-4.1',
  sdk_installed: true,
  cli: {
    available: true,
    authenticated: true,
  },
  auth: {
    github_token_configured: true,
    azure_byok_configured: true,
  },
  reasons: [],
}

describe('ProgressDashboard visual smoke test', () => {
  it('renders the chart-heavy therapist dashboard state', () => {
    render(
      <ProgressDashboard
        childProfiles={[
          {
            id: 'child-1',
            name: 'Amina',
            session_count: sessions.length,
            last_session_at: '2026-03-15T10:00:00.000Z',
          },
        ]}
        selectedChildId="child-1"
        sessions={sessions}
        selectedSession={selectedSession}
        selectedPlan={selectedPlan}
        plannerReadiness={plannerReadiness}
        loadingChildren={false}
        loadingSessions={false}
        loadingSessionDetail={false}
        loadingPlans={false}
        planSaving={false}
        planError={null}
        onSelectChild={() => {}}
        onOpenSession={() => {}}
        onCreatePlan={() => {}}
        onRefinePlan={() => {}}
        onApprovePlan={() => {}}
        onBackToPractice={() => {}}
        onExitToEntry={() => {}}
      />
    )

    expect(screen.getByText('Progress trendline')).toBeTruthy()
    expect(screen.getByText('Focus sounds')).toBeTruthy()
    expect(screen.getByText('Session analysis')).toBeTruthy()
    expect(screen.getByText('Review summary')).toBeTruthy()
    expect(screen.getByText('Next-session plan')).toBeTruthy()
    expect(screen.getByLabelText('Session frequency calendar heatmap')).toBeTruthy()
    expect(screen.getByLabelText('Celebration points donut chart')).toBeTruthy()
    expect(screen.getByLabelText('Plan confidence gauge')).toBeTruthy()
    expect(screen.getByText('cat')).toBeTruthy()
  })
})