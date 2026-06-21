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
  speak:
    'Hi — let\'s do a quick WAEC SSS2 Mathematics check. Question 1 of 2. 2 cups rice need 3 cups water. What do 6 cups need?',
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

const freeResponseCard: LearnerVoiceCard = {
  card_id: 'free-1',
  kind: 'free-response',
  speak:
    "Hi — let's do a quick Junior WAEC JSS3 english check. Question 1 of 1. Choose the word closest in meaning to 'reluctant'.",
  prompt: "Choose the word closest in meaning to 'reluctant'.",
  skill_id: 'jss3.english.vocab.synonyms',
  placeholder: 'Type or say your answer',
  submit_label: 'Check answer',
}

const progressCard: LearnerVoiceCard = {
  card_id: 'progress-1',
  kind: 'progress',
  speak: 'Nice work.',
  completed: 1,
  total: 1,
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

const ttsMock = vi.hoisted(() => ({
  play: vi.fn(),
  stop: vi.fn(),
}))

vi.mock('../hooks/useTtsPlayer', () => ({
  useTtsPlayer: () => ({
    supported: true,
    playing: false,
    play: ttsMock.play,
    stop: ttsMock.stop,
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
    apiMock.runLearnerVoiceTurn.mockResolvedValue({
      card: firstCard,
      session_complete: false,
    })

    render(
      <PracticeFullscreen open={true} onClose={() => {}} childId="stu-1" />
    )

    const cardSlot = screen.getByTestId('practice-card-slot')
    expect((await screen.findByTestId('practice-card')).getAttribute('data-card-id')).toBe('card-1')
    expect(screen.getByTestId('practice-question-counter').textContent).toBe(
      'Question 1 of 2'
    )
    expect(screen.getByTestId('practice-question-text').textContent).toContain(
      '2 cups rice need 3 cups water'
    )
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

  it('does not show a voice error when the optional socket closes before mic use', async () => {
    render(
      <PracticeFullscreen open={true} onClose={() => {}} childId="stu-1" />
    )

    await screen.findByTestId('practice-card')
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    await waitFor(() =>
      expect(screen.getByTestId('practice-voice-state').textContent).toBe('Ready')
    )
    act(() => {
      FakeWebSocket.instances[0].onclose?.()
    })

    expect(screen.queryByTestId('practice-voice-error')).toBeNull()
    await waitFor(() =>
      expect(screen.getByTestId('practice-voice-state').textContent).toBe('Ready')
    )
  })

  it('submits typed free-response answers through the voice turn API', async () => {
    apiMock.runLearnerVoiceTurn.mockReset()
    apiMock.runLearnerVoiceTurn.mockResolvedValue({
      card: freeResponseCard,
      session_complete: false,
    })

    render(
      <PracticeFullscreen open={true} onClose={() => {}} childId="stu-1" />
    )

    const input = await screen.findByTestId('practice-free-response-input')
    const cardText = screen.getByTestId('practice-card').textContent ?? ''
    expect(cardText).toContain(
      "Hi — let's do a quick Junior WAEC JSS3 english check."
    )
    expect(screen.getByTestId('practice-question-counter').textContent).toBe(
      'Question 1 of 1'
    )
    expect(screen.getByTestId('practice-question-text').textContent).toBe(
      "Choose the word closest in meaning to 'reluctant'."
    )
    expect(cardText).not.toContain(
      "Hi — let's do a quick Junior WAEC JSS3 english check. Question 1 of 1. Choose"
    )
    fireEvent.change(input, { target: { value: 'unwilling' } })
    fireEvent.click(screen.getByTestId('practice-free-response-submit'))

    await waitFor(() => {
      expect(apiMock.runLearnerVoiceTurn.mock.calls).toContainEqual([
        expect.objectContaining({
          last_card_id: 'free-1',
          last_kind: 'free-response',
          answer_text: 'unwilling',
        }),
      ])
    })
  })

  it('notifies the host when a practice session completes', async () => {
    const onSessionComplete = vi.fn()
    let completed = false
    apiMock.runLearnerVoiceTurn.mockReset()
    apiMock.runLearnerVoiceTurn.mockImplementation((payload: { answer_option_id?: string }) => {
      if (payload.answer_option_id || completed) {
        completed = true
        return Promise.resolve({
          card: progressCard,
          session_complete: true,
          skill_mastery: {
            skill_id: 'ss3.physics.measurements.phys_def',
            skill_label: 'Physics definition',
            probability: 0.67,
            prior_probability: 0.5,
            delta_probability: 0.17,
          },
        })
      }
      return Promise.resolve({ card: firstCard, session_complete: false })
    })

    render(
      <PracticeFullscreen
        open={true}
        onClose={() => {}}
        childId="stu-1"
        onSessionComplete={onSessionComplete}
      />
    )

    await screen.findByTestId('practice-option-b')
    fireEvent.click(screen.getByTestId('practice-option-b'))

    await waitFor(() => expect(onSessionComplete).toHaveBeenCalledTimes(1))
    const mastery = await screen.findByTestId('practice-skill-mastery')
    expect(mastery.textContent).toContain('Current skill mastery')
    expect(mastery.textContent).toContain('Physics definition: 67%')
    expect(mastery.textContent).toContain('+17 pts this session')
  })
})
