/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FluentProvider, webLightTheme } from '@fluentui/react-components'

import { HandOffInterstitial } from './HandOffInterstitial'

describe('HandOffInterstitial', () => {
  it('renders when active', () => {
    render(
      <FluentProvider theme={webLightTheme}>
        <HandOffInterstitial active onStart={vi.fn()} />
      </FluentProvider>,
    )
    expect(screen.getByTestId('handoff-interstitial')).toBeTruthy()
    expect(screen.getByTestId('handoff-start')).toBeTruthy()
  })

  it('does not render when active=false', () => {
    const { container } = render(
      <FluentProvider theme={webLightTheme}>
        <HandOffInterstitial active={false} onStart={vi.fn()} />
      </FluentProvider>,
    )
    expect(container.querySelector('[data-testid="handoff-interstitial"]')).toBeNull()
  })

  it('fires onStart exactly once per click', () => {
    const onStart = vi.fn()
    render(
      <FluentProvider theme={webLightTheme}>
        <HandOffInterstitial active onStart={onStart} />
      </FluentProvider>,
    )
    act(() => {
      fireEvent.click(screen.getByTestId('handoff-start'))
    })
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it('start button is keyboard-activatable via Enter', () => {
    const onStart = vi.fn()
    render(
      <FluentProvider theme={webLightTheme}>
        <HandOffInterstitial active onStart={onStart} />
      </FluentProvider>,
    )
    const btn = screen.getByTestId('handoff-start') as HTMLButtonElement
    btn.focus()
    act(() => {
      fireEvent.click(btn)
    })
    expect(onStart).toHaveBeenCalledTimes(1)
  })
})
