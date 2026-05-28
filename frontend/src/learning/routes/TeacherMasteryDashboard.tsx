import {
  Card,
  CardHeader,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { StudentProfileDrawer } from '../StudentProfileDrawer'
import {
  MultimodalIntentBar,
  PendingApprovalCard,
  ProvenanceFooter,
  type HeatmapCellView,
  type PendingApprovalPlanEdits,
  type PendingApprovalPlanView,
} from '../components/PathfinderPhase2'
import {
  heatmapCells,
  pendingPlan as fixturePendingPlan,
  provenance,
} from '../fixtures'
import { pathfinderTokens as t } from '../theme/pathfinder-tokens'
import {
  approveLearningPlan,
  approveStudentFact,
  editAndApproveLearningPlan,
  editAndApproveStudentFact,
  getClassMastery,
  listAudit,
  listPendingApprovals,
  listPendingStudentFacts,
  rejectLearningPlan,
  rejectStudentFact,
  submitIntent,
  type ClassMasteryCell,
  type PendingPlanRecord,
  type StudentFactRecord,
  type StudentProfileSkill,
} from '../api'

const skillIds = [
  'ratio-proportion',
  'fraction-operations',
  'linear-equations',
  'plane-geometry',
] as const

const skillLabels: Record<(typeof skillIds)[number], string> = {
  'ratio-proportion': 'Ratio',
  'fraction-operations': 'Fractions',
  'linear-equations': 'Linear eq.',
  'plane-geometry': 'Geometry',
}

const masteryRamp = {
  needsSupport: t.brand.surfaceMuted,
  developing: t.brand.lineSoft,
  approaching: t.brand.line,
  secure: '#d4d4d8',
} as const

type ClassOption = {
  classId: string
  label: string
  subject: string
  learnerCount: number
  supportCount: number
  medianMastery: number
}

const classOptions: ClassOption[] = [
  {
    classId: 'class-jss1-a',
    label: 'JSS1 A',
    subject: 'Mathematics',
    learnerCount: 34,
    supportCount: 5,
    medianMastery: 64,
  },
  {
    classId: 'class-jss2-a',
    label: 'JSS2 A',
    subject: 'Mathematics',
    learnerCount: 58,
    supportCount: 7,
    medianMastery: 68,
  },
  {
    classId: 'class-jss3-a',
    label: 'JSS3 A',
    subject: 'Mathematics',
    learnerCount: 31,
    supportCount: 6,
    medianMastery: 66,
  },
  {
    classId: 'class-ss1-a',
    label: 'SS1 A',
    subject: 'Mathematics',
    learnerCount: 29,
    supportCount: 4,
    medianMastery: 71,
  },
  {
    classId: 'class-ss2-a',
    label: 'SS2 A',
    subject: 'Mathematics',
    learnerCount: 27,
    supportCount: 3,
    medianMastery: 74,
  },
  {
    classId: 'class-ss3-a',
    label: 'SS3 A',
    subject: 'Mathematics',
    learnerCount: 24,
    supportCount: 2,
    medianMastery: 78,
  },
]

const statusFilters = ['All learners', 'Needs support', 'Developing', 'Secure']

type Row = {
  studentId: string
  name: string
  cells: Record<
    string,
    { p: number; u: number; status: HeatmapCellView['status'] }
  >
}

type StudentFactEditDraft = {
  key: string
  value: string
  evidence: string
  studentName: string
}

const emptyStudentFactDraft: StudentFactEditDraft = {
  key: '',
  value: '',
  evidence: '',
  studentName: '',
}

type WeakSkillSummary = {
  skillId: (typeof skillIds)[number]
  label: string
  averageMastery: number
  needsSupportCount: number
}

const classRows: Row[] = [
  {
    studentId: 'student-001',
    name: 'Tobi A.',
    cells: {
      'ratio-proportion': { p: 0.42, u: 0.18, status: 'needs_support' },
      'fraction-operations': { p: 0.61, u: 0.13, status: 'developing' },
      'linear-equations': { p: 0.74, u: 0.1, status: 'developing' },
      'plane-geometry': { p: 0.86, u: 0.08, status: 'secure' },
    },
  },
  {
    studentId: 'student-002',
    name: 'Amaka O.',
    cells: {
      'ratio-proportion': { p: 0.58, u: 0.14, status: 'developing' },
      'fraction-operations': { p: 0.72, u: 0.1, status: 'developing' },
      'linear-equations': { p: 0.81, u: 0.09, status: 'secure' },
      'plane-geometry': { p: 0.9, u: 0.05, status: 'secure' },
    },
  },
  {
    studentId: 'student-003',
    name: 'Ibrahim S.',
    cells: {
      'ratio-proportion': { p: 0.31, u: 0.22, status: 'needs_support' },
      'fraction-operations': { p: 0.48, u: 0.19, status: 'needs_support' },
      'linear-equations': { p: 0.55, u: 0.16, status: 'developing' },
      'plane-geometry': { p: 0.7, u: 0.12, status: 'developing' },
    },
  },
  {
    studentId: 'student-004',
    name: 'Chinwe E.',
    cells: {
      'ratio-proportion': { p: 0.66, u: 0.12, status: 'developing' },
      'fraction-operations': { p: 0.79, u: 0.09, status: 'developing' },
      'linear-equations': { p: 0.88, u: 0.07, status: 'secure' },
      'plane-geometry': { p: 0.92, u: 0.05, status: 'secure' },
    },
  },
  {
    studentId: 'student-005',
    name: 'Femi K.',
    cells: {
      'ratio-proportion': { p: 0.38, u: 0.2, status: 'needs_support' },
      'fraction-operations': { p: 0.54, u: 0.15, status: 'developing' },
      'linear-equations': { p: 0.62, u: 0.13, status: 'developing' },
      'plane-geometry': { p: 0.78, u: 0.09, status: 'developing' },
    },
  },
  {
    studentId: 'student-006',
    name: 'Ngozi P.',
    cells: {
      'ratio-proportion': { p: 0.71, u: 0.1, status: 'developing' },
      'fraction-operations': { p: 0.83, u: 0.07, status: 'secure' },
      'linear-equations': { p: 0.86, u: 0.06, status: 'secure' },
      'plane-geometry': { p: 0.94, u: 0.04, status: 'secure' },
    },
  },
  {
    studentId: 'student-007',
    name: 'Olu B.',
    cells: {
      'ratio-proportion': { p: 0.49, u: 0.17, status: 'needs_support' },
      'fraction-operations': { p: 0.6, u: 0.14, status: 'developing' },
      'linear-equations': { p: 0.7, u: 0.11, status: 'developing' },
      'plane-geometry': { p: 0.82, u: 0.08, status: 'secure' },
    },
  },
  {
    studentId: 'student-008',
    name: 'Zainab H.',
    cells: {
      'ratio-proportion': { p: 0.55, u: 0.15, status: 'developing' },
      'fraction-operations': { p: 0.68, u: 0.12, status: 'developing' },
      'linear-equations': { p: 0.77, u: 0.1, status: 'developing' },
      'plane-geometry': { p: 0.88, u: 0.06, status: 'secure' },
    },
  },
]

const pilotClassRosterNames = [
  ...classRows.map(row => row.name),
  'Adaeze N.',
  'Bayo M.',
  'Chidera U.',
  'Damilola F.',
  'Eniola S.',
  'Farida A.',
  'Gbolahan T.',
  'Habiba Y.',
  'Ifeoma C.',
  'Jide O.',
  'Kamsi E.',
  'Latifah R.',
  'Moyo A.',
  'Nkem O.',
  'Olamide B.',
  'Praise I.',
  'Qudus A.',
  'Rukayat L.',
  'Seyi D.',
  'Temilade K.',
  'Uche N.',
  'Victoria A.',
  'Wale J.',
  'Yewande P.',
  'Zikora M.',
  'Anu A.',
  'Bolu E.',
  'Chiamaka I.',
  'Dipo S.',
  'Esther O.',
  'Favour N.',
  'Halima K.',
  'Ikenna P.',
  'Jumoke T.',
  'Adebisi N.',
  'Blessing U.',
  'Caleb R.',
  'Dolapo S.',
  'Aisha M.',
  'Bolaji A.',
  'Chima O.',
  'Deborah K.',
  'Emeka N.',
  'Fatima S.',
  'Gbenga R.',
  'Hauwa I.',
  'Inioluwa A.',
  'Jason E.',
  'Kehinde O.',
  'Laila U.',
]

const fallbackStudentFacts: StudentFactRecord[] = [
  {
    id: 'student-fact-pilot-tobi-ratio-worked-examples',
    tenant_id: 'tenant-phase-2',
    class_id: 'class-jss2-a',
    student_id: 'student-001',
    created_by_user_id: 'pathfinder-detector',
    status: 'pending',
    lang: 'en-NG',
    provenance: [],
    fact: {
      fact_id: 'student-fact-pilot-tobi-ratio-worked-examples',
      tenant_id: 'tenant-phase-2',
      class_id: 'class-jss2-a',
      student_id: 'student-001',
      student_name: 'Tobi A.',
      key: 'learning_support',
      value: 'Needs worked examples before independent ratio practice',
      evidence: 'Diagnostic response pattern + exit ticket',
      requires_approval: true,
      lang: 'en-NG',
      provenance: [],
    },
  },
  {
    id: 'student-fact-pilot-ibrahim-fraction-visuals',
    tenant_id: 'tenant-phase-2',
    class_id: 'class-jss2-a',
    student_id: 'student-003',
    created_by_user_id: 'pathfinder-detector',
    status: 'pending',
    lang: 'en-NG',
    provenance: [],
    fact: {
      fact_id: 'student-fact-pilot-ibrahim-fraction-visuals',
      tenant_id: 'tenant-phase-2',
      class_id: 'class-jss2-a',
      student_id: 'student-003',
      student_name: 'Ibrahim S.',
      key: 'learning_modality',
      value: 'Fraction bar visuals improve accuracy',
      evidence: 'Three recent fraction attempts',
      requires_approval: true,
      lang: 'en-NG',
      provenance: [],
    },
  },
  {
    id: 'student-fact-pilot-zainab-voice-prompts',
    tenant_id: 'tenant-phase-2',
    class_id: 'class-jss2-a',
    student_id: 'student-008',
    created_by_user_id: 'pathfinder-detector',
    status: 'pending',
    lang: 'en-NG',
    provenance: [],
    fact: {
      fact_id: 'student-fact-pilot-zainab-voice-prompts',
      tenant_id: 'tenant-phase-2',
      class_id: 'class-jss2-a',
      student_id: 'student-008',
      student_name: 'Zainab H.',
      key: 'access_preference',
      value: 'Prefers short voice prompts for review tasks',
      evidence: 'Reading drill completion logs',
      requires_approval: true,
      lang: 'en-NG',
      provenance: [],
    },
  },
]

const classRosterNames: Record<string, string[]> = {
  'class-jss1-a': [
    'Adaeze N.',
    'Bayo M.',
    'Chidera U.',
    'Damilola F.',
    'Eniola S.',
    'Farida A.',
    'Gbolahan T.',
    'Habiba Y.',
    'Ifeoma C.',
    'Jide O.',
    'Kamsi E.',
    'Latifah R.',
    'Moyo A.',
    'Nkem O.',
    'Olamide B.',
    'Praise I.',
    'Qudus A.',
    'Rukayat L.',
    'Seyi D.',
    'Temilade K.',
    'Uche N.',
    'Victoria A.',
    'Wale J.',
    'Yewande P.',
    'Zikora M.',
    'Anu A.',
    'Bolu E.',
    'Chiamaka I.',
    'Dipo S.',
    'Esther O.',
    'Favour N.',
    'Halima K.',
    'Ikenna P.',
    'Jumoke T.',
  ],
  'class-jss2-a': pilotClassRosterNames,
  'class-jss3-a': [
    'Aisha M.',
    'Bolaji A.',
    'Chima O.',
    'Deborah K.',
    'Emeka N.',
    'Fatima S.',
    'Gbenga R.',
    'Hauwa I.',
    'Inioluwa A.',
    'Jason E.',
    'Kehinde O.',
    'Laila U.',
    'Musa D.',
    'Nneka C.',
    'Opeoluwa F.',
    'Paul E.',
    'Queen O.',
    'Rafiq B.',
    'Salma T.',
    'Teniola A.',
    'Uzoamaka J.',
    'Vera N.',
    'Wasiu K.',
    'Xavier I.',
    'Yetunde S.',
    'Zubair O.',
    'Akin L.',
    'Bisola F.',
    'Collins E.',
    'Dara N.',
    'Efe M.',
  ],
  'class-ss1-a': [
    'Abigail T.',
    'Bashir U.',
    'Cynthia A.',
    'Daniel O.',
    'Elizabeth K.',
    'Francis M.',
    'Grace N.',
    'Hassan A.',
    'Ivie E.',
    'Joshua L.',
    'Kikelomo O.',
    'Lekan S.',
    'Maryam B.',
    'Nathan C.',
    'Omotola D.',
    'Peter A.',
    'Rahila I.',
    'Samuel K.',
    'Tare A.',
    'Uzoma F.',
    'Vanessa E.',
    'Wisdom O.',
    'Xavier P.',
    'Yinka M.',
    'Zara J.',
    'Adebisi N.',
    'Blessing U.',
    'Caleb R.',
    'Dolapo S.',
  ],
  'class-ss2-a': [
    'Adanna C.',
    'Benjamin E.',
    'Chioma L.',
    'David A.',
    'Ebunoluwa S.',
    'Felix O.',
    'Gloria B.',
    'Hakeem N.',
    'Ijeoma F.',
    'Kelvin T.',
    'Lara M.',
    'Michael U.',
    'Nabila A.',
    'Obinna K.',
    'Pelumi J.',
    'Precious E.',
    'Rachael O.',
    'Sadiq I.',
    'Tolu B.',
    'Ugochukwu R.',
    'Vivian K.',
    'Wuraola D.',
    'Yemi A.',
    'Zain A.',
    'Ayomide F.',
    'Binta S.',
    'Chuka N.',
  ],
  'class-ss3-a': [
    'Aminat O.',
    'Brian K.',
    'Chisom A.',
    'Damilare T.',
    'Ebere N.',
    'Fisayo C.',
    'Hadiza M.',
    'Ibrahim A.',
    'Joy U.',
    'Kayode S.',
    'Linda E.',
    'Malik R.',
    'Nosa O.',
    'Onyeka I.',
    'Patricia L.',
    'Rotimi F.',
    'Safiya B.',
    'Tunde A.',
    'Uloma E.',
    'Valerie C.',
    'Wunmi K.',
    'Yusuf N.',
    'Zainab R.',
    'Ayo D.',
  ],
}

function colourForMastery(p: number): string {
  if (p < 0.5) return masteryRamp.needsSupport
  if (p < 0.7) return masteryRamp.developing
  if (p < 0.85) return masteryRamp.approaching
  return masteryRamp.secure
}

const useStyles = makeStyles({
  shell: {
    display: 'grid',
    gap: '18px',
  },
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '16px',
    flexWrap: 'wrap',
  },
  headerCopy: {
    display: 'grid',
    gap: '10px',
  },
  title: {
    fontFamily: t.font.display,
    fontSize: 'clamp(1.6rem, 2.4vw, 2rem)',
    fontWeight: 700,
    letterSpacing: '-0.025em',
  },
  subtitle: {
    color: tokens.colorNeutralForeground2,
    maxWidth: '640px',
  },
  headerMeta: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
  },
  headerMetaChip: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: '26px',
    paddingRight: '11px',
    paddingLeft: '11px',
    borderRadius: t.radius.pill,
    border: t.surface.hairline,
    backgroundColor: t.surface.cardMuted,
    color: t.brand.textSecondary,
    boxSizing: 'border-box',
    fontSize: '0.74rem',
    fontWeight: 750,
    lineHeight: 1.35,
    whiteSpace: 'nowrap',
  },
  filterBar: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
  },
  softBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    alignSelf: 'flex-start',
    minHeight: '24px',
    borderRadius: t.radius.pill,
    border: t.surface.hairline,
    backgroundColor: t.surface.cardMuted,
    color: t.brand.textSecondary,
    boxSizing: 'border-box',
    fontSize: '0.72rem',
    fontWeight: 700,
    paddingRight: '10px',
    paddingLeft: '10px',
    lineHeight: 1.35,
    whiteSpace: 'normal',
    overflowWrap: 'anywhere',
    textAlign: 'left',
  },
  filterBadge: {
    appearance: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '26px',
    borderRadius: t.radius.pill,
    border: t.surface.hairline,
    backgroundColor: t.surface.card,
    color: t.brand.text,
    boxSizing: 'border-box',
    paddingRight: '11px',
    paddingLeft: '11px',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.72rem',
    fontWeight: 700,
    lineHeight: 1.35,
  },
  filterBadgeActive: {
    appearance: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '26px',
    borderRadius: t.radius.pill,
    border: `1px solid ${t.brand.ink}`,
    boxSizing: 'border-box',
    paddingRight: '11px',
    paddingLeft: '11px',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.72rem',
    fontWeight: 700,
    lineHeight: 1.35,
    backgroundColor: t.brand.ink,
    color: t.brand.onInk,
  },
  twoCol: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 360px',
    gap: '18px',
    '@media (max-width: 1100px)': { gridTemplateColumns: '1fr' },
  },
  heatmapCard: {
    padding: '16px',
    borderRadius: t.radius.md,
    border: t.surface.hairline,
    boxShadow: t.surface.cardElevatedShadow,
    display: 'grid',
    gap: '12px',
  },
  profilePrompt: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '14px',
    padding: '12px',
    borderRadius: t.radius.sm,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: t.brand.surface,
    '@media (max-width: 720px)': {
      alignItems: 'flex-start',
      flexDirection: 'column',
    },
  },
  profilePromptCopy: {
    display: 'grid',
    gap: '3px',
  },
  heatmapScroll: {
    overflowX: 'auto',
  },
  heatmapGrid: {
    width: '100%',
    minWidth: '640px',
    borderCollapse: 'separate',
    borderSpacing: '4px',
  },
  th: {
    padding: '8px 10px',
    fontSize: '0.78rem',
    fontWeight: 700,
    textAlign: 'left',
    color: tokens.colorNeutralForeground2,
  },
  nameCell: {
    padding: '10px 12px',
    fontWeight: 700,
    fontSize: '0.85rem',
    backgroundColor: t.brand.surface,
    borderRadius: t.radius.sm,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    whiteSpace: 'nowrap',
  },
  cell: {
    padding: '10px 8px',
    textAlign: 'center',
    borderRadius: '8px',
    fontWeight: 700,
    fontSize: '0.85rem',
    minWidth: '64px',
    border: '1px solid transparent',
  },
  cellButton: {
    width: '100%',
    minHeight: '54px',
    border: 0,
    borderRadius: '8px',
    font: 'inherit',
    fontWeight: 700,
    cursor: 'pointer',
    backgroundColor: 'transparent',
    color: 'inherit',
  },
  cellUncertainty: {
    display: 'block',
    fontSize: '0.65rem',
    fontWeight: 500,
    opacity: 0.75,
    marginTop: '2px',
  },
  legend: {
    display: 'flex',
    gap: '12px',
    flexWrap: 'wrap',
    fontSize: '0.78rem',
    color: tokens.colorNeutralForeground2,
  },
  legendDot: {
    display: 'inline-block',
    width: '12px',
    height: '12px',
    borderRadius: '3px',
    marginRight: '6px',
    verticalAlign: 'middle',
  },
  sidePanel: {
    display: 'grid',
    gap: '14px',
    alignContent: 'start',
  },
  intentCard: {
    padding: '14px',
    borderRadius: t.radius.md,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
    boxShadow: t.surface.cardElevatedShadow,
    display: 'grid',
    gap: '8px',
  },
  auditCard: {
    padding: '16px',
    borderRadius: t.radius.md,
    border: t.surface.hairline,
    backgroundColor: t.brand.surface,
    boxShadow: t.surface.cardElevatedShadow,
    display: 'grid',
    gap: '8px',
  },
  classSummary: {
    padding: '14px',
    borderRadius: t.radius.md,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    boxShadow: t.surface.cardElevatedShadow,
    display: 'grid',
    gap: '10px',
  },
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '8px',
  },
  summaryTile: {
    padding: '10px',
    borderRadius: '10px',
    backgroundColor: t.brand.lineSoft,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  summaryLabel: {
    fontSize: '0.68rem',
    fontWeight: 700,
    color: tokens.colorNeutralForeground2,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  summaryValue: {
    fontSize: '1.3rem',
    fontWeight: 800,
  },
  auditEventList: {
    display: 'grid',
    gap: '6px',
    marginTop: '8px',
    maxHeight: '220px',
    overflowY: 'auto',
  },
  auditEventItem: {
    display: 'block',
    padding: '5px 9px',
    borderRadius: t.radius.pill,
    border: t.surface.hairline,
    backgroundColor: t.surface.cardMuted,
    color: t.brand.textSecondary,
    fontSize: '0.72rem',
    fontWeight: 650,
    lineHeight: 1.35,
    overflowWrap: 'anywhere',
  },
  insightList: {
    display: 'grid',
    gap: '8px',
  },
  insightItem: {
    display: 'grid',
    gap: '4px',
    padding: '9px 10px',
    borderRadius: t.radius.sm,
    border: t.surface.hairline,
    backgroundColor: t.surface.cardMuted,
  },
  insightRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '10px',
    alignItems: 'baseline',
  },
  insightMeta: {
    color: t.brand.textTertiary,
    fontSize: '0.72rem',
    lineHeight: 1.35,
  },
  memoryTrustCopy: {
    margin: 0,
    color: t.brand.textSecondary,
    fontSize: '0.82rem',
    lineHeight: 1.45,
  },
  factEditForm: {
    display: 'grid',
    gap: '8px',
    marginTop: '6px',
    padding: '10px',
    borderRadius: t.radius.md,
    border: t.surface.hairline,
    backgroundColor: t.brand.surface,
  },
  factEditField: {
    display: 'grid',
    gap: '4px',
    color: t.brand.text,
    fontSize: '0.76rem',
    fontWeight: 800,
  },
  factEditInput: {
    width: '100%',
    minHeight: '36px',
    borderRadius: t.radius.sm,
    border: t.surface.hairline,
    boxSizing: 'border-box',
    paddingRight: '10px',
    paddingLeft: '10px',
    color: t.brand.text,
    backgroundColor: t.brand.surface,
    font: 'inherit',
    fontSize: '0.82rem',
  },
  factEditTextarea: {
    width: '100%',
    minHeight: '68px',
    borderRadius: t.radius.sm,
    border: t.surface.hairline,
    boxSizing: 'border-box',
    padding: '9px 10px',
    color: t.brand.text,
    backgroundColor: t.brand.surface,
    font: 'inherit',
    fontSize: '0.82rem',
    resize: 'vertical',
  },
  factActions: {
    display: 'flex',
    gap: '6px',
    flexWrap: 'wrap',
    marginTop: '2px',
  },
})

