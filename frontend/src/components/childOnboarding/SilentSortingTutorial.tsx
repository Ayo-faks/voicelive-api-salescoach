/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Silent-sorting micro-tutorial controller.
 *
 * Orchestrates a three-step spotlight tour that runs exactly once per
 * child for the silent-sorting exercise. Order:
 *
 *   1. ``silent-sorting.bins``  — sorting bins
 *   2. ``silent-sorting.sample`` — preview/play-word row
 *   3. ``silent-sorting.finish`` — start-game button
 *
 * When the child presses "Got it" on the final step (or "Skip" at any
 * step), the controller calls ``onComplete`` and the adult-side caller
 * should persist via ``markTutorialSeen('silent_sorting')``.
 *
 * The controller emits zero telemetry.
 */

import { useCallback, useState } from 'react'

import { silentSortingTutorialCopy } from '../../childOnboarding/copy'
import { silentSortingAnchors } from '../../childOnboarding/spotlightAnchors'
import { ChildSpotlight } from './ChildSpotlight'

export interface SilentSortingTutorialProps {
  active: boolean
  onComplete: () => void
}

const steps = [
  { anchorId: silentSortingAnchors.bins.id, caption: silentSortingTutorialCopy.bins },
  { anchorId: silentSortingAnchors.sample.id, caption: silentSortingTutorialCopy.sample },
  { anchorId: silentSortingAnchors.finish.id, caption: silentSortingTutorialCopy.finish },
] as const

export function SilentSortingTutorial({
  active,
  onComplete,
}: SilentSortingTutorialProps): JSX.Element | null {
  const [stepIndex, setStepIndex] = useState(0)

  const handleNext = useCallback(() => {
    setStepIndex((current) => {
      const next = current + 1
      if (next >= steps.length) {
        onComplete()
        return current
      }
      return next
    })
  }, [onComplete])

  const handleDismiss = useCallback(() => {
    onComplete()
  }, [onComplete])

  if (!active) return null
  const step = steps[stepIndex]
  if (!step) return null

  const isLast = stepIndex === steps.length - 1

  return (
    <ChildSpotlight
      anchorId={step.anchorId}
      caption={step.caption}
      nextCtaLabel={isLast ? silentSortingTutorialCopy.doneCta : silentSortingTutorialCopy.nextCta}
      onNext={handleNext}
      onDismiss={handleDismiss}
    />
  )
}
