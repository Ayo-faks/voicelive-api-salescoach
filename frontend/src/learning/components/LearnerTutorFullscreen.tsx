import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { makeStyles } from '@fluentui/react-components'
import { MicrophoneIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { useAudioPlayer } from '../../hooks/useAudioPlayer'
import { useRecorder } from '../../hooks/useRecorder'
import type { LearnerVoiceCard } from '../api'
import type { LearnerFocusItem } from '../contexts/LearnerContext'
import { LearnerVoiceCardRenderer } from './LearnerVoiceCard'

const MIC_DENIED_COPY =
  'Tutor needs your microphone to listen. Tap 🔊 Listen on cards instead.'

export type TutorState =
  | 'connecting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'error'

export type TutorVoiceSnapshot = {
  state: TutorState | 'idle'
  inputLevel: number
  recording: boolean
}

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
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '18px 24px',
    borderBottom: '1px solid var(--scrim-line-soft)',
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
    background:
      'radial-gradient(circle at 32% 26%, #ffffff 0%, #d8d8dd 34%, #53535a 68%, #101012 100%)',
    boxShadow: 'var(--scrim-orb-glow)',
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
}

type IncomingEvent = Record<string, unknown> & {
  type?: string
  delta?: string
  payload?: {
    card?: LearnerVoiceCard
    session_complete?: boolean
  }
}

function buildLearnerVoiceUrl({
  childId,
  exam,
  classYear,
  subject,
  focusItem,
}: Pick<
  LearnerTutorFullscreenProps,
  'childId' | 'exam' | 'classYear' | 'subject' | 'focusItem'
>): string {
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
  if (focusItem) {
    if (focusItem.stem) url.searchParams.set('focus_stem', focusItem.stem)
    if (focusItem.skillId)
      url.searchParams.set('focus_skill_id', focusItem.skillId)
    if (focusItem.misconception)
      url.searchParams.set('focus_misconception', focusItem.misconception)
    if (typeof focusItem.scored === 'boolean')
      url.searchParams.set('focus_scored', focusItem.scored ? 'true' : 'false')
  }
  return url.toString()
}

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
}: LearnerTutorFullscreenProps): JSX.Element | null {
  const styles = useStyles()
  const wsRef = useRef<WebSocket | null>(null)
  const micRequestedRef = useRef(false)
  const recordingRef = useRef(false)
  const toggleRecordingRef = useRef<(() => Promise<void>) | null>(null)
  // Set the instant Azure's server VAD reports the learner started speaking, so
  // we can flush the tutor's already-buffered audio and drop any straggler
  // `response.audio.delta` frames from the interrupted response until the next
  // `response.created` (barge-in). Cleared when the next reply begins.
  const bargedInRef = useRef(false)
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

  useEffect(() => {
    if (!onVoiceStateChange) return
    onVoiceStateChange({
      state: open ? state : 'idle',
      inputLevel,
      recording,
    })
  }, [onVoiceStateChange, open, state, inputLevel, recording])

  useEffect(
    () => () => {
      onVoiceStateChange?.({ state: 'idle', inputLevel: 0, recording: false })
    },
    [onVoiceStateChange]
  )

  useEffect(
    () => () => {
      if (recordingRef.current) {
        void toggleRecordingRef.current?.()
      }
    },
    []
  )

  const wsUrl = useMemo(
    () => buildLearnerVoiceUrl({ childId, exam, classYear, subject, focusItem }),
    [childId, exam, classYear, subject, focusItem]
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
      ws.send(
        JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [
              { type: 'input_text', text: 'Start my tutoring session.' },
            ],
          },
        })
      )
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
      // Barge-in: the learner started talking over the tutor. Azure's server
      // VAD stops generating, but the browser has many audio chunks scheduled
      // ahead in the Web Audio context — flush them so the tutor goes quiet
      // immediately, and ignore any in-flight deltas from the now-dead response
      // until the next reply starts. Without this the audio keeps playing (and
      // the agent only appears to "duck" in volume) when the learner interrupts.
      if (parsed.type === 'input_audio_buffer.speech_started') {
        bargedInRef.current = true
        stopAudio()
        setState('listening')
        return
      }
      if (
        parsed.type === 'response.audio.delta' &&
        typeof parsed.delta === 'string'
      ) {
        if (bargedInRef.current) return
        setState('speaking')
        playAudio(parsed.delta)
        return
      }
      if (
        parsed.type === 'response.created' ||
        parsed.type === 'response.output_item.added'
      ) {
        bargedInRef.current = false
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

  const sendLearnerReply = useCallback(
    (text: string) => {
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
    },
    [send]
  )

  const copy = stateCopy(state, recording)

  if (!open) return null

  return (
    <dialog
      open
      className={styles.scrim}
      aria-label="Wulo Academy learner tutor"
      data-testid="learner-tutor"
    >
      <header className={styles.header}>
        <span className={styles.brand}>
          <span className={styles.brandDot} />
          Wulo Tutor
        </span>
        <button
          type="button"
          className={styles.iconButton}
          onClick={handleClose}
          aria-label="Close tutor"
        >
          <XMarkIcon className={styles.icon} aria-hidden="true" />
        </button>
      </header>
      <main className={styles.body}>
        <div
          className={`${styles.orb} ${recording || state === 'speaking' ? styles.orbActive : ''}`}
          aria-hidden="true"
        />
        <div className={styles.status} aria-live="polite">
          <span className={styles.stateTitle}>{copy.title}</span>
          <span className={styles.stateHint}>{copy.hint}</span>
        </div>
        {fallback ? (
          <div className={styles.fallback} role="alert">
            {fallback}
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
