import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AnswerDiagnosticResponse,
  StartDiagnosticResponse,
} from '../api'

const startDiagnosticMock = vi.hoisted(() => vi.fn())
const answerDiagnosticMock = vi.hoisted(() => vi.fn())

vi.mock('../api', () => ({
  startDiagnostic: (...args: unknown[]) => startDiagnosticMock(...args),
  answerDiagnostic: (...args: unknown[]) => answerDiagnosticMock(...args),
}))

import DiagnosticPanel from '../components/DiagnosticPanel'

function startSession(): StartDiagnosticResponse {
  return {
    session_id: 'sess-1',
    diagnostic_id: 'diag-1',
    lang: 'en-NG',
    item: {
      item_id: 'item-1',
      skill_id: 'ss3.indices.laws_of_indices',
      prompt: 'Simplify: 2^3 × 2^2',
      item_type: 'short_answer',
      difficulty: 0.5,
      lang: 'en-NG',
    },
    items_remaining: 4,
    items_total: 5,
  }
}

function answer(
  overrides: Partial<AnswerDiagnosticResponse>
): AnswerDiagnosticResponse {
  return {
    session_id: 'sess-1',
    item_id: 'item-1',
    correct: false,
    expected_answer: '32',
    mastery_estimate: {
      kind: 'beta',
      probability: 0.4,
      uncertainty: 0.1,
    },
    next_item: null,
    items_remaining: 3,
    completed: false,
    pending_plan: null,
    pending_facts: [],
    completion_xapi: null,
    ...overrides,
  }
}

async function submitAnswer(value: string) {
  const input = await screen.findByTestId('diagnostic-answer-input')
  fireEvent.change(input, { target: { value } })
  fireEvent.click(screen.getByTestId('diagnostic-submit'))
}

afterEach(() => {
  startDiagnosticMock.mockReset()
  answerDiagnosticMock.mockReset()
  vi.restoreAllMocks()
})

describe('DiagnosticPanel feedback result card (#9/#20)', () => {
  it('shows a wrong-answer card with the expected answer and an expandable explanation', async () => {
    startDiagnosticMock.mockResolvedValue(startSession())
    answerDiagnosticMock.mockResolvedValue(answer({ correct: false }))

    render(<DiagnosticPanel studentId="student-1" />)
    await submitAnswer('30')

    const card = await screen.findByTestId('diagnostic-feedback')
    expect(card.getAttribute('role')).toBe('status')
    expect(card.textContent).toContain('Not quite')
    expect(card.textContent).toContain('32')

    // Explanation is hidden until requested.
    expect(screen.queryByTestId('diagnostic-explain-text')).toBeNull()
    fireEvent.click(screen.getByTestId('diagnostic-explain'))
    expect(screen.getByTestId('diagnostic-explain-text')).toBeTruthy()
  })

  it('shows a positive card on a correct answer without an explain action', async () => {
    startDiagnosticMock.mockResolvedValue(startSession())
    answerDiagnosticMock.mockResolvedValue(
      answer({ correct: true, expected_answer: '32' })
    )

    render(<DiagnosticPanel studentId="student-1" />)
    await submitAnswer('32')

    const card = await screen.findByTestId('diagnostic-feedback')
    expect(card.textContent).toContain('Correct')
    await waitFor(() => {
      expect(screen.queryByTestId('diagnostic-explain')).toBeNull()
    })
  })
})
