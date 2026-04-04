import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router-dom'
import App from './App'
import { APP_ROUTE_PARAMS, APP_ROUTES } from './routes'
import { api } from '../services/api'

vi.mock('@fluentui/react-components', async importOriginal => {
  const actual = await importOriginal<typeof import('@fluentui/react-components')>()

  return {
    ...actual,
    Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
      open ? <div>{children}</div> : null,
    DialogSurface: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    DialogBody: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    DialogActions: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  }
})

const realtimeState = {
  connected: false,
  connectionState: 'connected',
  connectionMessage: 'ready',
  messages: [] as Array<{ id: string; role: string; content: string; timestamp: Date }>,
  send: vi.fn(),
  disconnect: vi.fn(),
  clearMessages: vi.fn(),
  getRecordings: vi.fn(() => ({ conversation: [], audio: [] })),
}

const recorderState = {
  recording: false,
  toggleRecording: vi.fn(async () => {}),
  getAudioRecording: vi.fn(() => []),
  clearAudioRecording: vi.fn(),
}

const scenarioFixtures = {
  scenarios: [
    {
      id: 'scenario-1',
      name: 'Scenario 1',
      description: 'Practice scenario',
      exerciseMetadata: { type: 'sound_isolation', targetSound: 'k', targetWords: ['cat'] },
    },
    {
      id: 'scenario-2',
      name: 'Scenario 2',
      description: 'Second practice scenario',
      exerciseMetadata: { type: 'sound_isolation', targetSound: 't', targetWords: ['top'] },
    },
  ],
  serverScenarios: [
    {
      id: 'scenario-1',
      name: 'Scenario 1',
      description: 'Practice scenario',
      exerciseMetadata: { type: 'sound_isolation', targetSound: 'k', targetWords: ['cat'] },
    },
    {
      id: 'scenario-2',
      name: 'Scenario 2',
      description: 'Second practice scenario',
      exerciseMetadata: { type: 'sound_isolation', targetSound: 't', targetWords: ['top'] },
    },
  ],
  customScenarios: [],
}

vi.mock('../components/AuthGateScreen', () => ({
  AuthGateScreen: ({ status }: { status: string }) => <div>auth:{status}</div>,
}))

vi.mock('../components/LogoutScreen', () => ({
  LogoutScreen: () => <div>logout-screen</div>,
}))

vi.mock('../components/ChildHome', () => ({
  ChildHome: ({
    selectedScenario,
    onSelectScenario,
  }: {
    selectedScenario: string | null
    onSelectScenario: (scenarioId: string) => void
  }) => (
    <div>
      <div>child-home:{selectedScenario ?? 'none'}</div>
      <button type="button" onClick={() => onSelectScenario('scenario-2')}>select-scenario-2</button>
    </div>
  ),
}))

vi.mock('../components/ConsentScreen', () => ({
  ConsentScreen: ({ open }: { open: boolean }) => (open ? <div>consent-screen</div> : null),
}))

vi.mock('../components/DashboardHome', () => ({
  DashboardHome: () => <div>dashboard-home</div>,
}))

vi.mock('../components/ModeSelector', () => ({
  ModeSelector: ({ onChooseMode }: { onChooseMode: (mode: 'child' | 'therapist') => void }) => (
    <button type="button" onClick={() => onChooseMode('child')}>choose-child</button>
  ),
}))

vi.mock('../components/OnboardingFlow', () => ({
  OnboardingFlow: ({ onContinue }: { onContinue: () => void }) => (
    <button type="button" onClick={onContinue}>complete-onboarding</button>
  ),
}))

vi.mock('../components/ProgressDashboard', () => ({
  ProgressDashboard: ({
    selectedChildId,
    selectedPlan,
    selectedSession,
    onSelectChild,
    onOpenSession,
  }: {
    selectedChildId: string | null
    selectedPlan: { id: string } | null
    selectedSession: { id: string } | null
    onSelectChild: (childId: string) => void
    onOpenSession: (sessionId: string) => void
  }) => (
    <div>
      <div>progress-dashboard:{selectedChildId ?? 'none'}:{selectedSession?.id ?? 'none'}:{selectedPlan?.id ?? 'none'}</div>
      <button type="button" onClick={() => onSelectChild('child-2')}>select-child-2</button>
      <button type="button" onClick={() => onOpenSession('session-2')}>open-session-2</button>
    </div>
  ),
}))

