/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * useSessionProgression — stage-to-stage gating for the child practice flow.
 *
 * Stages (PR4 scope):
 *   - `auditory_bombardment`     → Stage 1
 *   - `silent_sorting`           → Stage 2
 *   - `vowel_blending`           → Stage 3 (not yet exposed; reserved)
 *   - `word_position_practice_initial_medial` → Stage 4-5a
 *   - `word_position_practice_final`          → Stage 5b
 *   - `two_word_phrase`          → Stage 6
 *
 * A stage is **unlocked** when its immediate predecessors all report a
 * completed/mastery summary via `completedStages`. The gate is advisory —
 * therapists have a `devOverride` escape hatch and `VITE_PROGRESSION_GATE`
 * can disable gating wholesale for lab/test environments. Any non-child
 * audience (therapist seat) bypasses gating by default.
 *
 * The hook is pure data; it does not read storage or perform side effects.
 * The owner (SessionScreen/App) is expected to pass `completedStages`
 * derived from session state or child memory.
 */

import { useMemo } from 'react'

export type StageKey =
  | 'auditory_bombardment'
  | 'silent_sorting'
  | 'vowel_blending'
  | 'word_position_practice_initial_medial'
  | 'word_position_practice_final'
  | 'two_word_phrase'

/** Predecessor graph. A stage unlocks when all entries in its set complete. */
export const EDGES: Record<StageKey, StageKey[]> = {
  auditory_bombardment: [],
  silent_sorting: ['auditory_bombardment'],
  vowel_blending: ['silent_sorting'],
  word_position_practice_initial_medial: ['silent_sorting'],
  word_position_practice_final: ['word_position_practice_initial_medial'],
  two_word_phrase: ['word_position_practice_final'],
}

const STAGE_ORDER: StageKey[] = [
  'auditory_bombardment',
  'silent_sorting',
  'vowel_blending',
  'word_position_practice_initial_medial',
  'word_position_practice_final',
  'two_word_phrase',
]

export interface UseSessionProgressionOptions {
  /** Stage keys the child has met mastery or completion thresholds for. */
  completedStages?: Iterable<StageKey>
  /**
   * Therapist override list — any key present here bypasses its gate.
   * Typically driven by a small dev menu / URL hash flag.
   */
  devOverride?: Iterable<StageKey>
  /**
   * Audience — therapist seat bypasses all gates by default. Child audience
   * observes the gate unless the env flag is disabled.
   */
  audience?: 'child' | 'therapist'
  /**
   * When `false`, the gate is disabled wholesale (all stages report as
   * unlocked). Defaults to the value of `import.meta.env.VITE_PROGRESSION_GATE`
   * if provided, otherwise `true` (gate on).
   */
  gateEnabled?: boolean
}

export interface UseSessionProgressionResult {
  completed: ReadonlySet<StageKey>
  overrides: ReadonlySet<StageKey>
  isUnlocked: (stage: StageKey) => boolean
  nextStage: (current: StageKey) => StageKey | null
  /** The highest stage that is currently unlocked. */
  highestUnlocked: StageKey
}

function resolveGateEnabled(explicit: boolean | undefined): boolean {
  if (typeof explicit === 'boolean') return explicit
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meta = (import.meta as any)?.env
    const raw = meta?.VITE_PROGRESSION_GATE
    if (raw === undefined || raw === null || raw === '') return true
    const normalised = String(raw).toLowerCase()
    if (normalised === '0' || normalised === 'false' || normalised === 'off') return false
    return true
  } catch {
    return true
  }
}

export function useSessionProgression(
  opts: UseSessionProgressionOptions = {},
): UseSessionProgressionResult {
  const completedIter = opts.completedStages
  const overrideIter = opts.devOverride
  const audience = opts.audience ?? 'child'
  const gateEnabled = resolveGateEnabled(opts.gateEnabled)

  return useMemo(() => {
    const completed = new Set<StageKey>(completedIter ?? [])
    const overrides = new Set<StageKey>(overrideIter ?? [])

    const bypassAll = !gateEnabled || audience === 'therapist'

    const isUnlocked = (stage: StageKey): boolean => {
      if (bypassAll) return true
      if (overrides.has(stage)) return true
      const prereqs = EDGES[stage] ?? []
      return prereqs.every(p => completed.has(p))
    }

    const nextStage = (current: StageKey): StageKey | null => {
      const idx = STAGE_ORDER.indexOf(current)
      if (idx < 0 || idx >= STAGE_ORDER.length - 1) return null
      for (let i = idx + 1; i < STAGE_ORDER.length; i++) {
        const candidate = STAGE_ORDER[i]
        if (isUnlocked(candidate)) return candidate
      }
      return null
    }

    let highest: StageKey = STAGE_ORDER[0]
    for (const s of STAGE_ORDER) {
      if (isUnlocked(s)) highest = s
    }

    return { completed, overrides, isUnlocked, nextStage, highestUnlocked: highest }
  }, [audience, completedIter, gateEnabled, overrideIter])
}

export default useSessionProgression
