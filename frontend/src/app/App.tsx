/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
  Button,
  Card,
  Dialog,
  DialogActions,
  DialogBody,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Option,
  Spinner,
  Text,
  makeStyles,
  mergeClasses,
} from '@fluentui/react-components'
import {
  ClipboardDocumentCheckIcon,
  HeartIcon,
  AdjustmentsHorizontalIcon,
  Bars3Icon,
} from '@heroicons/react/24/outline'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { AssessmentPanel } from '../components/AssessmentPanel'
import { AuthGateScreen } from '../components/AuthGateScreen'
import { LogoutScreen } from '../components/LogoutScreen'
import { ChildHome } from '../components/ChildHome'
import { ConsentScreen } from '../components/ConsentScreen'
import { DashboardHome } from '../components/DashboardHome'
import { ModeSelector } from '../components/ModeSelector'
import { OnboardingFlow } from '../components/OnboardingFlow'
import { ProgressDashboard } from '../components/ProgressDashboard'
import { SessionScreen } from '../components/SessionScreen'
import { SessionLaunchOverlay } from '../components/SessionLaunchOverlay'
import { SettingsView } from '../components/SettingsView'
import { SidebarNav } from '../components/SidebarNav'
import { useAudioPlayer } from '../hooks/useAudioPlayer'
import { useRealtime } from '../hooks/useRealtime'
import type { RecorderAudioChunk } from '../hooks/useRecorder'
import { useRecorder } from '../hooks/useRecorder'
import { useScenarios } from '../hooks/useScenarios'
import { useSessionTimer } from '../hooks/useSessionTimer'
import { useWebRTC } from '../hooks/useWebRTC'
import { api, parseAvatarValue, type AuthSession } from '../services/api'
import type {
  Assessment,
  AppConfig,
  AvatarOption,
  ChildProfile,
  CustomScenario,
  ExerciseMetadata,
  PilotState,
  PlannerReadiness,
  PronunciationAssessment,
  PracticePlan,
  Scenario,
  SessionDetail,
  SessionSummary,
  TherapistFeedbackRating,
} from '../types'
import { AVATAR_OPTIONS, DEFAULT_AVATAR } from '../types'
import { APP_ROUTE_PARAMS, APP_ROUTES, getDefaultAuthenticatedRoute, resolveAppRoute, type AppRoute } from './routes'

type ConversationTurn = {
  role: string
  content: string
}

type RealtimeMessage = {
  type?: string
  name?: string
  call_id?: string
  session?: {
    avatar?: {
      ice_servers?: string[]
      username?: string
      ice_username?: string
      credential?: string
      ice_credential?: string
    }
    rtc?: {
      ice_servers?: string[]
      ice_username?: string
      ice_credential?: string
    }
    ice_servers?: string[]
    ice_username?: string
    ice_credential?: string
  }
  server_sdp?: unknown
  sdp?: unknown
  answer?: unknown
}

type UserMode = 'therapist' | 'child'
type TherapistGateIntent = 'review' | 'start-session' | 'mode-switch'
type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'error'
type SidebarSection = 'home' | 'dashboard' | 'settings'

type PrewarmedAgent = {
  key: string
  agentId: string
}

const CHILD_TURN_LIMIT = 4
const CHILD_MAX_TURNS = 8
const THERAPIST_AUTO_SUMMARY_TURN_LIMIT = 4
const AFFIRMATIVE_FINISH_PATTERN = /\b(yes|yeah|yep|ok|okay|sure|done|finished)\b/i
const LAUNCH_HANDOFF_DELAY_MS = 240

function isCustomScenario(
  scenario: Scenario | CustomScenario | null | undefined
): scenario is CustomScenario {
  return Boolean(scenario && 'scenarioData' in scenario)
}

function getReferenceText(scenario: Scenario | CustomScenario | null): string {
  if (!scenario) return ''

  if (isCustomScenario(scenario)) {
    if (scenario.scenarioData.exerciseType === 'listening_minimal_pairs') {
      return ''
    }

    if (scenario.scenarioData.exerciseType === 'silent_sorting') {
      return ''
    }

    if (scenario.scenarioData.exerciseType === 'sound_isolation') {
      return scenario.scenarioData.targetWords[0] || scenario.scenarioData.targetSound
    }

    if (scenario.scenarioData.exerciseType === 'vowel_blending') {
      return scenario.scenarioData.targetWords[0] || scenario.scenarioData.targetSound
    }

    if (
      scenario.scenarioData.exerciseType === 'sentence_repetition' ||
      scenario.scenarioData.exerciseType === 'guided_prompt'
    ) {
      return (
        scenario.scenarioData.promptText ||
        scenario.scenarioData.targetWords.join(' ')
      )
    }

    return scenario.scenarioData.targetWords.join(' ')
  }

  if (scenario.exerciseMetadata?.type === 'listening_minimal_pairs') {
    return ''
  }

  if (scenario.exerciseMetadata?.type === 'silent_sorting') {
    return ''
  }

  if (scenario.exerciseMetadata?.type === 'sound_isolation') {
    return scenario.exerciseMetadata.targetWords?.[0] || scenario.exerciseMetadata.targetSound || ''
  }

  if (scenario.exerciseMetadata?.type === 'vowel_blending') {
    return scenario.exerciseMetadata.targetWords?.[0] || scenario.exerciseMetadata.targetSound || ''
  }

  return scenario.exerciseMetadata?.targetWords?.join(' ') || ''
}

function getExerciseMetadata(
  scenario: Scenario | CustomScenario | null
): Partial<ExerciseMetadata> | undefined {
  if (!scenario) return undefined

  if (isCustomScenario(scenario)) {
    return {
      type: scenario.scenarioData.exerciseType,
      targetSound: scenario.scenarioData.targetSound,
      targetWords: scenario.scenarioData.targetWords,
      difficulty: scenario.scenarioData.difficulty,
      childAge: scenario.scenarioData.childAge,
    }
  }

  return scenario.exerciseMetadata
}

function getAvatarName(avatarValue: string | undefined): string {
  const avatar = AVATAR_OPTIONS.find(
    (option: AvatarOption) => option.value === avatarValue
  )

  return avatar?.label.split(' (')[0] || 'your practice buddy'
}

function getAvatarPersona(avatarValue: string | undefined): string {
  const avatar = AVATAR_OPTIONS.find(
    (option: AvatarOption) => option.value === avatarValue
  )

  return avatar?.persona || 'a warm adult speech-practice buddy'
}

function getSectionRoute(section: SidebarSection): AppRoute {
  if (section === 'dashboard') {
    return APP_ROUTES.dashboard
  }

  if (section === 'settings') {
    return APP_ROUTES.settings
  }

  return APP_ROUTES.home
}

function getSectionForRoute(route: AppRoute | null): SidebarSection | null {
  if (route === APP_ROUTES.dashboard) {
    return 'dashboard'
  }

  if (route === APP_ROUTES.settings) {
    return 'settings'
  }

  if (route === APP_ROUTES.home) {
    return 'home'
  }

  return null
}

function buildChildIntroInstructions({
  childName,
  avatarName,
  avatarPersona,
  scenarioName,
  scenarioDescription,
}: {
  childName?: string | null
  avatarName: string
  avatarPersona: string
  scenarioName?: string | null
  scenarioDescription?: string | null
}): string {
  const childLabel = childName || 'my friend'
  const exerciseLabel = scenarioName || "today's practice"
  const exerciseContext = scenarioDescription
    ? `Briefly mention this practice focus: ${scenarioDescription}.`
    : 'Briefly mention that you will practice together.'

  return [
    `You are ${avatarName}, ${avatarPersona}, and a warm speech-practice buddy for a child named ${childLabel}.`,
    'Speak first to begin the session.',
    `In two short, friendly sentences, greet ${childLabel}, say you are starting ${exerciseLabel}, and tell them to tap the microphone when they are ready to talk.`,
    exerciseContext,
    'Never use the word "test". Always say "practice" or "exercise".',
    'Keep the tone calm, encouraging, and child-friendly. Keep it under 35 words.',
  ].join(' ')
}

function buildTherapistIntroInstructions({
  childName,
  avatarName,
  avatarPersona,
  scenarioName,
  scenarioDescription,
}: {
  childName?: string | null
  avatarName: string
  avatarPersona: string
  scenarioName?: string | null
  scenarioDescription?: string | null
}): string {
  const childLabel = childName || 'the child'
  const exerciseLabel = scenarioName || "today's practice"
  const exerciseContext = scenarioDescription
    ? `Briefly mention this practice focus: ${scenarioDescription}.`
    : 'Briefly mention that you will guide the practice together.'

  return [
    `You are ${avatarName}, ${avatarPersona}, and a warm speech-practice buddy supporting a therapist and ${childLabel}.`,
    'Speak first to begin the session.',
    `In two short sentences, welcome the therapist, say you are starting ${exerciseLabel} with ${childLabel}, and ask them to tap the microphone when they are ready to begin.`,
    exerciseContext,
    'Keep the tone calm, observational, and supportive. Keep it under 35 words.',
  ].join(' ')
}

function buildAgentWarmKey(scenarioId: string, avatarValue: string): string {
  return `${scenarioId}::${avatarValue}`
}

