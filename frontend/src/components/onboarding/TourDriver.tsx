/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tour driver: a lazy-loaded wrapper around `react-joyride@^3`.
 *
 * Responsibilities:
 *  - Keep `react-joyride` out of the initial bundle (child-tablet perf
 *    budget per v2 Tier B #6 and Verification #9).
 *  - Translate our `TourDefinition` into the shape Joyride expects.
 *  - On completion or dismissal, record the tour id into
 *    `ui_state.tours_seen` via the injected `onComplete` callback.
 *  - Emit the taxonomy events defined in `onboarding/events.ts`.
 *
 * Consumers (App.tsx) pass the currently-active tour definition; when it's
 * `null`, the driver renders nothing.
 */

import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import type { EventData, Step as JoyrideStep } from 'react-joyride'

import type { TourDefinition, TourStep } from '../../onboarding/tours'
import { ONBOARDING_EVENTS } from '../../onboarding/events'
import { telemetry } from '../../services/telemetry'
import { WuloTourTooltip } from './WuloTourTooltip'
import { pathfinderTokens as pathfinder } from '../../learning/theme/pathfinder-tokens'

/**
 * Keep the Joyride import dynamic so it does not leak into the initial
 * chunk. `react-joyride@3` ships only named exports, so map `Joyride` to
 * `default` for `React.lazy`.
 */
const Joyride = lazy(async () => {
  const mod = await import('react-joyride')
  return { default: mod.Joyride }
})

export interface TourDriverProps {
  /** Active tour; when `null` the driver renders nothing. */
  tour: TourDefinition | null
  /** Called when the user completes or skips the tour. Receives the tour id
   * so the caller can persist it into `ui_state.tours_seen`. */
  onComplete: (tourId: string, outcome: 'completed' | 'dismissed') => void
}

// Joyride exports lifecycle constants as string enums; re-declared here to
// avoid pulling the lib into this file's sync bundle.
const JOYRIDE_STATUS_FINISHED = 'finished'
const JOYRIDE_STATUS_SKIPPED = 'skipped'
const JOYRIDE_TYPE_STEP_AFTER = 'step:after'

export function TourDriver(props: TourDriverProps): JSX.Element | null {
  const { tour, onComplete } = props
  const [run, setRun] = useState(false)
  const [reduceBackdropMotion, setReduceBackdropMotion] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = (): void => setReduceBackdropMotion(query.matches)
    update()
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', update)
      return () => query.removeEventListener('change', update)
    }
    query.addListener(update)
    return () => query.removeListener(update)
  }, [])

  const joyrideSteps = useMemo<JoyrideStep[]>(() => {
    if (!tour) return []
    return tour.steps.map((step: TourStep) => ({
      target: step.selector,
      title: step.title,
      content: step.body,
      placement: step.placement ?? 'auto',
      skipBeacon: true,
    }))
  }, [tour])

  useEffect(() => {
    if (!tour || joyrideSteps.length === 0) {
      setRun(false)
      return
    }

    const firstSelector = tour.steps[0]?.selector
    if (!firstSelector || typeof document === 'undefined') {
      setRun(true)
      return
    }

    let cancelled = false
    let frameId: number | null = null
    const hasAnchor = (): boolean =>
      document.querySelector(firstSelector) !== null

    const markReady = (): boolean => {
      if (cancelled) return false
      if (!hasAnchor()) return false
      setRun(true)
      return true
    }

    setRun(false)
    if (markReady()) {
      return
    }

    const observer = new MutationObserver(() => {
      if (markReady()) {
        observer.disconnect()
      }
    })
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
    })

    const checkOnFrame = (): void => {
      if (cancelled) return
      if (markReady()) {
        observer.disconnect()
        return
      }
      frameId = window.requestAnimationFrame(checkOnFrame)
    }

    frameId = window.requestAnimationFrame(checkOnFrame)

    return () => {
      cancelled = true
      observer.disconnect()
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
      }
    }
  }, [tour, joyrideSteps])

  const handleEvent = useCallback(
    (data: EventData) => {
      if (!tour) return

      if (data.type === JOYRIDE_TYPE_STEP_AFTER) {
        telemetry.trackEvent(ONBOARDING_EVENTS.TOUR_STEP, {
          tour_id: tour.id,
          step_index: data.index,
        })
      }

      if (data.status === JOYRIDE_STATUS_FINISHED) {
        telemetry.trackEvent(ONBOARDING_EVENTS.TOUR_COMPLETED, {
          tour_id: tour.id,
        })
        onComplete(tour.id, 'completed')
      } else if (data.status === JOYRIDE_STATUS_SKIPPED) {
        telemetry.trackEvent(ONBOARDING_EVENTS.TOUR_DISMISSED, {
          tour_id: tour.id,
        })
        onComplete(tour.id, 'dismissed')
      }
    },
    [tour, onComplete]
  )

  if (!tour || joyrideSteps.length === 0) return null

  const driver = (
    <div
      data-testid="tour-driver"
      data-tour-id={tour.id}
      style={{ display: 'contents' }}
    >
      <Suspense fallback={null}>
      <Joyride
        steps={joyrideSteps}
        run={run}
        continuous
        tooltipComponent={WuloTourTooltip}
        onEvent={handleEvent}
        options={{
          buttons: ['skip', 'back', 'primary'],
          overlayClickAction: false,
          primaryColor: pathfinder.brand.ink,
          arrowColor: pathfinder.surface.card,
          overlayColor: 'rgba(15, 23, 42, 0.45)',
          zIndex: 10000,
          spotlightPadding: 6,
          spotlightRadius: 14,
        }}
        styles={{
          overlay: {
            backdropFilter: reduceBackdropMotion ? 'none' : 'blur(2px)',
            WebkitBackdropFilter: reduceBackdropMotion ? 'none' : 'blur(2px)',
          },
          beacon: {
            outline: 'none',
          },
          beaconInner: {
            backgroundColor: pathfinder.brand.ink,
          },
          beaconOuter: {
            borderColor: 'rgba(15,23,42,0.55)',
            backgroundColor: 'rgba(15,23,42,0.2)',
          },
        }}
      />
      </Suspense>
    </div>
  )

  if (typeof document === 'undefined' || !document.body) return driver

  return createPortal(driver, document.body)
}