function statusForMastery(probability: number): HeatmapCellView['status'] {
  if (probability < 0.5) return 'needs_support'
  if (probability < 0.85) return 'developing'
  return 'secure'
}

function pilotCellsForIndex(index: number, sourceRow: Row): Row['cells'] {
  const ratioMastery =
    index < 7 ? 0.38 + (index % 4) * 0.025 : 0.58 + (index % 7) * 0.035
  const fractionMastery = 0.54 + (index % 6) * 0.025
  const linearMastery = 0.66 + (index % 8) * 0.025
  const geometryMastery = Math.min(0.91, 0.78 + (index % 6) * 0.025)

  return {
    'ratio-proportion': {
      p: ratioMastery,
      u: index < 7 ? 0.2 : sourceRow.cells['ratio-proportion'].u,
      status: statusForMastery(ratioMastery),
    },
    'fraction-operations': {
      p: fractionMastery,
      u: sourceRow.cells['fraction-operations'].u,
      status: statusForMastery(fractionMastery),
    },
    'linear-equations': {
      p: linearMastery,
      u: sourceRow.cells['linear-equations'].u,
      status: statusForMastery(linearMastery),
    },
    'plane-geometry': {
      p: geometryMastery,
      u: sourceRow.cells['plane-geometry'].u,
      status: statusForMastery(geometryMastery),
    },
  }
}

