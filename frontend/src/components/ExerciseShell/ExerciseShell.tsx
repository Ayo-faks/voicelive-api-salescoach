/*---------------------------------------------------------------------------------------------
 *  ExerciseShell — ORIENT → EXPOSE → BRIDGE → PERFORM → REINFORCE grammar.
 *  A1 SKELETON: structure, slots, gesture-unlock ref, therapist skip-intro button.
 *  Beat orchestration effects are filled in commit A3.
 *--------------------------------------------------------------------------------------------*/

import { useMemo, useRef, type FC } from 'react'
import { assertBridgeCopy } from './assertBridgeCopy'
import {
  ExercisePhaseContext,
  INITIAL_PHASE_STATE,
  useExercisePhase,
  type ExercisePhaseContextValue,
} from './useExercisePhase'
import type { ExerciseShellProps } from './types'

export const ExerciseShell: FC<ExerciseShellProps> = ({
  audience,
  beats,
  slots,
  therapistCanSkipIntro,
  onTherapistOverride,
  covertExpose,
  devSlot,
}) => {
  // Validate BRIDGE copy once per mount (dev throw / prod warn+truncate).
  const bridgeCopy = useMemo(() => assertBridgeCopy(beats.bridge), [beats.bridge])

  const [state, dispatch] = useExercisePhase(INITIAL_PHASE_STATE)

  // Gesture-unlock: any pending onBeatEnter is queued until the first user
  // gesture inside the shell sets this to true. Wired up fully in A3.
  const gestureUnlockedRef = useRef<boolean>(false)

  const ctxValue: ExercisePhaseContextValue = {
    phase: state.phase,
    exposeTouched: state.exposeTouched,
    performStartedAt: state.performStartedAt,
    dispatch,
  }

  const showSkipIntro =
    audience === 'therapist' && Boolean(therapistCanSkipIntro) && state.phase === 'orient'

  const handleSkipIntro = (): void => {
    dispatch({ type: 'THERAPIST_SKIP', kind: 'skip-intro' })
    onTherapistOverride?.('skip-intro')
  }

  const handleRootPointerDown = (): void => {
    if (!gestureUnlockedRef.current) {
      gestureUnlockedRef.current = true
    }
  }

  return (
    <ExercisePhaseContext.Provider value={ctxValue}>
      <section
        className="exercise-shell"
        data-phase={state.phase}
        onPointerDown={handleRootPointerDown}
      >
        <header className="exercise-shell__header">
          {showSkipIntro ? (
            <button
              type="button"
              className="exercise-shell__skip-intro"
              aria-label="Skip introduction"
              onClick={handleSkipIntro}
            >
              Skip intro
            </button>
          ) : null}
        </header>

        <output
          aria-live="polite"
          className="exercise-shell__beat-announce"
          data-testid="exercise-shell-beat-announce"
        >
          {state.phase === 'orient' && beats.orient}
          {state.phase === 'bridge' && bridgeCopy}
          {state.phase === 'reinforce' && beats.reinforce}
        </output>

        {!covertExpose && state.phase !== 'perform' && state.phase !== 'reinforce' ? (
          <div className="exercise-shell__slot exercise-shell__slot--expose" data-slot="expose">
            {slots.expose}
          </div>
        ) : null}

        {state.phase === 'perform' ? (
          <div className="exercise-shell__slot exercise-shell__slot--perform" data-slot="perform">
            {slots.perform}
            {!covertExpose ? (
              <details className="exercise-shell__expose-accordion" data-slot="expose-demoted">
                <summary>Hear the sounds</summary>
                {slots.expose}
              </details>
            ) : null}
          </div>
        ) : null}

        {state.phase === 'reinforce' ? (
          <div
            className="exercise-shell__slot exercise-shell__slot--reinforce"
            data-slot="reinforce"
          >
            {slots.reinforce}
          </div>
        ) : null}

        {devSlot ? (
          <aside className="exercise-shell__dev-slot" data-testid="exercise-shell-dev-slot">
            {devSlot}
          </aside>
        ) : null}
      </section>
    </ExercisePhaseContext.Provider>
  )
}

export default ExerciseShell
