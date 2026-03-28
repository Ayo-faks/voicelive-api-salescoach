/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../services/api'
import type { Message } from '../types'

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
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(
        `${protocol}//${location.host}${config.ws_endpoint}`
      )

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
        case 'conversation.item.input_audio_transcription.completed':
          if (msg.transcript) {
            const message: Message = {
              id: crypto.randomUUID(),
              role: 'user',
              content: msg.transcript,
              timestamp: new Date(),
            }
            setMessages(prev => [...prev, message])
            conversationRecording.current.push({
              role: 'user',
              content: msg.transcript,
            })
            callbackRefs.current.onTranscript?.('user', msg.transcript)
          }
          break
        case 'response.audio_transcript.done':
          if (msg.transcript) {
            const message: Message = {
              id: crypto.randomUUID(),
              role: 'assistant',
              content: msg.transcript,
              timestamp: new Date(),
            }
            setMessages(prev => [...prev, message])
            conversationRecording.current.push({
              role: 'assistant',
              content: msg.transcript,
            })
            callbackRefs.current.onTranscript?.('assistant', msg.transcript)
          }
          break
        case 'proxy.connected':
          setConnectionState('connected')
          setConnectionMessage('Voice connection ready.')
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
  }, [clearReconnectTimer, closeSocket])

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
    send,
    disconnect,
    clearMessages,
    getRecordings,
  }
}
