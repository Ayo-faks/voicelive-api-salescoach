/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useInsightsVoice } from './useInsightsVoice'

let mockRecording = false
let mockInputLevel = 0
const toggleRecording = vi.fn(async () => {
  mockRecording = !mockRecording
})

vi.mock('./useRecorder', () => ({
  useRecorder: () => ({
    recording: mockRecording,
    inputLevel: mockInputLevel,
    toggleRecording,
  }),
}))

class FakeAudioBufferSourceNode {
  buffer: { duration: number } | null = null
  onended: (() => void) | null = null

  connect() {
    return undefined
  }

  start() {
    return undefined
  }

  stop() {
    this.onended?.()
  }
}

class FakeAudioContext {
  state: AudioContextState = 'running'
  currentTime = 1
  destination = {}

  createGain() {
    return { connect: vi.fn() }
  }

  createAnalyser() {
    return {
      fftSize: 0,
      smoothingTimeConstant: 0,
      connect: vi.fn(),
      getFloatTimeDomainData: (data: Float32Array) => data.fill(0),
    }
  }

  createBuffer(_channels: number, length: number, sampleRate: number) {
    return {
      duration: length / sampleRate,
      copyToChannel: vi.fn(),
    }
  }

  createBufferSource() {
    return new FakeAudioBufferSourceNode()
  }

  async resume() {
    return undefined
  }

  async close() {
    return undefined
  }
}

class FakeWebSocket {
  static OPEN = 1
  static CLOSED = 3
  static instances: FakeWebSocket[] = []

  url: string
  readyState = FakeWebSocket.OPEN
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
    queueMicrotask(() => {
      this.onopen?.()
    })
  }

  send(payload: string) {
    this.sent.push(payload)
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.()
  }

  emitMessage(payload: object) {
    this.onmessage?.({ data: `${JSON.stringify(payload)}\n` })
  }
}

function HookHarness({ revision = 0 }: { revision?: number }) {
  void revision
  const { voiceState, start, stop } = useInsightsVoice({
    scope: { type: 'child', child_id: 'child-1' },
    conversationId: 'conv-1',
    mode: 'push_to_talk',
  })

  return (
    <div>
      <button type="button" onClick={() => void start()} data-testid="hook-start">
        Start
      </button>
      <button type="button" onClick={() => void stop()} data-testid="hook-stop">
        Stop
      </button>
      <div data-testid="hook-state">{voiceState}</div>
    </div>
  )
}

describe('useInsightsVoice', () => {
  const originalAudioContext = window.AudioContext
  const originalRequestAnimationFrame = window.requestAnimationFrame
  const originalCancelAnimationFrame = window.cancelAnimationFrame
  const originalWebSocket = window.WebSocket

  beforeEach(() => {
    mockRecording = false
    mockInputLevel = 0
    toggleRecording.mockClear()
    FakeWebSocket.instances = []
    vi.spyOn(performance, 'now').mockReturnValue(0)
    window.AudioContext = FakeAudioContext as unknown as typeof AudioContext
    window.requestAnimationFrame = vi.fn(() => 1)
    window.cancelAnimationFrame = vi.fn()
    window.WebSocket = FakeWebSocket as unknown as typeof WebSocket
  })

  afterEach(() => {
    vi.restoreAllMocks()
    window.AudioContext = originalAudioContext
    window.requestAnimationFrame = originalRequestAnimationFrame
    window.cancelAnimationFrame = originalCancelAnimationFrame
    window.WebSocket = originalWebSocket
  })

  it('sends turn.interrupt after sustained live input while speaking', async () => {
    const { rerender } = render(<HookHarness revision={0} />)

    fireEvent.click(screen.getByTestId('hook-start'))

    await waitFor(() => {
      expect(screen.getByTestId('hook-state').textContent).toBe('listening')
    })

    fireEvent.click(screen.getByTestId('hook-stop'))

    await waitFor(() => {
      const socket = FakeWebSocket.instances[0]
      expect(socket?.sent).toContain(JSON.stringify({ type: 'user_stop' }))
      expect(screen.getByTestId('hook-state').textContent).toBe('thinking')
    })

    const socket = FakeWebSocket.instances[0]
    expect(socket).toBeTruthy()

    socket.emitMessage({
      type: 'turn.audio_chunk',
      data_b64: btoa(String.fromCharCode(0, 0, 1, 0)),
      format: 'raw-24khz-16bit-mono-pcm',
    })

    await waitFor(() => {
      expect(screen.getByTestId('hook-state').textContent).toBe('speaking')
    })

    mockInputLevel = 0.2
    rerender(<HookHarness revision={1} />)

    vi.spyOn(performance, 'now').mockReturnValue(250)
    mockInputLevel = 0.22
    rerender(<HookHarness revision={2} />)

    await waitFor(() => {
      expect(socket.sent).toContain(JSON.stringify({ type: 'turn.interrupt' }))
      expect(screen.getByTestId('hook-state').textContent).toBe('interrupted')
    })
  })
})