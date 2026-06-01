import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AskPathfinder from '../AskPathfinder'
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

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
  } as unknown as Response
}

describe('AskPathfinder — Phase 2 anchoring', () => {
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

  it('sends the focus item, learner setup, and an empty thread on the first turn', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ answer: 'Divide both by 2.', citations: [], grounded: true })
    )
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

    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string
    )
    expect(body.focus_item).toMatchObject({
      stem: 'Simplify 2/4',
      skill_id: 'fraction-operations',
      scored: false,
    })
    expect(body.learner_setup).toEqual({ subject: 'maths', year_group: 'JSS3' })
    expect(body.thread).toEqual([])
  })

  it('forwards the learner attempt history so the tutor can recall traps', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ answer: 'Watch the sign.', citations: [], grounded: true })
    )
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

    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string
    )
    expect(body.attempt_history).toEqual([
      {
        misconception_code: 'sign_error',
        topic: 'Algebra',
        correct: false,
        occurred_at: '2026-05-30T10:00:00Z',
      },
    ])
  })

  it('maintains the running thread across turns', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ answer: 'First answer.', citations: [], grounded: true })
      )
      .mockResolvedValueOnce(
        jsonResponse({ answer: 'Second answer.', citations: [], grounded: true })
      )
    renderDrawer()

    await ask('question one')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await screen.findByText('First answer.')

    await ask('question two')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    const secondBody = JSON.parse(
      (fetchMock.mock.calls[1][1] as RequestInit).body as string
    )
    expect(secondBody.thread).toEqual([
      { role: 'user', text: 'question one' },
      { role: 'assistant', text: 'First answer.' },
    ])
  })

  it('renders a distinct defer state when the answer is not grounded', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        answer: "I don't have study material I can ground that on yet.",
        citations: [],
        grounded: false,
      })
    )
    renderDrawer()

    await ask('what is a black hole?')
    await waitFor(() =>
      expect(screen.getByTestId('ask-pathfinder-defer-badge')).toBeTruthy()
    )
  })

  it('does not render a defer badge for a grounded answer', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        answer: 'Divide both by 2.',
        citations: [{ label: 'Simplifying fractions', topic_id: 'wiki-1' }],
        grounded: true,
      })
    )
    renderDrawer()

    await ask('why is 2/4 = 1/2?')
    await screen.findByText('Divide both by 2.')
    expect(screen.queryByTestId('ask-pathfinder-defer-badge')).toBeNull()
    expect(screen.getByText('Simplifying fractions')).toBeTruthy()
  })

  it('omits focus_item and learner_setup when none are anchored', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ answer: 'ok', citations: [], grounded: true })
    )
    renderDrawer()

    await ask('general question')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string
    )
    expect(body.focus_item).toBeNull()
    expect(body.learner_setup).toBeNull()
  })
})
