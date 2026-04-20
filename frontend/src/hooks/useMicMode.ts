/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * PR12b mic-mode hybrid — the reducer the user named.
 *
 * Pure, no side effects: the hook `useMicMode` wraps `micModeReducer` with
 * `useReducer` and persists the top-level mode to `localStorage` via
 * `writeStoredMicMode`. The scored-turn sub-state is in-memory only — it
 * represents a short (seconds) window during which a panel has asked the
 * backend to route audio into the articulation scorer while the rest of the
 * session keeps flowing to the LLM.
 *
 * The scored-turn protocol messages (`wulo.scored_turn.*`) are defined in
 * `backend/src/services/websocket_handler.py`. This reducer does not itself
 * speak the protocol — App.tsx wires dispatches to outgoing WS frames and
 * incoming WS events to dispatches.
 */

import { useCallback, useEffect, useReducer } from 'react'
import { readStoredMicMode, writeStoredMicMode, type MicMode } from '../utils/micMode'

export interface ScoredTurn {
  /** Client-generated correlation id echoed back on ack/result. */
  turnId: string
  /** Target word the child is expected to say during this window. */
  targetWord: string
  /** Reference text for the pronunciation assessor (may equal `targetWord`). */
  referenceText: string
  /** Length of the scored window in milliseconds (incl. grace). */
  windowMs: number
  /** `performance.now()` (or equivalent) at dispatch time. */
  startedAt: number
}

export interface MicModeState {
  mode: MicMode
  scoredTurn: ScoredTurn | null
}

export type MicModeEvent =
  | { type: 'SET_MODE'; mode: MicMode }
  | { type: 'SCORED_TURN_START'; turn: ScoredTurn }
  | { type: 'SCORED_TURN_END'; turnId: string }
  | { type: 'SCORED_TURN_TIMEOUT'; turnId: string }

export function initialMicModeState(override?: MicMode): MicModeState {
  return { mode: readStoredMicMode(override), scoredTurn: null }
}

export function micModeReducer(state: MicModeState, event: MicModeEvent): MicModeState {
  switch (event.type) {
    case 'SET_MODE': {
      if (state.mode === event.mode) return state
      // Switching modes cancels any in-flight scored turn — the backend
      // protocol guarantees an ack/result only for turns started in
      // conversational mode.
      return { mode: event.mode, scoredTurn: null }
    }
    case 'SCORED_TURN_START': {
      // Scored turns are only meaningful while the continuous mic is open.
      if (state.mode !== 'conversational') return state
      return { ...state, scoredTurn: event.turn }
    }
    case 'SCORED_TURN_END':
    case 'SCORED_TURN_TIMEOUT': {
      if (!state.scoredTurn || state.scoredTurn.turnId !== event.turnId) return state
      return { ...state, scoredTurn: null }
    }
    default: {
      const _exhaustive: never = event
      return _exhaustive
    }
  }
}

export interface UseMicModeApi {
  state: MicModeState
  setMode: (mode: MicMode) => void
  startScoredTurn: (turn: ScoredTurn) => void
  endScoredTurn: (turnId: string) => void
  timeoutScoredTurn: (turnId: string) => void
}

/** React hook wrapper around `micModeReducer`. Persists `mode` changes. */
export function useMicMode(override?: MicMode): UseMicModeApi {
  const [state, dispatch] = useReducer(micModeReducer, override, initialMicModeState)

  useEffect(() => {
    writeStoredMicMode(state.mode)
  }, [state.mode])

  const setMode = useCallback((mode: MicMode) => {
    dispatch({ type: 'SET_MODE', mode })
  }, [])
  const startScoredTurn = useCallback((turn: ScoredTurn) => {
    dispatch({ type: 'SCORED_TURN_START', turn })
  }, [])
  const endScoredTurn = useCallback((turnId: string) => {
    dispatch({ type: 'SCORED_TURN_END', turnId })
  }, [])
  const timeoutScoredTurn = useCallback((turnId: string) => {
    dispatch({ type: 'SCORED_TURN_TIMEOUT', turnId })
  }, [])

  return { state, setMode, startScoredTurn, endScoredTurn, timeoutScoredTurn }
}
