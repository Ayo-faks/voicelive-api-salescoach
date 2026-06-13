import { Text, makeStyles } from '@fluentui/react-components'
import {
  AcademicCapIcon,
  ArrowRightIcon,
  BookOpenIcon,
  BriefcaseIcon,
  CalculatorIcon,
  ChartBarIcon,
  ChevronRightIcon,
  ClockIcon,
  DocumentDuplicateIcon,
  DocumentTextIcon,
  MicrophoneIcon,
  PlayCircleIcon,
  ShareIcon,
  SparklesIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import DiagnosticPanel from '../components/DiagnosticPanel'
import LearnerTutorFullscreen, {
  type TutorPresentationMode,
  type TutorVoiceSnapshot,
} from '../components/LearnerTutorFullscreen'
import type { LearnerFocusItem } from '../contexts/LearnerContext'
import PracticeFullscreen from '../components/PracticeFullscreen'
import {
  scheduleRevisionCards,
  usePushSubscription,
} from '../notifications/usePushSubscription'
import {
  fetchLearnerPlan,
  fetchLearnerCareers,
  getVoiceConfig,
  submitVoiceFrame,
  type VoiceConfigResponse,
  type VoiceFrameResponse,
} from '../api'
import { pathfinderTokens as t } from '../theme/pathfinder-tokens'
import type { LearnerSetup } from '../hooks/useLearnerSetup'
import { useLearnerProfile } from '../hooks/useLearnerProfile'
import { useDisclosureState } from '../hooks/useDisclosureState'
import { useWeeklyStats } from '../hooks/useWeeklyStats'
import { logEvent } from '../lib/telemetry'
import {
  deriveActionableStatCards,
  type ActionableStatCard,
} from '../lib/actionableStats'
import { deriveHomeChips, type HomeChip } from '../lib/homeChips'
import {
  loadPendingExercise,
  type PendingExercise,
} from '../lib/pendingExercise'
import { useAskSurface } from '../contexts/AskSurfaceContext'
import { copyParentSummary, shareParentSummary } from '../lib/parent-share'
import { featureFlags } from '../../utils/featureFlags'
import { useOnboarding } from '../../onboarding/context'
import { requestReplayTour } from '../../onboarding/bus'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../../services/api'
import type { SafetyConfig } from '../../types'

type Activity = {
  id: string
  title: string
  meta: string
  minutes: number
  type: 'check-in' | 'practice' | 'exit-ticket'
  skillId?: string
  subject?: string
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

const fallbackTodaysPath: Activity[] = [
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

type WeeklyTile = { label: string; value: string; delta: string }

// Placeholders shown while the real per-learner stats load, and the honest
// empty state shown on error. Neither invents progress.
const weeklyLoadingTiles: WeeklyTile[] = [
  { label: 'Sessions', value: '…', delta: 'Loading' },
  { label: 'Streak', value: '…', delta: 'Loading' },
  { label: 'Mastery', value: '…', delta: 'Loading' },
]
const weeklyEmptyTiles: WeeklyTile[] = [
  { label: 'Sessions', value: '0 / 5', delta: 'No sessions yet' },
  { label: 'Streak', value: '0 days', delta: 'Start a streak' },
  { label: 'Mastery', value: '—', delta: 'Practise to see progress' },
]

/** Derive the three "This week" tiles from real per-learner stats. Cold-start
 * (no history) yields the honest empty state rather than fabricated numbers. */
function deriveWeeklyTiles(stats: {
  sessions: { completed: number; target: number }
  streak_days: number
  mastery_delta_pct: number
  mastery_focus_label: string
}): WeeklyTile[] {
  const { completed, target } = stats.sessions
  const streak = stats.streak_days
  const focus = stats.mastery_focus_label
  const hasData = completed > 0 || streak > 0 || focus !== ''
  if (!hasData) return weeklyEmptyTiles

  const sessionsDelta =
    completed === 0
      ? 'No sessions yet'
      : completed >= target
        ? 'On pace'
        : `${target - completed} to go`

  const streakValue = `${streak} day${streak === 1 ? '' : 's'}`
  const streakDelta =
    streak === 0
      ? 'Start a streak'
      : streak >= 7
        ? 'On a roll'
        : 'Keep it going'

  const pct = Math.round(stats.mastery_delta_pct)
  const masteryValue = focus === '' && pct === 0 ? '—' : `${pct > 0 ? '+' : ''}${pct}%`
  const masteryDelta = focus !== '' ? focus : 'Mastery shift'

  return [
    { label: 'Sessions', value: `${completed} / ${target}`, delta: sessionsDelta },
    { label: 'Streak', value: streakValue, delta: streakDelta },
    { label: 'Mastery', value: masteryValue, delta: masteryDelta },
  ]
}


const examOptions = ['WAEC', 'NECO', 'JAMB', 'Junior WAEC']
const yearOptions = ['JSS2', 'JSS3', 'SS1', 'SS2', 'SS3']
const subjectOptions = [
  'Mathematics',
  'English Language',
  'Basic Science',
  'Biology',
  'Chemistry',
  'Physics',
  'Agricultural Science',
  'Economics',
  'Government',
  'History',
  'Literature',
  'Computer Science',
  'Data Processing',
]

const fallbackWeakTopicProfile: WeakTopic[] = [
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
    nextAction:
      'Review one visual fraction bar, then answer three short questions.',
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
    reason:
      "Links today's strengths to future pathways without making promises.",
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
  whyWrong:
    '4 cups repeats the rice amount instead of scaling the water by the same factor.',
  conceptMissed: 'Equivalent ratios: both parts must change together.',
  simplerExplanation:
    'The rice doubled from 2 cups to 4 cups, so the water also doubles from 3 cups to 6 cups.',
  similarQuestion:
    'Try this: 1 cup rice needs 1.5 cups water. What do 2 cups rice need?',
  revisionAction: "Add ratio scaling to today's revision plan.",
}

const practiceWrongAnswerExplanation: WrongAnswerExplanation = {
  correctAnswer: '9 cups',
  whyWrong:
    'The rice changed from 2 cups to 6 cups, which is three times larger. The water must also be three times larger.',
  conceptMissed: 'Scale factor in a ratio table.',
  simplerExplanation:
    'Find the multiplier first: 2 x 3 = 6. Then use the same multiplier for water: 3 x 3 = 9.',
  similarQuestion:
    'A recipe uses 4 cups water for 3 cups rice. How much water for 9 cups rice?',
  revisionAction: "Put one ratio-table card into tomorrow's spaced retrieval.",
}

const ratioScaffoldStep: DemoStep = {
  id: 'adaptive-ratio-scaffold',
  label: 'Adaptive',
  title: 'Same idea, smaller step',
  prompt:
    'Wulo Academy noticed the ratio slip. If 1 cup rice needs 1.5 cups water, what do 2 cups rice need?',
  helper:
    'The next item changed from a new skill to a scaffolded ratio check so you can recover quickly.',
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
    prompt:
      '2 cups rice need 3 cups water. If you use 4 cups rice, how many cups water?',
    helper: 'Choose the answer that keeps the same recipe balance.',
    icon: CalculatorIcon,
    options: [
      { id: '4', label: '4 cups' },
      { id: '5', label: '5 cups' },
      { id: '6', label: '6 cups', correct: true },
      { id: '8', label: '8 cups' },
    ],
    adaptation: {
      title: 'Wulo Academy adapted the next item',
      body: 'The answer suggests doubling the rice was missed, so the next card stays on ratios and reduces the jump before moving on.',
      nextStep: ratioScaffoldStep,
    },
  },
  {
    id: 'reading-lamp',
    label: 'Reading',
    title: 'One short passage',
    prompt:
      'Amina charged the solar lamp before sunset so she could study after dinner. Why did she charge it early?',
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
    prompt:
      'Read aloud: The small solar lamp helped Amina finish her homework.',
    helper:
      'No marks here. Wulo Academy queues the sample offline when voice is unavailable.',
    icon: MicrophoneIcon,
    voiceText: 'The small solar lamp helped Amina finish her homework.',
    options: [
      {
        id: 'read-aloud',
        label: 'I read it aloud',
        meta: 'Save or queue sample',
      },
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
  prompt:
    'A recipe uses 3 cups of water for 2 cups of rice. How many cups of water are needed for 6 cups of rice?',
  hint: 'This is the worked-example step from the approved 1-2 week plan: scale both parts by the same amount.',
  options: [
    { id: '6', label: '6 cups', meta: 'Same as rice' },
    { id: '7', label: '7 cups', meta: 'Add one more' },
    { id: '9', label: '9 cups', meta: 'Scale by 3', correct: true },
    { id: '12', label: '12 cups', meta: 'Double again' },
  ],
  schedule: [
    {
      id: 'same-day',
      label: 'Today',
      timing: '10 minutes after this exercise',
      focus: 'Try one similar ratio without the hint.',
    },
    {
      id: 'tomorrow',
      label: 'Tomorrow',
      timing: 'Before the next maths lesson',
      focus: 'Answer a fresh recipe-ratio card.',
    },
    {
      id: 'weekend',
      label: 'In 4 days',
      timing: 'Short weekend retrieval',
      focus: 'Mix ratio with fraction-bar review.',
    },
  ],
}

const useStyles = makeStyles({
  root: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    gap: 'var(--pf-space-xl)',
    width: '100%',
    maxWidth: 'none',
    marginRight: 'auto',
    marginLeft: 'auto',
    '@media (max-width: 1100px)': {
      gridTemplateColumns: 'minmax(0, 1fr)',
    },
    '@media (max-width: 560px)': {
      paddingBottom: '154px',
    },
    '@media (max-width: 360px)': {
      paddingBottom: '154px',
    },
  },
  main: { display: 'grid', gap: 'var(--pf-space-xl)', minWidth: 0 },
  side: {
    display: 'none',
    gap: 'var(--pf-space-lg)',
    alignContent: 'start',
    position: 'sticky',
    top: 'var(--pf-space-xxl)',
    '@media (max-width: 1100px)': { gridTemplateColumns: '1fr' },
  },
  hero: {
    position: 'relative',
    padding: 0,
    borderRadius: t.radius.sm,
    backgroundColor: 'transparent',
    color: 'var(--pf-text)',
    border: 'none',
    boxShadow: 'none',
    overflow: 'visible',
    minHeight: 'auto',
    '@media (max-width: 720px)': { padding: 0 },
  },
  heroLayout: {
    display: 'grid',
    gap: 'var(--pf-space-xl)',
  },
  heroLeft: {
    minWidth: 0,
    display: 'grid',
    gap: 'var(--pf-space-lg)',
  },
  heroOrbWrap: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    '@media (max-width: 900px)': {
      width: '100%',
    },
  },
  heroOrbStage: {
    position: 'relative',
    width: '220px',
    height: '220px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    appearance: 'none',
    backgroundColor: 'transparent',
    borderTop: 'none',
    borderRight: 'none',
    borderBottom: 'none',
    borderLeft: 'none',
    padding: 0,
    cursor: 'pointer',
    fontFamily: 'inherit',
    color: 'inherit',
    ':focus-visible': {
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: 'var(--pf-hero-focus)',
      outlineOffset: '8px',
      borderRadius: '999px',
    },
    '@media (max-width: 900px)': {
      width: '180px',
      height: '180px',
      justifySelf: 'center',
    },
    '@media (max-width: 480px)': {
      width: '150px',
      height: '150px',
    },
  },
  heroOrbBig: {
    position: 'relative',
    width: '180px',
    height: '180px',
    borderRadius: '999px',
    background:
      'radial-gradient(circle at 30% 26%, #ffffff 0%, #e9ebf3 22%, #7d8aa3 55%, #1a1f2e 100%)',
    boxShadow:
      '0 0 40px rgba(180,200,255,0.45), 0 0 80px rgba(120,150,220,0.3), inset 0 0 24px rgba(255,255,255,0.4), inset 0 -10px 24px rgba(0,0,0,0.55)',
    animationName: {
      '0%, 100%': {
        transform: 'scale(1)',
        boxShadow:
          '0 0 40px rgba(180,200,255,0.45), 0 0 80px rgba(120,150,220,0.3), inset 0 0 24px rgba(255,255,255,0.4), inset 0 -10px 24px rgba(0,0,0,0.55)',
      },
      '50%': {
        transform: 'scale(1.05)',
        boxShadow:
          '0 0 60px rgba(200,220,255,0.7), 0 0 120px rgba(140,170,240,0.5), inset 0 0 30px rgba(255,255,255,0.55), inset 0 -10px 24px rgba(0,0,0,0.55)',
      },
    },
    animationDuration: '3200ms',
    animationIterationCount: 'infinite',
    animationTimingFunction: 'ease-in-out',
    '@media (max-width: 900px)': { width: '140px', height: '140px' },
    '@media (max-width: 480px)': { width: '120px', height: '120px' },
    '@media (prefers-reduced-motion: reduce)': { animationName: 'none' },
  },
  heroOrbBigHalo: {
    position: 'absolute',
    inset: '-40px',
    borderRadius: '999px',
    pointerEvents: 'none',
    background:
      'radial-gradient(circle, rgba(170,200,255,0.35) 0%, rgba(170,200,255,0.12) 45%, rgba(170,200,255,0) 70%)',
    animationName: {
      '0%, 100%': { opacity: 0.6, transform: 'scale(1)' },
      '50%': { opacity: 1, transform: 'scale(1.18)' },
    },
    animationDuration: '3200ms',
    animationIterationCount: 'infinite',
    animationTimingFunction: 'ease-in-out',
    '@media (prefers-reduced-motion: reduce)': { animationName: 'none' },
  },
  heroEyebrow: {
    fontSize: '0.72rem',
    letterSpacing: '0',
    textTransform: 'uppercase',
    color: 'var(--pf-text-tertiary)',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    fontWeight: 700,
  },
  heroTitle: {
    fontFamily: t.font.display,
    fontSize: '1.5rem',
    lineHeight: 1.12,
    fontWeight: 600,
    letterSpacing: '0',
    margin: 0,
    color: 'var(--pf-text)',
    '@media (max-width: 720px)': { fontSize: '1.3rem' },
  },
  heroSub: {
    fontSize: '0.9rem',
    color: 'var(--pf-text-secondary)',
    maxWidth: '46ch',
    lineHeight: 1.35,
    margin: 0,
  },
  heroActions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '10px',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 'var(--pf-space-md)',
    borderTop: 'var(--pf-hairline)',
    '@media (max-width: 560px)': {
      position: 'fixed',
      right: '12px',
      bottom: '78px',
      left: '12px',
      zIndex: 35,
      display: 'grid',
      gridTemplateColumns: '1fr',
      gap: '8px',
      alignItems: 'center',
      padding: '8px',
      border: 'var(--pf-hairline)',
      borderRadius: t.radius.pill,
      backgroundColor: 'var(--pf-surface)',
      boxShadow: 'var(--pf-shadow-card-elevated)',
    },
    '@media (max-width: 360px)': {
      gridTemplateColumns: '1fr',
      borderRadius: t.radius.lg,
    },
  },
  heroCta: {
    marginTop: 0,
    display: 'inline-flex',
    alignItems: 'center',
    gap: '10px',
    padding: '12px 18px',
    borderRadius: t.radius.pill,
    backgroundColor: 'var(--pf-hero-cta-bg)',
    color: 'var(--pf-hero-cta-fg)',
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
    '@media (max-width: 520px)': {
      width: '100%',
      maxWidth: 'none',
      justifyContent: 'center',
      minHeight: '44px',
      paddingRight: '12px',
      paddingLeft: '12px',
      fontSize: '0.82rem',
    },
    '@media (max-width: 360px)': {
      minHeight: '42px',
    },
  },
  heroHeaderRow: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 'var(--pf-space-lg)',
    '@media (max-width: 760px)': {
      flexDirection: 'column',
    },
  },
  heroCopy: {
    display: 'grid',
    gap: '6px',
    minWidth: 0,
  },
  heroMetricGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 'var(--pf-space-md)',
    '@media (max-width: 720px)': { gridTemplateColumns: '1fr' },
  },
  heroMetricCard: {
    display: 'grid',
    gap: 'var(--pf-space-xs)',
    padding: 'var(--pf-space-lg)',
    borderRadius: t.radius.sm,
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface)',
    boxShadow: 'var(--pf-shadow-card)',
  },
  // Actionable stat cards (flagged): four `number → meaning → CTA` cards.
  statCardGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 'var(--pf-space-md)',
    '@media (max-width: 720px)': { gridTemplateColumns: '1fr' },
  },
  statCardCta: {
    appearance: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    justifySelf: 'start',
    marginTop: 'var(--pf-space-xs)',
    minHeight: '32px',
    paddingRight: '12px',
    paddingLeft: '12px',
    borderRadius: t.radius.pill,
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface)',
    color: 'var(--pf-text)',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.78rem',
    fontWeight: 700,
    transition:
      'background-color var(--pf-motion-fast), box-shadow var(--pf-motion-fast)',
    ':hover': { backgroundColor: 'var(--pf-surface-muted)' },
    ':focus-visible': {
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: 'var(--pf-focus-ring)',
      outlineOffset: '2px',
    },
  },
  // Intent chips (flagged): calm pills under the greeting. Design system:
  // no hover transforms — colour/contrast change only; ≥44px touch target.
  chipRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--pf-space-sm)',
  },
  intentChip: {
    appearance: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    minHeight: '44px',
    paddingRight: '16px',
    paddingLeft: '14px',
    borderRadius: t.radius.pill,
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface)',
    color: 'var(--pf-text)',
    boxShadow: 'var(--pf-shadow-card)',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.85rem',
    fontWeight: 600,
    transition:
      'background-color var(--pf-motion-fast), border-color var(--pf-motion-fast), box-shadow var(--pf-motion-fast)',
    ':hover': { backgroundColor: 'var(--pf-surface-muted)' },
    ':focus-visible': {
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: 'var(--pf-focus-ring)',
      outlineOffset: '2px',
    },
  },
  intentChipIcon: { width: '18px', height: '18px', flexShrink: 0 },
  // Voice entry card (flagged): a first-class "talk it through" entry point.
  voiceEntryCard: {
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 1fr) auto',
    alignItems: 'center',
    gap: 'var(--pf-space-md)',
    padding: 'var(--pf-space-lg)',
    borderRadius: t.radius.sm,
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface)',
    boxShadow: 'var(--pf-shadow-card)',
    '@media (max-width: 640px)': {
      gridTemplateColumns: 'auto minmax(0, 1fr)',
    },
  },
  voiceEntryIcon: {
    width: '44px',
    height: '44px',
    borderRadius: t.radius.pill,
    display: 'grid',
    placeItems: 'center',
    backgroundColor: 'var(--pf-ink)',
    color: 'var(--pf-on-ink)',
  },
  voiceEntryCopy: { display: 'grid', gap: '2px' },
  voiceEntryHint: {
    margin: 0,
    fontSize: '0.85rem',
    color: 'var(--pf-text-secondary)',
    lineHeight: 1.5,
  },
  voiceEntryButton: {
    appearance: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    minHeight: '44px',
    paddingRight: '18px',
    paddingLeft: '18px',
    borderRadius: t.radius.pill,
    border: '1px solid var(--pf-ink)',
    backgroundColor: 'var(--pf-ink)',
    color: 'var(--pf-on-ink)',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.85rem',
    fontWeight: 700,
    transition:
      'filter var(--pf-motion-fast), box-shadow var(--pf-motion-fast)',
    ':hover': { filter: 'brightness(1.06)' },
    ':focus-visible': {
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: 'var(--pf-focus-ring)',
      outlineOffset: '3px',
    },
    '@media (max-width: 640px)': {
      gridColumn: '1 / -1',
      justifySelf: 'stretch',
    },
  },
  heroWorkGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.4fr) minmax(240px, 0.9fr)',
    gap: 'var(--pf-space-lg)',
    alignItems: 'start',
    '@media (max-width: 940px)': { gridTemplateColumns: '1fr' },
  },
  heroPanel: {
    display: 'grid',
    gap: 'var(--pf-space-md)',
    padding: 'var(--pf-space-lg)',
    borderRadius: t.radius.sm,
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface)',
    boxShadow: 'var(--pf-shadow-card)',
  },
  heroPanelHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--pf-space-md)',
    paddingBottom: 'var(--pf-space-sm)',
    borderBottom: 'var(--pf-hairline)',
  },
  heroPathList: {
    display: 'grid',
    gap: 0,
  },
  heroPathRow: {
    appearance: 'none',
    width: '100%',
    display: 'grid',
    gridTemplateColumns: '36px minmax(0, 1fr) auto auto',
    alignItems: 'center',
    gap: 'var(--pf-space-md)',
    paddingTop: 'var(--pf-space-md)',
    paddingBottom: 'var(--pf-space-md)',
    borderTop: 'none',
    borderRight: 'none',
    borderBottom: 'var(--pf-hairline)',
    borderLeft: 'none',
    backgroundColor: 'transparent',
    color: 'var(--pf-text)',
    cursor: 'pointer',
    font: 'inherit',
    textAlign: 'left',
    ':last-child': { borderBottom: 'none' },
    ':hover': { backgroundColor: 'var(--pf-surface-muted)' },
    ':focus-visible': {
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: 'var(--pf-focus-ring)',
      outlineOffset: '2px',
      boxShadow: 'var(--pf-focus-outline)',
    },
    '@media (max-width: 560px)': {
      gridTemplateColumns: '36px minmax(0, 1fr)',
    },
  },
  heroStepIcon: {
    width: '36px',
    height: '36px',
    borderRadius: t.radius.sm,
    display: 'grid',
    placeItems: 'center',
    backgroundColor: 'var(--pf-ink)',
    color: 'var(--pf-on-ink)',
  },
  heroStepBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: '22px',
    borderRadius: t.radius.pill,
    paddingRight: '9px',
    paddingLeft: '9px',
    backgroundColor: 'var(--pf-surface-muted)',
    color: 'var(--pf-text-secondary)',
    fontSize: '0.72rem',
    fontWeight: 700,
    '@media (max-width: 560px)': { display: 'none' },
  },
  heroPlayButton: {
    appearance: 'none',
    width: '36px',
    height: '36px',
    borderRadius: t.radius.pill,
    border: '1px solid var(--pf-ink)',
    backgroundColor: 'var(--pf-ink)',
    color: 'var(--pf-on-ink)',
    display: 'grid',
    placeItems: 'center',
    cursor: 'pointer',
    '@media (max-width: 560px)': { display: 'none' },
  },
  focusList: {
    display: 'grid',
    gap: 'var(--pf-space-md)',
  },
  focusItem: {
    display: 'grid',
    gap: 'var(--pf-space-xs)',
    paddingBottom: 'var(--pf-space-md)',
    borderBottom: 'var(--pf-hairline)',
    ':last-child': { borderBottom: 'none', paddingBottom: 0 },
  },
  focusItemTop: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--pf-space-sm)',
  },
  focusBar: {
    width: '100%',
    height: '8px',
    borderRadius: t.radius.pill,
    backgroundColor: 'var(--pf-line-soft)',
    overflow: 'hidden',
  },
  focusFill: {
    height: '100%',
    borderRadius: t.radius.pill,
    backgroundColor: 'var(--pf-ink)',
  },
  tutorMiniButton: {
    appearance: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: t.control.minHeight,
    paddingRight: '14px',
    paddingLeft: '10px',
    borderRadius: t.radius.pill,
    border: '1px solid var(--pf-ink)',
    backgroundColor: 'var(--pf-ink)',
    color: 'var(--pf-on-ink)',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.82rem',
    fontWeight: 700,
    ':focus-visible': {
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: 'var(--pf-focus-ring)',
      outlineOffset: '3px',
      boxShadow: 'var(--pf-focus-outline)',
    },
    '@media (max-width: 520px)': {
      width: '100%',
      justifyContent: 'center',
      minHeight: '44px',
      paddingRight: '12px',
      paddingLeft: '10px',
      fontSize: '0.82rem',
    },
    '@media (max-width: 360px)': {
      minHeight: '42px',
    },
  },
  studyActionContent: {
    width: '100%',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '9px',
  },
  heroSecondaryCta: {
    marginTop: 0,
    display: 'inline-flex',
    alignItems: 'center',
    gap: '10px',
    padding: '12px 18px',
    borderRadius: t.radius.pill,
    backgroundColor: 'var(--pf-hero-chip-bg)',
    color: 'var(--pf-hero-fg)',
    fontWeight: 700,
    fontSize: '0.92rem',
    cursor: 'pointer',
    border: '1px solid var(--pf-hero-chip-border)',
    fontFamily: 'inherit',
    transition: 'transform .15s ease, background-color .15s ease',
    ':hover': {
      transform: 'translateY(-1px)',
      backgroundColor: 'var(--pf-hero-chip-hover-bg)',
    },
  },
  tutorOrbCta: {
    position: 'relative',
    marginTop: 0,
    display: 'inline-flex',
    alignItems: 'center',
    gap: '12px',
    paddingTop: '8px',
    paddingBottom: '8px',
    paddingLeft: '12px',
    paddingRight: '20px',
    borderRadius: t.radius.pill,
    background:
      'linear-gradient(140deg, var(--pf-hero-chip-bg) 0%, rgba(255,255,255,0.04) 100%)',
    color: 'var(--pf-hero-fg)',
    fontWeight: 700,
    fontSize: '0.92rem',
    cursor: 'pointer',
    borderTop: '1px solid var(--pf-hero-chip-border)',
    borderRight: '1px solid var(--pf-hero-chip-border)',
    borderBottom: '1px solid var(--pf-hero-chip-border)',
    borderLeft: '1px solid var(--pf-hero-chip-border)',
    fontFamily: 'inherit',
    backdropFilter: 'blur(6px)',
    transitionProperty: 'transform, box-shadow, background-color, border-color',
    transitionDuration: '180ms',
    transitionTimingFunction: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    boxShadow:
      '0 6px 20px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.12)',
    ':hover': {
      transform: 'translateY(-1px)',
      borderTopColor: 'var(--pf-hero-chip-hover-border)',
      borderRightColor: 'var(--pf-hero-chip-hover-border)',
      borderBottomColor: 'var(--pf-hero-chip-hover-border)',
      borderLeftColor: 'var(--pf-hero-chip-hover-border)',
      boxShadow:
        '0 12px 30px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.18)',
    },
    ':focus-visible': {
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: 'var(--pf-hero-focus)',
      outlineOffset: '3px',
    },
    '@media (prefers-reduced-motion: reduce)': {
      transitionDuration: '0ms',
    },
  },
  tutorOrb: {
    position: 'relative',
    width: '34px',
    height: '34px',
    borderRadius: '999px',
    background:
      'radial-gradient(circle at 32% 28%, #ffffff 0%, #e7e8ef 28%, #8d8f9a 60%, #1a1b22 100%)',
    boxShadow:
      '0 0 14px rgba(255,255,255,0.42), inset 0 0 10px rgba(255,255,255,0.35), inset 0 -4px 10px rgba(0,0,0,0.55)',
    flexShrink: 0,
    animationName: {
      '0%, 100%': {
        transform: 'scale(1)',
        boxShadow:
          '0 0 14px rgba(255,255,255,0.42), inset 0 0 10px rgba(255,255,255,0.35), inset 0 -4px 10px rgba(0,0,0,0.55)',
      },
      '50%': {
        transform: 'scale(1.06)',
        boxShadow:
          '0 0 22px rgba(255,255,255,0.62), inset 0 0 12px rgba(255,255,255,0.5), inset 0 -4px 10px rgba(0,0,0,0.55)',
      },
    },
    animationDuration: '2400ms',
    animationIterationCount: 'infinite',
    animationTimingFunction: 'ease-in-out',
    '@media (max-width: 520px)': {
      width: '28px',
      height: '28px',
    },
    '@media (prefers-reduced-motion: reduce)': {
      animationName: 'none',
    },
  },
  tutorOrbHalo: {
    position: 'absolute',
    inset: '-7px',
    borderRadius: '999px',
    pointerEvents: 'none',
    background:
      'radial-gradient(circle, rgba(180,200,255,0.32) 0%, rgba(180,200,255,0) 70%)',
    animationName: {
      '0%, 100%': { opacity: 0.55, transform: 'scale(1)' },
      '50%': { opacity: 0.95, transform: 'scale(1.12)' },
    },
    animationDuration: '2400ms',
    animationIterationCount: 'infinite',
    animationTimingFunction: 'ease-in-out',
    '@media (prefers-reduced-motion: reduce)': {
      animationName: 'none',
    },
  },
  tutorOrbLabel: {
    display: 'inline-flex',
    flexDirection: 'column',
    lineHeight: 1.1,
    textAlign: 'left',
  },
  tutorOrbTitle: {
    fontSize: '0.92rem',
    fontWeight: 700,
    letterSpacing: '-0.005em',
  },
  tutorOrbHint: {
    fontSize: '0.72rem',
    fontWeight: 500,
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: '0.01em',
  },
  voiceButton: {
    appearance: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: t.control.minHeight,
    paddingRight: '16px',
    paddingLeft: '16px',
    borderRadius: t.radius.pill,
    border: '1px solid rgba(255,255,255,0.22)',
    backgroundColor: 'rgba(255,255,255,0.08)',
    color: 'var(--pf-on-ink)',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.84rem',
    fontWeight: 700,
    ':disabled': {
      cursor: 'not-allowed',
      opacity: 0.55,
    },
  },
  card: {
    backgroundColor: 'var(--pf-surface)',
    border: 'var(--pf-hairline)',
    borderRadius: t.radius.sm,
    padding: 'var(--pf-space-xl) var(--pf-space-xxl)',
    boxShadow: 'var(--pf-shadow-card-elevated)',
    transition:
      'box-shadow var(--pf-motion-normal) var(--pf-motion-ease), transform var(--pf-motion-normal) var(--pf-motion-ease)',
    '@media (max-width: 560px)': {
      padding: 'var(--pf-space-lg)',
    },
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--pf-space-md)',
    flexWrap: 'wrap',
    marginBottom: 'var(--pf-space-lg)',
  },
  cardTitle: {
    fontFamily: t.font.display,
    fontSize: '1.05rem',
    fontWeight: 600,
    letterSpacing: '-0.01em',
    color: 'var(--pf-text)',
  },
  cardCaption: {
    fontSize: '0.78rem',
    color: 'var(--pf-text-tertiary)',
  },
  softBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    flexShrink: 0,
    minHeight: '24px',
    borderRadius: t.radius.pill,
    border: 'var(--pf-hairline)',
    paddingRight: '10px',
    paddingLeft: '10px',
    backgroundColor: 'var(--pf-surface-muted)',
    color: 'var(--pf-text-secondary)',
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
    backgroundColor: 'var(--pf-surface-muted)',
    border: 'var(--pf-hairline)',
    color: 'var(--pf-text-secondary)',
    fontSize: '0.85rem',
  },
  pathList: {
    display: 'grid',
    gap: 'var(--pf-space-md)',
  },
  pathRevisionFooter: {
    marginTop: '14px',
    paddingTop: '14px',
    borderTop: '1px solid var(--pf-line)',
    display: 'grid',
    gap: '10px',
  },
  pathRevisionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
  },
  pathRevisionTitle: {
    fontSize: '0.9rem',
    fontWeight: 600,
    color: 'var(--pf-text-secondary)',
  },
  pathRow: {
    display: 'grid',
    gridTemplateColumns: '40px minmax(0, 1fr) auto auto',
    alignItems: 'center',
    gap: 'var(--pf-space-md)',
    padding: 'var(--pf-space-md) var(--pf-space-lg)',
    borderRadius: t.radius.sm,
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface)',
    boxShadow: 'none',
    cursor: 'pointer',
    transition:
      'background-color var(--pf-motion-fast), border-color var(--pf-motion-fast), box-shadow var(--pf-motion-fast), transform var(--pf-motion-fast)',
    ':hover': {
      backgroundColor: 'var(--pf-surface-muted)',
      borderTopColor: 'var(--pf-text-tertiary)',
      borderRightColor: 'var(--pf-text-tertiary)',
      borderBottomColor: 'var(--pf-text-tertiary)',
      borderLeftColor: 'var(--pf-text-tertiary)',
      boxShadow: 'var(--pf-shadow-card-hover)',
      transform: 'translateY(-1px)',
    },
    ':focus-visible': {
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: 'var(--pf-focus-ring)',
      outlineOffset: '3px',
      boxShadow: 'var(--pf-focus-outline)',
    },
  },
  pathRowShell: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gap: '10px',
    alignItems: 'stretch',
    '@media (max-width: 640px)': { gridTemplateColumns: '1fr' },
  },
  openPracticeButton: {
    appearance: 'none',
    minWidth: '132px',
    minHeight: '64px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    paddingRight: '14px',
    paddingLeft: '14px',
    borderRadius: t.radius.sm,
    border: '1px solid var(--pf-ink)',
    backgroundColor: 'var(--pf-ink)',
    color: 'var(--pf-on-ink)',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.82rem',
    fontWeight: 700,
    transition:
      'filter var(--pf-motion-fast), transform var(--pf-motion-fast), box-shadow var(--pf-motion-fast)',
    ':hover': { filter: 'brightness(1.06)' },
    ':focus-visible': {
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: 'var(--pf-focus-ring)',
      outlineOffset: '3px',
      boxShadow: 'var(--pf-focus-outline)',
    },
  },
  openPracticeIcon: {
    width: '28px',
    height: '28px',
    flexShrink: 0,
  },
  pathIcon: {
    width: '40px',
    height: '40px',
    borderRadius: t.radius.sm,
    display: 'grid',
    placeItems: 'center',
    backgroundColor: 'var(--pf-ink)',
    color: 'var(--pf-on-ink)',
  },
  pathTitle: {
    display: 'grid',
    gap: '2px',
  },
  pathTitleText: {
    fontWeight: 600,
    color: 'var(--pf-text)',
    fontSize: '0.94rem',
  },
  textAction: {
    appearance: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    justifySelf: 'start',
    minHeight: t.control.minHeight,
    marginTop: '12px',
    paddingRight: '13px',
    paddingLeft: '13px',
    borderRadius: t.radius.pill,
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface)',
    color: 'var(--pf-text)',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.78rem',
    fontWeight: 700,
    transition:
      'background-color var(--pf-motion-fast), border-color var(--pf-motion-fast), color var(--pf-motion-fast), box-shadow var(--pf-motion-fast)',
    ':hover': {
      backgroundColor: 'var(--pf-surface-muted)',
      borderTopColor: 'var(--pf-text-tertiary)',
      borderRightColor: 'var(--pf-text-tertiary)',
      borderBottomColor: 'var(--pf-text-tertiary)',
      borderLeftColor: 'var(--pf-text-tertiary)',
    },
    ':focus-visible': {
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: 'var(--pf-focus-ring)',
      outlineOffset: '3px',
      boxShadow: 'var(--pf-focus-outline)',
    },
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
    color: 'var(--pf-text-tertiary)',
    fontWeight: 700,
  },
  select: {
    width: '100%',
    minHeight: '46px',
    borderRadius: t.radius.lg,
    border: '1px solid var(--pf-line)',
    backgroundColor: 'var(--pf-surface)',
    color: 'var(--pf-text)',
    paddingRight: '14px',
    paddingLeft: '14px',
    font: 'inherit',
    fontSize: '0.92rem',
    fontWeight: 700,
  },
  insightGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: '12px',
    '@media (max-width: 960px)': { gridTemplateColumns: '1fr' },
  },
  insightCard: {
    display: 'grid',
    gap: 'var(--pf-space-md)',
    padding: 'var(--pf-space-lg)',
    borderRadius: t.radius.sm,
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface)',
    boxShadow: 'none',
  },
  meterTrack: {
    width: '100%',
    height: '8px',
    borderRadius: t.radius.pill,
    backgroundColor: 'var(--pf-line-soft)',
    overflow: 'hidden',
  },
  meterFill: {
    height: '100%',
    borderRadius: t.radius.pill,
    background:
      'linear-gradient(90deg, var(--pf-ink) 0%, var(--pf-text-secondary) 100%)',
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
    borderRadius: t.radius.sm,
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface-muted)',
    '@media (max-width: 560px)': { gridTemplateColumns: '1fr' },
  },
  sharePanel: {
    display: 'grid',
    gap: '12px',
    padding: '16px',
    borderRadius: t.radius.xl,
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface-muted)',
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
    backgroundColor: 'var(--pf-surface)',
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
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface-muted)',
    color: 'var(--pf-text)',
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
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface-muted)',
  },
  pathMeta: {
    fontSize: '0.78rem',
    color: 'var(--pf-text-tertiary)',
  },
  minutes: {
    fontSize: '0.78rem',
    color: 'var(--pf-text-secondary)',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
  },
  demoCard: {
    display: 'grid',
    gap: '16px',
    padding: '18px',
    borderRadius: t.radius.xxl,
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface)',
    boxShadow: 'var(--pf-shadow-raised)',
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
    fontWeight: 700,
    color: 'var(--pf-text)',
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
    backgroundColor: 'var(--pf-line-soft)',
  },
  demoDotActive: {
    width: '34px',
    height: '8px',
    borderRadius: t.radius.pill,
    backgroundColor: 'var(--pf-ink)',
  },
  demoPromptCard: {
    display: 'grid',
    gap: '12px',
    padding: '18px',
    borderRadius: t.radius.xl,
    backgroundColor: 'var(--pf-surface-muted)',
    border: 'var(--pf-hairline)',
  },
  adaptiveMoment: {
    display: 'grid',
    gap: '8px',
    padding: '14px 16px',
    borderRadius: t.radius.lg,
    border: '1px solid var(--pf-ink)',
    backgroundColor: 'var(--pf-surface-muted)',
    boxShadow: '0 10px 24px rgba(15, 42, 58, 0.08)',
  },
  adaptiveMomentBody: {
    margin: 0,
    color: 'var(--pf-text-secondary)',
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
    backgroundColor: 'var(--pf-ink)',
    color: 'var(--pf-on-ink)',
    flexShrink: 0,
  },
  demoPrompt: {
    margin: 0,
    color: 'var(--pf-text)',
    fontFamily: t.font.display,
    fontSize: 'clamp(1.2rem, 5vw, 1.55rem)',
    lineHeight: 1.18,
    fontWeight: 700,
    letterSpacing: '0',
  },
  demoHelper: {
    margin: 0,
    color: 'var(--pf-text-secondary)',
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
    border: '1px solid var(--pf-line)',
    backgroundColor: 'var(--pf-surface)',
    color: 'var(--pf-text)',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '1rem',
    fontWeight: 700,
    textAlign: 'left',
    boxShadow: '0 8px 18px rgba(15, 42, 58, 0.08)',
  },
  demoOptionMeta: {
    color: 'var(--pf-text-tertiary)',
    fontSize: '0.76rem',
    fontWeight: 700,
  },
  demoFooter: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '10px',
    alignItems: 'center',
    flexWrap: 'wrap',
    color: 'var(--pf-text-secondary)',
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
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface)',
    boxShadow: 'var(--pf-shadow-raised)',
  },
  practicePromptCard: {
    display: 'grid',
    gap: '10px',
    padding: '16px',
    borderRadius: t.radius.xl,
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface-muted)',
  },
  practicePrompt: {
    margin: 0,
    color: 'var(--pf-text)',
    fontFamily: t.font.display,
    fontSize: 'clamp(1.16rem, 5vw, 1.48rem)',
    fontWeight: 700,
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
    border: '1px solid var(--pf-line)',
    backgroundColor: 'var(--pf-surface)',
    color: 'var(--pf-text)',
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
    border: '2px solid var(--pf-ink)',
    backgroundColor: 'var(--pf-ink)',
    color: 'var(--pf-on-ink)',
    cursor: 'pointer',
    font: 'inherit',
    textAlign: 'left',
    boxShadow: '0 10px 24px rgba(15, 42, 58, 0.16)',
  },
  practiceOptionLabel: {
    fontSize: '1rem',
    fontWeight: 700,
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
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface-muted)',
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
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface)',
  },
  careerAskGrid: {
    display: 'grid',
    gap: '10px',
  },
  careerInput: {
    width: '100%',
    minHeight: '46px',
    borderRadius: t.radius.lg,
    border: '1px solid var(--pf-line)',
    boxSizing: 'border-box',
    paddingRight: '14px',
    paddingLeft: '14px',
    color: 'var(--pf-text)',
    backgroundColor: 'var(--pf-surface)',
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
    border: '1px solid var(--pf-ink)',
    backgroundColor: 'var(--pf-ink)',
    color: 'var(--pf-on-ink)',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.9rem',
    fontWeight: 700,
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
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface)',
    color: 'var(--pf-text)',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.9rem',
    fontWeight: 700,
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
    padding: 'var(--pf-space-lg)',
    borderRadius: t.radius.sm,
    backgroundColor: 'var(--pf-surface-muted)',
    border: 'var(--pf-hairline)',
    display: 'grid',
    gap: 'var(--pf-space-xxs)',
  },
  weekLabel: {
    fontSize: '0.72rem',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: 'var(--pf-text-tertiary)',
    fontWeight: 600,
  },
  weekValue: {
    fontFamily: t.font.display,
    fontSize: '1.5rem',
    fontWeight: 600,
    letterSpacing: '-0.02em',
    color: 'var(--pf-text)',
  },
  weekDelta: { fontSize: '0.78rem', color: 'var(--pf-text-secondary)' },
  deviceOverviewCard: {
    display: 'grid',
    gap: '14px',
    padding: '18px',
    borderRadius: t.radius.xl,
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface)',
    boxShadow: 'var(--pf-shadow-raised)',
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
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface-muted)',
  },
  deviceModeValue: {
    color: 'var(--pf-text)',
    fontSize: '0.95rem',
    fontWeight: 700,
  },
  deviceModeDetail: {
    color: 'var(--pf-text-secondary)',
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
    color: 'var(--pf-text-tertiary)',
    fontWeight: 600,
    margin: '4px 0',
  },
  sideRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
    padding: '10px 0',
    borderBottom: 'var(--pf-hairline)',
    ':last-child': { borderBottom: 'none' },
  },
  sideRowIcon: {
    width: '18px',
    height: '18px',
    color: 'var(--pf-text)',
    flexShrink: 0,
    marginTop: '2px',
  },
  sideRowText: {
    fontSize: '0.85rem',
    color: 'var(--pf-text)',
    fontWeight: 500,
    lineHeight: 1.35,
  },
  sideRowMeta: {
    fontSize: '0.74rem',
    color: 'var(--pf-text-tertiary)',
    marginTop: '2px',
  },
  // Disclosure (item 2)
  disclosure: {
    display: 'block',
    padding: 0,
  },
  disclosureSummary: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    cursor: 'pointer',
    listStyle: 'none',
    color: 'var(--pf-text)',
    '::-webkit-details-marker': { display: 'none' },
    ':focus-visible': {
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: 'var(--pf-focus-ring)',
      outlineOffset: '4px',
      borderRadius: t.radius.md,
      boxShadow: 'var(--pf-focus-outline)',
    },
  },
  disclosureChevron: {
    width: '18px',
    height: '18px',
    color: 'var(--pf-text-tertiary)',
    transitionProperty: 'transform',
    transitionDuration: 'var(--pf-motion-normal)',
    transitionTimingFunction: 'var(--pf-motion-ease)',
    '@media (prefers-reduced-motion: reduce)': {
      transitionDuration: '0ms',
    },
  },
  disclosureChevronOpen: { transform: 'rotate(90deg)' },
  disclosureBody: { marginTop: '14px' },
  // Voice CTA pill (item 1)
  voicePill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    paddingTop: '6px',
    paddingBottom: '6px',
    paddingLeft: '12px',
    paddingRight: '12px',
    borderRadius: t.radius.pill,
    backgroundColor: 'rgba(255,255,255,0.92)',
    color: 'var(--pf-text)',
    fontSize: '0.78rem',
    fontWeight: 700,
    letterSpacing: '0.01em',
    boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
    pointerEvents: 'none',
  },
  voicePillDot: {
    width: '6px',
    height: '6px',
    borderRadius: '999px',
    backgroundColor: 'var(--pf-text)',
  },
  voiceWave: {
    display: 'inline-flex',
    alignItems: 'flex-end',
    gap: '2px',
    height: '14px',
  },
  voiceWaveBar: {
    width: '2.5px',
    borderRadius: '2px',
    backgroundColor: 'var(--pf-text)',
    animationName: {
      '0%, 100%': { transform: 'scaleY(0.4)' },
      '50%': { transform: 'scaleY(1)' },
    },
    animationDuration: '900ms',
    animationIterationCount: 'infinite',
    animationTimingFunction: 'ease-in-out',
    transformOrigin: 'bottom',
    '@media (prefers-reduced-motion: reduce)': {
      animationName: 'none',
      transform: 'scaleY(0.6)',
    },
  },
  voicePulse: {
    width: '8px',
    height: '8px',
    borderRadius: '999px',
    backgroundColor: 'var(--pf-text)',
    animationName: {
      '0%, 100%': { opacity: 0.4, transform: 'scale(0.85)' },
      '50%': { opacity: 1, transform: 'scale(1.15)' },
    },
    animationDuration: '1200ms',
    animationIterationCount: 'infinite',
    animationTimingFunction: 'ease-in-out',
    '@media (prefers-reduced-motion: reduce)': {
      animationName: 'none',
      opacity: 1,
      transform: 'none',
    },
  },
  voiceStaticDots: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '3px',
  },
  voiceStaticDot: {
    width: '4px',
    height: '4px',
    borderRadius: '999px',
    backgroundColor: 'var(--pf-text)',
  },
  // Trust badge cluster (item 4)
  trustBadgeWrap: {
    marginTop: '12px',
    minHeight: '44px',
    alignContent: 'center',
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '6px',
    appearance: 'none',
    backgroundColor: 'transparent',
    border: 'none',
    paddingTop: '6px',
    paddingBottom: '6px',
    paddingLeft: '0',
    paddingRight: '0',
    cursor: 'pointer',
    color: 'inherit',
    textDecoration: 'none',
    ':focus-visible': {
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: 'var(--pf-text)',
      outlineOffset: '4px',
      borderRadius: t.radius.pill,
    },
  },
  trustBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    paddingTop: '4px',
    paddingBottom: '4px',
    paddingLeft: '8px',
    paddingRight: '10px',
    borderRadius: t.radius.pill,
    backgroundColor: 'var(--pf-surface-muted)',
    border: 'var(--pf-hairline)',
    fontSize: '0.7rem',
    fontWeight: 600,
    color: 'var(--pf-text)',
  },
  trustBadgeIcon: { width: '12px', height: '12px' },
  // Parent share card (item 3)
  shareBubble: {
    padding: '14px 16px',
    borderRadius: t.radius.xl,
    backgroundColor: '#dcf8c6',
    color: '#0a0a0a',
    fontSize: '0.92rem',
    lineHeight: 1.5,
    boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
    position: 'relative',
  },
  shareLiveRegion: {
    position: 'absolute',
    width: '1px',
    height: '1px',
    paddingTop: '0',
    paddingBottom: '0',
    paddingLeft: '0',
    paddingRight: '0',
    margin: '-1px',
    overflow: 'hidden',
    clip: 'rect(0,0,0,0)',
    whiteSpace: 'nowrap',
    borderTopWidth: '0',
    borderRightWidth: '0',
    borderBottomWidth: '0',
    borderLeftWidth: '0',
  },
})

