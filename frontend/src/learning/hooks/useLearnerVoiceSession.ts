import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAudioPlayer } from '../../hooks/useAudioPlayer'
import { useRecorder } from '../../hooks/useRecorder'
import type { LearnerVoiceCard } from '../api'
import type { LearnerFocusItem } from '../contexts/LearnerContext'

export const MIC_DENIED_COPY =
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

type IncomingEvent = Record<string, unknown> & {
  type?: string
  delta?: string
  payload?: {
    card?: LearnerVoiceCard
    session_complete?: boolean
  }
}

export interface LearnerVoiceSessionOptions {
  open: boolean
  childId: string
  exam?: string
  classYear?: string
  subject?: string
  focusItem?: LearnerFocusItem | null
  lastCardId?: string | null
  lastKind?: string | null
  autoStartRecording?: boolean
  closeOnMicDeniedMs?: number | null
  startOnOpen?: boolean
  startPrompt?: string
  suppressPassiveConnectionErrors?: boolean
  onClose?: () => void
  onVoiceStateChange?: (snapshot: TutorVoiceSnapshot) => void
}

export interface LearnerVoiceSession {
  state: TutorState
  recording: boolean
  inputLevel: number
  card: LearnerVoiceCard | null
  sessionComplete: boolean
  fallback: string | null
  error: string | null
  toggleRecording: () => Promise<void>
  sendLearnerReply: (text: string) => void
  close: () => void
}

