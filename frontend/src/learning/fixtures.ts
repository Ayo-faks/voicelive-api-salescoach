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
import type { DifferentiationGroupRecord as LearningDifferentiationGroupRecord } from './api'
import type { FollowUpRecord } from './api'

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
  objective: 'Move the group from ratio evidence into supported practice.',
  supportType: 'targeted_practice',
  durationMinutes: 20,
  followUpCheck: 'One exit-ticket ratio question before learner-facing follow-up.',
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

export const differentiationGroups: LearningDifferentiationGroupRecord[] = [
  {
    group_id: 'group-reteach-ratio-proportion',
    support_type: 'reteach',
    target_skill_id: 'ratio-proportion',
    target_skill_label: 'Ratio',
    student_ids: ['student-001', 'student-003', 'student-005'],
    learner_count: 3,
    confidence: 0.8,
    uncertainty: 0.2,
    uncertainty_label: 'strong_evidence',
    mastery_estimate: 0.37,
    rationale:
      '3 learners share low mastery evidence in Ratio; start with a short reteach before practice.',
    evidence_summary: 'Average mastery 37%; uncertainty 20% across 3 learners.',
    next_action: 'Run a 12-minute reteach on Ratio, then check one exit question.',
  },
  {
    group_id: 'group-targeted-practice-fraction-operations',
    support_type: 'targeted_practice',
    target_skill_id: 'fraction-operations',
    target_skill_label: 'Fractions',
    student_ids: ['student-002', 'student-006', 'student-008'],
    learner_count: 3,
    confidence: 0.72,
    uncertainty: 0.28,
    uncertainty_label: 'thin_evidence',
    mastery_estimate: 0.58,
    rationale:
      '3 learners are developing Fractions; targeted practice can gather more evidence and close the gap.',
    evidence_summary: 'Average mastery 58%; uncertainty 28% across 3 learners.',
    next_action: 'Assign focused practice on Fractions with one scaffolded hint.',
  },
  {
    group_id: 'group-review-linear-equations',
    support_type: 'review',
    target_skill_id: 'linear-equations',
    target_skill_label: 'Linear eq.',
    student_ids: ['student-004', 'student-007'],
    learner_count: 2,
    confidence: 0.55,
    uncertainty: 0.45,
    uncertainty_label: 'needs_more_evidence',
    mastery_estimate: 0.64,
    rationale:
      '2 learners have needs more evidence for Linear eq.; use a brief check before deciding the next support.',
    evidence_summary: 'Average mastery 64%; uncertainty 45% across 2 learners.',
    next_action: 'Collect two quick evidence points for Linear eq. before grouping further.',
  },
  {
    group_id: 'group-extension-plane-geometry',
    support_type: 'extension',
    target_skill_id: 'plane-geometry',
    target_skill_label: 'Geometry',
    student_ids: ['student-002', 'student-004', 'student-006'],
    learner_count: 3,
    confidence: 0.9,
    uncertainty: 0.1,
    uncertainty_label: 'strong_evidence',
    mastery_estimate: 0.89,
    rationale:
      '3 learners show secure evidence in Geometry; offer an extension task while monitoring transfer.',
    evidence_summary: 'Average mastery 89%; uncertainty 10% across 3 learners.',
    next_action: 'Set a transfer challenge that applies Geometry in a new context.',
  },
]

export const followUpRecords: FollowUpRecord[] = [
  {
    plan_id: 'plan-jss2-ratio-recovery',
    status: 'approved',
    target_skill_ids: ['ratio-proportion'],
    target_student_ids: ['student-001', 'student-014', 'student-022'],
    follow_up_check: 'One exit-ticket ratio question before learner-facing follow-up.',
    before_mastery: 0.42,
    after_mastery: 0.5,
    delta_mastery: 0.08,
    uncertainty: 0.34,
    uncertainty_label: 'thin_evidence',
    evidence_summary:
      '3 learner-skill follow-up signals; movement is reviewed, not automatic.',
    movements: [
      {
        student_id: 'student-001',
        skill_id: 'ratio-proportion',
        skill_label: 'Ratio',
        before_mastery: 0.42,
        after_mastery: 0.5,
        delta_mastery: 0.08,
        before_uncertainty: 0.42,
        after_uncertainty: 0.34,
        uncertainty_label: 'thin_evidence',
        source: 'mock_follow_up',
      },
    ],
  },
]

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
