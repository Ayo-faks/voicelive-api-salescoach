import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const diagnosticPanelMock = vi.hoisted(() => vi.fn())

vi.mock('../components/DiagnosticPanel', () => ({
  default: (props: {
    skillId?: string
    subject?: string
    studentId?: string | null
  }) => {
    diagnosticPanelMock(props)
    return (
      <div data-testid="diagnostic-panel-mock">
        {props.skillId} · {props.subject} · {props.studentId}
      </div>
    )
  },
}))

import ExamPrepLibrary from '../routes/ExamPrepLibrary'
import { examPrep } from '../data/examPrep'

beforeEach(() => {
  // jsdom does not implement scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  diagnosticPanelMock.mockClear()
  vi.restoreAllMocks()
})

describe('ExamPrepLibrary', () => {
  it('renders the catalogue as a searchable library', () => {
    render(<ExamPrepLibrary studentId="student-1" />)
    expect(screen.getByTestId('route-exam-prep')).toBeTruthy()
    // Every catalogue item is rendered as a row by default.
    for (const item of examPrep) {
      expect(screen.getByTestId(`exam-prep-${item.id}`)).toBeTruthy()
    }
  })

  it('filters by free-text search and shows an empty state', () => {
    render(<ExamPrepLibrary studentId="student-1" />)
    fireEvent.change(screen.getByTestId('exam-prep-search'), {
      target: { value: 'indices' },
    })
    expect(screen.getByTestId('exam-prep-maths-ss3-indices')).toBeTruthy()
    expect(
      screen.queryByTestId('exam-prep-biology-ss3-respiration')
    ).toBeNull()

    fireEvent.change(screen.getByTestId('exam-prep-search'), {
      target: { value: 'zzz-no-match' },
    })
    expect(screen.getByTestId('exam-prep-empty')).toBeTruthy()
  })

  it('filters by subject pill', () => {
    render(<ExamPrepLibrary studentId="student-1" />)
    fireEvent.click(screen.getByTestId('exam-prep-subject-biology'))
    expect(
      screen.getByTestId('exam-prep-biology-ss3-living-things')
    ).toBeTruthy()
    expect(screen.queryByTestId('exam-prep-maths-ss3-indices')).toBeNull()
  })

  it('starts a visible practice session when an item is clicked', () => {
    render(<ExamPrepLibrary studentId="student-1" />)
    expect(screen.queryByTestId('exam-prep-practice')).toBeNull()

    fireEvent.click(screen.getByTestId('exam-prep-maths-ss3-indices'))

    const practice = screen.getByTestId('exam-prep-practice')
    expect(practice).toBeTruthy()
    expect(within(practice).getByTestId('diagnostic-panel-mock')).toBeTruthy()
    expect(diagnosticPanelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        skillId: 'ss3.indices.laws_of_indices',
        subject: 'mathematics',
        studentId: 'student-1',
      })
    )
  })

  it('returns to the library from the practice view', () => {
    render(<ExamPrepLibrary studentId="student-1" />)
    fireEvent.click(screen.getByTestId('exam-prep-maths-ss3-indices'))
    expect(screen.getByTestId('exam-prep-practice')).toBeTruthy()
    fireEvent.click(screen.getByTestId('exam-prep-back'))
    expect(screen.queryByTestId('exam-prep-practice')).toBeNull()
  })
})
