/*---------------------------------------------------------------------------------------------
 *  Local ExerciseShell contract mock for Session C (SilentSorting adapter).
 *  Mirrors the FROZEN Session 0 contract in docs/exercise-shell-pr1-plan.md §B.2.
 *
 *  This file is INTENTIONALLY decoupled from ../ExerciseShell/* — adapters must
 *  import from here until Session E swaps in the real shell. The runtime below
 *  is a minimal but faithful subset:
 *    - five-phase state machine (orient → expose → bridge → perform → reinforce)
 *    - onBeatEnter fired at ORIENT / BRIDGE / REINFORCE entry
 *    - EXPOSE slot demoted inside <details>Hear the sounds</details> in PERFORM
 *    - canAdvanceFromExpose gate + explicit useShellAdvance() for "Start game"
 *    - therapist skip-intro button
 *    - devSlot rendered only when provided
 *    - assertBridgeCopy duplicated locally (≤7-word invariant)
 *  Features NOT re-implemented here (covered by real ExerciseShell.test.tsx):
 *    - gesture-unlock gating, realtimeReady warming veil, focus management,
 *      prefers-reduced-motion styling.
 *--------------------------------------------------------------------------------------------*/

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type Dispatch,
  type FC,
  type ReactNode,
} from 'react'
import type { ExerciseMetadata } from '../../types'

// ---------------------------------------------------------------------------
// Frozen types (§B.2)
// ---------------------------------------------------------------------------

export type ExercisePhase =
  | 'orient'
  | 'expose'
  | 'bridge'
  | 'perform'
  | 'reinforce'

export type TherapistOverrideKind = 'skip-intro' | 'skip-expose' | 'skip-bridge'

export interface ExerciseShellSlots {
  expose: ReactNode
  perform: ReactNode
  reinforce?: ReactNode
}

export interface ExerciseBeatCopy {
  orient: string
  bridge: string
  reinforce: string
}

export interface ExerciseShellProps {
  metadata: ExerciseMetadata
  audience: 'child' | 'therapist'
  beats: ExerciseBeatCopy
  slots: ExerciseShellSlots
  canAdvanceFromExpose?: () => boolean
  performComplete: boolean
  onBeatEnter?: (phase: ExercisePhase, beatText: string | null) => void | Promise<void>
  onRequestInterrupt?: () => void
  therapistCanSkipIntro?: boolean
  onTherapistOverride?: (kind: TherapistOverrideKind, reason?: string) => void
  collapsePerform?: boolean
  suppressBridge?: boolean
  covertExpose?: boolean
  /** Default true in the mock — Session A owns the real warming-veil logic. */
  realtimeReady?: boolean
  devSlot?: ReactNode
}

// ---------------------------------------------------------------------------
// Reducer (§B.3, trimmed to what the adapter uses)
// ---------------------------------------------------------------------------

interface PhaseState {
  phase: ExercisePhase
  exposeTouched: boolean
}

type PhaseEvent =
  | { type: 'ORIENT_DONE' }
  | { type: 'EXPOSE_INTERACT' }
  | { type: 'ADVANCE'; canAdvance?: boolean }
  | { type: 'BRIDGE_DONE' }
  | { type: 'PERFORM_DONE' }
  | { type: 'SUPPRESS_BRIDGE' }
  | { type: 'COLLAPSE_PERFORM' }
  | { type: 'THERAPIST_SKIP'; kind: TherapistOverrideKind }

function reducer(state: PhaseState, event: PhaseEvent): PhaseState {
  switch (event.type) {
    case 'ORIENT_DONE':
      return state.phase === 'orient' ? { ...state, phase: 'expose' } : state
    case 'EXPOSE_INTERACT':
      return state.exposeTouched ? state : { ...state, exposeTouched: true }
    case 'ADVANCE': {
      if (state.phase !== 'expose') return state
      const allowed = event.canAdvance ?? state.exposeTouched
      return allowed ? { ...state, phase: 'bridge' } : state
    }
    case 'BRIDGE_DONE':
      return state.phase === 'bridge' ? { ...state, phase: 'perform' } : state
    case 'PERFORM_DONE':
      return state.phase === 'perform' ? { ...state, phase: 'reinforce' } : state
    case 'SUPPRESS_BRIDGE':
      return state.phase === 'expose' ? { ...state, phase: 'perform' } : state
    case 'COLLAPSE_PERFORM':
      return { ...state, phase: 'reinforce' }
    case 'THERAPIST_SKIP':
      if (event.kind === 'skip-intro') return { ...state, phase: 'expose' }
      if (event.kind === 'skip-expose') return { ...state, phase: 'bridge' }
      if (event.kind === 'skip-bridge') return { ...state, phase: 'perform' }
      return state
    default:
      return state
  }
}

// ---------------------------------------------------------------------------
// BRIDGE invariant (duplicated locally so mock has no ../ExerciseShell imports)
// ---------------------------------------------------------------------------

const MAX_BRIDGE_WORDS = 7

function isDevEnv(): boolean {
  try {
    return Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV)
  } catch {
    return false
  }
}

function assertBridgeCopy(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length <= MAX_BRIDGE_WORDS) return text
  const msg = `ExerciseShellContract(mock): BRIDGE copy must be ≤ ${MAX_BRIDGE_WORDS} words, got ${words.length}: "${text}"`
  if (isDevEnv()) throw new Error(msg)
  console.warn(msg)
  return words.slice(0, MAX_BRIDGE_WORDS).join(' ')
}

