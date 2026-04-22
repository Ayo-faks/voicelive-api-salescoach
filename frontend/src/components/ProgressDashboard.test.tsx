import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ProgressDashboard } from './ProgressDashboard'
import type {
  ChildMemoryItem,
  ChildMemoryProposal,
  ChildMemorySummary,
  PlannerReadiness,
  ProgressReport,
  ProgressReportSummaryRewriteSuggestion,
  PracticePlan,
  RecommendationDetail,
  RecommendationLog,
  SessionDetail,
  SessionSummary,
} from '../types'

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
  constraints: {
    child_memory_snapshot: {
      used_item_ids: ['memory-1', 'memory-2'],
      used_items: [
        {
          id: 'memory-1',
          category: 'targets',
          memory_type: 'constraint',
          statement: 'Keep /t/ as the active therapy target.',
          confidence: 0.84,
          updated_at: '2026-03-15T12:00:00.000Z',
          detail: { target_sound: 't' },
          source_proposal_id: 'proposal-a',
        },
        {
          id: 'memory-2',
          category: 'effective_cues',
          memory_type: 'inference',
          statement: 'Short verbal models help Amina reset quickly.',
          confidence: 0.76,
          updated_at: '2026-03-15T12:00:00.000Z',
          detail: { cue: 'short verbal model' },
          source_proposal_id: 'proposal-b',
        },
      ],
      summary_text:
        'Active targets: Keep /t/ as the active therapy target. Effective cues: Short verbal models help Amina reset quickly.',
      summary_last_compiled_at: '2026-03-15T12:00:00.000Z',
      source_item_count: 2,
    },
  },
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

const childMemorySummary: ChildMemorySummary = {
  child_id: 'child-1',
  summary: {
    targets: [
      {
        id: 'memory-1',
        statement: 'Keep /t/ as the active therapy target.',
        confidence: 0.84,
      },
    ],
    effective_cues: [
      {
        id: 'memory-2',
        statement: 'Short verbal models help Amina reset quickly.',
        confidence: 0.76,
      },
    ],
  },
  summary_text: 'Active targets: Keep /t/ as the active therapy target. Effective cues: Short verbal models help Amina reset quickly.',
  source_item_count: 2,
  last_compiled_at: '2026-03-15T12:00:00.000Z',
  updated_at: '2026-03-15T12:00:00.000Z',
}

const childMemoryProposals: ChildMemoryProposal[] = [
  {
    id: 'proposal-1',
    child_id: 'child-1',
    category: 'blockers',
    memory_type: 'inference',
    status: 'pending',
    statement: 'Amina still needs high-support practice when /t/ moves into longer phrases.',
    detail: {},
    confidence: 0.69,
    provenance: { session_ids: ['session-3'] },
    author_type: 'system',
    created_at: '2026-03-15T12:00:00.000Z',
    updated_at: '2026-03-15T12:00:00.000Z',
    evidence_links: [
      {
        id: 'evidence-proposal-1',
        child_id: 'child-1',
        subject_type: 'proposal',
        subject_id: 'proposal-1',
        session_id: 'session-3',
        evidence_kind: 'session',
        snippet: 'Amina produced stronger /t/ targets in phrases than in isolation.',
        metadata: {},
        created_at: '2026-03-15T12:00:00.000Z',
      },
    ],
  },
]

const childMemoryItems: ChildMemoryItem[] = [
  {
    id: 'memory-1',
    child_id: 'child-1',
    category: 'targets',
    memory_type: 'constraint',
    status: 'approved',
    statement: 'Keep /t/ as the active therapy target.',
    detail: { target_sound: 't' },
    confidence: 0.84,
    provenance: { source: 'post_session_analysis' },
    author_type: 'system',
    created_at: '2026-03-15T12:00:00.000Z',
    updated_at: '2026-03-15T12:00:00.000Z',
    evidence_links: [
      {
        id: 'evidence-item-1',
        child_id: 'child-1',
        subject_type: 'item',
        subject_id: 'memory-1',
        session_id: 'session-3',
        evidence_kind: 'session',
        snippet: 'Amina produced stronger /t/ targets in phrases than in isolation.',
        metadata: {},
        created_at: '2026-03-15T12:00:00.000Z',
      },
    ],
  },
]

