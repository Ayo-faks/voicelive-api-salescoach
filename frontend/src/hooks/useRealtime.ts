/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../services/api'
import { normalizeStreamingDrillText, replaceDrillTokens } from '../utils/drillTokens'
import type { AppConfig, Message } from '../types'

type RealtimeEvent = Record<string, unknown> & {
  type?: string
  delta?: string
  transcript?: string
}

type AssistantAudioRecording = {
  type: 'assistant'
  data: string
  timestamp: string
}

type ConversationRecording = {
  role: 'user' | 'assistant'
  content: string
}

export type RealtimeConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'

interface RealtimeOptions {
  agentId?: string | null
  onMessage?: (msg: RealtimeEvent) => void
  onAudioDelta?: (delta: string) => void
  onTranscript?: (role: 'user' | 'assistant', text: string) => void
}

function resolveWebSocketUrl(config: AppConfig): string {
  const configuredUrl =
    typeof config.ws_url === 'string' && config.ws_url.trim().length > 0
      ? config.ws_url
      : null

  if (configuredUrl) {
    return configuredUrl
  }

  const endpoint =
    typeof config.ws_endpoint === 'string' && config.ws_endpoint.trim().length > 0
      ? config.ws_endpoint
      : '/ws/voice'

  if (/^wss?:\/\//.test(endpoint)) {
    return endpoint
  }

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

function createClientMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function useRealtime(options: RealtimeOptions) {
  const [connected, setConnected] = useState(false)
  const [connectionState, setConnectionState] =
    useState<RealtimeConnectionState>('connecting')
  const [connectionMessage, setConnectionMessage] = useState(
    'Connecting to your practice buddy...'
  )
  const [messages, setMessages] = useState<Message[]>([])
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<number | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const manualCloseRef = useRef(false)
  const agentIdRef = useRef(options.agentId)
  const lastSessionAgentIdRef = useRef<string | null>(null)
  const callbackRefs = useRef({
    onMessage: options.onMessage,
    onAudioDelta: options.onAudioDelta,
    onTranscript: options.onTranscript,
  })
  const audioRecording = useRef<AssistantAudioRecording[]>([])
  const conversationRecording = useRef<ConversationRecording[]>([])
  const streamingUserMessageRef = useRef<{
    id: string
    content: string
  } | null>(null)
  const streamingAssistantMessageRef = useRef<{
    id: string
    content: string
  } | null>(null)

  const formatRealtimeText = useCallback(
    (role: 'user' | 'assistant', text: string, streaming = false) => {
      if (role !== 'assistant') {
        return text
      }

      return streaming ? normalizeStreamingDrillText(text) : replaceDrillTokens(text)
    },
    []
  )

  const appendStreamingMessage = useCallback(
    (role: 'user' | 'assistant', deltaText: string) => {
      if (!deltaText) {
        return
      }

      const targetRef =
        role === 'user' ? streamingUserMessageRef : streamingAssistantMessageRef
      const activeStreamingMessage = targetRef.current

      if (!activeStreamingMessage) {
        const id = createClientMessageId()
        const nextContent = deltaText
        targetRef.current = {
          id,
          content: nextContent,
        }
        setMessages(prev => [
          ...prev,
          {
            id,
            role,
            content: formatRealtimeText(role, nextContent, true),
            timestamp: new Date(),
            streaming: true,
          },
        ])
        return
      }

      const nextContent = `${activeStreamingMessage.content}${deltaText}`
      targetRef.current = {
        ...activeStreamingMessage,
        content: nextContent,
      }
      const nextVisibleContent = formatRealtimeText(role, nextContent, true)
      setMessages(prev =>
        prev.map(message =>
          message.id === activeStreamingMessage.id
            ? { ...message, content: nextVisibleContent, streaming: true }
            : message
        )
      )
    },
    [formatRealtimeText]
  )

  const finalizeStreamingMessage = useCallback(
    (role: 'user' | 'assistant', finalTranscript: string) => {
      const targetRef =
        role === 'user' ? streamingUserMessageRef : streamingAssistantMessageRef
      const activeStreamingMessage = targetRef.current
      const nextVisibleTranscript = formatRealtimeText(role, finalTranscript)

      if (activeStreamingMessage) {
        setMessages(prev =>
          prev.map(message =>
            message.id === activeStreamingMessage.id
              ? {
                ...message,
                content: nextVisibleTranscript,
                streaming: false,
              }
              : message
          )
        )
        targetRef.current = null
        return
      }

      const message: Message = {
        id: createClientMessageId(),
        role,
        content: nextVisibleTranscript,
        timestamp: new Date(),
        streaming: false,
      }
      setMessages(prev => [...prev, message])
    },
    [formatRealtimeText]
  )

  useEffect(() => {
    callbackRefs.current = {
      onMessage: options.onMessage,
      onAudioDelta: options.onAudioDelta,
      onTranscript: options.onTranscript,
    }
  }, [options.onAudioDelta, options.onMessage, options.onTranscript])

  useEffect(() => {
    agentIdRef.current = options.agentId
  }, [options.agentId])

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
  }, [])

  const closeSocket = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onopen = null
      wsRef.current.onmessage = null
      wsRef.current.onclose = null
      wsRef.current.onerror = null
      wsRef.current.close()
      wsRef.current = null
    }
  }, [])

  const connect = useCallback(async () => {
    clearReconnectTimer()
    closeSocket()
    setConnectionState(previousState =>
      previousState === 'reconnecting' ? 'reconnecting' : 'connecting'
    )
    setConnectionMessage(
      reconnectAttemptsRef.current > 0
        ? 'Connection lost. Reconnecting...'
        : 'Connecting to your practice buddy...'
    )

    try {
      const config = await api.getConfig()
      const ws = new WebSocket(resolveWebSocketUrl(config))

      ws.onopen = () => {
        reconnectAttemptsRef.current = 0
        setConnected(true)
        setConnectionState('connected')
        setConnectionMessage('Voice connection ready.')
        const activeAgentId = agentIdRef.current

        if (activeAgentId) {
          lastSessionAgentIdRef.current = activeAgentId
          ws.send(
            JSON.stringify({
              type: 'session.update',
              session: { agent_id: activeAgentId },
            })
          )
        }
      }

      ws.onmessage = event => {
        const msg = JSON.parse(event.data) as RealtimeEvent
        callbackRefs.current.onMessage?.(msg)

        switch (msg.type) {
        case 'response.audio.delta':
          if (msg.delta) {
            callbackRefs.current.onAudioDelta?.(msg.delta)
            audioRecording.current.push({
              type: 'assistant',
              data: msg.delta,
              timestamp: new Date().toISOString(),
            })
          }
          break
        case 'conversation.item.input_audio_transcription.delta': {
          const deltaText =
            typeof msg.delta === 'string'
              ? msg.delta
              : typeof msg.transcript === 'string'
                ? msg.transcript
                : ''

          appendStreamingMessage('user', deltaText)
          break
        }
        case 'conversation.item.input_audio_transcription.completed':
          if (msg.transcript) {
            finalizeStreamingMessage('user', msg.transcript)
            conversationRecording.current.push({
              role: 'user',
              content: msg.transcript,
            })
            callbackRefs.current.onTranscript?.('user', msg.transcript)
          }
          break
        case 'conversation.item.input_audio_transcription.failed':
          if (streamingUserMessageRef.current) {
            setMessages(prev =>
              prev.filter(message => message.id !== streamingUserMessageRef.current?.id)
            )
            streamingUserMessageRef.current = null
          }
          break
        case 'response.audio_transcript.delta': {
          const deltaText =
            typeof msg.delta === 'string'
              ? msg.delta
              : typeof msg.transcript === 'string'
                ? msg.transcript
                : ''

          appendStreamingMessage('assistant', deltaText)
          break
        }
        case 'response.audio_transcript.done':
          if (msg.transcript) {
            const finalTranscript = replaceDrillTokens(msg.transcript)
            finalizeStreamingMessage('assistant', finalTranscript)
            conversationRecording.current.push({
              role: 'assistant',
              content: finalTranscript,
            })
            callbackRefs.current.onTranscript?.('assistant', finalTranscript)
          }
          break
        case 'proxy.connected':
          setConnectionState('connected')
          setConnectionMessage('Voice connection ready.')
          break
        case 'wulo.avatar_retrying': {
          // Azure Voice Live avatar is saturated; backend will retry.
          const payload = (msg as { payload?: { attempt?: number; max_attempts?: number } }).payload
          const attempt = payload?.attempt ?? 1
          const maxAttempts = payload?.max_attempts ?? 3
          setConnectionMessage(
            `Avatar service is busy — retrying (${attempt}/${maxAttempts})...`,
          )
          break
        }
        case 'wulo.avatar_unavailable':
          // Surrender after repeated saturation; session continues voice-only.
          setConnectionMessage(
            'Avatar service is unavailable right now — continuing with voice only.',
          )
          break
      }

      }

      ws.onerror = () => {
        setConnectionMessage('Connection lost. Reconnecting...')
      }

      ws.onclose = () => {
        setConnected(false)
        wsRef.current = null

        if (manualCloseRef.current) {
          setConnectionState('disconnected')
          setConnectionMessage('Voice connection paused.')
          return
        }

        setConnectionState('reconnecting')
        setConnectionMessage('Connection lost. Reconnecting...')
        reconnectAttemptsRef.current += 1
        const retryDelay = Math.min(
          5000,
          1000 * 2 ** (reconnectAttemptsRef.current - 1)
        )
        reconnectTimerRef.current = window.setTimeout(() => {
          void connect()
        }, retryDelay)
      }

      wsRef.current = ws
    } catch {
      setConnected(false)
      setConnectionState('reconnecting')
      setConnectionMessage('Connection lost. Reconnecting...')
      reconnectAttemptsRef.current += 1
      const retryDelay = Math.min(
        5000,
        1000 * 2 ** (reconnectAttemptsRef.current - 1)
      )
      reconnectTimerRef.current = window.setTimeout(() => {
        void connect()
      }, retryDelay)
    }
  }, [
    appendStreamingMessage,
    clearReconnectTimer,
    closeSocket,
    finalizeStreamingMessage,
  ])

  const send = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(typeof data === 'string' ? data : JSON.stringify(data))
    }
  }, [])

  const disconnect = useCallback(() => {
    manualCloseRef.current = true
    clearReconnectTimer()
    closeSocket()
    lastSessionAgentIdRef.current = null
    setConnected(false)
    setConnectionState('disconnected')
  }, [clearReconnectTimer, closeSocket])

  const clearMessages = useCallback(() => {
    setMessages([])
    conversationRecording.current = []
    audioRecording.current = []
    streamingUserMessageRef.current = null
    streamingAssistantMessageRef.current = null
  }, [])

  const addLocalMessage = useCallback((role: 'user' | 'assistant', content: string) => {
    const trimmedContent = content.trim()

    if (!trimmedContent) {
      return
    }

    const id = createClientMessageId()
    setMessages(prev => [
      ...prev,
      {
        id,
        role,
        content: trimmedContent,
        timestamp: new Date(),
        streaming: false,
      },
    ])
    conversationRecording.current.push({
      role,
      content: trimmedContent,
    })
  }, [])

  const getRecordings = useCallback(
    () => ({
      conversation: conversationRecording.current,
      audio: audioRecording.current,
    }),
    []
  )

  useEffect(() => {
    manualCloseRef.current = false
    connect()
    return () => {
      manualCloseRef.current = true
      clearReconnectTimer()
      closeSocket()
      setConnected(false)
    }
  }, [clearReconnectTimer, closeSocket, connect])

  useEffect(() => {
    const nextAgentId = options.agentId || null

    if (!nextAgentId) {
      return
    }

    const socket = wsRef.current

    // If disconnected (e.g. after going home), reconnect for the new session.
    // connect() will send session.update with the current agentId on ws.onopen.
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      manualCloseRef.current = false
      void connect()
      return
    }

    if (lastSessionAgentIdRef.current === nextAgentId) {
      return
    }

    lastSessionAgentIdRef.current = nextAgentId
    socket.send(
      JSON.stringify({
        type: 'session.update',
        session: { agent_id: nextAgentId },
      })
    )
  }, [options.agentId, connect])

  return {
    connected,
    connectionState,
    connectionMessage,
    messages,
    addLocalMessage,
    send,
    disconnect,
    clearMessages,
    getRecordings,
  }
}
