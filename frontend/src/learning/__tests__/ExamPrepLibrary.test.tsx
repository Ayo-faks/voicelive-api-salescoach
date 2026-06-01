import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const diagnosticPanelMock = vi.hoisted(() => vi.fn())

vi.mock('../components/DiagnosticPanel', () => ({
  default: (props: {
    skillId?: string
    skillIds?: string[]
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

const fetchExamPrepTopicsMock = vi.hoisted(() => vi.fn())

vi.mock('../api', () => ({
  fetchExamPrepTopics: (...args: unknown[]) => fetchExamPrepTopicsMock(...args),
}))

import ExamPrepLibrary from '../routes/ExamPrepLibrary'
import { examPrep } from '../data/examPrep'

beforeEach(() => {
  // jsdom does not implement scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn()
  // Default: empty live catalogue so the static teaser stays in place.
  fetchExamPrepTopicsMock.mockResolvedValue({ topics: [] })
})

afterEach(() => {
  diagnosticPanelMock.mockClear()
  fetchExamPrepTopicsMock.mockReset()
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

describe('ExamPrepLibrary live catalogue', () => {
  const liveResponse = {
    generated_at: '2026-01-01T00:00:00Z',
    subject_count: 1,
    topic_count: 1,
    subjects: [
      {
        subject: 'physics',
        label: 'Physics',
        topic_count: 1,
        skill_count: 12,
        topics: [],
      },
    ],
    topics: [
      {
        id: 'physics.ss3.motion',
        title: 'Physics · Motion',
        subject: 'physics',
        subject_label: 'Physics',
        topic: 'motion',
        topic_label: 'Motion',
        year: 'SS3',
        exam: 'WAEC/NECO',
        skill_id: 'ss3.motion.newtons_laws',
        diagnostic_id: 'diag-physics',
        diagnostic_subject: 'physics',
        skill_count: 2,
        skills: [
          { skill_id: 'ss3.motion.newtons_laws', label: "Newton's laws" },
          { skill_id: 'ss3.motion.projectiles', label: 'Projectiles' },
        ],
        minutes: 6,
      },
    ],
  }

  it('drills into a topic to reveal its skills before practice', async () => {
    fetchExamPrepTopicsMock.mockResolvedValue(liveResponse)

    render(<ExamPrepLibrary studentId="student-1" />)

    const row = await screen.findByTestId('exam-prep-physics.ss3.motion')
    expect(row).toBeTruthy()
    // The static teaser is replaced by the live catalogue.
    expect(screen.queryByTestId('exam-prep-maths-ss3-indices')).toBeNull()

    // Clicking a topic opens its skill breakdown, not practice straight away.
    fireEvent.click(row)
    expect(screen.queryByTestId('exam-prep-practice')).toBeNull()
    const detail = screen.getByTestId('exam-prep-detail')
    expect(detail).toBeTruthy()
    expect(
      within(detail).getByTestId('exam-prep-skill-ss3.motion.newtons_laws')
    ).toBeTruthy()
    expect(
      within(detail).getByTestId('exam-prep-skill-ss3.motion.projectiles')
    ).toBeTruthy()
    expect(diagnosticPanelMock).not.toHaveBeenCalled()
  })

  it('practises a single drilled-into skill', async () => {
    fetchExamPrepTopicsMock.mockResolvedValue(liveResponse)

    render(<ExamPrepLibrary studentId="student-1" />)

    fireEvent.click(await screen.findByTestId('exam-prep-physics.ss3.motion'))
    fireEvent.click(screen.getByTestId('exam-prep-skill-ss3.motion.projectiles'))

    expect(screen.getByTestId('exam-prep-practice')).toBeTruthy()
    expect(diagnosticPanelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        skillId: 'ss3.motion.projectiles',
        subject: 'physics',
        studentId: 'student-1',
      })
    )

    // Back returns to the skill list, not the library.
    fireEvent.click(screen.getByTestId('exam-prep-back'))
    expect(screen.queryByTestId('exam-prep-practice')).toBeNull()
    expect(screen.getByTestId('exam-prep-detail')).toBeTruthy()
  })

  it('practises the whole topic from the detail view', async () => {
    fetchExamPrepTopicsMock.mockResolvedValue(liveResponse)

    render(<ExamPrepLibrary studentId="student-1" />)

    fireEvent.click(await screen.findByTestId('exam-prep-physics.ss3.motion'))
    fireEvent.click(screen.getByTestId('exam-prep-practice-all'))

    expect(screen.getByTestId('exam-prep-practice')).toBeTruthy()
    // "Practise all" runs a multi-skill session across every topic skill.
    expect(diagnosticPanelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        skillIds: ['ss3.motion.newtons_laws', 'ss3.motion.projectiles'],
        subject: 'physics',
        studentId: 'student-1',
      })
    )
  })

  it('falls back to the static catalogue when the live fetch fails', async () => {
    fetchExamPrepTopicsMock.mockRejectedValue(new Error('boom'))

    render(<ExamPrepLibrary studentId="student-1" />)

    expect(
      await screen.findByTestId('exam-prep-maths-ss3-indices')
    ).toBeTruthy()
  })
})
