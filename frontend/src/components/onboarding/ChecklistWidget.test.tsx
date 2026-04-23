/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FluentProvider, webLightTheme } from '@fluentui/react-components'

import { ChecklistWidget } from './ChecklistWidget'
import type { AppSnapshot } from '../../onboarding/checklist'

const empty: AppSnapshot = {
  hasChildren: false,
  hasSessions: false,
  hasReports: false,
  hasConsentOnAtLeastOneChild: false,
  onboardingTourSeen: false,
}

const allDone: AppSnapshot = {
  hasChildren: true,
  hasSessions: true,
  hasReports: true,
  hasConsentOnAtLeastOneChild: true,
  onboardingTourSeen: true,
}

function renderWithTheme(ui: React.ReactElement) {
  return render(<FluentProvider theme={webLightTheme}>{ui}</FluentProvider>)
}

describe('ChecklistWidget', () => {
  it('renders items for a therapist with an empty snapshot', () => {
    renderWithTheme(
      <ChecklistWidget
        snapshot={empty}
        role="therapist"
        userState={undefined}
        onToggleItem={() => undefined}
      />
    )
    expect(screen.getByTestId('checklist-widget')).toBeTruthy()
    expect(screen.getByTestId('checklist-item-add-first-child')).toBeTruthy()
  })

  it('self-hides when every item is completed', () => {
    const { container } = renderWithTheme(
      <ChecklistWidget
        snapshot={allDone}
        role="therapist"
        userState={undefined}
        onToggleItem={() => undefined}
      />
    )
    expect(container.querySelector('[data-testid="checklist-widget"]')).toBeNull()
  })

  it('self-hides when role has no gated items', () => {
    const { container } = renderWithTheme(
      <ChecklistWidget
        snapshot={empty}
        role="parent"
        userState={undefined}
        onToggleItem={() => undefined}
      />
    )
    expect(container.querySelector('[data-testid="checklist-widget"]')).toBeNull()
  })

  it('calls onToggleItem when "Mark done" is clicked', () => {
    const onToggleItem = vi.fn()
    renderWithTheme(
      <ChecklistWidget
        snapshot={empty}
        role="therapist"
        userState={undefined}
        onToggleItem={onToggleItem}
      />
    )
    fireEvent.click(
      screen.getByTestId('checklist-item-add-first-child-mark-done')
    )
    expect(onToggleItem).toHaveBeenCalledWith('add-first-child', true)
  })

  it('calls onNavigate with the CTA href', () => {
    const onNavigate = vi.fn()
    renderWithTheme(
      <ChecklistWidget
        snapshot={empty}
        role="therapist"
        userState={undefined}
        onToggleItem={() => undefined}
        onNavigate={onNavigate}
      />
    )
    fireEvent.click(screen.getByTestId('checklist-item-add-first-child-cta'))
    expect(onNavigate).toHaveBeenCalledWith('/settings')
  })
})