vi.mock('../components/SessionLaunchOverlay', () => ({
  SessionLaunchOverlay: ({ visible }: { visible: boolean }) => (visible ? <div>launch-overlay</div> : null),
}))

vi.mock('../components/SessionScreen', () => ({
  SessionScreen: () => <div>session-screen</div>,
}))

vi.mock('../components/SettingsView', () => ({
  SettingsView: () => <div>settings-view</div>,
}))

vi.mock('../components/AssessmentPanel', () => ({
  AssessmentPanel: ({ open }: { open: boolean }) => (open ? <div>assessment-panel</div> : null),
}))

vi.mock('../components/SidebarNav', () => ({
  SidebarNav: ({
    onNavigateHome,
    onNavigateDashboard,
    onNavigateSettings,
  }: {
    onNavigateHome: () => void
    onNavigateDashboard: () => void
    onNavigateSettings: () => void
  }) => (
    <div>
      <button type="button" onClick={onNavigateHome}>nav-home</button>
      <button type="button" onClick={onNavigateDashboard}>nav-dashboard</button>
      <button type="button" onClick={onNavigateSettings}>nav-settings</button>
    </div>
  ),
}))

vi.mock('../hooks/useAudioPlayer', () => ({
  useAudioPlayer: () => ({ playAudio: vi.fn(), stopAudio: vi.fn() }),
}))

vi.mock('../hooks/useRealtime', () => ({
  useRealtime: () => realtimeState,
}))

vi.mock('../hooks/useRecorder', () => ({
  useRecorder: () => recorderState,
}))

vi.mock('../hooks/useSessionTimer', () => ({
  useSessionTimer: vi.fn(),
}))

vi.mock('../hooks/useWebRTC', () => ({
  useWebRTC: () => ({
    setupWebRTC: vi.fn(),
    handleAnswer: vi.fn(),
    videoRef: { current: null },
  }),
}))

vi.mock('../services/api', () => ({
  parseAvatarValue: vi.fn(() => ({ character: 'lisa', style: 'casual-sitting', is_photo_avatar: false })),
  api: {
    getAuthSession: vi.fn(),
    getConfig: vi.fn(),
    getScenarios: vi.fn(),
    getPilotState: vi.fn(),
    getChildren: vi.fn(),
    getChildSessions: vi.fn(),
    getChildPlans: vi.fn(),
    getSession: vi.fn(),
    createAgent: vi.fn(),
    createAgentWithCustomScenario: vi.fn(),
    deleteAgent: vi.fn(),
    analyzeConversation: vi.fn(),
    assessUtterance: vi.fn(),
    acknowledgeConsent: vi.fn(),
    submitSessionFeedback: vi.fn(),
    createPracticePlan: vi.fn(),
    refinePracticePlan: vi.fn(),
    approvePracticePlan: vi.fn(),
  },
}))

vi.mock('../services/customScenarios', () => ({
  customScenarioService: {
    getAll: vi.fn(() => []),
    save: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}))

const mockedApi = vi.mocked(api)

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname}{location.search}</div>
}

function renderApp(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <LocationProbe />
      <App />
    </MemoryRouter>
  )
}

const authenticatedUser = {
  authenticated: true,
  user_id: 'user-1',
  name: 'Test User',
  email: 'user@example.com',
  provider: 'aad',
  role: 'user' as const,
}

const therapistUser = {
  ...authenticatedUser,
  role: 'therapist' as const,
}

const configResponse = {
  status: 'ok',
  proxy_enabled: true,
  ws_endpoint: '/ws/voice',
  storage_ready: true,
  telemetry_enabled: false,
  image_base_path: '/api/images',
  planner: {
    ready: true,
    model: 'gpt-5',
    sdk_installed: true,
    cli: { available: true, authenticated: true },
    auth: { github_token_configured: true, azure_byok_configured: true },
    reasons: [],
  },
}

const childProfiles = [
  { id: 'child-1', name: 'Ada' },
  { id: 'child-2', name: 'Ben' },
]

