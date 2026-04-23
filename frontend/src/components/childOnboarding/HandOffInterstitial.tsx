/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Hand-off interstitial.
 *
 * Gated by the adult caller: render when ``userMode === 'child'`` and
 * ``flags.mascot_seen === false``. On "Start" the caller must call
 * ``markMascotSeen()`` exactly once (so repeat sessions skip the
 * interstitial) and then call ``onComplete()``.
 *
 * This component is deliberately free of telemetry calls — the Phase 4
 * contract is "zero telemetry inside child mode".
 */

import {
  Button,
  makeStyles,
  shorthands,
  tokens,
} from '@fluentui/react-components'
import { useEffect, useRef } from 'react'

import { handoffCopy } from '../../childOnboarding/copy'

const useStyles = makeStyles({
  overlay: {
    position: 'fixed',
    inset: 0,
    display: 'grid',
    placeItems: 'center',
    backgroundColor: tokens.colorNeutralBackground1,
    zIndex: 1450,
    padding: '24px',
  },
  card: {
    maxWidth: '520px',
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    padding: '32px 24px',
    ...shorthands.borderRadius('24px'),
    backgroundColor: tokens.colorNeutralBackground2,
    color: tokens.colorNeutralForeground1,
    '@media (forced-colors: active)': {
      ...shorthands.border('2px', 'solid', 'CanvasText'),
      backgroundColor: 'Canvas',
      color: 'CanvasText',
    },
  },
  title: {
    margin: 0,
    fontSize: '28px',
    lineHeight: 1.25,
  },
  body: {
    margin: 0,
    fontSize: '18px',
    lineHeight: 1.4,
  },
  cta: {
    alignSelf: 'center',
    minWidth: '180px',
    minHeight: '56px',
    fontSize: '18px',
  },
})

export interface HandOffInterstitialProps {
  active: boolean
  onStart: () => void
}

export function HandOffInterstitial({
  active,
  onStart,
}: HandOffInterstitialProps): JSX.Element | null {
  const styles = useStyles()
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (active) btnRef.current?.focus()
  }, [active])

  if (!active) return null

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="handoff-title"
      aria-describedby="handoff-body"
      data-testid="handoff-interstitial"
    >
      <div className={styles.card}>
        <h1 id="handoff-title" className={styles.title}>
          {handoffCopy.title}
        </h1>
        <p id="handoff-body" className={styles.body}>
          {handoffCopy.body}
        </p>
        <Button
          ref={btnRef}
          appearance="primary"
          className={styles.cta}
          onClick={onStart}
          data-testid="handoff-start"
        >
          {handoffCopy.startCta}
        </Button>
      </div>
    </div>
  )
}
