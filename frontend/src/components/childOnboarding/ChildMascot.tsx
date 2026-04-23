/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Child-mode welcome mascot.
 *
 * Reuses the existing ``BuddyAvatar`` asset (/wulo-robot.webp) and
 * leverages the drop-in / pulse keyframes already present in
 * ``WuloRobot.tsx``. No new animation libraries or image assets.
 *
 * Contract (docs/onboarding/onboarding-plan-v2.md §Tier C item 13):
 *  - Caption is always visible; TTS is additive. SR users rely on
 *    the caption plus the ``aria-live="polite"`` region.
 *  - Two ≥44×44 CSS px buttons: "Got it" (advance), "Skip" (dismiss).
 *  - No auto-advance timer; the child or adult controls pacing.
 *  - ``prefers-reduced-motion`` removes drop-in + pulse.
 *  - ``forced-colors: active`` drops gradients; the component uses
 *    ``CanvasText`` / ``Canvas`` system colors.
 *  - Emits zero telemetry. The shim is already sealed by
 *    ``OnboardingRuntime``; we simply never call it.
 */

import {
  Button,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
} from '@fluentui/react-components'
import { useCallback, useEffect, useRef } from 'react'

import { BuddyAvatar } from '../BuddyAvatar'
import { useReducedMotion } from '../../childOnboarding/useReducedMotion'

const useStyles = makeStyles({
  overlay: {
    position: 'fixed',
    inset: 0,
    display: 'grid',
    placeItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    zIndex: 1400,
    padding: '24px',
    '@media (forced-colors: active)': {
      backgroundColor: 'Canvas',
    },
  },
  card: {
    maxWidth: '480px',
    width: '100%',
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    ...shorthands.borderRadius('24px'),
    padding: '28px 24px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '18px',
    boxShadow: '0 24px 48px rgba(15, 23, 42, 0.28)',
    '@media (forced-colors: active)': {
      ...shorthands.border('2px', 'solid', 'CanvasText'),
      backgroundColor: 'Canvas',
      color: 'CanvasText',
    },
  },
  dropIn: {
    animationName: {
      '0%': { transform: 'translateY(-40px) scale(0.9)', opacity: 0 },
      '100%': { transform: 'translateY(0) scale(1)', opacity: 1 },
    },
    animationDuration: '0.45s',
    animationTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    animationFillMode: 'forwards',
  },
  pulseRing: {
    animationName: {
      '0%': { boxShadow: '0 0 0 0 rgba(37, 99, 235, 0.35)' },
      '70%': { boxShadow: '0 0 0 18px rgba(37, 99, 235, 0)' },
      '100%': { boxShadow: '0 0 0 0 rgba(37, 99, 235, 0)' },
    },
    animationDuration: '2.2s',
    animationIterationCount: 'infinite',
    borderRadius: '50%',
  },
  '@media (prefers-reduced-motion: reduce)': {
    dropIn: { animationDuration: '0.01s' },
    pulseRing: { animationName: 'none' },
  },
  caption: {
    margin: 0,
    fontSize: '18px',
    lineHeight: 1.4,
    textAlign: 'center',
  },
  srOnly: {
    position: 'absolute',
    width: '1px',
    height: '1px',
    padding: 0,
    margin: '-1px',
    overflow: 'hidden',
    clip: 'rect(0,0,0,0)',
    whiteSpace: 'nowrap',
    ...shorthands.borderWidth(0),
  },
  actions: {
    display: 'flex',
    gap: '12px',
    width: '100%',
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  tapTarget: {
    minWidth: '44px',
    minHeight: '44px',
    fontSize: '16px',
  },
})

export interface ChildMascotProps {
  active: boolean
  caption: string
  primaryCtaLabel?: string
  skipCtaLabel?: string
  onComplete?: () => void
  onSkip?: () => void
  /** Override the reduced-motion detector (tests / adult-forced mode). */
  reducedMotion?: boolean
  /** Optional id so the parent ``aria-labelledby`` can point at the caption. */
  captionId?: string
}

export function ChildMascot({
  active,
  caption,
  primaryCtaLabel = 'Got it',
  skipCtaLabel = 'Skip',
  onComplete,
  onSkip,
  reducedMotion: reducedMotionProp,
  captionId = 'child-mascot-caption',
}: ChildMascotProps): JSX.Element | null {
  const styles = useStyles()
  const detected = useReducedMotion()
  const reducedMotion = reducedMotionProp ?? detected
  const primaryRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (active) {
      primaryRef.current?.focus()
    }
  }, [active])

  const handleKey = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onSkip?.()
      }
    },
    [onSkip],
  )

  if (!active) return null

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="false"
      aria-label="Wulo guidance"
      aria-labelledby={captionId}
      onKeyDown={handleKey}
      data-testid="child-mascot"
    >
      <div className={mergeClasses(styles.card, !reducedMotion && styles.dropIn)}>
        <div className={!reducedMotion ? styles.pulseRing : undefined}>
          <BuddyAvatar avatarValue="wulo" size={120} />
        </div>
        <p id={captionId} className={styles.caption} data-testid="child-mascot-caption">
          {caption}
        </p>
        <div className={styles.srOnly} aria-live="polite" role="status">
          {caption}
        </div>
        <div className={styles.actions}>
          <Button
            ref={primaryRef}
            appearance="primary"
            className={styles.tapTarget}
            onClick={() => onComplete?.()}
            data-testid="child-mascot-primary"
          >
            {primaryCtaLabel}
          </Button>
          {onSkip && (
            <Button
              appearance="subtle"
              className={styles.tapTarget}
              onClick={onSkip}
              data-testid="child-mascot-skip"
            >
              {skipCtaLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
