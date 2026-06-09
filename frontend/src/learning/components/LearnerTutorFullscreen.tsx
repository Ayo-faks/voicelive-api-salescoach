import { useCallback, useState } from 'react'
import { makeStyles } from '@fluentui/react-components'
import {
  ArrowsPointingInIcon,
  ArrowsPointingOutIcon,
  MicrophoneIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import type { LearnerFocusItem } from '../contexts/LearnerContext'
import {
  type TutorState,
  type TutorVoiceSnapshot,
  useLearnerVoiceSession,
} from '../hooks/useLearnerVoiceSession'
import { LearnerVoiceCardRenderer } from './LearnerVoiceCard'

export type { TutorState, TutorVoiceSnapshot } from '../hooks/useLearnerVoiceSession'

const useStyles = makeStyles({
  scrim: {
    position: 'fixed',
    inset: 0,
    width: '100%',
    maxWidth: 'none',
    height: '100%',
    maxHeight: 'none',
    margin: 0,
    padding: 0,
    border: 0,
    zIndex: 120,
    background: 'var(--scrim-bg-tutor)',
    color: 'var(--scrim-fg)',
    display: 'grid',
    gridTemplateRows: 'auto 1fr auto',
  },
  floatingPanel: {
    position: 'fixed',
    right: '24px',
    bottom: '24px',
    width: 'min(420px, calc(100vw - 32px))',
    maxHeight: 'min(620px, calc(100vh - 48px))',
    margin: 0,
    padding: 0,
    border: '1px solid var(--pf-line)',
    borderRadius: '18px',
    zIndex: 120,
    background: 'var(--pf-surface)',
    color: 'var(--pf-text)',
    boxShadow: 'var(--pf-shadow-card-elevated)',
    display: 'grid',
    gridTemplateRows: 'auto minmax(0, 1fr) auto',
    overflow: 'hidden',
    '@media (max-width: 540px)': {
      right: '12px',
      left: '12px',
      bottom: '12px',
      width: 'auto',
      maxHeight: 'calc(100vh - 24px)',
    },
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '18px 24px',
    borderBottom: '1px solid var(--scrim-line-soft)',
  },
  floatingHeader: {
    padding: '14px 16px',
    borderBottom: '1px solid var(--pf-line)',
  },
  brand: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '10px',
    fontSize: '0.9rem',
    fontWeight: 800,
  },
  brandDot: {
    width: '9px',
    height: '9px',
    borderRadius: '999px',
    backgroundColor: 'var(--scrim-fill)',
    boxShadow: 'var(--scrim-brand-dot-glow)',
  },
  iconButton: {
    width: '40px',
    height: '40px',
    borderRadius: '999px',
    border: '1px solid var(--scrim-line-strong)',
    background: 'var(--scrim-chip)',
    color: 'var(--scrim-fg-strong)',
    display: 'grid',
    placeItems: 'center',
    cursor: 'pointer',
  },
  floatingIconButton: {
    border: '1px solid var(--pf-line)',
    background: 'var(--pf-surface-muted)',
    color: 'var(--pf-text)',
  },
  headerControls: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
  },
  icon: { width: '19px', height: '19px' },
  body: {
    display: 'grid',
    justifyItems: 'center',
    alignContent: 'start',
    gap: '22px',
    padding: '34px 20px 20px',
    overflowY: 'auto',
  },
  floatingBody: {
    gap: '16px',
    padding: '20px 16px 14px',
  },
  orb: {
    width: 'min(220px, 48vw)',
    aspectRatio: '1',
    borderRadius: '999px',
    background: 'var(--scrim-orb-bg)',
    boxShadow: 'var(--scrim-orb-glow)',
  },
  floatingOrb: {
    width: '112px',
  },
  orbSpeaking: {
    boxShadow: 'var(--scrim-orb-speaking-glow)',
  },
  orbThinking: {
    background: 'var(--scrim-orb-thinking-bg)',
    boxShadow: 'var(--scrim-orb-thinking-glow)',
  },
  orbActive: {
    animationName: {
      '0%, 100%': { transform: 'scale(0.98)' },
      '50%': { transform: 'scale(1.04)' },
    },
    animationDuration: '1400ms',
    animationIterationCount: 'infinite',
    animationTimingFunction: 'ease-in-out',
  },
  status: {
    display: 'grid',
    gap: '6px',
    textAlign: 'center',
  },
  stateTitle: {
    fontSize: '1.32rem',
    fontWeight: 850,
  },
  stateHint: {
    color: 'var(--scrim-fg-soft)',
    fontSize: '0.9rem',
  },
  floatingStateHint: {
    color: 'var(--pf-text-secondary)',
  },
  cardSlot: {
    width: 'min(680px, 100%)',
  },
  fallback: {
    width: 'min(620px, 100%)',
    borderRadius: '14px',
    border: '1px solid var(--pf-line)',
    background: 'var(--pf-status-warn-bg)',
    color: 'var(--pf-status-warn-fg)',
    padding: '13px 15px',
    fontSize: '0.92rem',
    lineHeight: 1.45,
  },
  fallbackError: {
    background: 'var(--pf-status-critical-bg)',
    color: 'var(--pf-status-critical-fg)',
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '14px',
    padding: '18px 24px 30px',
  },
  floatingFooter: {
    padding: '14px 16px 18px',
  },
  micButton: {
    width: '64px',
    height: '64px',
    borderRadius: '999px',
    border: '1px solid var(--scrim-line-strong)',
    background: 'var(--scrim-mic-bg)',
    color: '#fff',
    display: 'grid',
    placeItems: 'center',
    cursor: 'pointer',
    boxShadow: 'var(--scrim-mic-shadow)',
  },
  micButtonRecording: {
    boxShadow: 'var(--scrim-mic-recording-shadow)',
  },
  micGlyph: { width: '25px', height: '25px' },
  level: {
    width: '72px',
    height: '8px',
    borderRadius: '999px',
    background: 'var(--scrim-line-strong)',
    overflow: 'hidden',
  },
  levelFill: {
    display: 'block',
    height: '100%',
    borderRadius: '999px',
    background: 'var(--scrim-fill)',
    transition: 'width 120ms ease',
  },
})

