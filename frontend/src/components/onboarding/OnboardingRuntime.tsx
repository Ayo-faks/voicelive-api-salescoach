/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * OnboardingRuntime
 *
 * Single mount-point that wires up the v2 onboarding system inside the app:
 *
 *  - Seeds `useUiState` for the current (authenticated, non-child) user.
 *  - Dual-reads the legacy `wulo.onboarding.complete` localStorage flag
 *    and backfills it into `ui_state.onboarding_complete` (see v2 Phase 1
 *    step 7). Kept for 2 weeks, then removable.
 *  - Picks an auto-trigger tour for the current route and renders the
 *    lazy-loaded Joyride driver.
 *  - Persists tour completions into `ui_state.tours_seen`.
 *  - Exposes a "replay tour" imperative via ref for the HelpMenu.
 *
 * Concentrating this logic here keeps App.tsx's diff small (one mount)
 * and the runtime itself trivially testable.
 */

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useLocation } from 'react-router-dom'

import {
  useUiState,
  hasSeenTour,
  type UseUiStateResult,
} from '../../hooks/useUiState'
import {
  getTourById,
  pickAutoTour,
  tourSupportsRole,
  type TourDefinition,
} from '../../onboarding/tours'
import { ONBOARDING_EVENTS } from '../../onboarding/events'
import { consumePendingReplayTour, onReplayTourRequested } from '../../onboarding/bus'
import { OnboardingContext } from '../../onboarding/context'
import { telemetry } from '../../services/telemetry'
import { AnnouncementBanner } from './AnnouncementBanner'
import { TourDriver } from './TourDriver'

export interface OnboardingRuntimeProps {
  /** Authenticated user's role. When `child`, the runtime self-disables. */
  role: string | null
  /** Current user mode (`workspace` vs `child`). */
  userMode: 'workspace' | 'child' | null
  /** `/api/config.onboarding.tours_enabled` — when false, kill switch wins. */
  toursEnabled: boolean
  /** Whether the user has completed auth (gate initial GET). */
  authenticated: boolean
  /** Optional shared ui_state store supplied by App.tsx to avoid duplicate GETs. */
  uiState?: UseUiStateResult
  /** Children rendered inside the context provider (Phase 2 announcement +
   * checklist consumers rely on `useOnboarding()`). */
  children?: ReactNode
}

export interface OnboardingRuntimeHandle {
  /** Replay a tour regardless of `tours_seen`. */
  replayTour: (tourId: string) => void
  /** Current ui_state snapshot (for consumers that need `tours_seen` etc.). */
  state: ReturnType<typeof useUiState>['state']
}

interface OnboardingRuntimeBaseProps extends OnboardingRuntimeProps {
  uiState: UseUiStateResult
}

const OnboardingRuntimeBase = forwardRef<
  OnboardingRuntimeHandle,
  OnboardingRuntimeBaseProps