const recommendationHistory: RecommendationLog[] = [
  {
    id: 'recommendation-1',
    child_id: 'child-1',
    source_session_id: 'session-3',
    target_sound: 't',
    therapist_constraints: {
      note: 'Keep it playful and move into phrase work.',
      parsed: { playful: true, preferred_types: ['two_word_phrase'] },
    },
    ranking_context: {
      current_target_sound: 't',
      institutional_memory: {
        generated_at: '2026-03-15T12:25:00.000Z',
        summary_text: 'De-identified clinic-level patterns for /t/ are available from 2 children and 3 reviewed sessions. These tune ranking only after child-specific approved memory.',
        insights: [
          {
            id: 'institutional-pattern-t',
            insight_type: 'reviewed_pattern',
            status: 'active',
            target_sound: 't',
            title: 'Reviewed pattern summary for /t/',
            summary: 'Across 3 reviewed sessions from 2 children, two word phrase currently shows the strongest de-identified outcome pattern for /t/.',
            detail: {
              top_exercise_type: 'two_word_phrase',
              ranked_exercise_types: ['two_word_phrase'],
            },
            provenance: {
              evidence_basis: 'reviewed_sessions',
              deidentified_child_count: 2,
              reviewed_session_count: 3,
              approved_memory_item_count: 2,
            },
            source_child_count: 2,
            source_session_count: 3,
            source_memory_item_count: 2,
            created_at: '2026-03-15T12:25:00.000Z',
            updated_at: '2026-03-15T12:25:00.000Z',
          },
        ],
      },
      approved_memory_item_ids: ['memory-1'],
    },
    rationale: 'Matched the active /t/ target, approved cue memory, and phrase-level progression.',
    created_by_user_id: 'therapist-1',
    candidate_count: 2,
    top_recommendation_score: 79,
    created_at: '2026-03-15T12:30:00.000Z',
    top_recommendation: {
      rank: 1,
      exercise_id: 'exercise-phrase',
      exercise_name: 'T phrase ladder',
      score: 79,
      rationale: 'Aligned with approved memory and phrase practice.',
      supporting_memory_item_ids: ['memory-1'],
      supporting_session_ids: ['session-3'],
    },
  },
]

