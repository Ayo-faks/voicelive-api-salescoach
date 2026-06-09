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
    <div data-testid="student-learning-home">
      Learner dashboard {studentId ?? 'no-student'}
    </div>
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

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'wulo-academy.sidebar-collapsed.v1'

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
  return (
    <div data-testid="location">
      {location.pathname}
      {location.search}
    </div>
  )
}

function renderLearningApp() {
  return render(
    <MemoryRouter initialEntries={['/home']}>
      <PathfinderLearnApp />
      <LocationProbe />
    </MemoryRouter>
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

  it('notifies onResolved once the banner is dismissed (sequences the tour, #19)', () => {
    const onResolved = vi.fn()
    render(<CookieConsentBanner onResolved={onResolved} />)

    expect(onResolved).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('cookie-consent-accept'))

    expect(onResolved).toHaveBeenCalledTimes(1)
  })
})

describe('Pathfinder role routing helpers', () => {
  it('keeps parent and learner navigation scoped away from class/admin views', () => {
    const parentLabels = navItemsForRole('parent').map(item => item.label)
    const learnerLabels = navItemsForRole('learner').map(item => item.label)

    expect(parentLabels).toContain('Profile')
    expect(parentLabels).not.toContain('Teacher')
    expect(parentLabels).not.toContain('Trust & Safety')
    expect(learnerLabels).toContain('Home')
    expect(learnerLabels).not.toContain('Library')
  })

  it('routes teachers to class dashboards and admins to governed oversight surfaces', () => {
    const teacherLabels = navItemsForRole('therapist').map(item => item.label)
    const adminLabels = navItemsForRole('admin').map(item => item.label)

    expect(defaultPathForRole('therapist')).toBe('/teacher')
    expect(defaultPathForRole('parent')).toBe('/family')
    expect(teacherLabels).toEqual(['Teacher'])
    expect(adminLabels).toEqual([
      'Teacher',
      'Library',
      'Profile',
      'Pathways',
      'Trust & Safety',
      'Observability',
    ])
  })
})

describe('PathfinderLearnApp learner bootstrapping', () => {
  it('redirects unauthenticated visitors to login instead of showing the learner empty state', async () => {
    apiMocks.getAuthSession.mockRejectedValue(new Error('UNAUTHORIZED'))

    renderLearningApp()

    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/login')
    )

    expect(
      screen.queryByText('No learners linked to this account yet')
    ).toBeNull()
    expect(apiMocks.getChildren).not.toHaveBeenCalled()
    expect(apiMocks.createSelfLearner).not.toHaveBeenCalled()
  })

  it('shows standard account actions for authenticated learners', async () => {
    renderLearningApp()

    await screen.findByTestId('sidebar-user-card')

    expect(screen.getByText('Legacy Learner')).toBeTruthy()
    expect(screen.getByText('legacy@example.com')).toBeTruthy()

    expect(
      screen.getByTestId('account-actions-trigger').getAttribute('href')
    ).toBe('/account')
    expect(
      screen.getByTestId('account-action-sign-out').getAttribute('href')
    ).toBe('/logout')
    expect(
      screen.getByTestId('mobile-account-settings').getAttribute('href')
    ).toBe('/account')
    expect(
      screen.getByTestId('mobile-account-sign-out').getAttribute('href')
    ).toBe('/logout')
  })

  it('collapses the desktop sidebar into an icon rail and persists the choice', async () => {
    renderLearningApp()

    const app = await screen.findByTestId('pathfinder-learn-app')
    const toggle = await screen.findByTestId('sidebar-collapse-toggle')

    expect(app.getAttribute('data-sidebar')).toBe('expanded')
    expect(toggle.getAttribute('aria-label')).toBe('Collapse sidebar')

    fireEvent.click(toggle)

    expect(app.getAttribute('data-sidebar')).toBe('collapsed')
    expect(toggle.getAttribute('aria-label')).toBe('Expand sidebar')
    expect(window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe(
      'true'
    )
  })

  it('creates and selects a self-learner for a legacy learner with no children', async () => {
    renderLearningApp()

    await waitFor(() =>
      expect(apiMocks.createSelfLearner).toHaveBeenCalledTimes(1)
    )
    await waitFor(() =>
      expect(
        screen.getByTestId('student-learning-home').textContent
      ).toContain('child-self')
    )

    expect(apiMocks.getAuthSession).toHaveBeenCalledTimes(1)
    expect(apiMocks.getChildren).toHaveBeenCalledWith(null)
  })

  it('keeps /home painted when the homepage tour trigger is clicked', async () => {
    apiMocks.getChildren.mockReturnValue(new Promise(() => {}))

    renderLearningApp()

    const dashboard = await screen.findByTestId('student-learning-home')
    expect(dashboard.textContent).toContain('no-student')

    fireEvent.click(await screen.findByTestId('help-menu-trigger'))

    expect(screen.queryByTestId('help-menu-list')).toBeNull()
    expect(screen.getByTestId('student-learning-home')).toBeTruthy()
    expect(screen.getByTestId('location').textContent).toBe('/home')
  })
})
