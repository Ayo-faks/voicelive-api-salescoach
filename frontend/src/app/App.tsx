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
  Field,
  Input,
  Option,
  Spinner,
  Text,
  makeStyles,
} from '@fluentui/react-components'
import {
  ClipboardTaskRegular,
  PersonHeartRegular,
  TargetRegular,
} from '@fluentui/react-icons'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AssessmentPanel } from '../components/AssessmentPanel'
import { ChatPanel } from '../components/ChatPanel'
import { ChildHome } from '../components/ChildHome'
import { ConsentScreen } from '../components/ConsentScreen'
import { DashboardHome } from '../components/DashboardHome'
import { ExerciseFeedback } from '../components/ExerciseFeedback'
import { HomeButton } from '../components/HomeButton'
import { ModeSelector } from '../components/ModeSelector'
import { OnboardingFlow } from '../components/OnboardingFlow'
import { ProgressDashboard } from '../components/ProgressDashboard'
import { SessionLaunchOverlay } from '../components/SessionLaunchOverlay'
import { VideoPanel } from '../components/VideoPanel'
import { useAudioPlayer } from '../hooks/useAudioPlayer'
import { useRealtime } from '../hooks/useRealtime'
import type { RecorderAudioChunk } from '../hooks/useRecorder'
import { useRecorder } from '../hooks/useRecorder'
import { useScenarios } from '../hooks/useScenarios'
import { useWebRTC } from '../hooks/useWebRTC'
import { api, parseAvatarValue } from '../services/api'
import type {
  Assessment,
  AvatarOption,
  ChildProfile,
  CustomScenario,
  ExerciseMetadata,
  PilotState,
  PronunciationAssessment,
  Scenario,
  SessionDetail,
  SessionSummary,
  TherapistFeedbackRating,
} from '../types'
import { AVATAR_OPTIONS, DEFAULT_AVATAR } from '../types'

type ConversationTurn = {
  role: string
  content: string
}

type RealtimeMessage = {
  type?: string
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

type PrewarmedAgent = {
  key: string
  agentId: string
}

function isCustomScenario(
  scenario: Scenario | CustomScenario | null | undefined
): scenario is CustomScenario {
  return Boolean(scenario && 'scenarioData' in scenario)
}

function getReferenceText(scenario: Scenario | CustomScenario | null): string {
  if (!scenario) return ''

  if (isCustomScenario(scenario)) {
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

function buildAgentWarmKey(scenarioId: string, avatarValue: string): string {
  return `${scenarioId}::${avatarValue}`
}

const useStyles = makeStyles({
  page: {
    width: '100%',
    minHeight: '100vh',
    padding: 'var(--space-xl) var(--space-xl)',
    display: 'flex',
    justifyContent: 'center',
    '@media (max-width: 720px)': {
      padding: 'var(--space-md)',
    },
  },
  shell: {
    width: '100%',
    maxWidth: '1280px',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-xl)',
  },
  brandRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-md)',
    paddingBottom: 'var(--space-md)',
    borderBottom: '1px solid var(--color-border)',
    '@media (max-width: 760px)': {
      flexDirection: 'column',
      alignItems: 'flex-start',
    },
  },
  brandBlock: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 'var(--space-sm)',
  },
  appTitle: {
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-primary)',
    fontWeight: '700',
    fontSize: '0.9rem',
  },
  appSubtitle: {
    display: 'none',
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
  pinField: {
    display: 'grid',
    gap: 'var(--space-sm)',
    minWidth: '280px',
  },
  pinError: {
    color: 'var(--color-error)',
  },
})

