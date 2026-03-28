/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Text, makeStyles } from '@fluentui/react-components'
import { useEffect, useState } from 'react'
import { BuddyAvatar } from './BuddyAvatar'

const useStyles = makeStyles({
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 900,
    display: 'grid',
    alignContent: 'center',
    justifyItems: 'center',
    gap: 'var(--space-lg)',
    background:
      'radial-gradient(circle at 50% 40%, rgba(13,138,132,0.10), transparent 60%), var(--color-bg)',
    opacity: 1,
    transition: 'opacity 0.45s ease-out',
    pointerEvents: 'auto',
  },
  overlayHidden: {
    opacity: 0,
    pointerEvents: 'none',
  },
  avatarWrap: {
    animationName: {
      '0%': { transform: 'scale(0.85)', opacity: 0.4 },
      '50%': { transform: 'scale(1.08)', opacity: 1 },
      '100%': { transform: 'scale(1)', opacity: 1 },
    },
    animationDuration: '0.7s',
    animationTimingFunction: 'cubic-bezier(0.34,1.56,0.64,1)',
    animationFillMode: 'forwards',
    filter: 'drop-shadow(0 20px 40px rgba(13,138,132,0.28))',
  },
  pulseRing: {
    position: 'absolute',
    width: '200px',
    height: '200px',
    borderRadius: '50%',
    border: '3px solid rgba(13,138,132,0.18)',
    animationName: {
      '0%': { transform: 'scale(1)', opacity: 0.6 },
      '100%': { transform: 'scale(1.6)', opacity: 0 },
    },
    animationDuration: '1.8s',
    animationTimingFunction: 'ease-out',
    animationIterationCount: 'infinite',
  },
  avatarContainer: {
    position: 'relative',
    display: 'grid',
    alignItems: 'center',
    justifyItems: 'center',
  },
  textWrap: {
    display: 'grid',
    gap: 'var(--space-xs)',
    textAlign: 'center',
    maxWidth: '280px',
    animationName: {
      '0%': { transform: 'translateY(12px)', opacity: 0 },
      '100%': { transform: 'translateY(0)', opacity: 1 },
    },
    animationDuration: '0.5s',
    animationDelay: '0.3s',
    animationFillMode: 'forwards',
    opacity: 0,
  },
  title: {
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-primary)',
    fontSize: '1.25rem',
    fontWeight: '700',
    letterSpacing: '-0.02em',
  },
  subtitle: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.9rem',
    lineHeight: 1.5,
  },
  dots: {
    display: 'flex',
    gap: '6px',
    justifyContent: 'center',
    animationName: {
      '0%': { opacity: 0 },
      '100%': { opacity: 1 },
    },
    animationDuration: '0.4s',
    animationDelay: '0.6s',
    animationFillMode: 'forwards',
    opacity: 0,
  },
  dot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: 'var(--color-primary)',
  },
  dot1: {
    animationName: {
      '0%, 80%, 100%': { opacity: 0.25, transform: 'scale(0.8)' },
      '40%': { opacity: 1, transform: 'scale(1)' },
    },
    animationDuration: '1.4s',
    animationIterationCount: 'infinite',
    animationDelay: '0s',
  },
  dot2: {
    animationName: {
      '0%, 80%, 100%': { opacity: 0.25, transform: 'scale(0.8)' },
      '40%': { opacity: 1, transform: 'scale(1)' },
    },
    animationDuration: '1.4s',
    animationIterationCount: 'infinite',
    animationDelay: '0.2s',
  },
  dot3: {
    animationName: {
      '0%, 80%, 100%': { opacity: 0.25, transform: 'scale(0.8)' },
      '40%': { opacity: 1, transform: 'scale(1)' },
    },
    animationDuration: '1.4s',
    animationIterationCount: 'infinite',
    animationDelay: '0.4s',
  },
})

interface Props {
  visible: boolean
  avatarValue: string
  avatarName: string
  exerciseName?: string | null
}

export function SessionLaunchOverlay({
  visible,
  avatarValue,
  avatarName,
  exerciseName,
}: Props) {
  const styles = useStyles()
  // Keep mounted during the fade-out transition, then fully unmount
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    if (visible) {
      setMounted(true)
    } else {
      const timer = setTimeout(() => setMounted(false), 500)
      return () => clearTimeout(timer)
    }
  }, [visible])

  if (!mounted) return null

  return (
    <div className={`${styles.overlay} ${!visible ? styles.overlayHidden : ''}`}>
      <div className={styles.avatarContainer}>
        <div className={styles.pulseRing} />
        <div className={styles.avatarWrap}>
          <BuddyAvatar avatarValue={avatarValue} size={160} />
        </div>
      </div>

      <div className={styles.textWrap}>
        <Text className={styles.title}>
          {avatarName} is getting ready
        </Text>
        <Text className={styles.subtitle}>
          {exerciseName
            ? `Setting up ${exerciseName} for you.`
            : 'Setting up your practice session.'}
        </Text>
      </div>

      <div className={styles.dots}>
        <span className={`${styles.dot} ${styles.dot1}`} />
        <span className={`${styles.dot} ${styles.dot2}`} />
        <span className={`${styles.dot} ${styles.dot3}`} />
      </div>
    </div>
  )
}