// ---------------------------------------------------------------------------
// Context — adapters inside slots.expose use useShellAdvance() for "Start game"
// ---------------------------------------------------------------------------

interface ShellControlValue {
  phase: ExercisePhase
  advance: (opts?: { force?: boolean }) => void
  notifyExposeInteract: () => void
}

const ShellControlContext = createContext<ShellControlValue | null>(null)

/**
 * Hook exposed to adapter EXPOSE slot. Calling `advance({ force: true })`
 * bypasses the `canAdvanceFromExpose` gate (§C.4 "Start game" path).
 */
export function useShellAdvance(): ShellControlValue {
  const ctx = useContext(ShellControlContext)
  if (!ctx) {
    throw new Error('useShellAdvance must be called inside <ExerciseShell>')
  }
  return ctx
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ExerciseShell: FC<ExerciseShellProps> = (props) => {
  const {
    audience,
    beats,
    slots,
    canAdvanceFromExpose,
    performComplete,
    onBeatEnter,
    therapistCanSkipIntro,
    onTherapistOverride,
    collapsePerform,
    suppressBridge,
    covertExpose,
    devSlot,
  } = props

  const bridgeCopy = useMemo(() => assertBridgeCopy(beats.bridge), [beats.bridge])

  const [state, dispatch] = useReducer(reducer, { phase: 'orient', exposeTouched: false })
  const { phase } = state

  // Beat orchestration — fires once per phase entry for orient/bridge/reinforce.
  useEffect(() => {
    let cancelled = false
    const run = async (): Promise<void> => {
      if (phase === 'orient') {
        await Promise.resolve(onBeatEnter?.('orient', beats.orient))
        if (!cancelled) dispatch({ type: 'ORIENT_DONE' })
      } else if (phase === 'bridge') {
        await Promise.resolve(onBeatEnter?.('bridge', bridgeCopy))
        if (!cancelled) {
          dispatch(collapsePerform ? { type: 'COLLAPSE_PERFORM' } : { type: 'BRIDGE_DONE' })
        }
      } else if (phase === 'reinforce') {
        await Promise.resolve(onBeatEnter?.('reinforce', beats.reinforce))
      }
    }
    void run()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // Adapter signals PERFORM complete.
  useEffect(() => {
    if (phase === 'perform' && performComplete) {
      dispatch({ type: 'PERFORM_DONE' })
    }
  }, [phase, performComplete])

  const advance = useCallback(
    (opts?: { force?: boolean }) => {
      if (opts?.force) {
        if (suppressBridge) dispatch({ type: 'SUPPRESS_BRIDGE' })
        else dispatch({ type: 'ADVANCE', canAdvance: true })
        return
      }
      const gate = canAdvanceFromExpose?.() ?? state.exposeTouched
      if (!gate) return
      if (suppressBridge) dispatch({ type: 'SUPPRESS_BRIDGE' })
      else dispatch({ type: 'ADVANCE', canAdvance: true })
    },
    [canAdvanceFromExpose, state.exposeTouched, suppressBridge]
  )

  const notifyExposeInteract = useCallback(() => {
    dispatch({ type: 'EXPOSE_INTERACT' })
  }, [])

  const ctxValue = useMemo<ShellControlValue>(
    () => ({ phase, advance, notifyExposeInteract }),
    [phase, advance, notifyExposeInteract]
  )

  const showSkipIntro =
    audience === 'therapist' && Boolean(therapistCanSkipIntro) && phase === 'orient'

  const handleSkipIntro = (): void => {
    dispatch({ type: 'THERAPIST_SKIP', kind: 'skip-intro' })
    onTherapistOverride?.('skip-intro')
  }

  const showExposeMain = phase === 'expose' && !covertExpose
  const showPerform = phase === 'perform'
  const showReinforce = phase === 'reinforce'

  return (
    <ShellControlContext.Provider value={ctxValue}>
      <section
        className="exercise-shell"
        data-phase={phase}
        data-testid="exercise-shell-mock"
      >
        <header className="exercise-shell__header">
          {showSkipIntro ? (
            <button
              type="button"
              aria-label="Skip introduction"
              onClick={handleSkipIntro}
            >
              Skip intro
            </button>
          ) : null}
        </header>

        <output aria-live="polite" data-testid="exercise-shell-beat-announce">
          {phase === 'orient' ? beats.orient : null}
          {phase === 'bridge' ? bridgeCopy : null}
          {phase === 'reinforce' ? beats.reinforce : null}
        </output>

        {showExposeMain ? (
          <div data-slot="expose">{slots.expose}</div>
        ) : null}

        {showPerform ? (
          <div data-slot="perform">
            {slots.perform}
            {!covertExpose ? (
              <details data-slot="expose-demoted">
                <summary>Hear the sounds</summary>
                {slots.expose}
              </details>
            ) : null}
          </div>
        ) : null}

        {showReinforce ? (
          <div data-slot="reinforce">{slots.reinforce}</div>
        ) : null}

        {devSlot ? (
          <aside data-testid="exercise-shell-dev-slot">{devSlot}</aside>
        ) : null}
      </section>
    </ShellControlContext.Provider>
  )
}

export default ExerciseShell
