/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Text, makeStyles, mergeClasses } from '@fluentui/react-components'
import { useEffect, useState, useRef } from 'react'
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
      'radial-gradient(circle at 50% 34%, rgba(13,138,132,0.14), transparent 56%), rgba(241, 247, 247, 0.96)',
    opacity: 1,
    transition: 'opacity 0.38s ease-out',
    pointerEvents: 'auto',
    padding: '24px',
  },
  overlayHidden: {
    opacity: 0,
    pointerEvents: 'none',
  },
  stage: {
    width: 'min(820px, calc(100vw - 48px))',
    aspectRatio: '16 / 9',
    borderRadius: '28px',
    overflow: 'hidden',
    display: 'grid',
    alignContent: 'space-between',
    justifyItems: 'center',
    padding: 'var(--space-lg)',
    background:
      'radial-gradient(circle at top, rgba(13, 138, 132, 0.18), transparent 34%), radial-gradient(circle at bottom, rgba(13, 138, 132, 0.1), transparent 36%), linear-gradient(180deg, rgba(244, 247, 248, 0.98), rgba(232, 243, 244, 0.96))',
    border: '1px solid rgba(13, 138, 132, 0.12)',
    boxShadow: '0 26px 70px rgba(17, 36, 58, 0.12)',
    transform: 'translateY(0) scale(1)',
    transition: 'transform 0.44s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.38s ease-out',
    '@media (max-width: 720px)': {
      width: 'calc(100vw - 24px)',
      minHeight: 'min(76vh, 560px)',
      aspectRatio: 'auto',
      padding: 'var(--space-md)',
      borderRadius: '24px',
    },
  },
  stageHidden: {
    transform: 'translateY(18px) scale(0.985)',
    opacity: 0.94,
  },
  statusBadge: {
    justifySelf: 'start',
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: '34px',
    paddingInline: '12px',
    borderRadius: '4px',
    backgroundColor: 'rgba(255,255,255,0.9)',
    color: 'var(--color-primary-dark)',
    border: '1px solid rgba(13, 138, 132, 0.16)',
    boxShadow: '0 10px 20px rgba(13, 138, 132, 0.12)',
    fontSize: '0.8rem',
    fontWeight: '700',
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
    filter: 'none',
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
    alignSelf: 'center',
  },
  textWrap: {
    display: 'grid',
    gap: 'var(--space-xs)',
    textAlign: 'center',
    maxWidth: '320px',
    minHeight: '3.6rem',
    alignContent: 'center',
    marginTop: 'var(--space-md)',
  },
  textLine: {
    transition: 'opacity 0.4s ease-out, transform 0.4s ease-out',
    opacity: 1,
    transform: 'translateY(0)',
  },
  textLineHidden: {
    opacity: 0,
    transform: 'translateY(8px)',
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
  promptCard: {
    width: 'min(100%, 520px)',
    padding: 'var(--space-md)',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'rgba(255,255,255,0.84)',
    border: '1px solid rgba(13, 138, 132, 0.12)',
    boxShadow: 'var(--shadow-sm)',
    display: 'grid',
    gap: '4px',
  },
  promptLabel: {
    color: 'var(--color-text-tertiary)',
    fontSize: '0.72rem',
    fontWeight: '700',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  },
  promptText: {
    color: 'var(--color-text-primary)',
    fontSize: '0.875rem',
    lineHeight: 1.55,
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
  cancelButton: {
    position: 'absolute',
    top: '16px',
    right: '16px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '34px',
    paddingInline: '14px',
    borderRadius: '8px',
    border: '1px solid rgba(13, 138, 132, 0.2)',
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    color: 'var(--color-text-secondary)',
    fontSize: '0.8rem',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'background-color 0.2s, color 0.2s',
    ':hover': {
      backgroundColor: 'rgba(255, 255, 255, 1)',
      color: 'var(--color-text-primary)',
    },
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
  childName?: string | null
  exercisePrompt?: string | null
  onCancel?: () => void
}

export function SessionLaunchOverlay({
  visible,
  avatarValue,
  avatarName,
  exerciseName: _exerciseName,
  childName: _childName,
  exercisePrompt: _exercisePrompt,
  onCancel,
}: Props) {
  const styles = useStyles()
  // Keep mounted during the fade-out transition, then fully unmount
  const [mounted, setMounted] = useState(false)
  const [phraseIndex, setPhraseIndex] = useState(0)
  const [phraseVisible, setPhraseVisible] = useState(true)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const phrases = [
    `${avatarName} is getting ready`,
    'Hold on for a moment',
    'Almost there',
  ]

  useEffect(() => {
    if (visible) {
      setMounted(true)
      setPhraseIndex(0)
      setPhraseVisible(true)
    } else {
      const timer = setTimeout(() => setMounted(false), 500)
      return () => clearTimeout(timer)
    }
  }, [visible])

  useEffect(() => {
    if (!visible) return

    timerRef.current = setTimeout(() => {
      setPhraseVisible(false)

      timerRef.current = setTimeout(() => {
        setPhraseIndex(i => (i + 1) % phrases.length)
        setPhraseVisible(true)
      }, 400)
    }, 2400)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [visible, phraseIndex, phrases.length])

  if (!mounted) return null

  return (
    <div className={mergeClasses(styles.overlay, !visible && styles.overlayHidden)}>
      <div className={mergeClasses(styles.stage, !visible && styles.stageHidden)}>
        <div className={styles.statusBadge}>Preparing live session</div>
        {onCancel && (
          <button className={styles.cancelButton} onClick={onCancel} type="button">
            ✕ Cancel
          </button>
        )}

        <div className={styles.avatarContainer}>
          <div className={styles.pulseRing} />
          <div className={styles.avatarWrap}>
            <BuddyAvatar avatarValue={avatarValue} size={160} />
          </div>
        </div>

        <div className={styles.textWrap}>
          <Text
            className={mergeClasses(
              styles.title,
              styles.textLine,
              !phraseVisible && styles.textLineHidden
            )}
          >
            {phrases[phraseIndex]}
          </Text>
        </div>

        <div className={styles.dots}>
          <span className={mergeClasses(styles.dot, styles.dot1)} />
          <span className={mergeClasses(styles.dot, styles.dot2)} />
          <span className={mergeClasses(styles.dot, styles.dot3)} />
        </div>
      </div>
    </div>
  )
}