function studentIdForPilotIndex(index: number, sourceRow: Row): string {
  if (index < classRows.length) return sourceRow.studentId
  return `student-${String(index + 1).padStart(3, '0')}`
}

function rowMatchesFilter(row: Row, filter: string): boolean {
  const statuses = Object.values(row.cells).map(cell => cell.status)
  if (filter === 'Needs support') return statuses.includes('needs_support')
  if (filter === 'Developing') return statuses.includes('developing')
  if (filter === 'Secure')
    return statuses.length > 0 && statuses.every(status => status === 'secure')
  return true
}

function classRowsForOption(option: ClassOption): Row[] {
  const isPilotClass = option.classId === 'class-jss2-a'
  const rosterNames =
    classRosterNames[option.classId] ?? classRosterNames['class-jss2-a']

  if (isPilotClass) {
    return rosterNames.slice(0, option.learnerCount).map((name, index) => {
      const sourceRow = classRows[index % classRows.length]
      return {
        studentId: studentIdForPilotIndex(index, sourceRow),
        name,
        cells: pilotCellsForIndex(index, sourceRow),
      }
    })
  }

  return rosterNames.map((name, index) => {
    const sourceRow = classRows[index % classRows.length]
    return {
      studentId: `${option.classId}-student-${String(index + 1).padStart(3, '0')}`,
      name,
      cells: Object.fromEntries(
        Object.entries(sourceRow.cells).map(([skillId, cell]) => [
          skillId,
          { ...cell },
        ])
      ) as Row['cells'],
    }
  })
}

