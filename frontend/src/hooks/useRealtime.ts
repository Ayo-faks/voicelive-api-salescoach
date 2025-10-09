/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useRef, useState, useCallback } from 'react'
import { Message, TokenUsageBreakdown, TokenUsageEvent } from '../types'

interface RealtimeOptions {
  agentId?: string | null
  onMessage?: (msg: any) => void
  onAudioDelta?: (delta: string) => void
  onTranscript?: (role: 'user' | 'assistant', text: string) => void
}

const createEmptyBreakdown = (): TokenUsageBreakdown => ({
  topLevel: {},
  details: {},
})

const normalizeUsage = (raw: any): TokenUsageBreakdown => {
  const breakdown = createEmptyBreakdown()
  if (!raw || typeof raw !== 'object') {
    return breakdown
  }

  Object.entries(raw).forEach(([key, value]) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      breakdown.topLevel[key] = value
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = Object.entries(value).reduce<Record<string, number>>(
        (acc, [nestedKey, nestedValue]) => {
          if (typeof nestedValue === 'number' && Number.isFinite(nestedValue)) {
            acc[nestedKey] = nestedValue
          }
          return acc
        },
        {}
      )
      if (Object.keys(nested).length > 0) {
        breakdown.details[key] = nested
      }
    }
  })

  return breakdown
}

const addBreakdowns = (
  base: TokenUsageBreakdown,
  addition: TokenUsageBreakdown
): TokenUsageBreakdown => {
  const nextTopLevel = { ...base.topLevel }
  Object.entries(addition.topLevel).forEach(([key, value]) => {
    nextTopLevel[key] = (nextTopLevel[key] ?? 0) + value
  })

  const allDetailKeys = new Set([
    ...Object.keys(base.details),
    ...Object.keys(addition.details),
  ])

  const nextDetails: Record<string, Record<string, number>> = {}
  allDetailKeys.forEach(key => {
    const baseDetail = base.details[key] ?? {}
    const additionDetail = addition.details[key] ?? {}
    const merged: Record<string, number> = { ...baseDetail }
    Object.entries(additionDetail).forEach(([nestedKey, nestedValue]) => {
      merged[nestedKey] = (merged[nestedKey] ?? 0) + nestedValue
    })
    nextDetails[key] = merged
  })

  return {
    topLevel: nextTopLevel,
    details: nextDetails,
  }
}

export function useRealtime(options: RealtimeOptions) {
  const [connected, setConnected] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [usageEvents, setUsageEvents] = useState<TokenUsageEvent[]>([])
  const [latestUsage, setLatestUsage] = useState<TokenUsageBreakdown | null>(
    null
  )
  const [usageTotals, setUsageTotals] = useState<TokenUsageBreakdown>(
    createEmptyBreakdown()
  )
  const [sessionStartTime, setSessionStartTime] = useState<Date | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const wsRef = useRef<WebSocket | null>(null)
  const audioRecording = useRef<any[]>([])
  const conversationRecording = useRef<any[]>([])

  const ensureSessionStarted = useCallback(() => {
    setSessionStartTime(prev => prev ?? new Date())
  }, [])

  const connect = useCallback(async () => {
    const config = await fetch('/api/config').then(r => r.json())
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(
      `${protocol}//${location.host}${config.ws_endpoint}`
    )

    ws.onopen = () => {
      setConnected(true)
      if (options.agentId) {
        ws.send(
          JSON.stringify({
            type: 'session.update',
            session: { agent_id: options.agentId },
          })
        )
      }
    }

    ws.onmessage = event => {
      const msg = JSON.parse(event.data)
      options.onMessage?.(msg)

      switch (msg.type) {
        case 'response.audio.delta':
          if (msg.delta) {
            options.onAudioDelta?.(msg.delta)
            audioRecording.current.push({
              type: 'assistant',
              data: msg.delta,
              timestamp: new Date().toISOString(),
            })
            ensureSessionStarted()
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
            options.onTranscript?.('user', msg.transcript)
            ensureSessionStarted()
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
            options.onTranscript?.('assistant', msg.transcript)
            ensureSessionStarted()
          }
          break
        case 'response.done': {
          const usage = msg.response?.usage
          if (usage) {
            const usageBreakdown = normalizeUsage(usage)
            const event: TokenUsageEvent = {
              id: msg.response?.id ?? crypto.randomUUID(),
              responseId: msg.response?.id,
              timestamp: new Date(),
              usage: usageBreakdown,
            }
            setUsageEvents(prev => [...prev, event])
            setLatestUsage(usageBreakdown)
            setUsageTotals(prev => addBreakdowns(prev, usageBreakdown))
            ensureSessionStarted()
          }
          break
        }
      }
    }

    ws.onclose = () => setConnected(false)
    wsRef.current = ws
  }, [options.agentId, ensureSessionStarted])

  const send = useCallback((data: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(typeof data === 'string' ? data : JSON.stringify(data))
    }
  }, [])

  const clearMessages = useCallback(() => {
    setMessages([])
    setUsageEvents([])
    setLatestUsage(null)
    setUsageTotals(createEmptyBreakdown())
    setSessionStartTime(null)
    setElapsedSeconds(0)
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
    connect()
    return () => wsRef.current?.close()
  }, [connect])

  useEffect(() => {
    setUsageEvents([])
    setLatestUsage(null)
    setUsageTotals(createEmptyBreakdown())
    setSessionStartTime(null)
    setElapsedSeconds(0)
  }, [options.agentId])

  useEffect(() => {
    if (!sessionStartTime) {
      return
    }
    setElapsedSeconds(
      Math.max(0, Math.round((Date.now() - sessionStartTime.getTime()) / 1000))
    )

    const interval = window.setInterval(() => {
      setElapsedSeconds(
        Math.max(
          0,
          Math.round((Date.now() - sessionStartTime.getTime()) / 1000)
        )
      )
    }, 1000)

    return () => window.clearInterval(interval)
  }, [sessionStartTime])

  return {
    connected,
    messages,
    send,
    clearMessages,
    getRecordings,
    usageTotals,
    latestUsage,
    usageEvents,
    elapsedMinutes: elapsedSeconds / 60,
  }
}
