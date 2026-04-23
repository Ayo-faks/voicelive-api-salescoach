import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { HelpMenu } from './HelpMenu'

describe('HelpMenu', () => {
  it('filters replay topics to the current therapist role', async () => {
    render(<HelpMenu currentRole="therapist" onReplayTour={vi.fn()} />)

    fireEvent.click(screen.getByTestId('help-menu-trigger'))

    expect(await screen.findByTestId('help-menu-item-replay-welcome-therapist')).toBeTruthy()
    expect(screen.getByTestId('help-menu-item-replay-insights-rail')).toBeTruthy()
    expect(screen.getByTestId('help-menu-item-replay-dashboard')).toBeTruthy()
    expect(screen.queryByTestId('help-menu-item-replay-welcome-admin')).toBeNull()
    expect(screen.queryByTestId('help-menu-item-replay-welcome-parent')).toBeNull()
  })

  it('shows only parent-safe replay topics for parent users', async () => {
    render(<HelpMenu currentRole="parent" onReplayTour={vi.fn()} />)

    fireEvent.click(screen.getByTestId('help-menu-trigger'))

    expect(await screen.findByTestId('help-menu-item-replay-welcome-parent')).toBeTruthy()
    expect(screen.getByTestId('help-menu-item-privacy-and-data')).toBeTruthy()
    expect(screen.queryByTestId('help-menu-item-replay-insights-rail')).toBeNull()
    expect(screen.queryByTestId('help-menu-item-replay-dashboard')).toBeNull()
    expect(screen.queryByTestId('help-menu-item-replay-welcome-therapist')).toBeNull()
    expect(screen.queryByTestId('help-menu-item-replay-welcome-admin')).toBeNull()
  })
})