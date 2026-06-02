/**
 * VoiceLive transport for the Ask Pathfinder surface.
 *
 * The neural-voice twin of the Web Speech voice mode. When
 * `PATHFINDER_VOICELIVE_ENABLED` is on, the learner's mic is streamed full-duplex
 * to Azure VoiceLive over the same-origin `/ws/voice?scope=learner_ask` proxy and
 * the tutor's reply is heard as neural audio. Every spoken question is routed
 * server-side through the same `run_assistant_turn` brain as the text drawer, so
 * grounding ("no citation, no answer") and the outbound safeguarding screen are
 * applied identically; the resulting `AssistantBlock`s arrive as
 * `wulo.assistant_block` messages and render through the shared block renderer.
 *
 * Reuses the existing `useRecorder` (24 kHz mono PCM mic capture) and
 * `useAudioPlayer` (PCM playback) hooks — no new audio plumbing.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAudioPlayer } from '../../hooks/useAudioPlayer'
import { useRecorder } from '../../hooks/useRecorder'
import type { AssistantBlock } from '../api'

export type AskVoiceState =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'error'

interface UseAskPathfinderVoiceOptions {
  /** Open the realtime session only while voice mode is active. */
  active: boolean
  childId: string
  subject?: string
  classYear?: string
  exam?: string
  /** A grounded, safeguarded gen-UI block produced by the assistant brain. */
  onBlock: (block: AssistantBlock, sessionComplete: boolean) => void
  /** The learner's own spoken question, once transcribed at the edge. */
  onUserTranscript?: (text: string) => void
  onError?: (message: string) => void
}

interface AskVoiceIncoming {
  type?: string
  delta?: string
  transcript?: string
  payload?: {
    block?: AssistantBlock
    session_complete?: boolean
  }
}

function buildAskVoiceUrl({
  childId,
  subject,
  classYear,
  exam,
}: Pick<
  UseAskPathfinderVoiceOptions,
  'childId' | 'subject' | 'classYear' | 'exam'
>): string {
  const endpoint = '/ws/voice'
  // In the Vite dev server the app runs on :5173 while the backend (and its
  // WebSocket proxy) listens on :8000. Same-origin in prod, explicit :8000 in
  // dev — this also dodges the permessage-deflate frame corruption seen on the
  // proxied dev path.
  const isLocalDevServer = location.port !== '' && location.port !== '8000'
  const origin = isLocalDevServer
    ? `${location.protocol}//${location.hostname}:8000`
    : location.origin
  const url = new URL(endpoint, origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('scope', 'learner_ask')
  url.searchParams.set('child_id', childId)
  if (exam) url.searchParams.set('exam', exam)
  if (classYear) url.searchParams.set('class_year', classYear)
  if (subject) url.searchParams.set('subject', subject)
  return url.toString()
}

export function useAskPathfinderVoice({
  active,
  childId,
  subject,
  classYear,
  exam,
  onBlock,
  onUserTranscript,
  onError,
}: UseAskPathfinderVoiceOptions): {
  voiceState: AskVoiceState
  recording: boolean
  inputLevel: number
  toggleRecording: () => Promise<void>
} {
  const wsRef = useRef<WebSocket | null>(null)
  const micRequestedRef = useRef(false)
  const recordingRef = useRef(false)
  const toggleRecordingRef = useRef<(() => Promise<void>) | null>(null)
  // Set the instant Azure's server VAD reports the learner started speaking, so
  // we can flush the tutor's already-buffered audio and drop any straggler
  // `response.audio.delta` frames from the interrupted response until the next
  // `response.created` (barge-in). Cleared when the next reply begins.
  const bargedInRef = useRef(false)
  const [voiceState, setVoiceState] = useState<AskVoiceState>('idle')
  const { playAudio, stopAudio } = useAudioPlayer()

  // Latest callbacks without re-opening the socket each render.
  const onBlockRef = useRef(onBlock)
  const onUserTranscriptRef = useRef(onUserTranscript)
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onBlockRef.current = onBlock
    onUserTranscriptRef.current = onUserTranscript
    onErrorRef.current = onError
  }, [onBlock, onUserTranscript, onError])

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

  const wsUrl = useMemo(
    () => buildAskVoiceUrl({ childId, subject, classYear, exam }),
    [childId, subject, classYear, exam]
  )

  useEffect(() => {
    if (!active) {
      micRequestedRef.current = false
      return
    }

    if (!childId.trim()) {
      setVoiceState('error')
      onErrorRef.current?.('missing_child_context')
      return
    }

    setVoiceState('connecting')
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws
    ws.onopen = () => {
      setVoiceState('listening')
      ws.send(JSON.stringify({ type: 'session.update', session: {} }))
      ws.send(
        JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: 'Say a brief, friendly hello and ask what I would like help with today.',
              },
            ],
          },
        })
      )
      ws.send(JSON.stringify({ type: 'response.create' }))
    }
    ws.onmessage = event => {
      let parsed: AskVoiceIncoming
      try {
        parsed = JSON.parse(String(event.data)) as AskVoiceIncoming
      } catch {
        return
      }
      if (parsed.type === 'wulo.assistant_block' && parsed.payload?.block) {
        onBlockRef.current(
          parsed.payload.block,
          Boolean(parsed.payload.session_complete)
        )
        setVoiceState('listening')
        return
      }
      if (
        parsed.type === 'conversation.item.input_audio_transcription.completed' &&
        typeof parsed.transcript === 'string'
      ) {
        const said = parsed.transcript.trim()
        if (said) onUserTranscriptRef.current?.(said)
        return
      }
      // Barge-in: the learner started talking over the tutor. Azure's server
      // VAD already stops generating, but the browser has many audio chunks
      // scheduled ahead in the Web Audio context — flush them so the tutor goes
      // quiet immediately, and ignore any in-flight deltas from the now-dead
      // response until the next reply starts.
      if (parsed.type === 'input_audio_buffer.speech_started') {
        bargedInRef.current = true
        stopAudio()
        setVoiceState('listening')
        return
      }
      if (
        parsed.type === 'response.audio.delta' &&
        typeof parsed.delta === 'string'
      ) {
        if (bargedInRef.current) return
        setVoiceState('speaking')
        playAudio(parsed.delta)
        return
      }
      if (
        parsed.type === 'response.created' ||
        parsed.type === 'response.output_item.added'
      ) {
        bargedInRef.current = false
        setVoiceState('thinking')
        return
      }
      if (parsed.type === 'response.done') {
        setVoiceState('listening')
        return
      }
      if (parsed.type === 'error') {
        onErrorRef.current?.('voice_error')
      }
    }
    ws.onerror = () => {
      setVoiceState('error')
      onErrorRef.current?.('voice_error')
    }
    ws.onclose = () => {
      if (wsRef.current === ws) wsRef.current = null
    }

    return () => {
      wsRef.current = null
      ws.close()
      stopAudio()
      if (recordingRef.current) {
        void toggleRecordingRef.current?.()
      }
    }
  }, [active, playAudio, stopAudio, wsUrl])

  // Auto-open the mic once per activation so the learner can just start talking.
  useEffect(() => {
    if (!active || micRequestedRef.current) return
    micRequestedRef.current = true
    void toggleRecording().catch(() => {
      setVoiceState('error')
      onErrorRef.current?.('mic_denied')
    })
  }, [active, toggleRecording])

  return { voiceState, recording, inputLevel, toggleRecording }
}
