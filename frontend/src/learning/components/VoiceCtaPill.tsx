import { makeStyles } from '@fluentui/react-components'
import { useEffect, useState } from 'react'
import { pathfinderTokens as t } from '../theme/pathfinder-tokens'
import type { TutorVoiceSnapshot } from './LearnerTutorFullscreen'

const useStyles = makeStyles({
  voicePill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    paddingTop: '6px',
    paddingBottom: '6px',
    paddingLeft: '12px',
    paddingRight: '12px',
    borderRadius: t.radius.pill,
    backgroundColor: 'rgba(255,255,255,0.92)',
    color: 'var(--pf-text)',
    fontSize: '0.78rem',
    fontWeight: 700,
    letterSpacing: '0.01em',
    boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
    pointerEvents: 'none',
  },
  voicePillDot: {
    width: '6px',
    height: '6px',
    borderRadius: '999px',
    backgroundColor: 'var(--pf-text)',
  },
  voiceWave: {
    display: 'inline-flex',
    alignItems: 'flex-end',
    gap: '2px',
    height: '14px',
  },
  voiceWaveBar: {
    width: '2.5px',
    borderRadius: '2px',
    backgroundColor: 'var(--pf-text)',
    animationName: {
      '0%, 100%': { transform: 'scaleY(0.4)' },
      '50%': { transform: 'scaleY(1)' },
    },
    animationDuration: '900ms',
    animationIterationCount: 'infinite',
    animationTimingFunction: 'ease-in-out',
    transformOrigin: 'bottom',
    '@media (prefers-reduced-motion: reduce)': {
      animationName: 'none',
      transform: 'scaleY(0.6)',
    },
  },
  voicePulse: {
    width: '8px',
    height: '8px',
    borderRadius: '999px',
    backgroundColor: 'var(--pf-text)',
    animationName: {
      '0%, 100%': { opacity: 0.4, transform: 'scale(0.85)' },
      '50%': { opacity: 1, transform: 'scale(1.15)' },
    },
    animationDuration: '1200ms',
    animationIterationCount: 'infinite',
    animationTimingFunction: 'ease-in-out',
    '@media (prefers-reduced-motion: reduce)': {
      animationName: 'none',
      opacity: 1,
      transform: 'none',
    },
  },
  voiceStaticDots: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '3px',
  },
  voiceStaticDot: {
    width: '4px',
    height: '4px',
    borderRadius: '999px',
    backgroundColor: 'var(--pf-text)',
  },
})

export type VoiceCtaPillProps = {
  state: TutorVoiceSnapshot['state']
  level: number
}

export const VOICE_PILL_ANNOUNCE_DELAY_MS = 800

export function VoiceCtaPill({ state, level }: VoiceCtaPillProps): JSX.Element {
  const styles = useStyles()
  const reduceMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  let label = 'Tap to start'
  let kind: 'dot' | 'wave' | 'pulse' = 'dot'
  if (state === 'connecting') {
    label = 'Connecting…'
    kind = 'pulse'
  } else if (state === 'listening') {
    label = 'Listening…'
    kind = 'wave'
  } else if (state === 'thinking') {
    label = 'Thinking…'
    kind = 'pulse'
  } else if (state === 'speaking') {
    label = 'Tutor speaking'
    kind = 'pulse'
  } else if (state === 'error') {
    label = 'Try again'
    kind = 'dot'
  }

  // Debounce live-region announcements so screen readers aren't spammed when
  // the underlying voice state flips rapidly (e.g. listening↔thinking).
  const [announcedLabel, setAnnouncedLabel] = useState(label)
  useEffect(() => {
    const handle = window.setTimeout(
      () => setAnnouncedLabel(label),
      VOICE_PILL_ANNOUNCE_DELAY_MS,
    )
    return () => window.clearTimeout(handle)
  }, [label])

  return (
    <output
      className={styles.voicePill}
      data-testid="voice-cta-pill"
      data-state={state}
    >
      {kind === 'wave' ? (
        reduceMotion ? (
          <span className={styles.voiceStaticDots} aria-hidden="true">
            <span className={styles.voiceStaticDot} />
            <span className={styles.voiceStaticDot} />
            <span className={styles.voiceStaticDot} />
          </span>
        ) : (
          <span className={styles.voiceWave} aria-hidden="true">
            {[0, 1, 2].map((i) => {
              const base = 0.5 + Math.min(1, level) * 0.5
              const heights = [base * 10, base * 14, base * 8]
              return (
                <span
                  key={i}
                  className={styles.voiceWaveBar}
                  style={{
                    height: `${heights[i]}px`,
                    animationDelay: `${i * 120}ms`,
                  }}
                />
              )
            })}
          </span>
        )
      ) : kind === 'pulse' ? (
        <span className={styles.voicePulse} aria-hidden="true" />
      ) : (
        <span className={styles.voicePillDot} aria-hidden="true" />
      )}
      <span aria-hidden="true">{label}</span>
      <span
        role="status"
        aria-live="polite"
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: 'hidden',
          clip: 'rect(0 0 0 0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        {announcedLabel}
      </span>
    </output>
  )
}

export default VoiceCtaPill
