/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FluentProvider, webLightTheme } from '@fluentui/react-components'

import { ChildWrapUpCard } from './ChildWrapUpCard'

describe('ChildWrapUpCard', () => {
  it('renders title, caption and Done when active', () => {
    render(
      <FluentProvider theme={webLightTheme}>
        <ChildWrapUpCard active onComplete={vi.fn()} />
      </FluentProvider>,
    )
    expect(screen.getByTestId('child-wrap-up-card')).toBeTruthy()
    expect(screen.getByTestId('child-wrap-up-caption')).toBeTruthy()
    expect(screen.getByTestId('child-wrap-up-done')).toBeTruthy()
  })

  it('does not render when active=false', () => {
    const { container } = render(
      <FluentProvider theme={webLightTheme}>
        <ChildWrapUpCard active={false} onComplete={vi.fn()} />
      </FluentProvider>,
    )
    expect(container.querySelector('[data-testid="child-wrap-up-card"]')).toBeNull()
  })

  it('fires onComplete once when Done is clicked', () => {
    const onComplete = vi.fn()
    render(
      <FluentProvider theme={webLightTheme}>
        <ChildWrapUpCard active onComplete={onComplete} />
      </FluentProvider>,
    )
    act(() => {
      fireEvent.click(screen.getByTestId('child-wrap-up-done'))
    })
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('respects reducedMotion prop without throwing', () => {
    render(
      <FluentProvider theme={webLightTheme}>
        <ChildWrapUpCard active reducedMotion onComplete={vi.fn()} />
      </FluentProvider>,
    )
    expect(screen.getByTestId('child-wrap-up-card')).toBeTruthy()
  })
})
