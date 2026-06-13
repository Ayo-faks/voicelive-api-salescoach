import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AskPathfinder from '../AskPathfinder'
import { ASSISTANT_TURN_TIMEOUT_MS, type AssistantBlock } from '../api'
import {
  LearnerContext,
  defaultLearnerContext,
  type LearnerContextValue,
} from '../contexts/LearnerContext'

function renderDrawer(overrides: Partial<LearnerContextValue> = {}) {
  const value: LearnerContextValue = { ...defaultLearnerContext, ...overrides }
  render(
    <LearnerContext.Provider value={value}>
      <AskPathfinder />
    </LearnerContext.Provider>
  )
  fireEvent.click(screen.getByTestId('ask-pathfinder-fab'))
}

function turnResponse(
  blocks: AssistantBlock[],
  sessionComplete = false
): Response {
  return {
    ok: true,
    json: async () => ({ blocks, session_complete: sessionComplete }),
  } as unknown as Response
}

function prose(text: string, extra: Partial<Record<string, unknown>> = {}) {
  return {
    kind: 'prose',
    speak: text,
    text,
    citations: [],
    ...extra,
  } as unknown as AssistantBlock
}

describe('AskPathfinder — unified assistant surface', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  async function ask(question: string) {
    fireEvent.change(screen.getByTestId('ask-pathfinder-input'), {
      target: { value: question },
    })
    fireEvent.click(screen.getByTestId('ask-pathfinder-send'))
  }

  function bodyOf(call: number) {
    return JSON.parse(
      (fetchMock.mock.calls[call][1] as RequestInit).body as string
    )
  }

  it('posts to the unified turn endpoint with focus item, setup, and empty thread', async () => {
    fetchMock.mockResolvedValueOnce(turnResponse([prose('Divide both by 2.')]))
    renderDrawer({
      userId: 'learner-1',
      focusItem: {
        stem: 'Simplify 2/4',
        skillId: 'fraction-operations',
        scored: false,
      },
      learnerSetup: { subject: 'maths', yearGroup: 'JSS3' },
    })

    await ask('why is it 1/2?')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    expect(fetchMock.mock.calls[0][0]).toBe('/api/learning/assistant/turn')
    const body = bodyOf(0)
    expect(body.question).toBe('why is it 1/2?')
    expect(body.focus_item).toMatchObject({
      stem: 'Simplify 2/4',
      skill_id: 'fraction-operations',
      scored: false,
    })
    expect(body.learner_setup).toEqual({ subject: 'maths', year_group: 'JSS3' })
    expect(body.thread).toEqual([])
  })

  it('forwards the learner attempt history so the tutor can recall traps', async () => {
    fetchMock.mockResolvedValueOnce(turnResponse([prose('Watch the sign.')]))
    renderDrawer({
      userId: 'learner-1',
      attemptHistory: [
        {
          misconceptionCode: 'sign_error',
          topic: 'Algebra',
          correct: false,
          occurredAt: '2026-05-30T10:00:00Z',
        },
      ],
    })

    await ask('why did I get this wrong?')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    expect(bodyOf(0).attempt_history).toEqual([
      {
        misconception_code: 'sign_error',
        topic: 'Algebra',
        correct: false,
        occurred_at: '2026-05-30T10:00:00Z',
      },
    ])
  })

  it('maintains the running thread of prose turns across questions', async () => {
    fetchMock
      .mockResolvedValueOnce(turnResponse([prose('First answer.')]))
      .mockResolvedValueOnce(turnResponse([prose('Second answer.')]))
    renderDrawer()

    await ask('question one')
    await screen.findByText('First answer.')

    await ask('question two')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    expect(bodyOf(1).thread).toEqual([
      { role: 'user', text: 'question one' },
      { role: 'assistant', text: 'First answer.' },
    ])
  })

  it('renders a distinct defer state when the answer is not grounded', async () => {
    fetchMock.mockResolvedValueOnce(
      turnResponse([
        prose("I don't have study material I can ground that on yet.", {
          grounded: false,
        }),
      ])
    )
    renderDrawer()

    await ask('what is a black hole?')
    await waitFor(() =>
      expect(screen.getByTestId('assistant-defer-badge')).toBeTruthy()
    )
  })

  it('does not render a defer badge for a small-talk reply', async () => {
    fetchMock.mockResolvedValueOnce(
      turnResponse([
        prose("Hi! I'm Pathfinder, your study tutor.", {
          grounded: false,
          smalltalk: true,
        }),
      ])
    )
    renderDrawer()

    await ask('hi')
    await screen.findByText("Hi! I'm Pathfinder, your study tutor.")
    expect(screen.queryByTestId('assistant-defer-badge')).toBeNull()
  })

  it('renders citations for a grounded answer without a defer badge', async () => {
    fetchMock.mockResolvedValueOnce(
      turnResponse([
        prose('Divide both by 2.', {
          grounded: true,
          citations: [{ label: 'Simplifying fractions', topic_id: 'wiki-1' }],
        }),
      ])
    )
    renderDrawer()

    await ask('why is 2/4 = 1/2?')
    await screen.findByText('Divide both by 2.')
    expect(screen.queryByTestId('assistant-defer-badge')).toBeNull()
    const citation = screen.getByTestId('assistant-citation')
    expect(citation.textContent).toContain('Checked against your notes')
    expect(citation.getAttribute('title')).toContain('Simplifying fractions')
  })

  it('renders grounded Markdown as formatted prose instead of raw markers', async () => {
    fetchMock.mockResolvedValueOnce(
      turnResponse([
        prose(
          '**Photosynthesis** is how plants make food.\n\n**Quick breakdown:**\n- Plants use **sunlight**.\n- They release oxygen.',
          {
            grounded: true,
            citations: [{ label: 'Photosynthesis', topic_id: 'wiki-2' }],
          }
        ),
      ])
    )
    renderDrawer()

    await ask('what is photosynthesis?')

    const boldTerm = await screen.findByText('Photosynthesis')
    expect(boldTerm.tagName.toLowerCase()).toBe('strong')
    expect(screen.queryByText(/\*\*Photosynthesis\*\*/)).toBeNull()
    expect(
      screen.getByText((_content, element) =>
        element?.tagName.toLowerCase() === 'li' &&
        element.textContent === 'Plants use sunlight.'
      )
    ).toBeTruthy()
    expect(screen.getByText('sunlight').tagName.toLowerCase()).toBe('strong')
  })

  it('omits focus_item and learner_setup when none are anchored', async () => {
    fetchMock.mockResolvedValueOnce(turnResponse([prose('ok')]))
    renderDrawer()

    await ask('general question')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    const body = bodyOf(0)
    expect(body.focus_item).toBeNull()
    expect(body.learner_setup).toBeNull()
  })

  it('renders a practice card and continues the walk when an option is tapped', async () => {
    const mcq: AssistantBlock = {
      kind: 'mcq-tap',
      card_id: 'c1',
      speak: 'Pick one.',
      stem: 'What is 2 + 2?',
      options: [
        { id: 'o1', label: 'A', text: '4' },
        { id: 'o2', label: 'B', text: '5' },
      ],
    } as unknown as AssistantBlock
    fetchMock
      .mockResolvedValueOnce(turnResponse([mcq]))
      .mockResolvedValueOnce(turnResponse([prose('Correct!')]))
    renderDrawer()

    await ask('start an exercise')
    await screen.findByTestId('practice-card')

    fireEvent.click(screen.getByTestId('practice-option-o1'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    expect(bodyOf(1)).toMatchObject({
      last_card_id: 'c1',
      last_kind: 'mcq-tap',
      answer_option_id: 'o1',
    })
  })

  it('engages voice in place from the composer mic, keeping the message bar', async () => {
    class FakeWebSocket {
      static OPEN = 1
      readyState = 1
      onmessage: ((e: { data: string }) => void) | null = null
      onclose: (() => void) | null = null
      onerror: (() => void) | null = null
      constructor(public url: string) {}
      send() {}
      close() {}
    }
    class FakeRecognition {
      lang = ''
      continuous = false
      interimResults = false
      onresult: ((e: unknown) => void) | null = null
      onerror: ((e: unknown) => void) | null = null
      onend: (() => void) | null = null
      start() {}
      stop() {}
    }
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.stubGlobal('SpeechRecognition', FakeRecognition)
    renderDrawer()

    fireEvent.click(screen.getByTestId('ask-pathfinder-mic'))
    // The mic engages voice in place: the message bar (text input) stays
    // visible — voice is an input, not a separate screen.
    expect(screen.queryByTestId('ask-pathfinder-input')).not.toBeNull()
    expect(
      screen.getByTestId('ask-pathfinder-drawer').getAttribute('data-mode')
    ).toBe('voice')
  })

  it('persists the conversation and rehydrates it on remount', async () => {
    fetchMock.mockResolvedValueOnce(turnResponse([prose('Remembered answer.')]))
    const value: LearnerContextValue = {
      ...defaultLearnerContext,
      userId: 'learner-1',
    }
    const first = render(
      <LearnerContext.Provider value={value}>
        <AskPathfinder />
      </LearnerContext.Provider>
    )
    fireEvent.click(screen.getByTestId('ask-pathfinder-fab'))

    await ask('remember this')
    await screen.findByText('Remembered answer.')

    // Simulate a page reload: unmount and mount a fresh tree for the same child.
    first.unmount()
    render(
      <LearnerContext.Provider value={value}>
        <AskPathfinder />
      </LearnerContext.Provider>
    )
    fireEvent.click(screen.getByTestId('ask-pathfinder-fab'))

    expect(screen.getByText('remember this')).toBeTruthy()
    expect(screen.getByText('Remembered answer.')).toBeTruthy()
  })

  it('clears the thread and its saved copy when starting a new conversation', async () => {
    fetchMock.mockResolvedValueOnce(turnResponse([prose('Old answer.')]))
    renderDrawer({ userId: 'learner-1' })

    await ask('old question')
    await screen.findByText('Old answer.')
    expect(
      window.localStorage.getItem('pathfinder-ask-thread:learner-1')
    ).toBeTruthy()

    fireEvent.click(screen.getByTestId('ask-pathfinder-new'))

    await waitFor(() =>
      expect(screen.queryByText('Old answer.')).toBeNull()
    )
    expect(screen.queryByText('old question')).toBeNull()
    expect(
      window.localStorage.getItem('pathfinder-ask-thread:learner-1')
    ).toBeNull()
  })

  it('keeps separate saved threads per child', async () => {
    fetchMock.mockResolvedValueOnce(turnResponse([prose('Child one answer.')]))
    renderDrawer({ userId: 'child-1' })

    await ask('child one question')
    await screen.findByText('Child one answer.')

    expect(
      window.localStorage.getItem('pathfinder-ask-thread:child-1')
    ).toContain('Child one answer.')
    expect(
      window.localStorage.getItem('pathfinder-ask-thread:child-2')
    ).toBeNull()
  })

  it('round-trips the backend conversation_id between turns', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        blocks: [prose('First answer.')],
        session_complete: false,
        conversation_id: 'ask-conv-abc',
      }),
    } as unknown as Response)
    fetchMock.mockResolvedValueOnce(turnResponse([prose('Second answer.')]))
    renderDrawer({ userId: 'learner-1' })

    await ask('first question')
    await screen.findByText('First answer.')
    // First turn opens a fresh thread, so no id is sent.
    expect(bodyOf(0).conversation_id).toBeNull()

    await ask('second question')
    await screen.findByText('Second answer.')
    // The id echoed by the first turn is carried into the next request.
    expect(bodyOf(1).conversation_id).toBe('ask-conv-abc')
  })

  it('lists saved conversations and resumes one from history', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (url.startsWith('/api/learning/assistant/conversations/')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            conversation: {
              id: 'ask-conv-1',
              title: 'Fractions help',
              created_at: '2026-06-01T10:00:00Z',
              updated_at: '2026-06-01T10:05:00Z',
            },
            messages: [
              { id: 'm1', role: 'user', text: 'saved question', created_at: '' },
              {
                id: 'm2',
                role: 'assistant',
                blocks: [prose('saved answer')],
                created_at: '',
              },
            ],
          }),
        } as unknown as Response)
      }
      if (url.startsWith('/api/learning/assistant/conversations')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            conversations: [
              {
                id: 'ask-conv-1',
                title: 'Fractions help',
                created_at: '2026-06-01T10:00:00Z',
                updated_at: '2026-06-01T10:05:00Z',
              },
            ],
          }),
        } as unknown as Response)
      }
      void method
      return Promise.resolve(turnResponse([prose('unused')]))
    })
    renderDrawer({ userId: 'learner-1' })

    fireEvent.click(screen.getByTestId('ask-pathfinder-history'))
    const item = await screen.findByTestId('ask-pathfinder-history-item')
    expect(item.textContent).toContain('Fractions help')

    fireEvent.click(item)
    await screen.findByText('saved answer')
    expect(screen.getByText('saved question')).toBeTruthy()
  })

  it('shows a timeout message instead of spinning forever when the turn stalls', async () => {
    // A fetch that never settles unless aborted — the request-level timeout in
    // runAssistantTurn must fire and surface a clear retry message.
    fetchMock.mockImplementationOnce(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          )
        })
    )
    renderDrawer({ userId: 'learner-1' })
    vi.useFakeTimers()
    try {
      await ask('what is photosynthesis?')
      await vi.advanceTimersByTimeAsync(ASSISTANT_TURN_TIMEOUT_MS + 50)
    } finally {
      vi.useRealTimers()
    }
    await waitFor(() =>
      expect(
        screen.getByText('Wulo is taking too long. Try again in a moment.')
      ).toBeTruthy()
    )
    // The composer is usable again — the orb is not stuck busy.
    const send = screen.getByTestId('ask-pathfinder-send') as HTMLButtonElement
    expect(send.disabled).toBe(true) // disabled only because input is empty…
    fireEvent.change(screen.getByTestId('ask-pathfinder-input'), {
      target: { value: 'retry' },
    })
    expect((screen.getByTestId('ask-pathfinder-send') as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows the offline message on a plain network failure (not the timeout copy)', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    renderDrawer({ userId: 'learner-1' })
    await ask('what is photosynthesis?')
    await waitFor(() =>
      expect(
        screen.getByText('Offline for the moment. Try again when you have a connection.')
      ).toBeTruthy()
    )
  })
})
