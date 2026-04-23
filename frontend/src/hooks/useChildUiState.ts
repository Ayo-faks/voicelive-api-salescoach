/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Per-child onboarding-flag hook.
 *
 * This hook is adult-only. It must never run inside a child-rendered
 * subtree because the child tablet should not make authenticated
 * mutations against ``/api/children/<id>/ui-state``. Callers pass
 * ``disabled: true`` from any context where ``userMode === 'child'``
 * or ``role === 'child'`` (docs/onboarding/onboarding-plan-v2.md
 * §Tier C, §GDPR/Children's Code).
 *
 * Why the adult writes the flags (not the child):
 * The backend endpoint enforces ``_require_child_access`` with
 * ``allowed_roles={THERAPIST, ADMIN}`` + a therapist-of relationship.
 * The child persona has neither. The therapist/parent instantiates
 * this hook, holds the per-child flag view in memory across a
 * session, and PUTs ``first_run=true`` immediately after the mascot
 * or tutorial dismisses — i.e. while the adult's auth session is
 * still alive in the same browser tab.
 *
 * Failure modes:
 *  - Optimistic local update, rollback on 4xx.
 *  - 5xx → queue to ``localStorage['wulo.childUiStateOutbox:{childId}']``,
 *    replay on next focus.
 *  - 401 → stop writing. The consent flow re-prompts for auth; we do
 *    not retry silently.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../services/api'
import {
  flagsFromServer,
  mergeFlags,
  serverKeyForFlag,
  type ChildOnboardingFlags,
  type ChildUiStateServerBlob,
} from '../childOnboarding/childUiState'

const OUTBOX_PREFIX = 'wulo.childUiStateOutbox:'

interface OutboxEntry {
  exercise_type: string
  first_run: boolean
}

export interface UseChildUiStateOptions {
  /** When true, the hook is a no-op. Pass ``true`` from child-rendered
   *  subtrees or when the caller is not authenticated. */
  disabled?: boolean
}

export interface UseChildUiStateResult {
  state: ChildOnboardingFlags
  loading: boolean
  error: Error | null
  markMascotSeen: () => Promise<void>
  markTutorialSeen: (exerciseType: string) => Promise<void>
  markWrapUpSeen: () => Promise<void>
}

function outboxKey(childId: string): string {
  return `${OUTBOX_PREFIX}${childId}`
}

function readOutbox(childId: string): OutboxEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(outboxKey(childId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (entry): entry is OutboxEntry =>
        !!entry &&
        typeof entry === 'object' &&
        typeof entry.exercise_type === 'string' &&
        typeof entry.first_run === 'boolean',
    )
  } catch {
    return []
  }
}

function writeOutbox(childId: string, entries: OutboxEntry[]): void {
  if (typeof window === 'undefined') return
  try {
    if (entries.length === 0) {
      window.localStorage.removeItem(outboxKey(childId))
      return
    }
    window.localStorage.setItem(outboxKey(childId), JSON.stringify(entries))
  } catch {
    /* best-effort */
  }
}

function appendOutbox(childId: string, entry: OutboxEntry): void {
  const existing = readOutbox(childId)
  const deduped = existing.filter(
    e => e.exercise_type !== entry.exercise_type,
  )
  deduped.push(entry)
  writeOutbox(childId, deduped)
}

function isAuthError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /401|unauthori[sz]ed/i.test(msg)
}

function isServerError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /5\d\d/.test(msg)
}

