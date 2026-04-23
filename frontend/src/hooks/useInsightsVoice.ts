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

interface InsightsVoiceTimingState {
  turnId: string | null
  firstAudioChunkLogged: boolean
  firstPlaybackScheduledLogged: boolean
  userStopSentAtPerfMs: number | null
  userStopSentAtUnixMs: number | null
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
const INTERRUPT_HOLD_MS = 500
const INTERRUPT_CONFIRMATION_MS = 250
const FALSE_INTERRUPTION_TIMEOUT_MS = 2000
// Client-side silence-based auto end-of-turn for full_duplex mode.
// Defaults tuned to match OpenAI Realtime / Azure server-VAD: onset ~240 ms
// of sustained voice above the speech threshold, then 700 ms of silence.
const SPEECH_DETECT_LEVEL_THRESHOLD = 0.12
const SILENCE_MIN_DELAY_MS = 500
const SILENCE_MAX_DELAY_MS = 1500
// Ignore input level readings immediately after entering listening to let the
// mic/AGC settle and avoid startup transients tripping speech detection.
const VAD_WARMUP_MS = 400
const AEC_WARMUP_MS = 2000
// At ~50 Hz level updates, 8 samples ≈ 160 ms of sustained voice, which
// still filters transients but catches short one-word turns like "hello".
const VAD_MIN_SPEECH_SAMPLES = 8
// If a short utterance mostly lands inside warmup, keep a brief lookback so
// it can still arm once warmup expires instead of streaming silence forever.
const VAD_RECENT_SPEECH_LOOKBACK_MS = 250
const MICROPHONE_BLOCKED_ERROR_MESSAGE = 'Microphone blocked - allow access in your browser to use voice.'
const INSECURE_CONTEXT_ERROR_MESSAGE =
  'Voice needs a secure context - open the app at localhost or over HTTPS.'
const VOICE_START_ERROR_MESSAGE = "Voice couldn't start - try again."
const VOICE_CONNECT_ERROR_MESSAGE = "Voice couldn't connect - try again."
const VOICE_RUNTIME_ERROR_MESSAGE = "Voice couldn't continue - try again."

function isMicrophoneAvailable(): boolean {
  if (typeof navigator === 'undefined') return false
  const md = (navigator as Navigator).mediaDevices
  return !!md && typeof md.getUserMedia === 'function'
}

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
  // When served from the app's own origin (prod or dev over HTTPS via Vite proxy),
  // use same-origin ws(s) so TLS and auth cookies carry through.
  if (location.protocol === 'https:') {
    const wsOrigin = `wss://${location.host}`
    return new URL(endpoint, wsOrigin).toString()
  }
  const isLocalDevServer = location.port !== '' && location.port !== '8000'
  if (isLocalDevServer) {
    const backendOrigin = `${location.protocol}//${location.hostname}:8000`
    const backendUrl = new URL(endpoint, backendOrigin)
    backendUrl.protocol = 'ws:'
    return backendUrl.toString()
  }

  const wsOrigin = `ws://${location.host}`
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

function getVoiceErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return MICROPHONE_BLOCKED_ERROR_MESSAGE
    }
  }

  if (error instanceof Error) {
    const normalized = `${error.name} ${error.message}`.toLowerCase()
    if (
      normalized.includes('notallowed') ||
      normalized.includes('permission') ||
      normalized.includes('denied')
    ) {
      return MICROPHONE_BLOCKED_ERROR_MESSAGE
    }
  }

  return fallback
}

function normalizeInsightsVoiceMode(mode: InsightsVoiceMode): InsightsVoiceMode {
  return mode === 'push_to_talk' ? 'full_duplex' : mode
}

