/**
 * Regression: clicking "Take a tour" started the tour but the tooltip
 * landed off-screen because Joyride only auto-scrolls when the anchor is
 * fully out of view, leaving partially-visible anchors stranded. The
 * driver now scrolls the anchor into view on every `tooltip` lifecycle
 * event (step 0 uses `window.scrollTo({top:0})`, later steps use
 * `scrollIntoView({block:'center'})`).
 */

import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TourDefinition } from '../../onboarding/tours'

// Per-file mock that exposes the most recent `onEvent` callback so the
// test can synthesize Joyride lifecycle events.
let lastOnEvent: ((data: unknown) => void) | null = null
vi.mock('react-joyride', () => ({
  __esModule: true,
  Joyride: (props: { onEvent?: (data: unknown) => void }) => {
    lastOnEvent = props.onEvent ?? null
    return null
  },
  default: (props: { onEvent?: (data: unknown) => void }) => {
    lastOnEvent = props.onEvent ?? null
    return null
  },
  STATUS: { FINISHED: 'finished', SKIPPED: 'skipped' },
  EVENTS: { STEP_AFTER: 'step:after' },
}))

import { TourDriver } from './TourDriver'

const tour: TourDefinition = {
  id: 'welcome-learner',
  role: 'learner',
  steps: [
    {
      selector: '[data-testid="hero"]',
      testId: 'hero',
      title: 'Welcome',
      body: 'Step one body.',
      placement: 'auto',
    },
    {
      selector: '[data-testid="card"]',
      testId: 'card',
      title: 'Next',
      body: 'Step two body.',
      placement: 'top',
    },
  ],
}

describe('TourDriver scroll-on-tooltip regression', () => {
  let scrollToSpy: ReturnType<typeof vi.fn>
  let scrollIntoViewSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    lastOnEvent = null
    scrollToSpy = vi.fn()
    scrollIntoViewSpy = vi.fn()
    window.scrollTo = scrollToSpy as unknown as typeof window.scrollTo
    HTMLElement.prototype.scrollIntoView =
      scrollIntoViewSpy as unknown as HTMLElement['scrollIntoView']

    const hero = document.createElement('div')
    hero.setAttribute('data-testid', 'hero')
    document.body.appendChild(hero)
    const card = document.createElement('div')
    card.setAttribute('data-testid', 'card')
    document.body.appendChild(card)
  })

  afterEach(() => {
    cleanup()
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('scrolls the page to top before the first step paints', async () => {
    render(<TourDriver tour={tour} onComplete={vi.fn()} />)
    await waitFor(() => expect(lastOnEvent).not.toBeNull())

    lastOnEvent?.({
      type: 'tooltip',
      lifecycle: 'tooltip',
      index: 0,
      status: 'running',
    })

    expect(scrollToSpy).toHaveBeenCalledWith(
      expect.objectContaining({ top: 0 })
    )
    expect(scrollIntoViewSpy).not.toHaveBeenCalled()
  })

  it('centers later steps via scrollIntoView so partially-visible anchors are not stranded', async () => {
    render(<TourDriver tour={tour} onComplete={vi.fn()} />)
    await waitFor(() => expect(lastOnEvent).not.toBeNull())

    lastOnEvent?.({
      type: 'tooltip',
      lifecycle: 'tooltip',
      index: 1,
      status: 'running',
    })

    expect(scrollIntoViewSpy).toHaveBeenCalledWith(
      expect.objectContaining({ block: 'center' })
    )
    expect(scrollToSpy).not.toHaveBeenCalled()
  })

  it('does not scroll for non-tooltip lifecycle events', async () => {
    render(<TourDriver tour={tour} onComplete={vi.fn()} />)
    await waitFor(() => expect(lastOnEvent).not.toBeNull())

    lastOnEvent?.({
      type: 'step:after',
      lifecycle: 'complete',
      index: 0,
      status: 'running',
    })

    expect(scrollToSpy).not.toHaveBeenCalled()
    expect(scrollIntoViewSpy).not.toHaveBeenCalled()
  })
})