export function useChildUiState(
  childId: string | null,
  options: UseChildUiStateOptions = {},
): UseChildUiStateResult {
  const { disabled = false } = options
  const effectiveDisabled = disabled || !childId

  const [state, setState] = useState<ChildOnboardingFlags>({})
  const [loading, setLoading] = useState<boolean>(!effectiveDisabled)
  const [error, setError] = useState<Error | null>(null)
  const mountedRef = useRef(true)
  const authedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Initial load + outbox replay.
  useEffect(() => {
    if (effectiveDisabled || !childId) {
      setLoading(false)
      return
    }
    let cancelled = false
    authedRef.current = true
    setLoading(true)
    void (async () => {
      try {
        const blob = (await api.getChildUiState(childId)) as ChildUiStateServerBlob
        if (cancelled) return
        setState(flagsFromServer(blob))
        setError(null)

        const queued = readOutbox(childId)
        if (queued.length > 0) {
          const survivors: OutboxEntry[] = []
          for (const entry of queued) {
            try {
              await api.putChildUiState(childId, entry)
            } catch (err) {
              if (isAuthError(err)) {
                authedRef.current = false
                survivors.push(entry)
                break
              }
              survivors.push(entry)
            }
          }
          writeOutbox(childId, survivors)
          if (!cancelled && survivors.length === 0) {
            // Refresh so our projected view picks up the replayed writes.
            try {
              const refreshed = (await api.getChildUiState(
                childId,
              )) as ChildUiStateServerBlob
              if (!cancelled) setState(flagsFromServer(refreshed))
            } catch {
              /* best-effort */
            }
          }
        }
      } catch (err) {
        if (cancelled) return
        if (isAuthError(err)) authedRef.current = false
        setError(err instanceof Error ? err : new Error(String(err)))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [childId, effectiveDisabled])

  // Outbox replay on window focus.
  useEffect(() => {
    if (effectiveDisabled || !childId) return
    const onFocus = (): void => {
      if (!authedRef.current) return
      const queued = readOutbox(childId)
      if (queued.length === 0) return
      void (async () => {
        const survivors: OutboxEntry[] = []
        for (const entry of queued) {
          try {
            await api.putChildUiState(childId, entry)
          } catch (err) {
            if (isAuthError(err)) {
              authedRef.current = false
              survivors.push(entry)
              break
            }
            survivors.push(entry)
          }
        }
        writeOutbox(childId, survivors)
      })()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [childId, effectiveDisabled])

  const writeFlag = useCallback(
    async (
      flag:
        | 'mascot_seen'
        | 'wrap_up_seen'
        | { exercise_type: string },
      patch: ChildOnboardingFlags,
    ): Promise<void> => {
      if (effectiveDisabled || !childId) return
      if (!authedRef.current) return

      const exercise_type = serverKeyForFlag(flag)
      const previous = state
      const optimistic = mergeFlags(previous, patch)
      setState(optimistic)

      try {
        await api.putChildUiState(childId, {
          exercise_type,
          first_run: true,
        })
        if (!mountedRef.current) return
        setError(null)
      } catch (err) {
        if (!mountedRef.current) return
        if (isAuthError(err)) {
          authedRef.current = false
          setState(previous)
          appendOutbox(childId, { exercise_type, first_run: true })
          return
        }
        if (isServerError(err)) {
          appendOutbox(childId, { exercise_type, first_run: true })
          // Keep the optimistic view; the write is queued.
          setError(err instanceof Error ? err : new Error(String(err)))
          return
        }
        // 4xx other than 401 → rollback.
        setState(previous)
        setError(err instanceof Error ? err : new Error(String(err)))
      }
    },
    [childId, effectiveDisabled, state],
  )

  const markMascotSeen = useCallback(
    () => writeFlag('mascot_seen', { mascot_seen: true }),
    [writeFlag],
  )
  const markWrapUpSeen = useCallback(
    () => writeFlag('wrap_up_seen', { wrap_up_seen: true }),
    [writeFlag],
  )
  const markTutorialSeen = useCallback(
    (exerciseType: string) =>
      writeFlag(
        { exercise_type: exerciseType },
        { exercise_tutorials_seen: { [exerciseType]: true } },
      ),
    [writeFlag],
  )

  const disabledNoop = useMemo(
    (): UseChildUiStateResult => ({
      state: {},
      loading: false,
      error: null,
      markMascotSeen: async () => undefined,
      markTutorialSeen: async () => undefined,
      markWrapUpSeen: async () => undefined,
    }),
    [],
  )

  if (effectiveDisabled) return disabledNoop

  return {
    state,
    loading,
    error,
    markMascotSeen,
    markTutorialSeen,
    markWrapUpSeen,
  }
}
