/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Spotlight-anchor registry.
 *
 * Parallels ``frontend/src/onboarding/tours.ts`` — keeps Phase 4's
 * DOM contract grep-able so silent anchor rot in child-mode panels is
 * caught by a single fs-based regression test rather than a live
 * session.
 *
 * Rules:
 *  - Anchor resolves via ``data-testid`` only (the sole supported
 *    anchoring strategy; matches adult tours).
 *  - ``ariaLabel`` is the human-readable name the spotlight announces
 *    when focus lands there.
 */

export interface SpotlightAnchor {
  /** Stable id used by {@link ChildSpotlight}. */
  id: string
  /** The ``data-testid`` the anchor element carries. */
  testId: string
  /** The CSS selector the spotlight resolves. Always
   *  ``[data-testid="<testId>"]`` so the fs-based contract test can
   *  assert the two halves agree. */
  selector: string
  /** Screen-reader label. */
  ariaLabel: string
}

function anchor(id: string, testId: string, ariaLabel: string): SpotlightAnchor {
  return {
    id,
    testId,
    selector: `[data-testid="${testId}"]`,
    ariaLabel,
  }
}

export const silentSortingAnchors = {
  bins: anchor(
    'silent-sorting.bins',
    'silent-sorting-bins',
    'Sorting bins',
  ),
  sample: anchor(
    'silent-sorting.sample',
    'silent-sorting-sample',
    'Word preview',
  ),
  finish: anchor(
    'silent-sorting.finish',
    'silent-sorting-start-game',
    'Start game',
  ),
} as const

export const CHILD_SPOTLIGHT_ANCHORS: Record<string, SpotlightAnchor> = {
  [silentSortingAnchors.bins.id]: silentSortingAnchors.bins,
  [silentSortingAnchors.sample.id]: silentSortingAnchors.sample,
  [silentSortingAnchors.finish.id]: silentSortingAnchors.finish,
}

export function resolveSpotlightAnchor(id: string): SpotlightAnchor | null {
  return CHILD_SPOTLIGHT_ANCHORS[id] ?? null
}
