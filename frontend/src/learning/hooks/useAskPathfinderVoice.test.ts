import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const playAudioMock = vi.fn()
const stopAudioMock = vi.fn()
const toggleRecordingMock = vi.fn(async () => undefined)

vi.mock('../../hooks/useAudioPlayer', () => ({
  useAudioPlayer: () => ({
    playAudio: playAudioMock,
    stopAudio: stopAudioMock,
  }),
}))

vi.mock('../../hooks/useRecorder', () => ({
  useRecorder: () => ({
    recording: false,
    inputLevel: 0,
    toggleRecording: toggleRecordingMock,
  }),
}))

import { useAskPathfinderVoice } from './useAskPathfinderVoice'

class FakeWebSocket {
  static OPEN = 1
  static instances: FakeWebSocket[] = []

  readyState = FakeWebSocket.OPEN
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  sent: string[] = []

  constructor(public url: string) {
    FakeWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.onclose?.()
  }
}

describe('useAskPathfinderVoice', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    playAudioMock.mockReset()
    stopAudioMock.mockReset()
    toggleRecordingMock.mockReset()
    vi.stubGlobal('WebSocket', FakeWebSocket)
  })

  it('opens learner_ask websocket and sends bootstrap frames on open', () => {
    renderHook(() =>
      useAskPathfinderVoice({
        active: true,
        childId: 'learner-1',
        classYear: 'JSS3',
        subject: 'maths',
        onBlock: vi.fn(),
      })
    )

    expect(FakeWebSocket.instances).toHaveLength(1)
    const ws = FakeWebSocket.instances[0]
    expect(ws.url).toContain('/ws/voice')
    expect(ws.url).toContain('scope=learner_ask')
    expect(ws.url).toContain('child_id=learner-1')
    expect(ws.url).toContain('class_year=JSS3')
    expect(ws.url).toContain('subject=maths')

    act(() => {
      ws.onopen?.()
    })

    const sent = ws.sent.map(msg => JSON.parse(msg) as { type: string })
    expect(sent[0].type).toBe('session.update')
    expect(sent[1].type).toBe('conversation.item.create')
    expect(sent[2].type).toBe('response.create')
  })

  it('forwards assistant blocks, transcripts, and audio deltas from ws events', () => {
    const onBlock = vi.fn()
    const onUserTranscript = vi.fn()

    renderHook(() =>
      useAskPathfinderVoice({
        active: true,
        childId: 'learner-1',
        onBlock,
        onUserTranscript,
      })
    )

    const ws = FakeWebSocket.instances[0]

    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: 'wulo.assistant_block',
          payload: {
            block: { kind: 'prose', text: 'Hello', speak: 'Hello', citations: [] },
            session_complete: false,
          },
        }),
      })
    })
    expect(onBlock).toHaveBeenCalledTimes(1)

    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: 'conversation.item.input_audio_transcription.completed',
          transcript: 'I need help',
        }),
      })
    })
    expect(onUserTranscript).toHaveBeenCalledWith('I need help')

    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({ type: 'response.audio.delta', delta: 'AAAA' }),
      })
    })
    expect(playAudioMock).toHaveBeenCalledWith('AAAA')
  })

  it('barges in: flushes playback and drops straggler deltas on speech_started', () => {
    renderHook(() =>
      useAskPathfinderVoice({
        active: true,
        childId: 'learner-1',
        onBlock: vi.fn(),
      })
    )

    const ws = FakeWebSocket.instances[0]

    // Tutor is mid-reply and audio is streaming.
    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({ type: 'response.created' }),
      })
      ws.onmessage?.({
        data: JSON.stringify({ type: 'response.audio.delta', delta: 'AAAA' }),
      })
    })
    expect(playAudioMock).toHaveBeenCalledTimes(1)

    // Learner talks over the tutor → flush buffered audio immediately.
    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({ type: 'input_audio_buffer.speech_started' }),
      })
    })
    expect(stopAudioMock).toHaveBeenCalledTimes(1)

    // Straggler deltas from the interrupted response must NOT play.
    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({ type: 'response.audio.delta', delta: 'BBBB' }),
      })
    })
    expect(playAudioMock).toHaveBeenCalledTimes(1)

    // The next reply resumes playback.
    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({ type: 'response.created' }),
      })
      ws.onmessage?.({
        data: JSON.stringify({ type: 'response.audio.delta', delta: 'CCCC' }),
      })
    })
    expect(playAudioMock).toHaveBeenCalledWith('CCCC')
    expect(playAudioMock).toHaveBeenCalledTimes(2)
  })
})
