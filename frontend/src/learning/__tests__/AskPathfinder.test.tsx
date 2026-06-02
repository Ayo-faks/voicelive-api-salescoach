import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AskPathfinder from '../AskPathfinder'
import type { AssistantBlock } from '../api'
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
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
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

  it('morphs to voice mode and shows the mic stage', async () => {
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
    vi.stubGlobal('WebSocket', FakeWebSocket)
    renderDrawer()

    fireEvent.click(screen.getByTestId('ask-pathfinder-mode-voice'))
    expect(screen.getByTestId('ask-pathfinder-mic')).toBeTruthy()
    expect(screen.queryByTestId('ask-pathfinder-input')).toBeNull()
    expect(
      screen.getByTestId('ask-pathfinder-drawer').getAttribute('data-mode')
    ).toBe('voice')
  })
})
