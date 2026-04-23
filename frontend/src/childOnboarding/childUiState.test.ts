/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, it, expect } from 'vitest'

import {
  MASCOT_FLAG_KEY,
  WRAP_UP_FLAG_KEY,
  flagsFromServer,
  mergeFlags,
  serverKeyForFlag,
  MAX_EXERCISE_ENTRIES,
} from './childUiState'

describe('childUiState.flagsFromServer', () => {
  it('returns an empty view for null / wrong-shape input', () => {
    expect(flagsFromServer(null)).toEqual({})
    expect(flagsFromServer(undefined)).toEqual({})
    expect(flagsFromServer({} as never)).toEqual({})
    expect(flagsFromServer({ exercises: 'nope' } as never)).toEqual({})
  })

  it('projects mascot + wrap_up reserved keys to top-level booleans', () => {
    const flags = flagsFromServer({
      exercises: [
        { exercise_type: MASCOT_FLAG_KEY, first_run_at: '2026-04-23T10:00Z' },
        { exercise_type: WRAP_UP_FLAG_KEY, first_run_at: null },
      ],
    } as never)
    expect(flags.mascot_seen).toBe(true)
    expect(flags.wrap_up_seen).toBe(false)
    expect(flags.exercise_tutorials_seen).toBeUndefined()
  })

  it('projects per-exercise rows into exercise_tutorials_seen', () => {
    const flags = flagsFromServer({
      exercises: [
        { exercise_type: 'silent_sorting', first_run_at: '2026-04-23T10:00Z' },
        { exercise_type: 'auditory_bombardment', first_run_at: null },
      ],
    } as never)
    expect(flags.exercise_tutorials_seen).toEqual({
      silent_sorting: true,
      auditory_bombardment: false,
    })
  })

  it('drops unknown / malformed rows without throwing', () => {
    const flags = flagsFromServer({
      exercises: [
        { exercise_type: '', first_run_at: null },
        { exercise_type: 'ok', first_run_at: 'x', junk: true },
        'totally bogus',
        { exercise_type: 'x'.repeat(200), first_run_at: 'x' },
      ],
    } as never)
    expect(flags.exercise_tutorials_seen).toEqual({ ok: true })
  })

  it('caps projected entries to MAX_EXERCISE_ENTRIES', () => {
    const exercises = Array.from({ length: MAX_EXERCISE_ENTRIES + 10 }, (_, i) => ({
      exercise_type: `ex_${i}`,
      first_run_at: 'x',
    }))
    const flags = flagsFromServer({ exercises } as never)
    expect(Object.keys(flags.exercise_tutorials_seen ?? {}).length).toBe(
      MAX_EXERCISE_ENTRIES,
    )
  })
})

describe('childUiState.mergeFlags', () => {
  it('merges mascot and wrap-up booleans', () => {
    expect(
      mergeFlags({}, { mascot_seen: true, wrap_up_seen: false }),
    ).toEqual({ mascot_seen: true, wrap_up_seen: false })
  })

  it('merges per-exercise flags additively', () => {
    const merged = mergeFlags(
      { exercise_tutorials_seen: { silent_sorting: true } },
      { exercise_tutorials_seen: { auditory_bombardment: true } },
    )
    expect(merged.exercise_tutorials_seen).toEqual({
      silent_sorting: true,
      auditory_bombardment: true,
    })
  })

  it('drops non-boolean / bad-key tutorial entries', () => {
    const merged = mergeFlags(
      {},
      {
        exercise_tutorials_seen: {
          good: true,
          numeric: 1,
          '   ': true,
          ['x'.repeat(200)]: true,
        } as unknown as Record<string, boolean>,
      },
    )
    expect(merged.exercise_tutorials_seen).toEqual({ good: true })
  })
})

describe('childUiState.serverKeyForFlag', () => {
  it('maps high-level flags to reserved server keys', () => {
    expect(serverKeyForFlag('mascot_seen')).toBe(MASCOT_FLAG_KEY)
    expect(serverKeyForFlag('wrap_up_seen')).toBe(WRAP_UP_FLAG_KEY)
    expect(serverKeyForFlag({ exercise_type: 'silent_sorting' })).toBe(
      'silent_sorting',
    )
  })
})
