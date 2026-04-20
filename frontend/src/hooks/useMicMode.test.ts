/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest'
import {
  initialMicModeState,
  micModeReducer,
  type ScoredTurn,
} from './useMicMode'

const turn: ScoredTurn = {
  turnId: 't-1',
  targetWord: 'fish',
  referenceText: 'fish',
  windowMs: 3500,
  startedAt: 1000,
}

describe('micModeReducer', () => {
  it('SET_MODE switches mode and clears any in-flight scored turn', () => {
    const withTurn = { mode: 'conversational' as const, scoredTurn: turn }
    const next = micModeReducer(withTurn, { type: 'SET_MODE', mode: 'tap' })
    expect(next.mode).toBe('tap')
    expect(next.scoredTurn).toBeNull()
  })

  it('SET_MODE is a no-op when unchanged', () => {
    const state = { mode: 'tap' as const, scoredTurn: null }
    expect(micModeReducer(state, { type: 'SET_MODE', mode: 'tap' })).toBe(state)
  })

  it('SCORED_TURN_START is ignored in tap mode (guards accidental dispatches)', () => {
    const state = { mode: 'tap' as const, scoredTurn: null }
    const next = micModeReducer(state, { type: 'SCORED_TURN_START', turn })
    expect(next).toBe(state)
  })

  it('SCORED_TURN_START records the turn in conversational mode', () => {
    const state = initialMicModeState('conversational')
    const next = micModeReducer(state, { type: 'SCORED_TURN_START', turn })
    expect(next.scoredTurn).toEqual(turn)
  })

  it('SCORED_TURN_END clears a matching turn', () => {
    const state = { mode: 'conversational' as const, scoredTurn: turn }
    const next = micModeReducer(state, { type: 'SCORED_TURN_END', turnId: 't-1' })
    expect(next.scoredTurn).toBeNull()
  })

  it('SCORED_TURN_END ignores a mismatched turnId (late ack)', () => {
    const state = { mode: 'conversational' as const, scoredTurn: turn }
    const next = micModeReducer(state, { type: 'SCORED_TURN_END', turnId: 't-stale' })
    expect(next).toBe(state)
  })

  it('SCORED_TURN_TIMEOUT clears a matching turn', () => {
    const state = { mode: 'conversational' as const, scoredTurn: turn }
    const next = micModeReducer(state, { type: 'SCORED_TURN_TIMEOUT', turnId: 't-1' })
    expect(next.scoredTurn).toBeNull()
  })
})