function isFlaggedForIntervention(row: Row): boolean {
  return Object.values(row.cells).some(cell => cell.status === 'needs_support')
}

function weakestSkillSummaries(rows: Row[]): WeakSkillSummary[] {
  return skillIds
    .map(skillId => {
      const cells = rows.flatMap(row =>
        row.cells[skillId] ? [row.cells[skillId]] : []
      )
      const averageMastery =
        cells.length > 0
          ? cells.reduce((total, cell) => total + cell.p, 0) / cells.length
          : 0
      return {
        skillId,
        label: skillLabels[skillId],
        averageMastery,
        needsSupportCount: cells.filter(cell => cell.status === 'needs_support')
          .length,
      }
    })
    .sort((left, right) => left.averageMastery - right.averageMastery)
    .slice(0, 3)
}

function planRecordToView(record: PendingPlanRecord): PendingApprovalPlanView {
  return {
    planId: record.id,
    targetSkillIds: record.plan.target_skill_ids,
    targetStudentIds: record.plan.target_student_ids,
    itemTypes: record.plan.item_types,
    suggestedResources: record.plan.suggested_resources,
    rationale: record.plan.rationale,
    requiresApproval: record.plan.requires_approval,
    lang: record.plan.lang,
    provenance: record.plan.provenance.map(item => ({
      source: item.source,
      ruleId: item.rule_id ?? undefined,
      confidence: item.confidence,
      evidenceCount: item.evidence_count,
    })),
  }
}

