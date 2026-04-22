/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { InsightsOrb } from './InsightsOrb'
import type { InsightsVoiceState } from '../types'

function getScaleFactor(element: HTMLElement): number {
  const transform = element.style.transform
  const match = transform.match(/scale\(([-\d.]+)\)/)
  if (!match) return 1
  return Number.parseFloat(match[1])
}

describe('InsightsOrb', () => {
  it('renders the idle state with default transcript placeholder', () => {
    render(<InsightsOrb state="idle" />)

    const orb = screen.getByTestId('insights-orb')
    expect(orb.getAttribute('data-state')).toBe('idle')
    expect(screen.getByTestId('insights-orb-transcript').textContent).toContain(
      'Transcript will appear here.',
    )
    const sphere = screen.getByTestId('insights-orb-sphere') as HTMLElement
    expect(getScaleFactor(sphere)).toBeCloseTo(1, 3)
  })

  it('scales the orb with input level while listening', () => {
    const { rerender } = render(<InsightsOrb state="listening" inputLevel={0} />)
    const sphere = screen.getByTestId('insights-orb-sphere') as HTMLElement
    const quietScale = getScaleFactor(sphere)

    rerender(<InsightsOrb state="listening" inputLevel={1} />)
    const loudScale = getScaleFactor(sphere)
    expect(loudScale).toBeGreaterThan(quietScale)
    expect(loudScale).toBeGreaterThan(1)
    expect(loudScale).toBeLessThanOrEqual(1.5)
  })

  it('scales the orb with output level while speaking', () => {
    const { rerender } = render(<InsightsOrb state="speaking" outputLevel={0} />)
    const sphere = screen.getByTestId('insights-orb-sphere') as HTMLElement
    const quiet = getScaleFactor(sphere)
    rerender(<InsightsOrb state="speaking" outputLevel={0.8} />)
    expect(getScaleFactor(sphere)).toBeGreaterThan(quiet)
  })

  it('ignores levels while thinking, idle, or interrupted', () => {
    const { rerender } = render(<InsightsOrb state="thinking" inputLevel={1} outputLevel={1} />)
    const sphere = screen.getByTestId('insights-orb-sphere') as HTMLElement
    const thinkingScale = getScaleFactor(sphere)
    expect(thinkingScale).toBeGreaterThan(1) // small breathing swing
    expect(thinkingScale).toBeLessThan(1.2)

    rerender(<InsightsOrb state="interrupted" inputLevel={1} outputLevel={1} />)
    expect(getScaleFactor(sphere)).toBeLessThan(1)

    rerender(<InsightsOrb state="idle" inputLevel={1} outputLevel={1} />)
    expect(getScaleFactor(sphere)).toBeCloseTo(1, 3)
  })

  it('renders the provided transcript verbatim', () => {
    render(<InsightsOrb state="listening" transcript="Hello, show me last week's scores." />)
    expect(
      screen.getByTestId('insights-orb-transcript').textContent,
    ).toBe("Hello, show me last week's scores.")
  })

  it('falls back to the static scale when reducedMotion is true', () => {
    render(<InsightsOrb state="listening" inputLevel={1} reducedMotion />)
    const sphere = screen.getByTestId('insights-orb-sphere') as HTMLElement
    expect(getScaleFactor(sphere)).toBeCloseTo(1, 3)
    const orb = screen.getByTestId('insights-orb')
    expect(orb.getAttribute('data-reduced-motion')).toBe('true')
  })

  it('clamps and sanitises out-of-range / NaN levels', () => {
    const cases: Array<{ state: InsightsVoiceState; input?: number; output?: number }> = [
      { state: 'listening', input: Number.NaN },
      { state: 'listening', input: -5 },
      { state: 'listening', input: 42 },
      { state: 'speaking', output: Number.POSITIVE_INFINITY },
    ]
    for (const { state, input, output } of cases) {
      const { unmount } = render(
        <InsightsOrb state={state} inputLevel={input} outputLevel={output} />,
      )
      const scale = getScaleFactor(screen.getByTestId('insights-orb-sphere') as HTMLElement)
      expect(Number.isFinite(scale)).toBe(true)
      expect(scale).toBeGreaterThanOrEqual(1)
      expect(scale).toBeLessThanOrEqual(1.5)
      unmount()
    }
  })

  it('exposes a human-readable aria-label per state', () => {
    const { rerender } = render(<InsightsOrb state="idle" />)
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('Idle')

    rerender(<InsightsOrb state="error" />)
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('error')

    rerender(<InsightsOrb state="listening" ariaLabel="Noah's caseload" />)
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain("Noah's caseload")
  })
})
