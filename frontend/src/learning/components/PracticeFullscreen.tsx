import { useCallback, useEffect, useMemo, useState } from 'react'
import { makeStyles } from '@fluentui/react-components'
import { MicrophoneIcon } from '@heroicons/react/24/outline'
import { XMarkIcon } from '@heroicons/react/24/solid'
import {
  runLearnerVoiceTurn,
  type LearnerVoiceCard,
  type LearnerVoiceTurnRequest,
} from '../api'
import { useTtsPlayer } from '../hooks/useTtsPlayer'
import { useLearnerVoiceSession } from '../hooks/useLearnerVoiceSession'
import { LearnerVoiceCardRenderer } from './LearnerVoiceCard'

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
    zIndex: 80,
    background: 'var(--scrim-bg-practice)',
    color: 'var(--scrim-fg)',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '20px 24px',
    borderBottom: '1px solid var(--scrim-line-soft)',
  },
  headerTitle: {
    fontSize: '14px',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--scrim-fg-soft)',
  },
  closeBtn: {
    width: '40px',
    height: '40px',
    borderRadius: '999px',
    border: '1px solid var(--scrim-line-strong)',
    background: 'var(--scrim-chip)',
    color: 'var(--scrim-fg)',
    display: 'grid',
    placeItems: 'center',
    cursor: 'pointer',
    ':hover': { background: 'var(--scrim-chip-hover)' },
  },
  closeGlyph: { width: '20px', height: '20px' },
  body: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'flex-start',
    padding: '32px 24px 24px',
    gap: '24px',
    overflowY: 'auto',
  },
  status: {
    fontSize: '13px',
    color: 'var(--scrim-fg-muted)',
    minHeight: '18px',
  },
  statusRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    flexWrap: 'wrap',
  },
  listenButton: {
    minHeight: '36px',
    padding: '0 14px',
    borderRadius: '999px',
    border: '1px solid var(--scrim-line-strong)',
    background: 'var(--scrim-chip)',
    color: 'var(--scrim-fg)',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 700,
    ':hover': { background: 'var(--scrim-chip-hover)' },
  },
  cardSlot: {
    width: 'min(640px, 100%)',
  },
  footer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
    padding: '24px 24px 36px',
  },
  footerHint: {
    fontSize: '12px',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--scrim-fg-muted)',
  },
  voiceAnswerStrip: {
    width: 'min(640px, 100%)',
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 1fr) auto',
    alignItems: 'center',
    gap: '14px',
    padding: '12px 14px',
    borderRadius: '18px',
    border: '1px solid var(--scrim-line-strong)',
    background: 'var(--scrim-card)',
  },
  voiceMicButton: {
    width: '54px',
    height: '54px',
    borderRadius: '999px',
    border: '1px solid var(--scrim-line-strong)',
    background: 'var(--scrim-mic-bg)',
    color: '#ffffff',
    display: 'grid',
    placeItems: 'center',
    cursor: 'pointer',
    boxShadow: 'var(--scrim-mic-shadow)',
    ':disabled': { opacity: 0.5, cursor: 'not-allowed' },
  },
  voiceMicButtonRecording: {
    boxShadow: 'var(--scrim-mic-recording-shadow)',
  },
  voiceMicGlyph: { width: '22px', height: '22px' },
  voiceIndicator: {
    display: 'grid',
    gap: '3px',
    minWidth: 0,
  },
  voiceIndicatorTitle: {
    fontSize: '13px',
    fontWeight: 800,
    color: 'var(--scrim-fg-strong)',
  },
  voiceIndicatorHint: {
    fontSize: '12px',
    color: 'var(--scrim-fg-muted)',
  },
  voiceLevel: {
    width: '64px',
    height: '8px',
    borderRadius: '999px',
    background: 'var(--scrim-line-strong)',
    overflow: 'hidden',
  },
  voiceLevelFill: {
    display: 'block',
    height: '100%',
    borderRadius: '999px',
    background: 'var(--scrim-fill)',
    transition: 'width 120ms ease',
  },
  errorBanner: {
    background: 'rgba(255, 80, 80, 0.12)',
    border: '1px solid rgba(255, 80, 80, 0.4)',
    color: '#ffc1c1',
    padding: '10px 14px',
    borderRadius: '10px',
    fontSize: '13px',
    width: 'min(640px, 100%)',
  },
})

/** localStorage key for the learner's "read each card aloud" preference. */
const PRACTICE_VOICE_PREF_KEY = 'pf-practice-voice-enabled'

