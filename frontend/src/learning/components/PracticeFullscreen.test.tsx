import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LearnerVoiceCard } from '../api'
import PracticeFullscreen from './PracticeFullscreen'

const firstCard: LearnerVoiceCard = {
  card_id: 'card-1',
  kind: 'mcq-tap',
  speak: 'Choose the ratio answer.',
  stem: '2 cups rice need 3 cups water. What do 6 cups need?',
  options: [
    { id: 'a', label: 'A', text: '6 cups' },
    { id: 'b', label: 'B', text: '9 cups' },
  ],
}

const voiceCard: LearnerVoiceCard = {
  card_id: 'card-2',
  kind: 'mcq-tap',
  speak: 'Try the next ratio.',
  stem: '4 books cost 800 naira. What do 2 books cost?',
  options: [
    { id: 'a', label: 'A', text: '400 naira' },
    { id: 'b', label: 'B', text: '1600 naira' },
  ],
}

const apiMock = vi.hoisted(() => ({
  runLearnerVoiceTurn: vi.fn(),
}))

vi.mock('../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    runLearnerVoiceTurn: apiMock.runLearnerVoiceTurn,
  }
})

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

vi.mock('../../hooks/useAudioPlayer', () => ({
  useAudioPlayer: () => ({
    playAudio: vi.fn(),
    stopAudio: vi.fn(),
  }),
}))

vi.mock('../hooks/useTtsPlayer', () => ({
  useTtsPlayer: () => ({
    supported: true,
    playing: false,
    play: vi.fn(),
    stop: vi.fn(),
  }),
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

describe('PracticeFullscreen voice answers', () => {
  const OriginalWebSocket = globalThis.WebSocket

  beforeEach(() => {
    FakeWebSocket.instances = []
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    apiMock.runLearnerVoiceTurn.mockResolvedValue({
      card: firstCard,
      session_complete: false,
    })
    recorderMock.state.recording = false
    recorderMock.state.inputLevel = 0
    recorderMock.toggleRecording.mockResolvedValue(undefined)
  })

  afterEach(() => {
    globalThis.WebSocket = OriginalWebSocket
    vi.clearAllMocks()
    cleanup()
  })

  it('removes the old tutor chip, keeps the card mounted, and routes voice-active taps through the current WS card', async () => {
    render(
      <PracticeFullscreen open={true} onClose={() => {}} childId="stu-1" />
    )

    const cardSlot = screen.getByTestId('practice-card-slot')
    expect((await screen.findByTestId('practice-card')).getAttribute('data-card-id')).toBe('card-1')
    expect(screen.queryByTestId('practice-talk')).toBeNull()
    expect(screen.getByTestId('practice-voice-mic')).toBeTruthy()
    expect(screen.getByTestId('practice-voice-toggle')).toBeTruthy()

    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    const ws = FakeWebSocket.instances[0]
    expect(ws.url).toContain('last_card_id=card-1')
    expect(ws.url).toContain('last_kind=mcq-tap')
    expect(ws.send).not.toHaveBeenCalledWith(
      expect.stringContaining('response.create')
    )

    fireEvent.click(screen.getByTestId('practice-option-b'))
    await waitFor(() => {
      expect(apiMock.runLearnerVoiceTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          last_card_id: 'card-1',
          last_kind: 'mcq-tap',
          answer_option_id: 'b',
        })
      )
    })
    await waitFor(() => {
      expect(screen.getByTestId('practice-option-a').hasAttribute('disabled')).toBe(false)
    })

    act(() => {
      ws.emit({
        type: 'wulo.learner_card',
        payload: { card: voiceCard, session_complete: false },
      })
    })

    expect(screen.getByTestId('practice-card-slot')).toBe(cardSlot)
    await waitFor(() => {
      expect(
        screen.getByTestId('practice-card').getAttribute('data-card-id')
      ).toBe('card-2')
      expect(screen.getByTestId('practice-option-a').hasAttribute('disabled')).toBe(false)
    })

    fireEvent.click(screen.getByTestId('practice-option-a'))
    await waitFor(() => {
      const sentBodies = FakeWebSocket.instances.flatMap(instance =>
        instance.send.mock.calls.map(call => JSON.parse(String(call[0])))
      )
      expect(sentBodies).toContainEqual({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'I choose option a. Previous card: card-2.',
            },
          ],
        },
      })
    })
  })

  it('shows a visible inline error when microphone permission is denied', async () => {
    recorderMock.toggleRecording.mockRejectedValue(new Error('denied'))
    render(
      <PracticeFullscreen open={true} onClose={() => {}} childId="stu-1" />
    )

    await screen.findByTestId('practice-card')
    fireEvent.click(screen.getByTestId('practice-voice-mic'))

    expect((await screen.findByTestId('practice-voice-error')).textContent).toContain(
      'Tutor needs your microphone to listen'
    )
  })
})
