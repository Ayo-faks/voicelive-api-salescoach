import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLearnerVoiceSession } from './useLearnerVoiceSession'

const recorderMock = vi.hoisted(() => ({
  toggleRecording: vi.fn(),
  state: { recording: false, inputLevel: 0 },
}))

vi.mock('../../hooks/useRecorder', () => ({
  useRecorder: () => ({
    recording: recorderMock.state.recording,
    inputLevel: recorderMock.state.inputLevel,
    toggleRecording: recorderMock.toggleRecording,
  }),
}))

const audioPlayerMock = vi.hoisted(() => ({
  playAudio: vi.fn(),
  stopAudio: vi.fn(),
}))

vi.mock('../../hooks/useAudioPlayer', () => ({
  useAudioPlayer: () => audioPlayerMock,
}))

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static OPEN = 1
  readyState = FakeWebSocket.OPEN
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  send = vi.fn()
  close = vi.fn(() => this.onclose?.())

  constructor(public url: string) {
    FakeWebSocket.instances.push(this)
    window.setTimeout(() => this.onopen?.(), 0)
  }

  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) })
  }
}

function HookHarness({ startOnOpen = false }: { startOnOpen?: boolean }) {
  const session = useLearnerVoiceSession({
    open: true,
    childId: 'student-1',
    exam: 'WAEC',
    classYear: 'SS3',
    subject: 'Mathematics',
    lastCardId: 'card-1',
    lastKind: 'mcq-tap',
    autoStartRecording: false,
    startOnOpen,
  })
  return (
    <div>
      <span data-testid="voice-state">{session.state}</span>
      <span data-testid="voice-card-id">{session.card?.card_id ?? ''}</span>
      {session.error ? <span role="alert">{session.error}</span> : null}
    </div>
  )
}

describe('useLearnerVoiceSession', () => {
  const OriginalWebSocket = globalThis.WebSocket

  beforeEach(() => {
    FakeWebSocket.instances = []
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    recorderMock.state.recording = false
    recorderMock.state.inputLevel = 0
    recorderMock.toggleRecording.mockResolvedValue(undefined)
  })

  afterEach(() => {
    globalThis.WebSocket = OriginalWebSocket
    vi.clearAllMocks()
    cleanup()
  })

  it('binds current card context and can wait for speech before creating a response', async () => {
    render(<HookHarness />)

    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    const ws = FakeWebSocket.instances[0]
    expect(ws.url).toContain('last_card_id=card-1')
    expect(ws.url).toContain('last_kind=mcq-tap')

    await waitFor(() => expect(ws.send).toHaveBeenCalledTimes(1))
    expect(JSON.parse(String(ws.send.mock.calls[0][0]))).toEqual({
      type: 'session.update',
      session: {},
    })
  })

  it('transitions through card, thinking, speaking, barge-in, and error states', async () => {
    render(<HookHarness startOnOpen />)
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    const ws = FakeWebSocket.instances[0]

    act(() => {
      ws.emit({ type: 'response.created' })
    })
    expect(screen.getByTestId('voice-state').textContent).toBe('thinking')

    act(() => {
      ws.emit({ type: 'response.audio.delta', delta: 'AAAA' })
    })
    expect(screen.getByTestId('voice-state').textContent).toBe('speaking')
    expect(audioPlayerMock.playAudio).toHaveBeenCalledWith('AAAA')
    audioPlayerMock.stopAudio.mockClear()

    act(() => {
      ws.emit({ type: 'input_audio_buffer.speech_started' })
    })
    expect(screen.getByTestId('voice-state').textContent).toBe('listening')
    expect(audioPlayerMock.stopAudio).toHaveBeenCalledTimes(1)

    act(() => {
      ws.emit({
        type: 'wulo.learner_card',
        payload: {
          card: {
            card_id: 'card-2',
            kind: 'progress',
            speak: 'Nice work.',
            completed: 1,
            total: 3,
          },
          session_complete: false,
        },
      })
    })
    expect(screen.getByTestId('voice-card-id').textContent).toBe('card-2')

    act(() => {
      ws.onerror?.()
    })
    expect(screen.getByTestId('voice-state').textContent).toBe('error')
    expect(screen.getByRole('alert').textContent).toContain(
      'Voice connection failed'
    )
  })
})