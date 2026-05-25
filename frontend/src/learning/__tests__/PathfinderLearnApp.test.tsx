import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthSession } from '../../services/api'
import type { ChildProfile } from '../../types'

const apiMocks = vi.hoisted(() => ({
  getAuthSession: vi.fn(),
  getChildren: vi.fn(),
  getConfig: vi.fn(),
  createSelfLearner: vi.fn(),
}))

vi.mock('../../services/api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../services/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      getAuthSession: apiMocks.getAuthSession,
      getChildren: apiMocks.getChildren,
      getConfig: apiMocks.getConfig,
      createSelfLearner: apiMocks.createSelfLearner,
    },
  }
})

vi.mock('../routes/StudentLearningHome', () => ({
  default: ({ studentId }: { studentId: string | null }) => (
    <div data-testid="student-learning-home">Learner dashboard {studentId}</div>
  ),
}))

vi.mock('../routes/TeacherMasteryDashboard', () => ({
  default: () => <div data-testid="teacher-dashboard" />,
}))

vi.mock('../routes/SkillLibrary', () => ({
  default: () => <div data-testid="skill-library" />,
}))

vi.mock('../routes/StudentMasteryProfile', () => ({
  default: () => <div data-testid="student-mastery-profile" />,
}))

vi.mock('../routes/PathwaysExplorer', () => ({
  default: () => <div data-testid="pathways-explorer" />,
}))

vi.mock('../routes/TrustSafetyConsole', () => ({
  default: () => <div data-testid="trust-safety-console" />,
}))

vi.mock('../components/VoiceAgentFullscreen', () => ({
  default: () => <div data-testid="voice-agent-fullscreen" />,
}))

vi.mock('../../components/InsightsRail', () => ({
  InsightsRail: () => <div data-testid="insights-rail" />,
}))

import {
  COOKIE_CONSENT_STORAGE_KEY,
  CookieConsentBanner,
  default as PathfinderLearnApp,
  defaultPathForRole,
  navItemsForRole,
} from '../PathfinderLearnApp'

const legacyLearnerSession: AuthSession = {
  authenticated: true,
  user_id: 'learner-legacy',
  name: 'Legacy Learner',
  email: 'legacy@example.com',
  provider: 'aad',
  role: 'learner',
  current_workspace_id: null,
  user_workspaces: [],
  needs_onboarding: false,
  is_self_learner: false,
}

const selfLearnerChild: ChildProfile = {
  id: 'child-self',
  name: 'Legacy Learner',
  workspace_id: 'workspace-self',
}

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname}{location.search}</div>
}

function renderLearningApp() {
  return render(
    <MemoryRouter initialEntries={['/home']}>
      <PathfinderLearnApp />
      <LocationProbe />
    </MemoryRouter>,
  )
}

afterEach(() => {
  window.localStorage.clear()
  vi.clearAllMocks()
})

beforeEach(() => {
  apiMocks.getConfig.mockResolvedValue({
    insights_rail_enabled: false,
    insights_voice_mode: 'off',
    voice_agent_fullscreen_enabled: false,
    voice_agent_actions_enabled: false,
  })
  apiMocks.getAuthSession.mockResolvedValue(legacyLearnerSession)
  apiMocks.getChildren.mockResolvedValue([])
  apiMocks.createSelfLearner.mockResolvedValue(selfLearnerChild)
})

describe('CookieConsentBanner', () => {
  it('renders when storage is empty', () => {
    render(<CookieConsentBanner />)

    expect(screen.getByTestId('cookie-consent-banner')).toBeTruthy()
  })

  it('writes the stable storage key and unmounts when accepted', () => {
    render(<CookieConsentBanner />)

    fireEvent.click(screen.getByTestId('cookie-consent-accept'))

    expect(window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY)).toBe(
      'accepted'
    )
    expect(screen.queryByTestId('cookie-consent-banner')).toBeNull()
  })

  it('does not render when storage already has a choice', () => {
    window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, 'accepted')

    render(<CookieConsentBanner />)

    expect(screen.queryByTestId('cookie-consent-banner')).toBeNull()
  })
})

describe('Pathfinder role routing helpers', () => {
  it('keeps parent and learner navigation scoped away from class/admin views', () => {
    const parentLabels = navItemsForRole('parent').map(item => item.label)
    const learnerLabels = navItemsForRole('learner').map(item => item.label)

    expect(parentLabels).toContain('Profile')
    expect(parentLabels).not.toContain('Teacher')
    expect(parentLabels).not.toContain('Trust & Safety')
    expect(learnerLabels).toContain('Learner')
    expect(learnerLabels).not.toContain('Library')
  })

  it('routes teachers to class dashboards and admins to governed oversight surfaces', () => {
    const teacherLabels = navItemsForRole('therapist').map(item => item.label)
    const adminLabels = navItemsForRole('admin').map(item => item.label)

    expect(defaultPathForRole('therapist')).toBe('/teacher')
    expect(defaultPathForRole('parent')).toBe('/profile')
    expect(teacherLabels).toEqual(['Teacher'])
    expect(adminLabels).toEqual(['Teacher', 'Library', 'Profile', 'Pathways', 'Trust & Safety'])
  })
})

describe('PathfinderLearnApp learner bootstrapping', () => {
  it('redirects unauthenticated visitors to login instead of showing the learner empty state', async () => {
    apiMocks.getAuthSession.mockRejectedValue(new Error('UNAUTHORIZED'))

    renderLearningApp()

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/login'))

    expect(screen.queryByText('No learners linked to this account yet')).toBeNull()
    expect(apiMocks.getChildren).not.toHaveBeenCalled()
    expect(apiMocks.createSelfLearner).not.toHaveBeenCalled()
  })

  it('creates and selects a self-learner for a legacy learner with no children', async () => {
    renderLearningApp()

    await waitFor(() => expect(apiMocks.createSelfLearner).toHaveBeenCalledTimes(1))
    const dashboard = await screen.findByTestId('student-learning-home')

    expect(apiMocks.getAuthSession).toHaveBeenCalledTimes(1)
    expect(apiMocks.getChildren).toHaveBeenCalledWith(null)
    expect(dashboard.textContent).toContain('child-self')
  })
})
