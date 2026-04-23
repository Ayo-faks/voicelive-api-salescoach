/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Child-mode wrap-up card (REINFORCE beat).
 *
 * Shown after the session auto-wrap timer fires. Renders a celebratory
 * mascot + caption + a single "All done" button. The adult-side caller
 * owns the side effect of calling ``markWrapUpSeen()`` when the child
 * presses the button so the flag is only set once per child.
 */

import {
  Button,
  makeStyles,
  shorthands,
  tokens,
} from '@fluentui/react-components'
import { useEffect, useRef } from 'react'

import { BuddyAvatar } from '../BuddyAvatar'
import { wrapUpCopy } from '../../childOnboarding/copy'
import { useReducedMotion } from '../../childOnboarding/useReducedMotion'

const useStyles = makeStyles({
  overlay: {
    position: 'fixed',
    inset: 0,
    display: 'grid',
    placeItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    zIndex: 1460,
    padding: '24px',
    '@media (forced-colors: active)': {
      backgroundColor: 'Canvas',
    },
  },
  card: {
    maxWidth: '480px',
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    ...shorthands.borderRadius('24px'),
    padding: '32px 24px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '18px',
    textAlign: 'center',
    boxShadow: '0 24px 48px rgba(15, 23, 42, 0.28)',
    '@media (forced-colors: active)': {
      ...shorthands.border('2px', 'solid', 'CanvasText'),
      backgroundColor: 'Canvas',
      color: 'CanvasText',
    },
  },
  dropIn: {
    animationName: {
      '0%': { transform: 'translateY(-24px)', opacity: 0 },
      '100%': { transform: 'translateY(0)', opacity: 1 },
    },
    animationDuration: '0.4s',
    animationTimingFunction: 'ease-out',
    animationFillMode: 'forwards',
  },
  title: {
    margin: 0,
    fontSize: '26px',
    lineHeight: 1.25,
  },
  caption: {
    margin: 0,
    fontSize: '18px',
    lineHeight: 1.4,
  },
  cta: {
    minWidth: '180px',
    minHeight: '56px',
    fontSize: '18px',
  },
  '@media (prefers-reduced-motion: reduce)': {
    dropIn: { animationDuration: '0.01s' },
  },
})

export interface ChildWrapUpCardProps {
  active: boolean
  onComplete: () => void
  reducedMotion?: boolean
}

export function ChildWrapUpCard({
  active,
  onComplete,
  reducedMotion: reducedMotionProp,
}: ChildWrapUpCardProps): JSX.Element | null {
  const styles = useStyles()
  const detected = useReducedMotion()
  const reducedMotion = reducedMotionProp ?? detected
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (active) btnRef.current?.focus()
  }, [active])

  if (!active) return null

  const cardClass = reducedMotion ? styles.card : `${styles.card} ${styles.dropIn}`

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="child-wrapup-title"
      data-testid="child-wrap-up-card"
    >
      <div className={cardClass}>
        <BuddyAvatar avatarValue="wulo" size={120} />
        <h1 id="child-wrapup-title" className={styles.title}>
          {wrapUpCopy.title}
        </h1>
        <p className={styles.caption} data-testid="child-wrap-up-caption">
          {wrapUpCopy.caption}
        </p>
        <Button
          ref={btnRef}
          appearance="primary"
          className={styles.cta}
          onClick={onComplete}
          data-testid="child-wrap-up-done"
        >
          {wrapUpCopy.primaryCta}
        </Button>
      </div>
    </div>
  )
}
