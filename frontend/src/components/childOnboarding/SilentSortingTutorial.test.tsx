/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FluentProvider, webLightTheme } from '@fluentui/react-components'

import { SilentSortingTutorial } from './SilentSortingTutorial'
import { silentSortingAnchors } from '../../childOnboarding/spotlightAnchors'

function ensureAnchor(testId: string): HTMLElement {
  let host = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
  if (!host) {
    host = document.createElement('div')
    host.setAttribute('data-testid', testId)
    host.getBoundingClientRect = () =>
      ({ top: 50, left: 50, width: 200, height: 80, right: 250, bottom: 130, x: 50, y: 50, toJSON: () => ({}) } as DOMRect)
    document.body.appendChild(host)
  }
  return host
}

describe('SilentSortingTutorial', () => {
  beforeEach(() => {
    ensureAnchor(silentSortingAnchors.bins.testId)
    ensureAnchor(silentSortingAnchors.sample.testId)
    ensureAnchor(silentSortingAnchors.finish.testId)
  })

  afterEach(() => {
    for (const a of [silentSortingAnchors.bins, silentSortingAnchors.sample, silentSortingAnchors.finish]) {
      const el = document.querySelector(`[data-testid="${a.testId}"]`)
      if (el) el.parentNode?.removeChild(el)
    }
    vi.restoreAllMocks()
  })

  it('advances through all 3 steps and then fires onComplete', () => {
    const onComplete = vi.fn()
    render(
      <FluentProvider theme={webLightTheme}>
        <SilentSortingTutorial active onComplete={onComplete} />
      </FluentProvider>,
    )

    // step 1 — bins
    expect(screen.getByTestId('child-spotlight-caption').textContent).toMatch(/home/i)
    act(() => {
      fireEvent.click(screen.getByTestId('child-spotlight-next'))
    })
    // step 2 — sample
    expect(screen.getByTestId('child-spotlight-caption').textContent).toMatch(/hear/i)
    act(() => {
      fireEvent.click(screen.getByTestId('child-spotlight-next'))
    })
    // step 3 — finish (last)
    expect(screen.getByTestId('child-spotlight-caption').textContent).toMatch(/cheer/i)
    expect(onComplete).not.toHaveBeenCalled()
    act(() => {
      fireEvent.click(screen.getByTestId('child-spotlight-next'))
    })
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('dismissing early completes immediately', () => {
    const onComplete = vi.fn()
    render(
      <FluentProvider theme={webLightTheme}>
        <SilentSortingTutorial active onComplete={onComplete} />
      </FluentProvider>,
    )
    act(() => {
      fireEvent.click(screen.getByTestId('child-spotlight-dismiss'))
    })
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('does not render when active=false', () => {
    const { container } = render(
      <FluentProvider theme={webLightTheme}>
        <SilentSortingTutorial active={false} onComplete={vi.fn()} />
      </FluentProvider>,
    )
    expect(container.querySelector('[data-testid="child-spotlight"]')).toBeNull()
  })
})
