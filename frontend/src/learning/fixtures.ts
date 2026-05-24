import type {
  HeatmapCellView,
  PendingApprovalPlanView,
  ProvenanceView,
} from './components/PathfinderPhase2'
import type {
  AdvisorDecisionView,
  CareerPlanView,
  ParentProgressViewModel,
  VoiceQueueView,
} from './components/PathfinderPhase3'

export const provenance: ProvenanceView[] = [
  {
    source: 'pathfinder_phase_2_fixture',
    ruleId: 'beta_bkt_mastery_estimate',
    confidence: 0.94,
    evidenceCount: 52,
  },
  {
    source: 'jss2_maths_diagnostic_phase_2',
    ruleId: 'teacher_approval_required',
    confidence: 1,
    evidenceCount: 1,
  },
]

export const heatmapCells: HeatmapCellView[] = [
  {
    studentId: 'student-001',
    skillId: 'ratio-proportion',
    skillLabel: 'Ratio and proportion',
    probability: 0.42,
    uncertainty: 0.18,
    status: 'needs_support',
    lang: 'en-NG',
    provenance,
  },
  {
    studentId: 'student-001',
    skillId: 'fraction-operations',
    skillLabel: 'Fraction operations',
    probability: 0.61,
    uncertainty: 0.13,
    status: 'developing',
    lang: 'en-NG',
    provenance,
  },
  {
    studentId: 'student-001',
    skillId: 'linear-equations',
    skillLabel: 'Linear equations',
    probability: 0.74,
    uncertainty: 0.1,
    status: 'developing',
    lang: 'en-NG',
    provenance,
  },
  {
    studentId: 'student-001',
    skillId: 'plane-geometry',
    skillLabel: 'Plane geometry',
    probability: 0.86,
    uncertainty: 0.08,
    status: 'secure',
    lang: 'en-NG',
    provenance,
  },
]

export const pendingPlan: PendingApprovalPlanView = {
  planId: 'plan-jss2-ratio-recovery',
  targetSkillIds: ['ratio-proportion', 'fraction-operations'],
  targetStudentIds: ['student-001', 'student-014', 'student-022'],
  itemTypes: ['worked_example', 'short_answer', 'exit_ticket'],
  suggestedResources: [
    'ratio table mini-lesson',
    'fraction bar check-in',
    'teacher-led exit ticket',
  ],
  rationale:
    'Create a teacher-approved small group for learners with low ratio mastery and high diagnostic uncertainty. The plan remains read-only until a teacher approves it.',
  requiresApproval: true,
  lang: 'en-NG',
  provenance,
}

export const careerPlan: CareerPlanView = {
  planId: 'career-plan-001',
  studentId: 'student-001',
  lang: 'en-NG',
  requiresCounsellorSignoff: true,
  pathways: [
    {
      pathwayId: 'data-analyst-apprenticeship',
      title: 'Data analyst apprenticeship',
      fitScore: 0.82,
      wageBand: {
        source: 'labour_market_fixture',
        recency: '2026-Q2',
        confidence: 0.82,
        value: { band: 'entry to mid', currency: 'NGN' },
      },
      demandTrend: {
        source: 'labour_market_fixture',
        recency: '2026-Q2',
        confidence: 0.79,
        value: { trend: 'growing' },
      },
      rationale:
        'Strong fit with current algebra progress and interest in spreadsheet tasks.',
    },
    {
      pathwayId: 'solar-technician',
      title: 'Solar installation technician',
      fitScore: 0.74,
      wageBand: {
        source: 'labour_market_fixture',
        recency: '2026-Q2',
        confidence: 0.76,
        value: { band: 'entry', currency: 'NGN' },
      },
      demandTrend: {
        source: 'labour_market_fixture',
        recency: '2026-Q2',
        confidence: 0.81,
        value: { trend: 'growing' },
      },
      rationale:
        'Links geometry and measurement practice to a practical technical pathway.',
    },
  ],
  provenance: [
    {
      source: 'pathfinder_phase_3_career_fixture',
      ruleId: 'counsellor_signoff_required',
      confidence: 0.91,
      evidenceCount: 6,
    },
  ],
}

export const advisorDecision: AdvisorDecisionView = {
  allowed: true,
  riskLevel: 'review',
  reasons: ['grounded_sources_present', 'no_pii_leakage', 'counsellor_gate'],
}

export const parentProgress: ParentProgressViewModel = {
  studentId: 'student-001',
  masterySummary:
    'Ratio and proportion is the current focus. Fraction operations are developing, while plane geometry is secure enough for extension tasks.',
  nextReview: '2026-06-02',
  lang: 'en-NG',
  provenance: careerPlan.provenance,
}

export const voiceQueue: VoiceQueueView = {
  lang: 'yo-NG',
  queued: true,
  offlineFallback: 'queued_multilingual_voice_frame',
  provenance: [
    {
      source: 'pathfinder_phase_3_yoruba_content_pack',
      ruleId: 'offline_voice_queue',
      confidence: 0.88,
      evidenceCount: 4,
    },
  ],
}

export const pilotMetrics: Array<[string, string, string]> = [
  ['Diagnostic completion', '94.8%', '199 of 210 assigned diagnostics'],
  ['Approved interventions', '70%', '70 of 100 suggestions approved'],
  ['Evidence coverage', '100%', 'Every suggestion has source evidence'],
  ['Safety pass rate', '99.3%', '298 of 300 eval cases passed'],
  ['Data request SLA', '100%', 'All requests completed within SLA'],
  ['Weekly cost per student', 'GBP 0.21', '300 active students'],
]