export interface PracticeFullscreenProps {
  open: boolean
  onClose: () => void
  childId: string
  lang?: string
  exam?: string
  classYear?: string
  subject?: string
  /** Optional forced lead skill (goal intake "Start now"). The planner leads
   * with this skill's card when the resolved taxonomy contains it. */
  skillId?: string
}

export function PracticeFullscreen({
  open,
  onClose,
  childId,
  lang,
  exam,
  classYear,
  subject,
  skillId,
}: PracticeFullscreenProps): JSX.Element | null {
  const styles = useStyles()
  const [card, setCard] = useState<LearnerVoiceCard | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessionComplete, setSessionComplete] = useState(false)
  const {
    supported: ttsSupported,
    playing: ttsPlaying,
    play,
    stop,
  } = useTtsPlayer()

  // Voice is ON by default: the tutor reads each card aloud automatically (the
  // learner already gestured to enter practice, so browser autoplay is
  // unlocked). The learner can deactivate voice with the toggle; the choice is
  // persisted so it sticks across cards and visits.
  const [voiceEnabled, setVoiceEnabled] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(PRACTICE_VOICE_PREF_KEY) !== '0'
    } catch {
      return true
    }
  })
  const toggleVoice = useCallback(() => {
    setVoiceEnabled(prev => {
      const next = !prev
      try {
        window.localStorage.setItem(PRACTICE_VOICE_PREF_KEY, next ? '1' : '0')
      } catch {
        /* ignore storage failures — preference is best-effort */
      }
      return next
    })
  }, [])

  const voiceSession = useLearnerVoiceSession({
    open: open && Boolean(childId) && Boolean(card),
    childId,
    exam,
    classYear,
    subject,
    lastCardId: card?.card_id ?? null,
    lastKind: card?.kind ?? null,
    autoStartRecording: false,
    closeOnMicDeniedMs: null,
    startOnOpen: false,
  })
  const voiceCard = voiceSession.card
  const visibleCard = voiceCard ?? card
  const visibleSessionComplete = voiceCard
    ? voiceSession.sessionComplete
    : sessionComplete

  const voiceStateLabel = useMemo(() => {
    if (voiceSession.state === 'connecting') return 'Connecting'
    if (voiceSession.state === 'thinking') return 'Thinking'
    if (voiceSession.state === 'speaking') return 'Speaking'
    if (voiceSession.state === 'error') return 'Voice needs attention'
    return voiceSession.recording ? 'Listening' : 'Ready'
  }, [voiceSession.recording, voiceSession.state])

  const requestTurn = useCallback(
    async (
      next: Omit<
        LearnerVoiceTurnRequest,
        'child_id' | 'lang' | 'exam' | 'class_year' | 'subject' | 'skill_id'
      >
    ) => {
      if (!childId) return
      setLoading(true)
      setError(null)
      try {
        const response = await runLearnerVoiceTurn({
          child_id: childId,
          lang,
          exam: exam ?? null,
          class_year: classYear ?? null,
          subject: subject ?? null,
          skill_id: skillId ?? null,
          ...next,
        })
        setCard(response.card)
        setSessionComplete(response.session_complete)
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'Something went wrong. Please try again.'
        )
      } finally {
        setLoading(false)
      }
    },
    [childId, lang, exam, classYear, subject, skillId]
  )

  const handleClose = useCallback(() => {
    voiceSession.close()
    stop()
    onClose()
  }, [onClose, stop, voiceSession])

  // Read each new card aloud automatically when voice is on. Re-runs when the
  // card changes (new question / explanation) and when the learner flips the
  // voice toggle — so turning voice back on replays the current card, and
  // turning it off stops playback. `play` already stops any prior audio first.
  const cardId = visibleCard?.card_id
  const cardSpeak = visibleCard?.speak
  useEffect(() => {
    const text = cardSpeak?.trim()
    if (!cardId) return
    if (voiceEnabled && ttsSupported && text) {
      void play(text)
    } else {
      stop()
    }
  }, [cardId, cardSpeak, voiceEnabled, ttsSupported, play, stop])

  // Reset state when the surface opens OR when the chosen taxonomy changes
  // (taxonomy changes flow through `requestTurn`'s identity), so a new
  // exam/class/subject pick starts a fresh walkthrough.
  useEffect(() => {
    if (!open) {
      stop()
      setCard(null)
      setSessionComplete(false)
      setError(null)
      return
    }
    setCard(null)
    setSessionComplete(false)
    setError(null)
    void requestTurn({})
  }, [open, requestTurn, stop])

  useEffect(() => () => stop(), [stop])

  useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, handleClose])

  const handleMcqAnswer = useCallback(
    (optionId: string) => {
      if (!visibleCard || visibleCard.kind !== 'mcq-tap') return
      if (voiceCard) {
        voiceSession.sendLearnerReply(
          `I choose option ${optionId}. Previous card: ${visibleCard.card_id}.`
        )
        return
      }
      void requestTurn({
        last_card_id: visibleCard.card_id,
        last_kind: 'mcq-tap',
        answer_option_id: optionId,
      })
    },
    [requestTurn, visibleCard, voiceCard, voiceSession]
  )

  const handleAdvance = useCallback(() => {
    if (!visibleCard) return
    if (voiceCard) {
      voiceSession.sendLearnerReply(
        `Next card please. Previous card: ${visibleCard.card_id}.`
      )
      return
    }
    void requestTurn({
      last_card_id: visibleCard.card_id,
      last_kind: visibleCard.kind,
      advance: true,
    })
  }, [requestTurn, visibleCard, voiceCard, voiceSession])

  const statusText = useMemo(() => {
    if (loading) return 'Thinking…'
    if (visibleSessionComplete) return 'All done for today.'
    if (visibleCard) return 'Tap or speak an answer to continue.'
    return ''
  }, [loading, visibleSessionComplete, visibleCard])

  if (!open) return null

  return (
    <dialog
      open
      className={styles.scrim}
      aria-label="Wulo Academy practice"
      data-testid="practice-fullscreen"
    >
      <header className={styles.header}>
        <span className={styles.headerTitle}>Wulo Academy · practice</span>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={handleClose}
          aria-label="Close practice"
          data-testid="practice-close"
        >
          <XMarkIcon className={styles.closeGlyph} aria-hidden="true" />
        </button>
      </header>
      <div className={styles.body}>
        <div className={styles.statusRow}>
          <div className={styles.status} aria-live="polite">
            {statusText}
          </div>
          {ttsSupported ? (
            <button
              type="button"
              className={styles.listenButton}
              onClick={toggleVoice}
              aria-pressed={voiceEnabled}
              aria-label={voiceEnabled ? 'Turn voice off' : 'Turn voice on'}
              data-testid="practice-voice-toggle"
            >
              {voiceEnabled
                ? ttsPlaying
                  ? '🔊 Speaking…'
                  : '🔊 Voice on'
                : '🔇 Voice off'}
            </button>
          ) : null}
        </div>
        {error ? (
          <div className={styles.errorBanner} role="alert">
            {error}
          </div>
        ) : null}
        <div className={styles.cardSlot} data-testid="practice-card-slot">
          {visibleCard ? (
            <LearnerVoiceCardRenderer
              card={visibleCard}
              disabled={loading || voiceSession.state === 'thinking'}
              sessionComplete={visibleSessionComplete}
              onMcqAnswer={handleMcqAnswer}
              onAdvance={handleAdvance}
              onFinish={handleClose}
            />
          ) : null}
        </div>
      </div>
      <footer className={styles.footer}>
        <div className={styles.voiceAnswerStrip} data-testid="practice-voice-answer">
          <button
            type="button"
            className={`${styles.voiceMicButton} ${voiceSession.recording ? styles.voiceMicButtonRecording : ''}`}
            onClick={() => void voiceSession.toggleRecording()}
            disabled={!card}
            aria-label={voiceSession.recording ? 'Stop voice answer' : 'Answer by voice'}
            data-testid="practice-voice-mic"
          >
            <MicrophoneIcon className={styles.voiceMicGlyph} aria-hidden="true" />
          </button>
          <span className={styles.voiceIndicator}>
            <span
              className={styles.voiceIndicatorTitle}
              data-testid="practice-voice-state"
            >
              {voiceStateLabel}
            </span>
            <span className={styles.voiceIndicatorHint}>
              Speak your answer, or tap an option above
            </span>
          </span>
          <span className={styles.voiceLevel} aria-hidden="true">
            <span
              className={styles.voiceLevelFill}
              style={{ width: `${Math.round(voiceSession.inputLevel * 100)}%` }}
            />
          </span>
        </div>
        {voiceSession.fallback || voiceSession.error ? (
          <div
            className={styles.errorBanner}
            role="alert"
            data-testid="practice-voice-error"
          >
            {voiceSession.fallback ?? voiceSession.error}
          </div>
        ) : null}
        <span className={styles.footerHint}>
          Tap 🔊 to turn the voice on or off
        </span>
      </footer>
    </dialog>
  )
}

export default PracticeFullscreen