const sessionSummariesByChild: Record<string, Array<{ id: string; timestamp: string; exercise: { id: string; name: string; description: string; exerciseMetadata: { type: 'sound_isolation'; targetSound: string; targetWords: string[] } } }>> = {
  'child-1': [
    {
      id: 'session-1',
      timestamp: '2026-04-01T10:00:00.000Z',
      exercise: {
        id: 'scenario-1',
        name: 'Scenario 1',
        description: 'Practice scenario',
        exerciseMetadata: { type: 'sound_isolation', targetSound: 'k', targetWords: ['cat'] },
      },
    },
  ],
  'child-2': [
    {
      id: 'session-2',
      timestamp: '2026-04-02T10:00:00.000Z',
      exercise: {
        id: 'scenario-2',
        name: 'Scenario 2',
        description: 'Second practice scenario',
        exerciseMetadata: { type: 'sound_isolation', targetSound: 't', targetWords: ['top'] },
      },
    },
  ],
}

const sessionDetailsById = {
  'session-1': {
    id: 'session-1',
    timestamp: '2026-04-01T10:00:00.000Z',
    child: { id: 'child-1', name: 'Ada' },
    exercise: {
      id: 'scenario-1',
      name: 'Scenario 1',
      description: 'Practice scenario',
      exerciseMetadata: { type: 'sound_isolation', targetSound: 'k', targetWords: ['cat'] },
    },
    assessment: { session_id: 'session-1' },
  },
  'session-2': {
    id: 'session-2',
    timestamp: '2026-04-02T10:00:00.000Z',
    child: { id: 'child-2', name: 'Ben' },
    exercise: {
      id: 'scenario-2',
      name: 'Scenario 2',
      description: 'Second practice scenario',
      exerciseMetadata: { type: 'sound_isolation', targetSound: 't', targetWords: ['top'] },
    },
    assessment: { session_id: 'session-2' },
  },
} as const

const childPlansByChild: Record<string, Array<{ id: string; child_id: string; source_session_id: string; status: 'draft' | 'approved'; title: string; plan_type: string; constraints: Record<string, unknown>; draft: { objective: string; focus_sound: string; rationale: string; estimated_duration_minutes: number; activities: []; therapist_cues: []; success_criteria: []; carryover: [] }; conversation: []; created_at: string; updated_at: string }>> = {
  'child-1': [
    {
      id: 'plan-1',
      child_id: 'child-1',
      source_session_id: 'session-1',
      status: 'draft',
      title: 'Plan 1',
      plan_type: 'follow-up',
      constraints: {},
      draft: {
        objective: 'Stabilize /k/',
        focus_sound: 'k',
        rationale: 'Build on recent success.',
        estimated_duration_minutes: 20,
        activities: [],
        therapist_cues: [],
        success_criteria: [],
        carryover: [],
      },
      conversation: [],
      created_at: '2026-04-01T12:00:00.000Z',
      updated_at: '2026-04-01T12:00:00.000Z',
    },
  ],
  'child-2': [
    {
      id: 'plan-2',
      child_id: 'child-2',
      source_session_id: 'session-2',
      status: 'approved',
      title: 'Plan 2',
      plan_type: 'follow-up',
      constraints: {},
      draft: {
        objective: 'Stabilize /t/',
        focus_sound: 't',
        rationale: 'Use the reviewed session as the next-step anchor.',
        estimated_duration_minutes: 20,
        activities: [],
        therapist_cues: [],
        success_criteria: [],
        carryover: [],
      },
      conversation: [],
      created_at: '2026-04-02T12:00:00.000Z',
      updated_at: '2026-04-02T12:00:00.000Z',
    },
  ],
}