export default function App() {
  const styles = useStyles()
  const [pilotState, setPilotState] = useState<PilotState | null>(null)
  const [pilotStateLoading, setPilotStateLoading] = useState(true)
  const [children, setChildren] = useState<ChildProfile[]>([])
  const [childrenLoading, setChildrenLoading] = useState(true)
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null)
  const [onboardingComplete, setOnboardingComplete] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem('speakbright.onboarding.complete') === 'true'
  })
  const [showSetup, setShowSetup] = useState(true)
  const [showLoading, setShowLoading] = useState(false)
  const [showAssessment, setShowAssessment] = useState(false)
  const [showTherapistGate, setShowTherapistGate] = useState(false)
  const [showConsentScreen, setShowConsentScreen] = useState(false)
  const [selectedAvatar, setSelectedAvatar] = useState(DEFAULT_AVATAR)
  const [pendingAvatarValue, setPendingAvatarValue] = useState<string>('lisa-casual-sitting')
  const [pendingModeSelection, setPendingModeSelection] =
    useState<UserMode | null>(null)
  const [therapistGateIntent, setTherapistGateIntent] =
    useState<TherapistGateIntent>('review')
  const [therapistView, setTherapistView] = useState(false)
  const [userMode, setUserMode] = useState<UserMode | null>(() => {
    if (typeof window === 'undefined') return null

    const storedMode = window.sessionStorage.getItem('speakbright.user.mode')
    return storedMode === 'therapist' || storedMode === 'child'
      ? storedMode
      : null
  })
  const [therapistPin, setTherapistPin] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    return window.sessionStorage.getItem('speakbright.therapist.pin')
  })
  const [pinInput, setPinInput] = useState('')
  const [pinError, setPinError] = useState<string | null>(null)
  const [validatingPin, setValidatingPin] = useState(false)
  const [sessionSummaries, setSessionSummaries] = useState<SessionSummary[]>([])
  const [selectedSession, setSelectedSession] = useState<SessionDetail | null>(null)
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [loadingSessionDetail, setLoadingSessionDetail] = useState(false)
  const [currentAgent, setCurrentAgent] = useState<string | null>(null)
  const [sessionStartedAt, setSessionStartedAt] = useState<string | null>(null)
  const [assessment, setAssessment] = useState<Assessment | null>(null)
  const [sessionReady, setSessionReady] = useState(false)
  const [sessionIntroRequested, setSessionIntroRequested] = useState(false)
  const [sessionIntroComplete, setSessionIntroComplete] = useState(false)
  const [avatarVideoReady, setAvatarVideoReady] = useState(false)
  const [assistantSpeechStarted, setAssistantSpeechStarted] = useState(false)
  const [showLaunchTransition, setShowLaunchTransition] = useState(false)
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
  const prewarmedAgentRef = useRef<PrewarmedAgent | null>(null)
  const prewarmingKeyRef = useRef<string | null>(null)
  const prewarmPromiseRef = useRef<Promise<PrewarmedAgent | null> | null>(null)
  const pendingIntroRef = useRef<string | null>(null)

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
  const { playAudio } = useAudioPlayer()
  const activeScenario = scenarios.find(scenario => scenario.id === selectedScenario) || null
  const selectedChild =
    children.find(child => child.id === selectedChildId) || null
  const activeReferenceText = getReferenceText(activeScenario)
  const activeExerciseMetadata = getExerciseMetadata(activeScenario)
  const isChildMode = userMode === 'child' && !therapistView
  const activeAvatarName = getAvatarName(selectedAvatar)
  const activeAvatarPersona = getAvatarPersona(selectedAvatar)
  const appTitle =
    isChildMode
      ? 'SpeakBright child practice'
      : 'SpeakBright therapist practice'
  const launchOverlayVisible =
    !showSetup &&
    showLaunchTransition &&
    (isChildMode ? !assistantSpeechStarted : !avatarVideoReady && !sessionReady)

  // Pre-compose intro instructions so they're ready the instant the session is ready
  useEffect(() => {
    if (isChildMode && selectedScenario) {
      pendingIntroRef.current = buildChildIntroInstructions({
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

    // Eagerly cache /api/config so WebSocket URL is ready before a session starts
    api.getConfig().catch(() => {/* best-effort prefetch */})

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

    return () => {
      cancelled = true
    }
  }, [])

  const handleOpenSession = useCallback(
    async (sessionId: string) => {
      if (!therapistPin) return

      setLoadingSessionDetail(true)

      try {
        const detail = await api.getSession(therapistPin, sessionId)
        setSelectedSession(detail)
      } catch (error) {
        console.error('Failed to load session detail:', error)
        setSelectedSession(null)
      } finally {
        setLoadingSessionDetail(false)
      }
    },
    [therapistPin]
  )

  const loadSessionHistory = useCallback(
    async (childId: string, pin: string) => {
      setLoadingSessions(true)

      try {
        const summaries = await api.getChildSessions(pin, childId)
        setSessionSummaries(summaries)

        if (summaries.length > 0) {
          await handleOpenSession(summaries[0].id)
        } else {
          setSelectedSession(null)
        }
      } catch (error) {
        console.error('Failed to load session history:', error)
        setSessionSummaries([])
        setSelectedSession(null)
      } finally {
        setLoadingSessions(false)
      }
    },
    [handleOpenSession]
  )

  useEffect(() => {
    if (!therapistPin || !selectedChildId) return

    void loadSessionHistory(selectedChildId, therapistPin)
  }, [loadSessionHistory, selectedChildId, therapistPin])

  const handleWebRTCMessage = useCallback((msg: RealtimeMessage) => {
    if (msg.type === 'proxy.connected' || msg.type === 'session.updated') {
      setSessionReady(true)
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
        isChildMode &&
        sessionIntroRequested &&
        !sessionIntroComplete
      ) {
        setSessionIntroComplete(true)
      }
    },
    [isChildMode, sessionIntroComplete, sessionIntroRequested]
  )

  const handleAudioDelta = useCallback(
    (delta: string) => {
      setAssistantSpeechStarted(true)
      playAudio(delta)
    },
    [playAudio]
  )

  useEffect(() => {
    if (showSetup || !showLaunchTransition) {
      return
    }

    if (isChildMode) {
      return
    }

    const timer = window.setTimeout(() => {
      setShowLaunchTransition(false)
    }, 900)

    return () => window.clearTimeout(timer)
  }, [isChildMode, showLaunchTransition, showSetup])

  useEffect(() => {
    if (!showLaunchTransition) {
      return
    }

    if (isChildMode && assistantSpeechStarted) {
      setShowLaunchTransition(false)
      return
    }

    if (!isChildMode && (avatarVideoReady || sessionReady)) {
      setShowLaunchTransition(false)
    }
  }, [assistantSpeechStarted, avatarVideoReady, isChildMode, sessionReady, showLaunchTransition])

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

  // Trigger the greeting only after the avatar video is actually rendered.
  useEffect(() => {
    if (
      !currentAgent ||
      !isChildMode ||
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
    isChildMode,
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

  const {
    recording,
    toggleRecording,
    getAudioRecording,
    clearAudioRecording: clearStreamingAudioRecording,
  } = useRecorder({ mode: 'stream', onAudioChunk: sendAudioChunk })

  const handleUtteranceComplete = useCallback(
    async (audioData: RecorderAudioChunk[]) => {
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
    recording: utteranceRecording,
    toggleRecording: toggleUtteranceRecording,
    clearAudioRecording: clearUtteranceAudioRecording,
  } = useRecorder({
    mode: 'utterance',
    onRecordingComplete: handleUtteranceComplete,
  })

  const releaseAgent = useCallback(async (agentId: string) => {
    try {
      await api.deleteAgent(agentId)
    } catch (error) {
      console.error('Failed to delete agent:', error)
    }
  }, [])

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
      ((userMode === 'therapist' && !therapistView && Boolean(selectedChildId)) ||
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
    releaseAgent,
    selectedAvatar,
    selectedChildId,
    selectedScenario,
    therapistView,
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
    clearStreamingAudioRecording()
    clearUtteranceAudioRecording()
    setUtteranceFeedback(null)
    setSessionStartedAt(null)
    setSessionReady(false)
    setSessionIntroRequested(false)
    setSessionIntroComplete(false)
    setAvatarVideoReady(false)
    setAssistantSpeechStarted(false)
    setShowLaunchTransition(false)
  }, [clearMessages, clearStreamingAudioRecording, clearUtteranceAudioRecording])

  const authenticateTherapistPin = useCallback(
    async (pin: string, openTherapistView = false) => {
      const trimmedPin = pin.trim()
      if (!trimmedPin) {
        setPinError('Enter the therapist PIN to continue.')
        return false
      }

      setValidatingPin(true)
      setPinError(null)

      try {
        await api.authenticateTherapist(trimmedPin)
        setTherapistPin(trimmedPin)
        setTherapistView(openTherapistView)
        setPinInput('')

        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem('speakbright.therapist.pin', trimmedPin)
        }

        return true
      } catch (error) {
        console.error('Therapist PIN validation failed:', error)
        setPinError('The therapist PIN was not recognised.')
        return false
      } finally {
        setValidatingPin(false)
      }
    },
    []
  )

  const startPracticeSession = useCallback(async (avatarValue: string, scenarioOverride?: string) => {
    const activeScenarioId = scenarioOverride ?? selectedScenario
    if (!activeScenarioId) return

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
    setAvatarVideoReady(false)
    setAssistantSpeechStarted(false)
    setShowLaunchTransition(true)
    setUtteranceFeedback(null)
    setSessionStartedAt(new Date().toISOString())
    setFeedbackRating(null)
    setFeedbackNote('')
    setFeedbackSubmittedAt(null)
    setFeedbackError(null)
    setShowSetup(false)

    try {
      if (!agentId) {
        agentId = await createAgentForSelection(activeScenarioId, avatarValue)
      }

      setCurrentAgent(agentId)
    } catch (error) {
      console.error('Failed to create agent:', error)
      // Revert to home on failure so the child isn't stuck
      setShowLaunchTransition(false)
      setShowSetup(true)
    }
  }, [createAgentForSelection, selectedScenario])

  const handleStart = useCallback(async (avatarValue: string, scenarioOverride?: string) => {
    const activeScenarioId = scenarioOverride ?? selectedScenario
    if (!activeScenarioId) return

    // Ensure React state is in sync when called with an override
    if (scenarioOverride && scenarioOverride !== selectedScenario) {
      setSelectedScenario(scenarioOverride)
    }

    setPendingModeSelection(null)

    if (pilotState?.therapist_pin_configured && !therapistPin) {
      setPendingAvatarValue(avatarValue)
      setTherapistGateIntent('start-session')
      setShowTherapistGate(true)
      setPinError('Confirm the therapist PIN before starting a child session.')
      return
    }

    if (!pilotState?.consent_timestamp) {
      setPendingAvatarValue(avatarValue)
      setConsentError(null)
      setShowConsentScreen(true)
      return
    }

    await startPracticeSession(avatarValue, activeScenarioId)
  }, [pilotState, selectedScenario, setSelectedScenario, startPracticeSession, therapistPin])

  const handleAnalyze = async () => {
    if (!selectedScenario) return

    const recordings = getRecordings()
    const audioData = getAudioRecording()

    if (!recordings.conversation.length) return

    setShowLoading(true)

    try {
      const transcript = recordings.conversation
        .map((message: ConversationTurn) => `${message.role}: ${message.content}`)
        .join('\n')

      const result = await api.analyzeConversation(
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

      setAssessment(result)
      setShowAssessment(true)
      setFeedbackRating(null)
      setFeedbackNote('')
      setFeedbackSubmittedAt(null)
      setFeedbackError(null)

      if (therapistView && therapistPin && selectedChildId) {
        await loadSessionHistory(selectedChildId, therapistPin)
      }
    } catch (error) {
      console.error('Analysis failed:', error)
    } finally {
      setShowLoading(false)
    }
  }

  const handleTherapistUnlock = useCallback(async () => {
    const authorized = await authenticateTherapistPin(
      pinInput,
      therapistGateIntent === 'review'
    )

    if (!authorized) {
      return
    }

    setShowTherapistGate(false)

    if (therapistGateIntent === 'mode-switch') {
      setUserMode(null)
      return
    }

    if (therapistGateIntent === 'start-session') {
      if (!pilotState?.consent_timestamp) {
        setConsentError(null)
        setShowConsentScreen(true)
        return
      }

      await startPracticeSession(pendingAvatarValue)
    }
  }, [
    authenticateTherapistPin,
    pendingAvatarValue,
    pinInput,
    pilotState?.consent_timestamp,
    startPracticeSession,
    therapistGateIntent,
  ])

  const handleOnboardingPinConfirm = useCallback(async () => {
    await authenticateTherapistPin(pinInput, false)
  }, [authenticateTherapistPin, pinInput])

  const handleCompleteOnboarding = useCallback(() => {
    if (pilotState?.therapist_pin_configured && !therapistPin) {
      setPinError('Confirm the therapist PIN before continuing.')
      return
    }

    setOnboardingComplete(true)
    setUserMode(null)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('speakbright.onboarding.complete', 'true')
      window.sessionStorage.removeItem('speakbright.user.mode')
    }
  }, [pilotState, therapistPin])

  const handleExitTherapistView = useCallback(() => {
    setTherapistView(false)
  }, [])

  const handleReturnToEntry = useCallback(() => {
    setTherapistView(false)
    setShowSetup(true)
    setUserMode(null)
  }, [])

  const handleGoHome = useCallback(() => {
    disconnect()
    clearMessages()
    clearStreamingAudioRecording()
    clearUtteranceAudioRecording()
    setUtteranceFeedback(null)
    setSessionStartedAt(null)
    setCurrentAgent(null)
    setSessionReady(false)
    setSessionIntroRequested(false)
    setSessionIntroComplete(false)
    setAssessment(null)
    setShowAssessment(false)
    setShowLoading(false)
    setFeedbackRating(null)
    setFeedbackNote('')
    setFeedbackSubmittedAt(null)
    setFeedbackError(null)
    setTherapistView(false)
    setShowSetup(true)
  }, [clearMessages, clearStreamingAudioRecording, clearUtteranceAudioRecording, disconnect])

  const handleLockTherapistMode = useCallback(() => {
    setTherapistView(false)
    setTherapistPin(null)
    setUserMode(null)
    setShowSetup(true)
    setSessionSummaries([])
    setSelectedSession(null)
    setPinError(null)

    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem('speakbright.therapist.pin')
      window.sessionStorage.removeItem('speakbright.user.mode')
    }
  }, [])

  const handleChooseMode = useCallback((mode: UserMode) => {
    if (mode === 'child' && !pilotState?.consent_timestamp) {
      setPendingModeSelection('child')
      setConsentError(null)
      setShowConsentScreen(true)
      return
    }

    if (mode === 'child' && !selectedScenario && serverScenarios[0]) {
      setSelectedScenario(serverScenarios[0].id)
    }

    setUserMode(mode)
    setTherapistView(false)
    setShowSetup(true)

    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem('speakbright.user.mode', mode)
    }
  }, [pilotState?.consent_timestamp, selectedScenario, serverScenarios, setSelectedScenario])

  const handleConsentAccept = useCallback(async () => {
    if (!therapistPin) {
      setConsentError('Confirm the therapist PIN before starting a child session.')
      setShowConsentScreen(false)
      setShowTherapistGate(true)
      return
    }

    setConsentSaving(true)
    setConsentError(null)

    try {
      const updatedState = await api.acknowledgeConsent(therapistPin)
      setPilotState(current => ({
        ...current,
        therapist_pin_configured: current?.therapist_pin_configured ?? true,
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
          window.sessionStorage.setItem('speakbright.user.mode', 'child')
        }

        return
      }

      await startPracticeSession(pendingAvatarValue)
    } catch (error) {
      console.error('Failed to save consent:', error)
      setConsentError('Consent could not be saved right now.')
    } finally {
      setConsentSaving(false)
    }
  }, [
    pendingAvatarValue,
    pendingModeSelection,
    selectedScenario,
    serverScenarios,
    setSelectedScenario,
    startPracticeSession,
    therapistPin,
  ])

  const handleSubmitFeedback = useCallback(async () => {
    if (!assessment?.session_id || !therapistPin || !feedbackRating) {
      setFeedbackError('Choose a quick rating before saving therapist feedback.')
      return
    }

    setFeedbackSaving(true)
    setFeedbackError(null)

    try {
      const updatedSession = await api.submitSessionFeedback(
        therapistPin,
        assessment.session_id,
        feedbackRating,
        feedbackNote
      )
      setFeedbackSubmittedAt(updatedSession.therapist_feedback?.submitted_at || null)

      if (selectedChildId) {
        await loadSessionHistory(selectedChildId, therapistPin)
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
    loadSessionHistory,
    selectedChildId,
    therapistPin,
  ])

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.brandRow}>
          <div className={styles.brandBlock}>
            <Text className={styles.appTitle} size={600} weight="semibold">
              {appTitle}
            </Text>
          </div>
          <Text className={styles.appSubtitle} size={300}>
            Warm, calming exercise sessions for children, with custom practice
            authoring for therapists.
          </Text>

          <div className={styles.brandActions}>
            {(!showSetup || therapistView) && onboardingComplete && (
              <HomeButton
                isSessionActive={!showSetup && (connected || messages.length > 0)}
                onGoHome={handleGoHome}
              />
            )}
            {therapistPin ? (
              <>
                {!therapistView && userMode !== 'child' ? (
                  <Button appearance="secondary" onClick={() => setTherapistView(true)}>
                    Open therapist review
                  </Button>
                ) : null}
                {userMode !== 'child' ? (
                  <Button appearance="subtle" onClick={handleLockTherapistMode}>
                    Lock therapist mode
                  </Button>
                ) : null}
              </>
            ) : (
              userMode !== 'child' ? (
                <Button
                  appearance="subtle"
                  onClick={() => {
                    setTherapistGateIntent('review')
                    setPinError(null)
                    setShowTherapistGate(true)
                  }}
                >
                  Therapist access
                </Button>
              ) : null
            )}
          </div>
        </div>

        {therapistView ? (
          <ProgressDashboard
            childProfiles={children}
            selectedChildId={selectedChildId}
            sessions={sessionSummaries}
            selectedSession={selectedSession}
            loadingChildren={childrenLoading}
            loadingSessions={loadingSessions}
            loadingSessionDetail={loadingSessionDetail}
            onSelectChild={setSelectedChildId}
            onOpenSession={handleOpenSession}
            onBackToPractice={handleExitTherapistView}
            onExitToEntry={handleReturnToEntry}
          />
        ) : !onboardingComplete ? (
          <OnboardingFlow
            loading={pilotStateLoading}
            therapistPinConfigured={pilotState?.therapist_pin_configured ?? true}
            therapistUnlocked={Boolean(therapistPin)}
            pinValue={pinInput}
            pinError={pinError}
            validatingPin={validatingPin}
            onPinChange={setPinInput}
            onConfirmPin={() => {
              void handleOnboardingPinConfirm()
            }}
            onContinue={handleCompleteOnboarding}
          />
        ) : !userMode ? (
          <ModeSelector
            selectedChildName={selectedChild?.name}
            onChooseMode={handleChooseMode}
          />
        ) : showSetup ? (
          loading ? (
            <div className={styles.loadingContent}>
              <Spinner size="large" />
              <Text size={400} weight="semibold">
                Loading exercises...
              </Text>
              <Text size={300}>Your SpeakBright library is getting ready.</Text>
            </div>
          ) : (
            userMode === 'child' ? (
              <ChildHome
                selectedChild={selectedChild}
                selectedAvatar={selectedAvatar}
                selectedScenario={selectedScenario}
                scenarios={serverScenarios}
                therapistUnlocked={Boolean(therapistPin)}
                onExitToEntry={handleReturnToEntry}
                onSelectScenario={(scenarioId: string) => {
                  setSelectedScenario(scenarioId)
                  void handleStart(selectedAvatar, scenarioId)
                }}
                onStartSession={() => {
                  void handleStart(selectedAvatar)
                }}
                onOpenTherapistTools={() => {
                  if (therapistPin) {
                    setUserMode(null)
                    return
                  }

                  setTherapistGateIntent('mode-switch')
                  setPinError(null)
                  setShowTherapistGate(true)
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
                scenarios={serverScenarios}
                customScenarios={customScenarios}
                sessionSummaries={sessionSummaries}
                loadingSessions={loadingSessions}
                therapistUnlocked={Boolean(therapistPin)}
                onSelectChild={childId => setSelectedChildId(childId)}
                onSelectAvatar={setSelectedAvatar}
                onSelectScenario={(scenarioId: string) => {
                  setSelectedScenario(scenarioId)
                  if (selectedChildId) {
                    void handleStart(selectedAvatar, scenarioId)
                  }
                }}
                onStartSession={() => {
                  void handleStart(selectedAvatar)
                }}
                onExitToEntry={handleReturnToEntry}
                onOpenTherapistReview={() => setTherapistView(true)}
                onAddCustomScenario={addCustomScenario}
                onUpdateCustomScenario={updateCustomScenario}
                onDeleteCustomScenario={deleteCustomScenario}
              />
            )
          )
        ) : (
          <div className={styles.sessionLayout}>
            <div className={styles.sessionMain}>
              <ChatPanel
                messages={messages}
                recording={recording}
                connected={connected}
                connectionState={connectionState}
                connectionMessage={connectionMessage}
                introComplete={!isChildMode || sessionIntroComplete}
                canAnalyze={messages.length > 0}
                onToggleRecording={toggleRecording}
                onClear={handleClearSession}
                onAnalyze={handleAnalyze}
                scenario={activeScenario}
                audience={isChildMode ? 'child' : 'therapist'}
                showAnalyzeControl={!isChildMode}
              />
            </div>

            <div className={styles.sessionAside}>
              <VideoPanel
                videoRef={videoRef}
                childName={selectedChild?.name}
                avatarValue={selectedAvatar}
                scenarioName={activeScenario?.name}
                scenarioDescription={activeScenario?.description}
                connectionState={connectionState}
                introPending={isChildMode && sessionIntroRequested && !sessionIntroComplete}
                introComplete={!isChildMode || sessionIntroComplete}
                onVideoLoaded={() => setAvatarVideoReady(true)}
              />
              {!isChildMode ? (
                <Card className={styles.coachCard}>
                  <Text className={styles.coachTitle} size={500} weight="semibold">
                    Therapist view
                  </Text>
                  <Text className={styles.coachText} size={300}>
                    Stay nearby while the child practises. Practice feedback supports the session and does not replace clinical judgement for {selectedChild?.name || 'this child'}.
                  </Text>
                </Card>
              ) : null}
              {isChildMode ? (
                <ExerciseFeedback
                  referenceText={activeReferenceText}
                  feedback={utteranceFeedback}
                  recording={utteranceRecording}
                  loading={scoringUtterance}
                  onToggleRecording={toggleUtteranceRecording}
                />
              ) : null}
            </div>
          </div>
        )}
      </div>

      <SessionLaunchOverlay
        visible={launchOverlayVisible}
        avatarValue={selectedAvatar}
        avatarName={activeAvatarName}
        exerciseName={activeScenario?.name}
      />

      <Dialog open={showLoading}>
        <DialogSurface>
          <DialogBody>
            <div className={styles.loadingContent}>
              <Spinner size="large" />
              <Text size={400} weight="semibold">
                Preparing your results...
              </Text>
              <Text size={300}>This may take up to 30 seconds.</Text>
            </div>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <Dialog
        open={showTherapistGate}
        onOpenChange={(_, data) => setShowTherapistGate(data.open)}
      >
        <DialogSurface>
          <DialogTitle>Therapist access</DialogTitle>
          <DialogBody>
            <Field
              className={styles.pinField}
              label="Enter therapist PIN"
              validationMessage={pinError || undefined}
            >
              <Input
                type="password"
                value={pinInput}
                onChange={(_, data) => setPinInput(data.value)}
                placeholder="PIN"
              />
            </Field>
          </DialogBody>
          <DialogActions>
            <Button appearance="secondary" onClick={() => setShowTherapistGate(false)}>
              Cancel
            </Button>
            <Button appearance="primary" disabled={validatingPin} onClick={handleTherapistUnlock}>
              {validatingPin
                ? 'Checking…'
                : therapistGateIntent === 'start-session'
                  ? 'Confirm and continue'
                  : therapistGateIntent === 'mode-switch'
                    ? 'Open therapist tools'
                    : 'Open therapist review'}
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
        showTherapistControls={!isChildMode}
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
