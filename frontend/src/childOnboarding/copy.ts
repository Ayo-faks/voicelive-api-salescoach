/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Child-facing copy for Phase 4 (mascot, spotlight, hand-off, wrap-up).
 *
 * Rules (docs/onboarding/onboarding-plan-v2.md §Tier C + §Accessibility):
 *  - Every mascot utterance ≤ 25 words.
 *  - All strings flow through {@link t} so the pilot can retune copy
 *    via a single PR and late-stage translation is a drop-in.
 *  - Namespace keys under ``child.<surface>.<role>.<n>``.
 *  - No telemetry properties here; copy is inert.
 */

import { t } from '../onboarding/t'

/**
 * Enforce the ≤25-word rule at module load so regressions fail fast in
 * unit tests (the test simply imports this module and exercises it).
 */
function capWords(key: string, value: string, max = 25): string {
  const wordCount = value.trim().split(/\s+/).filter(Boolean).length
  if (wordCount > max) {
    throw new Error(
      `[childOnboarding/copy] "${key}" exceeds ${max}-word cap (${wordCount}).`,
    )
  }
  return value
}

/** Hand-off interstitial shown to the parent/therapist before the child
 *  picks up the device. "adult" voice = calm, directive. */
export const handoffCopy = {
  title: t(
    'child.handoff.adult.title',
    capWords('child.handoff.adult.title', 'Hand the device to your child'),
  ),
  body: t(
    'child.handoff.adult.body',
    capWords(
      'child.handoff.adult.body',
      'Pass the tablet to your child now. They can press Start when they are ready to meet their practice buddy.',
    ),
  ),
  startCta: t('child.handoff.adult.start', 'Start'),
  narration: t(
    'child.handoff.adult.narration',
    capWords(
      'child.handoff.adult.narration',
      'Hand the tablet to your child. They will meet Wulo next.',
    ),
  ),
} as const

/** Welcome mascot shown immediately after the hand-off. "child" voice =
 *  short, friendly, second-person. */
export const welcomeMascotCopy = {
  title: t(
    'child.welcome-mascot.child.title',
    capWords('child.welcome-mascot.child.title', 'Hi! I am Wulo.'),
  ),
  caption: t(
    'child.welcome-mascot.child.caption',
    capWords(
      'child.welcome-mascot.child.caption',
      'Hi there! I am Wulo. We will play a small game together. Tap Got it to start.',
    ),
  ),
  primaryCta: t('child.welcome-mascot.child.got-it', 'Got it'),
  skipCta: t('child.welcome-mascot.child.skip', 'Skip'),
} as const

/** Spotlight steps for the silent-sorting first-run tutorial. */
export const silentSortingTutorialCopy = {
  bins: t(
    'child.silent-sorting-tutorial.child.bins',
    capWords(
      'child.silent-sorting-tutorial.child.bins',
      'Drag each card into its matching home.',
    ),
  ),
  sample: t(
    'child.silent-sorting-tutorial.child.sample',
    capWords(
      'child.silent-sorting-tutorial.child.sample',
      'Tap here any time to hear the word again.',
    ),
  ),
  finish: t(
    'child.silent-sorting-tutorial.child.finish',
    capWords(
      'child.silent-sorting-tutorial.child.finish',
      'Sort every card and your buddy will cheer you on.',
    ),
  ),
  nextCta: t('child.silent-sorting-tutorial.child.next', 'Next'),
  doneCta: t('child.silent-sorting-tutorial.child.done', 'Got it'),
} as const

/** Wrap-up card shown after the REINFORCE beat auto-wrap fires. */
export const wrapUpCopy = {
  title: t(
    'child.wrap-up.child.title',
    capWords('child.wrap-up.child.title', 'Great work today!'),
  ),
  caption: t(
    'child.wrap-up.child.caption',
    capWords(
      'child.wrap-up.child.caption',
      'Nice practising with me! Tap All done to finish up.',
    ),
  ),
  primaryCta: t('child.wrap-up.child.done', 'All done'),
} as const

export const childOnboardingCopy = {
  handoff: handoffCopy,
  welcomeMascot: welcomeMascotCopy,
  silentSortingTutorial: silentSortingTutorialCopy,
  wrapUp: wrapUpCopy,
} as const
