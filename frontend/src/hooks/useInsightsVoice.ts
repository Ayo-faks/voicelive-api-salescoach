/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRecorder } from './useRecorder'
import type {
  InsightsCitation,
  InsightsScope,
  InsightsVoiceEnvelope,
  InsightsVoiceMode,
  InsightsVoiceState,
  TurnAudioChunk,
  TurnCompleted,
  VisualizationSpec,
} from '../types'

interface UseInsightsVoiceOptions {
  scope: InsightsScope
  conversationId?: string | null
  mode?: InsightsVoiceMode
  onCompleted?: (payload: UseInsightsVoiceTurnCompleted) => void
}

export interface UseInsightsVoiceTurnCompleted {
  conversationId: string
  transcript: string
  answerText: string
  citations?: InsightsCitation[]
  visualizations?: VisualizationSpec[]
}

const INSIGHTS_VOICE_ENDPOINT = '/ws/insights-voice'
const OUTPUT_SAMPLE_RATE = 24000
const INTERRUPT_INPUT_LEVEL_THRESHOLD = 0.15
const INTERRUPT_HOLD_MS = 200

type RecorderMode = 'off' | 'stream' | 'monitor'

function resolveInsightsVoiceWebSocketUrl(scope: InsightsScope, conversationId?: string | null): string {
  const params = new URLSearchParams({ scope_type: scope.type })
  if (scope.child_id) {
    params.set('child_id', scope.child_id)
  }
  if (conversationId) {
    params.set('conversation_id', conversationId)
  }

  const endpoint = `${INSIGHTS_VOICE_ENDPOINT}?${params.toString()}`
  const isLocalDevServer = location.port !== '' && location.port !== '8000'
  if (isLocalDevServer) {
    const backendOrigin = `${location.protocol}//${location.hostname}:8000`
    const backendUrl = new URL(endpoint, backendOrigin)
    backendUrl.protocol = backendUrl.protocol === 'https:' ? 'wss:' : 'ws:'
    return backendUrl.toString()
  }

  const wsOrigin = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`
  return new URL(endpoint, wsOrigin).toString()
}

function decodePcmChunk(dataB64: string): Float32Array {
  const binary = atob(dataB64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  const view = new DataView(bytes.buffer)
  const output = new Float32Array(bytes.byteLength / 2)
  for (let index = 0; index < output.length; index += 1) {
    output[index] = view.getInt16(index * 2, true) / 32768
  }
  return output
}

export function useInsightsVoice({
  scope,
  conversationId,
  mode = 'push_to_talk',
  onCompleted,
}: UseInsightsVoiceOptions) {
  const [voiceState, setVoiceState] = useState<InsightsVoiceState>('idle')
  const [lastTranscript, setLastTranscript] = useState('')
  const [lastAnswer, setLastAnswer] = useState('')
  const [outputLevel, setOutputLevel] = useState(0)
  const wsRef = useRef<WebSocket | null>(null)
  const pendingConnectRef = useRef<Promise<WebSocket | null> | null>(null)
  const inboundBufferRef = useRef('')
  const manualCloseRef = useRef(false)
  const lastTranscriptRef = useRef('')
  const recordingRef = useRef(false)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const gainNodeRef = useRef<GainNode | null>(null)
  const playbackCursorRef = useRef(0)
  const activePlaybackCountRef = useRef(0)
  const activePlaybackSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set())
  const pendingCompletionRef = useRef(false)
  const meterRafRef = useRef<number | null>(null)
  const recorderModeRef = useRef<RecorderMode>('off')
  const recorderTransitionRef = useRef<Promise<void> | null>(null)
  const streamInputEnabledRef = useRef(false)
  const interruptThresholdStartedAtRef = useRef<number | null>(null)
  const interruptRequestedRef = useRef(false)
  const interruptedRef = useRef(false)

  const { recording, inputLevel, toggleRecording } = useRecorder({
    mode: 'stream',
    onAudioChunk: chunk => {
      if (streamInputEnabledRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'user_audio_chunk', data: chunk }))
      }
    },
  })

  useEffect(() => {
    recordingRef.current = recording
  }, [recording])

  const stopMeter = useCallback(() => {
    if (meterRafRef.current !== null) {
      cancelAnimationFrame(meterRafRef.current)
      meterRafRef.current = null
    }
  }, [])

  const disconnectSocket = useCallback(() => {
    manualCloseRef.current = true
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    pendingConnectRef.current = null
    inboundBufferRef.current = ''
  }, [])

  const setRecorderMode = useCallback(
    async (nextMode: RecorderMode) => {
      const previousTransition = recorderTransitionRef.current
      const nextTransition = (previousTransition ?? Promise.resolve())
        .catch(() => undefined)
        .then(async () => {
          recorderModeRef.current = nextMode
          streamInputEnabledRef.current = nextMode === 'stream'
          interruptThresholdStartedAtRef.current = null

          const shouldRecord = nextMode !== 'off'
          if (recordingRef.current === shouldRecord) {
            return
          }

          await toggleRecording()
          recordingRef.current = shouldRecord
        })

      recorderTransitionRef.current = nextTransition.finally(() => {
        if (recorderTransitionRef.current === nextTransition) {
          recorderTransitionRef.current = null
        }
      })

      return recorderTransitionRef.current
    },
    [toggleRecording],
  )

  const stopPlayback = useCallback(
    (nextState?: InsightsVoiceState) => {
      pendingCompletionRef.current = false
      stopMeter()
      setOutputLevel(0)
      playbackCursorRef.current = audioContextRef.current?.currentTime ?? 0

      const activeSources = Array.from(activePlaybackSourcesRef.current)
      activePlaybackSourcesRef.current.clear()
      activePlaybackCountRef.current = 0
      for (const source of activeSources) {
        source.onended = null
        try {
          source.stop(0)
        } catch {
          // Source may already be ended; ignore.
        }
      }

      if (nextState) {
        setVoiceState(nextState)
      }
    },
    [stopMeter],
  )

  const finishPlaybackIfIdle = useCallback(() => {
    if (activePlaybackCountRef.current > 0) {
      pendingCompletionRef.current = true
      return
    }
    pendingCompletionRef.current = false
    stopMeter()
    setOutputLevel(0)
    setVoiceState(interruptedRef.current ? 'interrupted' : 'idle')
  }, [stopMeter])

  const startMeter = useCallback(() => {
    if (meterRafRef.current !== null) {
      return
    }

    const tick = () => {
      const analyser = analyserRef.current
      if (!analyser) {
        meterRafRef.current = null
        return
      }
      const data = new Float32Array(analyser.fftSize)
      analyser.getFloatTimeDomainData(data)
      let sumSquares = 0
      for (let index = 0; index < data.length; index += 1) {
        const value = data[index]
        sumSquares += value * value
      }
      const rms = Math.sqrt(sumSquares / data.length)
      setOutputLevel(Math.min(1, rms * 3))
      meterRafRef.current = requestAnimationFrame(tick)
    }

    meterRafRef.current = requestAnimationFrame(tick)
  }, [])

  const ensureAudioGraph = useCallback(async () => {
    if (!audioContextRef.current) {
      const AudioContextCtor =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioContextCtor) {
        throw new Error('AudioContext is not available')
      }
      const audioContext = new AudioContextCtor({ sampleRate: OUTPUT_SAMPLE_RATE })
      const gainNode = audioContext.createGain()
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 1024
      analyser.smoothingTimeConstant = 0.7
      gainNode.connect(analyser)
      analyser.connect(audioContext.destination)
      audioContextRef.current = audioContext
      gainNodeRef.current = gainNode
      analyserRef.current = analyser
    }

    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume()
    }

    startMeter()
    return {
      audioContext: audioContextRef.current,
      gainNode: gainNodeRef.current,
    }
  }, [startMeter])

  const enqueueAudioChunk = useCallback(
    async (event: TurnAudioChunk) => {
      const { audioContext, gainNode } = await ensureAudioGraph()
      if (!gainNode) {
        return
      }

      const samples = decodePcmChunk(event.data_b64)
      const audioBuffer = audioContext.createBuffer(1, samples.length, OUTPUT_SAMPLE_RATE)
      audioBuffer.copyToChannel(samples, 0)

      const source = audioContext.createBufferSource()
      source.buffer = audioBuffer
      source.connect(gainNode)
      activePlaybackSourcesRef.current.add(source)

      const startAt = Math.max(audioContext.currentTime, playbackCursorRef.current)
      playbackCursorRef.current = startAt + audioBuffer.duration
      activePlaybackCountRef.current += 1
      setVoiceState('speaking')

      source.onended = () => {
        activePlaybackSourcesRef.current.delete(source)
        activePlaybackCountRef.current = Math.max(0, activePlaybackCountRef.current - 1)
        if (activePlaybackCountRef.current === 0) {
          playbackCursorRef.current = audioContext.currentTime
          if (pendingCompletionRef.current) {
            finishPlaybackIfIdle()
          }
        }
      }

      source.start(startAt)
    },
    [ensureAudioGraph, finishPlaybackIfIdle],
  )

  const interrupt = useCallback(() => {
    if (interruptRequestedRef.current) {
      return
    }

    interruptRequestedRef.current = true
    interruptedRef.current = true
    interruptThresholdStartedAtRef.current = null
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'turn.interrupt' }))
    }
    void setRecorderMode('off')
    stopPlayback('interrupted')
  }, [setRecorderMode, stopPlayback])

  const handleEnvelope = useCallback(
    (event: InsightsVoiceEnvelope) => {
      switch (event.type) {
        case 'turn.final_transcript':
          lastTranscriptRef.current = event.text
          setLastTranscript(event.text)
          setVoiceState('thinking')
          break
        case 'turn.audio_chunk':
          if (interruptRequestedRef.current) {
            break
          }
          void setRecorderMode('monitor').catch(error => {
            console.warn('Unable to monitor insights voice interruption input', error)
          })
          void enqueueAudioChunk(event)
          break
        case 'turn.interrupted':
          interruptRequestedRef.current = false
          interruptedRef.current = true
          void setRecorderMode('off')
          stopPlayback('interrupted')
          break
        case 'turn.completed': {
          const completedEvent = event as TurnCompleted
          const wasInterrupted = interruptedRef.current || interruptRequestedRef.current
          setLastAnswer(completedEvent.answer_text)
          onCompleted?.({
            conversationId: completedEvent.conversation_id,
            transcript: lastTranscriptRef.current,
            answerText: completedEvent.answer_text,
            citations: completedEvent.citations,
            visualizations: completedEvent.visualizations,
          })
          disconnectSocket()
          void setRecorderMode('off')
          interruptRequestedRef.current = false
          if (wasInterrupted) {
            stopPlayback('interrupted')
          } else {
            finishPlaybackIfIdle()
          }
          break
        }
        case 'turn.error':
          console.warn('Insights voice turn failed', event.code, event.message)
          disconnectSocket()
          void setRecorderMode('off')
          interruptedRef.current = false
          interruptRequestedRef.current = false
          stopPlayback('idle')
          break
        default:
          break
      }
    },
    [disconnectSocket, enqueueAudioChunk, finishPlaybackIfIdle, onCompleted, setRecorderMode, stopPlayback],
  )

  const handleRawMessage = useCallback(
    (data: string) => {
      inboundBufferRef.current += data
      const lines = inboundBufferRef.current.split('\n')
      inboundBufferRef.current = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) {
          continue
        }
        try {
          const event = JSON.parse(trimmed) as InsightsVoiceEnvelope
          if (typeof event.type !== 'string' || !event.type.startsWith('turn.')) {
            console.warn('Ignoring unknown insights voice event', event)
            continue
          }
          handleEnvelope(event)
        } catch (error) {
          console.warn('Failed to parse insights voice frame', error)
        }
      }
    },
    [handleEnvelope],
  )

  const connectSocket = useCallback(async () => {
    if (mode === 'off') {
      return null
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return wsRef.current
    }
    if (pendingConnectRef.current) {
      return pendingConnectRef.current
    }

    manualCloseRef.current = false
    pendingConnectRef.current = new Promise<WebSocket | null>(resolve => {
      let settled = false
      const finish = (socket: WebSocket | null) => {
        if (settled) {
          return
        }
        settled = true
        pendingConnectRef.current = null
        resolve(socket)
      }

      try {
        const socket = new WebSocket(resolveInsightsVoiceWebSocketUrl(scope, conversationId))
        wsRef.current = socket

        socket.onopen = () => {
          finish(socket)
        }
        socket.onmessage = event => {
          if (typeof event.data === 'string') {
            handleRawMessage(event.data)
          }
        }
        socket.onerror = () => {
          console.warn('Insights voice websocket error; falling back to text composer.')
          finish(null)
        }
        socket.onclose = () => {
          wsRef.current = null
          inboundBufferRef.current = ''
          if (!manualCloseRef.current) {
            console.warn('Insights voice websocket closed; falling back to text composer.')
            interruptedRef.current = false
            interruptRequestedRef.current = false
            void setRecorderMode('off')
            stopPlayback('idle')
          }
        }
      } catch (error) {
        console.warn('Unable to open insights voice websocket', error)
        finish(null)
      }
    })

    return pendingConnectRef.current
  }, [conversationId, handleRawMessage, mode, scope, setRecorderMode, stopPlayback])

  const start = useCallback(async () => {
    if (mode === 'off') {
      return
    }
    if (voiceState === 'listening') {
      return
    }

    lastTranscriptRef.current = ''
  interruptedRef.current = false
  interruptRequestedRef.current = false
  interruptThresholdStartedAtRef.current = null
    setLastTranscript('')
    setLastAnswer('')
    setOutputLevel(0)

    const socket = await connectSocket()
    if (!socket) {
      setVoiceState('idle')
      return
    }

    setVoiceState('listening')
    try {
      await setRecorderMode('stream')
    } catch (error) {
      console.warn('Unable to start insights voice recording', error)
      disconnectSocket()
      stopPlayback('idle')
    }
  }, [connectSocket, disconnectSocket, mode, setRecorderMode, stopPlayback, voiceState])

  const stop = useCallback(async () => {
    if (voiceState === 'speaking') {
      interrupt()
      return
    }

    if (voiceState === 'listening') {
      await setRecorderMode('off')
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'user_stop' }))
        setVoiceState('thinking')
      } else {
        setVoiceState('idle')
      }
      return
    }

    interruptedRef.current = false
    interruptRequestedRef.current = false
    await setRecorderMode('off')
    disconnectSocket()
    stopPlayback('idle')
  }, [disconnectSocket, interrupt, setRecorderMode, stopPlayback, voiceState])

  useEffect(() => {
    if (voiceState !== 'speaking' || interruptRequestedRef.current) {
      interruptThresholdStartedAtRef.current = null
      return
    }
    if (inputLevel <= INTERRUPT_INPUT_LEVEL_THRESHOLD) {
      interruptThresholdStartedAtRef.current = null
      return
    }

    const now = performance.now()
    if (interruptThresholdStartedAtRef.current === null) {
      interruptThresholdStartedAtRef.current = now
      return
    }

    if (now - interruptThresholdStartedAtRef.current >= INTERRUPT_HOLD_MS) {
      interruptThresholdStartedAtRef.current = null
      interrupt()
    }
  }, [inputLevel, interrupt, voiceState])

  useEffect(() => {
    return () => {
      disconnectSocket()
      void setRecorderMode('off')
      activePlaybackSourcesRef.current.clear()
      stopMeter()
      if (audioContextRef.current) {
        void audioContextRef.current.close()
      }
    }
  }, [disconnectSocket, setRecorderMode, stopMeter])

  return {
    voiceState,
    start,
    stop,
    interrupt,
    lastTranscript,
    lastAnswer,
    outputLevel,
  }
}