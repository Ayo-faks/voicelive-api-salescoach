/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tiny browser-event bus used to decouple `HelpMenu` (which lives in the
 * sidebar tree) from `OnboardingRuntime` (which lives at the top of App).
 *
 * This avoids drilling a ref through `SidebarNav` for a single imperative
 * call. The payload surface is intentionally small.
 */

import { getTourById } from './tours'

const REPLAY_EVENT = 'wulo.onboarding.replay-tour'
const PENDING_REPLAY_STORAGE_KEY = 'wulo.onboarding.pending-replay-tour'

interface PendingReplayPayload {
  replayPath?: string
  tourId: string
}

export type ReplayTourRequest = PendingReplayPayload

function readPendingReplay(): PendingReplayPayload | null {
  if (typeof window === 'undefined') return null
  const raw = window.sessionStorage.getItem(PENDING_REPLAY_STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as PendingReplayPayload
    return parsed?.tourId ? parsed : null
  } catch {
    window.sessionStorage.removeItem(PENDING_REPLAY_STORAGE_KEY)
    return null
  }
}

export function requestReplayTour(tourId: string): void {
  if (typeof window === 'undefined') return
  const replayPath = getTourById(tourId)?.replayPath
  window.dispatchEvent(
    new CustomEvent<ReplayTourRequest>(REPLAY_EVENT, {
      detail: { tourId, replayPath },
    })
  )
}

export function consumePendingReplayTour(): string | null {
  const pending = readPendingReplay()
  if (!pending) return null
  if (
    pending.replayPath &&
    !window.location.pathname.startsWith(pending.replayPath)
  ) {
    return null
  }
  window.sessionStorage.removeItem(PENDING_REPLAY_STORAGE_KEY)
  return pending.tourId
}

export function onReplayTourRequested(
  handler: (request: ReplayTourRequest) => void
): () => void {
  if (typeof window === 'undefined') return () => undefined
  const listener = (evt: Event): void => {
    const detail = (evt as CustomEvent<ReplayTourRequest>).detail
    if (detail?.tourId) handler(detail)
  }
  window.addEventListener(REPLAY_EVENT, listener)
  return () => window.removeEventListener(REPLAY_EVENT, listener)
}
