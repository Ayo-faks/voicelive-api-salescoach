import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StartDiagnosticResponse } from '../api'

const startDiagnosticMock = vi.hoisted(() => vi.fn())

vi.mock('../api', () => ({
  startDiagnostic: (...args: unknown[]) => startDiagnosticMock(...args),
  answerDiagnostic: vi.fn(),
}))

import DiagnosticPanel from '../components/DiagnosticPanel'

function session(skillId: string, lang: string): StartDiagnosticResponse {
  return {
    session_id: 'sess-1',
    diagnostic_id: 'diag-1',
    lang,
    item: {
      item_id: 'item-1',
      skill_id: skillId,
      prompt: 'Solve for x: 2x = 10',
      item_type: 'short_answer',
      difficulty: 0.5,
      lang,
    },
    items_remaining: 4,
    items_total: 5,
  }
}

afterEach(() => {
  startDiagnosticMock.mockReset()
  vi.restoreAllMocks()
})

describe('DiagnosticPanel learner-facing labels', () => {
  it('humanises namespaced skill IDs instead of leaking the raw ID (#4a)', async () => {
    startDiagnosticMock.mockResolvedValue(session('jss3.algebra.linear', 'en-NG'))

    render(<DiagnosticPanel studentId="student-1" />)

    const skill = await screen.findByTestId('diagnostic-skill')
    expect(skill.textContent).toBe('Linear')
    expect(skill.textContent).not.toContain('.')
    expect(skill.textContent).not.toContain('jss3')
  })

  it('humanises underscore-separated leaf segments', async () => {
    startDiagnosticMock.mockResolvedValue(
      session('ss3.indices.laws_of_indices', 'en-NG')
    )

    render(<DiagnosticPanel studentId="student-1" />)

    const skill = await screen.findByTestId('diagnostic-skill')
    expect(skill.textContent).toBe('Laws of indices')
  })

  it('relabels an unknown language as "In your language", never "Learner language" (#16)', async () => {
    startDiagnosticMock.mockResolvedValue(session('jss3.algebra.linear', 'ig-NG'))

    render(<DiagnosticPanel studentId="student-1" />)

    await waitFor(() => {
      expect(screen.getByText('In your language')).toBeTruthy()
    })
    expect(screen.queryByText('Learner language')).toBeNull()
  })

  it('maps known language codes to their names', async () => {
    startDiagnosticMock.mockResolvedValue(session('jss3.algebra.linear', 'yo-NG'))

    render(<DiagnosticPanel studentId="student-1" />)

    await waitFor(() => {
      expect(screen.getByText('Yoruba')).toBeTruthy()
    })
  })
})
