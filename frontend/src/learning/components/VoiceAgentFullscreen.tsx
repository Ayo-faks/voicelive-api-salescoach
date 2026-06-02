import { useEffect, useMemo, useRef } from 'react'
import { makeStyles, mergeClasses, Text } from '@fluentui/react-components'
import {
  MicrophoneIcon,
  PauseIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import { useInsightsVoice } from '../../hooks/useInsightsVoice'
import type { InsightsScope, InsightsVoiceState } from '../../types'
import { pathfinderTokens as t } from '../theme/pathfinder-tokens'
import { VoiceAgentDynamicSurface } from './VoiceAgentDynamicSurface'

// Pathfinder is monochrome: no brand accent hues. On the dark fullscreen scrim
// the orb/ring/mic render as a silver-to-graphite gradient rather than teal.
const ORB_HIGHLIGHT = '#ffffff'
const ORB_MID = '#c7c7cc'
const ORB_DEEP = '#1c1c1e'
const RING_STROKE = 'rgba(255,255,255,0.28)'
const RING_GLOW = 'rgba(255,255,255,0.18)'
const MIC_GRADIENT = 'linear-gradient(160deg, #3a3a3c 0%, #0a0a0a 100%)'
const MIC_SHADOW =
  '0 12px 36px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.18)'

interface VoiceAgentFullscreenProps {
  open: boolean
  onClose: () => void
  scope?: InsightsScope
  actionsEnabled?: boolean
  onOpenStudentProfile?: (studentId: string) => void
}

const STATE_COPY: Record<InsightsVoiceState, { title: string; hint: string }> =
  {
    idle: {
      title: 'Ready',
      hint: 'Tap the mic to start — say “end call” to finish',
    },
    connecting: { title: 'Connecting…', hint: 'Securing voice channel' },
    listening: {
      title: 'Listening',
      hint: 'Speak naturally — say “end call” to finish',
    },
    thinking: { title: 'Thinking', hint: 'Reviewing your caseload' },
    speaking: { title: 'Responding', hint: 'Just start talking to interrupt' },
    interrupted: { title: 'Paused', hint: 'Continue when you’re ready' },
    error: { title: 'Trouble connecting', hint: 'Try again or close' },
  }

const useStyles = makeStyles({
  scrim: {
    position: 'fixed',
    inset: 0,
    zIndex: 9999,
    backgroundColor: 'rgba(10, 10, 10, 0.92)',
    backdropFilter: 'blur(28px) saturate(140%)',
    WebkitBackdropFilter: 'blur(28px) saturate(140%)',
    display: 'grid',
    gridTemplateRows: 'auto 1fr auto',
    color: '#ffffff',
    fontFamily: t.font.text,
    animationName: {
      from: { opacity: 0 },
      to: { opacity: 1 },
    },
    animationDuration: '220ms',
    animationTimingFunction: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '20px 28px',
    paddingTop: 'max(20px, env(safe-area-inset-top))',
  },
  brandRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontFamily: t.font.display,
    fontSize: '0.95rem',
    fontWeight: 600,
    letterSpacing: '-0.01em',
    color: 'rgba(255,255,255,0.92)',
  },
  brandDot: {
    width: '8px',
    height: '8px',
    borderRadius: '999px',
    backgroundColor: ORB_HIGHLIGHT,
    boxShadow: `0 0 12px ${RING_GLOW}`,
  },
  iconButton: {
    appearance: 'none',
    display: 'inline-grid',
    placeItems: 'center',
    width: '40px',
    height: '40px',
    borderRadius: '999px',
    border: '1px solid rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    color: '#ffffff',
    cursor: 'pointer',
    transition: 'background-color .15s, transform .15s, border-color .15s',
    ':hover': {
      backgroundColor: 'rgba(255,255,255,0.12)',
      borderTopColor: 'rgba(255,255,255,0.22)',
      borderRightColor: 'rgba(255,255,255,0.22)',
      borderBottomColor: 'rgba(255,255,255,0.22)',
      borderLeftColor: 'rgba(255,255,255,0.22)',
    },
    ':active': { transform: 'scale(0.96)' },
  },
  iconButtonGlyph: { width: '18px', height: '18px' },
  stage: {
    display: 'grid',
    placeItems: 'center',
    gap: '32px',
    padding: '12px 28px',
  },
  orbWrap: {
    position: 'relative',
    width: 'min(320px, 60vmin)',
    height: 'min(320px, 60vmin)',
    display: 'grid',
    placeItems: 'center',
  },
  ring: {
    position: 'absolute',
    inset: 0,
    borderRadius: '999px',
    border: `1px solid ${RING_STROKE}`,
    boxSizing: 'border-box',
    transformOrigin: 'center',
  },
  ringPulse: {
    animationName: {
      '0%': { transform: 'scale(0.6)', opacity: 0.6 },
      '70%': { transform: 'scale(1.35)', opacity: 0 },
      '100%': { transform: 'scale(1.35)', opacity: 0 },
    },
    animationDuration: '2400ms',
    animationIterationCount: 'infinite',
    animationTimingFunction: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
  },
  ringPulse2: {
    animationDelay: '800ms',
  },
  ringPulse3: {
    animationDelay: '1600ms',
  },
  orb: {
    position: 'relative',
    width: '60%',
    height: '60%',
    borderRadius: '999px',
    background: `radial-gradient(circle at 30% 30%, ${ORB_HIGHLIGHT} 0%, ${ORB_MID} 55%, ${ORB_DEEP} 100%)`,
    boxShadow:
      '0 0 40px rgba(255,255,255,0.18), inset 0 0 40px rgba(255,255,255,0.18)',
    transition: 'transform .4s cubic-bezier(0.22, 0.61, 0.36, 1)',
  },
  orbBreathing: {
    animationName: {
      '0%, 100%': { transform: 'scale(1)' },
      '50%': { transform: 'scale(1.05)' },
    },
    animationDuration: '4200ms',
    animationIterationCount: 'infinite',
    animationTimingFunction: 'ease-in-out',
  },
  orbThinking: {
    animationName: {
      '0%, 100%': { transform: 'scale(0.96)' },
      '50%': { transform: 'scale(1.02)' },
    },
    animationDuration: '900ms',
    animationIterationCount: 'infinite',
    animationTimingFunction: 'ease-in-out',
  },
  copyBlock: {
    display: 'grid',
    gap: '8px',
    textAlign: 'center',
    maxWidth: '640px',
  },
  stateTitle: {
    fontFamily: t.font.display,
    fontSize: 'clamp(1.4rem, 2.4vw, 1.8rem)',
    fontWeight: 600,
    letterSpacing: '-0.02em',
    color: '#ffffff',
  },
  stateHint: {
    fontSize: '0.95rem',
    color: 'rgba(255,255,255,0.6)',
  },
  transcript: {
    marginTop: '12px',
    padding: '14px 18px',
    borderRadius: '14px',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.08)',
    fontSize: '0.95rem',
    lineHeight: 1.5,
    color: 'rgba(255,255,255,0.92)',
    maxWidth: '720px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  transcriptLabel: {
    fontSize: '0.7rem',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: 'rgba(255,255,255,0.5)',
    marginBottom: '6px',
  },
  errorBox: {
    marginTop: '12px',
    padding: '12px 16px',
    borderRadius: '12px',
    background: 'rgba(255, 80, 80, 0.12)',
    border: '1px solid rgba(255, 80, 80, 0.32)',
    color: '#ffdede',
    fontSize: '0.9rem',
  },
  controls: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '20px',
    padding: '28px',
    paddingBottom: 'max(28px, env(safe-area-inset-bottom))',
  },
  micButton: {
    appearance: 'none',
    width: '76px',
    height: '76px',
    borderRadius: '999px',
    border: 'none',
    cursor: 'pointer',
    display: 'grid',
    placeItems: 'center',
    color: '#ffffff',
    background: MIC_GRADIENT,
    boxShadow: MIC_SHADOW,
    transition: 'transform .12s ease, box-shadow .15s ease, filter .15s ease',
    ':hover': { filter: 'brightness(1.06)' },
    ':active': { transform: 'scale(0.96)' },
    ':disabled': { opacity: 0.5, cursor: 'not-allowed' },
  },
  micButtonActive: {
    background: 'linear-gradient(160deg, #f54848 0%, #8a1a1a 100%)',
    boxShadow:
      '0 12px 36px rgba(245,72,72,0.45), inset 0 1px 0 rgba(255,255,255,0.25)',
  },
  micGlyph: { width: '28px', height: '28px' },
  secondaryButton: {
    appearance: 'none',
    minHeight: '44px',
    paddingRight: '18px',
    paddingLeft: '18px',
    borderRadius: '999px',
    border: '1px solid rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    color: '#ffffff',
    font: 'inherit',
    fontSize: '0.88rem',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'background-color .15s, border-color .15s',
    ':hover': {
      backgroundColor: 'rgba(255,255,255,0.12)',
      borderTopColor: 'rgba(255,255,255,0.22)',
      borderRightColor: 'rgba(255,255,255,0.22)',
      borderBottomColor: 'rgba(255,255,255,0.22)',
      borderLeftColor: 'rgba(255,255,255,0.22)',
    },
    ':disabled': { opacity: 0.5, cursor: 'not-allowed' },
  },
  srOnly: {
    position: 'absolute',
    width: '1px',
    height: '1px',
    padding: '0',
    margin: '-1px',
    overflow: 'hidden',
    clip: 'rect(0,0,0,0)',
    whiteSpace: 'nowrap',
    borderTopWidth: '0',
    borderRightWidth: '0',
    borderBottomWidth: '0',
    borderLeftWidth: '0',
  },
})

