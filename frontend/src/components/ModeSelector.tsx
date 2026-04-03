/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Text, makeStyles, mergeClasses } from '@fluentui/react-components'
import { useEffect, useState } from 'react'

const useStyles = makeStyles({
  wrapper: {
    width: '100%',
    flex: 1,
    minHeight: 0,
    display: 'grid',
    alignContent: 'center',
    justifyItems: 'center',
    background:
      'radial-gradient(ellipse at 50% 0%, rgba(13, 138, 132, 0.22), transparent 52%), linear-gradient(160deg, #e0f2f1 0%, #f1f8f8 40%, #f0f7f7 100%)',
    borderRadius: '0px',
    overflow: 'hidden',
    padding: 'clamp(1rem, 3vw, 2rem)',
  },
  stage: {
    width: 'min(520px, 100%)',
    display: 'grid',
    gap: 'var(--space-lg)',
    justifyItems: 'center',
    textAlign: 'center',
  },
  heroImage: {
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    perspective: '800px',
  },
  /* --- Robot animation phases --- */
  robotImg: {
    width: 'min(180px, 35vw)',
    height: 'auto',
    filter: 'none',
    willChange: 'transform, opacity, filter',
    '@media (prefers-reduced-motion: reduce)': {
      animationDuration: '0.01s !important',
    },
  },
  /* Phase 1: Drop in from above with a tilt */
  robotEntrance: {
    animationName: {
      '0%': { transform: 'translateY(-120px) scale(0.5) rotateX(20deg)', opacity: 0, filter: 'blur(6px)' },
      '60%': { transform: 'translateY(14px) scale(1.06) rotateX(-4deg)', opacity: 1, filter: 'blur(0)' },
      '80%': { transform: 'translateY(-8px) scale(0.97) rotateX(2deg)' },
      '100%': { transform: 'translateY(0) scale(1) rotateX(0)', filter: 'none' },
    },
    animationDuration: '0.9s',
    animationTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
    animationFillMode: 'forwards',
  },
  /* Phase 2: Continuous gentle idle float */
  robotIdle: {
    animationName: {
      '0%, 100%': { transform: 'translateY(0) rotate(0)' },
      '25%': { transform: 'translateY(-6px) rotate(1.5deg)' },
      '75%': { transform: 'translateY(-4px) rotate(-1.5deg)' },
    },
    animationDuration: '3.2s',
    animationTimingFunction: 'ease-in-out',
    animationIterationCount: 'infinite',
  },
  heading: {
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-primary)',
    fontSize: 'clamp(1.5rem, 4.5vw, 2.2rem)',
    fontWeight: '800',
    letterSpacing: '-0.03em',
    lineHeight: 1.1,
    animationName: {
      '0%': { transform: 'translateY(10px)', opacity: 0 },
      '100%': { transform: 'translateY(0)', opacity: 1 },
    },
    animationDuration: '0.5s',
    animationDelay: '0.25s',
    animationFillMode: 'forwards',
    opacity: 0,
  },
  buttons: {
    display: 'flex',
    gap: 'var(--space-md)',
    justifyContent: 'center',
    flexWrap: 'wrap',
    animationName: {
      '0%': { transform: 'translateY(10px)', opacity: 0 },
      '100%': { transform: 'translateY(0)', opacity: 1 },
    },
    animationDuration: '0.5s',
    animationDelay: '0.4s',
    animationFillMode: 'forwards',
    opacity: 0,
  },
  btn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '156px',
    minHeight: '46px',
    paddingInline: 'var(--space-lg)',
    borderRadius: '0px',
    fontFamily: 'var(--font-display)',
    fontSize: '0.92rem',
    fontWeight: '700',
    letterSpacing: '0.03em',
    border: 'none',
    cursor: 'pointer',
    transition: 'transform 0.18s ease, background-color 0.18s ease, border-color 0.18s ease',
    '&:hover': {
      transform: 'translateY(-1px)',
    },
    '&:active': {
      transform: 'translateY(0)',
    },
    '&:focus-visible': {
      outline: '3px solid var(--color-primary)',
      outlineOffset: '3px',
    },
    '&:disabled': {
      opacity: 0.45,
      cursor: 'not-allowed',
      transform: 'none',
    },
  },
  btnChild: {
    backgroundColor: 'var(--color-primary)',
    color: '#fff',
  },
  btnTherapist: {
    backgroundColor: '#fff',
    color: 'var(--color-text-primary)',
    border: '2px solid var(--color-border)',
  },
})

interface Props {
  isTherapist: boolean
  onChooseMode: (mode: 'therapist' | 'child') => void
}

export function ModeSelector({ isTherapist, onChooseMode }: Props) {
  const styles = useStyles()
  const [phase, setPhase] = useState<'entrance' | 'idle'>('entrance')

  useEffect(() => {
    const t = setTimeout(() => setPhase('idle'), 900)
    return () => clearTimeout(t)
  }, [])

  const phaseClass = phase === 'entrance' ? styles.robotEntrance : styles.robotIdle

  return (
    <div className={styles.wrapper}>
      <div className={styles.stage}>
        <div className={styles.heroImage}>
          <img
            src="/wulo-robot.webp"
            alt="Wulo robot mascot"
            className={mergeClasses(styles.robotImg, phaseClass)}
          />
        </div>

        <Text className={styles.heading}>
          Who's practicing today?
        </Text>

        <div className={styles.buttons}>
          <button
            type="button"
            className={mergeClasses(styles.btn, styles.btnChild)}
            onClick={() => onChooseMode('child')}
          >
            I'm a Kid
          </button>
          <button
            type="button"
            className={mergeClasses(styles.btn, styles.btnTherapist)}
            disabled={!isTherapist}
            onClick={() => onChooseMode('therapist')}
          >
            I'm a Therapist
          </button>
        </div>
      </div>
    </div>
  )
}