import { useCallback, useEffect, useMemo, useState } from 'react'
import { makeStyles } from '@fluentui/react-components'
import { XMarkIcon } from '@heroicons/react/24/solid'
import {
  runLearnerVoiceTurn,
  type LearnerVoiceCard,
  type LearnerVoiceTurnRequest,
} from '../api'
import { useTtsPlayer } from '../hooks/useTtsPlayer'
import LearnerTutorFullscreen from './LearnerTutorFullscreen'
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
    background: 'radial-gradient(ellipse at top, #1a1a1d 0%, #050507 70%)',
    color: '#f4f4f6',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '20px 24px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  headerTitle: {
    fontSize: '14px',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.6)',
  },
  closeBtn: {
    width: '40px',
    height: '40px',
    borderRadius: '999px',
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(255,255,255,0.04)',
    color: '#f4f4f6',
    display: 'grid',
    placeItems: 'center',
    cursor: 'pointer',
    ':hover': { background: 'rgba(255,255,255,0.08)' },
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
    color: 'rgba(255,255,255,0.55)',
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
    border: '1px solid rgba(255,255,255,0.16)',
    background: 'rgba(255,255,255,0.08)',
    color: '#f4f4f6',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 700,
    ':hover': { background: 'rgba(255,255,255,0.13)' },
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
    color: 'rgba(255,255,255,0.45)',
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

export interface PracticeFullscreenProps {
  open: boolean
  onClose: () => void
  childId: string
  lang?: string
  exam?: string
  classYear?: string
  subject?: string
}

export function PracticeFullscreen({
  open,
  onClose,
  childId,
  lang,
  exam,
  classYear,
  subject,
}: PracticeFullscreenProps): JSX.Element | null {
  const styles = useStyles()
  const [card, setCard] = useState<LearnerVoiceCard | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessionComplete, setSessionComplete] = useState(false)
  const [tutorOpen, setTutorOpen] = useState(false)
  const {
    supported: ttsSupported,
    playing: ttsPlaying,
    play,
    stop,
  } = useTtsPlayer()

  const requestTurn = useCallback(
    async (
      next: Omit<
        LearnerVoiceTurnRequest,
        'child_id' | 'lang' | 'exam' | 'class_year' | 'subject'
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
    [childId, lang, exam, classYear, subject]
  )

  const handleClose = useCallback(() => {
    stop()
    setTutorOpen(false)
    onClose()
  }, [onClose, stop])

  useEffect(() => {
    if (!card?.card_id) return
    stop()
  }, [card?.card_id, stop])

  // Reset state when the surface opens OR when the chosen taxonomy changes
  // (taxonomy changes flow through `requestTurn`'s identity), so a new
  // exam/class/subject pick starts a fresh walkthrough.
  useEffect(() => {
    if (!open) {
      stop()
      setCard(null)
      setSessionComplete(false)
      setError(null)
      setTutorOpen(false)
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
      if (!card || card.kind !== 'mcq-tap') return
      void requestTurn({
        last_card_id: card.card_id,
        last_kind: 'mcq-tap',
        answer_option_id: optionId,
      })
    },
    [card, requestTurn]
  )

  const handleAdvance = useCallback(() => {
    if (!card) return
    void requestTurn({
      last_card_id: card.card_id,
      last_kind: card.kind,
      advance: true,
    })
  }, [card, requestTurn])

  const statusText = useMemo(() => {
    if (loading) return 'Thinking…'
    if (sessionComplete) return 'All done for today.'
    if (card) return 'Tap an answer to continue.'
    return ''
  }, [loading, sessionComplete, card])

  const speakText = card?.speak?.trim() ?? ''

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
          {speakText && ttsSupported ? (
            <button
              type="button"
              className={styles.listenButton}
              onClick={() => (ttsPlaying ? stop() : void play(speakText))}
              aria-label={ttsPlaying ? 'Stop' : 'Listen'}
              data-testid="practice-listen"
            >
              {ttsPlaying ? 'Stop' : 'Listen 🔊'}
            </button>
          ) : null}
          <button
            type="button"
            className={styles.listenButton}
            onClick={() => setTutorOpen(true)}
            aria-label="Talk to tutor"
            data-testid="practice-talk"
          >
            🎙️ Talk to tutor
          </button>
        </div>
        {error ? (
          <div className={styles.errorBanner} role="alert">
            {error}
          </div>
        ) : null}
        <div className={styles.cardSlot}>
          {card ? (
            <LearnerVoiceCardRenderer
              card={card}
              disabled={loading}
              sessionComplete={sessionComplete}
              onMcqAnswer={handleMcqAnswer}
              onAdvance={handleAdvance}
              onFinish={handleClose}
            />
          ) : null}
        </div>
      </div>
      <footer className={styles.footer}>
        <span className={styles.footerHint}>
          Tap an option to answer · Tap 🔊 to hear it again
        </span>
      </footer>
      {tutorOpen ? (
        <LearnerTutorFullscreen
          open={tutorOpen}
          onClose={() => setTutorOpen(false)}
          childId={childId}
          exam={exam}
          classYear={classYear}
          subject={subject}
        />
      ) : null}
    </dialog>
  )
}

export default PracticeFullscreen
