import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { makeStyles } from '@fluentui/react-components'
import { MicrophoneIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { useAudioPlayer } from '../../hooks/useAudioPlayer'
import { useRecorder } from '../../hooks/useRecorder'
import type { LearnerVoiceCard } from '../api'
import { LearnerVoiceCardRenderer } from './LearnerVoiceCard'

const MIC_DENIED_COPY = 'Tutor needs your microphone to listen. Tap 🔊 Listen on cards instead.'

type TutorState = 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error'

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
    background: 'radial-gradient(circle at 50% 18%, #202024 0%, #070708 64%)',
    color: '#f7f7f8',
    display: 'grid',
    gridTemplateRows: 'auto 1fr auto',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '18px 24px',
    borderBottom: '1px solid rgba(255,255,255,0.07)',
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
    backgroundColor: '#fff',
    boxShadow: '0 0 14px rgba(255,255,255,0.45)',
  },
  iconButton: {
    width: '40px',
    height: '40px',
    borderRadius: '999px',
    border: '1px solid rgba(255,255,255,0.14)',
    background: 'rgba(255,255,255,0.06)',
    color: '#fff',
    display: 'grid',
    placeItems: 'center',
    cursor: 'pointer',
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
  orb: {
    width: 'min(220px, 48vw)',
    aspectRatio: '1',
    borderRadius: '999px',
    background: 'radial-gradient(circle at 32% 26%, #ffffff 0%, #d8d8dd 34%, #53535a 68%, #101012 100%)',
    boxShadow: '0 0 60px rgba(255,255,255,0.18), inset 0 0 32px rgba(255,255,255,0.2)',
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
    color: 'rgba(255,255,255,0.64)',
    fontSize: '0.9rem',
  },
  cardSlot: {
    width: 'min(680px, 100%)',
  },
  fallback: {
    width: 'min(620px, 100%)',
    borderRadius: '14px',
    border: '1px solid rgba(255, 205, 105, 0.38)',
    background: 'rgba(255, 205, 105, 0.12)',
    color: '#ffe2a8',
    padding: '13px 15px',
    fontSize: '0.92rem',
    lineHeight: 1.45,
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '14px',
    padding: '18px 24px 30px',
  },
  micButton: {
    width: '64px',
    height: '64px',
    borderRadius: '999px',
    border: '1px solid rgba(255,255,255,0.18)',
    background: 'linear-gradient(160deg, #4a4a4d 0%, #090909 100%)',
    color: '#fff',
    display: 'grid',
    placeItems: 'center',
    cursor: 'pointer',
    boxShadow: '0 16px 42px rgba(0,0,0,0.42)',
  },
  micButtonRecording: {
    boxShadow: '0 0 0 8px rgba(255,255,255,0.08), 0 18px 48px rgba(0,0,0,0.5)',
  },
  micGlyph: { width: '25px', height: '25px' },
  level: {
    width: '72px',
    height: '8px',
    borderRadius: '999px',
    background: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
  },
  levelFill: {
    display: 'block',
    height: '100%',
    borderRadius: '999px',
    background: '#ffffff',
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
}

type IncomingEvent = Record<string, unknown> & {
  type?: string
  delta?: string
  payload?: {
    card?: LearnerVoiceCard
    session_complete?: boolean
  }
}

function buildLearnerVoiceUrl({ childId, exam, classYear, subject }: Pick<LearnerTutorFullscreenProps, 'childId' | 'exam' | 'classYear' | 'subject'>): string {
  const endpoint = '/ws/voice'
  const isLocalDevServer = location.port !== '' && location.port !== '8000'
  const origin = isLocalDevServer
    ? `${location.protocol}//${location.hostname}:8000`
    : location.origin
  const url = new URL(endpoint, origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('scope', 'learner')
  url.searchParams.set('child_id', childId)
  if (exam) url.searchParams.set('exam', exam)
  if (classYear) url.searchParams.set('class_year', classYear)
  if (subject) url.searchParams.set('subject', subject)
  return url.toString()
}

function stateCopy(state: TutorState, recording: boolean) {
  if (state === 'connecting') return { title: 'Connecting', hint: 'Opening your tutor session' }
  if (state === 'thinking') return { title: 'Thinking', hint: 'Choosing the next card' }
  if (state === 'speaking') return { title: 'Tutor speaking', hint: 'You can answer when ready' }
  if (state === 'error') return { title: 'Trouble connecting', hint: 'Use Listen on cards and try again later' }
  return recording
    ? { title: 'Listening', hint: 'Answer naturally, or tap an option on the card' }
    : { title: 'Ready', hint: 'Tap the mic to talk to your tutor' }
}

export function LearnerTutorFullscreen({
  open,
  onClose,
  childId,
  exam,
  classYear,
  subject,
}: LearnerTutorFullscreenProps): JSX.Element | null {
  const styles = useStyles()
  const wsRef = useRef<WebSocket | null>(null)
  const micRequestedRef = useRef(false)
  const recordingRef = useRef(false)
  const toggleRecordingRef = useRef<(() => Promise<void>) | null>(null)
  const [state, setState] = useState<TutorState>('connecting')
  const [card, setCard] = useState<LearnerVoiceCard | null>(null)
  const [sessionComplete, setSessionComplete] = useState(false)
  const [fallback, setFallback] = useState<string | null>(null)
  const { playAudio, stopAudio } = useAudioPlayer()

  const send = useCallback((message: Record<string, unknown>) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify(message))
  }, [])

  const { recording, inputLevel, toggleRecording } = useRecorder({
    mode: 'stream',
    onAudioChunk: base64 => {
      send({ type: 'input_audio_buffer.append', audio: base64 })
    },
  })

  useEffect(() => {
    recordingRef.current = recording
    toggleRecordingRef.current = toggleRecording
  }, [recording, toggleRecording])

  useEffect(() => () => {
    if (recordingRef.current) {
      void toggleRecordingRef.current?.()
    }
  }, [])

  const wsUrl = useMemo(
    () => buildLearnerVoiceUrl({ childId, exam, classYear, subject }),
    [childId, exam, classYear, subject],
  )

  useEffect(() => {
    if (!open) {
      micRequestedRef.current = false
      return
    }

    setState('connecting')
    setFallback(null)
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws
    ws.onopen = () => {
      setState('listening')
      ws.send(JSON.stringify({ type: 'session.update', session: {} }))
      ws.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Start my tutoring session.' }],
        },
      }))
      ws.send(JSON.stringify({ type: 'response.create' }))
    }
    ws.onmessage = event => {
      const parsed = JSON.parse(String(event.data)) as IncomingEvent
      if (parsed.type === 'wulo.learner_card' && parsed.payload?.card) {
        setCard(parsed.payload.card)
        setSessionComplete(Boolean(parsed.payload.session_complete))
        setState('listening')
        return
      }
      if (parsed.type === 'response.audio.delta' && typeof parsed.delta === 'string') {
        setState('speaking')
        playAudio(parsed.delta)
        return
      }
      if (parsed.type === 'response.created' || parsed.type === 'response.output_item.added') {
        setState('thinking')
        return
      }
      if (parsed.type === 'response.done') {
        setState('listening')
      }
    }
    ws.onerror = () => setState('error')
    ws.onclose = () => {
      if (wsRef.current === ws) wsRef.current = null
    }

    return () => {
      wsRef.current = null
      ws.close()
      stopAudio()
    }
  }, [open, playAudio, stopAudio, wsUrl])

  useEffect(() => {
    if (!open || micRequestedRef.current) return
    micRequestedRef.current = true
    void toggleRecording().catch(() => {
      setFallback(MIC_DENIED_COPY)
      setState('error')
      window.setTimeout(onClose, 4000)
    })
  }, [open, onClose, toggleRecording])

  const handleClose = useCallback(() => {
    stopAudio()
    if (recording) {
      void toggleRecording().finally(onClose)
      return
    }
    onClose()
  }, [onClose, recording, stopAudio, toggleRecording])

  const sendLearnerReply = useCallback((text: string) => {
    setState('thinking')
    send({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text }],
      },
    })
    send({ type: 'response.create' })
  }, [send])

  const copy = stateCopy(state, recording)

  if (!open) return null

  return (
    <dialog
      open
      className={styles.scrim}
      aria-label="Pathfinder learner tutor"
      data-testid="learner-tutor"
    >
      <header className={styles.header}>
        <span className={styles.brand}><span className={styles.brandDot} />Pathfinder tutor</span>
        <button type="button" className={styles.iconButton} onClick={handleClose} aria-label="Close tutor">
          <XMarkIcon className={styles.icon} aria-hidden="true" />
        </button>
      </header>
      <main className={styles.body}>
        <div className={`${styles.orb} ${recording || state === 'speaking' ? styles.orbActive : ''}`} aria-hidden="true" />
        <div className={styles.status} aria-live="polite">
          <span className={styles.stateTitle}>{copy.title}</span>
          <span className={styles.stateHint}>{copy.hint}</span>
        </div>
        {fallback ? <div className={styles.fallback} role="alert">{fallback}</div> : null}
        {card ? (
          <div className={styles.cardSlot}>
            <LearnerVoiceCardRenderer
              card={card}
              disabled={state === 'thinking'}
              sessionComplete={sessionComplete}
              onMcqAnswer={optionId => sendLearnerReply(`I choose option ${optionId}. Previous card: ${card.card_id}.`)}
              onAdvance={() => sendLearnerReply(`Next card please. Previous card: ${card.card_id}.`)}
              onFinish={handleClose}
            />
          </div>
        ) : null}
      </main>
      <footer className={styles.footer}>
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
          <span className={styles.levelFill} style={{ width: `${Math.round(inputLevel * 100)}%` }} />
        </span>
      </footer>
    </dialog>
  )
}

export default LearnerTutorFullscreen