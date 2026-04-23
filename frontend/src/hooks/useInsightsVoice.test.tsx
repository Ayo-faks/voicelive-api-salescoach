/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  static instances: FakeAudioBufferSourceNode[] = []

  buffer: { duration: number } | null = null
  onended: (() => void) | null = null

  constructor() {
    FakeAudioBufferSourceNode.instances.push(this)
  }

  connect() {
    return undefined
  }

  start() {
    return undefined
  }

  stop() {
    this.onended?.()
  }

  finish() {
    this.onended?.()
  }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = []

  state: AudioContextState = 'running'
  currentTime = 1
  destination = {}
  suspendCallCount = 0
  resumeCallCount = 0

  constructor() {
    FakeAudioContext.instances.push(this)
  }

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
    this.state = 'running'
    this.resumeCallCount += 1
    return undefined
  }

  async suspend() {
    this.state = 'suspended'
    this.suspendCallCount += 1
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
  closeCallCount = 0
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null = null

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
    this.closeCallCount += 1
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.({ code: 1000, reason: '', wasClean: true })
  }

  emitMessage(payload: object) {
    this.onmessage?.({ data: `${JSON.stringify(payload)}\n` })
  }

  emitClose(event: { code: number; reason: string; wasClean: boolean }) {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.(event)
  }
}

function HookHarness({
  revision = 0,
  mode = 'push_to_talk',
}: {
  revision?: number
  mode?: 'push_to_talk' | 'full_duplex'
}) {
  void revision
  const { voiceState, start, stop, endSession, lastError } = useInsightsVoice({
    scope: { type: 'child', child_id: 'child-1' },
    conversationId: 'conv-1',
    mode,
  })

  return (
    <div>
      <button type="button" onClick={() => void start()} data-testid="hook-start">
        Start
      </button>
      <button type="button" onClick={() => void stop()} data-testid="hook-stop">
        Stop
      </button>
      <button type="button" onClick={() => void endSession()} data-testid="hook-end-session">
        End session
      </button>
      <div data-testid="hook-state">{voiceState}</div>
      <div data-testid="hook-error">{lastError ?? ''}</div>
    </div>
  )
}

