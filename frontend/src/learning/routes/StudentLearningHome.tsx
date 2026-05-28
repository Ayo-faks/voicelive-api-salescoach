import { Text, makeStyles } from '@fluentui/react-components'
import {
  AcademicCapIcon,
  ArrowRightIcon,
  BoltIcon,
  BookOpenIcon,
  BriefcaseIcon,
  CalculatorIcon,
  ChartBarIcon,
  CheckBadgeIcon,
  ChevronRightIcon,
  ClockIcon,
  DocumentTextIcon,
  MicrophoneIcon,
  PlayCircleIcon,
  ShareIcon,
  SparklesIcon,
  WifiIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import { useEffect, useState } from 'react'
import DiagnosticPanel from '../components/DiagnosticPanel'
import {
  scheduleRevisionCards,
  usePushSubscription,
} from '../notifications/usePushSubscription'
import {
  getVoiceConfig,
  submitVoiceFrame,
  type VoiceConfigResponse,
  type VoiceFrameResponse,
} from '../api'
import { pathfinderTokens as t } from '../theme/pathfinder-tokens'

type Activity = {
  id: string
  title: string
  meta: string
  minutes: number
  type: 'check-in' | 'practice' | 'exit-ticket'
  skillId?: string
}

type DemoStep = {
  id: string
  label: string
  title: string
  prompt: string
  helper: string
  icon: typeof CalculatorIcon
  options: Array<{
    id: string
    label: string
    meta?: string
    correct?: boolean
  }>
  voiceText?: string
  adaptation?: {
    title: string
    body: string
    nextStep: DemoStep
  }
}

type DemoAnswer = {
  stepId: string
  optionId: string
  label: string
  correct?: boolean
  syncStatus?: 'local' | 'sent'
}

type AdaptiveMoment = {
  title: string
  body: string
}

type PracticeOption = {
  id: string
  label: string
  meta?: string
  correct?: boolean
}

type RetrievalSlot = {
  id: string
  label: string
  timing: string
  focus: string
}

type PracticeExercise = {
  planId: string
  planTitle: string
  title: string
  prompt: string
  hint: string
  options: PracticeOption[]
  schedule: RetrievalSlot[]
}

type PracticeAnswer = {
  optionId: string
  label: string
  correct: boolean
}

type LearnerSetup = {
  exam: string
  year: string
  subject: string
}

type WeakTopic = {
  skillId: string
  label: string
  mastery: number
  gap: string
  nextAction: string
}

type DailyPlanItem = {
  id: string
  label: string
  minutes: number
  reason: string
}

type CareerPathway = {
  id: string
  title: string
  fit: number
  strength: string
  gap: string
}

type WrongAnswerExplanation = {
  correctAnswer: string
  whyWrong: string
  conceptMissed: string
  simplerExplanation: string
  similarQuestion: string
  revisionAction: string
}

type CareerAnswerPoint = {
  label: string
  body: string
}

type CareerNavigationMoment = {
  question: string
  responseLead: string
  points: CareerAnswerPoint[]
  sources: string[]
}

const todaysPath: Activity[] = [
  {
    id: 'ratio-check',
    title: 'Ratio mini check-in',
    meta: 'Ratio & proportion · adaptive',
    minutes: 5,
    type: 'check-in',
    skillId: 'ratio-proportion',
  },
  {
    id: 'fraction-bar',
    title: 'Fraction bar practice',
    meta: 'Fraction operations · 6 items',
    minutes: 8,
    type: 'practice',
    skillId: 'fraction-operations',
  },
  {
    id: 'exit-ticket',
    title: 'Exit ticket: scaling recipes',
    meta: 'Teacher reviewed',
    minutes: 3,
    type: 'exit-ticket',
    skillId: 'linear-equations',
  },
]

const weeklyTiles: Array<{ label: string; value: string; delta: string }> = [
  { label: 'Sessions', value: '4 / 5', delta: 'On pace' },
  { label: 'Streak', value: '7 days', delta: 'Personal best' },
  { label: 'Mastery', value: '+12%', delta: 'Ratio focus' },
]

const deviceModes = [
  {
    label: 'Desktop web',
    value: 'Full learning workspace',
    detail: 'Diagnostic, practice, career guidance, and teacher status stay visible for classroom or lab use.',
  },
  {
    label: 'Tablet / shared device',
    value: 'Touch or keyboard',
    detail: 'Same flow works with mouse, keyboard, or touch for school device carts and family devices.',
  },
  {
    label: 'Phone / offline',
    value: 'Condensed journey',
    detail: 'The layout collapses for smaller screens and saves answers locally when connectivity drops.',
  },
]

const examOptions = ['WAEC', 'NECO', 'JAMB', 'Junior WAEC']
const yearOptions = ['JSS2', 'JSS3', 'SSS1', 'SSS2', 'SSS3']
const subjectOptions = ['Mathematics', 'English Language', 'Basic Science']

const weakTopicProfile: WeakTopic[] = [
  {
    skillId: 'ratio-proportion',
    label: 'Ratio and proportion',
    mastery: 42,
    gap: 'Scaling both parts of a recipe or table',
    nextAction: 'Practise two worked examples before a timed card.',
  },
  {
    skillId: 'fraction-operations',
    label: 'Fraction operations',
    mastery: 61,
    gap: 'Choosing a common denominator under time pressure',
    nextAction: 'Review one visual fraction bar, then answer three short questions.',
  },
  {
    skillId: 'reading-inference',
    label: 'Reading inference',
    mastery: 68,
    gap: 'Explaining the reason behind a sentence',
    nextAction: 'Read one short passage and underline the clue words.',
  },
]

const dailyRevisionPlan: DailyPlanItem[] = [
  {
    id: 'diagnostic-refresh',
    label: 'Ratio mini diagnostic',
    minutes: 5,
    reason: 'Confirms whether the first weak topic is improving.',
  },
  {
    id: 'mistake-review',
    label: 'Explain one mistake',
    minutes: 4,
    reason: 'Turns a wrong answer into a concept fix.',
  },
  {
    id: 'career-link',
    label: 'Career fit check',
    minutes: 3,
    reason: 'Links today\'s strengths to future pathways without making promises.',
  },
]

const careerPathways: CareerPathway[] = [
  {
    id: 'health-sciences',
    title: 'Health sciences',
    fit: 76,
    strength: 'Careful reading and steady practice habits',
    gap: 'Chemistry and quantitative science need stronger mastery.',
  },
  {
    id: 'data-business',
    title: 'Data and business operations',
    fit: 82,
    strength: 'Ratio, pattern spotting, and spreadsheet-style thinking',
    gap: 'Keep building algebra and English explanation skills.',
  },
  {
    id: 'renewable-energy',
    title: 'Renewable energy technician',
    fit: 74,
    strength: 'Measurement, geometry, and practical problem solving',
    gap: 'Electricity basics and safety vocabulary need review.',
  },
]

const diagnosticWrongAnswerExplanation: WrongAnswerExplanation = {
  correctAnswer: '6 cups',
  whyWrong: '4 cups repeats the rice amount instead of scaling the water by the same factor.',
  conceptMissed: 'Equivalent ratios: both parts must change together.',
  simplerExplanation: 'The rice doubled from 2 cups to 4 cups, so the water also doubles from 3 cups to 6 cups.',
  similarQuestion: 'Try this: 1 cup rice needs 1.5 cups water. What do 2 cups rice need?',
  revisionAction: 'Add ratio scaling to today\'s revision plan.',
}

const practiceWrongAnswerExplanation: WrongAnswerExplanation = {
  correctAnswer: '9 cups',
  whyWrong: 'The rice changed from 2 cups to 6 cups, which is three times larger. The water must also be three times larger.',
  conceptMissed: 'Scale factor in a ratio table.',
  simplerExplanation: 'Find the multiplier first: 2 x 3 = 6. Then use the same multiplier for water: 3 x 3 = 9.',
  similarQuestion: 'A recipe uses 4 cups water for 3 cups rice. How much water for 9 cups rice?',
  revisionAction: 'Put one ratio-table card into tomorrow\'s spaced retrieval.',
}

const ratioScaffoldStep: DemoStep = {
  id: 'adaptive-ratio-scaffold',
  label: 'Adaptive',
  title: 'Same idea, smaller step',
  prompt: 'Pathfinder noticed the ratio slip. If 1 cup rice needs 1.5 cups water, what do 2 cups rice need?',
  helper: 'The next item changed from a new skill to a scaffolded ratio check so you can recover quickly.',
  icon: CalculatorIcon,
  options: [
    { id: '2', label: '2 cups' },
    { id: '3', label: '3 cups', correct: true },
    { id: '4', label: '4 cups' },
  ],
}

const demoDiagnosticSteps: DemoStep[] = [
  {
    id: 'numeracy-ratio',
    label: 'Numeracy',
    title: 'Quick ratio check',
    prompt: '2 cups rice need 3 cups water. If you use 4 cups rice, how many cups water?',
    helper: 'Choose the answer that keeps the same recipe balance.',
    icon: CalculatorIcon,
    options: [
      { id: '4', label: '4 cups' },
      { id: '5', label: '5 cups' },
      { id: '6', label: '6 cups', correct: true },
      { id: '8', label: '8 cups' },
    ],
    adaptation: {
      title: 'Pathfinder adapted the next item',
      body: 'The answer suggests doubling the rice was missed, so the next card stays on ratios and reduces the jump before moving on.',
      nextStep: ratioScaffoldStep,
    },
  },
  {
    id: 'reading-lamp',
    label: 'Reading',
    title: 'One short passage',
    prompt: 'Amina charged the solar lamp before sunset so she could study after dinner. Why did she charge it early?',
    helper: 'Read once, then choose the best reason.',
    icon: BookOpenIcon,
    options: [
      { id: 'rain', label: 'Because rain was coming' },
      { id: 'study', label: 'So she could study later', correct: true },
      { id: 'market', label: 'So she could go to market' },
    ],
  },
  {
    id: 'voice-read-aloud',
    label: 'Voice',
    title: 'Read aloud',
    prompt: 'Read aloud: The small solar lamp helped Amina finish her homework.',
    helper: 'No marks here. Pathfinder queues the sample offline when voice is unavailable.',
    icon: MicrophoneIcon,
    voiceText: 'The small solar lamp helped Amina finish her homework.',
    options: [
      { id: 'read-aloud', label: 'I read it aloud', meta: 'Save or queue sample' },
    ],
  },
  {
    id: 'basic-science-conductor',
    label: 'Subject',
    title: 'Basic Science',
    prompt: 'Which material lets electricity flow best?',
    helper: 'One subject-specific question, not a full paper.',
    icon: AcademicCapIcon,
    options: [
      { id: 'wood', label: 'Wood' },
      { id: 'rubber', label: 'Rubber' },
      { id: 'copper', label: 'Copper', correct: true },
      { id: 'plastic', label: 'Plastic' },
    ],
  },
  {
    id: 'career-interest',
    label: 'Career',
    title: 'Interest check',
    prompt: 'Which activity sounds most interesting today?',
    helper: 'There is no wrong answer. This helps personalise future examples.',
    icon: BriefcaseIcon,
    options: [
      { id: 'build', label: 'Build or fix things' },
      { id: 'explain', label: 'Explain ideas to people' },
      { id: 'design', label: 'Draw or design something' },
      { id: 'investigate', label: 'Investigate how things work' },
    ],
  },
]

const generatedPlanPractice: PracticeExercise = {
  planId: 'plan-jss2-ratio-recovery',
  planTitle: 'Teacher-approved ratio recovery plan',
  title: 'Bite-sized practice exercise',
  prompt: 'A recipe uses 3 cups of water for 2 cups of rice. How many cups of water are needed for 6 cups of rice?',
  hint: 'This is the worked-example step from the approved 1-2 week plan: scale both parts by the same amount.',
  options: [
    { id: '6', label: '6 cups', meta: 'Same as rice' },
    { id: '7', label: '7 cups', meta: 'Add one more' },
    { id: '9', label: '9 cups', meta: 'Scale by 3', correct: true },
    { id: '12', label: '12 cups', meta: 'Double again' },
  ],
  schedule: [
    { id: 'same-day', label: 'Today', timing: '10 minutes after this exercise', focus: 'Try one similar ratio without the hint.' },
    { id: 'tomorrow', label: 'Tomorrow', timing: 'Before the next maths lesson', focus: 'Answer a fresh recipe-ratio card.' },
    { id: 'weekend', label: 'In 4 days', timing: 'Short weekend retrieval', focus: 'Mix ratio with fraction-bar review.' },
  ],
}

const careerNavigationMoment: CareerNavigationMoment = {
  question: "Can I still become a doctor if I'm weak in chemistry?",
  responseLead:
    'It may still be possible, but Pathfinder should not promise an outcome. Medicine usually needs strong chemistry and biology, so the honest answer is: keep the goal open while you work on the chemistry gap and compare nearby health pathways.',
  points: [
    {
      label: 'What is realistic',
      body: 'A weak chemistry score today does not close the door, but medical entry is competitive and usually expects strong science grades over time.',
    },
    {
      label: 'What needs work',
      body: 'Focus next on atoms, bonding, acids and bases, and quantitative chemistry. Ask your teacher for a 2-week repair plan and retest one small topic at a time.',
    },
    {
      label: 'What alternatives exist',
      body: 'You can also explore nursing, pharmacy technology, medical laboratory science, public health, health data, or biomedical engineering while chemistry improves.',
    },
    {
      label: 'Next safe step',
      body: 'Discuss this with a teacher or counsellor before choosing subjects. Pathfinder can show options and gaps, not guarantee admission or a career outcome.',
    },
  ],
  sources: [
    'Grounded in science-subject requirements',
    'Uses current mastery snapshot: chemistry needs support',
    'Counsellor review recommended for career decisions',
  ],
}

const useStyles = makeStyles({
  root: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 320px',
    gap: '24px',
    '@media (max-width: 1100px)': {
      gridTemplateColumns: 'minmax(0, 1fr)',
    },
  },
  main: { display: 'grid', gap: '20px', minWidth: 0 },
  side: {
    display: 'grid',
    gap: '16px',
    alignContent: 'start',
    '@media (max-width: 1100px)': { gridTemplateColumns: '1fr' },
  },
  hero: {
    position: 'relative',
    padding: '32px',
    borderRadius: t.radius.xxl,
    backgroundColor: t.brand.ink,
    color: t.brand.onInk,
    boxShadow: t.surface.raisedShadow,
    overflow: 'hidden',
    '@media (max-width: 720px)': { padding: '24px' },
  },
  heroEyebrow: {
    fontSize: '0.72rem',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    opacity: 0.65,
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
  },
  heroTitle: {
    fontFamily: t.font.display,
    fontSize: '2.4rem',
    lineHeight: 1.05,
    fontWeight: 600,
    letterSpacing: '-0.025em',
    margin: '10px 0 8px',
    color: t.brand.onInk,
    '@media (max-width: 720px)': { fontSize: '1.9rem' },
  },
  heroSub: {
    fontSize: '1rem',
    opacity: 0.82,
    maxWidth: '46ch',
    lineHeight: 1.5,
  },
  heroPills: {
    marginTop: '22px',
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
  },
  heroPill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 12px',
    borderRadius: t.radius.pill,
    backgroundColor: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.16)',
    fontSize: '0.78rem',
    fontWeight: 500,
    letterSpacing: '-0.01em',
  },
  heroCta: {
    marginTop: '24px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '10px',
    padding: '12px 18px',
    borderRadius: t.radius.pill,
    backgroundColor: t.brand.onInk,
    color: t.brand.ink,
    fontWeight: 600,
    fontSize: '0.92rem',
    cursor: 'pointer',
    border: 'none',
    fontFamily: 'inherit',
    transition: 'transform .15s ease, box-shadow .15s ease',
    ':hover': {
      transform: 'translateY(-1px)',
      boxShadow: '0 10px 24px rgba(0,0,0,0.18)',
    },
  },
  voiceButton: {
    appearance: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '36px',
    paddingRight: '16px',
    paddingLeft: '16px',
    borderRadius: t.radius.pill,
    border: '1px solid rgba(255,255,255,0.22)',
    backgroundColor: 'rgba(255,255,255,0.08)',
    color: t.brand.onInk,
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.84rem',
    fontWeight: 800,
    ':disabled': {
      cursor: 'not-allowed',
      opacity: 0.55,
    },
  },
  card: {
    backgroundColor: t.surface.card,
    border: t.surface.hairline,
    borderRadius: t.radius.xl,
    padding: '20px 22px',
    boxShadow: t.surface.raisedShadow,
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '10px',
    flexWrap: 'wrap',
    marginBottom: '14px',
  },
  cardTitle: {
    fontFamily: t.font.display,
    fontSize: '1.05rem',
    fontWeight: 600,
    letterSpacing: '-0.01em',
    color: t.brand.text,
  },
  cardCaption: {
    fontSize: '0.78rem',
    color: t.brand.textTertiary,
  },
  softBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    flexShrink: 0,
    minHeight: '24px',
    borderRadius: t.radius.pill,
    border: t.surface.hairline,
    paddingRight: '10px',
    paddingLeft: '10px',
    backgroundColor: t.surface.cardMuted,
    color: t.brand.textSecondary,
    fontSize: '0.72rem',
    fontWeight: 700,
    lineHeight: 1.35,
    whiteSpace: 'normal',
    overflowWrap: 'anywhere',
  },
  banner: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 16px',
    borderRadius: t.radius.md,
    backgroundColor: t.brand.surfaceMuted,
    border: t.surface.hairline,
    color: t.brand.textSecondary,
    fontSize: '0.85rem',
  },
  pathList: {
    display: 'grid',
    gap: '10px',
  },
  pathRow: {
    display: 'grid',
    gridTemplateColumns: '40px 1fr auto auto',
    alignItems: 'center',
    gap: '14px',
    padding: '14px 16px',
    borderRadius: t.radius.md,
    backgroundColor: t.brand.surfaceMuted,
    boxShadow: `inset 0 0 0 1px ${t.brand.line}`,
    cursor: 'pointer',
    ':hover': {
      backgroundColor: t.brand.lineSoft,
    },
  },
  pathIcon: {
    width: '40px',
    height: '40px',
    borderRadius: t.radius.md,
    display: 'grid',
    placeItems: 'center',
    backgroundColor: t.brand.ink,
    color: t.brand.onInk,
  },
  pathTitle: {
    display: 'grid',
    gap: '2px',
  },
  pathTitleText: {
    fontWeight: 600,
    color: t.brand.text,
    fontSize: '0.94rem',
  },
  textAction: {
    appearance: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    justifySelf: 'start',
    minHeight: '32px',
    marginTop: '12px',
    paddingRight: '13px',
    paddingLeft: '13px',
    borderRadius: t.radius.pill,
    border: t.surface.hairline,
    backgroundColor: t.brand.surface,
    color: t.brand.text,
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.78rem',
    fontWeight: 800,
  },
  setupGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: '12px',
    '@media (max-width: 720px)': { gridTemplateColumns: '1fr' },
  },
  selectField: {
    display: 'grid',
    gap: '7px',
  },
  selectLabel: {
    fontSize: '0.72rem',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: t.brand.textTertiary,
    fontWeight: 700,
  },
  select: {
    width: '100%',
    minHeight: '46px',
    borderRadius: t.radius.lg,
    border: `1px solid ${t.brand.line}`,
    backgroundColor: t.brand.surface,
    color: t.brand.text,
    paddingRight: '14px',
    paddingLeft: '14px',
    font: 'inherit',
    fontSize: '0.92rem',
    fontWeight: 800,
  },
  insightGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: '12px',
    '@media (max-width: 960px)': { gridTemplateColumns: '1fr' },
  },
  insightCard: {
    display: 'grid',
    gap: '10px',
    padding: '16px',
    borderRadius: t.radius.xl,
    border: t.surface.hairline,
    backgroundColor: t.brand.surface,
    boxShadow: t.surface.raisedShadow,
  },
  meterTrack: {
    width: '100%',
    height: '8px',
    borderRadius: t.radius.pill,
    backgroundColor: t.brand.lineSoft,
    overflow: 'hidden',
  },
  meterFill: {
    height: '100%',
    borderRadius: t.radius.pill,
    backgroundColor: t.brand.ink,
  },
  planGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: '10px',
    '@media (max-width: 720px)': { gridTemplateColumns: '1fr' },
  },
  pathwayGrid: {
    display: 'grid',
    gap: '10px',
  },
  pathwayCard: {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr auto',
    gap: '12px',
    alignItems: 'start',
    padding: '14px 16px',
    borderRadius: t.radius.lg,
    border: t.surface.hairline,
    backgroundColor: t.surface.cardMuted,
    '@media (max-width: 560px)': { gridTemplateColumns: '1fr' },
  },
  sharePanel: {
    display: 'grid',
    gap: '12px',
    padding: '16px',
    borderRadius: t.radius.xl,
    border: t.surface.hairline,
    backgroundColor: t.surface.cardMuted,
  },
  shareActions: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap',
  },
  modalBackdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 50,
    display: 'grid',
    placeItems: 'center',
    padding: '20px',
    backgroundColor: 'rgba(10,10,10,0.42)',
  },
  modal: {
    width: 'min(720px, 100%)',
    maxHeight: 'calc(100vh - 40px)',
    overflowY: 'auto',
    display: 'grid',
    gap: '14px',
    padding: '22px',
    borderRadius: t.radius.xxl,
    border: '1px solid rgba(255,255,255,0.68)',
    backgroundColor: t.brand.surface,
    boxShadow: '0 24px 70px rgba(0,0,0,0.28)',
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '12px',
    alignItems: 'flex-start',
  },
  modalClose: {
    appearance: 'none',
    width: '36px',
    height: '36px',
    borderRadius: t.radius.pill,
    border: t.surface.hairline,
    backgroundColor: t.surface.cardMuted,
    color: t.brand.text,
    display: 'grid',
    placeItems: 'center',
    cursor: 'pointer',
  },
  explanationGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '10px',
    '@media (max-width: 640px)': { gridTemplateColumns: '1fr' },
  },
  explanationTile: {
    display: 'grid',
    gap: '5px',
    padding: '13px 14px',
    borderRadius: t.radius.lg,
    border: t.surface.hairline,
    backgroundColor: t.surface.cardMuted,
  },
  pathMeta: {
    fontSize: '0.78rem',
    color: t.brand.textTertiary,
  },
  minutes: {
    fontSize: '0.78rem',
    color: t.brand.textSecondary,
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
  },
  demoCard: {
    display: 'grid',
    gap: '16px',
    padding: '18px',
    borderRadius: t.radius.xxl,
    border: t.surface.hairline,
    backgroundColor: t.brand.surface,
    boxShadow: t.surface.raisedShadow,
  },
  demoHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '12px',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
  },
  demoTitle: {
    fontFamily: t.font.display,
    fontSize: '1.24rem',
    fontWeight: 800,
    color: t.brand.text,
    letterSpacing: '0',
  },
  demoProgress: {
    display: 'flex',
    gap: '6px',
    flexWrap: 'wrap',
  },
  demoDot: {
    width: '34px',
    height: '8px',
    borderRadius: t.radius.pill,
    backgroundColor: t.brand.lineSoft,
  },
  demoDotActive: {
    width: '34px',
    height: '8px',
    borderRadius: t.radius.pill,
    backgroundColor: t.brand.ink,
  },
  demoPromptCard: {
    display: 'grid',
    gap: '12px',
    padding: '18px',
    borderRadius: t.radius.xl,
    backgroundColor: t.surface.cardMuted,
    border: t.surface.hairline,
  },
  adaptiveMoment: {
    display: 'grid',
    gap: '8px',
    padding: '14px 16px',
    borderRadius: t.radius.lg,
    border: `1px solid ${t.brand.ink}`,
    backgroundColor: t.brand.surfaceMuted,
    boxShadow: '0 10px 24px rgba(15, 42, 58, 0.08)',
  },
  adaptiveMomentBody: {
    margin: 0,
    color: t.brand.textSecondary,
    fontSize: '0.88rem',
    lineHeight: 1.45,
  },
  demoPromptHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  demoPromptIcon: {
    width: '42px',
    height: '42px',
    borderRadius: t.radius.md,
    display: 'grid',
    placeItems: 'center',
    backgroundColor: t.brand.ink,
    color: t.brand.onInk,
    flexShrink: 0,
  },
  demoPrompt: {
    margin: 0,
    color: t.brand.text,
    fontFamily: t.font.display,
    fontSize: 'clamp(1.2rem, 5vw, 1.55rem)',
    lineHeight: 1.18,
    fontWeight: 800,
    letterSpacing: '0',
  },
  demoHelper: {
    margin: 0,
    color: t.brand.textSecondary,
    fontSize: '0.9rem',
    lineHeight: 1.45,
  },
  demoOptions: {
    display: 'grid',
    gap: '10px',
  },
  demoOption: {
    appearance: 'none',
    width: '100%',
    minHeight: '58px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    padding: '14px 16px',
    borderRadius: t.radius.lg,
    border: `1px solid ${t.brand.line}`,
    backgroundColor: t.brand.surface,
    color: t.brand.text,
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '1rem',
    fontWeight: 800,
    textAlign: 'left',
    boxShadow: '0 8px 18px rgba(15, 42, 58, 0.08)',
  },
  demoOptionMeta: {
    color: t.brand.textTertiary,
    fontSize: '0.76rem',
    fontWeight: 700,
  },
  demoFooter: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '10px',
    alignItems: 'center',
    flexWrap: 'wrap',
    color: t.brand.textSecondary,
    fontSize: '0.82rem',
  },
  demoCompleteGrid: {
    display: 'grid',
    gap: '8px',
  },
  practiceCard: {
    display: 'grid',
    gap: '16px',
    padding: '18px',
    borderRadius: t.radius.xxl,
    border: t.surface.hairline,
    backgroundColor: t.brand.surface,
    boxShadow: t.surface.raisedShadow,
  },
  practicePromptCard: {
    display: 'grid',
    gap: '10px',
    padding: '16px',
    borderRadius: t.radius.xl,
    border: t.surface.hairline,
    backgroundColor: t.surface.cardMuted,
  },
  practicePrompt: {
    margin: 0,
    color: t.brand.text,
    fontFamily: t.font.display,
    fontSize: 'clamp(1.16rem, 5vw, 1.48rem)',
    fontWeight: 800,
    lineHeight: 1.2,
    letterSpacing: '0',
  },
  practiceOptions: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '10px',
    '@media (max-width: 520px)': { gridTemplateColumns: '1fr' },
  },
  practiceOption: {
    appearance: 'none',
    minHeight: '64px',
    display: 'grid',
    gap: '4px',
    alignContent: 'center',
    padding: '14px 16px',
    borderRadius: t.radius.lg,
    border: `1px solid ${t.brand.line}`,
    backgroundColor: t.brand.surface,
    color: t.brand.text,
    cursor: 'pointer',
    font: 'inherit',
    textAlign: 'left',
    boxShadow: '0 8px 18px rgba(15, 42, 58, 0.08)',
  },
  practiceOptionSelected: {
    appearance: 'none',
    minHeight: '64px',
    display: 'grid',
    gap: '4px',
    alignContent: 'center',
    padding: '14px 16px',
    borderRadius: t.radius.lg,
    border: `2px solid ${t.brand.ink}`,
    backgroundColor: t.brand.ink,
    color: t.brand.onInk,
    cursor: 'pointer',
    font: 'inherit',
    textAlign: 'left',
    boxShadow: '0 10px 24px rgba(15, 42, 58, 0.16)',
  },
  practiceOptionLabel: {
    fontSize: '1rem',
    fontWeight: 850,
  },
  practiceOptionMeta: {
    fontSize: '0.76rem',
    fontWeight: 700,
    opacity: 0.72,
  },
  feedbackCard: {
    display: 'grid',
    gap: '8px',
    padding: '14px 16px',
    borderRadius: t.radius.lg,
    border: t.surface.hairline,
    backgroundColor: t.surface.cardMuted,
  },
  retrievalList: {
    display: 'grid',
    gap: '8px',
    margin: 0,
    padding: 0,
    listStyleType: 'none',
  },
  retrievalItem: {
    display: 'grid',
    gap: '3px',
    padding: '10px 12px',
    borderRadius: t.radius.md,
    border: t.surface.hairline,
    backgroundColor: t.brand.surface,
  },
  careerAskGrid: {
    display: 'grid',
    gap: '10px',
  },
  careerInput: {
    width: '100%',
    minHeight: '46px',
    borderRadius: t.radius.lg,
    border: `1px solid ${t.brand.line}`,
    boxSizing: 'border-box',
    paddingRight: '14px',
    paddingLeft: '14px',
    color: t.brand.text,
    backgroundColor: t.brand.surface,
    font: 'inherit',
    fontSize: '0.95rem',
    fontWeight: 700,
  },
  careerActions: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '10px',
    '@media (max-width: 520px)': { gridTemplateColumns: '1fr' },
  },
  careerAction: {
    appearance: 'none',
    minHeight: '48px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    paddingRight: '14px',
    paddingLeft: '14px',
    borderRadius: t.radius.pill,
    border: `1px solid ${t.brand.ink}`,
    backgroundColor: t.brand.ink,
    color: t.brand.onInk,
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.9rem',
    fontWeight: 850,
  },
  careerActionSecondary: {
    appearance: 'none',
    minHeight: '48px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    paddingRight: '14px',
    paddingLeft: '14px',
    borderRadius: t.radius.pill,
    border: t.surface.hairline,
    backgroundColor: t.brand.surface,
    color: t.brand.text,
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.9rem',
    fontWeight: 850,
  },
  careerPointList: {
    display: 'grid',
    gap: '8px',
    margin: 0,
    padding: 0,
    listStyleType: 'none',
  },
  careerSourceRow: {
    display: 'flex',
    gap: '6px',
    flexWrap: 'wrap',
  },
  weekGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '12px',
    '@media (max-width: 520px)': { gridTemplateColumns: '1fr' },
  },
  weekTile: {
    padding: '16px',
    borderRadius: t.radius.lg,
    backgroundColor: t.brand.surfaceMuted,
    border: t.surface.hairline,
    display: 'grid',
    gap: '4px',
  },
  weekLabel: {
    fontSize: '0.72rem',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: t.brand.textTertiary,
    fontWeight: 600,
  },
  weekValue: {
    fontFamily: t.font.display,
    fontSize: '1.5rem',
    fontWeight: 600,
    letterSpacing: '-0.02em',
    color: t.brand.text,
  },
  weekDelta: { fontSize: '0.78rem', color: t.brand.textSecondary },
  deviceOverviewCard: {
    display: 'grid',
    gap: '14px',
    padding: '18px',
    borderRadius: t.radius.xl,
    border: t.surface.hairline,
    backgroundColor: t.brand.surface,
    boxShadow: t.surface.raisedShadow,
  },
  deviceOverviewGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: '12px',
    '@media (max-width: 860px)': { gridTemplateColumns: '1fr' },
  },
  deviceModeTile: {
    display: 'grid',
    gap: '5px',
    padding: '13px 14px',
    borderRadius: t.radius.lg,
    border: t.surface.hairline,
    backgroundColor: t.surface.cardMuted,
  },
  deviceModeValue: {
    color: t.brand.text,
    fontSize: '0.95rem',
    fontWeight: 850,
  },
  deviceModeDetail: {
    color: t.brand.textSecondary,
    fontSize: '0.8rem',
    lineHeight: 1.45,
  },
  demoInteractionGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.15fr) minmax(260px, 0.85fr)',
    gap: '14px',
    alignItems: 'start',
    '@media (max-width: 780px)': { gridTemplateColumns: '1fr' },
  },
  demoPromptStack: {
    display: 'grid',
    gap: '12px',
  },
  practiceInteractionGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(260px, 0.9fr)',
    gap: '14px',
    alignItems: 'start',
    '@media (max-width: 780px)': { gridTemplateColumns: '1fr' },
  },
  sideHeading: {
    fontSize: '0.72rem',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: t.brand.textTertiary,
    fontWeight: 600,
    margin: '4px 0',
  },
  sideRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
    padding: '10px 0',
    borderBottom: t.surface.hairline,
    ':last-child': { borderBottom: 'none' },
  },
  sideRowIcon: {
    width: '18px',
    height: '18px',
    color: t.brand.text,
    flexShrink: 0,
    marginTop: '2px',
  },
  sideRowText: {
    fontSize: '0.85rem',
    color: t.brand.text,
    fontWeight: 500,
    lineHeight: 1.35,
  },
  sideRowMeta: {
    fontSize: '0.74rem',
    color: t.brand.textTertiary,
    marginTop: '2px',
  },
})