type StudentLearningHomeProps = {
  studentId?: string | null
  learnerTutorEnabled?: boolean
  /** When true, skip the Web Push permission prompt (kid role — needs parental consent). */
  pushConsentDeferred?: boolean
}

// Leading glyph for each intent chip (F1.2). Falls back to SparklesIcon.
const chipIcons: Record<string, typeof SparklesIcon> = {
  'study-with-wulo': BookOpenIcon,
  'how-am-i-doing': ChartBarIcon,
  'ask-wulo': SparklesIcon,
  'talk-it-through': MicrophoneIcon,
  'first-goal': AcademicCapIcon,
  'quick-quiz': CalculatorIcon,
}

export default function StudentLearningHome({
  studentId,
  learnerTutorEnabled = true,
  pushConsentDeferred,
}: StudentLearningHomeProps) {
  const styles = useStyles()
  const demoDiagnosticRef = useRef<HTMLElement | null>(null)
  const learnerProfile = useLearnerProfile()
  const learnerSetup = learnerProfile.setup
  const setLearnerSetup = learnerProfile.updateSetup
  const [activeSkill, setActiveSkill] = useState<string | null>(null)
  const [activeSubject, setActiveSubject] = useState<string | null>(null)
  const [panelKey, setPanelKey] = useState(0)
  const [checkInActive, setCheckInActive] = useState(false)
  const [demoActive, setDemoActive] = useState(false)
  const [demoCompleted, setDemoCompleted] = useState(false)
  const [demoStepQueue, setDemoStepQueue] =
    useState<DemoStep[]>(demoDiagnosticSteps)
  const [demoStepIndex, setDemoStepIndex] = useState(0)
  const [demoAnswers, setDemoAnswers] = useState<DemoAnswer[]>([])
  const [demoSyncNote, setDemoSyncNote] = useState<string | null>(null)
  const [adaptiveMoment, setAdaptiveMoment] = useState<AdaptiveMoment | null>(
    null
  )
  const [demoVoiceBusy, setDemoVoiceBusy] = useState(false)
  const [practiceAnswer, setPracticeAnswer] = useState<PracticeAnswer | null>(
    null
  )
  const [practiceOpen, setPracticeOpen] = useState<boolean>(
    () =>
      new URLSearchParams(window.location.search).get('startPractice') === '1'
  )
  // A forced lead skill carried in via ?skillId= (goal intake "Start now").
  // Passed to PracticeFullscreen so the learner lands on the exact recommended
  // skill rather than the planner's own first pick. Initialised from the URL so
  // the intent survives the learner-home remount (learner-loading -> real id).
  const [forcedPracticeSkill, setForcedPracticeSkill] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get('skillId')
  )
  const [tutorOpen, setTutorOpen] = useState(false)
  const [tutorInitialMode, setTutorInitialMode] =
    useState<TutorPresentationMode>('fullscreen')
  const [tutorFocusItem, setTutorFocusItem] =
    useState<LearnerFocusItem | null>(null)
  const [, setTutorVoice] = useState<TutorVoiceSnapshot>({
    state: 'idle',
    inputLevel: 0,
    recording: false,
  })
  // Goal intake → "Start now" deep-links here with ?startPractice=1 (plus an
  // optional ?skillId=) so the learner lands inside an exercise, not the
  // dashboard. The open intent is read from the URL in the state initialisers
  // above (not an effect) so it survives the learner-home remount that happens
  // when `learnerChildren` finishes loading; stripping the params only on close
  // avoids the race where an early strip left the remounted home with practice
  // shut and the param gone. Skip the Web-Push prompt while practice is open.
  const [searchParams, setSearchParams] = useSearchParams()
  const closePractice = useCallback(() => {
    setPracticeOpen(false)
    setForcedPracticeSkill(null)
    // Strip the deep-link params so a manual refresh doesn't reopen practice.
    if (
      searchParams.has('startPractice') ||
      searchParams.has('skillId')
    ) {
      const next = new URLSearchParams(searchParams)
      next.delete('startPractice')
      next.delete('skillId')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams])
  // Late-arriving deep link (param appears after mount without a remount, e.g.
  // an in-app link): open practice once. The common goal-intake flow is already
  // covered by the URL-seeded initialisers above; this is the belt-and-braces
  // path. It never strips here — stripping is owned by `closePractice`.
  useEffect(() => {
    if (searchParams.get('startPractice') === '1') {
      const skillId = searchParams.get('skillId')
      if (skillId) setForcedPracticeSkill(skillId)
      setPracticeOpen(true)
    }
  }, [searchParams])
  // Test-only escape hatch so Playwright can drive the voice pill into any
  // state without spinning up the full WebRTC stack. Reads ?__voiceState=
  // from the URL on mount and on history changes. Active only when the
  // build flag VITE_PATHFINDER_E2E_HOOKS=true is set, or in `vite dev`.
  useEffect(() => {
    const enabled =
      import.meta.env.DEV ||
      import.meta.env.VITE_PATHFINDER_E2E_HOOKS === 'true'
    if (!enabled) return
    const valid = new Set<TutorVoiceSnapshot['state']>([
      'idle',
      'connecting',
      'listening',
      'thinking',
      'speaking',
      'error',
    ])
    const apply = () => {
      const raw = new URLSearchParams(window.location.search).get('__voiceState')
      if (raw && valid.has(raw as TutorVoiceSnapshot['state'])) {
        setTutorVoice((prev) => ({
          ...prev,
          state: raw as TutorVoiceSnapshot['state'],
        }))
      }
    }
    apply()
    window.addEventListener('popstate', apply)
    return () => window.removeEventListener('popstate', apply)
  }, [])
  const disclosureUserKey = studentId ?? 'demo-student'
  const [careerOpen, setCareerOpen] = useDisclosureState(
    disclosureUserKey,
    'career',
    false
  )
  const [parentOpen, setParentOpen] = useDisclosureState(
    disclosureUserKey,
    'parent',
    false
  )
  const [trustOpen, setTrustOpen] = useDisclosureState(
    disclosureUserKey,
    'trust-sidebar',
    false
  )
  const [shareCopied, setShareCopied] = useState(false)
  const [expandedStepId, setExpandedStepId] = useState<string | null>(null)
  // Today's path + weak-topic profile start from a deterministic local
  // fallback and are replaced by the per-learner adaptive plan from
  // `GET /api/learning/learner/plan` when the onboarding flag is on. Flag-off
  // builds (and tests, where the flag defaults to false) keep the legacy
  // hardcoded arrays untouched.
  const [todaysPath, setTodaysPath] = useState<Activity[]>(fallbackTodaysPath)
  const [weakTopicProfile, setWeakTopicProfile] = useState<WeakTopic[]>(
    fallbackWeakTopicProfile
  )
  // The server's real plan items (empty until fetched). Intent chips derive
  // warm/cold from these — never from the demo fallback `todaysPath`, which
  // would fabricate a "Continue my plan" chip for a learner with no plan.
  const [serverPlanItems, setServerPlanItems] = useState<
    Array<{ skillId: string; label: string }>
  >([])
  useEffect(() => {
    if (!featureFlags.pathfinder_learner_onboarding_enabled) return
    let cancelled = false
    fetchLearnerPlan(studentId ? { student_id: studentId } : {})
      .then(plan => {
        if (cancelled) return
        setServerPlanItems(
          plan.today
            .filter(item => item.skill_id)
            .map(item => ({
              skillId: item.skill_id as string,
              label: item.title,
            }))
        )
        if (plan.today.length > 0) {
          setTodaysPath(
            plan.today.map(item => ({
              id: item.id,
              title: item.title,
              meta: item.meta,
              minutes: item.minutes,
              type: item.type,
              skillId: item.skill_id ?? undefined,
              subject: item.subject ?? undefined,
            }))
          )
        }
        setWeakTopicProfile(
          plan.weak_topics.map(topic => ({
            skillId: topic.skill_id,
            label: topic.label,
            mastery: topic.mastery,
            gap: topic.gap,
            nextAction: topic.next_action,
          }))
        )
      })
      .catch(err => {
        console.warn('learner plan fetch failed', err)
      })
    return () => {
      cancelled = true
    }
  }, [studentId])
  // Career pathways start from the deterministic local list and are replaced by
  // the per-learner mastery-ranked plan from `GET /api/learning/learner/careers`
  // when the onboarding flag is on. Flag-off builds keep the static array.
  const [careerPathwaysState, setCareerPathwaysState] =
    useState<CareerPathway[]>(careerPathways)
  useEffect(() => {
    if (!featureFlags.pathfinder_learner_onboarding_enabled) return
    let cancelled = false
    fetchLearnerCareers(studentId ? { student_id: studentId } : {})
      .then(plan => {
        if (cancelled || plan.pathways.length === 0) return
        setCareerPathwaysState(
          plan.pathways.map(p => {
            const wage = p.wage_band as {
              currency?: string
              min_monthly?: number
              max_monthly?: number
            }
            const wageText =
              wage.currency && wage.min_monthly && wage.max_monthly
                ? `${wage.currency} ${Math.round(wage.min_monthly / 1000)}k–${Math.round(wage.max_monthly / 1000)}k/mo`
                : 'wage data sourced'
            return {
              id: p.id,
              title: p.title,
              fit: p.fit,
              strength: p.rationale,
              gap: `Demand: ${p.demand_trend ?? 'tracked'} · ${wageText}`,
            }
          })
        )
      })
      .catch(err => {
        console.warn('learner careers fetch failed', err)
      })
    return () => {
      cancelled = true
    }
  }, [studentId])
  // "This week" tiles: real per-learner stats from `GET /api/learning/weekly-stats`
  // when the onboarding flag is on. Flag-off (demo/tests) keeps the static
  // `weeklyTiles`; loading shows neutral placeholders; error/cold-start shows an
  // honest empty state — never the old fabricated 4/5 · 7 days · +12%.
  const weekly = useWeeklyStats(studentId)
  const resolvedWeeklyTiles: WeeklyTile[] =
    weekly.status === 'idle'
      ? weeklyTiles
      : weekly.status === 'ready' && weekly.stats
        ? deriveWeeklyTiles(weekly.stats)
        : weekly.status === 'loading'
          ? weeklyLoadingTiles
          : weeklyEmptyTiles
  // The "More to revise" plan, its minute badge, and the "Up next" copy are
  // derived from the learner's real adaptive plan (weak topics + today's queue)
  // when the onboarding flag is on. Flag-off (demo/tests) keeps the static
  // arrays so the marketing demo is unchanged.
  const onboardingFlagOn = featureFlags.pathfinder_learner_onboarding_enabled
  const derivedRevisionPlan = useMemo<DailyPlanItem[]>(() => {
    if (!onboardingFlagOn || weakTopicProfile.length === 0) {
      return dailyRevisionPlan
    }
    return weakTopicProfile.slice(0, 3).map(topic => ({
      id: `revise-${topic.skillId}`,
      label: topic.label,
      // Weaker mastery earns more revision time — pedagogy, not invented stats.
      minutes: topic.mastery < 50 ? 6 : topic.mastery < 70 ? 4 : 3,
      reason: topic.nextAction,
    }))
  }, [onboardingFlagOn, weakTopicProfile])
  const revisionMinutesTotal = useMemo(
    () => derivedRevisionPlan.reduce((sum, item) => sum + item.minutes, 0),
    [derivedRevisionPlan]
  )
  const upNext = useMemo<{ label: string; skillId: string }>(() => {
    if (onboardingFlagOn) {
      const firstWeak = weakTopicProfile[0]
      if (firstWeak) {
        return {
          label: `${firstWeak.label} · ${firstWeak.nextAction}`,
          skillId: firstWeak.skillId,
        }
      }
      const nextItem = todaysPath[0]
      if (nextItem) {
        return {
          label: `${nextItem.title} · ${nextItem.meta}`,
          skillId: nextItem.skillId ?? 'linear-equations',
        }
      }
    }
    return {
      label:
        "Linear equations · introduce slope using ratios you've practiced.",
      skillId: 'linear-equations',
    }
  }, [onboardingFlagOn, weakTopicProfile, todaysPath])
  const [wrongAnswerExplanation, setWrongAnswerExplanation] =
    useState<WrongAnswerExplanation | null>(null)
  const [revisionPlanAdded, setRevisionPlanAdded] = useState(false)
  const pushSubscription = usePushSubscription({
    userId: studentId ?? 'demo-student',
    consentDeferred: Boolean(pushConsentDeferred),
  })
  const [shareStatus, setShareStatus] = useState<string | null>(null)
  const [completed, setCompleted] = useState(false)
  // The exam-path picker is a secondary affordance (#13): collapsed by default
  // so it does not compete with the hero "Pick up where we left off" action.
  const [examPathOpen, setExamPathOpen] = useState(false)
  const [voiceConfig, setVoiceConfig] = useState<VoiceConfigResponse | null>(
    null
  )
  const [safetyConfig, setSafetyConfig] = useState<SafetyConfig | null>(null)
  const [voiceResult, setVoiceResult] = useState<VoiceFrameResponse | null>(
    null
  )
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [voiceBusy, setVoiceBusy] = useState(false)
  const [, setLastSession] = useState<{
    topicLabel: string
    correct: boolean
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    getVoiceConfig()
      .then(cfg => {
        if (!cancelled) setVoiceConfig(cfg)
      })
      .catch(() => {
        if (!cancelled)
          setVoiceConfig({
            enabled: false,
            transport: 'flask-sock',
            offline_fallback: 'queued_multilingual_voice_frame',
          })
      })
    api
      .getConfig()
      .then(cfg => {
        if (!cancelled && cfg.safety) setSafetyConfig(cfg.safety)
      })
      .catch(() => {
        // Fail-closed: assume voice disabled if config can't load.
        if (!cancelled)
          setSafetyConfig({
            learner_voice_disabled: true,
            session_turn_cap: null,
            session_token_cap: null,
            production_content_review_required: false,
          })
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    try {
      const demoRaw = window.localStorage.getItem(
        'pathfinder-demo-diagnostic:last'
      )
      if (demoRaw) {
        const parsed = JSON.parse(demoRaw) as {
          answers?: Array<{ stepId?: string; correct?: boolean }>
        }
        const answers = Array.isArray(parsed.answers) ? parsed.answers : []
        const lastAnswered = [...answers]
          .reverse()
          .find(a => a && typeof a.stepId === 'string')
        if (lastAnswered) {
          const step = demoDiagnosticSteps.find(
            s => s.id === lastAnswered.stepId
          )
          if (step) {
            setLastSession({
              topicLabel: step.title,
              correct: Boolean(lastAnswered.correct),
            })
          }
        }
      }
    } catch {
      // Hydration is best-effort; fall back to default first-time copy.
    }
  }, [])

  useEffect(() => {
    if (!demoActive) return
    window.requestAnimationFrame(() => {
      demoDiagnosticRef.current?.scrollIntoView?.({
        behavior: 'auto',
        block: 'start',
      })
      demoDiagnosticRef.current?.focus({ preventScroll: true })
    })
  }, [demoActive])

  // -- Slice 3: welcome-learner tour kickoff + completion mirror -------
  // A non-null `learnerProfile.profile` implies the /api/learners/me/profile
  // endpoint accepted the caller (RBAC: learner role + flag on), so we use it
  // as the role signal without a second auth round-trip.
  const onboarding = useOnboarding()
  const tourKickedRef = useRef(false)
  const tourSeen = (onboarding.state.tours_seen ?? []).includes(
    'welcome-learner'
  )
  const learnerProfileData = learnerProfile.profile
  const tourSeenAt = learnerProfileData?.tour_seen_at ?? null
  const patchLearnerProfile = learnerProfile.patch

  useEffect(() => {
    if (!featureFlags.pathfinder_learner_onboarding_enabled) return
    if (tourKickedRef.current) return
    if (!learnerProfileData) return
    if (tourSeenAt) return
    if (tourSeen) return
    tourKickedRef.current = true
    requestReplayTour('welcome-learner')
  }, [learnerProfileData, tourSeen, tourSeenAt])

  useEffect(() => {
    if (!featureFlags.pathfinder_learner_onboarding_enabled) return
    if (!learnerProfileData) return
    if (tourSeenAt) return
    if (!tourSeen) return
    void patchLearnerProfile({ tour_seen_at: new Date().toISOString() }).catch(
      () => {
        // Mirror is best-effort: tours_seen on the server is the local source of
        // truth, tour_seen_at is the cross-device cache. Retry on next mount.
      }
    )
  }, [learnerProfileData, patchLearnerProfile, tourSeen, tourSeenAt])

  // Reverse mirror: if the profile already records tour_seen_at (e.g. a
  // cross-device return visit) but ui_state.tours_seen has not caught up,
  // seed it so OnboardingRuntime's auto-picker does not re-run the tour.
  useEffect(() => {
    if (!featureFlags.pathfinder_learner_onboarding_enabled) return
    if (!tourSeenAt) return
    if (tourSeen) return
    const next = [...(onboarding.state.tours_seen ?? []), 'welcome-learner']
    onboarding.patch({ tours_seen: next })
  }, [tourSeenAt, tourSeen, onboarding])

  // --- Home activation (PRD: intent chips · actionable stats · voice card) --
  // Everything below derives from data already on this surface — zero new
  // API calls. Each feature is independently flag-gated; flags off keeps the
  // home pixel-identical to today.
  const askSurface = useAskSurface()
  const navigate = useNavigate()
  const chipsEnabled = featureFlags.pathfinder_home_chips_enabled
  const actionableStatsEnabled = featureFlags.pathfinder_actionable_stats_enabled
  const voiceCardEnabled = featureFlags.pathfinder_voice_entry_card_enabled
  const voiceAvailable =
    Boolean(voiceConfig?.enabled) && !safetyConfig?.learner_voice_disabled
  const weeklyStatsData =
    weekly.status === 'ready' ? (weekly.stats ?? null) : null
  const homeChips = useMemo<HomeChip[]>(() => {
    if (!chipsEnabled) return []
    // Under the onboarding flag the only honest plan source is the server's;
    // flag-off (demo) builds may use the deterministic fallback path.
    const planItems = onboardingFlagOn
      ? serverPlanItems
      : todaysPath
          .filter(item => item.skillId)
          .map(item => ({
            skillId: item.skillId as string,
            label: item.title,
          }))
    return deriveHomeChips({
      stats: weeklyStatsData,
      weakTopics: weakTopicProfile.map(topic => ({
        skillId: topic.skillId,
        label: topic.label,
      })),
      planItems,
      askAvailable: Boolean(askSurface),
      voiceAvailable,
      unified: featureFlags.pathfinder_unified_assistant_enabled,
    })
  }, [
    chipsEnabled,
    onboardingFlagOn,
    serverPlanItems,
    weeklyStatsData,
    weakTopicProfile,
    todaysPath,
    askSurface,
    voiceAvailable,
  ])
  const actionableCards = useMemo<ActionableStatCard[]>(() => {
    if (!actionableStatsEnabled || !weeklyStatsData) return []
    const examLabel =
      `${learnerSetup.exam} ${learnerSetup.subject}`.trim() || undefined
    return deriveActionableStatCards({
      stats: weeklyStatsData,
      weakTopics: weakTopicProfile.map(topic => ({
        skillId: topic.skillId,
        label: topic.label,
      })),
      examLabel,
    })
  }, [
    actionableStatsEnabled,
    weeklyStatsData,
    weakTopicProfile,
    learnerSetup.exam,
    learnerSetup.subject,
  ])
  // Scroll target for the "How am I doing?" chip — the "This week" card.
  const weeklyCardRef = useRef<HTMLElement | null>(null)
  // The voice entry card is a first-class entry: flag + voice config + safety
  // gate + a mounted Ask surface, all required. Impression logged once per
  // mount, not per re-render.
  const voiceCardVisible =
    voiceCardEnabled && voiceAvailable && Boolean(askSurface)
  const voiceCardImpressionRef = useRef(false)
  useEffect(() => {
    if (!voiceCardVisible || voiceCardImpressionRef.current) return
    voiceCardImpressionRef.current = true
    logEvent('voice_card_impression', { persona: 'learner' })
  }, [voiceCardVisible])
  // A tutor exercise the learner closed partway through (≤48h old). When
  // present it takes priority over the dismissed-voice-chat resume — it is
  // the more concrete "pick up where you left off". Re-read whenever the
  // tutor closes so the card reflects the latest session.
  const [pendingExercise, setPendingExercise] =
    useState<PendingExercise | null>(null)
  useEffect(() => {
    if (!studentId || tutorOpen) return
    setPendingExercise(loadPendingExercise(studentId))
  }, [studentId, tutorOpen])
  const resumableExercise = learnerTutorEnabled ? pendingExercise : null

  function openPracticeFrom(entryPoint: string, skillId: string | null) {
    setForcedPracticeSkill(skillId)
    setPracticeOpen(true)
    logEvent('practice_opened', { entry_point: entryPoint })
  }

  // Opens the Wulo tutor hub, optionally anchored on a focus item (the chip's
  // focus skill, or a pending exercise being resumed). When the tutor feature
  // is off, falls back to the same demo diagnostic the old panel button used.
  function startStudySession(
    focus: LearnerFocusItem | null,
    entryPoint: string
  ) {
    // Unified surface: a study session is just a practice intent handed to the
    // one presentation-aware assistant, which morphs into its tutor view.
    if (featureFlags.pathfinder_unified_assistant_enabled && askSurface) {
      logEvent('tutor_opened', { entry_point: entryPoint, surface: 'unified' })
      askSurface.openAsk('text', {
        kind: 'study',
        skillId: focus?.skillId ?? null,
        skillLabel: focus?.stem ?? null,
      })
      return
    }
    if (!learnerTutorEnabled) {
      startDemoDiagnostic()
      return
    }
    setDemoActive(false)
    setDemoCompleted(false)
    setCheckInActive(false)
    setCompleted(false)
    setTutorFocusItem(focus)
    setTutorInitialMode('fullscreen')
    setTutorOpen(true)
    logEvent('tutor_opened', { entry_point: entryPoint })
  }

  function handleChipClick(chip: HomeChip) {
    logEvent('home_chip_click', { persona: 'learner', chip_id: chip.id })
    switch (chip.action.kind) {
      case 'study':
        startStudySession(
          chip.action.skillId && chip.action.skillLabel
            ? {
                stem: `A focused practice session on ${chip.action.skillLabel}`,
                skillId: chip.action.skillId,
                scored: false,
              }
            : null,
          'chip'
        )
        break
      case 'quiz':
        openPracticeFrom('chip', null)
        break
      case 'stats': {
        const reduceMotion = window.matchMedia?.(
          '(prefers-reduced-motion: reduce)'
        ).matches
        weeklyCardRef.current?.scrollIntoView?.({
          behavior: reduceMotion ? 'auto' : 'smooth',
          block: 'start',
        })
        break
      }
      case 'ask':
        askSurface?.openAsk(chip.action.mode)
        break
      case 'goal':
        navigate(
          featureFlags.pathfinder_goal_intake_enabled ? '/goals' : '/welcome'
        )
        break
    }
  }

  function handleStatCardCta(card: ActionableStatCard) {
    if (!card.cta) return
    logEvent('stat_card_cta_click', {
      persona: 'learner',
      card_id: card.id,
      value_band: card.band,
    })
    if (card.cta.action.kind === 'practice') {
      openPracticeFrom('stat_card', card.cta.action.skillId)
    }
  }

  function startVoiceFromCard() {
    logEvent('voice_card_start', { entry: 'home_card', persona: 'learner' })
    askSurface?.openAsk('voice')
  }

  function resumeExerciseFromCard() {
    if (!pendingExercise) return
    logEvent('voice_card_start', {
      entry: 'home_card',
      persona: 'learner',
      resume: 'exercise',
    })
    startStudySession(
      {
        stem: pendingExercise.stem,
        skillId: pendingExercise.skillId ?? undefined,
        scored: false,
      },
      'resume_card'
    )
  }

  function startCheckIn(skillId?: string, subject?: string) {
    setDemoActive(false)
    setDemoCompleted(false)
    setActiveSkill(skillId ?? null)
    setActiveSubject(subject ?? null)
    setCompleted(false)
    setCheckInActive(true)
    setPanelKey(value => value + 1)
  }

  function openTutorForPathItem(item: Activity) {
    // Unified surface: route the learning-path item through the one assistant
    // as a study intent so it opens in the focused tutor presentation.
    if (featureFlags.pathfinder_unified_assistant_enabled && askSurface) {
      logEvent('tutor_opened', { entry_point: 'path_item', surface: 'unified' })
      askSurface.openAsk('text', {
        kind: 'study',
        skillId: item.skillId ?? null,
        skillLabel: item.title ?? null,
      })
      return
    }
    if (!learnerTutorEnabled) {
      startCheckIn(item.skillId, item.subject)
      return
    }
    setDemoActive(false)
    setDemoCompleted(false)
    setCheckInActive(false)
    setCompleted(false)
    setTutorFocusItem({
      stem: item.title,
      skillId: item.skillId,
      rationale: item.meta,
      scored: false,
    })
    setTutorInitialMode('fullscreen')
    setTutorOpen(true)
  }

  function startDemoDiagnostic() {
    setActiveSkill(null)
    setActiveSubject(null)
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

  function startStudyWithWulo() {
    startStudySession(null, 'panel')
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

  async function handleDemoAnswer(
    step: DemoStep,
    option: DemoStep['options'][number]
  ) {
    const canScoreStep = step.options.some(candidate => candidate.correct)
    const shouldAdapt =
      canScoreStep && !option.correct && Boolean(step.adaptation)
    let nextQueue = demoStepQueue
    if (shouldAdapt && step.adaptation) {
      const nextStepAlreadyInserted =
        demoStepQueue[demoStepIndex + 1]?.id === step.adaptation.nextStep.id
      nextQueue = nextStepAlreadyInserted
        ? demoStepQueue
        : [
            ...demoStepQueue.slice(0, demoStepIndex + 1),
            step.adaptation.nextStep,
            ...demoStepQueue.slice(demoStepIndex + 1),
          ]
      setDemoStepQueue(nextQueue)
      setAdaptiveMoment({
        title: step.adaptation.title,
        body: step.adaptation.body,
      })
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
          setDemoSyncNote(
            'Voice sample queued locally and will sync when voice is available.'
          )
        }
      } catch {
        setDemoSyncNote(
          'Voice sample queued locally and will sync when connection returns.'
        )
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
        payload: 'Bawo ni teacher, I want to practise ratio.',
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
    setLearnerSetup({ [field]: value })
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
          action:
            wrongAnswerExplanation?.revisionAction ??
            'Add to daily revision plan.',
        })
      )
    } catch {
      // Revision-plan edits remain visible even if local storage is unavailable.
    }

    // W8 — persist the 3-card spaced-retrieval schedule and request push permission.
    const topicId = generatedPlanPractice.planId
    const now = Date.now()
    const minutes = (m: number) => new Date(now + m * 60_000).toISOString()
    const days = (d: number) =>
      new Date(now + d * 24 * 60 * 60_000).toISOString()
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

  const learnerDisplayName = learnerSetup.firstName.trim() || 'there'
  const todaysPathMinutesTotal = todaysPath.reduce(
    (sum, item) => sum + item.minutes,
    0
  )
  const parentSummaryText = `Your Wulo Academy update: ${learnerSetup.exam} ${learnerSetup.year} ${learnerSetup.subject}. Current focus: Ratio and proportion at 42% mastery. Today: 5 min diagnostic, explain one mistake, practise one similar question. Career signals: data/business and health sciences are worth exploring while chemistry and algebra improve.`

  function persistShare() {
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

  async function handleCopySummary() {
    persistShare()
    const result = await copyParentSummary(parentSummaryText)
    if (result.ok) {
      setShareCopied(true)
      setShareStatus('Summary copied to clipboard.')
      logEvent('parent_summary_shared', { channel: result.channel })
      window.setTimeout(() => setShareCopied(false), 2200)
    } else {
      setShareStatus('Copy unavailable — select the text to copy.')
    }
  }

  async function handleShareSummary() {
    persistShare()
    const result = await shareParentSummary(parentSummaryText)
    if (!result.ok) return
    if (result.channel === 'web_share') {
      setShareStatus('Shared.')
    } else {
      setShareStatus('Opening WhatsApp…')
    }
    logEvent('parent_summary_shared', { channel: result.channel })
  }

  return (
    <section className={styles.root} data-testid="route-student-home">
      <div className={styles.main}>
        <article className={styles.hero} data-testid="learner-hero-card">
          <div className={styles.heroLayout}>
            <div className={styles.heroLeft}>
              <div className={styles.heroHeaderRow}>
                <div className={styles.heroCopy}>
                  <h1
                    className={styles.heroTitle}
                    data-testid="learner-hero-title"
                  >
                    Good afternoon, {learnerDisplayName}
                  </h1>
                  <p className={styles.heroSub} data-testid="learner-hero-sub">
                    {todaysPath.length} things today · about{' '}
                    {todaysPathMinutesTotal} minutes · you’re on pace for
                    Friday’s target.
                  </p>
                </div>
              </div>

              {chipsEnabled && homeChips.length > 0 && (
                <div
                  className={styles.chipRow}
                  data-testid="home-intent-chips"
                >
                  {homeChips.map(chip => {
                    const ChipIcon = chipIcons[chip.id] ?? SparklesIcon
                    return (
                      <button
                        key={chip.id}
                        type="button"
                        className={styles.intentChip}
                        onClick={() => handleChipClick(chip)}
                        aria-label={chip.ariaLabel}
                        data-testid={`home-chip-${chip.id}`}
                      >
                        <ChipIcon
                          className={styles.intentChipIcon}
                          aria-hidden="true"
                        />
                        <span>{chip.label}</span>
                      </button>
                    )
                  })}
                </div>
              )}

              {voiceCardVisible && (
                <section
                  className={styles.voiceEntryCard}
                  aria-label="Talk it through with Wulo"
                  data-testid="voice-entry-card"
                >
                  <span className={styles.voiceEntryIcon} aria-hidden="true">
                    <MicrophoneIcon style={{ width: 22, height: 22 }} />
                  </span>
                  <div className={styles.voiceEntryCopy}>
                    <Text className={styles.cardTitle}>
                      {resumableExercise || askSurface?.voiceSessionDismissed
                        ? 'Pick up where you left off'
                        : 'Talk it through with Wulo'}
                    </Text>
                    <p className={styles.voiceEntryHint}>
                      {resumableExercise
                        ? `You stopped mid-exercise — jump back into “${resumableExercise.stem.length > 90 ? `${resumableExercise.stem.slice(0, 90)}…` : resumableExercise.stem}”.`
                        : askSurface?.voiceSessionDismissed
                          ? 'Your last voice session is saved — resume any time.'
                          : 'Stuck on something? Say it out loud and work through it together.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={styles.voiceEntryButton}
                    onClick={
                      resumableExercise
                        ? resumeExerciseFromCard
                        : startVoiceFromCard
                    }
                    data-testid="voice-entry-start"
                  >
                    {resumableExercise
                      ? 'Resume exercise'
                      : askSurface?.voiceSessionDismissed
                        ? 'Resume session'
                        : 'Start talking'}
                  </button>
                </section>
              )}

              {actionableStatsEnabled && actionableCards.length > 0 ? (
                <div
                  className={styles.statCardGrid}
                  data-testid="actionable-stats"
                >
                  {actionableCards.map(card => (
                    <div
                      key={card.id}
                      className={styles.heroMetricCard}
                      data-testid={`stat-card-${card.id}`}
                    >
                      <span className={styles.weekLabel}>{card.label}</span>
                      <span className={styles.weekValue}>{card.value}</span>
                      <span className={styles.weekDelta}>{card.meaning}</span>
                      {card.cta && (
                        <button
                          type="button"
                          className={styles.statCardCta}
                          onClick={() => handleStatCardCta(card)}
                          data-testid={`stat-card-cta-${card.id}`}
                        >
                          {card.cta.label}
                          <ArrowRightIcon
                            style={{ width: 14, height: 14 }}
                            aria-hidden="true"
                          />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.heroMetricGrid}>
                  {resolvedWeeklyTiles.map(tile => (
                    <div key={tile.label} className={styles.heroMetricCard}>
                      <span className={styles.weekLabel}>{tile.label}</span>
                      <span className={styles.weekValue}>{tile.value}</span>
                      <span className={styles.weekDelta}>{tile.delta}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className={styles.heroWorkGrid}>
                <section className={styles.heroPanel}>
                  <div className={styles.heroPanelHeader}>
                    <Text className={styles.cardTitle}>Today’s path</Text>
                    <span className={styles.softBadge}>
                      {todaysPath.length} steps
                    </span>
                  </div>
                  <div className={styles.heroPathList}>
                    {todaysPath.map(item => (
                      <button
                        key={item.id}
                        type="button"
                        className={styles.heroPathRow}
                        onClick={() => openTutorForPathItem(item)}
                        data-testid={`hero-path-row-${item.id}`}
                      >
                        <span className={styles.heroStepIcon} aria-hidden="true">
                          <PlayCircleIcon style={{ width: 19, height: 19 }} />
                        </span>
                        <span className={styles.pathTitle}>
                          <span className={styles.pathTitleText}>
                            {item.title}
                          </span>
                          <span className={styles.pathMeta}>{item.meta}</span>
                        </span>
                        <span className={styles.heroStepBadge}>
                          {item.type === 'check-in'
                            ? 'Now'
                            : item.type === 'practice'
                              ? 'Next'
                              : 'Done'}
                        </span>
                        <span className={styles.heroPlayButton} aria-hidden="true">
                          <PlayCircleIcon style={{ width: 18, height: 18 }} />
                        </span>
                      </button>
                    ))}
                  </div>
                  {/* The "Study with Wulo" panel button is superseded by the
                      hero chip when intent chips are on — one flagship entry,
                      not two. Flag-off builds keep the legacy button. */}
                  {!chipsEnabled && (
                    <div className={styles.heroActions}>
                      <button
                        type="button"
                        className={styles.tutorMiniButton}
                        onClick={startStudyWithWulo}
                        data-testid={
                          learnerTutorEnabled
                            ? 'start-learner-tutor'
                            : 'start-checkin'
                        }
                      >
                        <span
                          className={styles.studyActionContent}
                          data-testid={
                            learnerTutorEnabled ? 'start-checkin' : undefined
                          }
                        >
                          <span className={styles.tutorOrb} aria-hidden="true">
                            <span className={styles.tutorOrbHalo} />
                          </span>
                          <span>Study with Wulo</span>
                          <ArrowRightIcon
                            style={{ width: 16, height: 16 }}
                            aria-hidden="true"
                          />
                        </span>
                      </button>
                    </div>
                  )}
                </section>

                <section className={styles.heroPanel}>
                  <div className={styles.heroPanelHeader}>
                    <Text className={styles.cardTitle}>Where to focus</Text>
                    <span className={styles.softBadge}>Repair</span>
                  </div>
                  <div className={styles.focusList}>
                    {weakTopicProfile.slice(0, 3).map(topic => (
                      <div key={topic.skillId} className={styles.focusItem}>
                        <div className={styles.focusItemTop}>
                          <span className={styles.pathTitleText}>
                            {topic.label}
                          </span>
                          <span className={styles.softBadge}>
                            {topic.mastery < 50
                              ? 'Needs support'
                              : topic.mastery < 70
                                ? 'Developing'
                                : 'Approaching'}
                          </span>
                        </div>
                        <div
                          className={styles.focusBar}
                          aria-label={`${topic.label} mastery`}
                        >
                          <span
                            className={styles.focusFill}
                            style={{ width: `${topic.mastery}%` }}
                          />
                        </div>
                        <span className={styles.pathMeta}>
                          Next: {topic.nextAction}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              </div>

              {voiceConfig?.enabled && safetyConfig?.learner_voice_disabled && (
                <div
                  data-testid="voice-checkin-disabled-notice"
                  style={{ marginTop: 12, fontSize: '0.85rem', opacity: 0.85 }}
                >
                  Voice check-in is paused right now. You can still keep
                  learning with the activities above.
                </div>
              )}
              {voiceConfig?.enabled && !safetyConfig?.learner_voice_disabled && (
                <div
                  style={{
                    marginTop: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  {!learnerTutorEnabled && (
                    <button
                      type="button"
                      className={styles.voiceButton}
                      onClick={startVoiceCheckIn}
                      disabled={voiceBusy}
                      data-testid="start-voice-checkin"
                    >
                      {voiceBusy
                        ? 'Preparing voice check-in…'
                        : 'Voice check-in'}
                    </button>
                  )}
                  {voiceResult && (
                    <div
                      data-testid="voice-frame-result"
                      style={{ fontSize: '0.8rem', opacity: 0.85 }}
                    >
                      Voice response saved for sync.
                    </div>
                  )}
                  {voiceError && (
                    <div
                      data-testid="voice-frame-error"
                      style={{ fontSize: '0.8rem', color: '#ffb4b4' }}
                    >
                      Voice unavailable: {voiceError}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </article>

        <article className={styles.card} data-testid="b2c-learner-setup">
          <div className={styles.cardHeader}>
            <div>
              <Text className={styles.cardTitle}>Your exam path</Text>
              <p className={styles.demoHelper} style={{ margin: '4px 0 0' }}>
                {learnerSetup.exam} · {learnerSetup.year} ·{' '}
                {learnerSetup.subject}
              </p>
            </div>
            <button
              type="button"
              className={styles.textAction}
              style={{ marginTop: 0 }}
              onClick={() => setExamPathOpen(open => !open)}
              aria-expanded={examPathOpen}
              data-testid="change-exam-path"
            >
              {examPathOpen ? 'Done' : 'Change exam path'}
            </button>
          </div>
          {examPathOpen &&
            (featureFlags.pathfinder_learner_onboarding_enabled ? (
              <div style={{ display: 'grid', gap: 8 }}>
                <Text>
                  Exam: <strong>{learnerSetup.exam}</strong> · Class:{' '}
                  <strong>{learnerSetup.year}</strong> · Subject:{' '}
                  <strong>{learnerSetup.subject}</strong>
                </Text>
                <Link to="/welcome" data-testid="b2c-learner-setup-edit">
                  Edit your profile
                </Link>
              </div>
            ) : (
              <div className={styles.setupGrid}>
                <label className={styles.selectField}>
                  <span className={styles.selectLabel}>
                    Your name (optional)
                  </span>
                  <input
                    className={styles.select}
                    type="text"
                    value={learnerSetup.firstName}
                    onChange={event =>
                      updateLearnerSetup('firstName', event.currentTarget.value)
                    }
                    placeholder="e.g. Tomi"
                    aria-label="Your first name"
                    maxLength={40}
                    data-testid="learner-first-name"
                  />
                </label>
                <label className={styles.selectField}>
                  <span className={styles.selectLabel}>Exam</span>
                  <select
                    className={styles.select}
                    value={learnerSetup.exam}
                    onChange={event =>
                      updateLearnerSetup('exam', event.currentTarget.value)
                    }
                    aria-label="Select exam"
                  >
                    {examOptions.map(option => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.selectField}>
                  <span className={styles.selectLabel}>Class / year</span>
                  <select
                    className={styles.select}
                    value={learnerSetup.year}
                    onChange={event =>
                      updateLearnerSetup('year', event.currentTarget.value)
                    }
                    aria-label="Select class or year"
                  >
                    {yearOptions.map(option => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.selectField}>
                  <span className={styles.selectLabel}>Subject area</span>
                  <select
                    className={styles.select}
                    value={learnerSetup.subject}
                    onChange={event =>
                      updateLearnerSetup('subject', event.currentTarget.value)
                    }
                    aria-label="Select subject"
                  >
                    {subjectOptions.map(option => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ))}
        </article>

        {demoActive &&
          (() => {
            const step = demoStepQueue[demoStepIndex] ?? demoDiagnosticSteps[0]
            const StepIcon = step.icon
            return (
              <article
                ref={demoDiagnosticRef}
                className={styles.demoCard}
                data-testid="short-demo-diagnostic"
                tabIndex={-1}
              >
                <div className={styles.demoHeader}>
                  <div>
                    <Text className={styles.demoTitle}>
                      Wulo quick check
                    </Text>
                    <p className={styles.demoHelper}>
                      A few short signals help Wulo tune today’s practice.
                      Keyboard, mouse, or touch.
                    </p>
                  </div>
                  <div
                    className={styles.demoProgress}
                    aria-label="Demo diagnostic progress"
                  >
                    {demoStepQueue.map((item, index) => (
                      <span
                        key={item.id}
                        className={
                          index <= demoStepIndex
                            ? styles.demoDotActive
                            : styles.demoDot
                        }
                        data-testid={`demo-progress-${index + 1}`}
                      />
                    ))}
                  </div>
                </div>

                <div className={styles.demoInteractionGrid}>
                  <div className={styles.demoPromptStack}>
                    <div className={styles.demoPromptCard}>
                      <div className={styles.demoPromptHeader}>
                        <div
                          className={styles.demoPromptIcon}
                          aria-hidden="true"
                        >
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
                      <div
                        className={styles.adaptiveMoment}
                        data-testid="adaptive-moment"
                      >
                        <span className={styles.softBadge}>
                          Adaptive moment
                        </span>
                        <Text className={styles.cardTitle}>
                          {adaptiveMoment.title}
                        </Text>
                        <p className={styles.adaptiveMomentBody}>
                          {adaptiveMoment.body}
                        </p>
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
                        <span className={styles.demoOptionMeta}>
                          {option.meta ?? 'Select'}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className={styles.demoFooter}>
                  <span data-testid="demo-step-count">
                    Step {demoStepIndex + 1} of {demoStepQueue.length}
                  </span>
                  <span>
                    {demoSyncNote ?? 'Saved locally first, synced when online.'}
                  </span>
                </div>
              </article>
            )
          })()}

        {demoCompleted && (
          <article
            className={styles.demoCard}
            data-testid="short-demo-complete"
          >
            <div className={styles.demoCompleteGrid}>
              <Text className={styles.demoTitle}>Wulo quick check complete</Text>
              <p className={styles.demoHelper}>
                Numeracy, reading, voice, subject knowledge, and career interest
                signals are saved locally for teacher review.
              </p>
              <div className={styles.demoProgress}>
                {demoAnswers.map(answer => (
                  <span
                    key={`${answer.stepId}-${answer.optionId}`}
                    className={styles.softBadge}
                  >
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
            subject={activeSubject ?? undefined}
            studentId={studentId}
            onCompleted={() => setCompleted(true)}
          />
        )}

        {completed && (
          <div
            className={styles.banner}
            data-testid="diagnostic-pending-banner"
          >
            <SparklesIcon
              style={{ width: 18, height: 18 }}
              aria-hidden="true"
            />
            Plan suggestion sent to your teacher for approval.
          </div>
        )}

        <article className={styles.card} data-testid="weak-topic-profile">
          <div className={styles.cardHeader}>
            <div>
              <Text className={styles.cardTitle}>Weak-topic profile</Text>
              <p className={styles.demoHelper} style={{ margin: '4px 0 0' }}>
                Wulo Academy turns the diagnostic into the next best topics to
                repair.
              </p>
            </div>
            <span className={styles.softBadge}>After diagnostic</span>
          </div>
          <div className={styles.insightGrid}>
            {weakTopicProfile.map(topic => (
              <div key={topic.skillId} className={styles.insightCard}>
                <span className={styles.weekLabel}>
                  {topic.mastery}% mastered
                </span>
                <Text className={styles.cardTitle}>{topic.label}</Text>
                <div
                  className={styles.meterTrack}
                  aria-label={`${topic.label} mastery`}
                >
                  <span
                    className={styles.meterFill}
                    style={{ width: `${topic.mastery}%` }}
                  />
                </div>
                <span className={styles.demoHelper}>{topic.gap}</span>
                <button
                  type="button"
                  className={styles.textAction}
                  data-testid={`practise-topic-${topic.skillId}`}
                  onClick={() => startCheckIn(topic.skillId)}
                >
                  Practise this topic
                </button>
              </div>
            ))}
          </div>
        </article>

        <article
          className={styles.card}
          data-testid="career-pathway-suggestions"
        >
          <details
            className={styles.disclosure}
            open={careerOpen}
            onToggle={(e) =>
              setCareerOpen((e.currentTarget as HTMLDetailsElement).open)
            }
          >
            <summary
              className={styles.disclosureSummary}
              data-testid="career-disclosure-summary"
            >
              <div>
                <Text className={styles.cardTitle}>
                  Pathways linked to strengths
                </Text>
                <p className={styles.demoHelper} style={{ margin: '4px 0 0' }}>
                  Guidance stays exploratory: strengths, gaps, and what to work
                  on next.
                </p>
              </div>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span className={styles.softBadge}>Exploratory</span>
                <ChevronRightIcon
                  className={[styles.disclosureChevron, careerOpen && styles.disclosureChevronOpen].filter(Boolean).join(' ')}
                  aria-hidden="true"
                />
              </span>
            </summary>
            <div className={`${styles.pathwayGrid} ${styles.disclosureBody}`}>
              {careerPathwaysState.map(pathway => (
                <div key={pathway.id} className={styles.pathwayCard}>
                  <div className={styles.pathIcon} aria-hidden="true">
                    <BriefcaseIcon style={{ width: 20, height: 20 }} />
                  </div>
                  <div className={styles.pathTitle}>
                    <span className={styles.pathTitleText}>{pathway.title}</span>
                    <span className={styles.pathMeta}>
                      Strength: {pathway.strength}
                    </span>
                    <span className={styles.pathMeta}>
                      Gap to close: {pathway.gap}
                    </span>
                  </div>
                  <span className={styles.softBadge}>{pathway.fit}% fit</span>
                </div>
              ))}
            </div>
          </details>
        </article>

        <article className={styles.card} data-testid="parent-share-summary">
          <details
            className={styles.disclosure}
            open={parentOpen}
            onToggle={(e) =>
              setParentOpen((e.currentTarget as HTMLDetailsElement).open)
            }
          >
            <summary
              className={styles.disclosureSummary}
              data-testid="parent-disclosure-summary"
            >
              <div>
                <Text className={styles.cardTitle}>Parent progress summary</Text>
                <p className={styles.demoHelper} style={{ margin: '4px 0 0' }}>
                  Preview the message, then copy or share to WhatsApp.
                </p>
              </div>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <DocumentTextIcon
                  style={{ width: 22, height: 22, color: 'var(--pf-text)' }}
                  aria-hidden="true"
                />
                <ChevronRightIcon
                  className={[styles.disclosureChevron, parentOpen && styles.disclosureChevronOpen].filter(Boolean).join(' ')}
                  aria-hidden="true"
                />
              </span>
            </summary>
            <div className={`${styles.sharePanel} ${styles.disclosureBody}`}>
              <section
                className={styles.shareBubble}
                data-testid="parent-share-preview"
                aria-label="Parent summary preview"
              >
                {parentSummaryText}
              </section>
              <div className={styles.shareActions}>
                <button
                  type="button"
                  className={styles.careerAction}
                  onClick={handleCopySummary}
                  data-testid="parent-share-copy"
                  aria-label="Copy parent summary"
                >
                  <DocumentDuplicateIcon
                    style={{ width: 18, height: 18 }}
                    aria-hidden="true"
                  />
                  {shareCopied ? 'Copied!' : 'Copy'}
                </button>
                <button
                  type="button"
                  className={styles.careerActionSecondary}
                  onClick={handleShareSummary}
                  data-testid="parent-share-send"
                  aria-label="Share parent summary"
                >
                  <ShareIcon
                    style={{ width: 18, height: 18 }}
                    aria-hidden="true"
                  />
                  Share
                </button>
              </div>
              <output
                className={styles.shareLiveRegion}
                aria-live="polite"
              >
                {shareStatus ?? ''}
              </output>
              {shareStatus && (
                <span className={styles.softBadge}>{shareStatus}</span>
              )}
            </div>
          </details>
        </article>

        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <Text className={styles.cardTitle}>Today's path</Text>
            <Text className={styles.cardCaption}>~16 min total · 3 steps</Text>
          </div>
          <div className={styles.pathList}>
            {todaysPath.map(item => {
              const isExpanded = expandedStepId === item.id
              return (
                <div key={item.id}>
                  <div className={styles.pathRowShell}>
                    <button
                      type="button"
                      className={styles.pathRow}
                      style={{ textAlign: 'left', font: 'inherit' }}
                      onClick={() => {
                        setExpandedStepId(null)
                        openTutorForPathItem(item)
                      }}
                      data-testid={`path-row-${item.id}`}
                      aria-expanded={isExpanded}
                    >
                      <div className={styles.pathIcon} aria-hidden="true">
                        <PlayCircleIcon style={{ width: 20, height: 20 }} />
                      </div>
                      <div className={styles.pathTitle}>
                        <span className={styles.pathTitleText}>
                          {item.title}
                        </span>
                        <span className={styles.pathMeta}>{item.meta}</span>
                      </div>
                      <span className={styles.minutes}>
                        <ClockIcon
                          style={{ width: 14, height: 14 }}
                          aria-hidden="true"
                        />
                        {item.minutes} min
                      </span>
                      <ChevronRightIcon
                        style={{
                          width: 18,
                          height: 18,
                          color: 'var(--pf-text-tertiary)',
                        }}
                        aria-hidden="true"
                      />
                    </button>
                    <button
                      type="button"
                      className={styles.openPracticeButton}
                      onClick={() => {
                        logEvent('practice_opened', { entry_point: 'plan' })
                        setPracticeOpen(true)
                      }}
                      aria-label={`Open practice: ${item.title}`}
                      data-testid={`open-practice-${item.id}`}
                    >
                      <PlayCircleIcon
                        className={styles.openPracticeIcon}
                        aria-hidden="true"
                      />
                      <span>Open practice</span>
                    </button>
                  </div>
                  {isExpanded && (
                    <div
                      className={styles.practiceCard}
                      data-testid="today-step-mcq"
                    >
                      <div className={styles.demoHeader}>
                        <div>
                          <span className={styles.softBadge}>
                            From generated plan
                          </span>
                          <Text className={styles.demoTitle}>
                            {generatedPlanPractice.title}
                          </Text>
                          <p className={styles.demoHelper}>
                            {generatedPlanPractice.planTitle}
                          </p>
                        </div>
                        <span className={styles.softBadge}>2 min</span>
                      </div>

                      <div className={styles.practiceInteractionGrid}>
                        <div className={styles.practicePromptCard}>
                          <p className={styles.practicePrompt}>
                            {generatedPlanPractice.prompt}
                          </p>
                          <p className={styles.demoHelper}>
                            {generatedPlanPractice.hint}
                          </p>
                        </div>

                        <div className={styles.practiceOptions}>
                          {generatedPlanPractice.options.map(option => (
                            <button
                              key={option.id}
                              type="button"
                              className={
                                practiceAnswer?.optionId === option.id
                                  ? styles.practiceOptionSelected
                                  : styles.practiceOption
                              }
                              onClick={() => handlePracticeAnswer(option)}
                              disabled={Boolean(practiceAnswer)}
                            >
                              <span className={styles.practiceOptionLabel}>
                                {option.label}
                              </span>
                              <span className={styles.practiceOptionMeta}>
                                {option.meta ?? 'Choose answer'}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>

                      {practiceAnswer && (
                        <div
                          className={styles.feedbackCard}
                          data-testid="practice-feedback"
                        >
                          <span className={styles.softBadge}>
                            Immediate feedback
                          </span>
                          <Text className={styles.cardTitle}>
                            {practiceAnswer.correct
                              ? 'Correct - the plan is working.'
                              : 'Not quite - scale both parts by 3.'}
                          </Text>
                          {!practiceAnswer.correct && (
                            <button
                              type="button"
                              className={styles.textAction}
                              onClick={() =>
                                setWrongAnswerExplanation(
                                  practiceWrongAnswerExplanation
                                )
                              }
                            >
                              Explain my mistake
                            </button>
                          )}
                          <p className={styles.demoHelper}>
                            {practiceAnswer.correct
                              ? '2 cups of rice became 6 cups, so 3 cups of water becomes 9 cups.'
                              : 'The worked example says keep the rice-water ratio: 2 -> 6 is x3, so 3 -> 9.'}
                          </p>
                          <span className={styles.softBadge}>
                            Spaced retrieval scheduled
                          </span>
                          <ul
                            className={styles.retrievalList}
                            data-testid="spaced-retrieval-schedule"
                          >
                            {generatedPlanPractice.schedule.map(slot => (
                              <li
                                key={slot.id}
                                className={styles.retrievalItem}
                              >
                                <Text weight="semibold">
                                  {slot.label} · {slot.timing}
                                </Text>
                                <span className={styles.demoHelper}>
                                  {slot.focus}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <div
            className={styles.pathRevisionFooter}
            data-testid="daily-revision-plan"
          >
            <div className={styles.pathRevisionHeader}>
              <Text className={styles.pathRevisionTitle}>More to revise</Text>
              <span className={styles.softBadge}>
                {revisionMinutesTotal} min today
              </span>
            </div>
            <div className={styles.planGrid}>
              {derivedRevisionPlan.map(item => (
                <div key={item.id} className={styles.insightCard}>
                  <span className={styles.weekLabel}>{item.minutes} min</span>
                  <Text className={styles.cardTitle}>{item.label}</Text>
                  <span className={styles.demoHelper}>{item.reason}</span>
                </div>
              ))}
              {revisionPlanAdded && (
                <div
                  className={styles.insightCard}
                  data-testid="revision-plan-added"
                >
                  <span className={styles.weekLabel}>Added from mistake</span>
                  <Text className={styles.cardTitle}>Ratio table repair</Text>
                  <span className={styles.demoHelper}>
                    One similar question has been added to tomorrow's retrieval
                    slot.
                  </span>
                </div>
              )}
            </div>
          </div>
        </article>

        <article
          ref={weeklyCardRef}
          className={styles.card}
          data-testid="weekly-stats-card"
        >
          <div className={styles.cardHeader}>
            <Text className={styles.cardTitle}>This week</Text>
            <Text className={styles.cardCaption}>
              Mon — Sun · progress updated daily
            </Text>
          </div>
          <div className={styles.weekGrid}>
            {resolvedWeeklyTiles.map(tile => (
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
          <p
            style={{
              fontSize: '0.88rem',
              color: 'var(--pf-text-secondary)',
              lineHeight: 1.5,
              margin: 0,
            }}
          >
            {upNext.label}
          </p>
          <button
            type="button"
            className={styles.textAction}
            onClick={() => startCheckIn(upNext.skillId)}
            data-testid="preview-path"
          >
            Preview path
          </button>
        </article>

        <article className={styles.card} data-testid="sidebar-trust">
          <details
            className={styles.disclosure}
            open={trustOpen}
            onToggle={(e) =>
              setTrustOpen((e.currentTarget as HTMLDetailsElement).open)
            }
          >
            <summary
              className={styles.disclosureSummary}
              data-testid="trust-disclosure-summary"
            >
              <Text className={styles.cardTitle}>Trust</Text>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span className={styles.softBadge}>All gates green</span>
                <ChevronRightIcon
                  className={[styles.disclosureChevron, trustOpen && styles.disclosureChevronOpen].filter(Boolean).join(' ')}
                  aria-hidden="true"
                />
              </span>
            </summary>
            <p
              className={styles.disclosureBody}
              style={{
                fontSize: '0.82rem',
                color: 'var(--pf-text-secondary)',
                lineHeight: 1.5,
                margin: 0,
              }}
            >
              Every recommendation is designed to be safe and responsible. Evidence and activity log
              available in <Link to="/trust">Trust &amp; Safety</Link>.
            </p>
          </details>
        </article>
      </aside>

      {practiceOpen && (
        <PracticeFullscreen
          open={practiceOpen}
          onClose={closePractice}
          childId={studentId ?? 'demo-student'}
          exam={learnerSetup.exam}
          classYear={learnerSetup.year}
          subject={learnerSetup.subject}
          skillId={forcedPracticeSkill ?? undefined}
        />
      )}

      {learnerTutorEnabled && tutorOpen && (
        <LearnerTutorFullscreen
          open={tutorOpen}
          onClose={() => {
            setTutorOpen(false)
            setTutorFocusItem(null)
            setTutorVoice({ state: 'idle', inputLevel: 0, recording: false })
          }}
          childId={studentId ?? 'demo-student'}
          exam={learnerSetup.exam}
          classYear={learnerSetup.year}
          subject={learnerSetup.subject}
          focusItem={tutorFocusItem}
          onVoiceStateChange={setTutorVoice}
          initialMode={tutorInitialMode}
        />
      )}

      {wrongAnswerExplanation && (
        <div
          className={styles.modalBackdrop}
          role="presentation"
          data-testid="wrong-answer-modal-backdrop"
        >
          <dialog
            open
            className={styles.modal}
            aria-modal="true"
            aria-labelledby="wrong-answer-modal-title"
            data-testid="wrong-answer-explanation-modal"
          >
            <div className={styles.modalHeader}>
              <div>
                <span className={styles.softBadge}>
                  Wrong answer explanation
                </span>
                <h2
                  id="wrong-answer-modal-title"
                  className={styles.demoTitle}
                  style={{ margin: '8px 0 0' }}
                >
                  Explain my mistake
                </h2>
              </div>
              <button
                type="button"
                className={styles.modalClose}
                aria-label="Close explanation"
                onClick={() => setWrongAnswerExplanation(null)}
              >
                <XMarkIcon
                  style={{ width: 18, height: 18 }}
                  aria-hidden="true"
                />
              </button>
            </div>
            <div className={styles.explanationGrid}>
              <div className={styles.explanationTile}>
                <span className={styles.weekLabel}>Correct answer</span>
                <Text className={styles.cardTitle}>
                  {wrongAnswerExplanation.correctAnswer}
                </Text>
              </div>
              <div className={styles.explanationTile}>
                <span className={styles.weekLabel}>
                  Why your answer was wrong
                </span>
                <span className={styles.demoHelper}>
                  {wrongAnswerExplanation.whyWrong}
                </span>
              </div>
              <div className={styles.explanationTile}>
                <span className={styles.weekLabel}>Concept you missed</span>
                <span className={styles.demoHelper}>
                  {wrongAnswerExplanation.conceptMissed}
                </span>
              </div>
              <div className={styles.explanationTile}>
                <span className={styles.weekLabel}>Simpler explanation</span>
                <span className={styles.demoHelper}>
                  {wrongAnswerExplanation.simplerExplanation}
                </span>
              </div>
              <div className={styles.explanationTile}>
                <span className={styles.weekLabel}>
                  Try another similar question
                </span>
                <span className={styles.demoHelper}>
                  {wrongAnswerExplanation.similarQuestion}
                </span>
              </div>
              <div className={styles.explanationTile}>
                <span className={styles.weekLabel}>
                  Add this weakness to my revision plan
                </span>
                <span className={styles.demoHelper}>
                  {wrongAnswerExplanation.revisionAction}
                </span>
              </div>
            </div>
            <div className={styles.shareActions}>
              <button
                type="button"
                className={styles.careerAction}
                onClick={addWeaknessToPlan}
              >
                <ChartBarIcon
                  style={{ width: 18, height: 18 }}
                  aria-hidden="true"
                />
                Add weakness to revision plan
              </button>
              <button
                type="button"
                className={styles.careerActionSecondary}
                onClick={() => startCheckIn('ratio-proportion')}
              >
                Try similar question
              </button>
            </div>
          </dialog>
        </div>
      )}
    </section>
  )
}
