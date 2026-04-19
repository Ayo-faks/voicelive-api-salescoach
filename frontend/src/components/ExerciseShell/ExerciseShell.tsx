/*---------------------------------------------------------------------------------------------
 *  ExerciseShell — ORIENT → EXPOSE → BRIDGE → PERFORM → REINFORCE grammar.
 *  Commit A3: beat orchestration, gesture unlock, warming veil, variants,
 *  focus management, prefers-reduced-motion.
 *  Contract: docs/exercise-shell-pr1-plan.md §B.2–§B.5.
 *--------------------------------------------------------------------------------------------*/

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type FC,
} from 'react'
import { assertBridgeCopy } from './assertBridgeCopy'
import {
  ExercisePhaseContext,
  INITIAL_PHASE_STATE,
  useExercisePhase,
  type ExercisePhaseContextValue,
} from './useExercisePhase'
import type { ExercisePhase, ExerciseShellProps, PhaseEvent } from './types'

const WARMING_COPY = 'Buddy is warming up…'

function prefersReducedMotionNow(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(prefersReducedMotionNow)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handler = (event: MediaQueryListEvent): void => setReduced(event.matches)
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', handler)
      return () => mq.removeEventListener('change', handler)
    }
    // Legacy fallback.
    mq.addListener(handler)
    return () => mq.removeListener(handler)
  }, [])
  return reduced
}

