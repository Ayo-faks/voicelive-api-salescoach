/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * PR12b.3c mic-mode hybrid — scored-turn WS bridge.
 *
 * Pure helpers translating between the `wulo.scored_turn.*` / `wulo.mic_mode`
 * wire protocol (defined in `backend/src/services/websocket_handler.py`) and
 * the `useMicMode` reducer. No React imports so the logic can be unit-tested
 * directly.
 *
 * Protocol recap:
 *   client → server: `wulo.scored_turn.begin` { turnId, targetWord, referenceText?, windowMs? }
 *   client → server: `wulo.scored_turn.end`   { turnId }
 *   client → server: `wulo.mic_mode`          { mode }
 *   server → client: `wulo.scored_turn.ack`    { turnId, targetWord }
 *   server → client: `wulo.scored_turn.result` { turnId, targetWord, referenceText,
 *                                                transcript|null, verdict, elapsedMs }
 */

import type { MicMode } from '../utils/micMode'

export type ScoredTurnVerdict = 'correct' | 'incorrect' | 'timeout'

export interface ScoredTurnBeginPayload {
  turnId: string
  targetWord: string
  referenceText?: string
  windowMs?: number
}

export interface ScoredTurnAckPayload {
  turnId: string
  targetWord: string
}

export interface ScoredTurnResultPayload {
  turnId: string
  targetWord: string
  referenceText: string
  transcript: string | null
  verdict: ScoredTurnVerdict
  elapsedMs: number
}

export interface ScoredTurnFrame<TPayload> {
  type: string
  payload: TPayload
}

/** Build the outgoing `wulo.scored_turn.begin` frame. */
export function buildBeginFrame(
  payload: ScoredTurnBeginPayload,
): ScoredTurnFrame<ScoredTurnBeginPayload> {
  return { type: 'wulo.scored_turn.begin', payload }
}

/** Build the outgoing `wulo.scored_turn.end` frame. */
export function buildEndFrame(turnId: string): ScoredTurnFrame<{ turnId: string }> {
  return { type: 'wulo.scored_turn.end', payload: { turnId } }
}

/** Build the outgoing `wulo.mic_mode` broadcast frame. */
export function buildMicModeFrame(mode: MicMode): ScoredTurnFrame<{ mode: MicMode }> {
  return { type: 'wulo.mic_mode', payload: { mode } }
}

/** Reducer-shaped scored turn matching `useMicMode`'s `ScoredTurn`. */
export interface ComposedScoredTurn {
  turnId: string
  targetWord: string
  referenceText: string
  windowMs: number
  startedAt: number
}

/** Default scored-turn window when a caller does not specify one. */
export const DEFAULT_SCORED_TURN_WINDOW_MS = 4000

/**
 * PR12b.3c.3 — single pure helper that translates a panel's begin request
 * into (a) the outgoing `wulo.scored_turn.begin` frame and (b) the reducer
 * payload for `useMicMode.startScoredTurn`. Keeps the App-level callback
 * one-liner and unit-testable.
 */
export function composeScoredTurnBegin(
  payload: ScoredTurnBeginPayload,
  now: number,
): {
  frame: ScoredTurnFrame<ScoredTurnBeginPayload>
  reducerTurn: ComposedScoredTurn
} {
  const windowMs =
    typeof payload.windowMs === 'number' && payload.windowMs > 0
      ? payload.windowMs
      : DEFAULT_SCORED_TURN_WINDOW_MS
  const referenceText =
    typeof payload.referenceText === 'string' && payload.referenceText.length > 0
      ? payload.referenceText
      : payload.targetWord
  const frame = buildBeginFrame({
    turnId: payload.turnId,
    targetWord: payload.targetWord,
    referenceText,
    windowMs,
  })
  const reducerTurn: ComposedScoredTurn = {
    turnId: payload.turnId,
    targetWord: payload.targetWord,
    referenceText,
    windowMs,
    startedAt: now,
  }
  return { frame, reducerTurn }
}

/** Narrow, side-effect-free view of the `useMicMode` API used by the bridge. */
export interface ScoredTurnReducerApi {
  endScoredTurn: (turnId: string) => void
  timeoutScoredTurn: (turnId: string) => void
}

/**
 * Inspect an incoming realtime message. If it is a scored-turn server event,
 * apply the corresponding reducer dispatch and return a classification so the
 * caller can surface the result to UI (panels). Returns `null` for messages
 * the bridge does not own.
 */
export function handleScoredTurnServerEvent(
  msg: Record<string, unknown> | null | undefined,
  api: ScoredTurnReducerApi,
):
  | { kind: 'ack'; payload: ScoredTurnAckPayload }
  | { kind: 'result'; payload: ScoredTurnResultPayload }
  | null {
  if (!msg || typeof msg !== 'object') return null
  const type = typeof msg.type === 'string' ? msg.type : ''
  if (type === 'wulo.scored_turn.ack') {
    const ack = parseAckPayload(msg.payload)
    return ack ? { kind: 'ack', payload: ack } : null
  }
  if (type === 'wulo.scored_turn.result') {
    const result = parseResultPayload(msg.payload)
    if (!result) return null
    if (result.verdict === 'timeout') {
      api.timeoutScoredTurn(result.turnId)
    } else {
      api.endScoredTurn(result.turnId)
    }
    return { kind: 'result', payload: result }
  }
  return null
}

function parseAckPayload(raw: unknown): ScoredTurnAckPayload | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const turnId = typeof obj.turnId === 'string' ? obj.turnId : ''
  const targetWord = typeof obj.targetWord === 'string' ? obj.targetWord : ''
  if (!turnId) return null
  return { turnId, targetWord }
}

function parseResultPayload(raw: unknown): ScoredTurnResultPayload | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const turnId = typeof obj.turnId === 'string' ? obj.turnId : ''
  if (!turnId) return null
  const verdictRaw = typeof obj.verdict === 'string' ? obj.verdict : ''
  const verdict: ScoredTurnVerdict =
    verdictRaw === 'correct' || verdictRaw === 'incorrect' || verdictRaw === 'timeout'
      ? verdictRaw
      : 'timeout'
  return {
    turnId,
    targetWord: typeof obj.targetWord === 'string' ? obj.targetWord : '',
    referenceText: typeof obj.referenceText === 'string' ? obj.referenceText : '',
    transcript: typeof obj.transcript === 'string' ? obj.transcript : null,
    verdict,
    elapsedMs: typeof obj.elapsedMs === 'number' ? obj.elapsedMs : 0,
  }
}
