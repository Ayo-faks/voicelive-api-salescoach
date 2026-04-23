/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Typed view over the server's per-child UI-state blob.
 *
 * Phase 4, docs/onboarding/onboarding-plan-v2.md §Tier C (items 13–17).
 *
 * Server contract recap (see backend/src/schemas/ui_state.py +
 * backend/src/app.py ``/api/children/<id>/ui-state``):
 *   GET returns
 *     { child_id, user_id, exercises: [{ exercise_type, first_run_at, updated_at }] }
 *   PUT accepts
 *     { exercise_type: string, first_run: boolean }
 * ``first_run_at`` is set to the current timestamp when the PUT's
 * ``first_run`` flag is true, otherwise null. We treat any non-null
 * ``first_run_at`` as "flag seen".
 *
 * Phase 4 widens the flag vocabulary to cover the mascot hand-off and
 * wrap-up card without changing the backend schema. Two reserved
 * ``exercise_type`` keys carry those flags alongside the per-exercise
 * tutorial markers:
 *   - ``__mascot__``      → {@link ChildOnboardingFlags.mascot_seen}
 *   - ``__wrap_up__``     → {@link ChildOnboardingFlags.wrap_up_seen}
 * Everything else is mapped into
 *   {@link ChildOnboardingFlags.exercise_tutorials_seen}.
 *
 * Unknown shapes are dropped defensively to mirror the server-side
 * schema caps and so a malformed response never crashes the child view.
 */

export const MASCOT_FLAG_KEY = '__mascot__'
export const WRAP_UP_FLAG_KEY = '__wrap_up__'

/** Mirror of backend ``MAX_EXERCISE_TYPE_LENGTH``. */
export const MAX_EXERCISE_TYPE_LENGTH = 64

/** Defensive cap: refuse to project more than this many per-exercise
 *  markers into the client view even if the server happens to return
 *  more. Matches the server's ``tours_seen`` bound (64) in spirit. */
export const MAX_EXERCISE_ENTRIES = 64

export interface ChildOnboardingFlags {
  /** True once the handoff mascot has been dismissed for this child. */
  mascot_seen?: boolean
  /** Per-``exercise_type`` first-run flags. A value of ``true`` means the
   *  tutorial has been shown at least once. */
  exercise_tutorials_seen?: Record<string, boolean>
  /** True once the wrap-up card has been shown at least once. */
  wrap_up_seen?: boolean
}

/** The raw shape returned by ``GET /api/children/:id/ui-state``. */
export interface ChildUiStateServerBlob {
  child_id?: unknown
  user_id?: unknown
  exercises?: unknown
}

interface ExerciseRow {
  exercise_type: string
  first_run_at: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function narrowExerciseRow(value: unknown): ExerciseRow | null {
  if (!isRecord(value)) return null
  const exercise_type = value.exercise_type
  if (typeof exercise_type !== 'string') return null
  const trimmed = exercise_type.trim()
  if (!trimmed || trimmed.length > MAX_EXERCISE_TYPE_LENGTH) return null
  const rawFirstRun = value.first_run_at
  const first_run_at =
    typeof rawFirstRun === 'string' && rawFirstRun.length > 0 ? rawFirstRun : null
  return { exercise_type: trimmed, first_run_at }
}

/**
 * Project the raw server blob into a typed {@link ChildOnboardingFlags}
 * view. Unknown shapes, oversize arrays, and bad rows are dropped.
 */
export function flagsFromServer(
  blob: ChildUiStateServerBlob | null | undefined,
): ChildOnboardingFlags {
  const flags: ChildOnboardingFlags = {}
  if (!blob || !isRecord(blob)) return flags
  const rawExercises = blob.exercises
  if (!Array.isArray(rawExercises)) return flags

  const tutorials: Record<string, boolean> = {}
  let seen = 0
  for (const row of rawExercises) {
    if (seen >= MAX_EXERCISE_ENTRIES) break
    const narrowed = narrowExerciseRow(row)
    if (!narrowed) continue
    seen += 1
    const isTrue = narrowed.first_run_at !== null
    if (narrowed.exercise_type === MASCOT_FLAG_KEY) {
      flags.mascot_seen = isTrue
    } else if (narrowed.exercise_type === WRAP_UP_FLAG_KEY) {
      flags.wrap_up_seen = isTrue
    } else {
      tutorials[narrowed.exercise_type] = isTrue
    }
  }
  if (Object.keys(tutorials).length > 0) {
    flags.exercise_tutorials_seen = tutorials
  }
  return flags
}

/**
 * Shallow-merge an incoming patch into an existing flags view. Only
 * known fields are copied; unknown keys are dropped (mirrors the
 * server-side schema which rejects unknown keys).
 */
export function mergeFlags(
  current: ChildOnboardingFlags,
  patch: ChildOnboardingFlags,
): ChildOnboardingFlags {
  const next: ChildOnboardingFlags = { ...current }
  if (typeof patch.mascot_seen === 'boolean') {
    next.mascot_seen = patch.mascot_seen
  }
  if (typeof patch.wrap_up_seen === 'boolean') {
    next.wrap_up_seen = patch.wrap_up_seen
  }
  if (patch.exercise_tutorials_seen && isRecord(patch.exercise_tutorials_seen)) {
    const merged = { ...(current.exercise_tutorials_seen ?? {}) }
    let count = Object.keys(merged).length
    for (const [key, value] of Object.entries(patch.exercise_tutorials_seen)) {
      if (count >= MAX_EXERCISE_ENTRIES) break
      if (typeof value !== 'boolean') continue
      if (typeof key !== 'string') continue
      const trimmed = key.trim()
      if (!trimmed || trimmed.length > MAX_EXERCISE_TYPE_LENGTH) continue
      if (!(trimmed in merged)) count += 1
      merged[trimmed] = value
    }
    next.exercise_tutorials_seen = merged
  }
  return next
}

/**
 * Return the ``exercise_type`` the backend expects for a given
 * high-level flag. The mascot and wrap-up cards sit under reserved
 * keys so they coexist with real exercise entries.
 */
export function serverKeyForFlag(
  flag: 'mascot_seen' | 'wrap_up_seen' | { exercise_type: string },
): string {
  if (flag === 'mascot_seen') return MASCOT_FLAG_KEY
  if (flag === 'wrap_up_seen') return WRAP_UP_FLAG_KEY
  return flag.exercise_type
}