type StudentLearningHomeProps = {
  studentId?: string | null
  /** When true, skip the Web Push permission prompt (kid role — needs parental consent). */
  pushConsentDeferred?: boolean
}

export default function StudentLearningHome({ studentId, pushConsentDeferred }: StudentLearningHomeProps) {
  const styles = useStyles()
  const [learnerSetup, setLearnerSetup] = useState<LearnerSetup>({
    exam: examOptions[0],
    year: yearOptions[0],
    subject: subjectOptions[0],
  })
  const [activeSkill, setActiveSkill] = useState<string | null>(null)
  const [panelKey, setPanelKey] = useState(0)
  const [checkInActive, setCheckInActive] = useState(false)
  const [demoActive, setDemoActive] = useState(false)
  const [demoCompleted, setDemoCompleted] = useState(false)
  const [demoStepQueue, setDemoStepQueue] = useState<DemoStep[]>(demoDiagnosticSteps)
  const [demoStepIndex, setDemoStepIndex] = useState(0)
  const [demoAnswers, setDemoAnswers] = useState<DemoAnswer[]>([])
  const [demoSyncNote, setDemoSyncNote] = useState<string | null>(null)
  const [adaptiveMoment, setAdaptiveMoment] = useState<AdaptiveMoment | null>(null)
  const [demoVoiceBusy, setDemoVoiceBusy] = useState(false)
  const [practiceAnswer, setPracticeAnswer] = useState<PracticeAnswer | null>(null)
  const [wrongAnswerExplanation, setWrongAnswerExplanation] = useState<WrongAnswerExplanation | null>(null)
  const [revisionPlanAdded, setRevisionPlanAdded] = useState(false)
  const pushSubscription = usePushSubscription({
    userId: studentId ?? 'demo-student',
    consentDeferred: Boolean(pushConsentDeferred),
  })
  const [shareStatus, setShareStatus] = useState<string | null>(null)
  const [careerQuestion, setCareerQuestion] = useState(careerNavigationMoment.question)
  const [careerAnswerVisible, setCareerAnswerVisible] = useState(false)
  const [careerAskMode, setCareerAskMode] = useState<'text' | 'voice' | null>(null)
  const [completed, setCompleted] = useState(false)
  const [voiceConfig, setVoiceConfig] = useState<VoiceConfigResponse | null>(null)
  const [voiceResult, setVoiceResult] = useState<VoiceFrameResponse | null>(null)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [voiceBusy, setVoiceBusy] = useState(false)
  const today = new Date('2026-05-21')
  const formatted = today.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  useEffect(() => {
    let cancelled = false
    getVoiceConfig()
      .then(cfg => {
        if (!cancelled) setVoiceConfig(cfg)
      })
      .catch(() => {
        if (!cancelled) setVoiceConfig({ enabled: false, transport: 'flask-sock', offline_fallback: 'queued_multilingual_voice_frame' })
      })
    return () => {
      cancelled = true
    }
  }, [])

  function startCheckIn(skillId?: string) {
    setDemoActive(false)
    setDemoCompleted(false)
    setActiveSkill(skillId ?? null)
    setCompleted(false)
    setCheckInActive(true)
    setPanelKey(value => value + 1)
  }

  function startDemoDiagnostic() {
    setActiveSkill(null)
    setCheckInActive(false)
    setCompleted(false)
    setDemoCompleted(false)
    setDemoStepQueue(demoDiagnosticSteps)
    setDemoStepIndex(0)
    setDemoAnswers([])
    setDemoSyncNote(null)
    setAdaptiveMoment(null)
    setWrongAnswerExplanation(null)
    setDemoActive(true)
  }

  function saveDemoLocally(answers: DemoAnswer[], stepCount: number) {
    try {
      window.localStorage.setItem(
        'pathfinder-demo-diagnostic:last',
        JSON.stringify({
          studentId: studentId ?? 'demo-student',
          completedAt: new Date().toISOString(),
          stepCount,
          setup: learnerSetup,
          answers,
        })
      )
    } catch {
      // Demo diagnostics are offline-friendly; storage failures should not block the flow.
    }
  }

  async function handleDemoAnswer(step: DemoStep, option: DemoStep['options'][number]) {
    const canScoreStep = step.options.some(candidate => candidate.correct)
    const shouldAdapt = canScoreStep && !option.correct && Boolean(step.adaptation)
    let nextQueue = demoStepQueue
    if (shouldAdapt && step.adaptation) {
      const nextStepAlreadyInserted = demoStepQueue[demoStepIndex + 1]?.id === step.adaptation.nextStep.id
      nextQueue = nextStepAlreadyInserted
        ? demoStepQueue
        : [
            ...demoStepQueue.slice(0, demoStepIndex + 1),
            step.adaptation.nextStep,
            ...demoStepQueue.slice(demoStepIndex + 1),
          ]
      setDemoStepQueue(nextQueue)
      setAdaptiveMoment({ title: step.adaptation.title, body: step.adaptation.body })
      setWrongAnswerExplanation(diagnosticWrongAnswerExplanation)
    } else {
      setAdaptiveMoment(null)
    }

    const isVoiceStep = Boolean(step.voiceText)
    const answerRecord: DemoAnswer = {
      stepId: step.id,
      optionId: option.id,
      label: option.label,
      correct: option.correct,
      syncStatus: isVoiceStep ? 'local' : undefined,
    }
    const nextAnswers = [...demoAnswers, answerRecord]
    setDemoAnswers(nextAnswers)

    if (isVoiceStep) {
      setDemoVoiceBusy(true)
      try {
        if (voiceConfig?.enabled) {
          await submitVoiceFrame({
            actor_id: studentId ?? undefined,
            mode: 'text',
            payload: step.voiceText ?? step.prompt,
            lang: 'en-NG',
          })
          answerRecord.syncStatus = 'sent'
          setDemoSyncNote('Voice sample saved for teacher review.')
        } else {
          setDemoSyncNote('Voice sample queued locally and will sync when voice is available.')
        }
      } catch {
        setDemoSyncNote('Voice sample queued locally and will sync when connection returns.')
      } finally {
        setDemoVoiceBusy(false)
      }
    }

    if (demoStepIndex >= nextQueue.length - 1) {
      saveDemoLocally(nextAnswers, nextQueue.length)
      setDemoActive(false)
      setDemoCompleted(true)
      return
    }
    setDemoStepIndex(index => index + 1)
  }

  async function startVoiceCheckIn() {
    setVoiceBusy(true)
    setVoiceError(null)
    try {
      const result = await submitVoiceFrame({
        actor_id: studentId ?? undefined,
        mode: 'text',
        payload: "Bawo ni teacher, I want to practise ratio.",
        lang: 'en-NG',
      })
      setVoiceResult(result)
    } catch (err) {
      setVoiceError((err as Error).message)
    } finally {
      setVoiceBusy(false)
    }
  }

  function handlePracticeAnswer(option: PracticeOption) {
    const answerRecord: PracticeAnswer = {
      optionId: option.id,
      label: option.label,
      correct: Boolean(option.correct),
    }
    setPracticeAnswer(answerRecord)
    if (!answerRecord.correct) {
      setWrongAnswerExplanation(practiceWrongAnswerExplanation)
    }
    try {
      window.localStorage.setItem(
        'pathfinder-practice-loop:last',
        JSON.stringify({
          studentId: studentId ?? 'demo-student',
          planId: generatedPlanPractice.planId,
          setup: learnerSetup,
          answeredAt: new Date().toISOString(),
          answer: answerRecord,
          spacedRetrieval: generatedPlanPractice.schedule,
        })
      )
    } catch {
      // Local scheduling is best-effort in the offline demo path.
    }
  }

  function updateLearnerSetup(field: keyof LearnerSetup, value: string) {
    setLearnerSetup(current => ({ ...current, [field]: value }))
  }

  async function addWeaknessToPlan() {
    setRevisionPlanAdded(true)
    try {
      window.localStorage.setItem(
        'pathfinder-revision-plan:last-added',
        JSON.stringify({
          studentId: studentId ?? 'demo-student',
          addedAt: new Date().toISOString(),
          setup: learnerSetup,
          weakness: wrongAnswerExplanation?.conceptMissed ?? 'Ratio scaling',
          action: wrongAnswerExplanation?.revisionAction ?? 'Add to daily revision plan.',
        })
      )
    } catch {
      // Revision-plan edits remain visible even if local storage is unavailable.
    }

    // W8 — persist the 3-card spaced-retrieval schedule and request push permission.
    const topicId = generatedPlanPractice.planId
    const now = Date.now()
    const minutes = (m: number) => new Date(now + m * 60_000).toISOString()
    const days = (d: number) => new Date(now + d * 24 * 60 * 60_000).toISOString()
    const dueByLabel: Record<string, string> = {
      Today: minutes(10),
      Tomorrow: days(1),
      'In 4 days': days(4),
    }
    try {
      await scheduleRevisionCards({
        userId: studentId ?? 'demo-student',
        cards: generatedPlanPractice.schedule.map(s => ({
          topicId,
          label: `${s.label} \u00b7 ${s.timing}`,
          dueAt: dueByLabel[s.label] ?? minutes(10),
          payload: { focus: s.focus },
        })),
      })
    } catch {
      // Best-effort; the local snapshot above keeps the UI honest.
    }
    if (!pushConsentDeferred) {
      try {
        await pushSubscription.enable()
      } catch {
        // Permission denial / unsupported browser is silent here.
      }
    }
  }

  const parentSummaryText = `Your Pathfinder update: ${learnerSetup.exam} ${learnerSetup.year} ${learnerSetup.subject}. Current focus: Ratio and proportion at 42% mastery. Today: 5 min diagnostic, explain one mistake, practise one similar question. Career signals: data/business and health sciences are worth exploring while chemistry and algebra improve.`

  function handleParentShare() {
    setShareStatus('Parent summary ready to share.')
    try {
      window.localStorage.setItem(
        'pathfinder-parent-summary:last',
        JSON.stringify({
          studentId: studentId ?? 'demo-student',
          generatedAt: new Date().toISOString(),
          setup: learnerSetup,
          summary: parentSummaryText,
        })
      )
    } catch {
      // Share summary still renders for the user even if local persistence fails.
    }
  }

  const whatsAppHref = `https://wa.me/?text=${encodeURIComponent(parentSummaryText)}`

  async function handleCareerAsk(mode: 'text' | 'voice') {
    const question = careerQuestion.trim() || careerNavigationMoment.question
    setCareerQuestion(question)
    setCareerAskMode(mode)
    setCareerAnswerVisible(true)
    try {
      if (mode === 'voice' && voiceConfig?.enabled) {
        await submitVoiceFrame({
          actor_id: studentId ?? undefined,
          mode: 'text',
          payload: question,
          lang: 'en-NG',
        })
      }
      window.localStorage.setItem(
        'pathfinder-career-navigation:last',
        JSON.stringify({
          studentId: studentId ?? 'demo-student',
          askedAt: new Date().toISOString(),
          mode,
          question,
          response: careerNavigationMoment,
        })
      )
    } catch {
      // Career navigation remains available offline; voice/text sync can retry later.
    }
  }

  return (
    <section className={styles.root} data-testid="route-student-home">
      <div className={styles.main}>
        <article className={styles.hero}>
          <span className={styles.heroEyebrow}>
            <SparklesIcon style={{ width: 14, height: 14 }} aria-hidden="true" />
            {formatted}
          </span>
          <h1 className={styles.heroTitle}>Hi, let's keep your streak going.</h1>
          <p className={styles.heroSub}>
            Your {learnerSetup.exam} {learnerSetup.subject} path is 42% mastered. Pathfinder works on desktop web,
            tablet, and phone, so one short check-in today can happen in class,
            at home, or offline.
          </p>
          <div className={styles.heroPills}>
            <span className={styles.heroPill}>
              <BoltIcon style={{ width: 14, height: 14 }} aria-hidden="true" />
              7-day streak
            </span>
            <span className={styles.heroPill}>English · Yoruba voice</span>
            <span className={styles.heroPill}>{learnerSetup.year} · {learnerSetup.subject}</span>
            <span className={styles.heroPill}>Free for now · no payment step</span>
          </div>
          <button
            type="button"
            className={styles.heroCta}
            onClick={startDemoDiagnostic}
            data-testid="start-checkin"
          >
            <PlayCircleIcon style={{ width: 18, height: 18 }} aria-hidden="true" />
            Start 5-step demo
            <ArrowRightIcon style={{ width: 16, height: 16 }} aria-hidden="true" />
          </button>
          {voiceConfig?.enabled && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                type="button"
                className={styles.voiceButton}
                onClick={startVoiceCheckIn}
                disabled={voiceBusy}
                data-testid="start-voice-checkin"
              >
                {voiceBusy ? 'Preparing voice check-in…' : 'Voice check-in'}
              </button>
              {voiceResult && (
                <div data-testid="voice-frame-result" style={{ fontSize: '0.8rem', opacity: 0.85 }}>
                  Voice response saved for sync.
                </div>
              )}
              {voiceError && (
                <div data-testid="voice-frame-error" style={{ fontSize: '0.8rem', color: '#ffb4b4' }}>
                  Voice unavailable: {voiceError}
                </div>
              )}
            </div>
          )}
        </article>

        <article className={styles.card} data-testid="b2c-learner-setup">
          <div className={styles.cardHeader}>
            <div>
              <Text className={styles.cardTitle}>Choose your exam path</Text>
              <p className={styles.demoHelper} style={{ margin: '4px 0 0' }}>
                Select exam, class/year, and subject before the short diagnostic starts.
              </p>
            </div>
            <span className={styles.softBadge}>B2C free launch</span>
          </div>
          <div className={styles.setupGrid}>
            <label className={styles.selectField}>
              <span className={styles.selectLabel}>Exam</span>
              <select
                className={styles.select}
                value={learnerSetup.exam}
                onChange={event => updateLearnerSetup('exam', event.currentTarget.value)}
                aria-label="Select exam"
              >
                {examOptions.map(option => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className={styles.selectField}>
              <span className={styles.selectLabel}>Class / year</span>
              <select
                className={styles.select}
                value={learnerSetup.year}
                onChange={event => updateLearnerSetup('year', event.currentTarget.value)}
                aria-label="Select class or year"
              >
                {yearOptions.map(option => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className={styles.selectField}>
              <span className={styles.selectLabel}>Subject area</span>
              <select
                className={styles.select}
                value={learnerSetup.subject}
                onChange={event => updateLearnerSetup('subject', event.currentTarget.value)}
                aria-label="Select subject"
              >
                {subjectOptions.map(option => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
          </div>
        </article>

        <article className={styles.deviceOverviewCard} data-testid="cross-device-learner-workspace">
          <div className={styles.cardHeader}>
            <div>
              <Text className={styles.cardTitle}>Web, desktop, tablet, and phone</Text>
              <p className={styles.demoHelper} style={{ margin: '4px 0 0' }}>
                Same learner workflow; the layout widens on desktop and condenses on smaller screens.
              </p>
            </div>
            <span className={styles.softBadge}>Responsive web app</span>
          </div>
          <div className={styles.deviceOverviewGrid}>
            {deviceModes.map(mode => (
              <div key={mode.label} className={styles.deviceModeTile}>
                <span className={styles.weekLabel}>{mode.label}</span>
                <span className={styles.deviceModeValue}>{mode.value}</span>
                <span className={styles.deviceModeDetail}>{mode.detail}</span>
              </div>
            ))}
          </div>
        </article>

        {demoActive && (() => {
          const step = demoStepQueue[demoStepIndex] ?? demoDiagnosticSteps[0]
          const StepIcon = step.icon
          return (
            <article className={styles.demoCard} data-testid="short-demo-diagnostic">
              <div className={styles.demoHeader}>
                <div>
                  <Text className={styles.demoTitle}>3-5 minute demo diagnostic</Text>
                  <p className={styles.demoHelper}>Five short signals. Keyboard, mouse, or touch. Works offline.</p>
                </div>
                <div className={styles.demoProgress} aria-label="Demo diagnostic progress">
                  {demoStepQueue.map((item, index) => (
                    <span
                      key={item.id}
                      className={index <= demoStepIndex ? styles.demoDotActive : styles.demoDot}
                      data-testid={`demo-progress-${index + 1}`}
                    />
                  ))}
                </div>
              </div>

              <div className={styles.demoInteractionGrid}>
                <div className={styles.demoPromptStack}>
                  <div className={styles.demoPromptCard}>
                    <div className={styles.demoPromptHeader}>
                      <div className={styles.demoPromptIcon} aria-hidden="true">
                        <StepIcon style={{ width: 24, height: 24 }} />
                      </div>
                      <div>
                        <span className={styles.softBadge}>{step.label}</span>
                        <Text className={styles.cardTitle}>{step.title}</Text>
                      </div>
                    </div>
                    <p className={styles.demoPrompt}>{step.prompt}</p>
                    <p className={styles.demoHelper}>{step.helper}</p>
                  </div>

                  {adaptiveMoment && (
                    <div className={styles.adaptiveMoment} data-testid="adaptive-moment">
                      <span className={styles.softBadge}>Adaptive moment</span>
                      <Text className={styles.cardTitle}>{adaptiveMoment.title}</Text>
                      <p className={styles.adaptiveMomentBody}>{adaptiveMoment.body}</p>
                    </div>
                  )}
                </div>

                <div className={styles.demoOptions}>
                  {step.options.map(option => (
                    <button
                      key={option.id}
                      type="button"
                      className={styles.demoOption}
                      onClick={() => void handleDemoAnswer(step, option)}
                      disabled={demoVoiceBusy}
                    >
                      <span>{option.label}</span>
                      <span className={styles.demoOptionMeta}>{option.meta ?? 'Select'}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.demoFooter}>
                <span data-testid="demo-step-count">Step {demoStepIndex + 1} of {demoStepQueue.length}</span>
                <span>{demoSyncNote ?? 'Saved locally first, synced when online.'}</span>
              </div>
            </article>
          )
        })()}

              {demoCompleted && (
                <article className={styles.demoCard} data-testid="short-demo-complete">
                  <div className={styles.demoCompleteGrid}>
                    <Text className={styles.demoTitle}>Demo diagnostic complete</Text>
                    <p className={styles.demoHelper}>
                      Numeracy, reading, voice, subject knowledge, and career interest signals are saved locally for teacher review.
                    </p>
                    <div className={styles.demoProgress}>
                      {demoAnswers.map(answer => (
                        <span key={`${answer.stepId}-${answer.optionId}`} className={styles.softBadge}>
                          {answer.label}
                        </span>
                      ))}
                    </div>
                  </div>
                </article>
              )}

              {checkInActive && (activeSkill !== null || panelKey > 0) && (
                <DiagnosticPanel
                  key={panelKey}
                  skillId={activeSkill ?? undefined}
                  studentId={studentId}
                  onCompleted={() => setCompleted(true)}
                />
              )}

              {completed && (
                <div className={styles.banner} data-testid="diagnostic-pending-banner">
                  <SparklesIcon style={{ width: 18, height: 18 }} aria-hidden="true" />
                  Plan suggestion sent to your teacher for approval.
                </div>
              )}

              <div className={styles.banner}>
                <WifiIcon style={{ width: 18, height: 18 }} aria-hidden="true" />
                Yoruba voice practice is ready and will sync when connection returns.
              </div>

              <article className={styles.card} data-testid="weak-topic-profile">
                <div className={styles.cardHeader}>
                  <div>
                    <Text className={styles.cardTitle}>Weak-topic profile</Text>
                    <p className={styles.demoHelper} style={{ margin: '4px 0 0' }}>
                      Pathfinder turns the diagnostic into the next best topics to repair.
                    </p>
                  </div>
                  <span className={styles.softBadge}>After diagnostic</span>
                </div>
                <div className={styles.insightGrid}>
                  {weakTopicProfile.map(topic => (
                    <div key={topic.skillId} className={styles.insightCard}>
                      <span className={styles.weekLabel}>{topic.mastery}% mastered</span>
                      <Text className={styles.cardTitle}>{topic.label}</Text>
                      <div className={styles.meterTrack} aria-label={`${topic.label} mastery`}>
                        <span className={styles.meterFill} style={{ width: `${topic.mastery}%` }} />
                      </div>
                      <span className={styles.demoHelper}>{topic.gap}</span>
                      <button type="button" className={styles.textAction} onClick={() => startCheckIn(topic.skillId)}>
                        Practise this topic
                      </button>
                    </div>
                  ))}
                </div>
              </article>

              <article className={styles.card} data-testid="daily-revision-plan">
                <div className={styles.cardHeader}>
                  <div>
                    <Text className={styles.cardTitle}>Daily revision plan</Text>
                    <p className={styles.demoHelper} style={{ margin: '4px 0 0' }}>
                      Built from weak topics, wrong answers, and the selected exam path.
                    </p>
                  </div>
                  <span className={styles.softBadge}>12 min today</span>
                </div>
                <div className={styles.planGrid}>
                  {dailyRevisionPlan.map(item => (
                    <div key={item.id} className={styles.insightCard}>
                      <span className={styles.weekLabel}>{item.minutes} min</span>
                      <Text className={styles.cardTitle}>{item.label}</Text>
                      <span className={styles.demoHelper}>{item.reason}</span>
                    </div>
                  ))}
                  {revisionPlanAdded && (
                    <div className={styles.insightCard} data-testid="revision-plan-added">
                      <span className={styles.weekLabel}>Added from mistake</span>
                      <Text className={styles.cardTitle}>Ratio table repair</Text>
                      <span className={styles.demoHelper}>One similar question has been added to tomorrow's retrieval slot.</span>
                    </div>
                  )}
                </div>
              </article>

              <article className={styles.practiceCard} data-testid="plan-practice-exercise">
                <div className={styles.demoHeader}>
                  <div>
                    <span className={styles.softBadge}>From generated plan</span>
                    <Text className={styles.demoTitle}>{generatedPlanPractice.title}</Text>
                    <p className={styles.demoHelper}>{generatedPlanPractice.planTitle}</p>
                  </div>
                  <span className={styles.softBadge}>2 min</span>
                </div>

                <div className={styles.practiceInteractionGrid}>
                  <div className={styles.practicePromptCard}>
                    <p className={styles.practicePrompt}>{generatedPlanPractice.prompt}</p>
                    <p className={styles.demoHelper}>{generatedPlanPractice.hint}</p>
                  </div>

                  <div className={styles.practiceOptions}>
                    {generatedPlanPractice.options.map(option => (
                      <button
                        key={option.id}
                        type="button"
                        className={practiceAnswer?.optionId === option.id ? styles.practiceOptionSelected : styles.practiceOption}
                        onClick={() => handlePracticeAnswer(option)}
                        disabled={Boolean(practiceAnswer)}
                      >
                        <span className={styles.practiceOptionLabel}>{option.label}</span>
                        <span className={styles.practiceOptionMeta}>{option.meta ?? 'Choose answer'}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {practiceAnswer && (
                  <div className={styles.feedbackCard} data-testid="practice-feedback">
                    <span className={styles.softBadge}>Immediate feedback</span>
                    <Text className={styles.cardTitle}>
                      {practiceAnswer.correct ? 'Correct - the plan is working.' : 'Not quite - scale both parts by 3.'}
                    </Text>
                    {!practiceAnswer.correct && (
                      <button
                        type="button"
                        className={styles.textAction}
                        onClick={() => setWrongAnswerExplanation(practiceWrongAnswerExplanation)}
                      >
                        Explain my mistake
                      </button>
                    )}
                    <p className={styles.demoHelper}>
                      {practiceAnswer.correct
                        ? '2 cups of rice became 6 cups, so 3 cups of water becomes 9 cups.'
                        : 'The worked example says keep the rice-water ratio: 2 -> 6 is x3, so 3 -> 9.'}
                    </p>
                    <span className={styles.softBadge}>Spaced retrieval scheduled</span>
                    <ul className={styles.retrievalList} data-testid="spaced-retrieval-schedule">
                      {generatedPlanPractice.schedule.map(slot => (
                        <li key={slot.id} className={styles.retrievalItem}>
                          <Text weight="semibold">{slot.label} · {slot.timing}</Text>
                          <span className={styles.demoHelper}>{slot.focus}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </article>

              <article className={styles.card} data-testid="career-pathway-suggestions">
                <div className={styles.cardHeader}>
                  <div>
                    <Text className={styles.cardTitle}>Pathways linked to strengths</Text>
                    <p className={styles.demoHelper} style={{ margin: '4px 0 0' }}>
                      Guidance stays exploratory: strengths, gaps, and what to work on next.
                    </p>
                  </div>
                  <span className={styles.softBadge}>Exploratory guidance</span>
                </div>
                <div className={styles.pathwayGrid}>
                  {careerPathways.map(pathway => (
                    <div key={pathway.id} className={styles.pathwayCard}>
                      <div className={styles.pathIcon} aria-hidden="true">
                        <BriefcaseIcon style={{ width: 20, height: 20 }} />
                      </div>
                      <div className={styles.pathTitle}>
                        <span className={styles.pathTitleText}>{pathway.title}</span>
                        <span className={styles.pathMeta}>Strength: {pathway.strength}</span>
                        <span className={styles.pathMeta}>Gap to close: {pathway.gap}</span>
                      </div>
                      <span className={styles.softBadge}>{pathway.fit}% fit</span>
                    </div>
                  ))}
                </div>
              </article>

              <article className={styles.practiceCard} data-testid="career-navigation-moment">
                <div className={styles.demoHeader}>
                  <div>
                    <span className={styles.softBadge}>Career Navigator</span>
                    <Text className={styles.demoTitle}>Ask about a pathway</Text>
                    <p className={styles.demoHelper}>Voice or text. Grounded guidance, not a promise.</p>
                  </div>
                  <BriefcaseIcon style={{ width: 28, height: 28, color: t.brand.text }} aria-hidden="true" />
                </div>

                <div className={styles.careerAskGrid}>
                  <input
                    className={styles.careerInput}
                    aria-label="Career question"
                    value={careerQuestion}
                    onChange={event => setCareerQuestion(event.currentTarget.value)}
                  />
                  <div className={styles.careerActions}>
                    <button
                      type="button"
                      className={styles.careerAction}
                      onClick={() => void handleCareerAsk('text')}
                    >
                      <BriefcaseIcon style={{ width: 18, height: 18 }} aria-hidden="true" />
                      Ask by text
                    </button>
                    <button
                      type="button"
                      className={styles.careerActionSecondary}
                      onClick={() => void handleCareerAsk('voice')}
                    >
                      <MicrophoneIcon style={{ width: 18, height: 18 }} aria-hidden="true" />
                      Ask by voice
                    </button>
                  </div>
                </div>

                {careerAnswerVisible && (
                  <div className={styles.feedbackCard} data-testid="career-navigation-answer">
                    <div className={styles.demoHeader}>
                      <span className={styles.softBadge}>{careerAskMode === 'voice' ? 'Voice question queued' : 'Text question answered'}</span>
                      <span className={styles.softBadge}>No outcome guarantee</span>
                    </div>
                    <Text className={styles.cardTitle}>Can I still become a doctor?</Text>
                    <p className={styles.demoHelper}>{careerNavigationMoment.responseLead}</p>
                    <ul className={styles.careerPointList}>
                      {careerNavigationMoment.points.map(point => (
                        <li key={point.label} className={styles.retrievalItem}>
                          <Text weight="semibold">{point.label}</Text>
                          <span className={styles.demoHelper}>{point.body}</span>
                        </li>
                      ))}
                    </ul>
                    <div className={styles.careerSourceRow} aria-label="Career answer grounding">
                      {careerNavigationMoment.sources.map(source => (
                        <span key={source} className={styles.softBadge}>{source}</span>
                      ))}
                    </div>
                  </div>
                )}
              </article>

        <article className={styles.card} data-testid="parent-share-summary">
          <div className={styles.cardHeader}>
            <div>
              <Text className={styles.cardTitle}>Parent progress summary</Text>
              <p className={styles.demoHelper} style={{ margin: '4px 0 0' }}>
                A short shareable update for parents or guardians, built for WhatsApp.
              </p>
            </div>
            <DocumentTextIcon style={{ width: 26, height: 26, color: t.brand.text }} aria-hidden="true" />
          </div>
          <div className={styles.sharePanel}>
            <p className={styles.demoHelper} style={{ margin: 0 }}>{parentSummaryText}</p>
            <div className={styles.shareActions}>
              <button type="button" className={styles.careerAction} onClick={handleParentShare}>
                <ShareIcon style={{ width: 18, height: 18 }} aria-hidden="true" />
                Prepare parent summary
              </button>
              <a className={styles.careerActionSecondary} href={whatsAppHref} target="_blank" rel="noreferrer">
                <ShareIcon style={{ width: 18, height: 18 }} aria-hidden="true" />
                Invite on WhatsApp
              </a>
            </div>
            {shareStatus && <span className={styles.softBadge}>{shareStatus}</span>}
          </div>
        </article>

        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <Text className={styles.cardTitle}>Today's path</Text>
            <Text className={styles.cardCaption}>~16 min total · 3 steps</Text>
          </div>
          <div className={styles.pathList}>
            {todaysPath.map(item => (
              <button
                key={item.id}
                type="button"
                className={styles.pathRow}
                style={{ textAlign: 'left', font: 'inherit' }}
                onClick={() => startCheckIn(item.skillId)}
                data-testid={`path-row-${item.id}`}
              >
                <div className={styles.pathIcon} aria-hidden="true">
                  <PlayCircleIcon style={{ width: 20, height: 20 }} />
                </div>
                <div className={styles.pathTitle}>
                  <span className={styles.pathTitleText}>{item.title}</span>
                  <span className={styles.pathMeta}>{item.meta}</span>
                </div>
                <span className={styles.minutes}>
                  <ClockIcon style={{ width: 14, height: 14 }} aria-hidden="true" />
                  {item.minutes} min
                </span>
                <ChevronRightIcon
                  style={{ width: 18, height: 18, color: t.brand.textTertiary }}
                  aria-hidden="true"
                />
              </button>
            ))}
          </div>
        </article>

        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <Text className={styles.cardTitle}>This week</Text>
            <Text className={styles.cardCaption}>Mon — Sun · progress updated daily</Text>
          </div>
          <div className={styles.weekGrid}>
            {weeklyTiles.map(tile => (
              <div key={tile.label} className={styles.weekTile}>
                <span className={styles.weekLabel}>{tile.label}</span>
                <span className={styles.weekValue}>{tile.value}</span>
                <span className={styles.weekDelta}>{tile.delta}</span>
              </div>
            ))}
          </div>
        </article>
      </div>

      <aside className={styles.side} aria-label="Learner side panel">
        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <Text className={styles.cardTitle}>Up next</Text>
            <span className={styles.softBadge}>Adaptive</span>
          </div>
          <p style={{ fontSize: '0.88rem', color: t.brand.textSecondary, lineHeight: 1.5, margin: 0 }}>
            Linear equations · introduce slope using ratios you've practiced.
          </p>
          <button
            type="button"
            className={styles.textAction}
            onClick={() => startCheckIn('linear-equations')}
            data-testid="preview-path"
          >
            Preview path
          </button>
        </article>

        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <Text className={styles.cardTitle}>Recent feedback</Text>
            <Text className={styles.cardCaption}>From your teacher</Text>
          </div>
          <div className={styles.sideRow}>
            <CheckBadgeIcon className={styles.sideRowIcon} aria-hidden="true" />
            <div>
              <div className={styles.sideRowText}>"Strong work on fraction bars."</div>
              <div className={styles.sideRowMeta}>Mrs. Adebayo · 2 days ago</div>
            </div>
          </div>
          <div className={styles.sideRow}>
            <SparklesIcon className={styles.sideRowIcon} aria-hidden="true" />
            <div>
              <div className={styles.sideRowText}>Approved for ratio recovery group</div>
              <div className={styles.sideRowMeta}>Counsellor sign-off · last week</div>
            </div>
          </div>
        </article>

        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <Text className={styles.cardTitle}>Trust</Text>
            <span className={styles.softBadge}>All gates green</span>
          </div>
          <p style={{ fontSize: '0.82rem', color: t.brand.textSecondary, lineHeight: 1.5, margin: 0 }}>
            Every recommendation is teacher-reviewed. Evidence and activity log
            available in Trust & Safety.
          </p>
        </article>
      </aside>

      {wrongAnswerExplanation && (
        <div className={styles.modalBackdrop} role="presentation" data-testid="wrong-answer-modal-backdrop">
          <dialog
            open
            className={styles.modal}
            aria-modal="true"
            aria-labelledby="wrong-answer-modal-title"
            data-testid="wrong-answer-explanation-modal"
          >
            <div className={styles.modalHeader}>
              <div>
                <span className={styles.softBadge}>Wrong answer explanation</span>
                <h2 id="wrong-answer-modal-title" className={styles.demoTitle} style={{ margin: '8px 0 0' }}>
                  Explain my mistake
                </h2>
              </div>
              <button
                type="button"
                className={styles.modalClose}
                aria-label="Close explanation"
                onClick={() => setWrongAnswerExplanation(null)}
              >
                <XMarkIcon style={{ width: 18, height: 18 }} aria-hidden="true" />
              </button>
            </div>
            <div className={styles.explanationGrid}>
              <div className={styles.explanationTile}>
                <span className={styles.weekLabel}>Correct answer</span>
                <Text className={styles.cardTitle}>{wrongAnswerExplanation.correctAnswer}</Text>
              </div>
              <div className={styles.explanationTile}>
                <span className={styles.weekLabel}>Why your answer was wrong</span>
                <span className={styles.demoHelper}>{wrongAnswerExplanation.whyWrong}</span>
              </div>
              <div className={styles.explanationTile}>
                <span className={styles.weekLabel}>Concept you missed</span>
                <span className={styles.demoHelper}>{wrongAnswerExplanation.conceptMissed}</span>
              </div>
              <div className={styles.explanationTile}>
                <span className={styles.weekLabel}>Simpler explanation</span>
                <span className={styles.demoHelper}>{wrongAnswerExplanation.simplerExplanation}</span>
              </div>
              <div className={styles.explanationTile}>
                <span className={styles.weekLabel}>Try another similar question</span>
                <span className={styles.demoHelper}>{wrongAnswerExplanation.similarQuestion}</span>
              </div>
              <div className={styles.explanationTile}>
                <span className={styles.weekLabel}>Add this weakness to my revision plan</span>
                <span className={styles.demoHelper}>{wrongAnswerExplanation.revisionAction}</span>
              </div>
            </div>
            <div className={styles.shareActions}>
              <button type="button" className={styles.careerAction} onClick={addWeaknessToPlan}>
                <ChartBarIcon style={{ width: 18, height: 18 }} aria-hidden="true" />
                Add weakness to revision plan
              </button>
              <button type="button" className={styles.careerActionSecondary} onClick={() => startCheckIn('ratio-proportion')}>
                Try similar question
              </button>
            </div>
          </dialog>
        </div>
      )}
    </section>
  )
}
