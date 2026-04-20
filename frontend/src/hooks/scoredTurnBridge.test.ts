/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest'
import {
  buildBeginFrame,
  buildEndFrame,
  buildMicModeFrame,
  composeScoredTurnBegin,
  DEFAULT_SCORED_TURN_WINDOW_MS,
  handleScoredTurnServerEvent,
} from './scoredTurnBridge'

describe('buildBeginFrame / buildEndFrame / buildMicModeFrame', () => {
  it('builds the begin frame with the wire-protocol type', () => {
    expect(
      buildBeginFrame({ turnId: 't-1', targetWord: 'sun', windowMs: 3500 }),
    ).toEqual({
      type: 'wulo.scored_turn.begin',
      payload: { turnId: 't-1', targetWord: 'sun', windowMs: 3500 },
    })
  })

  it('builds the end frame', () => {
    expect(buildEndFrame('t-1')).toEqual({
      type: 'wulo.scored_turn.end',
      payload: { turnId: 't-1' },
    })
  })

  it('builds the mic_mode broadcast frame', () => {
    expect(buildMicModeFrame('conversational')).toEqual({
      type: 'wulo.mic_mode',
      payload: { mode: 'conversational' },
    })
  })
})

describe('handleScoredTurnServerEvent', () => {
  const makeApi = () => ({
    endScoredTurn: vi.fn(),
    timeoutScoredTurn: vi.fn(),
  })

  it('returns null for unrelated messages', () => {
    const api = makeApi()
    expect(handleScoredTurnServerEvent({ type: 'wulo.target_tally' }, api)).toBeNull()
    expect(handleScoredTurnServerEvent(null, api)).toBeNull()
    expect(api.endScoredTurn).not.toHaveBeenCalled()
    expect(api.timeoutScoredTurn).not.toHaveBeenCalled()
  })

  it('parses ack frames without dispatching', () => {
    const api = makeApi()
    const result = handleScoredTurnServerEvent(
      { type: 'wulo.scored_turn.ack', payload: { turnId: 't-1', targetWord: 'sun' } },
      api,
    )
    expect(result).toEqual({
      kind: 'ack',
      payload: { turnId: 't-1', targetWord: 'sun' },
    })
    expect(api.endScoredTurn).not.toHaveBeenCalled()
  })

  it('drops ack frames missing turnId', () => {
    const api = makeApi()
    expect(
      handleScoredTurnServerEvent({ type: 'wulo.scored_turn.ack', payload: {} }, api),
    ).toBeNull()
  })

  it('dispatches endScoredTurn for a correct verdict', () => {
    const api = makeApi()
    const result = handleScoredTurnServerEvent(
      {
        type: 'wulo.scored_turn.result',
        payload: {
          turnId: 't-1',
          targetWord: 'sun',
          referenceText: 'sun',
          transcript: 'sun',
          verdict: 'correct',
          elapsedMs: 1234,
        },
      },
      api,
    )
    expect(result?.kind).toBe('result')
    if (result?.kind === 'result') {
      expect(result.payload.verdict).toBe('correct')
    }
    expect(api.endScoredTurn).toHaveBeenCalledWith('t-1')
    expect(api.timeoutScoredTurn).not.toHaveBeenCalled()
  })

  it('dispatches endScoredTurn for an incorrect verdict', () => {
    const api = makeApi()
    handleScoredTurnServerEvent(
      {
        type: 'wulo.scored_turn.result',
        payload: {
          turnId: 't-2',
          targetWord: 'sun',
          referenceText: 'sun',
          transcript: 'bun',
          verdict: 'incorrect',
          elapsedMs: 900,
        },
      },
      api,
    )
    expect(api.endScoredTurn).toHaveBeenCalledWith('t-2')
    expect(api.timeoutScoredTurn).not.toHaveBeenCalled()
  })

  it('dispatches timeoutScoredTurn for a timeout verdict', () => {
    const api = makeApi()
    handleScoredTurnServerEvent(
      {
        type: 'wulo.scored_turn.result',
        payload: {
          turnId: 't-3',
          targetWord: 'sun',
          referenceText: 'sun',
          transcript: null,
          verdict: 'timeout',
          elapsedMs: 3500,
        },
      },
      api,
    )
    expect(api.timeoutScoredTurn).toHaveBeenCalledWith('t-3')
    expect(api.endScoredTurn).not.toHaveBeenCalled()
  })

  it('defaults an unknown verdict to timeout (defensive)', () => {
    const api = makeApi()
    const result = handleScoredTurnServerEvent(
      {
        type: 'wulo.scored_turn.result',
        payload: {
          turnId: 't-4',
          targetWord: 'sun',
          referenceText: 'sun',
          transcript: null,
          verdict: 'mystery',
          elapsedMs: 0,
        },
      },
      api,
    )
    if (result?.kind === 'result') {
      expect(result.payload.verdict).toBe('timeout')
    }
    expect(api.timeoutScoredTurn).toHaveBeenCalledWith('t-4')
  })

  it('ignores result frames missing turnId', () => {
    const api = makeApi()
    expect(
      handleScoredTurnServerEvent(
        { type: 'wulo.scored_turn.result', payload: { verdict: 'correct' } },
        api,
      ),
    ).toBeNull()
    expect(api.endScoredTurn).not.toHaveBeenCalled()
  })
})

describe('composeScoredTurnBegin', () => {
  it('produces frame + reducer turn echoing the caller payload', () => {
    const { frame, reducerTurn } = composeScoredTurnBegin(
      { turnId: 't-9', targetWord: 'sun', referenceText: 'say sun', windowMs: 2500 },
      1234,
    )
    expect(frame).toEqual({
      type: 'wulo.scored_turn.begin',
      payload: { turnId: 't-9', targetWord: 'sun', referenceText: 'say sun', windowMs: 2500 },
    })
    expect(reducerTurn).toEqual({
      turnId: 't-9',
      targetWord: 'sun',
      referenceText: 'say sun',
      windowMs: 2500,
      startedAt: 1234,
    })
  })

  it('defaults referenceText to targetWord and windowMs to DEFAULT when omitted', () => {
    const { frame, reducerTurn } = composeScoredTurnBegin(
      { turnId: 't-10', targetWord: 'fish' },
      5000,
    )
    expect(frame.payload.referenceText).toBe('fish')
    expect(frame.payload.windowMs).toBe(DEFAULT_SCORED_TURN_WINDOW_MS)
    expect(reducerTurn.referenceText).toBe('fish')
    expect(reducerTurn.windowMs).toBe(DEFAULT_SCORED_TURN_WINDOW_MS)
    expect(reducerTurn.startedAt).toBe(5000)
  })

  it('treats non-positive windowMs as default', () => {
    const { reducerTurn } = composeScoredTurnBegin(
      { turnId: 't-11', targetWord: 'ship', windowMs: 0 },
      0,
    )
    expect(reducerTurn.windowMs).toBe(DEFAULT_SCORED_TURN_WINDOW_MS)
  })
})