function mergeLiveCellsWithFixture(
  live: ClassMasteryCell[],
  selectedClass: ClassOption
): Row[] {
  const merged = classRowsForOption(selectedClass)
  if (live.length === 0) return merged
  for (const cell of live) {
    let liveRow = merged.find(row => row.studentId === cell.student_id)
    if (!liveRow) {
      const belongsToSelectedClass =
        selectedClass.classId === 'class-jss2-a' ||
        cell.student_id.startsWith(`${selectedClass.classId}-student-`)
      if (!belongsToSelectedClass) continue

      liveRow = {
        studentId: cell.student_id,
        name: cell.student_id,
        cells: {},
      }
      merged.unshift(liveRow)
    }
    liveRow.cells[cell.skill_id] = {
      p: cell.probability,
      u: cell.uncertainty,
      status: cell.status,
    }
  }
  return merged
}

function rowToProfileSkills(row: Row | undefined): StudentProfileSkill[] {
  if (!row) return []
  return skillIds.flatMap(skillId => {
    const cell = row.cells[skillId]
    if (!cell) return []
    return [
      {
        skill_id: skillId,
        skill_label: skillLabels[skillId],
        probability: cell.p,
        uncertainty: cell.u,
        kind: 'beta',
        status: cell.status,
      },
    ]
  })
}

function draftFromStudentFact(record: StudentFactRecord): StudentFactEditDraft {
  return {
    key: record.fact.key,
    value: record.fact.value,
    evidence: record.fact.evidence,
    studentName: record.fact.student_name ?? '',
  }
}