export function useInsightsVoice({
  scope,
  conversationId,
  mode = 'full_duplex',
  onCompleted,
}: UseInsightsVoiceOptions) {
  const effectiveMode = normalizeInsightsVoiceMode(mode)
  const [voiceState, setVoiceState] = useState<InsightsVoiceState>('idle')
  const [lastTranscript, setLastTranscript] = useState('')
  const [lastAnswer, setLastAnswer] = useState('')
  const [lastError, setLastError] = useState<string | null>(null)
  const [outputLevel, setOutputLevel] = useState(0)
  const wsRef = useRef<WebSocket | null>(null)
  const pendingConnectRef = useRef<Promise<WebSocket | null> | null>(null)
  const inboundBufferRef = useRef('')
  const intentionalCloseSocketRef = useRef<WebSocket | null>(null)
  const connectFailedRef = useRef(false)
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
  const interruptConfirmationStartedAtRef = useRef<number | null>(null)
  const interruptRequestedRef = useRef(false)
  const interruptedRef = useRef(false)
  const tentativeInterruptRef = useRef(false)
  const pendingInterruptAudioChunksRef = useRef<string[]>([])
  const playbackPausedForInterruptRef = useRef(false)
  const speechDetectedRef = useRef(false)
  const loudSampleCountRef = useRef(0)
  const listeningStartedAtRef = useRef<number | null>(null)
  const lastSpeechAtRef = useRef<number | null>(null)
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const maxDelayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const falseInterruptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const aecWarmupUntilRef = useRef(0)
  const peakLevelRef = useRef(0)
  const stopRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const timingRef = useRef<InsightsVoiceTimingState>({
    turnId: null,
    firstAudioChunkLogged: false,
    firstPlaybackScheduledLogged: false,
    userStopSentAtPerfMs: null,
    userStopSentAtUnixMs: null,
  })

  const resetTiming = useCallback(() => {
    timingRef.current = {
      turnId: null,
      firstAudioChunkLogged: false,
      firstPlaybackScheduledLogged: false,
      userStopSentAtPerfMs: null,
      userStopSentAtUnixMs: null,
    }
  }, [])

  const logTiming = useCallback((stage: string, details: Record<string, unknown> = {}) => {
    console.info('[insights-voice-timing]', {
      stage,
      t: performance.now(),
      turnId: timingRef.current.turnId,
      ...details,
    })
  }, [])

  const { recording, inputLevel, toggleRecording } = useRecorder({
    mode: 'stream',
    onAudioChunk: chunk => {
      if (tentativeInterruptRef.current) {
        pendingInterruptAudioChunksRef.current.push(chunk)
        return
      }
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

  const clearFalseInterruptTimer = useCallback(() => {
    if (falseInterruptTimerRef.current) {
      clearTimeout(falseInterruptTimerRef.current)
      falseInterruptTimerRef.current = null
    }
  }, [])

  const resetTentativeInterrupt = useCallback(() => {
    tentativeInterruptRef.current = false
    interruptConfirmationStartedAtRef.current = null
    pendingInterruptAudioChunksRef.current = []
    clearFalseInterruptTimer()
  }, [clearFalseInterruptTimer])

  const markSocketClosingIntentionally = useCallback(() => {
    if (wsRef.current) {
      intentionalCloseSocketRef.current = wsRef.current
    }
    pendingConnectRef.current = null
    inboundBufferRef.current = ''
  }, [])

  const disconnectSocket = useCallback(() => {
    if (wsRef.current) {
      intentionalCloseSocketRef.current = wsRef.current
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

  const resetListeningDetection = useCallback(() => {
    speechDetectedRef.current = false
    loudSampleCountRef.current = 0
    listeningStartedAtRef.current = null
    lastSpeechAtRef.current = null
    peakLevelRef.current = 0
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
    if (maxDelayTimerRef.current) {
      clearTimeout(maxDelayTimerRef.current)
      maxDelayTimerRef.current = null
    }
  }, [])

  const stopPlayback = useCallback(
    (nextState?: InsightsVoiceState) => {
      resetTentativeInterrupt()
      playbackPausedForInterruptRef.current = false
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
    [resetTentativeInterrupt, stopMeter],
  )

  const pausePlaybackForInterrupt = useCallback(async () => {
    const audioContext = audioContextRef.current
    if (!audioContext || audioContext.state !== 'running') {
      playbackPausedForInterruptRef.current = !!audioContext && audioContext.state === 'suspended'
      return
    }

    await audioContext.suspend()
    playbackPausedForInterruptRef.current = true
  }, [])

  const commitTentativeInterrupt = useCallback(() => {
    if (!tentativeInterruptRef.current || interruptRequestedRef.current) {
      return
    }

    const bufferedChunks = pendingInterruptAudioChunksRef.current.splice(0)
    resetTentativeInterrupt()
    interruptRequestedRef.current = true
    interruptedRef.current = true
    interruptThresholdStartedAtRef.current = null

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'turn.interrupt' }))
      for (const chunk of bufferedChunks) {
        wsRef.current.send(JSON.stringify({ type: 'user_audio_chunk', data: chunk }))
      }
    }
    setVoiceState('interrupted')
    void setRecorderMode('stream').catch(error => {
      console.warn('Unable to switch recorder to streaming after confirmed interruption', error)
    })
  }, [resetTentativeInterrupt, setRecorderMode])

  const rearmListening = useCallback(() => {
    resetTentativeInterrupt()
    playbackPausedForInterruptRef.current = false
    pendingCompletionRef.current = false
    stopMeter()
    setOutputLevel(0)
    interruptRequestedRef.current = false
    interruptedRef.current = false
    interruptThresholdStartedAtRef.current = null
    interruptConfirmationStartedAtRef.current = null
    resetListeningDetection()

    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      setVoiceState('idle')
      return
    }

    setVoiceState('listening')
    void setRecorderMode('stream').catch(error => {
      console.warn('Unable to rearm insights voice recording', error)
      setLastError(getVoiceErrorMessage(error, VOICE_RUNTIME_ERROR_MESSAGE))
      setVoiceState('error')
    })
  }, [resetListeningDetection, resetTentativeInterrupt, setRecorderMode, stopMeter])

  const finishPlaybackIfIdle = useCallback(() => {
    if (activePlaybackCountRef.current > 0) {
      pendingCompletionRef.current = true
      return
    }
    pendingCompletionRef.current = false
    stopMeter()
    setOutputLevel(0)
    if (interruptedRef.current) {
      setVoiceState('interrupted')
      return
    }
    rearmListening()
  }, [rearmListening, stopMeter])

  const resumePlaybackAfterFalseInterrupt = useCallback(async () => {
    const audioContext = audioContextRef.current
    if (audioContext && audioContext.state === 'suspended') {
      await audioContext.resume()
    }
    playbackPausedForInterruptRef.current = false
    if (activePlaybackCountRef.current > 0) {
      setVoiceState('speaking')
      return
    }
    if (pendingCompletionRef.current) {
      finishPlaybackIfIdle()
    }
  }, [finishPlaybackIfIdle])

  const resumeTentativeInterrupt = useCallback(() => {
    if (!tentativeInterruptRef.current || interruptRequestedRef.current) {
      return
    }

    resetTentativeInterrupt()
    if (recorderModeRef.current !== 'monitor') {
      void setRecorderMode('monitor').catch(error => {
        console.warn('Unable to restore monitor mode after false interruption', error)
      })
    }
    void resumePlaybackAfterFalseInterrupt().catch(error => {
      console.warn('Unable to resume playback after false interruption', error)
    })
  }, [resetTentativeInterrupt, resumePlaybackAfterFalseInterrupt, setRecorderMode])

  const beginTentativeInterrupt = useCallback(() => {
    if (tentativeInterruptRef.current || interruptRequestedRef.current) {
      return
    }

    tentativeInterruptRef.current = true
    interruptConfirmationStartedAtRef.current = null
    pendingInterruptAudioChunksRef.current = []
    clearFalseInterruptTimer()
    falseInterruptTimerRef.current = setTimeout(() => {
      falseInterruptTimerRef.current = null
      resumeTentativeInterrupt()
    }, FALSE_INTERRUPTION_TIMEOUT_MS)
    void pausePlaybackForInterrupt().catch(error => {
      console.warn('Unable to pause playback during tentative interruption', error)
    })
  }, [clearFalseInterruptTimer, pausePlaybackForInterrupt, resumeTentativeInterrupt])

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

    if (audioContextRef.current.state === 'suspended' && !playbackPausedForInterruptRef.current) {
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
      const channelSamples = new Float32Array(samples.length)
      channelSamples.set(samples)
      audioBuffer.copyToChannel(channelSamples, 0)

      const source = audioContext.createBufferSource()
      source.buffer = audioBuffer
      source.connect(gainNode)
      activePlaybackSourcesRef.current.add(source)

      const startAt = Math.max(audioContext.currentTime, playbackCursorRef.current)
      if (activePlaybackCountRef.current === 0) {
        aecWarmupUntilRef.current = performance.now() + AEC_WARMUP_MS
      }
      if (!timingRef.current.firstPlaybackScheduledLogged) {
        timingRef.current.firstPlaybackScheduledLogged = true
        logTiming('first_playback_scheduled', {
          scheduleLeadMs: Math.round(Math.max(0, startAt - audioContext.currentTime) * 1000),
          sinceUserStopMs:
            timingRef.current.userStopSentAtPerfMs === null
              ? null
              : Math.round(performance.now() - timingRef.current.userStopSentAtPerfMs),
        })
      }
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
    [ensureAudioGraph, finishPlaybackIfIdle, logTiming],
  )

  const interrupt = useCallback(() => {
    if (interruptRequestedRef.current) {
      return
    }

    resetTentativeInterrupt()
    interruptRequestedRef.current = true
    interruptedRef.current = true
    interruptThresholdStartedAtRef.current = null
    interruptConfirmationStartedAtRef.current = null
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'turn.interrupt' }))
    }
    void setRecorderMode('off')
    stopPlayback('interrupted')
  }, [resetTentativeInterrupt, setRecorderMode, stopPlayback])

  const endSession = useCallback(async () => {
    resetTentativeInterrupt()
    interruptThresholdStartedAtRef.current = null
    interruptConfirmationStartedAtRef.current = null
    interruptRequestedRef.current = false
    interruptedRef.current = false
    pendingCompletionRef.current = false
    aecWarmupUntilRef.current = 0
    resetListeningDetection()
    await setRecorderMode('off')
    disconnectSocket()
    stopPlayback('idle')
  }, [disconnectSocket, resetListeningDetection, resetTentativeInterrupt, setRecorderMode, stopPlayback])

  const handleEnvelope = useCallback(
    (event: InsightsVoiceEnvelope) => {
      switch (event.type) {
        case 'state':
          if (event.agent_state === 'listening') {
            if (activePlaybackCountRef.current === 0) {
              rearmListening()
            }
          } else if (event.agent_state === 'thinking') {
            setVoiceState('thinking')
          } else if (event.agent_state === 'idle' && activePlaybackCountRef.current === 0) {
            setVoiceState('idle')
          }
          break
        case 'turn.started':
          timingRef.current.turnId = event.turn_id
          timingRef.current.firstAudioChunkLogged = false
          timingRef.current.firstPlaybackScheduledLogged = false
          logTiming('turn_started', {
            conversationId: event.conversation_id ?? null,
          })
          break
        case 'turn.final_transcript':
          logTiming('final_transcript', {
            sinceUserStopMs:
              timingRef.current.userStopSentAtPerfMs === null
                ? null
                : Math.round(performance.now() - timingRef.current.userStopSentAtPerfMs),
          })
          lastTranscriptRef.current = event.text
          setLastTranscript(event.text)
          setVoiceState('thinking')
          break
        case 'turn.audio_chunk':
          if (!timingRef.current.firstAudioChunkLogged) {
            timingRef.current.firstAudioChunkLogged = true
            logTiming('first_audio_chunk', {
              sinceUserStopMs:
                timingRef.current.userStopSentAtPerfMs === null
                  ? null
                  : Math.round(performance.now() - timingRef.current.userStopSentAtPerfMs),
            })
          }
          if (interruptRequestedRef.current) {
            break
          }
          if (recorderModeRef.current !== 'monitor') {
            void setRecorderMode('monitor').catch(error => {
              console.warn('Unable to monitor insights voice interruption input', error)
            })
          }
          void enqueueAudioChunk(event)
          break
        case 'turn.interrupted':
          interruptRequestedRef.current = false
          interruptedRef.current = true
          stopPlayback('interrupted')
          rearmListening()
          break
        case 'turn.completed': {
          logTiming('turn_completed', {
            sinceUserStopMs:
              timingRef.current.userStopSentAtPerfMs === null
                ? null
                : Math.round(performance.now() - timingRef.current.userStopSentAtPerfMs),
          })
          const completedEvent = event as TurnCompleted
          const wasInterrupted = interruptedRef.current || interruptRequestedRef.current
          setLastError(null)
          setLastAnswer(completedEvent.answer_text)
          onCompleted?.({
            conversationId: completedEvent.conversation_id,
            transcript: lastTranscriptRef.current,
            answerText: completedEvent.answer_text,
            citations: completedEvent.citations,
            visualizations: completedEvent.visualizations,
          })
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
          interruptedRef.current = false
          interruptRequestedRef.current = false
          setLastError(getVoiceErrorMessage(new Error(event.message), VOICE_RUNTIME_ERROR_MESSAGE))
          stopPlayback('error')
          rearmListening()
          break
        default:
          break
      }
    },
    [
      enqueueAudioChunk,
      finishPlaybackIfIdle,
      logTiming,
      onCompleted,
      rearmListening,
      setRecorderMode,
      stopPlayback,
    ],
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
          if (
            typeof event.type !== 'string' ||
            (event.type !== 'state' && !event.type.startsWith('turn.'))
          ) {
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
    if (effectiveMode === 'off') {
      return null
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return wsRef.current
    }
    if (pendingConnectRef.current) {
      return pendingConnectRef.current
    }

    connectFailedRef.current = false
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
        const wsUrl = resolveInsightsVoiceWebSocketUrl(scope, conversationId)
        console.info('[insights-voice] connecting to', wsUrl)
        const socket = new WebSocket(wsUrl)
        wsRef.current = socket

        socket.onopen = () => {
          console.info('[insights-voice] ws open')
          connectFailedRef.current = false
          finish(socket)
        }
        socket.onmessage = event => {
          if (typeof event.data === 'string') {
            handleRawMessage(event.data)
          }
        }
        socket.onerror = event => {
          console.warn('[insights-voice] ws error', event)
          connectFailedRef.current = true
          finish(null)
        }
        socket.onclose = event => {
          console.warn(
            '[insights-voice] ws close',
            { code: event.code, reason: event.reason, wasClean: event.wasClean },
          )
          const intentionalClose = intentionalCloseSocketRef.current === socket
          if (intentionalClose) {
            intentionalCloseSocketRef.current = null
          }
          if (wsRef.current === socket) {
            wsRef.current = null
          }
          inboundBufferRef.current = ''
          if (!intentionalClose) {
            if (connectFailedRef.current) {
              connectFailedRef.current = false
              return
            }
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
  }, [conversationId, effectiveMode, handleRawMessage, scope, setRecorderMode, stopPlayback])

  const start = useCallback(async () => {
    if (effectiveMode === 'off') {
      return
    }
    if (
      pendingConnectRef.current ||
      voiceState === 'connecting' ||
      voiceState === 'listening'
    ) {
      return
    }

    if (!isMicrophoneAvailable()) {
      setLastError(INSECURE_CONTEXT_ERROR_MESSAGE)
      setVoiceState('error')
      return
    }

    lastTranscriptRef.current = ''
    interruptedRef.current = false
    interruptRequestedRef.current = false
    interruptThresholdStartedAtRef.current = null
    interruptConfirmationStartedAtRef.current = null
    aecWarmupUntilRef.current = 0
    resetTiming()
    resetListeningDetection()
    resetTentativeInterrupt()
    setLastTranscript('')
    setLastAnswer('')
    setLastError(null)
    setOutputLevel(0)
    setVoiceState('connecting')

    const socket = await connectSocket()
    if (!socket) {
      setLastError(VOICE_CONNECT_ERROR_MESSAGE)
      setVoiceState('error')
      return
    }

    try {
      setVoiceState('listening')
      await setRecorderMode('stream')
    } catch (error) {
      console.warn('Unable to start insights voice recording', error)
      disconnectSocket()
      setLastError(getVoiceErrorMessage(error, VOICE_START_ERROR_MESSAGE))
      stopPlayback('error')
    }
  }, [
    connectSocket,
    disconnectSocket,
    effectiveMode,
    resetListeningDetection,
    resetTentativeInterrupt,
    resetTiming,
    setRecorderMode,
    stopPlayback,
    voiceState,
  ])

  const stop = useCallback(async () => {
    if (voiceState === 'speaking') {
      interrupt()
      return
    }

    if (voiceState === 'listening') {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        // Keep the mic stream alive for interruption monitoring so we do not
        // tear it down here and reacquire it again on the first TTS chunk.
        await setRecorderMode('monitor')
        const clientSentAtUnixMs = Date.now()
        timingRef.current.userStopSentAtPerfMs = performance.now()
        timingRef.current.userStopSentAtUnixMs = clientSentAtUnixMs
        logTiming('user_stop_send', { wallClockMs: clientSentAtUnixMs })
        wsRef.current.send(
          JSON.stringify({ type: 'user_stop', client_sent_at_unix_ms: clientSentAtUnixMs }),
        )
        setVoiceState('thinking')
      } else {
        await setRecorderMode('off')
        setVoiceState('idle')
      }
      return
    }

    await endSession()
  }, [endSession, interrupt, logTiming, setRecorderMode, voiceState])

  useEffect(() => {
    stopRef.current = stop
  }, [stop])

  useEffect(() => {
    const now = performance.now()
    if (voiceState !== 'speaking' || interruptRequestedRef.current || tentativeInterruptRef.current) {
      interruptThresholdStartedAtRef.current = null
      return
    }
    if (now < aecWarmupUntilRef.current) {
      interruptThresholdStartedAtRef.current = null
      return
    }
    if (inputLevel <= INTERRUPT_INPUT_LEVEL_THRESHOLD) {
      interruptThresholdStartedAtRef.current = null
      return
    }

    if (interruptThresholdStartedAtRef.current === null) {
      interruptThresholdStartedAtRef.current = now
      return
    }

    if (now - interruptThresholdStartedAtRef.current >= INTERRUPT_HOLD_MS) {
      interruptThresholdStartedAtRef.current = null
      beginTentativeInterrupt()
    }
  }, [beginTentativeInterrupt, inputLevel, voiceState])

  useEffect(() => {
    const now = performance.now()
    if (!tentativeInterruptRef.current || interruptRequestedRef.current || voiceState !== 'speaking') {
      interruptConfirmationStartedAtRef.current = null
      return
    }
    if (inputLevel <= INTERRUPT_INPUT_LEVEL_THRESHOLD) {
      interruptConfirmationStartedAtRef.current = null
      return
    }
    if (interruptConfirmationStartedAtRef.current === null) {
      interruptConfirmationStartedAtRef.current = now
      return
    }
    if (now - interruptConfirmationStartedAtRef.current >= INTERRUPT_CONFIRMATION_MS) {
      interruptConfirmationStartedAtRef.current = null
      commitTentativeInterrupt()
    }
  }, [commitTentativeInterrupt, inputLevel, voiceState])

  // Client-side VAD for full_duplex mode: auto end-of-turn after a short
  // silence, once the user has actually spoken in the current turn.
  useEffect(() => {
    if (effectiveMode !== 'full_duplex' || voiceState !== 'listening') {
      if (listeningStartedAtRef.current !== null) {
        console.info('[insights-voice-vad] turn ended', {
          peakLevel: peakLevelRef.current.toFixed(3),
          armed: speechDetectedRef.current,
        })
      }
      // Clear all VAD timers when we leave listening so stale silence/max-delay
      // callbacks cannot end the session while the agent is thinking/speaking.
      resetListeningDetection()
      return
    }
    const now = performance.now()
    if (listeningStartedAtRef.current === null) {
      listeningStartedAtRef.current = now
    }
    if (inputLevel > peakLevelRef.current) {
      peakLevelRef.current = inputLevel
    }
    const inWarmup = now - listeningStartedAtRef.current < VAD_WARMUP_MS
    const inAecWarmup = now < aecWarmupUntilRef.current
    const armSpeechDetection = (retroactive = false) => {
      if (speechDetectedRef.current) {
        return
      }
      speechDetectedRef.current = true
      console.info('[insights-voice-vad] armed', {
        level: (retroactive ? peakLevelRef.current : inputLevel).toFixed(3),
        samples: loudSampleCountRef.current,
        retroactive,
      })
    }

    if (inAecWarmup) {
      loudSampleCountRef.current = 0
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current)
        silenceTimerRef.current = null
      }
      return
    }

    if (inputLevel > SPEECH_DETECT_LEVEL_THRESHOLD) {
      loudSampleCountRef.current += 1
      if (!inWarmup && loudSampleCountRef.current >= VAD_MIN_SPEECH_SAMPLES) {
        armSpeechDetection()
      }
      lastSpeechAtRef.current = now
      if (speechDetectedRef.current) {
        if (maxDelayTimerRef.current) {
          clearTimeout(maxDelayTimerRef.current)
        }
        maxDelayTimerRef.current = setTimeout(() => {
          maxDelayTimerRef.current = null
          console.info('[insights-voice-vad] max delay stop firing')
          void stopRef.current()
        }, SILENCE_MAX_DELAY_MS)
      }
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current)
        silenceTimerRef.current = null
      }
      return
    }
    // Ignore early quiet samples while AGC settles, but if we captured a short
    // speech burst during warmup, retroactively arm once warmup has elapsed.
    if (inWarmup) {
      return
    }
    if (
      !speechDetectedRef.current &&
      loudSampleCountRef.current >= VAD_MIN_SPEECH_SAMPLES &&
      lastSpeechAtRef.current !== null &&
      now - lastSpeechAtRef.current <= VAD_RECENT_SPEECH_LOOKBACK_MS
    ) {
      armSpeechDetection(true)
    }
    // Quiet frame: decay the loud-sample counter so transient blips don't
    // accumulate across long quiet periods.
    if (loudSampleCountRef.current > 0) {
      loudSampleCountRef.current -= 1
    }
    if (!speechDetectedRef.current) {
      return
    }
    if (silenceTimerRef.current) {
      return
    }
    silenceTimerRef.current = setTimeout(() => {
      silenceTimerRef.current = null
      console.info('[insights-voice-vad] silence stop firing')
      void stopRef.current()
    }, SILENCE_MIN_DELAY_MS)
  }, [effectiveMode, inputLevel, resetListeningDetection, voiceState])

  // Unmount-only cleanup. Using refs so the effect does not re-run when
  // useCallback identities change across renders (which would otherwise tear
  // down the WebSocket mid-handshake).
  const disconnectSocketRef = useRef(disconnectSocket)
  const setRecorderModeRef = useRef(setRecorderMode)
  const stopMeterRef = useRef(stopMeter)
  useEffect(() => {
    disconnectSocketRef.current = disconnectSocket
    setRecorderModeRef.current = setRecorderMode
    stopMeterRef.current = stopMeter
  }, [disconnectSocket, setRecorderMode, stopMeter])
  useEffect(() => {
    return () => {
      clearFalseInterruptTimer()
      disconnectSocketRef.current()
      void setRecorderModeRef.current('off')
      activePlaybackSourcesRef.current.clear()
      stopMeterRef.current()
      if (audioContextRef.current) {
        void audioContextRef.current.close()
      }
    }
  }, [clearFalseInterruptTimer])

  return {
    voiceState,
    start,
    stop,
    interrupt,
    endSession,
    lastTranscript,
    lastAnswer,
    lastError,
    outputLevel,
  }
}