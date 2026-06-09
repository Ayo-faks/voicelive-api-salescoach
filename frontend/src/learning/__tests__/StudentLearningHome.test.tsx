import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

const practiceFullscreenMock = vi.hoisted(() => vi.fn())
const learnerTutorMock = vi.hoisted(() => vi.fn())

vi.mock('../components/PracticeFullscreen', () => ({
  default: (props: {
    open: boolean
    childId: string
    exam?: string
    classYear?: string
    subject?: string
    skillId?: string
  }) => {
    practiceFullscreenMock(props)
    return props.open ? (
      <div data-testid="practice-fullscreen-mock">
        {props.childId} · {props.exam} · {props.classYear} · {props.subject}
      </div>
    ) : null
  },
}))

vi.mock('../components/LearnerTutorFullscreen', () => ({
  default: (props: {
    open: boolean
    childId: string
    exam?: string
    classYear?: string
    subject?: string
    focusItem?: {
      stem?: string
      skillId?: string
      rationale?: string
      scored?: boolean
    } | null
    initialMode?: 'floating' | 'fullscreen'
  }) => {
    learnerTutorMock(props)
    return props.open ? (
      <div data-testid="learner-tutor-mock">
        {props.childId} · {props.exam} · {props.classYear} · {props.subject}
      </div>
    ) : null
  },
}))

import StudentLearningHome from '../routes/StudentLearningHome'

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

function mockVoiceConfig(
  options: {
    voiceEnabled?: boolean
    safety?: {
      learner_voice_disabled: boolean
      session_turn_cap: number | null
      session_token_cap: number | null
      production_content_review_required: boolean
    } | null
  } = {}
) {
  const voiceEnabled = options.voiceEnabled ?? false
  const safety = options.safety
  vi.spyOn(globalThis, 'fetch').mockImplementation(input => {
    const url = String(input)
    if (url === '/api/learning/voice/config') {
      return Promise.resolve(
        jsonResponse({
          enabled: voiceEnabled,
          transport: 'flask-sock',
          offline_fallback: 'queued_multilingual_voice_frame',
        })
      )
    }
    if (url === '/api/config') {
      return Promise.resolve(
        jsonResponse({
          status: 'ok',
          proxy_enabled: false,
          ws_endpoint: '/ws',
          storage_ready: true,
          telemetry_enabled: false,
          image_base_path: '/static/images',
          ...(safety ? { safety } : {}),
        })
      )
    }
    return Promise.reject(new Error(`Unexpected URL ${url}`))
  })
}

afterEach(() => {
  window.localStorage.clear()
  practiceFullscreenMock.mockClear()
  learnerTutorMock.mockClear()
  vi.restoreAllMocks()
})