export function buildLearnerVoiceUrl({
  childId,
  exam,
  classYear,
  subject,
  focusItem,
  lastCardId,
  lastKind,
}: Pick<
  LearnerVoiceSessionOptions,
  | 'childId'
  | 'exam'
  | 'classYear'
  | 'subject'
  | 'focusItem'
  | 'lastCardId'
  | 'lastKind'
>): string {
  const endpoint = '/ws/voice'
  const url = new URL(endpoint, location.origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('scope', 'learner')
  url.searchParams.set('child_id', childId)
  if (exam) url.searchParams.set('exam', exam)
  if (classYear) url.searchParams.set('class_year', classYear)
  if (subject) url.searchParams.set('subject', subject)
  if (lastCardId) url.searchParams.set('last_card_id', lastCardId)
  if (lastKind) url.searchParams.set('last_kind', lastKind)
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

export function useLearnerVoiceSession({
  open,
  childId,
  exam,
  classYear,
  subject,
  focusItem,
  lastCardId,
  lastKind,
  autoStartRecording = true,
  closeOnMicDeniedMs = 4000,
  startOnOpen = true,
  startPrompt = 'Start my tutoring session.',
  suppressPassiveConnectionErrors = false,
  onClose,
  onVoiceStateChange,
}: LearnerVoiceSessionOptions): LearnerVoiceSession {
  const wsRef = useRef<WebSocket | null>(null)
  const interactionRef = useRef(false)
  const micRequestedRef = useRef(false)
  const recordingRef = useRef(false)
  const toggleRecordingRef = useRef<(() => Promise<void>) | null>(null)
  // Set the instant Azure's server VAD reports the learner started speaking, so
  // already-buffered tutor audio can be flushed and in-flight deltas dropped
  // until the next reply begins.
  const bargedInRef = useRef(false)
  // Whether the realtime socket ever reached the OPEN state.
  const openedRef = useRef(false)
  // Whether the session has produced anything the learner can see/hear (a
  // card, audio, or a started response). Once true, later transport errors or
  // closes are treated as transient/graceful rather than hard failures.
  const progressRef = useRef(false)
  const [state, setState] = useState<TutorState>('connecting')
  const [card, setCard] = useState<LearnerVoiceCard | null>(null)
  const [sessionComplete, setSessionComplete] = useState(false)
  const [fallback, setFallback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
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

  const showMicDenied = useCallback(() => {
    setFallback(MIC_DENIED_COPY)
    setError(MIC_DENIED_COPY)
    setState('error')
  }, [])

  const toggleRecordingWithError = useCallback(async () => {
    interactionRef.current = true
    try {
      await toggleRecording()
    } catch {
      showMicDenied()
    }
  }, [showMicDenied, toggleRecording])

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
    () =>
      buildLearnerVoiceUrl({
        childId,
        exam,
        classYear,
        subject,
        focusItem,
        lastCardId,
        lastKind,
      }),
    [childId, exam, classYear, subject, focusItem, lastCardId, lastKind]
  )

  useEffect(() => {
    if (!open) {
      micRequestedRef.current = false
      return
    }

    setState('connecting')
    setFallback(null)
    setError(null)
    openedRef.current = false
    progressRef.current = false
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws
    ws.onopen = () => {
      openedRef.current = true
      setState('listening')
      ws.send(JSON.stringify({ type: 'session.update', session: {} }))
      if (!startOnOpen) return
      ws.send(
        JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: startPrompt }],
          },
        })
      )
      ws.send(JSON.stringify({ type: 'response.create' }))
    }
    ws.onmessage = event => {
      const parsed = JSON.parse(String(event.data)) as IncomingEvent
      if (parsed.type === 'wulo.learner_card' && parsed.payload?.card) {
        progressRef.current = true
        setError(null)
        setCard(parsed.payload.card)
        setSessionComplete(Boolean(parsed.payload.session_complete))
        setState('listening')
        return
      }
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
        progressRef.current = true
        setError(null)
        setState('speaking')
        playAudio(parsed.delta)
        return
      }
      if (
        parsed.type === 'response.created' ||
        parsed.type === 'response.output_item.added'
      ) {
        progressRef.current = true
        setError(null)
        bargedInRef.current = false
        setState('thinking')
        return
      }
      if (parsed.type === 'response.done') {
        setState('listening')
      }
    }
    ws.onerror = () => {
      // A transport-level error after the realtime session is already working
      // (a card streamed, audio playing, or a response in flight) is almost
      // always a transient blip. The tutor is visibly speaking / showing a
      // card, so a hard "connection failed" banner would be misleading. Let the
      // close handler decide if anything is actually broken.
      if (progressRef.current) return
      if (suppressPassiveConnectionErrors && !interactionRef.current) {
        setState('listening')
        return
      }
      if (openedRef.current) {
        setError(
          'The tutor disconnected before it could start. Tap the mic to try again.'
        )
      } else {
        setError(
          'Could not reach the tutor. Check your connection and try again.'
        )
      }
      setState('error')
    }
    ws.onclose = () => {
      const wasCurrent = wsRef.current === ws
      if (wasCurrent) wsRef.current = null
      // Intentional teardown (close()/unmount) nulls wsRef before closing, so
      // wasCurrent is false there — never surface an error for those.
      if (!wasCurrent) return
      // A spontaneous close after the session produced content is a graceful
      // end, not a failure.
      if (progressRef.current) return
      if (suppressPassiveConnectionErrors && !interactionRef.current) {
        setState('listening')
        return
      }
      if (openedRef.current) {
        setError(
          'The tutor disconnected before it could start. Tap the mic to try again.'
        )
      } else {
        setError(
          'Could not reach the tutor. Check your connection and try again.'
        )
      }
      setState('error')
    }

    return () => {
      wsRef.current = null
      ws.close()
      stopAudio()
    }
  }, [open, playAudio, startOnOpen, startPrompt, stopAudio, suppressPassiveConnectionErrors, wsUrl])

  useEffect(() => {
    if (!open || !autoStartRecording || micRequestedRef.current) return
    micRequestedRef.current = true
    void toggleRecording().catch(() => {
      showMicDenied()
      if (typeof closeOnMicDeniedMs === 'number') {
        window.setTimeout(() => onClose?.(), closeOnMicDeniedMs)
      }
    })
  }, [autoStartRecording, closeOnMicDeniedMs, onClose, open, showMicDenied, toggleRecording])

  const close = useCallback(() => {
    stopAudio()
    if (recording) {
      void toggleRecording().finally(onClose)
      return
    }
    onClose?.()
  }, [onClose, recording, stopAudio, toggleRecording])

  const sendLearnerReply = useCallback(
    (text: string) => {
      interactionRef.current = true
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

  return {
    state,
    recording,
    inputLevel,
    card,
    sessionComplete,
    fallback,
    error,
    toggleRecording: toggleRecordingWithError,
    sendLearnerReply,
    close,
  }
}