>(function OnboardingRuntimeBase(props, ref) {
  const { role, userMode, toursEnabled, authenticated, uiState } = props
  const location = useLocation()

  const isChildContext = role === 'child' || userMode === 'child'

  // The `disableForChild` call is idempotent; calling it once at mount on a
  // child context keeps the telemetry shim sealed for the remainder of the
  // session even if state changes.
  useEffect(() => {
    if (isChildContext) telemetry.disableForChild()
  }, [isChildContext])

  // One-shot dual-read migration of `wulo.onboarding.complete`. The legacy
  // flag lives in localStorage; once we've seen it and the server blob does
  // not already reflect it, PATCH and trust the server thereafter.
  const [legacyMigrated, setLegacyMigrated] = useState(false)
  useEffect(() => {
    if (legacyMigrated) return
    if (uiState.loading || isChildContext || !authenticated) return
    if (typeof window === 'undefined') return
    const legacy = window.localStorage.getItem('wulo.onboarding.complete') === 'true'
    if (!legacy) {
      setLegacyMigrated(true)
      return
    }
    if (uiState.state.onboarding_complete) {
      setLegacyMigrated(true)
      return
    }
    uiState.patch({ onboarding_complete: true })
    setLegacyMigrated(true)
  }, [
    legacyMigrated,
    uiState,
    uiState.loading,
    uiState.state.onboarding_complete,
    isChildContext,
    authenticated,
  ])

  const [replayingTour, setReplayingTour] = useState<TourDefinition | null>(null)

  const activeTour: TourDefinition | null = useMemo(() => {
    if (replayingTour) return replayingTour
    if (isChildContext || !toursEnabled || !authenticated) return null
    if (uiState.loading) return null
    return (
      pickAutoTour({
        pathname: location.pathname,
        role: role ?? '',
        seenTourIds: uiState.state.tours_seen ?? [],
        toursEnabled,
      }) ?? null
    )
  }, [
    replayingTour,
    isChildContext,
    toursEnabled,
    authenticated,
    uiState.loading,
    uiState.state.tours_seen,
    location.pathname,
    role,
  ])

  // Emit a single `tour_started` event per activation.
  useEffect(() => {
    if (!activeTour) return
    telemetry.trackEvent(ONBOARDING_EVENTS.TOUR_STARTED, { tour_id: activeTour.id })
  }, [activeTour])

  const handleComplete = (tourId: string): void => {
    const already = hasSeenTour(uiState.state, tourId)
    if (!already) {
      const nextSeen = [...(uiState.state.tours_seen ?? []), tourId]
      uiState.patch({ tours_seen: nextSeen })
    }
    setReplayingTour(null)
  }

  useImperativeHandle(
    ref,
    () => ({
      replayTour: (tourId: string) => {
        const tour = getTourById(tourId)
        if (!tour) return
        setReplayingTour(tour)
      },
      state: uiState.state,
    }),
    [uiState.state]
  )

  // Subscribe to the lightweight browser-event bus so `HelpMenu` can
  // trigger a replay without a prop-drilled ref.
  useEffect(() => {
    if (isChildContext) return undefined
    return onReplayTourRequested(tourId => {
      const tour = getTourById(tourId)
      if (tour) setReplayingTour(tour)
    })
  }, [isChildContext])

  useEffect(() => {
    if (isChildContext || !authenticated) return
    // Defer until the user's role is resolved. `consumePendingReplayTour`
    // clears the sessionStorage entry on first call, so consuming with a
    // null role would silently drop the replay when role arrives a tick
    // later (Playwright catches this as a tooltip-never-appears flake).
    if (!role) return
    const pendingTourId = consumePendingReplayTour()
    if (!pendingTourId) return
    const pendingTour = getTourById(pendingTourId)
    if (!pendingTour || !tourSupportsRole(pendingTour, role)) return
    setReplayingTour(pendingTour)
  }, [authenticated, isChildContext, location.pathname, role])

  const handleDismissAnnouncement = (id: string): void => {
    const current = uiState.state.announcements_dismissed ?? []
    if (current.includes(id)) return
    uiState.patch({ announcements_dismissed: [...current, id] })
  }

  const contextValue = useMemo(
    () => ({
      state: uiState.state,
      patch: uiState.patch,
      disabled: isChildContext || !authenticated,
    }),
    [uiState.state, uiState.patch, isChildContext, authenticated]
  )

  return (
    <OnboardingContext.Provider value={contextValue}>
      {!isChildContext && authenticated ? (
        <AnnouncementBanner
          role={role ?? ''}
          dismissed={uiState.state.announcements_dismissed}
          onDismiss={handleDismissAnnouncement}
        />
      ) : null}
      <TourDriver tour={activeTour} onComplete={handleComplete} />
      {props.children}
    </OnboardingContext.Provider>
  )
})

const OnboardingRuntimeWithLocalState = forwardRef<
  OnboardingRuntimeHandle,
  Omit<OnboardingRuntimeProps, 'uiState'>
>(function OnboardingRuntimeWithLocalState(props, ref) {
  const isChildContext = props.role === 'child' || props.userMode === 'child'
  const uiState = useUiState({
    disabled: isChildContext || !props.authenticated,
    authenticated: props.authenticated,
  })

  return <OnboardingRuntimeBase {...props} uiState={uiState} ref={ref} />
})

export const OnboardingRuntime = forwardRef<
  OnboardingRuntimeHandle,
  OnboardingRuntimeProps
>(function OnboardingRuntime(props, ref) {
  if (props.uiState) {
    return <OnboardingRuntimeBase {...props} uiState={props.uiState} ref={ref} />
  }

  return <OnboardingRuntimeWithLocalState {...props} ref={ref} />
})