const recommendationDetail: RecommendationDetail = {
  ...recommendationHistory[0],
  candidates: [
    {
      id: 'recommendation-candidate-1',
      recommendation_log_id: 'recommendation-1',
      child_id: 'child-1',
      rank: 1,
      exercise_id: 'exercise-phrase',
      exercise_name: 'T phrase ladder',
      exercise_description: 'Move /t/ into short phrases.',
      exercise_metadata: { targetSound: 't', difficulty: 'medium', type: 'two_word_phrase' },
      score: 79,
      ranking_factors: {
        target_sound_match: { score: 40, reason: 'matches the active /t/ target' },
        cue_compatibility: { score: 8, reason: 'aligned with phrase-level cue history' },
        therapist_constraints: { score: 6, reason: 'matches the therapist\'s requested exercise format' },
      },
      rationale: 'Matched the active /t/ target, approved cue memory, and phrase-level progression.',
      explanation: {
        why_recommended: 'It best fit the active /t/ target and the child\'s phrase-level cue history.',
        comparison_to_approved_memory: 'This recommendation stays aligned with approved memory and phrase-level work.',
        evidence_that_could_change_recommendation: 'If phrase accuracy drops, step back to a simpler exercise.',
        supporting_memory_items: childMemoryItems,
        supporting_sessions: sessions,
        institutional_insights: recommendationHistory[0].ranking_context.institutional_memory?.insights,
        score_summary: 'Deterministic score 79',
      },
      supporting_memory_item_ids: ['memory-1'],
      supporting_session_ids: ['session-3'],
      created_at: '2026-03-15T12:30:00.000Z',
    },
  ],
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

const progressReports: ProgressReport[] = [
  {
    id: 'report-1',
    child_id: 'child-1',
    workspace_id: 'workspace-1',
    created_by_user_id: 'therapist-1',
    signed_by_user_id: null,
    audience: 'therapist',
    report_type: 'progress_summary',
    title: 'Amina therapist report',
    status: 'draft',
    period_start: '2026-03-01T10:00:00.000Z',
    period_end: '2026-03-15T10:00:00.000Z',
    included_session_ids: ['session-1', 'session-2', 'session-3'],
    snapshot: {
      child_name: 'Amina',
      session_count: 3,
      latest_session_at: '2026-03-15T10:00:00.000Z',
      average_overall_score: 73,
      average_accuracy_score: 70,
      average_pronunciation_score: 67,
      focus_targets: ['k', 't'],
      memory_summary_text: 'Amina responds well to short, modeled phrases.',
      plan_title: 'Phrase carryover plan',
      top_recommendation_name: 'T phrase ladder',
      top_recommendation_rationale: 'Phrase work fits the latest session.',
    },
    sections: [
      {
        key: 'overview',
        title: 'Overview',
        narrative: 'Amina completed three reviewed sessions this cycle.',
        metrics: [
          { label: 'Reviewed sessions', value: '3' },
          { label: 'Average overall', value: '73' },
        ],
      },
      {
        key: 'clinical-focus',
        title: 'Clinical focus',
        bullets: ['Current focus: /k/ to /t/ carryover.', 'Phrase-level practice remains appropriate.'],
      },
    ],
    redaction_overrides: {},
    summary_text: 'Therapist draft summary.',
    created_at: '2026-03-15T12:30:00.000Z',
    updated_at: '2026-03-15T12:30:00.000Z',
    approved_at: null,
    signed_at: null,
    archived_at: null,
  },
]

const rewriteSuggestion: ProgressReportSummaryRewriteSuggestion = {
  report_id: 'report-1',
  source_summary_text: 'Therapist draft summary.',
  suggested_summary_text: 'Amina showed stronger /t/ accuracy in short phrases during this review window.',
  review_required: true,
  draft_only: true,
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
        progressReports={progressReports}
        selectedReport={progressReports[0]}
        childMemorySummary={childMemorySummary}
        childMemoryItems={childMemoryItems}
        childMemoryProposals={childMemoryProposals}
        recommendationHistory={recommendationHistory}
        selectedRecommendationDetail={recommendationDetail}
        plannerReadiness={plannerReadiness}
        loadingChildren={false}
        loadingSessions={false}
        loadingSessionDetail={false}
        loadingPlans={false}
        loadingReports={false}
        loadingMemory={false}
        loadingRecommendations={false}
        planSaving={false}
        reportSaving={false}
        recommendationSaving={false}
        planError={null}
        reportError={null}
        memoryError={null}
        recommendationError={null}
        memoryReviewPendingId={null}
        manualMemorySaving={false}
        onSelectChild={() => {}}
        onOpenSession={() => {}}
        onOpenRecommendationDetail={() => {}}
        onOpenReportDetail={() => {}}
        onCreateReport={async _payload => undefined}
        onUpdateReport={async _payload => undefined}
        onSuggestReportSummaryRewrite={async () => null}
        onOpenReportExport={() => {}}
        onApproveReport={() => {}}
        onSignReport={() => {}}
        onArchiveReport={() => {}}
        onGenerateRecommendations={() => {}}
        onCreatePlan={() => {}}
        onRefinePlan={() => {}}
        onApprovePlan={() => {}}
        onApproveMemoryProposal={() => {}}
        onRejectMemoryProposal={() => {}}
        onCreateMemoryItem={() => {}}
        onBackToPractice={() => {}}
        onExitToEntry={() => {}}
      />
    )

    expect(screen.getByText('Progress trendline')).toBeTruthy()
    expect(screen.getByText('Focus sounds')).toBeTruthy()
    expect(screen.getByText('Session analysis')).toBeTruthy()
    expect(screen.getByText('Review summary')).toBeTruthy()
    expect(screen.getByLabelText('Session frequency calendar heatmap')).toBeTruthy()
    expect(screen.getByLabelText('Celebration points donut chart')).toBeTruthy()
    expect(screen.getByText('cat')).toBeTruthy()

    expect(screen.queryByText('Child memory review')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'Memory' }))

    expect(screen.getByText('Child memory review')).toBeTruthy()
    expect(screen.getByText('Pending proposals')).toBeTruthy()
    expect(screen.getByText('Therapist memory note')).toBeTruthy()
    expect(screen.getAllByText('Keep /t/ as the active therapy target.').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('tab', { name: 'Recommendations' }))

    expect(screen.getByText('Next-exercise recommendations')).toBeTruthy()
    expect(screen.getByText('Recommendation history')).toBeTruthy()
    expect(screen.getByText('Top recommendation')).toBeTruthy()
    expect(screen.getByText('Ranking factors')).toBeTruthy()
    expect(screen.getByText('Which approved memory items support it?')).toBeTruthy()
    expect(screen.getByText('What evidence might change this recommendation?')).toBeTruthy()
    expect(screen.getByText('Clinic-level institutional memory')).toBeTruthy()
    expect(screen.getByText('Reviewed pattern summary for /t/')).toBeTruthy()
    expect(screen.getAllByText('Open source session').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('tab', { name: 'Reports' }))

    expect(screen.getByText('Audience-specific progress reports')).toBeTruthy()
    expect(screen.getByText('Report history')).toBeTruthy()
    expect(screen.getAllByText('Overview').length).toBeGreaterThan(0)
    expect(screen.getByText('Clinical focus')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'Plan' }))

    expect(screen.getByText('Next-session plan')).toBeTruthy()
    expect(screen.getByText('Memory that informed this plan')).toBeTruthy()
    expect(screen.getByText('Warm-up phrases')).toBeTruthy()
    expect(screen.getByText('T phrases • 8 min')).toBeTruthy()
    expect(screen.getByLabelText('Plan confidence gauge')).toBeTruthy()
  })

  it('shows clearer report launcher copy and switches to Reports when no report is selected', () => {
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
        progressReports={progressReports}
        selectedReport={null}
        childMemorySummary={childMemorySummary}
        childMemoryItems={childMemoryItems}
        childMemoryProposals={childMemoryProposals}
        recommendationHistory={recommendationHistory}
        selectedRecommendationDetail={recommendationDetail}
        plannerReadiness={plannerReadiness}
        loadingChildren={false}
        loadingSessions={false}
        loadingSessionDetail={false}
        loadingPlans={false}
        loadingReports={false}
        loadingMemory={false}
        loadingRecommendations={false}
        planSaving={false}
        reportSaving={false}
        recommendationSaving={false}
        planError={null}
        reportError={null}
        memoryError={null}
        recommendationError={null}
        memoryReviewPendingId={null}
        manualMemorySaving={false}
        onSelectChild={() => {}}
        onOpenSession={() => {}}
        onOpenRecommendationDetail={() => {}}
        onOpenReportDetail={() => {}}
        onCreateReport={async _payload => undefined}
        onUpdateReport={async _payload => undefined}
        onSuggestReportSummaryRewrite={async () => null}
        onOpenReportExport={() => {}}
        onApproveReport={() => {}}
        onSignReport={() => {}}
        onArchiveReport={() => {}}
        onGenerateRecommendations={() => {}}
        onCreatePlan={() => {}}
        onRefinePlan={() => {}}
        onApprovePlan={() => {}}
        onApproveMemoryProposal={() => {}}
        onRejectMemoryProposal={() => {}}
        onCreateMemoryItem={() => {}}
        onBackToPractice={() => {}}
        onExitToEntry={() => {}}
        insightsRailEnabled
      />
    )

    const launcher = screen.getByTestId('insights-launcher-report') as HTMLButtonElement
    expect(launcher.disabled).toBe(false)
    expect(launcher.textContent).toBe('Select a report first')

    fireEvent.click(launcher)

    expect(screen.getByRole('tab', { name: 'Reports' }).getAttribute('aria-selected')).toBe('true')
  })

  it('lets the therapist review and apply a summary rewrite suggestion before saving', async () => {
    const onUpdateReport = vi.fn(async _payload => progressReports[0])
    const onSuggestReportSummaryRewrite = vi.fn(async () => rewriteSuggestion)

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
        progressReports={progressReports}
        selectedReport={progressReports[0]}
        childMemorySummary={childMemorySummary}
        childMemoryItems={childMemoryItems}
        childMemoryProposals={childMemoryProposals}
        recommendationHistory={recommendationHistory}
        selectedRecommendationDetail={recommendationDetail}
        plannerReadiness={plannerReadiness}
        loadingChildren={false}
        loadingSessions={false}
        loadingSessionDetail={false}
        loadingPlans={false}
        loadingReports={false}
        loadingMemory={false}
        loadingRecommendations={false}
        planSaving={false}
        reportSaving={false}
        recommendationSaving={false}
        planError={null}
        reportError={null}
        memoryError={null}
        recommendationError={null}
        memoryReviewPendingId={null}
        manualMemorySaving={false}
        onSelectChild={() => {}}
        onOpenSession={() => {}}
        onOpenRecommendationDetail={() => {}}
        onOpenReportDetail={() => {}}
        onCreateReport={async _payload => undefined}
        onUpdateReport={onUpdateReport}
        onSuggestReportSummaryRewrite={onSuggestReportSummaryRewrite}
        onOpenReportExport={() => {}}
        onApproveReport={() => {}}
        onSignReport={() => {}}
        onArchiveReport={() => {}}
        onGenerateRecommendations={() => {}}
        onCreatePlan={() => {}}
        onRefinePlan={() => {}}
        onApprovePlan={() => {}}
        onApproveMemoryProposal={() => {}}
        onRejectMemoryProposal={() => {}}
        onCreateMemoryItem={() => {}}
        onBackToPractice={() => {}}
        onExitToEntry={() => {}}
      />
    )

    fireEvent.click(screen.getByRole('tab', { name: 'Reports' }))
    fireEvent.click(screen.getByRole('button', { name: 'Suggest rewrite' }))

    await waitFor(() => expect(onUpdateReport).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(onSuggestReportSummaryRewrite).toHaveBeenCalledWith('report-1'))

    expect(await screen.findByText('Current saved summary')).toBeTruthy()
    expect(screen.getByText(rewriteSuggestion.suggested_summary_text)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Apply suggestion to editor' }))

    expect((screen.getByRole('textbox', { name: 'Executive summary note' }) as HTMLTextAreaElement).value).toBe(
      rewriteSuggestion.suggested_summary_text
    )
  })
})

