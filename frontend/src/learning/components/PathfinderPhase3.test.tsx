import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  PathfinderPhase3Demo,
  type AdvisorDecisionView,
  type CareerPlanView,
  type ParentProgressViewModel,
  type VoiceQueueView,
} from './PathfinderPhase3'

const provenance = [
  {
    source: 'DeterministicCareerPlanner',
    ruleId: 'phase_3_weighted_mastery_labour_market_ranker',
    confidence: 1,
    evidenceCount: 3,
  },
]

const plan: CareerPlanView = {
  planId: 'career-plan-phase-3',
  studentId: 'student-tola',
  lang: 'en-NG',
  requiresCounsellorSignoff: true,
  provenance,
  pathways: [
    {
      pathwayId: 'data-analyst-ng',
      title: 'Data analyst',
      fitScore: 0.86,
      wageBand: {
        source: 'nbs_phase_3_fixture',
        recency: '2026-Q1',
        confidence: 0.78,
        value: { min_monthly: 250000 },
      },
      demandTrend: {
        source: 'world_bank_step_phase_3_fixture',
        recency: '2026-Q1',
        confidence: 0.82,
        value: { trend: 'rising' },
      },
      rationale:
        'Ranked from mastery profile, wage band, demand trend, source recency, and consent state.',
    },
  ],
}

const decision: AdvisorDecisionView = {
  allowed: false,
  riskLevel: 'refuse',
  reasons: ['under_16_requires_counsellor_signoff'],
  typedRefusal:
    'A counsellor must review this career explanation before it is shown to the learner.',
}

const parentProgress: ParentProgressViewModel = {
  studentId: 'student-tola',
  masterySummary: 'Linear equations is secure; geometry needs guided practice.',
  nextReview: '2026-06-01',
  lang: 'en-NG',
  provenance,
}

const voiceQueue: VoiceQueueView = {
  lang: 'yo-NG',
  queued: true,
  offlineFallback: 'queued_multilingual_voice_frame',
  transcript: 'Ise wo ni o ba ogbon mi mu',
  provenance: [
    {
      source: 'FlaskSockVoiceTransportAdapter',
      ruleId: 'phase_3_voice_offline_queue',
      confidence: 1,
      evidenceCount: 1,
    },
  ],
}

describe('PathfinderPhase3Demo', () => {
  it('renders sourced career, parent, and multilingual voice cards with provenance', () => {
    render(
      <PathfinderPhase3Demo
        plan={plan}
        decision={decision}
        parentProgress={parentProgress}
        voiceQueue={voiceQueue}
      />
    )

    expect(screen.getByTestId('phase3-pilot-workspace')).toBeTruthy()
    expect(screen.getByTestId('phase3-career-card').textContent).toContain(
      'Data analyst'
    )
    expect(screen.getByTestId('phase3-career-card').textContent).toContain(
      'nbs_phase_3_fixture'
    )
    expect(
      screen.getByTestId('phase3-parent-progress-card').textContent
    ).toContain('Linear equations is secure')
    expect(
      screen.getByTestId('phase3-voice-queue-card').getAttribute('data-queued')
    ).toBe('true')
    expect(screen.getByTestId('phase3-voice-queue-card').textContent).toContain(
      "Saved offline — we'll play this voice practice as soon as you're back online."
    )
    expect(
      screen.getAllByTestId('phase3-provenance-footer').length
    ).toBeGreaterThanOrEqual(3)
  })

  it('surfaces typed refusal while keeping counsellor signoff explicit', () => {
    const onApproveNarration = vi.fn()
    const onRejectNarration = vi.fn()
    render(
      <PathfinderPhase3Demo
        plan={plan}
        decision={decision}
        parentProgress={parentProgress}
        voiceQueue={voiceQueue}
        onApproveNarration={onApproveNarration}
        onRejectNarration={onRejectNarration}
      />
    )

    const gate = screen.getByTestId('phase3-counsellor-gate')
    expect(gate.getAttribute('data-risk-level')).toBe('refuse')
    expect(gate.textContent).toContain('A counsellor must review')
    fireEvent.click(within(gate).getByLabelText('Approve narration'))
    fireEvent.click(within(gate).getByLabelText('Reject narration'))

    expect(onApproveNarration).toHaveBeenCalledWith('career-plan-phase-3')
    expect(onRejectNarration).toHaveBeenCalledWith('career-plan-phase-3')
  })
})
