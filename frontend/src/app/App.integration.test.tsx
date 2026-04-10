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
    onStartScenario,
  }: {
    selectedScenario: string | null
    onSelectScenario: (scenarioId: string) => void
    onStartScenario: (scenarioId: string) => void
  }) => (
    <div>
      <div>child-home:{selectedScenario ?? 'none'}</div>
      <button type="button" onClick={() => onSelectScenario('scenario-2')}>select-scenario-2</button>
      <button type="button" onClick={() => onStartScenario('scenario-2')}>start-scenario-2</button>
    </div>
  ),
}))

vi.mock('../components/ConsentScreen', () => ({
  ConsentScreen: ({ open }: { open: boolean }) => (open ? <div>consent-screen</div> : null),
}))

vi.mock('../components/DashboardHome', () => ({
  DashboardHome: ({
    selectedChildId,
    onSelectChild,
    onStartScenario,
  }: {
    selectedChildId: string | null
    onSelectChild: (childId: string) => void
    onStartScenario: (scenarioId: string) => void
  }) => (
    <div>
      <div>dashboard-home:{selectedChildId ?? 'none'}</div>
      <button type="button" onClick={() => onSelectChild('child-2')}>home-select-child-2</button>
      <button type="button" onClick={() => onStartScenario('scenario-2')}>start-dashboard-scenario-2</button>
    </div>
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
  SettingsView: ({
    selectedChild,
    onSelectChild,
  }: {
    selectedChild: { id: string } | null
    onSelectChild: (childId: string) => void
  }) => (
    <div>
      <div>settings-view:{selectedChild?.id ?? 'none'}</div>
      <button type="button" onClick={() => onSelectChild('child-1')}>settings-select-child-1</button>
      <button type="button" onClick={() => onSelectChild('child-2')}>settings-select-child-2</button>
    </div>
  ),
}))

vi.mock('../components/AssessmentPanel', () => ({
  AssessmentPanel: ({ open }: { open: boolean }) => (open ? <div>assessment-panel</div> : null),
}))

vi.mock('../components/SidebarNav', () => ({
  SidebarNav: ({
    selectedChildId,
    onSelectChild,
    onNavigateHome,
    onNavigateDashboard,
    onNavigateSettings,
  }: {
    selectedChildId: string | null
    onSelectChild: (childId: string) => void
    onNavigateHome: () => void
    onNavigateDashboard: () => void
    onNavigateSettings: () => void
  }) => (
    <div>
      <div>sidebar-nav:{selectedChildId ?? 'none'}</div>
      <button type="button" onClick={onNavigateHome}>nav-home</button>
      <button type="button" onClick={onNavigateDashboard}>nav-dashboard</button>
      <button type="button" onClick={onNavigateSettings}>nav-settings</button>
      <button type="button" onClick={() => onSelectChild('child-2')}>sidebar-select-child-2</button>
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
  parseAvatarValue: vi.fn(() => ({ character: 'meg', style: 'casual', is_photo_avatar: false })),
  api: {
    getAuthSession: vi.fn(),
    getConfig: vi.fn(),
    getScenarios: vi.fn(),
    getPilotState: vi.fn(),
    getChildren: vi.fn(),
    getChildInvitations: vi.fn(),
    getChildSessions: vi.fn(),
    getChildPlans: vi.fn(),
    getChildMemorySummary: vi.fn(),
    getChildMemoryItems: vi.fn(),
    getChildMemoryProposals: vi.fn(),
    getChildRecommendations: vi.fn(),
    getRecommendationDetail: vi.fn(),
    generateChildRecommendations: vi.fn(),
    getChildMemoryEvidence: vi.fn(),
    createChildMemoryItem: vi.fn(),
    approveChildMemoryProposal: vi.fn(),
    rejectChildMemoryProposal: vi.fn(),
    getSession: vi.fn(),
    createAgent: vi.fn(),
    createAgentWithCustomScenario: vi.fn(),
    deleteAgent: vi.fn(),
    analyzeConversation: vi.fn(),
    assessUtterance: vi.fn(),
    getParentalConsent: vi.fn(),
    saveParentalConsent: vi.fn(),
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
  role: 'parent' as const,
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

const childMemorySummaryByChild = {
  'child-1': {
    child_id: 'child-1',
    summary: { targets: [{ statement: 'Keep /k/ active.' }] },
    summary_text: 'Active targets: Keep /k/ active.',
    source_item_count: 1,
  },
  'child-2': {
    child_id: 'child-2',
    summary: { targets: [{ statement: 'Keep /t/ active.' }] },
    summary_text: 'Active targets: Keep /t/ active.',
    source_item_count: 1,
  },
} as const

const childMemoryProposalsByChild = {
  'child-1': [],
  'child-2': [
    {
      id: 'proposal-2',
      child_id: 'child-2',
      category: 'blockers',
      memory_type: 'inference',
      status: 'pending',
      statement: 'Needs support for longer /t/ phrases.',
      detail: {},
      confidence: 0.7,
      provenance: { session_ids: ['session-2'] },
      author_type: 'system',
      created_at: '2026-04-02T12:00:00.000Z',
      updated_at: '2026-04-02T12:00:00.000Z',
    },
  ],
} as const

const recommendationHistoryByChild = {
  'child-1': [
    {
      id: 'recommendation-1',
      child_id: 'child-1',
      source_session_id: 'session-1',
      target_sound: 'k',
      therapist_constraints: { note: '', parsed: {} },
      ranking_context: { current_target_sound: 'k' },
      rationale: 'Matched the active /k/ target.',
      candidate_count: 1,
      top_recommendation_score: 70,
      created_at: '2026-04-01T12:30:00.000Z',
      top_recommendation: {
        rank: 1,
        exercise_id: 'scenario-1',
        exercise_name: 'Scenario 1',
        score: 70,
        rationale: 'Matched the active /k/ target.',
      },
    },
  ],
  'child-2': [
    {
      id: 'recommendation-2',
      child_id: 'child-2',
      source_session_id: 'session-2',
      target_sound: 't',
      therapist_constraints: { note: '', parsed: {} },
      ranking_context: { current_target_sound: 't' },
      rationale: 'Matched the active /t/ target.',
      candidate_count: 1,
      top_recommendation_score: 74,
      created_at: '2026-04-02T12:30:00.000Z',
      top_recommendation: {
        rank: 1,
        exercise_id: 'scenario-2',
        exercise_name: 'Scenario 2',
        score: 74,
        rationale: 'Matched the active /t/ target.',
      },
    },
  ],
} as const

const recommendationDetailsById = {
  'recommendation-1': {
    ...recommendationHistoryByChild['child-1'][0],
    candidates: [],
  },
  'recommendation-2': {
    ...recommendationHistoryByChild['child-2'][0],
    candidates: [],
  },
} as const

const childMemoryItemsByChild = {
  'child-1': [
    {
      id: 'memory-1',
      child_id: 'child-1',
      category: 'targets',
      memory_type: 'constraint',
      status: 'approved',
      statement: 'Keep /k/ active.',
      detail: {},
      confidence: 0.8,
      provenance: { source: 'post_session_analysis' },
      author_type: 'system',
      created_at: '2026-04-01T12:00:00.000Z',
      updated_at: '2026-04-01T12:00:00.000Z',
      evidence_links: [],
    },
  ],
  'child-2': [
    {
      id: 'memory-2',
      child_id: 'child-2',
      category: 'targets',
      memory_type: 'constraint',
      status: 'approved',
      statement: 'Keep /t/ active.',
      detail: {},
      confidence: 0.82,
      provenance: { source: 'post_session_analysis' },
      author_type: 'system',
      created_at: '2026-04-02T12:00:00.000Z',
      updated_at: '2026-04-02T12:00:00.000Z',
      evidence_links: [],
    },
  ],
} as const

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
    mockedApi.getParentalConsent.mockResolvedValue({ consent: { id: 'consent-1' } } as never)
    mockedApi.saveParentalConsent.mockResolvedValue({ id: 'consent-1' } as never)
    mockedApi.getChildren.mockResolvedValue([])
    mockedApi.getChildInvitations.mockResolvedValue([] as never)
    mockedApi.getChildSessions.mockImplementation(async childId => sessionSummariesByChild[childId as keyof typeof sessionSummariesByChild] ?? [])
    mockedApi.getChildPlans.mockImplementation(async childId => childPlansByChild[childId as keyof typeof childPlansByChild] ?? [])
    mockedApi.getChildMemorySummary.mockImplementation(async childId => childMemorySummaryByChild[childId as keyof typeof childMemorySummaryByChild] as never)
    mockedApi.getChildMemoryItems.mockImplementation(async childId => childMemoryItemsByChild[childId as keyof typeof childMemoryItemsByChild] as never)
    mockedApi.getChildMemoryProposals.mockImplementation(async childId => childMemoryProposalsByChild[childId as keyof typeof childMemoryProposalsByChild] as never)
    mockedApi.getChildRecommendations.mockImplementation(async childId => recommendationHistoryByChild[childId as keyof typeof recommendationHistoryByChild] as never)
    mockedApi.getRecommendationDetail.mockImplementation(async recommendationId => recommendationDetailsById[recommendationId as keyof typeof recommendationDetailsById] as never)
    mockedApi.generateChildRecommendations.mockResolvedValue(recommendationDetailsById['recommendation-2'] as never)
    mockedApi.getSession.mockImplementation(async sessionId => sessionDetailsById[sessionId as keyof typeof sessionDetailsById] as never)
    mockedApi.createAgent.mockResolvedValue({ agent_id: 'agent-1' } as never)
    mockedApi.createAgentWithCustomScenario.mockResolvedValue({ agent_id: 'agent-1' } as never)
    mockedApi.createChildMemoryItem.mockResolvedValue({
      item: childMemoryItemsByChild['child-2'][0],
      summary: childMemorySummaryByChild['child-2'],
    } as never)
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

  it('preserves invitation query params when redirecting unauthenticated users to login', async () => {
    mockedApi.getAuthSession.mockRejectedValue(new Error('UNAUTHORIZED'))

    renderApp(`${APP_ROUTES.root}?${APP_ROUTE_PARAMS.invitationId}=invite-123`)

    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe(
        `${APP_ROUTES.login}?${APP_ROUTE_PARAMS.invitationId}=invite-123`
      )
    })
  })

  it('routes authenticated users with an invitation query to settings', async () => {
    renderApp(`${APP_ROUTES.root}?${APP_ROUTE_PARAMS.invitationId}=invite-123`)

    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe(
        `${APP_ROUTES.settings}?${APP_ROUTE_PARAMS.invitationId}=invite-123`
      )
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

  it('routes therapist users through onboarding before landing on home', async () => {
    mockedApi.getAuthSession.mockResolvedValue(therapistUser)

    renderApp(APP_ROUTES.root)

    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe(APP_ROUTES.onboarding)
    })

    fireEvent.click(screen.getByText('complete-onboarding'))

    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe(
        `${APP_ROUTES.home}?${APP_ROUTE_PARAMS.scenarioId}=scenario-1`
      )
    })

    expect(screen.getByText('dashboard-home:none')).toBeTruthy()
  })

  it('routes parent users directly to home without the legacy mode stop', async () => {
    renderApp(APP_ROUTES.root)

    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe(APP_ROUTES.home)
    })

    expect(screen.getByText('dashboard-home:none')).toBeTruthy()
  })

  it('hydrates therapist child selection from the dashboard childId query param', async () => {
    window.localStorage.setItem('wulo.onboarding.complete', 'true')
    window.localStorage.setItem('wulo.user.mode', 'workspace')
    mockedApi.getAuthSession.mockResolvedValue(therapistUser)
    mockedApi.getChildren.mockResolvedValue(childProfiles as never)

    renderApp(`${APP_ROUTES.dashboard}?${APP_ROUTE_PARAMS.childId}=child-2`)

    await waitFor(() => {
      expect(screen.getByText('progress-dashboard:child-2:session-2:plan-2')).toBeTruthy()
    })

    expect(mockedApi.getChildSessions).toHaveBeenCalledWith('child-2')
    expect(mockedApi.getChildMemorySummary).toHaveBeenCalledWith('child-2')
    expect(mockedApi.getChildMemoryItems).toHaveBeenCalledWith('child-2', { includeEvidence: true })
    expect(mockedApi.getChildMemoryProposals).toHaveBeenCalledWith('child-2', { status: 'pending', includeEvidence: true })
    expect(mockedApi.getChildRecommendations).toHaveBeenCalledWith('child-2')
    expect(mockedApi.getRecommendationDetail).toHaveBeenCalledWith('recommendation-2')
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

  it('keeps child selection in sync across dashboard, home, and settings surfaces', async () => {
    window.localStorage.setItem('wulo.onboarding.complete', 'true')
    window.localStorage.setItem('wulo.user.mode', 'workspace')
    mockedApi.getAuthSession.mockResolvedValue(therapistUser)
    mockedApi.getChildren.mockResolvedValue(childProfiles as never)

    renderApp(`${APP_ROUTES.dashboard}?${APP_ROUTE_PARAMS.childId}=child-1`)

    await waitFor(() => {
      expect(screen.getByText('progress-dashboard:child-1:session-1:plan-1')).toBeTruthy()
    })

    expect(screen.getByText('sidebar-nav:child-1')).toBeTruthy()

    fireEvent.click(screen.getByText('sidebar-select-child-2'))

    await waitFor(() => {
      expect(screen.getByText('progress-dashboard:child-2:session-2:plan-2')).toBeTruthy()
    })

    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe(
        `${APP_ROUTES.dashboard}?${APP_ROUTE_PARAMS.childId}=child-2&${APP_ROUTE_PARAMS.sessionId}=session-2&${APP_ROUTE_PARAMS.planId}=plan-2`
      )
    })

    expect(screen.getByText('sidebar-nav:child-2')).toBeTruthy()

    fireEvent.click(screen.getByText('nav-home'))

    await waitFor(() => {
      expect(screen.getByText('dashboard-home:child-2')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('nav-settings'))

    await waitFor(() => {
      expect(screen.getByText('settings-view:child-2')).toBeTruthy()
    })

    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe(
        `${APP_ROUTES.settings}?${APP_ROUTE_PARAMS.childId}=child-2`
      )
    })
  })

  it('navigates to the session route when a child exercise is started directly', async () => {
    window.localStorage.setItem('wulo.onboarding.complete', 'true')
    window.localStorage.setItem('wulo.user.mode', 'child')

    renderApp(APP_ROUTES.home)

    await waitFor(() => {
      expect(screen.getByText('child-home:scenario-1')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('start-scenario-2'))

    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe(APP_ROUTES.session)
    })
  })

  it('updates the childId query param after dashboard child selection changes', async () => {
    window.localStorage.setItem('wulo.onboarding.complete', 'true')
    window.localStorage.setItem('wulo.user.mode', 'workspace')
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

  it('navigates to the session route when a therapist starts an exercise directly from home', async () => {
    window.localStorage.setItem('wulo.onboarding.complete', 'true')
    window.localStorage.setItem('wulo.user.mode', 'workspace')
    mockedApi.getAuthSession.mockResolvedValue(therapistUser)
    mockedApi.getChildren.mockResolvedValue(childProfiles as never)
    mockedApi.getPilotState.mockResolvedValue({ consent_timestamp: '2026-04-01T10:00:00.000Z', therapist_pin_configured: false } as never)

    renderApp(`${APP_ROUTES.home}?${APP_ROUTE_PARAMS.childId}=child-1&${APP_ROUTE_PARAMS.scenarioId}=scenario-1`)

    await waitFor(() => {
      expect(screen.getByText('dashboard-home:child-1')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('start-dashboard-scenario-2'))

    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe(APP_ROUTES.session)
    })
  })

  it('opens a reviewed session from dashboard query params without starting a live session', async () => {
    window.localStorage.setItem('wulo.onboarding.complete', 'true')
    window.localStorage.setItem('wulo.user.mode', 'workspace')
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
    window.localStorage.setItem('wulo.user.mode', 'workspace')
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
    window.localStorage.setItem('wulo.user.mode', 'workspace')
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

    expect(screen.getByText('settings-view:none')).toBeTruthy()
  })
})