const useStyles = makeStyles({
  page: {
    width: '100%',
    minHeight: '100vh',
    display: 'flex',
    overflow: 'hidden',
  },
  shell: {
    width: '100%',
    maxWidth: '1280px',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-xl)',
    margin: '0 auto',
    padding: 'var(--space-xl)',
    overflow: 'auto',
    '@media (max-width: 720px)': {
      paddingTop: 'calc(env(safe-area-inset-top, 0px) + var(--space-lg))',
      paddingRight: 'var(--space-md)',
      paddingBottom: 'var(--space-md)',
      paddingLeft: 'var(--space-md)',
    },
  },
  appShell: {
    width: '100%',
    minHeight: '100vh',
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 1fr)',
    backgroundColor: 'rgba(255, 251, 244, 0.9)',
    '@media (max-width: 720px)': {
      gridTemplateColumns: '1fr',
    },
  },
  appShellDashboard: {
  },
  contentArea: {
    minWidth: 0,
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'auto',
  },
  contentAreaDashboard: {
  },
  contentHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-md)',
    padding: 'var(--space-lg) var(--space-xl) var(--space-md)',
    borderBottom: '1px solid var(--color-border)',
    backgroundColor: 'rgba(253, 250, 244, 0.94)',
    backdropFilter: 'blur(14px)',
    position: 'sticky',
    top: 0,
    zIndex: 10,
    '@media (max-width: 720px)': {
      paddingTop: 'calc(env(safe-area-inset-top, 0px) + var(--space-md))',
      paddingRight: 'var(--space-md)',
      paddingBottom: 'var(--space-sm)',
      paddingLeft: 'var(--space-md)',
      alignItems: 'flex-start',
      flexDirection: 'column',
    },
  },
  contentHeaderDashboard: {
  },
  headerLead: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-md)',
    minWidth: 0,
  },
  contentMenuButton: {
    display: 'none',
    '@media (max-width: 720px)': {
      display: 'inline-flex',
    },
  },
  contentHeading: {
    display: 'grid',
    gap: '2px',
    minWidth: 0,
  },
  contentEyebrow: {
    color: 'var(--color-text-tertiary)',
    fontSize: '0.72rem',
    fontWeight: '700',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
  contentEyebrowDashboard: {
    color: 'rgba(255, 255, 255, 0.7)',
  },
  contentTitle: {
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-primary)',
    fontSize: '1.25rem',
    fontWeight: '800',
    letterSpacing: '-0.03em',
  },
  contentTitleDashboard: {
    color: 'var(--color-text-inverse)',
  },
  contentSubtitle: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.82rem',
    lineHeight: 1.45,
    maxWidth: '48ch',
  },
  contentSubtitleDashboard: {
    color: 'rgba(255, 255, 255, 0.82)',
  },
  contentBody: {
    width: '100%',
    maxWidth: '1320px',
    margin: '0 auto',
    padding: 'var(--space-xl)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-xl)',
    '@media (max-width: 720px)': {
      padding: 'var(--space-md)',
      gap: 'var(--space-lg)',
    },
  },
  brandRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-md)',
    padding: 'var(--space-sm) 0 var(--space-md)',
    '@media (max-width: 760px)': {
      flexDirection: 'column',
      alignItems: 'flex-start',
    },
  },
  brandBlock: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-sm)',
  },
  brandHomeButton: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-sm)',
    padding: 0,
    border: 'none',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    textAlign: 'left',
    borderRadius: 'var(--radius-md)',
    transition: 'transform var(--transition-fast), opacity var(--transition-fast)',
    '&:hover': {
      transform: 'translateY(-1px)',
    },
    '&:focus-visible': {
      outline: '2px solid var(--color-primary)',
      outlineOffset: '4px',
    },
    '&:disabled': {
      cursor: 'default',
      opacity: 0.9,
    },
  },
  brandLogo: {
    width: '56px',
    height: '56px',
    objectFit: 'contain',
    filter: 'none',
  },
  appTitle: {
    fontFamily: 'var(--font-display)',
    background: 'linear-gradient(135deg, var(--color-primary-dark), var(--color-primary))',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    color: 'var(--color-text-primary)',
    fontWeight: '800',
    fontSize: '1rem',
    letterSpacing: '-0.03em',
  },
  appSubtitle: {
    display: 'block',
    color: 'var(--color-text-secondary)',
    fontSize: '0.8rem',
  },
  brandActions: {
    display: 'flex',
    gap: 'var(--space-sm)',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  setupLayout: {
    display: 'grid',
    gridTemplateColumns: '340px minmax(0, 1fr)',
    gap: 'var(--space-xl)',
    alignItems: 'start',
    '@media (max-width: 1080px)': {
      gridTemplateColumns: '1fr',
      gap: 'var(--space-lg)',
    },
  },
  introCard: {
    padding: 'var(--space-lg)',
    borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--color-border)',
    background:
      'radial-gradient(circle at right center, rgba(13, 138, 132, 0.08), transparent 32%), var(--color-bg-card)',
    boxShadow: 'var(--shadow-lg)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-lg)',
    '@media (max-width: 720px)': {
      padding: 'var(--space-md)',
    },
  },
  introBadge: {
    display: 'none',
  },
  heroTitle: {
    fontFamily: 'var(--font-display)',
    fontSize: 'clamp(2rem, 4vw, 2.7rem)',
    lineHeight: 1.08,
    letterSpacing: '-0.04em',
    color: 'var(--color-text-primary)',
    fontWeight: '800',
  },
  heroCopy: {
    color: 'var(--color-text-secondary)',
    fontSize: '1rem',
    lineHeight: 1.65,
  },
  featureList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-sm)',
  },
  featureCard: {
    display: 'flex',
    gap: 'var(--space-md)',
    alignItems: 'flex-start',
    padding: 'var(--space-md)',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--color-bg-muted)',
    border: 'none',
    boxShadow: 'none',
  },
  featureIcon: {
    width: '36px',
    height: '36px',
    borderRadius: 'var(--radius-md)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'var(--color-primary-soft)',
    fontSize: '16px',
    flexShrink: 0,
  },
  featureCopy: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  featureTitle: {
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-primary)',
    fontSize: '0.875rem',
    fontWeight: '600',
  },
  featureText: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.8125rem',
  },
  scenarioCard: {
    padding: 'var(--space-lg)',
    borderRadius: 'var(--radius-lg)',
    backgroundColor: 'var(--color-bg-card)',
    border: '1px solid var(--color-border)',
    boxShadow: 'var(--shadow-lg)',
    '@media (max-width: 720px)': {
      padding: 'var(--space-md)',
    },
  },
  childSelectorCard: {
    padding: 'var(--space-md)',
    marginBottom: 'var(--space-lg)',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--color-bg-muted)',
    border: 'none',
    display: 'grid',
    gap: 'var(--space-sm)',
  },
  childSelectorTitle: {
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-primary)',
    fontWeight: '600',
    fontSize: '0.875rem',
  },
  childSelectorText: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.8125rem',
  },
  childDropdown: {
    minWidth: '240px',
    '@media (max-width: 640px)': {
      minWidth: '100%',
    },
  },
  loadingContent: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    gap: 'var(--space-sm)',
    padding: 'var(--space-xl)',
    width: '100%',
  },
  sessionLayout: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.2fr) minmax(300px, 0.8fr)',
    gap: 'var(--space-xl)',
    alignItems: 'stretch',
    '@media (max-width: 1080px)': {
      gridTemplateColumns: '1fr',
    },
    '@media (max-width: 720px)': {
      gap: 'var(--space-lg)',
    },
  },
  sessionMain: {
    minWidth: 0,
    display: 'flex',
  },
  sessionAside: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-md)',
    minWidth: 0,
  },
  coachCard: {
    padding: 'var(--space-md)',
    borderRadius: 'var(--radius-lg)',
    backgroundColor: 'var(--color-bg-card)',
    border: '1px solid var(--color-border)',
    boxShadow: 'var(--shadow-md)',
  },
  coachTitle: {
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-primary)',
    marginBottom: 'var(--space-xs)',
    fontSize: '0.875rem',
    fontWeight: '600',
  },
  coachText: {
    color: 'var(--color-text-secondary)',
    lineHeight: 1.6,
    fontSize: '0.8125rem',
  },
})

