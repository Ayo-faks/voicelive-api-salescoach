import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const practiceFullscreenMock = vi.hoisted(() => vi.fn())

vi.mock('../components/PracticeFullscreen', () => ({
  default: (props: {
    open: boolean
    onClose: () => void
    childId: string
    exam?: string
    classYear?: string
    subject?: string
    skillId?: string
    skillStrict?: boolean
    maxQuestions?: number
  }) => {
    practiceFullscreenMock(props)
    return (
      <div data-testid="practice-fullscreen-mock">
        {props.skillId} · {props.subject} · {props.childId}
      </div>
    )
  },
}))

const fetchExamPrepTopicsMock = vi.hoisted(() => vi.fn())

vi.mock('../api', () => ({
  fetchExamPrepTopics: (...args: unknown[]) => fetchExamPrepTopicsMock(...args),
}))

import ExamPrepLibraryRoute from '../routes/ExamPrepLibrary'
import { examPrep } from '../data/examPrep'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

// The route reads/writes `/exam-prep/:topic/:skill`, so the tests mount it
// inside a matching splat route. Topic + practice navigation then steps through
// real URL changes exactly as it does in the app shell.
function ExamPrepLibrary(props: { studentId?: string | null }) {
  return (
    <MemoryRouter initialEntries={['/exam-prep']}>
      <Routes>
        <Route
          path="/exam-prep/*"
          element={<ExamPrepLibraryRoute {...props} />}
        />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  // jsdom does not implement scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn()
  // Default: empty live catalogue so the static teaser stays in place.
  fetchExamPrepTopicsMock.mockResolvedValue({ topics: [] })
})

afterEach(() => {
  practiceFullscreenMock.mockClear()
  fetchExamPrepTopicsMock.mockReset()
  vi.restoreAllMocks()
})

describe('ExamPrepLibrary', () => {
  it('groups topics into collapsible subject sections, learner subject open by default (#1)', () => {
    render(<ExamPrepLibrary studentId="student-1" />)
    expect(screen.getByTestId('route-exam-prep')).toBeTruthy()

    // A section header exists for every subject in the catalogue.
    const subjects = Array.from(new Set(examPrep.map(item => item.subject)))
    for (const subjectKey of subjects) {
      expect(
        screen.getByTestId(`exam-prep-section-${subjectKey ?? 'general'}`)
      ).toBeTruthy()
    }

    // The learner's own subject (Mathematics, from the default setup) is
    // expanded, so its topics are visible without any interaction.
    expect(screen.getByTestId('exam-prep-maths-ss3-indices')).toBeTruthy()

    // A different subject stays collapsed until its header is toggled.
    expect(screen.queryByTestId('exam-prep-biology-ss3-respiration')).toBeNull()
    fireEvent.click(screen.getByTestId('exam-prep-section-toggle-biology'))
    expect(
      screen.getByTestId('exam-prep-biology-ss3-respiration')
    ).toBeTruthy()
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
    expect(within(practice).getByTestId('practice-fullscreen-mock')).toBeTruthy()
    expect(practiceFullscreenMock).toHaveBeenCalledWith(
      expect.objectContaining({
        childId: 'student-1',
        exam: 'WAEC',
        classYear: 'SSS3',
        skillId: 'ss3.indices.laws_of_indices',
        subject: 'mathematics',
        skillStrict: true,
        maxQuestions: 10,
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

  it('shows a result count that tracks the active filters', () => {
    render(<ExamPrepLibrary studentId="student-1" />)
    const count = screen.getByTestId('exam-prep-count')
    expect(count.textContent).toMatch(/\d+ topics? · \d+ subjects?/)

    fireEvent.click(screen.getByTestId('exam-prep-subject-biology'))
    expect(screen.getByTestId('exam-prep-count').textContent).toMatch(
      /1 subject\b/
    )
  })

  it('swaps the library heading for the session context during practice (#15)', () => {
    render(<ExamPrepLibrary studentId="student-1" />)
    expect(screen.getByTestId('exam-prep-heading').textContent).toContain(
      'Exam prep'
    )
    fireEvent.click(screen.getByTestId('exam-prep-maths-ss3-indices'))
    // The dominant heading is now the live task, not library chrome.
    expect(screen.getByTestId('exam-prep-heading').textContent).not.toContain(
      'Exam prep'
    )
    expect(screen.getByTestId('exam-prep-heading').textContent).toContain(
      'Laws of indices'
    )
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
    expect(practiceFullscreenMock).not.toHaveBeenCalled()
  })

  it('practises a single drilled-into skill', async () => {
    fetchExamPrepTopicsMock.mockResolvedValue(liveResponse)

    render(<ExamPrepLibrary studentId="student-1" />)

    fireEvent.click(await screen.findByTestId('exam-prep-physics.ss3.motion'))
    fireEvent.click(screen.getByTestId('exam-prep-skill-ss3.motion.projectiles'))

    expect(screen.getByTestId('exam-prep-practice')).toBeTruthy()
    expect(practiceFullscreenMock).toHaveBeenCalledWith(
      expect.objectContaining({
        childId: 'student-1',
        exam: 'WAEC',
        classYear: 'SSS3',
        skillId: 'ss3.motion.projectiles',
        subject: 'physics',
        skillStrict: true,
        maxQuestions: 10,
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
    // "Practise all" opens the topic's representative skill without strict filtering.
    expect(practiceFullscreenMock).toHaveBeenCalledWith(
      expect.objectContaining({
        childId: 'student-1',
        exam: 'WAEC',
        classYear: 'SSS3',
        skillId: 'ss3.motion.newtons_laws',
        subject: 'physics',
        skillStrict: false,
        maxQuestions: 10,
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

  it('opens a practice session straight from a deep link (#8)', () => {
    // A shared/refreshed `/exam-prep/:topic/:skill` URL lands directly on the
    // practice session instead of the bare library.
    render(
      <MemoryRouter initialEntries={['/exam-prep/maths-ss3-indices/practice']}>
        <Routes>
          <Route
            path="/exam-prep/*"
            element={<ExamPrepLibraryRoute studentId="student-1" />}
          />
        </Routes>
      </MemoryRouter>
    )

    expect(screen.getByTestId('exam-prep-practice')).toBeTruthy()
    expect(practiceFullscreenMock).toHaveBeenCalledWith(
      expect.objectContaining({
        childId: 'student-1',
        exam: 'WAEC',
        classYear: 'SSS3',
        skillId: 'ss3.indices.laws_of_indices',
        subject: 'mathematics',
        skillStrict: true,
      })
    )
  })
})