function beatTextForPhase(
  phase: ExercisePhase,
  beats: { orient: string; bridge: string; reinforce: string }
): string | null {
  switch (phase) {
    case 'orient':
      return beats.orient
    case 'bridge':
      return beats.bridge
    case 'reinforce':
      return beats.reinforce
    default:
      // EXPOSE and PERFORM have no shell-driven beat audio.
      return null
  }
}

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
    realtimeReady = true,
    devSlot,
  } = props

  // BRIDGE copy invariant — throws in dev, warn+truncate in prod.
  const bridgeCopy = useMemo(() => assertBridgeCopy(beats.bridge), [beats.bridge])
  const effectiveBeats = useMemo(
    () => ({ orient: beats.orient, bridge: bridgeCopy, reinforce: beats.reinforce }),
    [beats.orient, bridgeCopy, beats.reinforce]
  )

  const [state, dispatch] = useExercisePhase(INITIAL_PHASE_STATE)
  const [gestureUnlocked, setGestureUnlocked] = useState<boolean>(false)
  const reducedMotion = usePrefersReducedMotion()

  // Capture latest onBeatEnter without re-running the orchestration effect.
  const onBeatEnterRef = useRef(onBeatEnter)
  useEffect(() => {
    onBeatEnterRef.current = onBeatEnter
  })

  const lastPlayedPhaseRef = useRef<ExercisePhase | null>(null)
  const sectionRef = useRef<HTMLElement | null>(null)

  // Wrap dispatch to apply shell-level policy:
  // - `suppressBridge` converts ADVANCE → SUPPRESS_BRIDGE (expose → perform directly).
  // - `canAdvanceFromExpose` prop fills the reducer gate when the caller didn't pass
  //   `canAdvance` explicitly. Explicit `canAdvance: true` (Start press) still wins.
  const effectiveDispatch = useCallback<Dispatch<PhaseEvent>>(
    (event) => {
      if (event.type === 'ADVANCE') {
        const explicit = event.canAdvance
        const gateValue =
          explicit !== undefined
            ? explicit
            : (canAdvanceFromExpose?.() ?? state.exposeTouched)
        if (suppressBridge && state.phase === 'expose' && gateValue) {
          dispatch({ type: 'SUPPRESS_BRIDGE' })
          return
        }
        dispatch({ type: 'ADVANCE', canAdvance: gateValue })
        return
      }
      dispatch(event)
    },
    [dispatch, suppressBridge, state.phase, state.exposeTouched, canAdvanceFromExpose]
  )

  // Beat orchestration: fire onBeatEnter at ORIENT/BRIDGE/REINFORCE entry; auto-advance
  // ORIENT → EXPOSE and BRIDGE → PERFORM (or BRIDGE → REINFORCE when collapsePerform).
  // Gesture + realtime gates: if either is off, the beat is "queued" — we simply do
  // nothing this pass and the effect re-fires when the gate flips.
  useEffect(() => {
    const phase = state.phase
    const beatText = beatTextForPhase(phase, effectiveBeats)
    if (beatText == null) return
    if (lastPlayedPhaseRef.current === phase) return
    if (!gestureUnlocked || !realtimeReady) return

    lastPlayedPhaseRef.current = phase
    let cancelled = false

    Promise.resolve()
      .then(() => onBeatEnterRef.current?.(phase, beatText))
      .catch(() => {
        // Non-blocking: plan §E.3 — never spin. Advance anyway.
      })
      .then(() => {
        if (cancelled) return
        if (phase === 'orient') {
          dispatch({ type: 'ORIENT_DONE' })
        } else if (phase === 'bridge') {
          dispatch(collapsePerform ? { type: 'COLLAPSE_PERFORM' } : { type: 'BRIDGE_DONE' })
        }
        // REINFORCE does not auto-advance; adapter handles exit.
      })

    return () => {
      cancelled = true
    }
  }, [
    state.phase,
    gestureUnlocked,
    realtimeReady,
    effectiveBeats,
    dispatch,
    collapsePerform,
  ])

  // Adapter signals PERFORM complete.
  useEffect(() => {
    if (state.phase === 'perform' && performComplete) {
      dispatch({ type: 'PERFORM_DONE' })
    }
  }, [state.phase, performComplete, dispatch])

  // Move focus to the phase's primary affordance when it changes.
  useEffect(() => {
    const section = sectionRef.current
    if (!section) return
    // Reference phase so lint sees it as a read, not a phantom trigger.
    const selector = `[data-primary-affordance="true"][data-for-phase~="${state.phase}"], [data-primary-affordance="true"]:not([data-for-phase])`
    const el = section.querySelector<HTMLElement>(selector)
    el?.focus()
  }, [state.phase])

  const ctxValue: ExercisePhaseContextValue = useMemo(
    () => ({
      phase: state.phase,
      exposeTouched: state.exposeTouched,
      performStartedAt: state.performStartedAt,
      dispatch: effectiveDispatch,
    }),
    [state.phase, state.exposeTouched, state.performStartedAt, effectiveDispatch]
  )

  const showSkipIntro =
    audience === 'therapist' && Boolean(therapistCanSkipIntro) && state.phase === 'orient'

  const handleSkipIntro = (): void => {
    dispatch({ type: 'THERAPIST_SKIP', kind: 'skip-intro' })
    onTherapistOverride?.('skip-intro')
  }

  const handleRootGesture = (): void => {
    if (!gestureUnlocked) setGestureUnlocked(true)
  }

  // Slot rendering rules (plan §B.2):
  // - ORIENT: avatar speaks; no affordances live.
  // - EXPOSE: child-facing EXPOSE slot rendered (unless covertExpose).
  // - BRIDGE: short transitional beat; no affordances.
  // - PERFORM: PERFORM slot plus a demoted EXPOSE inside an accordion.
  // - REINFORCE: REINFORCE slot.
  const phase = state.phase
  const showExposeMain = phase === 'expose' && !covertExpose
  const showPerform = phase === 'perform'
  const showReinforce = phase === 'reinforce'

  return (
    <ExercisePhaseContext.Provider value={ctxValue}>
      <section
        ref={sectionRef}
        className="exercise-shell"
        data-phase={state.phase}
        data-reduced-motion={reducedMotion ? 'true' : 'false'}
        data-gesture-unlocked={gestureUnlocked ? 'true' : 'false'}
        data-realtime-ready={realtimeReady ? 'true' : 'false'}
        onPointerDown={handleRootGesture}
        onKeyDown={handleRootGesture}
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
          {!realtimeReady ? (
            <div
              className="exercise-shell__warming-veil"
              aria-live="polite"
              data-testid="exercise-shell-warming-veil"
            >
              {WARMING_COPY}
            </div>
          ) : null}
        </header>

        <output
          aria-live="polite"
          className="exercise-shell__beat-announce"
          data-testid="exercise-shell-beat-announce"
        >
          {phase === 'orient' ? beats.orient : null}
          {phase === 'bridge' ? bridgeCopy : null}
          {phase === 'reinforce' ? beats.reinforce : null}
        </output>

        {showExposeMain ? (
          <div className="exercise-shell__slot exercise-shell__slot--expose" data-slot="expose">
            {slots.expose}
          </div>
        ) : null}

        {showPerform ? (
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

        {showReinforce ? (
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
