/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Child-onboarding orchestrator.
 *
 * A single host component that:
 *   1. Instantiates {@link useChildUiState} when a child id is known,
 *      so the hook is evaluated exactly once on the session-launch
 *      branch (therapist-side caller — not on the child tablet).
 *   2. Gates the hand-off interstitial on ``active && !mascot_seen``.
 *   3. Gates the silent-sorting tutorial on the active exercise type
 *      and ``!exercise_tutorials_seen.silent_sorting``.
 *   4. Gates the wrap-up card on ``wrapUpVisible && !wrap_up_seen``.
 *
 * Kept as a small, telemetry-free shell so ``App.tsx`` only needs a
 * one-line import behind ``React.lazy``.
 */

import { useCallback, useRef, useState } from 'react'

import { useChildUiState } from '../../hooks/useChildUiState'
import {
  ChildWrapUpCard,
  HandOffInterstitial,
  SilentSortingTutorial,
} from './index'

export interface ChildOnboardingOrchestratorProps {
  /** Current child id. When null / in adult mode, the orchestrator
   *  is inert. */
  childId: string | null
  /** True when the child-mode UI should be visible (``userMode ===
   *  'child' && !isDashboardRoute``). */
  childModeActive: boolean
  /** The active exercise id (``silent_sorting`` etc.) or null. */
  activeExerciseType: string | null
  /** True once the session wrap-up beat has fired and the REINFORCE
   *  card should be shown. */
  wrapUpVisible: boolean
  /** Called when the wrap-up card's "All done" button is pressed. */
  onWrapUpComplete?: () => void
  /** Called when the hand-off interstitial's Start button is pressed. */
  onHandOffComplete?: () => void
}

export function ChildOnboardingOrchestrator({
  childId,
  childModeActive,
  activeExerciseType,
  wrapUpVisible,
  onWrapUpComplete,
  onHandOffComplete,
}: ChildOnboardingOrchestratorProps): JSX.Element | null {
  const disabled = !childModeActive || !childId
  const { state, markMascotSeen, markTutorialSeen, markWrapUpSeen } =
    useChildUiState(childId, { disabled })

  const [tutorialDismissed, setTutorialDismissed] = useState(false)
  const lastExerciseRef = useRef<string | null>(activeExerciseType)
  if (lastExerciseRef.current !== activeExerciseType) {
    lastExerciseRef.current = activeExerciseType
    if (tutorialDismissed) setTutorialDismissed(false)
  }

  const handleHandOffStart = useCallback(() => {
    void markMascotSeen()
    onHandOffComplete?.()
  }, [markMascotSeen, onHandOffComplete])

  const handleTutorialComplete = useCallback(() => {
    setTutorialDismissed(true)
    if (activeExerciseType) void markTutorialSeen(activeExerciseType)
  }, [activeExerciseType, markTutorialSeen])

  const handleWrapUpDone = useCallback(() => {
    void markWrapUpSeen()
    onWrapUpComplete?.()
  }, [markWrapUpSeen, onWrapUpComplete])

  if (disabled) return null

  const showHandoff = !state.mascot_seen
  const showTutorial =
    !showHandoff &&
    !tutorialDismissed &&
    activeExerciseType === 'silent_sorting' &&
    !state.exercise_tutorials_seen?.silent_sorting
  const showWrapUp = wrapUpVisible && !state.wrap_up_seen

  return (
    <>
      <HandOffInterstitial active={showHandoff} onStart={handleHandOffStart} />
      <SilentSortingTutorial active={showTutorial} onComplete={handleTutorialComplete} />
      <ChildWrapUpCard active={showWrapUp} onComplete={handleWrapUpDone} />
    </>
  )
}
