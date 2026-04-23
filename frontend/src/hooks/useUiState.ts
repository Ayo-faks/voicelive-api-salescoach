/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Server-persisted UI state for the onboarding / guidance system.
 *
 * See docs/onboarding/onboarding-plan-v2.md (Tier A / Phase 1).
 *
 * Contract:
 * - Seeds from `GET /api/me/ui-state` on first call.
 * - Write path is optimistic: local update → debounced PATCH (400 ms).
 * - On transient failure, queues to `localStorage['wulo.uiStateOutbox']`
 *   and retries on next focus.
 * - For the child persona (`role === 'child'` or `userMode === 'child'`)
 *   the hook short-circuits to a read-only, no-op writer to honour the
 *   Children's Code: minors emit no telemetry and no mutation traffic.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../services/api'
import type { UiState } from '../types'

const OUTBOX_KEY = 'wulo.uiStateOutbox'
const DEBOUNCE_MS = 400

export interface UseUiStateOptions {
  /** When true, disables all reads/writes and returns a noop writer. */
  disabled?: boolean
  /** True once the user's auth session has resolved. Blocks the first GET
   * until we know the hook is running on behalf of a real account. */
  authenticated?: boolean
}

export interface UseUiStateResult {
  state: UiState
  loading: boolean
  /** True when a PATCH is in-flight or pending in the debounce window. */
  saving: boolean
  /** Error from the most recent failed PATCH, if any. */
  error: Error | null
  /** Shallow-merge a patch; persists to the server. */
  patch: (patch: UiState) => void
  /** Reset server state to `{}` (audited). */
  reset: () => Promise<void>
  /** Refetch from the server, discarding any unsaved local edits. */
  refresh: () => Promise<void>
}

function readOutbox(): UiState {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(OUTBOX_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as UiState) : {}
  } catch {
    return {}
  }
}

function writeOutbox(patch: UiState): void {
  if (typeof window === 'undefined') return
  try {
    const existing = readOutbox()
    const merged = { ...existing, ...patch }
    window.localStorage.setItem(OUTBOX_KEY, JSON.stringify(merged))
  } catch {
    /* quota or private-mode: best-effort only */
  }
}

function clearOutbox(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(OUTBOX_KEY)
  } catch {
    /* best-effort */
  }
}

export function useUiState(options: UseUiStateOptions = {}): UseUiStateResult {
  const { disabled = false, authenticated = true } = options
  const [state, setState] = useState<UiState>({})
  // `loading` is derived rather than stored so it is correct on the
  // same render that `disabled` / `authenticated` flip from a transient
  // unauthenticated state to authenticated. Storing it in `useState`
  // left a one-render window where a caller (e.g. the route guard in
  // App.tsx that reads `onboardingUiState.loading`) would see `false`
  // before the init `useEffect` had a chance to commit `setLoading(true)`,
  // and would then race the `GET /api/me/ui-state` response by navigating
  // to `/onboarding`. See memories/repo/voicelive-api-salescoach.md.
  const [initialised, setInitialised] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const loading = (!disabled && !!authenticated && !initialised) || refreshing
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  // Latest pending patch that has not yet been POSTed, shallow-merged.
  const pendingRef = useRef<UiState>({})
  const debounceRef = useRef<number | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
    }
  }, [])

  const flush = useCallback(async () => {
    if (disabled) return
    const toSend = pendingRef.current
    if (Object.keys(toSend).length === 0) return
    pendingRef.current = {}
    setSaving(true)
    try {
      const merged = await api.patchUiState(toSend)
      if (!mountedRef.current) return
      setState(merged)
      setError(null)
      clearOutbox()
    } catch (err) {
      writeOutbox(toSend)
      if (!mountedRef.current) return
      setError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      if (mountedRef.current) setSaving(false)
    }
  }, [disabled])

  const scheduleFlush = useCallback(() => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current)
    }
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null
      void flush()
    }, DEBOUNCE_MS)
  }, [flush])

  const refresh = useCallback(async () => {
    if (disabled || !authenticated) return
    setRefreshing(true)
    try {
      const current = await api.getUiState()
      if (!mountedRef.current) return
      setState(current)
      setError(null)
    } catch (err) {
      if (!mountedRef.current) return
      setError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      if (mountedRef.current) setRefreshing(false)
    }
  }, [authenticated, disabled])

  // Initial load + outbox replay.
  useEffect(() => {
    if (disabled || !authenticated) {
      // Nothing to fetch; mark initialised so `loading` stays false.
      setInitialised(true)
      return
    }
    // A prior mount phase may have already marked this instance as
    // initialised (e.g. when `disabled` briefly flipped true then back to
    // false). Reset so `loading` stays true through this fetch.
    setInitialised(false)
    let cancelled = false
    void (async () => {
      try {
        const current = await api.getUiState()
        if (cancelled) return
        setState(current)
        setError(null)

        // Replay any queued writes from a previous session.
        const queued = readOutbox()
        if (Object.keys(queued).length > 0) {
          try {
            const merged = await api.patchUiState(queued)
            if (cancelled) return
            setState(merged)
            clearOutbox()
          } catch {
            // keep outbox; will retry on next focus
          }
        }
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err : new Error(String(err)))
      } finally {
        if (!cancelled) setInitialised(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [authenticated, disabled])

  // On window focus, retry any outbox.
  useEffect(() => {
    if (disabled || !authenticated) return
    const onFocus = (): void => {
      const queued = readOutbox()
      if (Object.keys(queued).length === 0) return
      void (async () => {
        try {
          const merged = await api.patchUiState(queued)
          if (!mountedRef.current) return
          setState(merged)
          clearOutbox()
        } catch {
          /* leave outbox for next attempt */
        }
      })()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [authenticated, disabled])

  const patch = useCallback(
    (delta: UiState) => {
      if (disabled) return
      if (!delta || Object.keys(delta).length === 0) return
      // Optimistic local update.
      setState(prev => ({ ...prev, ...delta }))
      pendingRef.current = { ...pendingRef.current, ...delta }
      scheduleFlush()
    },
    [disabled, scheduleFlush]
  )

  const reset = useCallback(async () => {
    if (disabled) return
    setSaving(true)
    try {
      const cleared = await api.resetUiState()
      if (!mountedRef.current) return
      setState(cleared)
      pendingRef.current = {}
      clearOutbox()
      setError(null)
    } catch (err) {
      if (!mountedRef.current) return
      setError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      if (mountedRef.current) setSaving(false)
    }
  }, [disabled])

  if (disabled) {
    return {
      state: {},
      loading: false,
      saving: false,
      error: null,
      patch: () => {
        /* no-op in disabled mode (e.g. child persona) */
      },
      reset: async () => {
        /* no-op */
      },
      refresh: async () => {
        /* no-op */
      },
    }
  }

  return { state, loading, saving, error, patch, reset, refresh }
}

/** Utility: check whether a tour id is already in `tours_seen`. */
export function hasSeenTour(state: UiState, tourId: string): boolean {
  return (state.tours_seen ?? []).includes(tourId)
}

/** Utility: check whether an announcement is dismissed. */
export function isAnnouncementDismissed(
  state: UiState,
  announcementId: string
): boolean {
  return (state.announcements_dismissed ?? []).includes(announcementId)
}