describe('ProgressDashboard AI draft reports', () => {
  const aiDraftReport: ProgressReport = {
    ...progressReports[0],
    id: 'report-ai-1',
    title: 'Amina AI draft update',
    source: 'ai_insight',
    summary_text: 'AI-drafted summary.',
  }
  const pipelineReport: ProgressReport = {
    ...progressReports[0],
    id: 'report-pipeline-1',
    title: 'Amina pipeline report',
    source: 'pipeline',
    summary_text: 'Pipeline-drafted summary.',
  }

  const baseProps = {
    childProfiles: [
      {
        id: 'child-1',
        name: 'Amina',
        session_count: sessions.length,
        last_session_at: '2026-03-15T10:00:00.000Z',
      },
    ],
    selectedChildId: 'child-1',
    sessions,
    selectedSession,
    selectedPlan,
    childMemorySummary,
    childMemoryItems,
    childMemoryProposals,
    recommendationHistory,
    selectedRecommendationDetail: recommendationDetail,
    plannerReadiness,
    loadingChildren: false,
    loadingSessions: false,
    loadingSessionDetail: false,
    loadingPlans: false,
    loadingReports: false,
    loadingMemory: false,
    loadingRecommendations: false,
    planSaving: false,
    reportSaving: false,
    recommendationSaving: false,
    planError: null,
    reportError: null,
    memoryError: null,
    recommendationError: null,
    memoryReviewPendingId: null,
    manualMemorySaving: false,
    onSelectChild: () => {},
    onOpenSession: () => {},
    onOpenRecommendationDetail: () => {},
    onOpenReportDetail: () => {},
    onCreateReport: async (_payload: unknown) => undefined,
    onUpdateReport: async (_payload: unknown) => undefined,
    onSuggestReportSummaryRewrite: async () => null,
    onOpenReportExport: () => {},
    onApproveReport: () => {},
    onSignReport: () => {},
    onArchiveReport: () => {},
    onGenerateRecommendations: () => {},
    onCreatePlan: () => {},
    onRefinePlan: () => {},
    onApprovePlan: () => {},
    onApproveMemoryProposal: () => {},
    onRejectMemoryProposal: () => {},
    onCreateMemoryItem: () => {},
    onBackToPractice: () => {},
    onExitToEntry: () => {},
  }

  it('renders the AI draft badge and filters reports by source', () => {
    render(
      <ProgressDashboard
        {...(baseProps as unknown as React.ComponentProps<typeof ProgressDashboard>)}
        progressReports={[aiDraftReport, pipelineReport]}
        selectedReport={aiDraftReport}
      />
    )

    fireEvent.click(screen.getByRole('tab', { name: 'Reports' }))

    // Both reports visible under 'All' (title also renders in the detail header).
    expect(screen.getAllByText('Amina AI draft update').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Amina pipeline report').length).toBeGreaterThanOrEqual(1)

    // Filter chip, list row, and selected-report header each render the badge.
    expect(screen.getAllByText('AI draft').length).toBeGreaterThanOrEqual(3)

    // Filter to pipeline only — AI draft row should disappear from history list
    // (detail header / composer may still show the title).
    fireEvent.click(screen.getByRole('button', { name: 'Pipeline' }))
    expect(screen.getByText('Amina pipeline report')).toBeTruthy()
    // Pipeline chip is now active.
    expect(screen.getByRole('button', { name: 'Pipeline' }).getAttribute('aria-pressed')).toBe('true')

    // Filter to AI draft only — pipeline row should disappear.
    fireEvent.click(screen.getByRole('button', { name: 'AI draft' }))
    expect(screen.queryByText('Amina pipeline report')).toBeNull()

    // Manual has no rows — empty state message shows.
    fireEvent.click(screen.getByRole('button', { name: 'Manual' }))
    expect(screen.getByText('No reports match this filter yet.')).toBeTruthy()
  })

  it('gates AI draft exports until the therapist confirms review', async () => {
    const onOpenReportExport = vi.fn()
    const onApproveReport = vi.fn()
    const onUpdateReport = vi.fn(async (_payload: unknown) => aiDraftReport)

    render(
      <ProgressDashboard
        {...(baseProps as unknown as React.ComponentProps<typeof ProgressDashboard>)}
        progressReports={[aiDraftReport]}
        selectedReport={aiDraftReport}
        onOpenReportExport={onOpenReportExport}
        onApproveReport={onApproveReport}
        onUpdateReport={onUpdateReport}
      />
    )

    fireEvent.click(screen.getByRole('tab', { name: 'Reports' }))

    const previewPdf = screen.getByRole('button', { name: 'Preview PDF' }) as HTMLButtonElement
    const downloadPdf = screen.getByRole('button', { name: 'Download PDF' }) as HTMLButtonElement
    const openPrint = screen.getByRole('button', { name: 'Open print view' }) as HTMLButtonElement
    const downloadHtml = screen.getByRole('button', { name: 'Download HTML' }) as HTMLButtonElement
    const approveBtn = screen.getByRole('button', { name: 'Approve report' }) as HTMLButtonElement

    // Before acknowledging, every export action is disabled.
    expect(previewPdf.disabled).toBe(true)
    expect(downloadPdf.disabled).toBe(true)
    expect(openPrint.disabled).toBe(true)
    expect(downloadHtml.disabled).toBe(true)
    expect(approveBtn.disabled).toBe(true)

    // Click Preview PDF while gated — handler must NOT fire.
    fireEvent.click(previewPdf)
    expect(onOpenReportExport).not.toHaveBeenCalled()

    // Confirm review.
    const ack = screen.getByRole('checkbox', { name: /Reviewed — OK to export/i }) as HTMLInputElement
    fireEvent.click(ack)
    expect(ack.checked).toBe(true)

    // Now exports + approve are enabled and handlers fire.
    const previewPdfAfter = screen.getByRole('button', { name: 'Preview PDF' }) as HTMLButtonElement
    expect(previewPdfAfter.disabled).toBe(false)
    fireEvent.click(previewPdfAfter)
    // Draft exports first save via onUpdateReport, then call onOpenReportExport on the next microtask.
    await waitFor(() => expect(onOpenReportExport).toHaveBeenCalledTimes(1))

    const approveAfter = screen.getByRole('button', { name: 'Approve report' }) as HTMLButtonElement
    expect(approveAfter.disabled).toBe(false)
    fireEvent.click(approveAfter)
    expect(onApproveReport).toHaveBeenCalledTimes(1)
  })

  it('does not show the AI draft review gate for pipeline reports', () => {
    render(
      <ProgressDashboard
        {...(baseProps as unknown as React.ComponentProps<typeof ProgressDashboard>)}
        progressReports={[pipelineReport]}
        selectedReport={pipelineReport}
      />
    )

    fireEvent.click(screen.getByRole('tab', { name: 'Reports' }))

    expect(screen.queryByRole('checkbox', { name: /Reviewed — OK to export/i })).toBeNull()
    // The filter chip always renders, but the list-row + header badge should NOT. Chip only.
    expect(screen.getAllByText('AI draft').length).toBe(1)
    const previewPdf = screen.getByRole('button', { name: 'Preview PDF' }) as HTMLButtonElement
    expect(previewPdf.disabled).toBe(false)
  })

  it('collapses the insights rail into a header Ask Wulo launcher and reopens it', async () => {
    render(
      <ProgressDashboard
        {...(baseProps as unknown as React.ComponentProps<typeof ProgressDashboard>)}
        progressReports={[aiDraftReport]}
        selectedReport={aiDraftReport}
        insightsRailEnabled
      />,
    )

    expect(screen.queryByTestId('insights-header-launcher')).toBeNull()

    fireEvent.click(await screen.findByTestId('insights-rail-collapse'))

    await waitFor(() => {
      expect(screen.getByTestId('insights-header-launcher')).toBeTruthy()
    })
    expect(screen.queryByTestId('insights-rail-input')).toBeNull()

    fireEvent.click(screen.getByTestId('insights-header-launcher'))

    const input = await screen.findByTestId('insights-rail-input')
    expect(input).toBeTruthy()
    expect(screen.queryByTestId('insights-header-launcher')).toBeNull()
  })
})
