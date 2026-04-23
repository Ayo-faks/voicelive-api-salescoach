/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { FluentProvider, webLightTheme } from '@fluentui/react-components'

import { AnnouncementBanner } from './AnnouncementBanner'

vi.mock('../../onboarding/announcements', async () => {
  const actual = await vi.importActual<typeof import('../../onboarding/announcements')>(
    '../../onboarding/announcements'
  )
  return {
    ...actual,
    ANNOUNCEMENTS: [
      {
        id: 'test-ann-1',
        severity: 'info',
        title: 'Heads up',
        body: 'Something new shipped',
        cta: { label: 'Learn more', href: '/whats-new' },
      },
    ],
    listVisibleAnnouncements: (args: { role: string; dismissed: string[] }) => {
      if (args.dismissed.includes('test-ann-1')) return []
      return [
        {
          id: 'test-ann-1',
          severity: 'info' as const,
          title: 'Heads up',
          body: 'Something new shipped',
          cta: { label: 'Learn more', href: '/whats-new' },
        },
      ]
    },
  }
})

function renderWithTheme(ui: React.ReactElement) {
  return render(<FluentProvider theme={webLightTheme}>{ui}</FluentProvider>)
}

describe('AnnouncementBanner', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders the first visible announcement', () => {
    renderWithTheme(
      <AnnouncementBanner role="therapist" dismissed={[]} onDismiss={() => undefined} />
    )
    expect(screen.getByTestId('announcement-test-ann-1')).toBeTruthy()
    expect(screen.getByText('Heads up')).toBeTruthy()
  })

  it('returns null for child persona', () => {
    const { container } = renderWithTheme(
      <AnnouncementBanner role="child" dismissed={[]} onDismiss={() => undefined} />
    )
    expect(container.querySelector('[data-testid^="announcement-"]')).toBeNull()
  })

  it('returns null when the announcement is already dismissed', () => {
    const { container } = renderWithTheme(
      <AnnouncementBanner
        role="therapist"
        dismissed={['test-ann-1']}
        onDismiss={() => undefined}
      />
    )
    expect(container.querySelector('[data-testid^="announcement-"]')).toBeNull()
  })

  it('fires onDismiss with the id when the close button is clicked', () => {
    const onDismiss = vi.fn()
    renderWithTheme(
      <AnnouncementBanner role="therapist" dismissed={[]} onDismiss={onDismiss} />
    )
    fireEvent.click(screen.getByTestId('announcement-test-ann-1-dismiss'))
    expect(onDismiss).toHaveBeenCalledWith('test-ann-1')
  })

  it('fires onNavigate + onDismiss when the CTA is clicked', () => {
    const onDismiss = vi.fn()
    const onNavigate = vi.fn()
    renderWithTheme(
      <AnnouncementBanner
        role="therapist"
        dismissed={[]}
        onDismiss={onDismiss}
        onNavigate={onNavigate}
      />
    )
    fireEvent.click(screen.getByTestId('announcement-test-ann-1-cta'))
    expect(onNavigate).toHaveBeenCalledWith('/whats-new')
    expect(onDismiss).toHaveBeenCalledWith('test-ann-1')
  })
})