export interface LearnerTutorFullscreenProps {
  open: boolean
  onClose: () => void
  childId: string
  exam?: string
  classYear?: string
  subject?: string
  /**
   * Dig-Deeper focus item the learner arrived on. When present the realtime
   * voice session is anchored and grounded on this question before the first
   * tool call, mirroring the text drawer path.
   */
  focusItem?: LearnerFocusItem | null
  onVoiceStateChange?: (snapshot: TutorVoiceSnapshot) => void
  initialMode?: TutorPresentationMode
}

export type TutorPresentationMode = 'floating' | 'fullscreen'

function stateCopy(state: TutorState, recording: boolean) {
  if (state === 'connecting')
    return { title: 'Connecting', hint: 'Opening your tutor session' }
  if (state === 'thinking')
    return { title: 'Thinking', hint: 'Choosing the next card' }
  if (state === 'speaking')
    return { title: 'Tutor speaking', hint: 'You can answer when ready' }
  if (state === 'error')
    return {
      title: 'Trouble connecting',
      hint: 'Use Listen on cards and try again later',
    }
  return recording
    ? {
        title: 'Listening',
        hint: 'Answer naturally, or tap an option on the card',
      }
    : { title: 'Ready', hint: 'Tap the mic to talk to your tutor' }
}

export function LearnerTutorFullscreen({
  open,
  onClose,
  childId,
  exam,
  classYear,
  subject,
  focusItem,
  onVoiceStateChange,
  initialMode = 'fullscreen',
}: LearnerTutorFullscreenProps): JSX.Element | null {
  const styles = useStyles()
  const [mode, setMode] = useState<TutorPresentationMode>(initialMode)
  const {
    state,
    recording,
    inputLevel,
    card,
    sessionComplete,
    fallback,
    error,
    toggleRecording,
    sendLearnerReply,
    close,
  } = useLearnerVoiceSession({
    open,
    childId,
    exam,
    classYear,
    subject,
    focusItem,
    onClose,
    onVoiceStateChange,
  })

  const handleClose = useCallback(() => {
    close()
  }, [close])

  const floating = mode === 'floating'

  const copy = stateCopy(state, recording)

  if (!open) return null

  return (
    <dialog
      open
      className={floating ? styles.floatingPanel : styles.scrim}
      aria-label="Wulo Academy learner tutor"
      data-testid="learner-tutor"
      data-mode={mode}
    >
      <header
        className={`${styles.header} ${floating ? styles.floatingHeader : ''}`}
      >
        <span className={styles.brand}>
          <span className={styles.brandDot} />
          Wulo Tutor
        </span>
        <span className={styles.headerControls}>
          <button
            type="button"
            className={`${styles.iconButton} ${floating ? styles.floatingIconButton : ''}`}
            onClick={() => setMode(floating ? 'fullscreen' : 'floating')}
            aria-label={floating ? 'Expand tutor' : 'Collapse tutor'}
            data-testid={floating ? 'learner-tutor-expand' : 'learner-tutor-collapse'}
          >
            {floating ? (
              <ArrowsPointingOutIcon className={styles.icon} aria-hidden="true" />
            ) : (
              <ArrowsPointingInIcon className={styles.icon} aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            className={`${styles.iconButton} ${floating ? styles.floatingIconButton : ''}`}
            onClick={handleClose}
            aria-label="Close tutor"
            data-testid="learner-tutor-close"
          >
            <XMarkIcon className={styles.icon} aria-hidden="true" />
          </button>
        </span>
      </header>
      <main className={`${styles.body} ${floating ? styles.floatingBody : ''}`}>
        <div
          className={`${styles.orb} ${floating ? styles.floatingOrb : ''} ${state === 'thinking' ? styles.orbThinking : ''} ${state === 'speaking' ? styles.orbSpeaking : ''} ${recording || state === 'speaking' ? styles.orbActive : ''}`}
          aria-hidden="true"
          data-testid="learner-tutor-orb"
        />
        <div className={styles.status} aria-live="polite">
          <span className={styles.stateTitle}>{copy.title}</span>
          <span
            className={`${styles.stateHint} ${floating ? styles.floatingStateHint : ''}`}
          >
            {copy.hint}
          </span>
        </div>
        {state === 'error' && (fallback || error) ? (
          <div
            className={`${styles.fallback} ${fallback ? '' : styles.fallbackError}`}
            role="alert"
          >
            {fallback ?? error}
          </div>
        ) : null}
        {card ? (
          <div className={styles.cardSlot}>
            <LearnerVoiceCardRenderer
              card={card}
              disabled={state === 'thinking'}
              sessionComplete={sessionComplete}
              onMcqAnswer={optionId =>
                sendLearnerReply(
                  `I choose option ${optionId}. Previous card: ${card.card_id}.`
                )
              }
              onAdvance={() =>
                sendLearnerReply(
                  `Next card please. Previous card: ${card.card_id}.`
                )
              }
              onFinish={handleClose}
            />
          </div>
        ) : null}
      </main>
      <footer className={`${styles.footer} ${floating ? styles.floatingFooter : ''}`}>
        <button
          type="button"
          className={`${styles.micButton} ${recording ? styles.micButtonRecording : ''}`}
          onClick={() => void toggleRecording()}
          aria-label={recording ? 'Stop talking' : 'Talk to tutor'}
          data-testid="learner-tutor-mic"
        >
          <MicrophoneIcon className={styles.micGlyph} aria-hidden="true" />
        </button>
        <span className={styles.level} aria-hidden="true">
          <span
            className={styles.levelFill}
            style={{ width: `${Math.round(inputLevel * 100)}%` }}
          />
        </span>
      </footer>
    </dialog>
  )
}

export default LearnerTutorFullscreen
