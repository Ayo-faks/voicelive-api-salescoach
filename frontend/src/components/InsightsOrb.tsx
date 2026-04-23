/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useMemo, useState } from 'react'
import { makeStyles, mergeClasses, Text, tokens } from '@fluentui/react-components'
import type { InsightsVoiceState } from '../types'

const STATE_LABELS: Record<InsightsVoiceState, string> = {
  idle: 'Idle — tap the microphone to speak',
  connecting: 'Connecting',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
  interrupted: 'Interrupted — ready to listen again',
  error: 'Voice error — please try again',
}

// Baseline radius and swing per state. The orb is always visible at rest.
const BASE_SCALE = 1
const LISTENING_SWING = 0.35 // up to +35% scale at peak input level
const SPEAKING_SWING = 0.28
const THINKING_SWING = 0.08 // small breathing motion
const INTERRUPTED_SCALE = 0.92

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: '10px',
    padding: '16px 12px',
  },
  orbFrame: {
    position: 'relative',
    width: '96px',
    height: '96px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '50%',
  },
  orb: {
    width: '72px',
    height: '72px',
    borderRadius: '50%',
    background:
      'radial-gradient(circle at 35% 30%, var(--chart-primary-light, #20a39e), var(--chart-primary, #0d8a84) 55%, var(--chart-primary-dark, #06625e) 100%)',
    boxShadow: '0 6px 20px rgba(13, 138, 132, 0.32)',
    transformOrigin: 'center',
    transition: 'transform 120ms ease-out, opacity 160ms ease-out, box-shadow 160ms ease-out',
    willChange: 'transform',
  },
  orbIdle: {
    opacity: 0.75,
  },
  orbListening: {
    boxShadow: '0 8px 28px rgba(13, 138, 132, 0.48)',
  },
  orbThinking: {
    // Slow shimmer is expressed via animation on the halo, not the orb itself.
    opacity: 0.88,
  },
  orbSpeaking: {
    boxShadow: '0 10px 32px rgba(184, 148, 85, 0.42)',
    background:
      'radial-gradient(circle at 35% 30%, #e6c98a, var(--chart-warning, #b89455) 55%, #8a6a37 100%)',
  },
  orbInterrupted: {
    opacity: 0.55,
    background:
      'radial-gradient(circle at 35% 30%, #c8c8c8, #8a8a8a 55%, #555 100%)',
    boxShadow: 'none',
  },
  orbError: {
    background:
      'radial-gradient(circle at 35% 30%, #f1a79a, #c85a4a 55%, #8a2a1c 100%)',
    boxShadow: '0 6px 20px rgba(200, 90, 74, 0.32)',
    opacity: 0.9,
  },
  halo: {
    position: 'absolute',
    inset: 0,
    borderRadius: '50%',
    border: '2px solid rgba(13, 138, 132, 0.25)',
    pointerEvents: 'none',
    opacity: 0,
    transition: 'opacity 160ms ease-out, transform 160ms ease-out',
  },
  haloActive: {
    opacity: 1,
  },
  haloThinking: {
    animationName: {
      '0%': { transform: 'scale(1)', opacity: 0.55 },
      '50%': { transform: 'scale(1.12)', opacity: 0.95 },
      '100%': { transform: 'scale(1)', opacity: 0.55 },
    },
    animationDuration: '2400ms',
    animationIterationCount: 'infinite',
    animationTimingFunction: 'ease-in-out',
  },
  stateLabel: {
    color: 'var(--color-text-secondary)',
    fontSize: '12px',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  transcript: {
    maxWidth: '320px',
    textAlign: 'center',
    color: 'var(--color-text-primary)',
    minHeight: '1.25em',
  },
  interruptButton: {
    borderTopWidth: '1px',
    borderRightWidth: '1px',
    borderBottomWidth: '1px',
    borderLeftWidth: '1px',
    borderTopStyle: 'solid',
    borderRightStyle: 'solid',
    borderBottomStyle: 'solid',
    borderLeftStyle: 'solid',
    borderTopColor: tokens.colorNeutralStroke2,
    borderRightColor: tokens.colorNeutralStroke2,
    borderBottomColor: tokens.colorNeutralStroke2,
    borderLeftColor: tokens.colorNeutralStroke2,
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground2,
    color: tokens.colorNeutralForeground1,
    padding: '6px 12px',
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    cursor: 'pointer',
    ':hover': {
      backgroundColor: tokens.colorNeutralBackground3,
    },
  },
  transcriptEmpty: {
    color: 'var(--color-text-secondary)',
    fontStyle: 'italic',
  },
  srOnly: {
    position: 'absolute',
    width: '1px',
    height: '1px',
    padding: 0,
    margin: '-1px',
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    whiteSpace: 'nowrap',
    border: 0,
  },
})

export interface InsightsOrbProps {
  /** Current voice-pipeline state. */
  state: InsightsVoiceState
  /** Microphone input level, 0..1. Only used visually while `state === 'listening'`. */
  inputLevel?: number
  /** TTS playback level, 0..1. Only used visually while `state === 'speaking'`. */
  outputLevel?: number
  /** Live (or partial) transcript to render beneath the orb. */
  transcript?: string
  /**
   * Force reduced-motion. When omitted, the component reads
   * `matchMedia('(prefers-reduced-motion: reduce)')` once on mount.
   */
  reducedMotion?: boolean
  /** Optional extra aria-label context, e.g. the child name. */
  ariaLabel?: string
  /** Optional interrupt/stop action rendered beneath the orb while active. */
  onInterrupt?: () => void
  /** Optional label for the interrupt action. */
  interruptLabel?: string
  /** Optional explicit session-end action rendered beneath the orb while active. */
  onEndSession?: () => void
  /** Optional label for the session-end action. */
  endSessionLabel?: string
}

