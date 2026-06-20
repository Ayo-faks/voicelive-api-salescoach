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

  it('shows the numeric answer hint for Maths-domain items', async () => {
    startDiagnosticMock.mockResolvedValue(session('jss3.algebra.linear', 'en-NG'))

    render(<DiagnosticPanel studentId="student-1" />)

    const hint = await screen.findByTestId('diagnostic-hint')
    expect(hint.textContent).toContain('Type just the value')
    expect(hint.textContent).toContain('x = 5')
  })

  it('shows a free-text hint for English items, not the Maths "value" hint', async () => {
    startDiagnosticMock.mockResolvedValue(
      session('ss3.english.comprehension.main_idea', 'en-NG')
    )

    render(<DiagnosticPanel studentId="student-1" />)

    const hint = await screen.findByTestId('diagnostic-hint')
    expect(hint.textContent).toContain('Answer in your own words')
    expect(hint.textContent).not.toContain('Type just the value')
    expect(hint.textContent).not.toContain('x = 5')
  })

  it('passes diagnostic_id through to diagnostic startup', async () => {
    startDiagnosticMock.mockResolvedValue(
      session('ss3.lexis_and_structure.sentence_completion', 'en-NG')
    )

    render(
      <DiagnosticPanel
        studentId="student-1"
        skillId="ss3.lexis_and_structure.sentence_completion"
        subject="english-jss3-ss3"
        diagnosticId="english-jss3-ss3-v1"
      />
    )

    await waitFor(() => {
      expect(startDiagnosticMock).toHaveBeenCalledWith(
        expect.objectContaining({
          student_id: 'student-1',
          skill_id: 'ss3.lexis_and_structure.sentence_completion',
          subject: 'english-jss3-ss3',
          diagnostic_id: 'english-jss3-ss3-v1',
        })
      )
    })
  })
})
