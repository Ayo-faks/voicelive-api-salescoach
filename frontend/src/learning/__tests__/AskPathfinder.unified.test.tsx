import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The unified surface derives its tutor/ask presentation from content only when
// this flag is on, so the whole file runs with it forced true.
vi.mock('../../utils/featureFlags', async importActual => {
  const actual =
    await importActual<typeof import('../../utils/featureFlags')>()
  return {
    ...actual,
    featureFlags: {
      ...actual.featureFlags,
      pathfinder_unified_assistant_enabled: true,
    },
  }
})

import AskPathfinder from '../AskPathfinder'
import { type AssistantBlock } from '../api'
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

function turnResponse(blocks: AssistantBlock[], sessionComplete = false): Response {
  return {
    ok: true,
    json: async () => ({ blocks, session_complete: sessionComplete }),
  } as unknown as Response
}

function prose(text: string): AssistantBlock {
  return {
    kind: 'prose',
    speak: text,
    text,
    citations: [],
  } as unknown as AssistantBlock
}

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

describe('AskPathfinder — content-derived presentation (unified flag on)', () => {
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

  it('stays in ask presentation for a prose reply', async () => {
    fetchMock.mockResolvedValueOnce(turnResponse([prose('Divide both by 2.')]))
    renderDrawer({ userId: 'learner-1' })

    await ask('why is it 1/2?')
    await screen.findByText('Divide both by 2.')

    expect(
      screen
        .getByTestId('ask-pathfinder-drawer')
        .getAttribute('data-presentation')
    ).toBe('ask')
    expect(screen.queryByTestId('ask-pathfinder-tutor-stage')).toBeNull()
  })

  it('morphs to the focused tutor presentation when the reply is a practice card', async () => {
    fetchMock.mockResolvedValueOnce(turnResponse([mcq]))
    renderDrawer({ userId: 'learner-1' })

    await ask('start an exercise')
    await screen.findByTestId('ask-pathfinder-tutor-stage')

    expect(
      screen
        .getByTestId('ask-pathfinder-drawer')
        .getAttribute('data-presentation')
    ).toBe('tutor')
    // The focused card and its options still render and remain tappable.
    expect(screen.getByTestId('practice-card')).toBeTruthy()
    expect(screen.getByTestId('practice-option-o1')).toBeTruthy()
  })

  it('flips back to ask presentation once the card walk yields prose', async () => {
    fetchMock
      .mockResolvedValueOnce(turnResponse([mcq]))
      .mockResolvedValueOnce(turnResponse([prose('Correct! Nicely done.')]))
    renderDrawer({ userId: 'learner-1' })

    await ask('start an exercise')
    await screen.findByTestId('ask-pathfinder-tutor-stage')

    fireEvent.click(screen.getByTestId('practice-option-o1'))
    await screen.findByText('Correct! Nicely done.')

    expect(
      screen
        .getByTestId('ask-pathfinder-drawer')
        .getAttribute('data-presentation')
    ).toBe('ask')
    expect(screen.queryByTestId('ask-pathfinder-tutor-stage')).toBeNull()
  })
})