export default function App() {
  const styles = useStyles()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [pilotState, setPilotState] = useState<PilotState | null>(null)
  const [pilotStateLoading, setPilotStateLoading] = useState(true)
  const [children, setChildren] = useState<ChildProfile[]>([])
  const [childrenLoading, setChildrenLoading] = useState(true)
  const [authStatus, setAuthStatus] = useState<AuthStatus>('loading')
  const [authError, setAuthError] = useState<string | null>(null)
  const [authUser, setAuthUser] = useState<AuthSession | null>(null)
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null)
  const [onboardingComplete, setOnboardingComplete] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem('wulo.onboarding.complete') === 'true'
  })
  const [showLoading, setShowLoading] = useState(false)
  const [showAssessment, setShowAssessment] = useState(false)
  const [showRoleNotice, setShowRoleNotice] = useState(false)
  const [showConsentScreen, setShowConsentScreen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [pendingSection, setPendingSection] = useState<SidebarSection | null>(null)
  const [pendingPath, setPendingPath] = useState<AppRoute | null>(null)
  const [showNavigationConfirm, setShowNavigationConfirm] = useState(false)
  const [selectedAvatar, setSelectedAvatar] = useState(DEFAULT_AVATAR)
  const [pendingAvatarValue, setPendingAvatarValue] = useState<string>('lisa-casual-sitting')
  const [pendingScenarioId, setPendingScenarioId] = useState<string | null>(null)
  const [pendingModeSelection, setPendingModeSelection] =
    useState<UserMode | null>(null)
  const [roleNoticeIntent, setRoleNoticeIntent] =
    useState<TherapistGateIntent>('review')
  const [userMode, setUserMode] = useState<UserMode | null>(() => {
    if (typeof window === 'undefined') return null

    const storedMode = window.localStorage.getItem('wulo.user.mode')
    return storedMode === 'therapist' || storedMode === 'child'
      ? storedMode
      : null
  })
  const [sessionSummaries, setSessionSummaries] = useState<SessionSummary[]>([])
  const [selectedSession, setSelectedSession] = useState<SessionDetail | null>(null)
  const [childPlans, setChildPlans] = useState<PracticePlan[]>([])
  const [selectedPlan, setSelectedPlan] = useState<PracticePlan | null>(null)
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null)
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [loadingSessionDetail, setLoadingSessionDetail] = useState(false)
  const [loadingPlans, setLoadingPlans] = useState(false)
  const [planSaving, setPlanSaving] = useState(false)
  const [planError, setPlanError] = useState<string | null>(null)
  const [currentAgent, setCurrentAgent] = useState<string | null>(null)
  const [sessionStartedAt, setSessionStartedAt] = useState<string | null>(null)
  const [assessment, setAssessment] = useState<Assessment | null>(null)
  const [sessionReady, setSessionReady] = useState(false)
  const [sessionIntroRequested, setSessionIntroRequested] = useState(false)
  const [sessionIntroComplete, setSessionIntroComplete] = useState(false)
  const [sessionFinished, setSessionFinished] = useState(false)
  const [avatarVideoReady, setAvatarVideoReady] = useState(false)
  const [assistantSpeechStarted, setAssistantSpeechStarted] = useState(false)
  const [showLaunchTransition, setShowLaunchTransition] = useState(false)
  const [launchHandoffReady, setLaunchHandoffReady] = useState(false)
  const [childTurnCount, setChildTurnCount] = useState(0)
  const [finishPromptTurnLimit, setFinishPromptTurnLimit] = useState(CHILD_TURN_LIMIT)
  const [finishConfirmationPending, setFinishConfirmationPending] = useState(false)
  const [finishPromptQueued, setFinishPromptQueued] = useState(false)
  const [finishRequested, setFinishRequested] = useState(false)
  const [utteranceFeedback, setUtteranceFeedback] =
    useState<PronunciationAssessment | null>(null)
  const [scoringUtterance, setScoringUtterance] = useState(false)
  const [feedbackRating, setFeedbackRating] = useState<TherapistFeedbackRating | null>(null)
  const [feedbackNote, setFeedbackNote] = useState('')
  const [feedbackSubmittedAt, setFeedbackSubmittedAt] = useState<string | null>(null)
  const [feedbackSaving, setFeedbackSaving] = useState(false)
  const [feedbackError, setFeedbackError] = useState<string | null>(null)
  const [consentSaving, setConsentSaving] = useState(false)
  const [consentError, setConsentError] = useState<string | null>(null)
  const [sessionActivityKey, setSessionActivityKey] = useState(0)
  const [launchInFlight, setLaunchInFlight] = useState(false)
  const prewarmedAgentRef = useRef<PrewarmedAgent | null>(null)
  const prewarmingKeyRef = useRef<string | null>(null)
  const prewarmPromiseRef = useRef<Promise<PrewarmedAgent | null> | null>(null)
  const pendingIntroRef = useRef<string | null>(null)
  const idleNudgePendingRef = useRef(false)
  const skipNextWordFeedbackRef = useRef(false)
  const sendRef = useRef<(msg: unknown) => void>(() => {})
  const previousPathRef = useRef(location.pathname)
  const navigationBypassRef = useRef(false)
  const lastQueryChildIdRef = useRef<string | null>(null)
  const lastQueryScenarioIdRef = useRef<string | null>(null)

  const {
    scenarios,
    serverScenarios,
    customScenarios,
    selectedScenario,
    setSelectedScenario,
    loading,
    getCustomScenario,
    addCustomScenario,
    updateCustomScenario,
    deleteCustomScenario,
  } = useScenarios()
  const { playAudio, stopAudio } = useAudioPlayer()
  const activeScenario = scenarios.find(scenario => scenario.id === selectedScenario) || null
  const selectedChild =
    children.find(child => child.id === selectedChildId) || null
  const activeReferenceText = getReferenceText(activeScenario)
  const activeExerciseMetadata = getExerciseMetadata(activeScenario)
  const currentRoute = resolveAppRoute(location.pathname)
  const isDashboardRoute = currentRoute === APP_ROUTES.dashboard
  const isSettingsRoute = currentRoute === APP_ROUTES.settings
  const isSessionRoute = currentRoute === APP_ROUTES.session
  const isHomeRoute = currentRoute === APP_ROUTES.home
  const isSetupRoute = currentRoute === APP_ROUTES.home || currentRoute === APP_ROUTES.dashboard
  const isTherapist = authUser?.role === 'therapist'
  const isChildMode = userMode === 'child' && !isDashboardRoute
  const queryChildId = searchParams.get(APP_ROUTE_PARAMS.childId)
  const queryScenarioId = searchParams.get(APP_ROUTE_PARAMS.scenarioId)
  const querySessionId = searchParams.get(APP_ROUTE_PARAMS.sessionId)
  const queryPlanId = searchParams.get(APP_ROUTE_PARAMS.planId)
  const currentSearch = location.search.startsWith('?') ? location.search.slice(1) : location.search
  const activeAvatarName = getAvatarName(selectedAvatar)
  const activeAvatarPersona = getAvatarPersona(selectedAvatar)
  const appTitle = 'Wulo'
  const launchOverlayVisible =
    isSessionRoute &&
    showLaunchTransition &&
    !launchHandoffReady
  const plannerReadiness: PlannerReadiness | null = appConfig?.planner ?? null
  const activeSection: SidebarSection = isDashboardRoute
    ? 'dashboard'
    : isSettingsRoute
      ? 'settings'
      : 'home'
  const showSidebarShell =
    authStatus === 'authenticated' &&
    onboardingComplete &&
    (Boolean(userMode) || isDashboardRoute || isSessionRoute || isSettingsRoute)
  const contentEyebrow = isDashboardRoute
    ? 'Dashboard'
    : isSettingsRoute
      ? 'Settings'
      : isSessionRoute
        ? 'Live session'
        : userMode === 'therapist'
          ? 'Therapist workspace'
          : 'Practice home'
  const contentTitle = isDashboardRoute
    ? 'Progress and planning'
    : isSettingsRoute
      ? 'Workspace settings'
      : isSessionRoute
        ? activeScenario?.name || 'Session in progress'
        : userMode === 'therapist'
          ? 'Prepare the next visit'
          : 'Ready to practise'
  const contentSubtitle = isDashboardRoute
    ? 'Performance review, session history, and planning in one workspace.'
    : isSettingsRoute
      ? 'Adjust the current workspace context and switch between the key state-driven surfaces.'
      : isSessionRoute
        ? 'The session stays live while navigation remains inside the same app state machine.'
        : userMode === 'therapist'
          ? 'Choose a child, pick an exercise, and move into guided practice.'
          : 'Launch the next exercise and keep the practice flow simple for the child.'
  const validChildIds = new Set(children.map(child => child.id))
  const homeScenarioIds = new Set(
    (userMode === 'therapist'
      ? [...serverScenarios, ...customScenarios]
      : serverScenarios).map(scenario => scenario.id)
  )
  const dashboardSessionIds = new Set(sessionSummaries.map(session => session.id))
  const dashboardPlanIds = new Set(childPlans.map(plan => plan.id))
  const queryPlan = queryPlanId
    ? childPlans.find(plan => plan.id === queryPlanId) || null
    : null
  const effectiveDashboardSessionId = queryPlan?.source_session_id || querySessionId

  const refreshAuthSession = useCallback(async () => {
    try {
      const session = await api.getAuthSession()
      setAuthUser(session)
      setAuthStatus('authenticated')
      setAuthError(null)
      return session
    } catch (error) {
      setAuthUser(null)
      if (error instanceof Error && error.message === 'UNAUTHORIZED') {
        setAuthStatus('unauthenticated')
        setAuthError(null)
      } else {
        setAuthStatus('error')
        setAuthError(error instanceof Error ? error.message : 'Failed to load authentication state')
      }
      throw error
    }
  }, [])

  // Pre-compose intro instructions so they're ready the instant the session is ready
  useEffect(() => {
    if (selectedScenario) {
      pendingIntroRef.current = isChildMode
        ? buildChildIntroInstructions({
            childName: selectedChild?.name,
            avatarName: activeAvatarName,
            avatarPersona: activeAvatarPersona,
            scenarioName: activeScenario?.name,
            scenarioDescription: activeScenario?.description,
          })
        : buildTherapistIntroInstructions({
            childName: selectedChild?.name,
            avatarName: activeAvatarName,
            avatarPersona: activeAvatarPersona,
            scenarioName: activeScenario?.name,
            scenarioDescription: activeScenario?.description,
          })
    } else {
      pendingIntroRef.current = null
    }
  }, [activeAvatarName, activeAvatarPersona, activeScenario?.description, activeScenario?.name, isChildMode, selectedChild?.name, selectedScenario])

  useEffect(() => {
    let cancelled = false

    refreshAuthSession()
      .then(session => {
        if (cancelled) return

        api.getConfig()
          .then(cfg => {
            if (!cancelled) {
              setAppConfig(cfg)
            }
          })
          .catch(() => {
            if (!cancelled) {
              setAppConfig(null)
            }
          })

        // Role guard: clear persisted therapist mode if user isn't a therapist
        if (session.role !== 'therapist') {
          const storedMode = window.localStorage.getItem('wulo.user.mode')
          if (storedMode === 'therapist') {
            window.localStorage.removeItem('wulo.user.mode')
            setUserMode(null)
          }
        }

        if (session.role !== 'therapist') {
          setPilotState(null)
          setPilotStateLoading(false)
          setChildren([])
          setChildrenLoading(false)
          setSelectedChildId(null)
          return
        }

        api
          .getPilotState()
          .then(state => {
            if (cancelled) return
            setPilotState(state)
          })
          .catch(error => {
            console.error('Failed to load pilot state:', error)
          })
          .finally(() => {
            if (!cancelled) {
              setPilotStateLoading(false)
            }
          })

        api
          .getChildren()
          .then(childProfiles => {
            if (cancelled) return
            setChildren(childProfiles)
            setSelectedChildId(current => current || childProfiles[0]?.id || null)
          })
          .catch(error => {
            console.error('Failed to load child profiles:', error)
          })
          .finally(() => {
            if (!cancelled) {
              setChildrenLoading(false)
            }
          })
      })
      .catch(() => {
        if (!cancelled) {
          setPilotStateLoading(false)
          setChildrenLoading(false)
        }
      })

    const handleAuthExpired = () => {
      if (cancelled) return
      setAuthUser(null)
      setAuthStatus('unauthenticated')
      setAuthError(null)
      setUserMode(null)
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem('wulo.user.mode')
      }
      setShowRoleNotice(false)
      navigate(APP_ROUTES.login, { replace: true })
    }

    window.addEventListener('auth:expired', handleAuthExpired)

    return () => {
      cancelled = true
      window.removeEventListener('auth:expired', handleAuthExpired)
    }
  }, [navigate, refreshAuthSession])

  const handleOpenSession = useCallback(
    async (sessionId: string) => {
      if (!isTherapist) return

      setLoadingSessionDetail(true)

      try {
        const detail = await api.getSession(sessionId)
        setSelectedSession(detail)
      } catch (error) {
        console.error('Failed to load session detail:', error)
        setSelectedSession(null)
      } finally {
        setLoadingSessionDetail(false)
      }
    },
    [isTherapist]
  )

  const loadSessionHistory = useCallback(
    async (childId: string) => {
      setLoadingSessions(true)
      setLoadingPlans(true)
      setPlanError(null)

      try {
        const [summaries, plans] = await Promise.all([
          api.getChildSessions(childId),
          api.getChildPlans(childId),
        ])
        setSessionSummaries(summaries)
        setChildPlans(plans)

        if (summaries.length > 0) {
          await handleOpenSession(summaries[0].id)
        } else {
          setSelectedSession(null)
          setSelectedPlan(null)
        }
      } catch (error) {
        console.error('Failed to load session history:', error)
        setSessionSummaries([])
        setSelectedSession(null)
        setChildPlans([])
        setSelectedPlan(null)
        setPlanError('Practice plans could not be loaded right now.')
      } finally {
        setLoadingSessions(false)
        setLoadingPlans(false)
      }
    },
    [handleOpenSession]
  )

  useEffect(() => {
    if (queryPlan) {
      setSelectedPlan(queryPlan)
      return
    }

    if (!selectedSession) {
      setSelectedPlan(null)
      return
    }

    const matchingPlan = childPlans.find(plan => plan.source_session_id === selectedSession.id) || null
    setSelectedPlan(matchingPlan)
  }, [childPlans, queryPlan, selectedSession])

  const upsertPlan = useCallback((updatedPlan: PracticePlan) => {
    setChildPlans(current => [updatedPlan, ...current.filter(plan => plan.id !== updatedPlan.id)])
    setSelectedPlan(updatedPlan)
  }, [])

  const handleCreatePlan = useCallback(
    async (message: string) => {
      if (!selectedChildId || !selectedSession) {
        setPlanError('Select a reviewed session before creating a practice plan.')
        return
      }

      if (plannerReadiness && !plannerReadiness.ready) {
        setPlanError(plannerReadiness.reasons[0] || 'Planner runtime is not ready yet.')
        return
      }

      setPlanSaving(true)
      setPlanError(null)

      try {
        const createdPlan = await api.createPracticePlan({
          child_id: selectedChildId,
          source_session_id: selectedSession.id,
          message,
        })
        upsertPlan(createdPlan)
      } catch (error) {
        console.error('Failed to create practice plan:', error)
        setPlanError('Practice plan generation failed. Try again in a moment.')
      } finally {
        setPlanSaving(false)
      }
    },
    [plannerReadiness, selectedChildId, selectedSession, upsertPlan]
  )

  const handleRefinePlan = useCallback(
    async (message: string) => {
      if (!selectedPlan) {
        setPlanError('Create a practice plan before sending a refinement request.')
        return
      }

      if (plannerReadiness && !plannerReadiness.ready) {
        setPlanError(plannerReadiness.reasons[0] || 'Planner runtime is not ready yet.')
        return
      }

      setPlanSaving(true)
      setPlanError(null)

      try {
        const updatedPlan = await api.refinePracticePlan(selectedPlan.id, message)
        upsertPlan(updatedPlan)
      } catch (error) {
        console.error('Failed to refine practice plan:', error)
        setPlanError('Practice plan refinement failed. Try again in a moment.')
      } finally {
        setPlanSaving(false)
      }
    },
    [plannerReadiness, selectedPlan, upsertPlan]
  )

  const handleApprovePlan = useCallback(async () => {
    if (!selectedPlan) {
      setPlanError('Choose or create a practice plan before approving it.')
      return
    }

    setPlanSaving(true)
    setPlanError(null)

    try {
      const approvedPlan = await api.approvePracticePlan(selectedPlan.id)
      upsertPlan(approvedPlan)
    } catch (error) {
      console.error('Failed to approve practice plan:', error)
      setPlanError('Practice plan approval failed. Try again in a moment.')
    } finally {
      setPlanSaving(false)
    }
  }, [selectedPlan, upsertPlan])

  useEffect(() => {
    if (!isTherapist || !selectedChildId) return

    void loadSessionHistory(selectedChildId)
  }, [isTherapist, loadSessionHistory, selectedChildId])

  useEffect(() => {
    if (
      !isDashboardRoute ||
      !effectiveDashboardSessionId ||
      !dashboardSessionIds.has(effectiveDashboardSessionId) ||
      selectedSession?.id === effectiveDashboardSessionId ||
      loadingSessionDetail
    ) {
      return
    }

    void handleOpenSession(effectiveDashboardSessionId)
  }, [dashboardSessionIds, effectiveDashboardSessionId, handleOpenSession, isDashboardRoute, loadingSessionDetail, selectedSession?.id])

  const handleWebRTCMessage = useCallback((msg: RealtimeMessage) => {
    if (msg.type === 'proxy.connected' || msg.type === 'session.updated') {
      setSessionReady(true)
    }

    if (msg.type === 'response.function_call_arguments.done' && msg.name === 'finish_session') {
      if (msg.call_id) {
        sendRef.current({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: msg.call_id,
            output: '{"status": "closing"}',
          },
        })
        sendRef.current({
          type: 'response.create',
          response: {
            modalities: ['audio', 'text'],
            instructions:
              'Say a very short, warm goodbye to the child. One sentence only, like "Great job today, bye bye!"',
          },
        })
      }
      setFinishRequested(true)
      return
    }

    if (msg.type === 'session.updated') {
      const session = msg.session
      const servers =
        session?.avatar?.ice_servers ||
        session?.rtc?.ice_servers ||
        session?.ice_servers
      const username =
        session?.avatar?.username ||
        session?.avatar?.ice_username ||
        session?.rtc?.ice_username ||
        session?.ice_username
      const credential =
        session?.avatar?.credential ||
        session?.avatar?.ice_credential ||
        session?.rtc?.ice_credential ||
        session?.ice_credential

      if (servers) {
        setupWebRTC(servers, username, credential)
      }
    } else if (
      (msg.server_sdp || msg.sdp || msg.answer) &&
      msg.type !== 'session.update'
    ) {
      handleAnswer(msg)
    }
  }, [])

  const handleRealtimeTranscript = useCallback(
    (role: 'user' | 'assistant', text: string) => {
      if (role === 'assistant' && text.trim()) {
        setAssistantSpeechStarted(true)
      }

      if (
        role === 'assistant' &&
        text.trim() &&
        sessionIntroRequested &&
        !sessionIntroComplete
      ) {
        setSessionIntroComplete(true)
      }

      if (!text.trim()) {
        return
      }

      if (role === 'assistant' && idleNudgePendingRef.current) {
        idleNudgePendingRef.current = false
        return
      }

      setSessionActivityKey(current => current + 1)

      if (
        role !== 'user' ||
        !activeReferenceText ||
        sessionFinished
      ) {
        return
      }

      const nextTurnCount = childTurnCount + 1
      setChildTurnCount(nextTurnCount)

      if (!isChildMode) {
        if (nextTurnCount >= THERAPIST_AUTO_SUMMARY_TURN_LIMIT) {
          setFinishRequested(true)
        }

        return
      }

      if (finishConfirmationPending) {
        if (AFFIRMATIVE_FINISH_PATTERN.test(text)) {
          setFinishConfirmationPending(false)
          setFinishRequested(true)
          return
        }

        setFinishConfirmationPending(false)

        if (finishPromptTurnLimit >= CHILD_MAX_TURNS) {
          setFinishRequested(true)
          return
        }

        setFinishPromptTurnLimit(current => Math.min(current + 2, CHILD_MAX_TURNS))
        return
      }

      if (nextTurnCount >= finishPromptTurnLimit) {
        setFinishConfirmationPending(true)
        setFinishPromptQueued(true)
      }
    },
    [
      activeReferenceText,
      childTurnCount,
      finishConfirmationPending,
      finishPromptTurnLimit,
      isChildMode,
      sessionFinished,
      sessionIntroComplete,
      sessionIntroRequested,
    ]
  )

  const handleAudioDelta = useCallback(
    (delta: string) => {
      setAssistantSpeechStarted(true)
      playAudio(delta)
    },
    [playAudio]
  )

  useEffect(() => {
    if (!showLaunchTransition) {
      setLaunchHandoffReady(false)
      return
    }

    if (assistantSpeechStarted || avatarVideoReady) {
      setLaunchHandoffReady(true)
      return
    }
  }, [assistantSpeechStarted, avatarVideoReady, showLaunchTransition])

  useEffect(() => {
    if (!showLaunchTransition || !launchHandoffReady) {
      return
    }

    if (launchHandoffReady) {
      setShowLaunchTransition(false)
    }
  }, [launchHandoffReady, showLaunchTransition])

  const {
    connected,
    connectionState,
    connectionMessage,
    messages,
    send,
    disconnect,
    clearMessages,
    getRecordings,
  } =
    useRealtime({
      agentId: currentAgent,
      onMessage: handleWebRTCMessage,
      onAudioDelta: handleAudioDelta,
      onTranscript: handleRealtimeTranscript,
    })
  const isSessionActive = isSessionRoute && (connected || messages.length > 0 || Boolean(currentAgent))

  useEffect(() => {
    sendRef.current = send
  }, [send])

  useEffect(() => {
    const previousRoute = resolveAppRoute(previousPathRef.current)

    if (
      previousRoute === APP_ROUTES.session &&
      currentRoute !== APP_ROUTES.session &&
      currentRoute !== null &&
      isSessionActive &&
      !navigationBypassRef.current
    ) {
      setPendingSection(getSectionForRoute(currentRoute))
      setPendingPath(currentRoute)
      setShowNavigationConfirm(true)
      navigate(APP_ROUTES.session, { replace: true })
      previousPathRef.current = APP_ROUTES.session
      return
    }

    previousPathRef.current = location.pathname

    if (navigationBypassRef.current) {
      navigationBypassRef.current = false
    }
  }, [currentRoute, isSessionActive, location.pathname, navigate])

  useEffect(() => {
    if (authStatus !== 'authenticated' || !isSetupRoute) {
      return
    }

    if (
      queryChildId !== lastQueryChildIdRef.current &&
      isTherapist &&
      queryChildId &&
      validChildIds.has(queryChildId) &&
      queryChildId !== selectedChildId
    ) {
      lastQueryChildIdRef.current = queryChildId
      setSelectedChildId(queryChildId)
    } else {
      lastQueryChildIdRef.current = queryChildId
    }

    if (
      queryScenarioId !== lastQueryScenarioIdRef.current &&
      isHomeRoute &&
      queryScenarioId &&
      homeScenarioIds.has(queryScenarioId) &&
      queryScenarioId !== selectedScenario
    ) {
      lastQueryScenarioIdRef.current = queryScenarioId
      setSelectedScenario(queryScenarioId)
    } else {
      lastQueryScenarioIdRef.current = queryScenarioId
    }
  }, [
    authStatus,
    homeScenarioIds,
    isHomeRoute,
    isSetupRoute,
    isTherapist,
    queryChildId,
    queryScenarioId,
    selectedChildId,
    selectedScenario,
    setSelectedScenario,
    validChildIds,
  ])

  useEffect(() => {
    if (authStatus !== 'authenticated' || !isSetupRoute) {
      return
    }

    const nextParams = new URLSearchParams(currentSearch)

    if (isTherapist && selectedChildId) {
      nextParams.set(APP_ROUTE_PARAMS.childId, selectedChildId)
    } else {
      nextParams.delete(APP_ROUTE_PARAMS.childId)
    }

    if (isDashboardRoute && selectedSession?.id && dashboardSessionIds.has(selectedSession.id)) {
      nextParams.set(APP_ROUTE_PARAMS.sessionId, selectedSession.id)
    } else {
      nextParams.delete(APP_ROUTE_PARAMS.sessionId)
    }

    if (isDashboardRoute && selectedPlan?.id && dashboardPlanIds.has(selectedPlan.id)) {
      nextParams.set(APP_ROUTE_PARAMS.planId, selectedPlan.id)
    } else {
      nextParams.delete(APP_ROUTE_PARAMS.planId)
    }

    if (isHomeRoute && selectedScenario && homeScenarioIds.has(selectedScenario)) {
      nextParams.set(APP_ROUTE_PARAMS.scenarioId, selectedScenario)
    } else {
      nextParams.delete(APP_ROUTE_PARAMS.scenarioId)
    }

    if (nextParams.toString() !== currentSearch) {
      setSearchParams(nextParams, { replace: true })
    }
  }, [
    authStatus,
    dashboardPlanIds,
    currentSearch,
    dashboardSessionIds,
    isDashboardRoute,
    homeScenarioIds,
    isHomeRoute,
    isSetupRoute,
    isTherapist,
    selectedChildId,
    selectedPlan?.id,
    selectedSession?.id,
    selectedScenario,
    setSearchParams,
  ])

  useEffect(() => {
    if (currentRoute === APP_ROUTES.logout) {
      return
    }

    if (currentRoute === null) {
      navigate(APP_ROUTES.root, { replace: true })
      return
    }

    if (authStatus === 'loading') {
      return
    }

    if (authStatus !== 'authenticated') {
      if (currentRoute !== APP_ROUTES.login) {
        navigate(APP_ROUTES.login, { replace: true })
      }
      return
    }

    if (currentRoute === APP_ROUTES.root || currentRoute === APP_ROUTES.login) {
      navigate(
        getDefaultAuthenticatedRoute({
          onboardingComplete,
          userMode,
        }),
        { replace: true }
      )
      return
    }

    if (!onboardingComplete && currentRoute !== APP_ROUTES.onboarding) {
      navigate(APP_ROUTES.onboarding, { replace: true })
      return
    }

    if (onboardingComplete && !userMode && currentRoute !== APP_ROUTES.mode) {
      navigate(APP_ROUTES.mode, { replace: true })
      return
    }

    if (currentRoute === APP_ROUTES.dashboard && !isTherapist) {
      setRoleNoticeIntent('review')
      setShowRoleNotice(true)
      navigate(APP_ROUTES.home, { replace: true })
      return
    }

    if (
      currentRoute === APP_ROUTES.session &&
      !showLaunchTransition &&
      !connected &&
      messages.length === 0 &&
      !currentAgent
    ) {
      navigate(APP_ROUTES.home, { replace: true })
    }
  }, [
    authStatus,
    connected,
    currentAgent,
    currentRoute,
    isTherapist,
    messages.length,
    navigate,
    onboardingComplete,
    showLaunchTransition,
    userMode,
  ])

  // Trigger the greeting only after the avatar video is actually rendered.
  useEffect(() => {
    if (
      !currentAgent ||
      !sessionReady ||
      !avatarVideoReady ||
      sessionIntroRequested ||
      !pendingIntroRef.current
    ) {
      return
    }

    send({
      type: 'response.create',
      response: {
        modalities: ['audio', 'text'],
        instructions: pendingIntroRef.current,
      },
    })
    setSessionIntroRequested(true)
  }, [
    avatarVideoReady,
    currentAgent,
    send,
    sessionIntroRequested,
    sessionReady,
  ])

  const sendOffer = useCallback(
    (sdp: string) => {
      send({ type: 'session.avatar.connect', client_sdp: sdp })
    },
    [send]
  )

  const { setupWebRTC, handleAnswer, videoRef } = useWebRTC(
    sendOffer,
    () => setAvatarVideoReady(true)
  )

  const sendAudioChunk = useCallback(
    (base64: string) => {
      send({ type: 'input_audio_buffer.append', audio: base64 })
    },
    [send]
  )

  const handleUtteranceComplete = useCallback(
    async (audioData: RecorderAudioChunk[]) => {
      if (skipNextWordFeedbackRef.current) {
        skipNextWordFeedbackRef.current = false
        return
      }

      if (!activeReferenceText) return

      setScoringUtterance(true)

      try {
        const result = await api.assessUtterance(
          audioData,
          activeReferenceText,
          activeExerciseMetadata,
          selectedScenario || undefined
        )
        setUtteranceFeedback(result)
      } catch (error) {
        console.error('Utterance scoring failed:', error)
        setUtteranceFeedback(null)
      } finally {
        setScoringUtterance(false)
      }
    },
    [activeExerciseMetadata, activeReferenceText, selectedScenario]
  )

  const {
    recording,
    toggleRecording,
    getAudioRecording,
    clearAudioRecording: clearConversationAudioRecording,
  } = useRecorder({
    mode: 'stream',
    onAudioChunk: sendAudioChunk,
    onRecordingComplete: handleUtteranceComplete,
  })

  const releaseAgent = useCallback(async (agentId: string) => {
    try {
      await api.deleteAgent(agentId)
    } catch (error) {
      console.error('Failed to delete agent:', error)
    }
  }, [])

  const handleToggleRecording = useCallback(async () => {
    setSessionActivityKey(current => current + 1)

    if (!recording && activeReferenceText) {
      setUtteranceFeedback(null)
    }

    const wasRecording = recording
    await toggleRecording()

    if (wasRecording) {
      send({ type: 'input_audio_buffer.commit' })
    }
  }, [activeReferenceText, recording, send, toggleRecording])

  const analyzeCurrentSession = useCallback(async () => {
    if (!selectedScenario) return null

    const recordings = getRecordings()
    const audioData = getAudioRecording()

    if (!recordings.conversation.length) {
      return null
    }

    const transcript = recordings.conversation
      .map((message: ConversationTurn) => `${message.role}: ${message.content}`)
      .join('\n')

    return api.analyzeConversation(
      selectedScenario,
      transcript,
      [...audioData, ...recordings.audio],
      recordings.conversation,
      activeExerciseMetadata,
      selectedChildId || undefined,
      selectedChild?.name,
      activeScenario,
      sessionStartedAt
    )
  }, [
    activeExerciseMetadata,
    activeScenario,
    getAudioRecording,
    getRecordings,
    selectedChild?.name,
    selectedChildId,
    selectedScenario,
    sessionStartedAt,
  ])

  const applyAssessmentResult = useCallback(
    async (result: Assessment) => {
      setAssessment(result)
      setShowAssessment(true)
      setFeedbackRating(null)
      setFeedbackNote('')
      setFeedbackSubmittedAt(null)
      setFeedbackError(null)

      if (isDashboardRoute && isTherapist && selectedChildId) {
        await loadSessionHistory(selectedChildId)
      }
    },
    [isDashboardRoute, isTherapist, loadSessionHistory, selectedChildId]
  )

  const handleFinishPractice = useCallback(async () => {
    if (recording) {
      await handleToggleRecording()
    }

    disconnect()

    if (currentAgent) {
      void releaseAgent(currentAgent)
    }

    setCurrentAgent(null)
    setSessionReady(false)
    setSessionIntroRequested(false)
    setSessionIntroComplete(false)
    setAvatarVideoReady(false)
    setAssistantSpeechStarted(false)
    setShowLaunchTransition(false)
    setLaunchHandoffReady(false)
    setScoringUtterance(false)
    setSessionFinished(true)
  }, [currentAgent, disconnect, handleToggleRecording, recording, releaseAgent])

  const handleConfirmedFinish = useCallback(async () => {
    await handleFinishPractice()

    setShowLoading(true)

    try {
      const result = await analyzeCurrentSession()

      if (result) {
        await applyAssessmentResult(result)
      }
    } catch (error) {
      console.error('Analysis failed:', error)
    } finally {
      setShowLoading(false)
      setFinishRequested(false)
    }
  }, [analyzeCurrentSession, applyAssessmentResult, handleFinishPractice])

  useEffect(() => {
    if (!finishPromptQueued || !isChildMode || sessionFinished || !connected) {
      return
    }

    skipNextWordFeedbackRef.current = true
    send({
      type: 'response.create',
      response: {
        modalities: ['audio', 'text'],
        instructions:
          'In one short sentence, ask if the child wants to finish practice and see their session summary now, or keep going for a few more tries. Ask for a yes or no answer.',
      },
    })
    setFinishPromptQueued(false)
  }, [connected, finishPromptQueued, isChildMode, send, sessionFinished])

  useEffect(() => {
    if (!finishRequested) {
      return
    }

    void handleConfirmedFinish()
  }, [finishRequested, handleConfirmedFinish])

  const sendIdleNudge = useCallback(() => {
    if (
      !isChildMode ||
      !connected ||
      !isSessionRoute ||
      sessionFinished ||
      recording ||
      scoringUtterance
    ) {
      return
    }

    idleNudgePendingRef.current = true
    skipNextWordFeedbackRef.current = true
    send({
      type: 'response.create',
      response: {
        modalities: ['audio', 'text'],
        instructions:
          'In one short sentence, gently check whether the child wants to keep practising. Tell them to tap the microphone if they want another turn.',
      },
    })
  }, [connected, isChildMode, isSessionRoute, recording, scoringUtterance, send, sessionFinished])

  useSessionTimer({
    active:
      isChildMode &&
      isSessionRoute &&
      sessionIntroComplete &&
      !sessionFinished,
    activityKey: sessionActivityKey,
    recording,
    onNudge: sendIdleNudge,
    onAutoEnd: () => {
      setFinishRequested(true)
    },
  })

  const createAgentForSelection = useCallback(
    async (scenarioId: string, avatarValue: string) => {
      const avatarConfig = parseAvatarValue(avatarValue)
      const customScenario = getCustomScenario(scenarioId)

      const response = customScenario
        ? await api.createAgentWithCustomScenario(
            scenarioId,
            customScenario.name,
            customScenario.description,
            customScenario.scenarioData,
            avatarConfig
          )
        : await api.createAgent(scenarioId, avatarConfig)

      return response.agent_id as string
    },
    [getCustomScenario]
  )

  useEffect(() => {
    const shouldPrewarm =
      ((userMode === 'therapist' && !isDashboardRoute && Boolean(selectedChildId)) ||
        userMode === 'child') &&
      Boolean(selectedScenario) &&
      !currentAgent

    if (!shouldPrewarm || !selectedScenario) {
      const staleAgent = prewarmedAgentRef.current
      prewarmedAgentRef.current = null
      prewarmingKeyRef.current = null
      prewarmPromiseRef.current = null

      if (staleAgent) {
        void releaseAgent(staleAgent.agentId)
      }

      return
    }

    const desiredKey = buildAgentWarmKey(selectedScenario, selectedAvatar)

    if (prewarmedAgentRef.current?.key === desiredKey) {
      return
    }

    if (prewarmingKeyRef.current === desiredKey) {
      return
    }

    const staleAgent = prewarmedAgentRef.current
    if (staleAgent && staleAgent.key !== desiredKey) {
      prewarmedAgentRef.current = null
      void releaseAgent(staleAgent.agentId)
    }

    let active = true
    prewarmingKeyRef.current = desiredKey

    let warmPromise: Promise<PrewarmedAgent | null> | null = null

    warmPromise = (async (): Promise<PrewarmedAgent | null> => {
      try {
        const agentId = await createAgentForSelection(selectedScenario, selectedAvatar)
        const warmedAgent = { key: desiredKey, agentId }

        if (!active || prewarmingKeyRef.current !== desiredKey) {
          await releaseAgent(agentId)
          return null
        }

        prewarmedAgentRef.current = warmedAgent
        return warmedAgent
      } catch (error) {
        console.error('Failed to pre-warm agent:', error)
        return null
      } finally {
        if (prewarmingKeyRef.current === desiredKey) {
          prewarmingKeyRef.current = null
        }

        if (warmPromise && prewarmPromiseRef.current === warmPromise) {
          prewarmPromiseRef.current = null
        }
      }
    })()

    prewarmPromiseRef.current = warmPromise

    return () => {
      active = false
    }
  }, [
    createAgentForSelection,
    currentAgent,
    isDashboardRoute,
    releaseAgent,
    selectedAvatar,
    selectedChildId,
    selectedScenario,
    userMode,
  ])

  useEffect(() => {
    return () => {
      const staleAgent = prewarmedAgentRef.current
      prewarmedAgentRef.current = null
      prewarmingKeyRef.current = null
      prewarmPromiseRef.current = null

      if (staleAgent) {
        void releaseAgent(staleAgent.agentId)
      }
    }
  }, [releaseAgent])

  const handleClearSession = useCallback(() => {
    clearMessages()
    clearConversationAudioRecording()
    setScoringUtterance(false)
    setSessionStartedAt(null)
    setSessionReady(false)
    setSessionIntroRequested(false)
    setSessionIntroComplete(false)
    setSessionFinished(false)
    setChildTurnCount(0)
    setFinishPromptTurnLimit(CHILD_TURN_LIMIT)
    setFinishConfirmationPending(false)
    setFinishPromptQueued(false)
    setFinishRequested(false)
    setAvatarVideoReady(false)
    setAssistantSpeechStarted(false)
    setShowLaunchTransition(false)
    setLaunchHandoffReady(false)
    setLaunchInFlight(false)
  }, [clearConversationAudioRecording, clearMessages])

  const startPracticeSession = useCallback(async (avatarValue: string, scenarioOverride?: string) => {
    const activeScenarioId = scenarioOverride ?? selectedScenario
    if (!activeScenarioId) {
      setLaunchInFlight(false)
      return
    }

    const agentKey = buildAgentWarmKey(activeScenarioId, avatarValue)
    let agentId = prewarmedAgentRef.current?.key === agentKey
      ? prewarmedAgentRef.current.agentId
      : null

    if (!agentId && prewarmingKeyRef.current === agentKey && prewarmPromiseRef.current) {
      const warmedAgent = await prewarmPromiseRef.current
      if (warmedAgent?.key === agentKey) {
        agentId = warmedAgent.agentId
      }
    }

    if (agentId && prewarmedAgentRef.current?.agentId === agentId) {
      prewarmedAgentRef.current = null
    }

    prewarmingKeyRef.current = null
    prewarmPromiseRef.current = null

    // Show session UI immediately so the child sees their buddy while the
    // API call resolves — eliminates the blank/delayed feeling.
    setSessionReady(false)
    setSessionIntroRequested(false)
    setSessionIntroComplete(false)
    setSessionFinished(false)
    setChildTurnCount(0)
    setFinishPromptTurnLimit(CHILD_TURN_LIMIT)
    setFinishConfirmationPending(false)
    setFinishPromptQueued(false)
    setFinishRequested(false)
    setAvatarVideoReady(false)
    setAssistantSpeechStarted(false)
    setShowLaunchTransition(true)
    setLaunchHandoffReady(false)
    setUtteranceFeedback(null)
    setScoringUtterance(false)
    setSessionStartedAt(new Date().toISOString())
    setFeedbackRating(null)
    setFeedbackNote('')
    setFeedbackSubmittedAt(null)
    setFeedbackError(null)
    navigate(APP_ROUTES.session)

    try {
      if (!agentId) {
        agentId = await createAgentForSelection(activeScenarioId, avatarValue)
      }

      setCurrentAgent(agentId)
      setLaunchInFlight(false)
      navigate(APP_ROUTES.session)
    } catch (error) {
      console.error('Failed to create agent:', error)
      // Revert to home on failure so the child isn't stuck
      setShowLaunchTransition(false)
      setLaunchHandoffReady(false)
      setLaunchInFlight(false)
      navigate(APP_ROUTES.home)
    }
  }, [createAgentForSelection, navigate, selectedScenario])

  const handleStart = useCallback(async (avatarValue: string, scenarioOverride?: string) => {
    const activeScenarioId = scenarioOverride ?? selectedScenario
    if (!activeScenarioId || launchInFlight) return

    setLaunchInFlight(true)

    // Ensure React state is in sync when called with an override
    if (scenarioOverride && scenarioOverride !== selectedScenario) {
      setSelectedScenario(scenarioOverride)
    }

    setPendingModeSelection(null)
    setPendingScenarioId(null)

    if (isTherapist && !pilotState?.consent_timestamp) {
      setPendingAvatarValue(avatarValue)
      setPendingScenarioId(activeScenarioId)
      setConsentError(null)
      setShowConsentScreen(true)
      setLaunchInFlight(false)
      return
    }

    await startPracticeSession(avatarValue, activeScenarioId)
  }, [isTherapist, launchInFlight, pilotState, selectedScenario, setSelectedScenario, startPracticeSession])

  const handleAnalyze = async () => {
    setShowLoading(true)

    try {
      const result = await analyzeCurrentSession()

      if (result) {
        await applyAssessmentResult(result)
      }
    } catch (error) {
      console.error('Analysis failed:', error)
    } finally {
      setShowLoading(false)
    }
  }

  const handleCompleteOnboarding = useCallback(() => {
    setOnboardingComplete(true)
    setUserMode(null)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('wulo.onboarding.complete', 'true')
      window.localStorage.removeItem('wulo.user.mode')
    }
    navigate(APP_ROUTES.mode)
  }, [navigate])

  const handleExitTherapistView = useCallback(() => {
    navigate(APP_ROUTES.home)
  }, [navigate])

  const handleReturnToEntry = useCallback(() => {
    setSessionFinished(false)
    setChildTurnCount(0)
    setFinishPromptTurnLimit(CHILD_TURN_LIMIT)
    setFinishConfirmationPending(false)
    setFinishPromptQueued(false)
    setFinishRequested(false)
    setLaunchHandoffReady(false)
    setLaunchInFlight(false)
    setUserMode(null)
    setMobileSidebarOpen(false)
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('wulo.user.mode')
    }
    navigate(APP_ROUTES.mode)
  }, [navigate])

  const handleGoHome = useCallback(() => {
    disconnect()
    clearMessages()
    clearConversationAudioRecording()
    setUtteranceFeedback(null)
    setScoringUtterance(false)
    setSessionStartedAt(null)
    setCurrentAgent(null)
    setSessionReady(false)
    setSessionIntroRequested(false)
    setSessionIntroComplete(false)
    setSessionFinished(false)
    setChildTurnCount(0)
    setFinishPromptTurnLimit(CHILD_TURN_LIMIT)
    setFinishConfirmationPending(false)
    setFinishPromptQueued(false)
    setFinishRequested(false)
    setAssessment(null)
    setShowAssessment(false)
    setShowLoading(false)
    setFeedbackRating(null)
    setFeedbackNote('')
    setFeedbackSubmittedAt(null)
    setFeedbackError(null)
    setLaunchHandoffReady(false)
    setLaunchInFlight(false)
    setShowRoleNotice(false)
    setMobileSidebarOpen(false)
  }, [clearConversationAudioRecording, clearMessages, disconnect])

  const handleChooseMode = useCallback((mode: UserMode) => {
    if (mode === 'therapist' && !isTherapist) {
      setRoleNoticeIntent('review')
      setShowRoleNotice(true)
      return
    }

    if (mode === 'child' && isTherapist && !pilotState?.consent_timestamp) {
      setPendingModeSelection('child')
      setConsentError(null)
      setShowConsentScreen(true)
      return
    }

    if (mode === 'child' && !selectedScenario && serverScenarios[0]) {
      setSelectedScenario(serverScenarios[0].id)
    }

    setUserMode(mode)

    if (typeof window !== 'undefined') {
      window.localStorage.setItem('wulo.user.mode', mode)
    }
    navigate(APP_ROUTES.home)
  }, [isTherapist, navigate, pilotState?.consent_timestamp, selectedScenario, serverScenarios, setSelectedScenario])

  const openSection = useCallback((section: SidebarSection) => {
    setMobileSidebarOpen(false)
    const nextRoute = getSectionRoute(section)

    if (section === 'dashboard') {
      if (!isTherapist) {
        setRoleNoticeIntent('review')
        setShowRoleNotice(true)
        return
      }

      navigate(nextRoute)
      return
    }

    if (section === 'settings') {
      navigate(nextRoute)
      return
    }

    handleGoHome()
    navigate(nextRoute)
  }, [handleGoHome, isTherapist, navigate])

  const requestSection = useCallback((section: SidebarSection) => {
    const nextRoute = getSectionRoute(section)

    if (section === activeSection && !isSessionActive) {
      setMobileSidebarOpen(false)
      return
    }

    if (isSessionActive) {
      setPendingSection(section)
      setPendingPath(nextRoute)
      setShowNavigationConfirm(true)
      setMobileSidebarOpen(false)
      return
    }

    openSection(section)
  }, [activeSection, isSessionActive, openSection])

  const handleConfirmSectionChange = useCallback(() => {
    const nextPath = pendingPath
    setShowNavigationConfirm(false)
    setPendingSection(null)
    setPendingPath(null)
    handleGoHome()

    if (nextPath) {
      navigationBypassRef.current = true
      navigate(nextPath)
    }
  }, [handleGoHome, navigate, pendingPath])

  useEffect(() => {
    if (!showSidebarShell) {
      setMobileSidebarOpen(false)
    }
  }, [showSidebarShell])

  const handleConsentAccept = useCallback(async () => {
    setConsentSaving(true)
    setConsentError(null)

    try {
      const updatedState = await api.acknowledgeConsent()
      setPilotState(current => ({
        ...current,
        ...updatedState,
      }))
      setShowConsentScreen(false)

      if (pendingModeSelection === 'child') {
        if (!selectedScenario && serverScenarios[0]) {
          setSelectedScenario(serverScenarios[0].id)
        }

        setUserMode('child')
        setPendingModeSelection(null)

        if (typeof window !== 'undefined') {
          window.localStorage.setItem('wulo.user.mode', 'child')
        }

        setLaunchInFlight(false)
        navigate(APP_ROUTES.home)

        return
      }

      await startPracticeSession(pendingAvatarValue, pendingScenarioId ?? undefined)
      setPendingScenarioId(null)
    } catch (error) {
      console.error('Failed to save consent:', error)
      setConsentError('Consent could not be saved right now.')
      setLaunchInFlight(false)
    } finally {
      setConsentSaving(false)
    }
  }, [
    navigate,
    pendingAvatarValue,
    pendingScenarioId,
    pendingModeSelection,
    selectedScenario,
    serverScenarios,
    setSelectedScenario,
    startPracticeSession,
  ])

  const handleSubmitFeedback = useCallback(async () => {
    if (!assessment?.session_id || !isTherapist || !feedbackRating) {
      setFeedbackError('Choose a quick rating before saving therapist feedback.')
      return
    }

    setFeedbackSaving(true)
    setFeedbackError(null)

    try {
      const updatedSession = await api.submitSessionFeedback(
        assessment.session_id,
        feedbackRating,
        feedbackNote
      )
      setFeedbackSubmittedAt(updatedSession.therapist_feedback?.submitted_at || null)

      if (selectedChildId) {
        await loadSessionHistory(selectedChildId)
      }
    } catch (error) {
      console.error('Failed to save therapist feedback:', error)
      setFeedbackError('Therapist feedback could not be saved right now.')
    } finally {
      setFeedbackSaving(false)
    }
  }, [
    assessment?.session_id,
    feedbackNote,
    feedbackRating,
    isTherapist,
    loadSessionHistory,
    selectedChildId,
  ])

  const handleMicrosoftSignIn = useCallback(() => {
    window.location.href = `/.auth/login/aad?post_login_redirect_uri=${encodeURIComponent(`${window.location.origin}/`)}`
  }, [])

  const handleGoogleSignIn = useCallback(() => {
    window.location.href = `/.auth/login/google?post_login_redirect_uri=${encodeURIComponent(`${window.location.origin}/`)}`
  }, [])

  if (currentRoute === APP_ROUTES.logout) {
    return <LogoutScreen />
  }

  if (currentRoute === APP_ROUTES.login || authStatus !== 'authenticated') {
    return (
      <AuthGateScreen
        status={authStatus === 'authenticated' ? 'loading' : authStatus}
        error={authError}
        onRetry={() => {
          setAuthStatus('loading')
          void refreshAuthSession()
        }}
        onMicrosoftSignIn={handleMicrosoftSignIn}
        onGoogleSignIn={handleGoogleSignIn}
      />
    )
  }

  const mainContent = currentRoute === APP_ROUTES.dashboard ? (
    <ProgressDashboard
      childProfiles={children}
      selectedChildId={selectedChildId}
      sessions={sessionSummaries}
      selectedSession={selectedSession}
      selectedPlan={selectedPlan}
      plannerReadiness={plannerReadiness}
      loadingChildren={childrenLoading}
      loadingSessions={loadingSessions}
      loadingSessionDetail={loadingSessionDetail}
      loadingPlans={loadingPlans}
      planSaving={planSaving}
      planError={planError}
      onSelectChild={setSelectedChildId}
      onOpenSession={handleOpenSession}
      onCreatePlan={handleCreatePlan}
      onRefinePlan={handleRefinePlan}
      onApprovePlan={() => {
        void handleApprovePlan()
      }}
      onBackToPractice={handleExitTherapistView}
      onExitToEntry={handleReturnToEntry}
    />
  ) : currentRoute === APP_ROUTES.onboarding ? (
    <OnboardingFlow
      loading={pilotStateLoading}
      isTherapist={isTherapist}
      onContinue={handleCompleteOnboarding}
    />
  ) : currentRoute === APP_ROUTES.mode ? (
    <ModeSelector
      isTherapist={isTherapist}
      onChooseMode={handleChooseMode}
    />
  ) : currentRoute === APP_ROUTES.settings ? (
    <SettingsView
      isTherapist={isTherapist}
      currentMode={userMode}
      authRole={authUser?.role}
      selectedChild={selectedChild}
    />
  ) : currentRoute === APP_ROUTES.home ? (
    loading ? (
      <div className={styles.loadingContent}>
        <Spinner size="large" />
        <Text size={400} weight="semibold">
          Loading exercises...
        </Text>
        <Text size={300}>Your Wulo library is getting ready.</Text>
      </div>
    ) : (
      userMode === 'child' ? (
        <ChildHome
          selectedChild={selectedChild}
          selectedAvatar={selectedAvatar}
          selectedScenario={selectedScenario}
          launchInFlight={launchInFlight}
          scenarios={serverScenarios}
          isTherapist={isTherapist}
          onExitToEntry={handleReturnToEntry}
          onSelectScenario={(scenarioId: string) => {
            setSelectedScenario(scenarioId)
          }}
          onStartScenario={(scenarioId: string) => {
            void handleStart(selectedAvatar, scenarioId)
          }}
          onStartSession={() => {
            void handleStart(selectedAvatar)
          }}
        />
      ) : (
        <DashboardHome
          childProfiles={children}
          childrenLoading={childrenLoading}
          selectedChildId={selectedChildId}
          selectedChild={selectedChild}
          selectedAvatar={selectedAvatar}
          selectedScenario={selectedScenario}
          launchInFlight={launchInFlight}
          scenarios={serverScenarios}
          customScenarios={customScenarios}
          onSelectChild={childId => setSelectedChildId(childId)}
          onSelectAvatar={setSelectedAvatar}
          onSelectScenario={(scenarioId: string) => {
            setSelectedScenario(scenarioId)
          }}
          onStartSession={() => {
            void handleStart(selectedAvatar)
          }}
          onExitToEntry={handleReturnToEntry}
          onOpenTherapistReview={() => openSection('dashboard')}
          onAddCustomScenario={addCustomScenario}
          onUpdateCustomScenario={updateCustomScenario}
          onDeleteCustomScenario={deleteCustomScenario}
        />
      )
    )
  ) : (
    <SessionScreen
      videoRef={videoRef}
      messages={messages}
      launching={showLaunchTransition}
      recording={recording}
      connected={connected}
      connectionState={connectionState}
      connectionMessage={connectionMessage}
      introComplete={sessionIntroComplete}
      sessionFinished={sessionFinished}
      canAnalyze={messages.length > 0}
      onToggleRecording={handleToggleRecording}
      onClear={isChildMode ? () => { void handleConfirmedFinish() } : handleClearSession}
      onAnalyze={handleAnalyze}
      scenario={activeScenario}
      isChildMode={isChildMode}
      selectedChild={selectedChild}
      selectedAvatar={selectedAvatar}
      introPending={sessionIntroRequested && !sessionIntroComplete}
      onVideoLoaded={() => setAvatarVideoReady(true)}
      utteranceFeedback={utteranceFeedback}
      scoringUtterance={scoringUtterance}
      activeReferenceText={activeReferenceText}
      onInterruptAvatar={() => {
        send({ type: 'response.cancel' })
        stopAudio()
      }}
    />
  )

  return (
    <div className={styles.page}>
      {showSidebarShell ? (
        <div className={mergeClasses(styles.appShell, isDashboardRoute && styles.appShellDashboard)}>
          <SidebarNav
            appTitle={appTitle}
            activeSection={activeSection}
            collapsed={sidebarCollapsed}
            mobileOpen={mobileSidebarOpen}
            isTherapist={isTherapist}
            childProfiles={children}
            childrenLoading={childrenLoading}
            selectedChildId={selectedChildId}
            selectedChild={selectedChild}
            showTherapistAccess={!isTherapist && userMode !== 'child'}
            onBrandClick={() => requestSection('home')}
            onNavigateHome={() => requestSection('home')}
            onNavigateDashboard={() => requestSection('dashboard')}
            onNavigateSettings={() => requestSection('settings')}
            onSelectChild={setSelectedChildId}
            onToggleCollapse={() => setSidebarCollapsed(current => !current)}
            onCloseMobile={() => setMobileSidebarOpen(false)}
            onOpenTherapistAccess={() => {
              setRoleNoticeIntent('review')
              setShowRoleNotice(true)
            }}
          />

          <div className={mergeClasses(styles.contentArea, isDashboardRoute && styles.contentAreaDashboard)}>
            <div className={mergeClasses(styles.contentHeader, isDashboardRoute && styles.contentHeaderDashboard)}>
              <div className={styles.headerLead}>
                <Button
                  appearance="subtle"
                  icon={<Bars3Icon className="w-5 h-5" />}
                  className={styles.contentMenuButton}
                  onClick={() => setMobileSidebarOpen(true)}
                  aria-label="Open navigation"
                />

                <div className={styles.contentHeading}>
                  <Text className={mergeClasses(styles.contentEyebrow, isDashboardRoute && styles.contentEyebrowDashboard)}>{contentEyebrow}</Text>
                  <Text className={mergeClasses(styles.contentTitle, isDashboardRoute && styles.contentTitleDashboard)}>{contentTitle}</Text>
                </div>
              </div>

              <Text className={mergeClasses(styles.contentSubtitle, isDashboardRoute && styles.contentSubtitleDashboard)}>{contentSubtitle}</Text>
            </div>

            <div className={styles.contentBody}>{mainContent}</div>
          </div>
        </div>
      ) : (
        <div className={styles.shell}>{mainContent}</div>
      )}

      <SessionLaunchOverlay
        visible={launchOverlayVisible}
        avatarValue={selectedAvatar}
        avatarName={activeAvatarName}
        exerciseName={activeScenario?.name}
        childName={selectedChild?.name}
        exercisePrompt={activeScenario?.description}
        onCancel={handleClearSession}
      />

      <Dialog open={showLoading}>
        <DialogSurface>
          <DialogBody>
            <div className={styles.loadingContent}>
              <Spinner size="large" />
              <Text size={400} weight="semibold">
                Preparing session summary...
              </Text>
              <Text size={300}>This may take up to 30 seconds.</Text>
            </div>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <Dialog
        open={showRoleNotice}
        onOpenChange={(_, data) => setShowRoleNotice(data.open)}
      >
        <DialogSurface>
          <DialogTitle>Role required</DialogTitle>
          <DialogBody>
            <Text>
              {roleNoticeIntent === 'mode-switch'
                ? 'Therapist-only tools require a therapist role on your account.'
                : 'This part of Wulo is available only to therapist accounts.'}
            </Text>
          </DialogBody>
          <DialogActions>
            <Button appearance="secondary" onClick={() => setShowRoleNotice(false)}>
              Cancel
            </Button>
            <Button appearance="primary" onClick={() => setShowRoleNotice(false)}>
              Close
            </Button>
          </DialogActions>
        </DialogSurface>
      </Dialog>

      <Dialog
        open={showNavigationConfirm}
        onOpenChange={(_, data) => {
          setShowNavigationConfirm(data.open)
          if (!data.open) {
            setPendingSection(null)
            setPendingPath(null)
          }
        }}
      >
        <DialogSurface>
          <DialogTitle>Leave this session?</DialogTitle>
          <DialogBody>
            <Text>
              The current session has unsaved progress. Leaving now will end the live session and clear any unanalysed practice from this screen.
            </Text>
          </DialogBody>
          <DialogActions>
            <Button
              appearance="secondary"
              onClick={() => {
                setShowNavigationConfirm(false)
                setPendingSection(null)
                setPendingPath(null)
              }}
            >
              Stay here
            </Button>
            <Button appearance="primary" onClick={handleConfirmSectionChange}>
              Leave session
            </Button>
          </DialogActions>
        </DialogSurface>
      </Dialog>

      <AssessmentPanel
        open={showAssessment}
        assessment={assessment}
        feedbackRating={feedbackRating}
        feedbackNote={feedbackNote}
        feedbackSubmittedAt={feedbackSubmittedAt}
        feedbackSaving={feedbackSaving}
        feedbackError={feedbackError}
        showTherapistControls={!isChildMode && isTherapist}
        onFeedbackRatingChange={setFeedbackRating}
        onFeedbackNoteChange={setFeedbackNote}
        onSubmitFeedback={() => {
          void handleSubmitFeedback()
        }}
        onClose={() => setShowAssessment(false)}
      />

      <ConsentScreen
        open={showConsentScreen}
        saving={consentSaving}
        error={consentError}
        onAccept={() => {
          void handleConsentAccept()
        }}
        onCancel={() => setShowConsentScreen(false)}
      />
    </div>
  )
}
