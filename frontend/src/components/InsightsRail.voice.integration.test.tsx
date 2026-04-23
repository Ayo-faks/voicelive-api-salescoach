/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InsightsRail } from './InsightsRail'
import type { InsightsScope } from '../types'

const askInsights = vi.fn()
const listInsightsConversations = vi.fn()
const getInsightsConversation = vi.fn()

let mockRecording = false
const toggleRecording = vi.fn(async () => {
  mockRecording = !mockRecording
})

vi.mock('../services/api', () => ({
  api: {
    askInsights: (...args: unknown[]) => askInsights(...args),
    listInsightsConversations: (...args: unknown[]) =>
      listInsightsConversations(...args),
    getInsightsConversation: (...args: unknown[]) =>
      getInsightsConversation(...args),
  },
}))

vi.mock('../hooks/useRecorder', () => ({
  useRecorder: () => ({
    recording: mockRecording,
    inputLevel: 0,
    toggleRecording,
  }),
}))

class FakeWebSocket {
  static OPEN = 1
  static CLOSED = 3
  static instances: FakeWebSocket[] = []

  url: string
  readyState = FakeWebSocket.OPEN
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null = null
  closeCallCount = 0

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
    queueMicrotask(() => {
      this.onopen?.()
    })
  }

  send() {
    return undefined
  }

  close() {
    this.closeCallCount += 1
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.({ code: 1000, reason: '', wasClean: true })
  }
}

const childScope: InsightsScope = { type: 'child', child_id: 'child-1' }

describe('InsightsRail voice integration', () => {
  const originalWebSocket = window.WebSocket
  const originalMediaDevices = navigator.mediaDevices

  beforeEach(() => {
    askInsights.mockReset()
    listInsightsConversations.mockReset()
    getInsightsConversation.mockReset()
    listInsightsConversations.mockResolvedValue({ conversations: [] })
    toggleRecording.mockClear()
    mockRecording = false
    FakeWebSocket.instances = []
    window.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(),
      },
    })
  })

  afterEach(() => {
    window.WebSocket = originalWebSocket
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: originalMediaDevices,
    })
  })

  it('does not open a second socket when the rail rerenders while voice is active', async () => {
    render(<InsightsRail currentScope={childScope} insightsVoiceMode="push_to_talk" />)

    const voiceAction = (await screen.findByTestId('insights-rail-voice-action')) as HTMLButtonElement
    fireEvent.click(voiceAction)

    await waitFor(() => {
      expect(toggleRecording).toHaveBeenCalledTimes(1)
      expect(FakeWebSocket.instances).toHaveLength(1)
      expect(voiceAction.getAttribute('data-voice-state')).toBe('listening')
    })

    fireEvent.change(screen.getByTestId('insights-rail-input'), {
      target: { value: 'Check recent progress.' },
    })

    await waitFor(() => {
      expect(FakeWebSocket.instances).toHaveLength(1)
      expect(screen.getByTestId('insights-rail-send')).toBeTruthy()
    })
  })

  it('guards against double-click start races', async () => {
    render(<InsightsRail currentScope={childScope} insightsVoiceMode="push_to_talk" />)

    const voiceAction = (await screen.findByTestId('insights-rail-voice-action')) as HTMLButtonElement
    fireEvent.click(voiceAction)
    fireEvent.click(voiceAction)

    await waitFor(() => {
      expect(toggleRecording).toHaveBeenCalledTimes(1)
      expect(FakeWebSocket.instances).toHaveLength(1)
      expect(voiceAction.getAttribute('data-voice-state')).toBe('listening')
    })
  })

  it('ends the active voice session from the orb without treating it as end-turn', async () => {
    render(<InsightsRail currentScope={childScope} insightsVoiceMode="push_to_talk" />)

    const voiceAction = (await screen.findByTestId('insights-rail-voice-action')) as HTMLButtonElement
    fireEvent.click(voiceAction)

    await waitFor(() => {
      expect(toggleRecording).toHaveBeenCalledTimes(1)
      expect(FakeWebSocket.instances).toHaveLength(1)
      expect(voiceAction.getAttribute('data-voice-state')).toBe('listening')
    })

    fireEvent.click(screen.getByTestId('insights-orb-end-session'))

    await waitFor(() => {
      expect(FakeWebSocket.instances[0]?.closeCallCount).toBe(1)
      expect(toggleRecording).toHaveBeenCalledTimes(2)
      expect(voiceAction.getAttribute('data-voice-state')).toBe('idle')
    })
  })
})