describe('StudentLearningHome', () => {
  it('surfaces the free B2C setup, weak-topic profile, daily plan, pathways, and WhatsApp share loop', async () => {
    mockVoiceConfig()

    render(<MemoryRouter><StudentLearningHome studentId="student-001" /></MemoryRouter>)

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/learning/voice/config',
        expect.objectContaining({ method: 'GET' })
      )
    })

    expect(screen.getByTestId('b2c-learner-setup')).toBeTruthy()
    expect(screen.getByText(/Good afternoon, there/i)).toBeTruthy()
    expect(screen.queryByText(/Tobi/i)).toBeNull()
    expect(screen.queryByText('Recent feedback')).toBeNull()
    expect(screen.queryByText('From your teacher')).toBeNull()
    expect(screen.queryByTestId('feedback-empty')).toBeNull()
    expect(screen.getByText(/designed to be safe and responsible/i)).toBeTruthy()

    // The exam-path picker stays collapsed behind one secondary affordance so
    // it does not compete with the hero action (#13).
    expect(screen.queryByLabelText('Select exam')).toBeNull()
    expect(screen.getByTestId('change-exam-path')).toBeTruthy()

    // The exam-path picker is collapsed by default (#13) — open it first.
    fireEvent.click(screen.getByTestId('change-exam-path'))

    fireEvent.change(screen.getByLabelText('Your first name'), {
      target: { value: 'Tomi' },
    })
    expect(screen.getByText(/Good afternoon, Tomi/i)).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Select exam'), {
      target: { value: 'NECO' },
    })
    fireEvent.change(screen.getByLabelText('Select class or year'), {
      target: { value: 'SS3' },
    })
    fireEvent.change(screen.getByLabelText('Select subject'), {
      target: { value: 'English Language' },
    })

    expect(screen.getByText(/3 things today/i)).toBeTruthy()
    expect(screen.getByTestId('weak-topic-profile')).toBeTruthy()
    expect(screen.getAllByText('Ratio and proportion').length).toBeGreaterThan(0)
    expect(
      screen.getByText('Scaling both parts of a recipe or table')
    ).toBeTruthy()
    expect(screen.getByTestId('daily-revision-plan')).toBeTruthy()
    expect(screen.getByText('Explain one mistake')).toBeTruthy()
    expect(screen.getByTestId('career-pathway-suggestions')).toBeTruthy()
    expect(screen.getByText('Data and business operations')).toBeTruthy()
    expect(
      screen.getByText(/Keep building algebra and English explanation skills/i)
    ).toBeTruthy()

    fireEvent.click(screen.getByTestId('parent-share-copy'))

    const saved = window.localStorage.getItem('pathfinder-parent-summary:last')
    expect(saved).toContain('NECO')
    expect(saved).toContain('SS3')
    expect(saved).toContain('English Language')
  })

  it('runs a cross-device five-step demo diagnostic and saves it locally', async () => {
    mockVoiceConfig()

    render(<MemoryRouter><StudentLearningHome studentId="student-001" learnerTutorEnabled={false} /></MemoryRouter>)

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/learning/voice/config',
        expect.objectContaining({ method: 'GET' })
      )
    })

    fireEvent.click(
      screen.getByRole('button', { name: /Study with Wulo/i })
    )

    expect(screen.getByTestId('short-demo-diagnostic')).toBeTruthy()
    expect(screen.getByText('Wulo quick check')).toBeTruthy()
    expect(
      screen.getByText(
        'A few short signals help Wulo tune today’s practice. Keyboard, mouse, or touch.'
      )
    ).toBeTruthy()
    expect(screen.getByTestId('demo-step-count').textContent).toContain(
      'Step 1 of 5'
    )
    expect(screen.getByText(/2 cups rice need 3 cups water/i)).toBeTruthy()

    fireEvent.click(
      within(screen.getByTestId('short-demo-diagnostic')).getByRole('button', {
        name: /6 cups/i,
      })
    )
    expect(screen.getByText('Reading')).toBeTruthy()
    expect(screen.getByText(/Amina charged the solar lamp/i)).toBeTruthy()

    fireEvent.click(
      within(screen.getByTestId('short-demo-diagnostic')).getByRole('button', {
        name: /So she could study later/i,
      })
    )
    expect(screen.getByText('Voice')).toBeTruthy()
    expect(screen.getByText(/The small solar lamp helped Amina/i)).toBeTruthy()

    fireEvent.click(
      within(screen.getByTestId('short-demo-diagnostic')).getByRole('button', {
        name: /I read it aloud/i,
      })
    )

    await waitFor(() => {
      expect(screen.getByText('Subject')).toBeTruthy()
      expect(screen.getByText(/Voice sample queued locally/i)).toBeTruthy()
    })

    fireEvent.click(
      within(screen.getByTestId('short-demo-diagnostic')).getByRole('button', {
        name: /Copper/i,
      })
    )
    expect(screen.getByText('Career')).toBeTruthy()
    expect(
      screen.getByText(/Which activity sounds most interesting today/i)
    ).toBeTruthy()

    fireEvent.click(
      within(screen.getByTestId('short-demo-diagnostic')).getByRole('button', {
        name: /Build or fix things/i,
      })
    )

    await waitFor(() => {
      expect(screen.getByTestId('short-demo-complete')).toBeTruthy()
    })

    const saved = window.localStorage.getItem('pathfinder-demo-diagnostic:last')
    expect(saved).toContain('student-001')
    expect(saved).toContain('career-interest')
  })

  it('visibly adapts the next item after an incorrect answer', async () => {
    mockVoiceConfig()

    render(<MemoryRouter><StudentLearningHome studentId="student-001" learnerTutorEnabled={false} /></MemoryRouter>)

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/learning/voice/config',
        expect.objectContaining({ method: 'GET' })
      )
    })

    fireEvent.click(
      screen.getByRole('button', { name: /Study with Wulo/i })
    )
    fireEvent.click(screen.getByRole('button', { name: /^4 cups/i }))

    expect(screen.getByTestId('adaptive-moment')).toBeTruthy()
    expect(screen.getByText('Wulo Academy adapted the next item')).toBeTruthy()
    expect(
      screen.getByText(/answer suggests doubling the rice was missed/i)
    ).toBeTruthy()
    expect(screen.getByText('Same idea, smaller step')).toBeTruthy()
    expect(screen.getByText(/If 1 cup rice needs 1.5 cups water/i)).toBeTruthy()
    expect(screen.getByTestId('demo-step-count').textContent).toContain(
      'Step 2 of 6'
    )

    const modal = screen.getByTestId('wrong-answer-explanation-modal')
    expect(within(modal).getByText('Correct answer')).toBeTruthy()
    expect(within(modal).getByText('6 cups')).toBeTruthy()
    expect(within(modal).getByText('Why your answer was wrong')).toBeTruthy()
    expect(within(modal).getByText(/repeats the rice amount/i)).toBeTruthy()
    expect(within(modal).getByText('Concept you missed')).toBeTruthy()
    expect(
      within(modal).getByText(
        'Equivalent ratios: both parts must change together.'
      )
    ).toBeTruthy()
    expect(within(modal).getByText('Simpler explanation')).toBeTruthy()
    expect(within(modal).getByText('Try another similar question')).toBeTruthy()
    expect(
      within(modal).getByText('Add this weakness to my revision plan')
    ).toBeTruthy()

    fireEvent.click(
      within(modal).getByRole('button', {
        name: /Add weakness to revision plan/i,
      })
    )

    expect(screen.getByTestId('revision-plan-added')).toBeTruthy()
    expect(
      window.localStorage.getItem('pathfinder-revision-plan:last-added')
    ).toContain('Equivalent ratios')
  })

  it("opens the learner tutor from a Today's-path skill instead of rendering below the row", async () => {
    mockVoiceConfig()

    render(<MemoryRouter><StudentLearningHome studentId="student-001" /></MemoryRouter>)

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/learning/voice/config',
        expect.objectContaining({ method: 'GET' })
      )
    })

    fireEvent.click(screen.getByTestId('hero-path-row-ratio-check'))

    expect(await screen.findByTestId('learner-tutor-mock')).toBeTruthy()
    expect(screen.queryByTestId('today-step-mcq')).toBeNull()
    const lastProps =
      learnerTutorMock.mock.calls[learnerTutorMock.mock.calls.length - 1]?.[0]
    expect(lastProps).toEqual(
      expect.objectContaining({
        open: true,
        childId: 'student-001',
        focusItem: expect.objectContaining({
          stem: 'Ratio mini check-in',
          skillId: 'ratio-proportion',
          rationale: 'Ratio & proportion · adaptive',
          scored: false,
        }),
      })
    )
  })

  it("opens PracticeFullscreen from a Today's-path card", async () => {
    mockVoiceConfig()

    render(<MemoryRouter><StudentLearningHome studentId="student-001" /></MemoryRouter>)

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/learning/voice/config',
        expect.objectContaining({ method: 'GET' })
      )
    })

    fireEvent.click(screen.getByTestId('change-exam-path'))
    fireEvent.change(screen.getByLabelText('Select exam'), {
      target: { value: 'JAMB' },
    })
    fireEvent.change(screen.getByLabelText('Select class or year'), {
      target: { value: 'JSS2' },
    })
    fireEvent.change(screen.getByLabelText('Select subject'), {
      target: { value: 'Mathematics' },
    })
    fireEvent.click(
      screen.getByRole('button', {
        name: /Open practice: Ratio mini check-in/i,
      })
    )

    expect(await screen.findByTestId('practice-fullscreen-mock')).toBeTruthy()
    const lastProps =
      practiceFullscreenMock.mock.calls[
        practiceFullscreenMock.mock.calls.length - 1
      ]?.[0]
    expect(lastProps).toEqual(
      expect.objectContaining({
        open: true,
        childId: 'student-001',
        exam: 'JAMB',
        classYear: 'JSS2',
        subject: 'Mathematics',
      })
    )
  })

  it('auto-opens practice from the goal-intake ?startPractice deep link and forwards the forced skill', async () => {
    mockVoiceConfig()

    render(
      <MemoryRouter
        initialEntries={['/home?startPractice=1&skillId=trigonometry']}
      >
        <StudentLearningHome studentId="student-001" />
      </MemoryRouter>
    )

    // Practice opens without any click — the learner lands in the exercise,
    // not the dashboard (goal-intake "Start now" regression guard).
    expect(await screen.findByTestId('practice-fullscreen-mock')).toBeTruthy()
    const lastProps =
      practiceFullscreenMock.mock.calls[
        practiceFullscreenMock.mock.calls.length - 1
      ]?.[0]
    expect(lastProps).toEqual(
      expect.objectContaining({
        open: true,
        childId: 'student-001',
        skillId: 'trigonometry',
      })
    )
  })

  it('opens the learner tutor from the hero CTA with the selected taxonomy', async () => {
    mockVoiceConfig()

    render(<MemoryRouter><StudentLearningHome studentId="student-001" /></MemoryRouter>)

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/learning/voice/config',
        expect.objectContaining({ method: 'GET' })
      )
    })

    fireEvent.click(screen.getByTestId('change-exam-path'))
    fireEvent.change(screen.getByLabelText('Select exam'), {
      target: { value: 'WAEC' },
    })
    fireEvent.change(screen.getByLabelText('Select class or year'), {
      target: { value: 'SS2' },
    })
    fireEvent.change(screen.getByLabelText('Select subject'), {
      target: { value: 'Mathematics' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Study with Wulo/i }))

    expect(await screen.findByTestId('learner-tutor-mock')).toBeTruthy()
    const lastProps =
      learnerTutorMock.mock.calls[learnerTutorMock.mock.calls.length - 1]?.[0]
    expect(lastProps).toEqual(
      expect.objectContaining({
        open: true,
        childId: 'student-001',
        exam: 'WAEC',
        classYear: 'SS2',
        subject: 'Mathematics',
        initialMode: 'fullscreen',
      })
    )
  })

  it('opens the global voice help assistant in floating mode', async () => {
    mockVoiceConfig()

    render(<MemoryRouter><StudentLearningHome studentId="student-001" /></MemoryRouter>)

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/learning/voice/config',
        expect.objectContaining({ method: 'GET' })
      )
    })

    fireEvent.click(screen.getByTestId('learner-help-fab'))

    expect(await screen.findByTestId('learner-tutor-mock')).toBeTruthy()
    const lastProps =
      learnerTutorMock.mock.calls[learnerTutorMock.mock.calls.length - 1]?.[0]
    expect(lastProps).toEqual(
      expect.objectContaining({
        open: true,
        childId: 'student-001',
        focusItem: null,
        initialMode: 'floating',
      })
    )
  })

  it('no longer renders the standalone Career Navigator card', () => {
    mockVoiceConfig()
    render(<MemoryRouter><StudentLearningHome studentId="student-001" /></MemoryRouter>)
    expect(screen.queryByTestId('career-navigation-moment')).toBeNull()
    expect(screen.queryByTestId('career-navigation-answer')).toBeNull()
  })

  it('hides the voice check-in CTA and shows a non-alarming notice when safety.learner_voice_disabled is true', async () => {
    // Reset the module-level cachedConfig in services/api so this test sees
    // a fresh /api/config fetch with safety.learner_voice_disabled = true.
    vi.resetModules()
    mockVoiceConfig({
      voiceEnabled: true,
      safety: {
        learner_voice_disabled: true,
        session_turn_cap: null,
        session_token_cap: null,
        production_content_review_required: false,
      },
    })
    const { default: FreshStudentLearningHome } = await import(
      '../routes/StudentLearningHome'
    )
    render(
      <MemoryRouter>
        <FreshStudentLearningHome studentId="student-001" />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/config',
        expect.anything()
      )
    })
    await waitFor(() => {
      expect(
        screen.getByTestId('voice-checkin-disabled-notice')
      ).toBeTruthy()
    })
    expect(screen.queryByTestId('start-voice-checkin')).toBeNull()
  })
})