export function VoiceAgentFullscreen({
  open,
  onClose,
  scope = { type: 'caseload' },
  actionsEnabled = false,
  onOpenStudentProfile,
}: VoiceAgentFullscreenProps) {
  const styles = useStyles()
  const closeRef = useRef<HTMLButtonElement>(null)

  // Refs declared up-front so the onEndCallRequested closure below can dispatch
  // to whichever endSession/onClose are current, without re-subscribing.
  const endSessionRef = useRef<(() => void) | null>(null)
  const onCloseRef = useRef(onClose)

  const {
    voiceState,
    start,
    stop,
    interrupt,
    endSession,
    lastTranscript,
    lastAnswer,
    lastError,
    lastUiSpecs,
    lastActionSuggestions,
  } = useInsightsVoice({
    scope,
    mode: 'full_duplex',
    onEndCallRequested: () => {
      endSessionRef.current?.()
      onCloseRef.current?.()
    },
  })

  // Auto-close cleanup: when overlay closes/unmounts, end the session.
  // Pin endSession via a ref so the effect does not re-run when the callback
  // identity churns mid-handshake (which would otherwise close the WebSocket
  // before it finishes opening and surface a 1006 "couldn't connect" banner).
  useEffect(() => {
    endSessionRef.current = endSession
  }, [endSession])
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])
  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    return () => {
      endSessionRef.current?.()
    }
  }, [open])

  // ESC to close
  useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  const copy = useMemo(
    () => STATE_COPY[voiceState] ?? STATE_COPY.idle,
    [voiceState]
  )
  const isActive = voiceState === 'listening' || voiceState === 'speaking'
  const isThinking = voiceState === 'thinking' || voiceState === 'connecting'
  const isBusy = voiceState === 'connecting'

  const handleMic = () => {
    if (
      voiceState === 'idle' ||
      voiceState === 'error' ||
      voiceState === 'interrupted'
    ) {
      void start()
      return
    }
    if (voiceState === 'speaking') {
      interrupt()
      return
    }
    if (voiceState === 'listening') {
      stop()
      return
    }
  }

  const handleEndCall = () => {
    endSession()
    onClose()
  }

  if (!open) return null

  return (
    <div
      className={styles.scrim}
      role="dialog"
      aria-modal="true"
      aria-label="Wulo Academy voice assistant"
      data-testid="voice-agent-fullscreen"
    >
      <header className={styles.header}>
        <div className={styles.brandRow}>
          <span className={styles.brandDot} aria-hidden="true" />
          Pathfinder voice
        </div>
        <button
          ref={closeRef}
          type="button"
          className={styles.iconButton}
          onClick={handleEndCall}
          aria-label="Close voice assistant"
          data-testid="voice-agent-close"
        >
          <XMarkIcon className={styles.iconButtonGlyph} aria-hidden="true" />
        </button>
      </header>

      <section className={styles.stage} aria-live="polite">
        <div className={styles.orbWrap}>
          {isActive && (
            <>
              <span
                className={mergeClasses(styles.ring, styles.ringPulse)}
                aria-hidden="true"
              />
              <span
                className={mergeClasses(
                  styles.ring,
                  styles.ringPulse,
                  styles.ringPulse2
                )}
                aria-hidden="true"
              />
              <span
                className={mergeClasses(
                  styles.ring,
                  styles.ringPulse,
                  styles.ringPulse3
                )}
                aria-hidden="true"
              />
            </>
          )}
          <div
            className={mergeClasses(
              styles.orb,
              isThinking ? styles.orbThinking : styles.orbBreathing
            )}
            aria-hidden="true"
          />
        </div>

        <div className={styles.copyBlock}>
          <Text className={styles.stateTitle}>{copy.title}</Text>
          <Text className={styles.stateHint}>{copy.hint}</Text>
        </div>

        {(lastTranscript || lastAnswer) && (
          <div
            className={styles.transcript}
            data-testid="voice-agent-transcript"
          >
            {lastAnswer ? (
              <>
                <div className={styles.transcriptLabel}>Wulo Academy</div>
                {lastAnswer}
              </>
            ) : (
              <>
                <div className={styles.transcriptLabel}>You</div>
                {lastTranscript}
              </>
            )}
          </div>
        )}

        {lastError && (
          <div className={styles.errorBox} role="alert">
            {lastError}
          </div>
        )}

        <VoiceAgentDynamicSurface
          uiSpecs={lastUiSpecs}
          actionSuggestions={lastActionSuggestions}
          actionsEnabled={actionsEnabled}
          onOpenStudentProfile={onOpenStudentProfile}
        />
      </section>

      <footer className={styles.controls}>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={handleEndCall}
          data-testid="voice-agent-end"
        >
          End
        </button>

        <button
          type="button"
          className={mergeClasses(
            styles.micButton,
            isActive && styles.micButtonActive
          )}
          onClick={handleMic}
          disabled={isBusy}
          aria-label={isActive ? 'Stop listening' : 'Start listening'}
          data-testid="voice-agent-mic"
        >
          {voiceState === 'listening' ? (
            <PauseIcon className={styles.micGlyph} aria-hidden="true" />
          ) : (
            <MicrophoneIcon className={styles.micGlyph} aria-hidden="true" />
          )}
        </button>

        <button
          type="button"
          className={styles.secondaryButton}
          onClick={() => {
            if (voiceState === 'speaking') interrupt()
            else stop()
          }}
          disabled={voiceState === 'idle' || voiceState === 'connecting'}
          data-testid="voice-agent-interrupt"
        >
          Interrupt
        </button>
      </footer>
    </div>
  )
}

export default VoiceAgentFullscreen
