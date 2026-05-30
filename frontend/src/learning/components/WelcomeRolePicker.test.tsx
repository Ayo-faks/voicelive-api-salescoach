import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { FluentProvider, teamsLightTheme } from '@fluentui/react-components'
import WelcomeRolePicker from './WelcomeRolePicker'
import { api, type AuthSession } from '../../services/api'

vi.mock('../../services/api', async () => {
  const actual =
    await vi.importActual<typeof import('../../services/api')>(
      '../../services/api'
    )
  return {
    ...actual,
    api: {
      ...actual.api,
      chooseRole: vi.fn(),
    },
  }
})

const mockedChooseRole = vi.mocked(api.chooseRole)

const sessionStub: AuthSession = {
  authenticated: true,
  user_id: 'u1',
  email: 'me@example.com',
  name: 'Me',
  role: 'learner',
  needs_onboarding: false,
  is_self_learner: true,
  workspaces: [],
  current_workspace_id: null,
  onboarding_complete: true,
} as unknown as AuthSession

function renderPicker(onChosen = vi.fn()) {
  return {
    onChosen,
    ...render(
      <FluentProvider theme={teamsLightTheme}>
        <WelcomeRolePicker onChosen={onChosen} />
      </FluentProvider>
    ),
  }
}

describe('WelcomeRolePicker', () => {
  beforeEach(() => {
    mockedChooseRole.mockReset()
  })

  it('renders three role tiles, marks teacher coming soon, and exposes the hello@ mailto', () => {
    renderPicker()
    expect(screen.getByTestId('welcome-role-picker')).toBeTruthy()
    expect(screen.getByTestId('welcome-tile-learner')).toBeTruthy()
    expect(screen.getByTestId('welcome-tile-parent')).toBeTruthy()
    const teacherTile = screen.getByTestId('welcome-tile-teacher') as HTMLButtonElement
    expect(teacherTile.disabled).toBe(true)
    expect(teacherTile.getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByTestId('welcome-tile-teacher-coming-soon')).toBeTruthy()
    expect(screen.getByText(/Welcome to Wulo Academy/i)).toBeTruthy()
    const mailto = screen.getByRole('link', { name: /hello@wulo\.ai/i })
    expect(mailto.getAttribute('href')).toMatch(/^mailto:hello@wulo\.ai/)
  })

  it('does not call chooseRole when the disabled teacher tile is clicked', async () => {
    const { onChosen } = renderPicker()
    fireEvent.click(screen.getByTestId('welcome-tile-teacher'))
    expect(mockedChooseRole).not.toHaveBeenCalled()
    expect(onChosen).not.toHaveBeenCalled()
  })

  it('calls chooseRole and onChosen when a tile is clicked', async () => {
    mockedChooseRole.mockResolvedValueOnce(sessionStub)
    const { onChosen } = renderPicker()

    fireEvent.click(screen.getByTestId('welcome-tile-learner'))

    await waitFor(() =>
      expect(mockedChooseRole).toHaveBeenCalledWith('learner')
    )
    await waitFor(() =>
      expect(onChosen).toHaveBeenCalledWith(sessionStub, 'learner')
    )
  })

  it('shows an error and does not call onChosen when chooseRole rejects', async () => {
    mockedChooseRole.mockRejectedValueOnce(new Error('boom'))
    const { onChosen } = renderPicker()

    fireEvent.click(screen.getByTestId('welcome-tile-parent'))

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('boom')
    )
    expect(onChosen).not.toHaveBeenCalled()
  })
})