/**
 * Insights rail orb. Purely presentational — never opens a microphone.
 * The caller owns audio capture and passes levels in as props. The orb
 * renders a calm gradient sphere that scales with level while listening,
 * shimmers slowly while thinking, blooms while speaking, and always
 * shows a transcript region below for accessibility.
 */
export function InsightsOrb({
  state,
  inputLevel,
  outputLevel,
  transcript,
  reducedMotion,
  ariaLabel,
  onInterrupt,
  interruptLabel = 'Stop voice',
  onEndSession,
  endSessionLabel = 'End voice session',
}: InsightsOrbProps) {
  const styles = useStyles()
  const prefersReducedMotionFromOs = usePrefersReducedMotion()
  const effectiveReducedMotion = reducedMotion ?? prefersReducedMotionFromOs

  const clampedInput = clampLevel(inputLevel)
  const clampedOutput = clampLevel(outputLevel)

  const scale = useMemo(() => {
    if (effectiveReducedMotion) return BASE_SCALE
    switch (state) {
      case 'connecting':
        return BASE_SCALE + THINKING_SWING / 2
      case 'listening':
        return BASE_SCALE + LISTENING_SWING * clampedInput
      case 'speaking':
        return BASE_SCALE + SPEAKING_SWING * clampedOutput
      case 'thinking':
        return BASE_SCALE + THINKING_SWING
      case 'interrupted':
        return INTERRUPTED_SCALE
      default:
        return BASE_SCALE
    }
  }, [state, clampedInput, clampedOutput, effectiveReducedMotion])

  const orbStateClass =
    state === 'idle'
      ? styles.orbIdle
      : state === 'connecting'
      ? styles.orbThinking
      : state === 'listening'
      ? styles.orbListening
      : state === 'thinking'
      ? styles.orbThinking
      : state === 'speaking'
      ? styles.orbSpeaking
      : state === 'interrupted'
      ? styles.orbInterrupted
      : styles.orbError

  const showHalo =
    state === 'connecting' || state === 'listening' || state === 'speaking' || state === 'thinking'
  const haloAnimates = (state === 'connecting' || state === 'thinking') && !effectiveReducedMotion

  const haloClassName = mergeClasses(
    styles.halo,
    showHalo ? styles.haloActive : undefined,
    haloAnimates ? styles.haloThinking : undefined,
  )

  const orbClassName = mergeClasses(styles.orb, orbStateClass)
  const composedAriaLabel = ariaLabel
    ? `${STATE_LABELS[state]} — ${ariaLabel}`
    : STATE_LABELS[state]
  const showInterruptButton = typeof onInterrupt === 'function'
  const showEndSessionButton = typeof onEndSession === 'function'

  return (
    <div
      className={styles.root}
      data-testid="insights-orb"
      data-state={state}
      data-reduced-motion={effectiveReducedMotion ? 'true' : 'false'}
    >
      <div
        className={styles.orbFrame}
        role="img"
        aria-label={composedAriaLabel}
        aria-live="polite"
        aria-atomic="true"
      >
        <div className={haloClassName} aria-hidden="true" />
        <div
          className={orbClassName}
          aria-hidden="true"
          style={{ transform: `scale(${scale.toFixed(3)})` }}
          data-testid="insights-orb-sphere"
        />
        <span className={styles.srOnly} data-testid="insights-orb-state-sr">
          {STATE_LABELS[state]}
        </span>
      </div>
      <Text className={styles.stateLabel} aria-hidden="true">
        {state}
      </Text>
      <Text
        className={mergeClasses(
          styles.transcript,
          transcript && transcript.trim().length > 0 ? undefined : styles.transcriptEmpty,
        )}
        aria-live="polite"
        data-testid="insights-orb-transcript"
      >
        {transcript && transcript.trim().length > 0
          ? transcript
          : state === 'connecting'
          ? 'Connecting...'
          : state === 'listening'
          ? 'Listening…'
          : 'Transcript will appear here.'}
      </Text>
      {showInterruptButton || showEndSessionButton ? (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
          {showInterruptButton ? (
            <button
              type="button"
              className={styles.interruptButton}
              onClick={onInterrupt}
              data-testid="insights-orb-interrupt"
            >
              {interruptLabel}
            </button>
          ) : null}
          {showEndSessionButton ? (
            <button
              type="button"
              className={styles.interruptButton}
              onClick={onEndSession}
              data-testid="insights-orb-end-session"
            >
              {endSessionLabel}
            </button>
          ) : null}
        </div>
      ) : null}
      {/* tokens import is kept for potential theme-aware styling; reference to avoid unused-import lint: */}
      <span data-testid="insights-orb-token-ref" style={{ display: 'none' }}>
        {tokens.borderRadiusCircular}
      </span>
    </div>
  )
}

function clampLevel(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

function usePrefersReducedMotion(): boolean {
  const [prefersReduced, setPrefersReduced] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false
    }
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    } catch {
      return false
    }
  })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }
    let mql: MediaQueryList
    try {
      mql = window.matchMedia('(prefers-reduced-motion: reduce)')
    } catch {
      return
    }
    const handler = (event: MediaQueryListEvent) => setPrefersReduced(event.matches)
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', handler)
      return () => mql.removeEventListener('change', handler)
    }
    // Legacy Safari
    if (typeof mql.addListener === 'function') {
      mql.addListener(handler)
      return () => mql.removeListener(handler)
    }
    return
  }, [])

  return prefersReduced
}
