import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

function mockVoiceConfig() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(input => {
    const url = String(input)
    if (url === '/api/learning/voice/config') {
      return Promise.resolve(
        jsonResponse({
          enabled: false,
          transport: 'flask-sock',
          offline_fallback: 'queued_multilingual_voice_frame',
        })
      )
    }
    return Promise.reject(new Error(`Unexpected URL ${url}`))
  })
}

afterEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('StudentLearningHome', () => {
  it('runs a cross-device five-step demo diagnostic and saves it locally', async () => {
    mockVoiceConfig()

    render(<StudentLearningHome studentId="student-001" />)

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/learning/voice/config',
        expect.objectContaining({ method: 'GET' })
      )
    })

    expect(screen.getByTestId('cross-device-learner-workspace')).toBeTruthy()
    expect(screen.getByText('Web, desktop, tablet, and phone')).toBeTruthy()
    expect(screen.getByText('Desktop web')).toBeTruthy()
    expect(screen.getByText('Tablet / shared device')).toBeTruthy()
    expect(screen.getByText('Phone / offline')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Start 5-step demo/i }))

    expect(screen.getByTestId('short-demo-diagnostic')).toBeTruthy()
    expect(screen.getByText('3-5 minute demo diagnostic')).toBeTruthy()
    expect(screen.getByText('Five short signals. Keyboard, mouse, or touch. Works offline.')).toBeTruthy()
    expect(screen.getByTestId('demo-step-count').textContent).toContain('Step 1 of 5')
    expect(screen.getByText(/2 cups rice need 3 cups water/i)).toBeTruthy()

    fireEvent.click(within(screen.getByTestId('short-demo-diagnostic')).getByRole('button', { name: /6 cups/i }))
    expect(screen.getByText('Reading')).toBeTruthy()
    expect(screen.getByText(/Amina charged the solar lamp/i)).toBeTruthy()

    fireEvent.click(within(screen.getByTestId('short-demo-diagnostic')).getByRole('button', { name: /So she could study later/i }))
    expect(screen.getByText('Voice')).toBeTruthy()
    expect(screen.getByText(/The small solar lamp helped Amina/i)).toBeTruthy()

    fireEvent.click(within(screen.getByTestId('short-demo-diagnostic')).getByRole('button', { name: /I read it aloud/i }))

    await waitFor(() => {
      expect(screen.getByText('Subject')).toBeTruthy()
      expect(screen.getByText(/Voice sample queued locally/i)).toBeTruthy()
    })

    fireEvent.click(within(screen.getByTestId('short-demo-diagnostic')).getByRole('button', { name: /Copper/i }))
    expect(screen.getByText('Career')).toBeTruthy()
    expect(screen.getByText(/Which activity sounds most interesting today/i)).toBeTruthy()

    fireEvent.click(within(screen.getByTestId('short-demo-diagnostic')).getByRole('button', { name: /Build or fix things/i }))

    await waitFor(() => {
      expect(screen.getByTestId('short-demo-complete')).toBeTruthy()
    })

    const saved = window.localStorage.getItem('pathfinder-demo-diagnostic:last')
    expect(saved).toContain('student-001')
    expect(saved).toContain('career-interest')
  })

  it('visibly adapts the next item after an incorrect answer', async () => {
    mockVoiceConfig()

    render(<StudentLearningHome studentId="student-001" />)

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/learning/voice/config',
        expect.objectContaining({ method: 'GET' })
      )
    })

    fireEvent.click(screen.getByRole('button', { name: /Start 5-step demo/i }))
    fireEvent.click(screen.getByRole('button', { name: /^4 cups/i }))

    expect(screen.getByTestId('adaptive-moment')).toBeTruthy()
    expect(screen.getByText('Pathfinder adapted the next item')).toBeTruthy()
    expect(screen.getByText(/answer suggests doubling the rice was missed/i)).toBeTruthy()
    expect(screen.getByText('Same idea, smaller step')).toBeTruthy()
    expect(screen.getByText(/If 1 cup rice needs 1.5 cups water/i)).toBeTruthy()
    expect(screen.getByTestId('demo-step-count').textContent).toContain('Step 2 of 6')
  })

  it('lets the student complete one generated-plan practice exercise and schedules retrieval', async () => {
    mockVoiceConfig()

    render(<StudentLearningHome studentId="student-001" />)

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/learning/voice/config',
        expect.objectContaining({ method: 'GET' })
      )
    })

    expect(screen.getByTestId('plan-practice-exercise')).toBeTruthy()
    expect(screen.getByText('From generated plan')).toBeTruthy()
    expect(screen.getByText('Teacher-approved ratio recovery plan')).toBeTruthy()
    expect(screen.getByText(/A recipe uses 3 cups of water for 2 cups of rice/i)).toBeTruthy()

    fireEvent.click(within(screen.getByTestId('plan-practice-exercise')).getByRole('button', { name: /9 cups/i }))

    expect(screen.getByTestId('practice-feedback')).toBeTruthy()
    expect(screen.getByText('Immediate feedback')).toBeTruthy()
    expect(screen.getByText('Correct - the plan is working.')).toBeTruthy()
    expect(screen.getByText('Spaced retrieval scheduled')).toBeTruthy()
    expect(screen.getByTestId('spaced-retrieval-schedule')).toBeTruthy()
    expect(screen.getByText(/Today · 10 minutes after this exercise/i)).toBeTruthy()
    expect(screen.getByText(/Tomorrow · Before the next maths lesson/i)).toBeTruthy()
    expect(screen.getByText(/In 4 days · Short weekend retrieval/i)).toBeTruthy()

    const saved = window.localStorage.getItem('pathfinder-practice-loop:last')
    expect(saved).toContain('plan-jss2-ratio-recovery')
    expect(saved).toContain('spacedRetrieval')
  })

  it('answers a doctor and chemistry career question without promising outcomes', async () => {
    mockVoiceConfig()

    render(<StudentLearningHome studentId="student-001" />)

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/learning/voice/config',
        expect.objectContaining({ method: 'GET' })
      )
    })

    expect(screen.getByTestId('career-navigation-moment')).toBeTruthy()
    expect(screen.getByLabelText('Career question')).toHaveProperty(
      'value',
      "Can I still become a doctor if I'm weak in chemistry?"
    )
    expect(screen.getByRole('button', { name: /Ask by voice/i })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Ask by text/i }))

    expect(screen.getByTestId('career-navigation-answer')).toBeTruthy()
    expect(screen.getByText('No outcome guarantee')).toBeTruthy()
    expect(screen.getByText('Can I still become a doctor?')).toBeTruthy()
    expect(screen.getByText(/should not promise an outcome/i)).toBeTruthy()
    expect(screen.getByText('What is realistic')).toBeTruthy()
    expect(screen.getByText('What needs work')).toBeTruthy()
    expect(screen.getByText('What alternatives exist')).toBeTruthy()
    expect(screen.getByText(/nursing, pharmacy technology, medical laboratory science/i)).toBeTruthy()
    expect(screen.getByText('Grounded in science-subject requirements')).toBeTruthy()
    expect(screen.getByText('Counsellor review recommended for career decisions')).toBeTruthy()

    const saved = window.localStorage.getItem('pathfinder-career-navigation:last')
    expect(saved).toContain('doctor')
    expect(saved).toContain('chemistry')
  })
})