describe('App routing integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    window.sessionStorage.clear()

    realtimeState.connected = false
    realtimeState.messages = []
    realtimeState.connectionState = 'connected'
    realtimeState.connectionMessage = 'ready'
    realtimeState.send.mockReset()
    realtimeState.disconnect.mockReset()
    realtimeState.clearMessages.mockReset()
    realtimeState.getRecordings.mockReset()
    realtimeState.getRecordings.mockReturnValue({ conversation: [], audio: [] })

    recorderState.recording = false
    recorderState.toggleRecording.mockReset()
    recorderState.getAudioRecording.mockReset()
    recorderState.getAudioRecording.mockReturnValue([])
    recorderState.clearAudioRecording.mockReset()

    mockedApi.getAuthSession.mockResolvedValue(authenticatedUser)
    mockedApi.getConfig.mockResolvedValue(configResponse as never)
    mockedApi.getScenarios.mockResolvedValue(scenarioFixtures.serverScenarios as never)
    mockedApi.getPilotState.mockResolvedValue({ consent_timestamp: null, therapist_pin_configured: false } as never)
    mockedApi.getChildren.mockResolvedValue([])
    mockedApi.getChildSessions.mockImplementation(async childId => sessionSummariesByChild[childId as keyof typeof sessionSummariesByChild] ?? [])
    mockedApi.getChildPlans.mockImplementation(async childId => childPlansByChild[childId as keyof typeof childPlansByChild] ?? [])
    mockedApi.getSession.mockImplementation(async sessionId => sessionDetailsById[sessionId as keyof typeof sessionDetailsById] as never)
    mockedApi.createAgent.mockResolvedValue({ agent_id: 'agent-1' } as never)
    mockedApi.createAgentWithCustomScenario.mockResolvedValue({ agent_id: 'agent-1' } as never)
    mockedApi.deleteAgent.mockResolvedValue(undefined as never)
  })

  it('redirects unauthenticated users to the login route', async () => {
    mockedApi.getAuthSession.mockRejectedValue(new Error('UNAUTHORIZED'))

    renderApp(APP_ROUTES.dashboard)

    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe(APP_ROUTES.login)
    })

    await waitFor(() => {
      expect(screen.getByText('auth:unauthenticated')).toBeTruthy()
    })
  })

  it('redirects non-therapists away from the dashboard route', async () => {
    window.localStorage.setItem('wulo.onboarding.complete', 'true')
    window.localStorage.setItem('wulo.user.mode', 'child')

    renderApp(APP_ROUTES.dashboard)

    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe(APP_ROUTES.home)
    })

    expect(screen.getByText('child-home:scenario-1')).toBeTruthy()
    expect(screen.getByText('Role required')).toBeTruthy()

    fireEvent.click(screen.getByText('Close'))

    await waitFor(() => {
      expect(screen.queryByText('Role required')).toBeNull()
    })
  })

  it('hydrates therapist child selection from the dashboard childId query param', async () => {
    window.localStorage.setItem('wulo.onboarding.complete', 'true')
    window.localStorage.setItem('wulo.user.mode', 'therapist')
    mockedApi.getAuthSession.mockResolvedValue(therapistUser)
    mockedApi.getChildren.mockResolvedValue(childProfiles as never)

    renderApp(`${APP_ROUTES.dashboard}?${APP_ROUTE_PARAMS.childId}=child-2`)

    await waitFor(() => {
      expect(screen.getByText('progress-dashboard:child-2:session-2:plan-2')).toBeTruthy()
    })

    expect(mockedApi.getChildSessions).toHaveBeenCalledWith('child-2')
  })

  it('syncs the selected scenario into the home route query params', async () => {
    window.localStorage.setItem('wulo.onboarding.complete', 'true')
    window.localStorage.setItem('wulo.user.mode', 'child')

    renderApp(APP_ROUTES.home)

    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe(
        `${APP_ROUTES.home}?${APP_ROUTE_PARAMS.scenarioId}=scenario-1`
      )
    })

    expect(screen.getByText('child-home:scenario-1')).toBeTruthy()
  })

  it('hydrates the selected scenario from the home scenarioId query param', async () => {
    window.localStorage.setItem('wulo.onboarding.complete', 'true')
    window.localStorage.setItem('wulo.user.mode', 'child')

    renderApp(`${APP_ROUTES.home}?${APP_ROUTE_PARAMS.scenarioId}=scenario-2`)

    await waitFor(() => {
      expect(screen.getByText('child-home:scenario-2')).toBeTruthy()
    })
  })

  it('updates the scenarioId query param after home selection changes', async () => {
    window.localStorage.setItem('wulo.onboarding.complete', 'true')
    window.localStorage.setItem('wulo.user.mode', 'child')

    renderApp(APP_ROUTES.home)

    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe(
        `${APP_ROUTES.home}?${APP_ROUTE_PARAMS.scenarioId}=scenario-1`
      )
    })

    fireEvent.click(screen.getByText('select-scenario-2'))

    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe(
        `${APP_ROUTES.home}?${APP_ROUTE_PARAMS.scenarioId}=scenario-2`
      )
    })

    expect(screen.getByText('child-home:scenario-2')).toBeTruthy()
  })

  it('updates the childId query param after dashboard child selection changes', async () => {
    window.localStorage.setItem('wulo.onboarding.complete', 'true')
    window.localStorage.setItem('wulo.user.mode', 'therapist')
    mockedApi.getAuthSession.mockResolvedValue(therapistUser)
    mockedApi.getChildren.mockResolvedValue(childProfiles as never)

    renderApp(`${APP_ROUTES.dashboard}?${APP_ROUTE_PARAMS.childId}=child-1`)

    await waitFor(() => {
      expect(screen.getByText('progress-dashboard:child-1:session-1:plan-1')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('select-child-2'))

    await waitFor(() => {
      const search = screen.getByTestId('location').textContent?.split('?')[1] || ''
      const params = new URLSearchParams(search)
      expect(params.get(APP_ROUTE_PARAMS.childId)).toBe('child-2')
      expect(params.get(APP_ROUTE_PARAMS.sessionId)).toBe('session-2')
      expect(params.get(APP_ROUTE_PARAMS.planId)).toBe('plan-2')
    })
  })

  it('opens a reviewed session from dashboard query params without starting a live session', async () => {
    window.localStorage.setItem('wulo.onboarding.complete', 'true')
    window.localStorage.setItem('wulo.user.mode', 'therapist')
    mockedApi.getAuthSession.mockResolvedValue(therapistUser)
    mockedApi.getChildren.mockResolvedValue(childProfiles as never)

    renderApp(
      `${APP_ROUTES.dashboard}?${APP_ROUTE_PARAMS.childId}=child-2&${APP_ROUTE_PARAMS.sessionId}=session-2`
    )

    await waitFor(() => {
      expect(screen.getByText('progress-dashboard:child-2:session-2:plan-2')).toBeTruthy()
    })

    expect(screen.queryByText('session-screen')).toBeNull()
  })

  it('opens a reviewed plan from dashboard query params and aligns the linked session', async () => {
    window.localStorage.setItem('wulo.onboarding.complete', 'true')
    window.localStorage.setItem('wulo.user.mode', 'therapist')
    mockedApi.getAuthSession.mockResolvedValue(therapistUser)
    mockedApi.getChildren.mockResolvedValue(childProfiles as never)

    renderApp(
      `${APP_ROUTES.dashboard}?${APP_ROUTE_PARAMS.childId}=child-2&${APP_ROUTE_PARAMS.planId}=plan-2`
    )

    await waitFor(() => {
      expect(screen.getByText('progress-dashboard:child-2:session-2:plan-2')).toBeTruthy()
    })

    await waitFor(() => {
      const locationText = screen.getByTestId('location').textContent || ''
      const [pathname, search = ''] = locationText.split('?')
      const params = new URLSearchParams(search)

      expect(pathname).toBe(APP_ROUTES.dashboard)
      expect(params.get(APP_ROUTE_PARAMS.childId)).toBe('child-2')
      expect(params.get(APP_ROUTE_PARAMS.sessionId)).toBe('session-2')
      expect(params.get(APP_ROUTE_PARAMS.planId)).toBe('plan-2')
    })

    expect(screen.queryByText('session-screen')).toBeNull()
  })

  it('updates the sessionId query param after opening a reviewed session from dashboard', async () => {
    window.localStorage.setItem('wulo.onboarding.complete', 'true')
    window.localStorage.setItem('wulo.user.mode', 'therapist')
    mockedApi.getAuthSession.mockResolvedValue(therapistUser)
    mockedApi.getChildren.mockResolvedValue(childProfiles as never)

    renderApp(`${APP_ROUTES.dashboard}?${APP_ROUTE_PARAMS.childId}=child-2`)

    await waitFor(() => {
      expect(screen.getByText('progress-dashboard:child-2:session-2:plan-2')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('open-session-2'))

    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe(
        `${APP_ROUTES.dashboard}?${APP_ROUTE_PARAMS.childId}=child-2&${APP_ROUTE_PARAMS.sessionId}=session-2&${APP_ROUTE_PARAMS.planId}=plan-2`
      )
    })
  })

  it('confirms before leaving an active session route', async () => {
    window.localStorage.setItem('wulo.onboarding.complete', 'true')
    window.localStorage.setItem('wulo.user.mode', 'child')
    realtimeState.connected = true

    renderApp(APP_ROUTES.session)

    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe(APP_ROUTES.session)
    })

    expect(screen.getByText('session-screen')).toBeTruthy()

    fireEvent.click(screen.getByText('nav-settings'))

    expect(screen.getByText('Leave this session?')).toBeTruthy()
    expect(screen.getByTestId('location').textContent).toBe(APP_ROUTES.session)

    fireEvent.click(screen.getByText('Leave session'))

    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe(APP_ROUTES.settings)
    })

    expect(screen.getByText('settings-view')).toBeTruthy()
  })
})