import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LearnerTutorFullscreen from './LearnerTutorFullscreen'

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

describe('LearnerTutorFullscreen', () => {
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
    vi.useRealTimers()
    vi.clearAllMocks()
    cleanup()
  })

  it('opens the learner-scoped VoiceLive websocket with taxonomy query params', async () => {
    render(
      <LearnerTutorFullscreen
        open={true}
        onClose={() => {}}
        childId="stu-1"
        exam="WAEC"
        classYear="SSS2"
        subject="Mathematics"
      />
    )

    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    const ws = FakeWebSocket.instances[0]
    expect(ws.url).toContain('/ws/voice?')
    expect(ws.url).toContain('scope=learner')
    expect(ws.url).toContain('child_id=stu-1')
    expect(ws.url).toContain('exam=WAEC')
    expect(ws.url).toContain('class_year=SSS2')
    expect(ws.url).toContain('subject=Mathematics')

    await waitFor(() => expect(ws.send).toHaveBeenCalled())
    const sentBodies = ws.send.mock.calls.map(call =>
      JSON.parse(String(call[0]))
    )
    expect(sentBodies.map(body => body.type)).toContain('session.update')
    expect(sentBodies).toContainEqual({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Start my tutoring session.' }],
      },
    })
    expect(sentBodies).toContainEqual({ type: 'response.create' })
    expect(recorderMock.toggleRecording).toHaveBeenCalledTimes(1)
  })

  it('threads the Dig-Deeper focus item into the websocket URL', async () => {
    render(
      <LearnerTutorFullscreen
        open={true}
        onClose={() => {}}
        childId="stu-1"
        subject="Mathematics"
        classYear="SSS2"
        focusItem={{
          stem: 'Differentiate y = 3x^2.',
          skillId: 'differentiation',
          misconception: 'forgetting the exponent multiplier',
          scored: false,
        }}
      />
    )

    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    const url = FakeWebSocket.instances[0].url
    expect(url).toContain('focus_stem=Differentiate')
    expect(url).toContain('focus_skill_id=differentiation')
    expect(url).toContain('focus_misconception=')
    expect(url).toContain('focus_scored=false')
  })

  it('renders learner cards emitted by the backend tool bridge', async () => {
    render(
      <LearnerTutorFullscreen open={true} onClose={() => {}} childId="stu-1" />
    )
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))

    act(() => {
      FakeWebSocket.instances[0].emit({
        type: 'wulo.learner_card',
        payload: {
          card: {
            card_id: 'card-1',
            kind: 'mark-known',
            speak: 'Do you already know differentiation?',
            prompt: 'Do you already know differentiation?',
            confirm_label: 'Yes, I know it',
          },
          session_complete: false,
        },
      })
    })

    expect(await screen.findByTestId('practice-card')).toBeTruthy()
    expect(
      screen.getAllByText('Do you already know differentiation?').length
    ).toBeGreaterThan(0)
  })

  it('falls back and closes after microphone permission is denied', async () => {
    vi.useFakeTimers()
    recorderMock.toggleRecording.mockRejectedValue(new Error('denied'))
    const onClose = vi.fn()
    render(
      <LearnerTutorFullscreen open={true} onClose={onClose} childId="stu-1" />
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(
      screen.getByText(
        'Tutor needs your microphone to listen. Tap 🔊 Listen on cards instead.'
      )
    ).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(4000)
    })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('sends a text response when the learner taps a rendered option', async () => {
    render(
      <LearnerTutorFullscreen open={true} onClose={() => {}} childId="stu-1" />
    )
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    const ws = FakeWebSocket.instances[0]

    act(() => {
      ws.emit({
        type: 'wulo.learner_card',
        payload: {
          card: {
            card_id: 'mcq-1',
            kind: 'mcq-tap',
            speak: 'Pick the derivative.',
            stem: 'Differentiate x squared.',
            skill_id: 'differentiation',
            options: [
              { id: 'a', label: 'A', text: 'x' },
              { id: 'b', label: 'B', text: '2x' },
            ],
          },
          session_complete: false,
        },
      })
    })

    fireEvent.click(await screen.findByTestId('practice-option-b'))

    const sentBodies = ws.send.mock.calls.map(call =>
      JSON.parse(String(call[0]))
    )
    expect(sentBodies).toContainEqual({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: 'I choose option b. Previous card: mcq-1.',
          },
        ],
      },
    })
    expect(sentBodies.some(body => body.type === 'response.create')).toBe(true)
  })
})