describe('useInsightsVoice', () => {
  const originalAudioContext = window.AudioContext
  const originalRequestAnimationFrame = window.requestAnimationFrame
  const originalCancelAnimationFrame = window.cancelAnimationFrame
  const originalWebSocket = window.WebSocket
  const originalMediaDevices = navigator.mediaDevices

  beforeEach(() => {
    mockRecording = false
    mockInputLevel = 0
    toggleRecording.mockClear()
    FakeAudioBufferSourceNode.instances = []
    FakeWebSocket.instances = []
    FakeAudioContext.instances = []
    vi.spyOn(performance, 'now').mockReturnValue(0)
    window.AudioContext = FakeAudioContext as unknown as typeof AudioContext
    window.requestAnimationFrame = vi.fn(() => 1)
    window.cancelAnimationFrame = vi.fn()
    window.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(),
      },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    window.AudioContext = originalAudioContext
    window.requestAnimationFrame = originalRequestAnimationFrame
    window.cancelAnimationFrame = originalCancelAnimationFrame
    window.WebSocket = originalWebSocket
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: originalMediaDevices,
    })
  })

  it('commits a tentative interruption after continued speech beyond the confirmation window', async () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)

    const { rerender } = render(<HookHarness revision={0} />)

    fireEvent.click(screen.getByTestId('hook-start'))

    await waitFor(() => {
      expect(screen.getByTestId('hook-state').textContent).toBe('listening')
    })

    fireEvent.click(screen.getByTestId('hook-stop'))

    await waitFor(() => {
      const socket = FakeWebSocket.instances[0]
      const userStopMessage = socket?.sent
        .map(payload => JSON.parse(payload))
        .find(payload => payload.type === 'user_stop')
      expect(userStopMessage).toMatchObject({ type: 'user_stop' })
      expect(typeof userStopMessage?.client_sent_at_unix_ms).toBe('number')
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

    now = 2100
    mockInputLevel = 0.2
    rerender(<HookHarness revision={1} />)

    expect(socket.sent).not.toContain(JSON.stringify({ type: 'turn.interrupt' }))

    now = 2600
    mockInputLevel = 0.22
    rerender(<HookHarness revision={2} />)

    await waitFor(() => {
      expect(FakeAudioContext.instances[0]?.suspendCallCount).toBe(1)
    })

    expect(socket.sent).not.toContain(JSON.stringify({ type: 'turn.interrupt' }))

    now = 2900
    mockInputLevel = 0.24
    rerender(<HookHarness revision={3} />)

    await waitFor(() => {
      expect(socket.sent).toContain(JSON.stringify({ type: 'turn.interrupt' }))
      expect(screen.getByTestId('hook-state').textContent).toBe('interrupted')
    })
  })

  it('resumes playback after a false interruption instead of sending turn.interrupt', async () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)

    const { rerender } = render(<HookHarness revision={0} />)

    fireEvent.click(screen.getByTestId('hook-start'))

    await waitFor(() => {
      expect(screen.getByTestId('hook-state').textContent).toBe('listening')
    })

    fireEvent.click(screen.getByTestId('hook-stop'))

    await waitFor(() => {
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

    now = 2100
    mockInputLevel = 0.2
    rerender(<HookHarness revision={1} />)

    now = 2600
    mockInputLevel = 0.22
    rerender(<HookHarness revision={2} />)

    await waitFor(() => {
      expect(FakeAudioContext.instances[0]?.suspendCallCount).toBe(1)
    })

    now = 2650
    mockInputLevel = 0
    rerender(<HookHarness revision={3} />)

    await act(async () => {
      await new Promise(resolve => window.setTimeout(resolve, 2100))
    })

    expect(FakeAudioContext.instances[0]?.resumeCallCount).toBeGreaterThanOrEqual(1)
    expect(screen.getByTestId('hook-state').textContent).toBe('speaking')

    expect(socket.sent).not.toContain(JSON.stringify({ type: 'turn.interrupt' }))
  })

  it('rearms listening after turn.interrupted without closing the socket', async () => {
    render(<HookHarness revision={0} />)

    fireEvent.click(screen.getByTestId('hook-start'))

    await waitFor(() => {
      expect(screen.getByTestId('hook-state').textContent).toBe('listening')
    })

    fireEvent.click(screen.getByTestId('hook-stop'))

    await waitFor(() => {
      const socket = FakeWebSocket.instances[0]
      const userStopMessage = socket?.sent
        .map(payload => JSON.parse(payload))
        .find(payload => payload.type === 'user_stop')
      expect(userStopMessage).toMatchObject({ type: 'user_stop' })
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

    socket.emitMessage({ type: 'turn.interrupted' })

    await waitFor(() => {
      expect(screen.getByTestId('hook-state').textContent).toBe('listening')
    })

    expect(socket.closeCallCount).toBe(0)
  })

  it('does not interrupt during the initial AEC warmup window', async () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)

    const { rerender } = render(<HookHarness revision={0} />)

    fireEvent.click(screen.getByTestId('hook-start'))

    await waitFor(() => {
      expect(screen.getByTestId('hook-state').textContent).toBe('listening')
    })

    fireEvent.click(screen.getByTestId('hook-stop'))

    await waitFor(() => {
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

    now = 600
    mockInputLevel = 0.22
    rerender(<HookHarness revision={1} />)

    expect(socket.sent).not.toContain(JSON.stringify({ type: 'turn.interrupt' }))

    now = 2100
    mockInputLevel = 0.23
    rerender(<HookHarness revision={2} />)

    expect(socket.sent).not.toContain(JSON.stringify({ type: 'turn.interrupt' }))

    now = 2600
    mockInputLevel = 0.24
    rerender(<HookHarness revision={3} />)

    expect(socket.sent).not.toContain(JSON.stringify({ type: 'turn.interrupt' }))

    now = 2900
    mockInputLevel = 0.25
    rerender(<HookHarness revision={4} />)

    await waitFor(() => {
      expect(socket.sent).toContain(JSON.stringify({ type: 'turn.interrupt' }))
    })
  })

  it('rearms listening after recoverable turn.error without closing the socket', async () => {
    render(<HookHarness revision={0} />)

    fireEvent.click(screen.getByTestId('hook-start'))

    await waitFor(() => {
      expect(screen.getByTestId('hook-state').textContent).toBe('listening')
    })

    fireEvent.click(screen.getByTestId('hook-stop'))

    await waitFor(() => {
      expect(screen.getByTestId('hook-state').textContent).toBe('thinking')
    })

    const socket = FakeWebSocket.instances[0]
    expect(socket).toBeTruthy()

    socket.emitMessage({
      type: 'turn.error',
      code: 'turn_failed',
      message: 'Temporary backend hiccup',
    })

    await waitFor(() => {
      expect(screen.getByTestId('hook-state').textContent).toBe('listening')
      expect(screen.getByTestId('hook-error').textContent).toBe("Voice couldn't continue - try again.")
    })

    expect(socket.closeCallCount).toBe(0)
  })

  it('keeps the recorder alive between user_stop and assistant playback', async () => {
    render(<HookHarness revision={0} />)

    fireEvent.click(screen.getByTestId('hook-start'))

    await waitFor(() => {
      expect(screen.getByTestId('hook-state').textContent).toBe('listening')
    })

    expect(toggleRecording).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId('hook-stop'))

    await waitFor(() => {
      const socket = FakeWebSocket.instances[0]
      const userStopMessage = socket?.sent
        .map(payload => JSON.parse(payload))
        .find(payload => payload.type === 'user_stop')
      expect(userStopMessage).toMatchObject({ type: 'user_stop' })
      expect(screen.getByTestId('hook-state').textContent).toBe('thinking')
    })

    expect(toggleRecording).toHaveBeenCalledTimes(1)

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

    expect(toggleRecording).toHaveBeenCalledTimes(1)
  })

  it('auto-stops a short utterance that mostly lands during VAD warmup', async () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)

    const { rerender } = render(<HookHarness revision={0} mode="full_duplex" />)

    fireEvent.click(screen.getByTestId('hook-start'))

    await waitFor(() => {
      expect(screen.getByTestId('hook-state').textContent).toBe('listening')
    })

    const socket = FakeWebSocket.instances[0]
    expect(socket).toBeTruthy()

    for (let index = 1; index <= 12; index += 1) {
      now = index * 20
      mockInputLevel = index % 2 === 0 ? 0.22 : 0.2
      rerender(<HookHarness revision={index} mode="full_duplex" />)
    }

    now = 430
    mockInputLevel = 0
    rerender(<HookHarness revision={99} mode="full_duplex" />)

    await waitFor(
      () => {
        const userStopMessage = socket.sent
          .map(payload => JSON.parse(payload))
          .find(payload => payload.type === 'user_stop')
        expect(userStopMessage).toMatchObject({ type: 'user_stop' })
        expect(screen.getByTestId('hook-state').textContent).toBe('thinking')
      },
      { timeout: 1200 },
    )
  })

  it('completes a one-word "hello" turn end-to-end and returns to listening', async () => {
    // Regression: a single short utterance in full_duplex mode must
    // auto-stop via VAD, receive the assistant answer + TTS, and rearm to
    // listening without any manual end-turn or socket teardown.
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)

    const { rerender } = render(<HookHarness revision={0} mode="full_duplex" />)

    fireEvent.click(screen.getByTestId('hook-start'))

    await waitFor(() => {
      expect(screen.getByTestId('hook-state').textContent).toBe('listening')
    })

    const socket = FakeWebSocket.instances[0]
    expect(socket).toBeTruthy()

    // Simulate a brief voice burst ("hello") followed by silence. Loud
    // samples must clear VAD warmup and the min-samples threshold so that
    // a one-word utterance arms speech detection.
    for (let index = 1; index <= 12; index += 1) {
      now = index * 20
      mockInputLevel = index % 2 === 0 ? 0.22 : 0.2
      rerender(<HookHarness revision={index} mode="full_duplex" />)
    }

    now = 430
    mockInputLevel = 0
    rerender(<HookHarness revision={99} mode="full_duplex" />)

    // Client-side VAD should emit a user_stop and move to thinking.
    await waitFor(
      () => {
        const userStopMessage = socket.sent
          .map(payload => JSON.parse(payload))
          .find(payload => payload.type === 'user_stop')
        expect(userStopMessage).toMatchObject({ type: 'user_stop' })
        expect(screen.getByTestId('hook-state').textContent).toBe('thinking')
      },
      { timeout: 1200 },
    )

    // Backend responds with transcript, TTS, completion, then listening.
    socket.emitMessage({ type: 'turn.final_transcript', text: 'hello' })
    socket.emitMessage({
      type: 'turn.audio_chunk',
      data_b64: btoa(String.fromCharCode(0, 0, 1, 0)),
      format: 'raw-24khz-16bit-mono-pcm',
    })

    await waitFor(() => {
      expect(screen.getByTestId('hook-state').textContent).toBe('speaking')
    })

    socket.emitMessage({
      type: 'turn.completed',
      conversation_id: 'conv-1',
      answer_text: 'Hi there!',
    })

    // Playback drains → auto-rearm without closing the socket.
    act(() => {
      FakeAudioBufferSourceNode.instances[0]?.finish()
    })

    await waitFor(() => {
      expect(screen.getByTestId('hook-state').textContent).toBe('listening')
    })

    expect(socket.closeCallCount).toBe(0)
    // No manual end-turn / end-session was invoked.
    expect(socket.sent).not.toContain(JSON.stringify({ type: 'turn.interrupt' }))
  })

  it('does not end the session from a stale VAD max-delay timer while thinking', async () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)

    const { rerender } = render(<HookHarness revision={0} mode="full_duplex" />)

    fireEvent.click(screen.getByTestId('hook-start'))

    await waitFor(() => {
      expect(screen.getByTestId('hook-state').textContent).toBe('listening')
    })

    const socket = FakeWebSocket.instances[0]
    expect(socket).toBeTruthy()

    for (let index = 1; index <= 12; index += 1) {
      now = index * 20
      mockInputLevel = index % 2 === 0 ? 0.22 : 0.2
      rerender(<HookHarness revision={index} mode="full_duplex" />)
    }

    now = 430
    mockInputLevel = 0
    rerender(<HookHarness revision={99} mode="full_duplex" />)

    await waitFor(
      () => {
        const userStopMessage = socket.sent
          .map(payload => JSON.parse(payload))
          .find(payload => payload.type === 'user_stop')
        expect(userStopMessage).toMatchObject({ type: 'user_stop' })
        expect(screen.getByTestId('hook-state').textContent).toBe('thinking')
      },
      { timeout: 1200 },
    )

    act(() => {
      socket.emitMessage({
        type: 'turn.final_transcript',
        text: 'Hello.',
      })
    })

    expect(screen.getByTestId('hook-state').textContent).toBe('thinking')

    await act(async () => {
      await new Promise(resolve => window.setTimeout(resolve, 1800))
    })

    expect(socket.closeCallCount).toBe(0)
    expect(screen.getByTestId('hook-state').textContent).toBe('thinking')

    act(() => {
      socket.emitMessage({
        type: 'turn.completed',
        conversation_id: 'conv-1',
        answer_text: 'Hi there!',
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId('hook-state').textContent).toBe('listening')
    })
  })

  it('auto-rearms after turn.completed without client-closing the socket', async () => {
    render(<HookHarness revision={0} />)

    fireEvent.click(screen.getByTestId('hook-start'))

    await waitFor(() => {
      expect(screen.getByTestId('hook-state').textContent).toBe('listening')
    })

    fireEvent.click(screen.getByTestId('hook-stop'))

    await waitFor(() => {
      const socket = FakeWebSocket.instances[0]
      const userStopMessage = socket?.sent
        .map(payload => JSON.parse(payload))
        .find(payload => payload.type === 'user_stop')
      expect(userStopMessage).toMatchObject({ type: 'user_stop' })
      expect(screen.getByTestId('hook-state').textContent).toBe('thinking')
    })

    const socket = FakeWebSocket.instances[0]
    expect(socket).toBeTruthy()

    socket.emitMessage({
      type: 'turn.completed',
      conversation_id: 'conv-1',
      answer_text: 'Done.',
    })

    await waitFor(() => {
      expect(screen.getByTestId('hook-state').textContent).toBe('listening')
    })

    expect(socket.closeCallCount).toBe(0)
    expect(toggleRecording).toHaveBeenCalledTimes(1)
  })

  it('returns from speaking to listening after playback drains', async () => {
    render(<HookHarness revision={0} />)

    fireEvent.click(screen.getByTestId('hook-start'))

    await waitFor(() => {
      expect(screen.getByTestId('hook-state').textContent).toBe('listening')
    })

    fireEvent.click(screen.getByTestId('hook-stop'))

    await waitFor(() => {
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

    socket.emitMessage({
      type: 'turn.completed',
      conversation_id: 'conv-1',
      answer_text: 'Done.',
    })

    expect(screen.getByTestId('hook-state').textContent).toBe('speaking')

    FakeAudioBufferSourceNode.instances[0]?.finish()

    await waitFor(() => {
      expect(screen.getByTestId('hook-state').textContent).toBe('listening')
    })

    expect(socket.closeCallCount).toBe(0)
    expect(toggleRecording).toHaveBeenCalledTimes(1)
  })

  it('accepts backend state envelopes', async () => {
    render(<HookHarness revision={0} />)

    fireEvent.click(screen.getByTestId('hook-start'))

    await waitFor(() => {
      expect(screen.getByTestId('hook-state').textContent).toBe('listening')
    })

    fireEvent.click(screen.getByTestId('hook-stop'))

    await waitFor(() => {
      expect(screen.getByTestId('hook-state').textContent).toBe('thinking')
    })

    const socket = FakeWebSocket.instances[0]
    expect(socket).toBeTruthy()

    socket.emitMessage({
      type: 'state',
      agent_state: 'listening',
    })

    await waitFor(() => {
      expect(screen.getByTestId('hook-state').textContent).toBe('listening')
    })
  })

  it('ends the voice session explicitly without treating it as end-turn', async () => {
    render(<HookHarness revision={0} />)

    fireEvent.click(screen.getByTestId('hook-start'))

    await waitFor(() => {
      expect(screen.getByTestId('hook-state').textContent).toBe('listening')
    })

    const socket = FakeWebSocket.instances[0]
    expect(socket).toBeTruthy()

    fireEvent.click(screen.getByTestId('hook-end-session'))

    await waitFor(() => {
      expect(screen.getByTestId('hook-state').textContent).toBe('idle')
    })

    expect(socket.closeCallCount).toBe(1)
    expect(toggleRecording).toHaveBeenCalledTimes(2)
    expect(socket.sent).not.toContain(JSON.stringify({ type: 'user_stop' }))
  })

  it('ignores post-playback echo during the AEC warmup window', async () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)

    const { rerender } = render(<HookHarness revision={0} mode="full_duplex" />)

    fireEvent.click(screen.getByTestId('hook-start'))

    await waitFor(() => {
      expect(screen.getByTestId('hook-state').textContent).toBe('listening')
    })

    fireEvent.click(screen.getByTestId('hook-stop'))

    await waitFor(() => {
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

    socket.emitMessage({
      type: 'turn.completed',
      conversation_id: 'conv-1',
      answer_text: 'Done.',
    })

    now = 100
    act(() => {
      FakeAudioBufferSourceNode.instances[0]?.finish()
    })

    await waitFor(() => {
      expect(screen.getByTestId('hook-state').textContent).toBe('listening')
    })

    vi.useFakeTimers()

    const userStopMessagesBeforeWarmup = socket.sent.filter(payload => {
      return JSON.parse(payload).type === 'user_stop'
    }).length

    for (let index = 1; index <= 12; index += 1) {
      now = 100 + index * 20
      mockInputLevel = 0.22
      rerender(<HookHarness revision={index} mode="full_duplex" />)
    }

    now = 500
    mockInputLevel = 0
    rerender(<HookHarness revision={99} mode="full_duplex" />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700)
    })

    const userStopMessagesAfterWarmup = socket.sent.filter(payload => {
      return JSON.parse(payload).type === 'user_stop'
    }).length

    expect(userStopMessagesAfterWarmup).toBe(userStopMessagesBeforeWarmup)
  })

  it('surfaces microphone permission failures as an error state', async () => {
    toggleRecording.mockRejectedValueOnce(
      new DOMException('Permission denied', 'NotAllowedError'),
    )

    render(<HookHarness />)

    fireEvent.click(screen.getByTestId('hook-start'))

    await waitFor(() => {
      expect(screen.getByTestId('hook-state').textContent).toBe('error')
      expect(screen.getByTestId('hook-error').textContent).toBe(
        'Microphone blocked - allow access in your browser to use voice.',
      )
    })
  })
})