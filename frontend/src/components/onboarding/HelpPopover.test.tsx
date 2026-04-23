/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { render, screen, fireEvent, act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FluentProvider, webLightTheme } from '@fluentui/react-components'

import { HelpPopover } from './HelpPopover'
import { OnboardingContext } from '../../onboarding/context'
import { ONBOARDING_EVENTS } from '../../onboarding/events'
import { telemetry } from '../../services/telemetry'

function renderPopover(opts: {
  disabled?: boolean
  topicId?: string
  label?: string
} = {}): ReturnType<typeof render> {
  return render(
    <FluentProvider theme={webLightTheme}>
      <OnboardingContext.Provider
        value={{
          state: {},
          patch: () => undefined,
          disabled: opts.disabled ?? false,
        }}
      >
        <HelpPopover
          topicId={opts.topicId ?? 'popover-voice-mode'}
          label={opts.label ?? 'voice mode'}
        />
      </OnboardingContext.Provider>
    </FluentProvider>
  )
}

describe('HelpPopover', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders a trigger with an aria-label referencing the explained label', () => {
    renderPopover()
    const trigger = screen.getByRole('button', { name: 'More about voice mode' })
    expect(trigger).toBeTruthy()
    expect(trigger.getAttribute('data-testid')).toBe(
      'help-popover-trigger-popover-voice-mode'
    )
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('opens on click and emits HELP_OPENED telemetry with source=popover', () => {
    const trackSpy = vi.spyOn(telemetry, 'trackEvent').mockImplementation(() => undefined)
    renderPopover()
    const trigger = screen.getByRole('button', { name: 'More about voice mode' })
    act(() => {
      fireEvent.click(trigger)
    })
    expect(trackSpy).toHaveBeenCalledWith(ONBOARDING_EVENTS.HELP_OPENED, {
      source: 'popover',
      key: 'popover-voice-mode',
    })
  })

  it('renders nothing when the onboarding context is disabled (child persona)', () => {
    const trackSpy = vi.spyOn(telemetry, 'trackEvent').mockImplementation(() => undefined)
    const { container } = renderPopover({ disabled: true })
    expect(container.querySelector('[data-testid^="help-popover-trigger-"]')).toBeNull()
    expect(trackSpy).not.toHaveBeenCalled()
  })

  it('renders nothing when the topic id is unknown (fail-closed)', () => {
    const { container } = renderPopover({ topicId: 'does-not-exist' })
    expect(container.querySelector('[data-testid^="help-popover-trigger-"]')).toBeNull()
  })
})
