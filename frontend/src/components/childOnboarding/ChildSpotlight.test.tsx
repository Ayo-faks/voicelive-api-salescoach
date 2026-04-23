/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FluentProvider, webLightTheme } from '@fluentui/react-components'

import { ChildSpotlight } from './ChildSpotlight'
import { silentSortingAnchors } from '../../childOnboarding/spotlightAnchors'

function mountAnchor(): HTMLElement {
  const host = document.createElement('div')
  host.setAttribute('data-testid', silentSortingAnchors.bins.testId)
  host.getBoundingClientRect = () =>
    ({ top: 100, left: 100, width: 200, height: 80, right: 300, bottom: 180, x: 100, y: 100, toJSON: () => ({}) } as DOMRect)
  document.body.appendChild(host)
  return host
}

function renderSpotlight(props: Partial<React.ComponentProps<typeof ChildSpotlight>> = {}) {
  const onNext = vi.fn()
  const onDismiss = vi.fn()
  const ui = render(
    <FluentProvider theme={webLightTheme}>
      <ChildSpotlight
        anchorId={silentSortingAnchors.bins.id}
        caption="These are the sorting bins."
        onNext={onNext}
        onDismiss={onDismiss}
        {...props}
      />
    </FluentProvider>,
  )
  return { ...ui, onNext, onDismiss }
}

describe('ChildSpotlight', () => {
  let anchor: HTMLElement | null = null

  beforeEach(() => {
    anchor = mountAnchor()
  })

  afterEach(() => {
    if (anchor) anchor.parentNode?.removeChild(anchor)
    anchor = null
    vi.restoreAllMocks()
  })

  it('renders caption and CTAs when anchor is mounted', () => {
    renderSpotlight()
    expect(screen.getByTestId('child-spotlight')).toBeTruthy()
    expect(screen.getByTestId('child-spotlight-caption').textContent).toMatch(/sorting bins/)
    expect(screen.getByTestId('child-spotlight-next')).toBeTruthy()
    expect(screen.getByTestId('child-spotlight-dismiss')).toBeTruthy()
  })

  it('silently hides when the anchor is not in the DOM', () => {
    if (anchor) anchor.parentNode?.removeChild(anchor)
    anchor = null
    const { container } = renderSpotlight()
    expect(container.querySelector('[data-testid="child-spotlight"]')).toBeNull()
  })

  it('returns null for an unregistered anchor id', () => {
    const { container } = renderSpotlight({ anchorId: 'does.not.exist' })
    expect(container.querySelector('[data-testid="child-spotlight"]')).toBeNull()
  })

  it('Next button fires onNext, Skip fires onDismiss', () => {
    const { onNext, onDismiss } = renderSpotlight()
    act(() => {
      fireEvent.click(screen.getByTestId('child-spotlight-next'))
    })
    expect(onNext).toHaveBeenCalledTimes(1)
    act(() => {
      fireEvent.click(screen.getByTestId('child-spotlight-dismiss'))
    })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('Escape key triggers onDismiss', () => {
    const { onDismiss } = renderSpotlight()
    const dialog = screen.getByRole('dialog')
    act(() => {
      fireEvent.keyDown(dialog, { key: 'Escape' })
    })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('returns focus to the previously focused element on unmount', () => {
    const prev = document.createElement('button')
    prev.textContent = 'before'
    document.body.appendChild(prev)
    prev.focus()
    expect(document.activeElement).toBe(prev)

    const { unmount } = renderSpotlight()
    unmount()
    expect(document.activeElement).toBe(prev)
    document.body.removeChild(prev)
  })
})
