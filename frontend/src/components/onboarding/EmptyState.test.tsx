/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FluentProvider, webLightTheme } from '@fluentui/react-components'

import { EmptyState } from './EmptyState'

function renderWithTheme(ui: React.ReactElement) {
  return render(<FluentProvider theme={webLightTheme}>{ui}</FluentProvider>)
}

describe('EmptyState', () => {
  it('renders surface testid and body copy', () => {
    renderWithTheme(
      <EmptyState
        surface="settings-no-children"
        title="No children yet"
        body="Add your first child to get started."
      />
    )

    expect(screen.getByTestId('empty-state-settings-no-children')).toBeTruthy()
    expect(screen.getByText('No children yet')).toBeTruthy()
    expect(screen.getByText('Add your first child to get started.')).toBeTruthy()
  })

  it('fires onCtaClick with surface before the action callback', () => {
    const onCtaClick = vi.fn()
    const onClick = vi.fn()

    renderWithTheme(
      <EmptyState
        surface="dashboard-no-sessions"
        title="No sessions"
        body="Run your first session."
        testId="dashboard-no-sessions-empty"
        action={{ label: 'Start session', onClick }}
        onCtaClick={onCtaClick}
      />
    )

    const cta = screen.getByTestId('dashboard-no-sessions-empty-cta')
    ;(cta as HTMLButtonElement).click()

    expect(onCtaClick).toHaveBeenCalledWith('dashboard-no-sessions')
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('renders an anchor when action.href is provided without onClick', () => {
    renderWithTheme(
      <EmptyState
        surface="reports-empty"
        title="No reports"
        body="Reports land here after your first session."
        testId="reports-empty"
        action={{ label: 'Learn more', href: '/docs/reports' }}
      />
    )

    const cta = screen.getByTestId('reports-empty-cta') as HTMLAnchorElement
    expect(cta.tagName).toBe('A')
    expect(cta.getAttribute('href')).toBe('/docs/reports')
  })
})