export default function TeacherMasteryDashboard() {
  const styles = useStyles()
  const [selectedClassId, setSelectedClassId] = useState('class-jss2-a')
  const [activeFilter, setActiveFilter] = useState(statusFilters[0])
  const [auditEvents, setAuditEvents] = useState<string[]>([
    'Secondary maths diagnostic results ready',
    'Teacher approval workflow active',
  ])
  const [liveCells, setLiveCells] = useState<ClassMasteryCell[]>([])
  const [pendingPlans, setPendingPlans] = useState<PendingPlanRecord[]>([])
  const [pendingStudentFacts, setPendingStudentFacts] =
    useState<StudentFactRecord[]>(fallbackStudentFacts)
  const [approvalQueueState, setApprovalQueueState] = useState<
    'loading' | 'live' | 'offline'
  >('loading')
  const [studentFactQueueState, setStudentFactQueueState] = useState<
    'loading' | 'live' | 'offline'
  >('loading')
  const [editingStudentFactId, setEditingStudentFactId] = useState<
    string | null
  >(null)
  const [studentFactDraft, setStudentFactDraft] =
    useState<StudentFactEditDraft>(emptyStudentFactDraft)
  const [intentBusy, setIntentBusy] = useState(false)
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(
    null
  )
  const selectedClass =
    classOptions.find(option => option.classId === selectedClassId) ??
    classOptions[1]

  const refresh = useCallback(async () => {
    try {
      const mastery = await getClassMastery({ class_id: selectedClassId })
      setLiveCells(mastery.cells)
      try {
        const approvals = await listPendingApprovals({
          class_id: selectedClassId,
        })
        setPendingPlans(approvals.plans)
      } catch {
        setPendingPlans([])
      }
      try {
        const facts = await listPendingStudentFacts({
          class_id: selectedClassId,
        })
        setPendingStudentFacts(facts.facts)
        setStudentFactQueueState('live')
      } catch {
        setPendingStudentFacts(
          selectedClassId === 'class-jss2-a' ? fallbackStudentFacts : []
        )
        setStudentFactQueueState('offline')
      }
      setApprovalQueueState('live')
      try {
        const audit = await listAudit()
        if (audit.events.length > 0) {
          setAuditEvents(cur => {
            const baseline = cur.filter(value => !value.startsWith('[live]'))
            return [
              ...baseline,
              ...audit.events.map(event => `[live] ${event.label}`),
            ]
          })
        }
      } catch {
        // Audit is admin-scoped; teacher dashboards still render live class data.
      }
    } catch {
      setApprovalQueueState('offline')
      setStudentFactQueueState('offline')
      setPendingStudentFacts(
        selectedClassId === 'class-jss2-a' ? fallbackStudentFacts : []
      )
      // Backend unavailable in pure-frontend dev — fall back silently.
    }
  }, [selectedClassId])

  useEffect(() => {
    void refresh()
    const handle = window.setInterval(() => {
      void refresh()
    }, 5000)
    return () => window.clearInterval(handle)
  }, [refresh])

  const allRows = mergeLiveCellsWithFixture(liveCells, selectedClass)
  const visibleRows = allRows.filter(row => rowMatchesFilter(row, activeFilter))
  const flaggedForInterventionCount = allRows.filter(
    isFlaggedForIntervention
  ).length
  const weakestSkills = weakestSkillSummaries(allRows)
  const proposedStudentFactCount = pendingStudentFacts.length
  const selectedFallbackSkills = rowToProfileSkills(
    allRows.find(row => row.studentId === selectedStudentId)
  )
  const visiblePlan: PendingApprovalPlanView | null =
    pendingPlans.length > 0
      ? planRecordToView(pendingPlans[0])
      : approvalQueueState === 'offline' &&
          selectedClass.classId === 'class-jss2-a'
        ? fixturePendingPlan
        : null
  const profileEntryStudent = visibleRows[0]
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _pendingApprovalCount =
    pendingPlans.length > 0
      ? pendingPlans.length
      : approvalQueueState === 'offline' &&
          selectedClass.classId === 'class-jss2-a'
        ? 1
        : 0

  function pushEvent(e: string) {
    setAuditEvents(cur => [...cur, e])
  }

  function handleSelectClass(classId: string) {
    setSelectedClassId(classId)
    setActiveFilter(statusFilters[0])
    setSelectedStudentId(null)
    setEditingStudentFactId(null)
    setStudentFactDraft(emptyStudentFactDraft)
    setLiveCells([])
    setPendingStudentFacts(
      classId === 'class-jss2-a' ? fallbackStudentFacts : []
    )
  }

  async function handleSubmitIntent(value: string) {
    pushEvent(`Teacher request: ${value}`)
    setIntentBusy(true)
    try {
      const result = await submitIntent({
        prompt: value,
        role: 'teacher',
        class_id: selectedClass.classId,
      })
      pushEvent(
        `${selectedClass.label} intent plan ${result.plan.plan_id} ready (${result.plan.target_skill_ids.join(', ')})`
      )
      await refresh()
    } catch (err) {
      pushEvent(`Intent failed: ${(err as Error).message}`)
    } finally {
      setIntentBusy(false)
    }
  }

  async function handleApprove(planId: string) {
    pushEvent(`Approving plan ${planId}…`)
    try {
      await approveLearningPlan(planId, {
        class_id: selectedClass.classId,
        reason: 'Teacher dashboard approval',
      })
      pushEvent(`Approved plan ${planId}`)
      await refresh()
    } catch (err) {
      pushEvent(`Approve failed: ${(err as Error).message}`)
    }
  }

  async function handleReject(planId: string) {
    pushEvent(`Rejecting plan ${planId}…`)
    try {
      await rejectLearningPlan(planId, {
        class_id: selectedClass.classId,
        reason: 'Teacher dashboard rejection',
      })
      pushEvent(`Rejected plan ${planId}`)
      await refresh()
    } catch (err) {
      pushEvent(`Reject failed: ${(err as Error).message}`)
    }
  }

  async function handleEditApprove(
    planId: string,
    edits: PendingApprovalPlanEdits,
    reason: string
  ) {
    pushEvent(`Editing and approving plan ${planId}…`)
    try {
      const result = await editAndApproveLearningPlan(planId, {
        class_id: selectedClass.classId,
        reason: reason || 'Teacher dashboard edited approval',
        edits: {
          target_skill_ids: edits.targetSkillIds,
          target_student_ids: edits.targetStudentIds,
          item_types: edits.itemTypes,
          suggested_resources: edits.suggestedResources,
          rationale: edits.rationale,
        },
      })
      pushEvent(
        `Edited and approved plan ${planId} as ${result.edited_plan_id ?? result.plan_id}`
      )
      await refresh()
    } catch (err) {
      pushEvent(`Edit approval failed: ${(err as Error).message}`)
      throw err
    }
  }

  async function handleApproveFact(factId: string) {
    pushEvent(`Approving student fact ${factId}…`)
    try {
      await approveStudentFact(factId, {
        class_id: selectedClass.classId,
        reason: 'Teacher dashboard approval',
      })
      pushEvent(`Approved student fact ${factId}`)
      await refresh()
    } catch (err) {
      pushEvent(`Student fact approval failed: ${(err as Error).message}`)
    }
  }

  async function handleRejectFact(factId: string) {
    pushEvent(`Rejecting student fact ${factId}…`)
    try {
      await rejectStudentFact(factId, {
        class_id: selectedClass.classId,
        reason: 'Teacher dashboard rejection',
      })
      pushEvent(`Rejected student fact ${factId}`)
      await refresh()
    } catch (err) {
      pushEvent(`Student fact rejection failed: ${(err as Error).message}`)
    }
  }

  function startEditStudentFact(record: StudentFactRecord) {
    setEditingStudentFactId(record.id)
    setStudentFactDraft(draftFromStudentFact(record))
  }

  async function handleEditApproveFact(record: StudentFactRecord) {
    const editedValue = studentFactDraft.value.trim()
    const editedEvidence = studentFactDraft.evidence.trim()
    if (!editedValue || !editedEvidence) return

    pushEvent(`Editing and approving student fact ${record.id}…`)
    try {
      await editAndApproveStudentFact(record.id, {
        class_id: selectedClass.classId,
        reason: 'Teacher dashboard edited approval',
        edits: {
          key: studentFactDraft.key.trim() || record.fact.key,
          value: editedValue,
          evidence: editedEvidence,
          student_name: studentFactDraft.studentName.trim() || undefined,
        },
      })
      pushEvent(`Edited and approved student fact ${record.id}`)
      setEditingStudentFactId(null)
      setStudentFactDraft(emptyStudentFactDraft)
      await refresh()
    } catch (err) {
      pushEvent(`Student fact edit approval failed: ${(err as Error).message}`)
    }
  }

  return (
    <div className={styles.shell} data-testid="route-teacher-dashboard">
      <div className={styles.headerRow}>
        <div className={styles.headerCopy}>
          <Text as="h1" className={styles.title}>
            Teacher Mastery Dashboard
          </Text>
          <div className={styles.headerMeta} aria-label="Class context">
            <span className={styles.headerMetaChip}>{selectedClass.label}</span>
            <span className={styles.headerMetaChip}>
              {selectedClass.subject}
            </span>
            <span className={styles.headerMetaChip}>
              {selectedClass.learnerCount} students
            </span>
            <span className={styles.headerMetaChip}>Mastery + uncertainty</span>
            <span className={styles.headerMetaChip}>
              Wulo Academy workspace
            </span>
          </div>
        </div>
        <span className={styles.softBadge}>JSS1-SS3 teacher review</span>
      </div>

      <div
        className={styles.filterBar}
        role="tablist"
        aria-label="Class selector"
      >
        {classOptions.map(option => (
          <button
            key={option.classId}
            type="button"
            role="tab"
            aria-selected={selectedClassId === option.classId}
            className={
              selectedClassId === option.classId
                ? styles.filterBadgeActive
                : styles.filterBadge
            }
            onClick={() => handleSelectClass(option.classId)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div
        className={styles.filterBar}
        role="tablist"
        aria-label="Mastery filter"
      >
        {statusFilters.map(f => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={activeFilter === f}
            className={
              activeFilter === f ? styles.filterBadgeActive : styles.filterBadge
            }
            onClick={() => setActiveFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>

      <div className={styles.twoCol}>
        <Card className={styles.heatmapCard}>
          <CardHeader
            header={<Text weight="semibold">Class heatmap</Text>}
            description={
              <Text size={200}>
                {selectedClass.learnerCount} students across {skillIds.length}{' '}
                maths sub-skills. Each cell shows mastery % (large) and
                uncertainty % (small).
              </Text>
            }
          />
          <div
            className={styles.profilePrompt}
            data-testid="transparent-profile-entry"
          >
            <div className={styles.profilePromptCopy}>
              <Text weight="semibold">Transparent student profile</Text>
              <Text size={200}>
                Open one learner to inspect strengths, gaps, evidence, recent
                responses, voice fluency, and proposed memory facts.
              </Text>
            </div>
            <button
              type="button"
              className={styles.filterBadgeActive}
              disabled={!profileEntryStudent}
              onClick={() =>
                profileEntryStudent &&
                setSelectedStudentId(profileEntryStudent.studentId)
              }
            >
              Open student profile
            </button>
          </div>
          <div className={styles.heatmapScroll}>
            <table
              className={styles.heatmapGrid}
              aria-label={`${selectedClass.label} mastery heatmap`}
            >
              <thead>
                <tr>
                  <th className={styles.th} scope="col">
                    Student
                  </th>
                  {skillIds.map(s => (
                    <th key={s} className={styles.th} scope="col">
                      {skillLabels[s]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map(row => (
                  <tr key={row.studentId}>
                    <td className={styles.nameCell}>{row.name}</td>
                    {skillIds.map(s => {
                      const c = row.cells[s]
                      if (!c) {
                        return (
                          <td
                            key={s}
                            className={styles.cell}
                            style={{
                              backgroundColor: masteryRamp.needsSupport,
                            }}
                          >
                            —
                          </td>
                        )
                      }
                      return (
                        <td
                          key={s}
                          className={styles.cell}
                          style={{
                            backgroundColor: colourForMastery(c.p),
                            color: t.brand.text,
                          }}
                          title={`${row.name} · ${skillLabels[s]} · mastery ${Math.round(
                            c.p * 100
                          )}% · uncertainty ${Math.round(c.u * 100)}%`}
                        >
                          <button
                            type="button"
                            className={styles.cellButton}
                            data-testid={`mastery-cell-${row.studentId}-${s}`}
                            aria-label={`Open profile for ${row.name}, ${skillLabels[s]} mastery`}
                            onClick={() => setSelectedStudentId(row.studentId)}
                          >
                            {Math.round(c.p * 100)}%
                            <span className={styles.cellUncertainty}>
                              ±{Math.round(c.u * 100)}
                            </span>
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.legend}>
            <span>
              <span
                className={styles.legendDot}
                style={{ backgroundColor: masteryRamp.needsSupport }}
              />
              Needs support &lt; 50%
            </span>
            <span>
              <span
                className={styles.legendDot}
                style={{ backgroundColor: masteryRamp.developing }}
              />
              Developing 50–70%
            </span>
            <span>
              <span
                className={styles.legendDot}
                style={{ backgroundColor: masteryRamp.approaching }}
              />
              Approaching 70–85%
            </span>
            <span>
              <span
                className={styles.legendDot}
                style={{ backgroundColor: masteryRamp.secure }}
              />
              Secure &gt; 85%
            </span>
          </div>
          <ProvenanceFooter provenance={provenance} />
        </Card>

        <div className={styles.sidePanel}>
          <div className={styles.classSummary}>
            <Text weight="semibold">Class summary</Text>
            <div className={styles.summaryGrid}>
              <div className={styles.summaryTile}>
                <div className={styles.summaryLabel}>Students</div>
                <div className={styles.summaryValue}>
                  {selectedClass.learnerCount}
                </div>
                <Text size={200}>{selectedClass.learnerCount} students</Text>
              </div>
              <div className={styles.summaryTile}>
                <div className={styles.summaryLabel}>Intervention</div>
                <div className={styles.summaryValue}>
                  {flaggedForInterventionCount}
                </div>
                <Text size={200}>
                  {flaggedForInterventionCount} students flagged for
                  intervention
                </Text>
              </div>
              <div className={styles.summaryTile}>
                <div className={styles.summaryLabel}>Weakest</div>
                <div className={styles.summaryValue}>
                  {weakestSkills.length}
                </div>
                <Text size={200}>weakest sub-skills this week</Text>
              </div>
              <div className={styles.summaryTile}>
                <div className={styles.summaryLabel}>Facts</div>
                <div className={styles.summaryValue}>
                  {proposedStudentFactCount}
                </div>
                <Text size={200}>
                  {proposedStudentFactCount} proposed student facts awaiting
                  approval
                </Text>
              </div>
            </div>
          </div>

          <Card className={styles.auditCard}>
            <CardHeader
              header={
                <Text weight="semibold">Weakest sub-skills this week</Text>
              }
              description={
                <Text size={200}>
                  Sorted by class-average mastery for {selectedClass.label}
                </Text>
              }
            />
            <div
              className={styles.insightList}
              data-testid="weakest-subskills-list"
            >
              {weakestSkills.map(skill => (
                <div key={skill.skillId} className={styles.insightItem}>
                  <div className={styles.insightRow}>
                    <Text weight="semibold">{skill.label}</Text>
                    <Text size={200}>
                      {Math.round(skill.averageMastery * 100)}%
                    </Text>
                  </div>
                  <div className={styles.insightMeta}>
                    {skill.needsSupportCount} student
                    {skill.needsSupportCount === 1 ? '' : 's'} below support
                    threshold
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className={styles.auditCard}>
            <CardHeader
              header={<Text weight="semibold">Teacher-controlled memory</Text>}
              description={
                <Text size={200}>
                  {proposedStudentFactCount} proposed student facts awaiting
                  approval
                </Text>
              }
            />
            <p className={styles.memoryTrustCopy}>
              Proposed facts stay pending until a teacher approves, edits, or
              rejects them; personalization does not happen invisibly.
            </p>
            <div
              className={styles.insightList}
              data-testid="student-fact-approval-list"
            >
              {pendingStudentFacts.map(fact => (
                <div key={fact.id} className={styles.insightItem}>
                  <div className={styles.insightRow}>
                    <Text weight="semibold">
                      {fact.fact.student_name ?? fact.student_id}
                    </Text>
                    <span className={styles.softBadge}>Awaiting approval</span>
                  </div>
                  <div className={styles.insightMeta}>
                    Memory type · {fact.fact.key}
                  </div>
                  <Text size={200}>{fact.fact.value}</Text>
                  <div className={styles.insightMeta}>{fact.fact.evidence}</div>
                  {editingStudentFactId === fact.id ? (
                    <form
                      className={styles.factEditForm}
                      data-testid={`student-fact-edit-${fact.id}`}
                      onSubmit={(event: FormEvent<HTMLFormElement>) => {
                        event.preventDefault()
                        void handleEditApproveFact(fact)
                      }}
                    >
                      <label className={styles.factEditField}>
                        Student name
                        <input
                          className={styles.factEditInput}
                          aria-label={`Edited student name for ${fact.fact.student_name ?? fact.student_id}`}
                          value={studentFactDraft.studentName}
                          onChange={event => {
                            const studentName = event.currentTarget.value
                            setStudentFactDraft(current => ({
                              ...current,
                              studentName,
                            }))
                          }}
                        />
                      </label>
                      <label className={styles.factEditField}>
                        Memory fact
                        <textarea
                          className={styles.factEditTextarea}
                          aria-label={`Edited memory fact for ${fact.fact.student_name ?? fact.student_id}`}
                          value={studentFactDraft.value}
                          onChange={event => {
                            const value = event.currentTarget.value
                            setStudentFactDraft(current => ({
                              ...current,
                              value,
                            }))
                          }}
                        />
                      </label>
                      <label className={styles.factEditField}>
                        Evidence
                        <textarea
                          className={styles.factEditTextarea}
                          aria-label={`Edited evidence for ${fact.fact.student_name ?? fact.student_id}`}
                          value={studentFactDraft.evidence}
                          onChange={event => {
                            const evidence = event.currentTarget.value
                            setStudentFactDraft(current => ({
                              ...current,
                              evidence,
                            }))
                          }}
                        />
                      </label>
                      <div className={styles.factActions}>
                        <button
                          type="submit"
                          className={styles.filterBadgeActive}
                          disabled={
                            studentFactQueueState !== 'live' ||
                            !studentFactDraft.value.trim() ||
                            !studentFactDraft.evidence.trim()
                          }
                        >
                          Save edited fact
                        </button>
                        <button
                          type="button"
                          className={styles.filterBadge}
                          onClick={() => {
                            setEditingStudentFactId(null)
                            setStudentFactDraft(emptyStudentFactDraft)
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className={styles.factActions}>
                      <button
                        type="button"
                        className={styles.filterBadge}
                        disabled={studentFactQueueState !== 'live'}
                        onClick={() => void handleApproveFact(fact.id)}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className={styles.filterBadge}
                        disabled={studentFactQueueState !== 'live'}
                        onClick={() => startEditStudentFact(fact)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className={styles.filterBadge}
                        disabled={studentFactQueueState !== 'live'}
                        onClick={() => void handleRejectFact(fact.id)}
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>

          <div className={styles.intentCard}>
            <Text weight="semibold">Plan an intervention</Text>
            <MultimodalIntentBar
              disabled={intentBusy}
              onSubmitIntent={value => void handleSubmitIntent(value)}
            />
          </div>

          {visiblePlan ? (
            <PendingApprovalCard
              plan={visiblePlan}
              onApprove={id => void handleApprove(id)}
              onReject={id => void handleReject(id)}
              onEditApprove={handleEditApprove}
            />
          ) : (
            <Card className={styles.auditCard}>
              <CardHeader
                header={
                  <Text weight="semibold">No pending plans to review</Text>
                }
                description={
                  <Text size={200}>
                    New plans appear here after diagnostics or teacher planning
                    requests.
                  </Text>
                }
              />
            </Card>
          )}

          <Card className={styles.auditCard}>
            <CardHeader
              header={<Text weight="semibold">Audit events</Text>}
              description={
                <Text size={200}>Recent classroom and approval activity</Text>
              }
            />
            <div className={styles.auditEventList} data-testid="audit-events">
              {auditEvents
                .slice(-10)
                .reverse()
                .map((e, idx) => (
                  <span key={`${idx}-${e}`} className={styles.auditEventItem}>
                    {e}
                  </span>
                ))}
            </div>
          </Card>
        </div>
      </div>

      {/* keep upstream heatmap component referenced for tests that import via demo */}
      <span data-testid="legacy-cells-count" style={{ display: 'none' }}>
        {heatmapCells.length}
      </span>
      <StudentProfileDrawer
        open={Boolean(selectedStudentId)}
        studentId={selectedStudentId}
        fallbackSkills={selectedFallbackSkills}
        onClose={() => setSelectedStudentId(null)}
      />
    </div>
  )
}
