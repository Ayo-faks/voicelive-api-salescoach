/*---------------------------------------------------------------------------------------------
 *  useExercisePhase — reducer + context hook for the ExerciseShell state machine.
 *  Contract: plan §B.3. Pure; no side effects.
 *--------------------------------------------------------------------------------------------*/

import { createContext, useContext, useReducer, type Dispatch } from 'react'
import type { ExercisePhase, PhaseEvent, PhaseState } from './types'

export const INITIAL_PHASE_STATE: PhaseState = {
  phase: 'orient',
  exposeTouched: false,
  performStartedAt: null,
  overrides: [],
}

export function exercisePhaseReducer(state: PhaseState, event: PhaseEvent): PhaseState {
  switch (event.type) {
    case 'START':
      return { ...state, phase: 'orient' }

    case 'ORIENT_DONE':
      if (state.phase !== 'orient') return state
      return { ...state, phase: 'expose' }

    case 'EXPOSE_INTERACT':
      if (state.exposeTouched) return state
      return { ...state, exposeTouched: true }

    case 'ADVANCE': {
      if (state.phase !== 'expose') return state
      const allowed = event.canAdvance ?? state.exposeTouched
      if (!allowed) return state
      return { ...state, phase: 'bridge' }
    }

    case 'BRIDGE_DONE': {
      if (state.phase !== 'bridge') return state
      return {
        ...state,
        phase: 'perform',
        performStartedAt: Date.now(),
      }
    }

    case 'PERFORM_DONE':
      if (state.phase !== 'perform') return state
      return { ...state, phase: 'reinforce' }

    case 'RESET':
      return {
        phase: 'orient',
        exposeTouched: false,
        performStartedAt: null,
        overrides: state.overrides,
      }

    case 'SUPPRESS_BRIDGE': {
      // Stage 8 variant: expose → perform with no bridge beat.
      if (state.phase !== 'expose') return state
      return { ...state, phase: 'perform', performStartedAt: Date.now() }
    }

    case 'COLLAPSE_PERFORM': {
      // Stage 0 variant: bridge → reinforce directly, skipping perform.
      if (state.phase !== 'bridge' && state.phase !== 'expose') return state
      return { ...state, phase: 'reinforce' }
    }

    case 'REPLAY': {
      // reinforce → expose: re-enter EXPOSE without firing ORIENT/BRIDGE so
      // greetings do not repeat. Reset exposeTouched so the adapter can call
      // advance() again at the end of the replayed round. performStartedAt is
      // cleared because any subsequent perform beat should be a fresh run.
      if (state.phase !== 'reinforce') return state
      return {
        ...state,
        phase: 'expose',
        exposeTouched: false,
        performStartedAt: null,
      }
    }

    case 'THERAPIST_SKIP': {
      const entry = {
        kind: event.kind,
        at: event.at ?? Date.now(),
        reason: event.reason,
      }
      const overrides = [...state.overrides, entry]
      switch (event.kind) {
        case 'skip-intro':
          return { ...state, phase: 'expose', overrides }
        case 'skip-expose':
          return { ...state, phase: 'bridge', overrides }
        case 'skip-bridge':
          return {
            ...state,
            phase: 'perform',
            performStartedAt: Date.now(),
            overrides,
          }
        default:
          return { ...state, overrides }
      }
    }

    default:
      return state
  }
}

export function useExercisePhase(
  initial: PhaseState = INITIAL_PHASE_STATE
): [PhaseState, Dispatch<PhaseEvent>] {
  return useReducer(exercisePhaseReducer, initial)
}

// ---------------------------------------------------------------------------
// Context: adapters read `phase` to guard scoring callbacks.
// ---------------------------------------------------------------------------

export interface ExercisePhaseContextValue {
  phase: ExercisePhase
  exposeTouched: boolean
  performStartedAt: number | null
  dispatch: Dispatch<PhaseEvent>
}

export const ExercisePhaseContext = createContext<ExercisePhaseContextValue | null>(null)

export function useExercisePhaseContext(): ExercisePhaseContextValue {
  const ctx = useContext(ExercisePhaseContext)
  if (!ctx) {
    throw new Error(
      'useExercisePhaseContext must be used inside an <ExerciseShell> (ExercisePhaseContext missing)'
    )
  }
  return ctx
}

// ---------------------------------------------------------------------------
// Convenience hook for adapters that want a compact imperative API instead of
// dispatching PhaseEvent values directly. Mirrors the shape previously
// exported by the Session C local shell mock so panels can migrate with only
// an import-path change.
// ---------------------------------------------------------------------------

export interface UseShellAdvanceApi {
  phase: ExercisePhase
  advance: (opts?: { force?: boolean }) => void
  notifyExposeInteract: () => void
  replay: () => void
}

export function useShellAdvance(): UseShellAdvanceApi {
  const ctx = useExercisePhaseContext()
  return {
    phase: ctx.phase,
    advance: (opts?: { force?: boolean }) => {
      // `force: true` bypasses the expose-gate (exposeTouched / canAdvanceFromExpose).
      // Without force, the shell's effectiveDispatch fills canAdvance from
      // canAdvanceFromExpose (prop) or the reducer's exposeTouched state.
      if (opts?.force) {
        ctx.dispatch({ type: 'ADVANCE', canAdvance: true })
      } else {
        ctx.dispatch({ type: 'ADVANCE' })
      }
    },
    notifyExposeInteract: () => ctx.dispatch({ type: 'EXPOSE_INTERACT' }),
    replay: () => ctx.dispatch({ type: 'REPLAY' }),
  }
}
