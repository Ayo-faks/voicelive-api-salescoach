/**
 * LearnerVoiceFullscreen — fullscreen voice + gen-UI surface for learners.
 *
 * Distinct from the therapist `VoiceAgentFullscreen`, which is role-locked
 * to clinicians and talks to the caseload-scoped insights websocket. This
 * surface renders the learner card vocabulary (`mcq-tap`, `explanation`,
 * `progress`, `mark-known`) returned by `/api/learning/voice/turn`. Phase
 * 2.0 ships the tap path with a disabled mic; the realtime transport
 * lands in phase 2.1 behind the same feature flag.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { makeStyles, mergeClasses } from '@fluentui/react-components'
import { MicrophoneIcon, XMarkIcon } from '@heroicons/react/24/solid'
import {
  runLearnerVoiceTurn,
  type LearnerVoiceCard,
  type LearnerVoiceTurnRequest,
} from '../api'
import { LearnerVoiceCardRenderer } from './LearnerVoiceCard'

const useStyles = makeStyles({
  scrim: {
    position: 'fixed',
    inset: 0,
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
  micButton: {
    width: '88px',
    height: '88px',
    borderRadius: '999px',
    border: 'none',
    color: '#ffffff',
    cursor: 'not-allowed',
    display: 'grid',
    placeItems: 'center',
    background: 'linear-gradient(160deg, #4a4a4d 0%, #0a0a0a 100%)',
    boxShadow: '0 16px 48px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.18)',
    opacity: 0.55,
  },
  micGlyph: { width: '36px', height: '36px' },
  micHint: {
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

export interface LearnerVoiceFullscreenProps {
  open: boolean
  onClose: () => void
  childId: string
  lang?: string
}

export function LearnerVoiceFullscreen({
  open,
  onClose,
  childId,
  lang,
}: LearnerVoiceFullscreenProps): JSX.Element | null {
  const styles = useStyles()
  const [card, setCard] = useState<LearnerVoiceCard | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessionComplete, setSessionComplete] = useState(false)
  const initializedRef = useRef(false)

  const requestTurn = useCallback(
    async (
      next: Omit<LearnerVoiceTurnRequest, 'child_id' | 'lang'>,
    ) => {
      if (!childId) return
      setLoading(true)
      setError(null)
      try {
        const response = await runLearnerVoiceTurn({ child_id: childId, lang, ...next })
        setCard(response.card)
        setSessionComplete(response.session_complete)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
      } finally {
        setLoading(false)
      }
    },
    [childId, lang],
  )

  // Reset state when the surface opens; seed the first turn.
  useEffect(() => {
    if (!open) {
      initializedRef.current = false
      setCard(null)
      setSessionComplete(false)
      setError(null)
      return
    }
    if (initializedRef.current) return
    initializedRef.current = true
    void requestTurn({})
  }, [open, requestTurn])

  // Close on Escape.
  useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  const handleMcqAnswer = useCallback(
    (optionId: string) => {
      if (!card || card.kind !== 'mcq-tap') return
      void requestTurn({
        last_card_id: card.card_id,
        last_kind: 'mcq-tap',
        answer_option_id: optionId,
      })
    },
    [card, requestTurn],
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
    if (card) return 'Tap an answer or use the mic when it lights up.'
    return ''
  }, [loading, sessionComplete, card])

  if (!open) return null

  return (
    <div
      className={styles.scrim}
      role="dialog"
      aria-modal="true"
      aria-label="Pathfinder voice tutor"
      data-testid="learner-voice-fullscreen"
    >
      <header className={styles.header}>
        <span className={styles.headerTitle}>Pathfinder · voice tutor</span>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="Close voice tutor"
          data-testid="learner-voice-close"
        >
          <XMarkIcon className={styles.closeGlyph} aria-hidden="true" />
        </button>
      </header>
      <div className={styles.body}>
        <div className={styles.status} aria-live="polite">{statusText}</div>
        {error ? (
          <div className={styles.errorBanner} role="alert">{error}</div>
        ) : null}
        <div className={styles.cardSlot}>
          {card ? (
            <LearnerVoiceCardRenderer
              card={card}
              disabled={loading}
              sessionComplete={sessionComplete}
              onMcqAnswer={handleMcqAnswer}
              onAdvance={handleAdvance}
              onFinish={onClose}
            />
          ) : null}
        </div>
      </div>
      <footer className={styles.footer}>
        <button
          type="button"
          className={mergeClasses(styles.micButton)}
          disabled
          aria-disabled="true"
          title="Voice input lands in phase 2.1"
          data-testid="learner-voice-mic"
        >
          <MicrophoneIcon className={styles.micGlyph} aria-hidden="true" />
        </button>
        <span className={styles.micHint}>Voice coming next · tap to answer</span>
      </footer>
    </div>
  )
}

export default LearnerVoiceFullscreen
