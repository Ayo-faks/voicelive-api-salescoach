import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OverrideMasteryDialog } from '../OverrideMasteryDialog'
import { StudentProfileDrawer } from '../StudentProfileDrawer'
import type { StudentProfileResponse, StudentProfileSkill } from '../api'

const skill: StudentProfileSkill = {
  skill_id: 'ratio-proportion',
  skill_label: 'Ratio and proportion',
  probability: 0.42,
  uncertainty: 0.18,
  kind: 'beta',
  status: 'needs_support',
}

const profile: StudentProfileResponse = {
  tenant_id: 'tenant-phase-2',
  student_id: 'student-001',
  skills: [skill],
  recent_responses: [
    {
      id: 'response-1',
      item_id: 'item-ratio-1',
      skill_id: 'ratio-proportion',
      response_text: '3:4',
      correct: false,
    },
  ],
  recent_mastery_events: [
    {
      id: 'mastery-1',
      skill_id: 'ratio-proportion',
    },
  ],
  xapi_id: 'student-profile-view-1',
  audit: {
    tenant_id: 'tenant-phase-2',
    actor_id: 'teacher-001',
    label: 'Viewed profile',
    kind: 'student_profile_view',
  },
}

const overriddenProfile: StudentProfileResponse = {
  ...profile,
  skills: [{ ...skill, probability: 0.65, uncertainty: 0.09, status: 'developing' }],
  recent_mastery_events: [
    {
      id: 'mastery-model-1',
      kind: 'mastery_event',
      skill_id: 'ratio-proportion',
      estimate: { kind: 'beta', probability: 0.42, uncertainty: 0.18, a: 21, b: 29 },
    },
    {
      id: 'mastery-override-1',
      kind: 'mastery_override',
      skill_id: 'ratio-proportion',
      probability: 0.65,
      uncertainty: 0.09,
    },
  ],
}

const overrideWithoutPriorProfile: StudentProfileResponse = {
  ...overriddenProfile,
  recent_mastery_events: [
    {
      id: 'mastery-override-1',
      kind: 'mastery_override',
      skill_id: 'ratio-proportion',
      probability: 0.65,
      uncertainty: 0.09,
    },
  ],
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Bad Request',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('StudentProfileDrawer', () => {
  it('renders skills from the mocked profile response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(profile))

    render(<StudentProfileDrawer open studentId="student-001" onClose={() => {}} />)

    expect(await screen.findByText('Ratio and proportion')).toBeTruthy()
    expect(screen.getByText('Needs support')).toBeTruthy()
    expect(screen.getByText('item-ratio-1 · ratio-proportion · 3:4')).toBeTruthy()
  })

  it('does not serialize missing optional query params as undefined strings', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(profile))

    render(<StudentProfileDrawer open studentId="student-001" onClose={() => {}} />)

    await screen.findByText('Ratio and proportion')
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/learning/students/student-001/profile')
  })

  it('uses fallback heatmap skills when the live profile is not hydrated yet', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ...profile, skills: [] }))

    render(
      <StudentProfileDrawer
        open
        studentId="student-001"
        fallbackSkills={[skill]}
        onClose={() => {}}
      />
    )

    expect(await screen.findByText('Ratio and proportion')).toBeTruthy()
    expect(screen.getByText('Needs support')).toBeTruthy()
  })

  it('opens override dialog with the selected skill id', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(profile))
    render(<StudentProfileDrawer open studentId="student-001" onClose={() => {}} />)

    await screen.findByText('Ratio and proportion')
    fireEvent.click(screen.getByRole('button', { name: /override mastery/i }))

    const dialog = screen.getByLabelText('Override mastery dialog')
    expect(within(dialog).getByText(/ratio-proportion/)).toBeTruthy()
  })

  it('submits a valid override to the override endpoint', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(profile))
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          student_id: 'student-001',
          skill_id: 'ratio-proportion',
          estimate: { kind: 'beta', probability: 0.9, uncertainty: 0.05, a: 45, b: 5 },
          status: 'secure',
          xapi_id: 'override-1',
          audit: profile.audit,
        })
      )
      .mockResolvedValueOnce(jsonResponse({ ...profile, skills: [{ ...skill, probability: 0.9 }] }))
    render(<StudentProfileDrawer open studentId="student-001" onClose={() => {}} />)

    await screen.findByText('Ratio and proportion')
    fireEvent.click(screen.getByRole('button', { name: /override mastery/i }))
    fireEvent.change(screen.getByLabelText('Probability value'), { target: { value: '0.9' } })
    fireEvent.change(screen.getByLabelText('Uncertainty value'), { target: { value: '0.05' } })
    fireEvent.change(screen.getByLabelText('Override reason'), {
      target: { value: 'Teacher observed a secure explanation.' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save override/i }))

    await waitFor(() => {
      expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/learning/students/student-001/override')
    })
    const payload = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))
    expect(payload).toMatchObject({
      skill_id: 'ratio-proportion',
      probability: 0.9,
      uncertainty: 0.05,
      reason: 'Teacher observed a secure explanation.',
    })
    expect(await screen.findByText('Mastery overridden')).toBeTruthy()
  })

  it('enables revert for latest teacher overrides and shows the model diff', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(overriddenProfile))
    render(<StudentProfileDrawer open studentId="student-001" onClose={() => {}} />)

    await screen.findByText('Ratio and proportion')
    const revertButton = screen.getByRole('button', { name: /revert to model estimate/i })
    expect(revertButton.getAttribute('disabled')).toBeNull()

    fireEvent.click(revertButton)

    const dialog = screen.getByLabelText('Revert mastery dialog')
    expect(within(dialog).getByText('Revert from 65% back to 42%?')).toBeTruthy()
  })

  it('submits a revert override using the prior model estimate', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(overriddenProfile))
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          student_id: 'student-001',
          skill_id: 'ratio-proportion',
          estimate: { kind: 'beta', probability: 0.42, uncertainty: 0.18, a: 21, b: 29 },
          status: 'needs_support',
          xapi_id: 'override-revert-1',
          audit: profile.audit,
        })
      )
      .mockResolvedValueOnce(jsonResponse(profile))
    render(<StudentProfileDrawer open studentId="student-001" onClose={() => {}} />)

    await screen.findByText('Ratio and proportion')
    fireEvent.click(screen.getByRole('button', { name: /revert to model estimate/i }))
    fireEvent.click(screen.getByRole('button', { name: /confirm revert/i }))

    await waitFor(() => {
      expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/learning/students/student-001/override')
    })
    const payload = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))
    expect(payload).toMatchObject({
      skill_id: 'ratio-proportion',
      probability: 0.42,
      uncertainty: 0.18,
      reason: 'Reverted teacher override',
    })
    expect(await screen.findByText('Mastery reverted to model estimate')).toBeTruthy()
  })

  it('disables revert when no prior model estimate is available', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(overrideWithoutPriorProfile))
    render(<StudentProfileDrawer open studentId="student-001" onClose={() => {}} />)

    await screen.findByText('Ratio and proportion')
    const revertButton = screen.getByRole('button', { name: /revert to model estimate/i })
    expect(revertButton.getAttribute('disabled')).not.toBeNull()
    expect(revertButton.getAttribute('title')).toBe('No prior model estimate available')
  })
})

describe('OverrideMasteryDialog', () => {
  it('disables submit when probability is invalid', () => {
    render(
      <OverrideMasteryDialog
        open
        studentId="student-001"
        skill={skill}
        onClose={() => {}}
        onSubmit={async () => {}}
      />
    )

    fireEvent.change(screen.getByLabelText('Probability value'), { target: { value: '1.2' } })
    fireEvent.change(screen.getByLabelText('Override reason'), { target: { value: 'Valid reason' } })

    expect(screen.getByRole('button', { name: /save override/i }).getAttribute('disabled')).not.toBeNull()
  })

  it('surfaces a server error message inline', async () => {
    render(
      <OverrideMasteryDialog
        open
        studentId="student-001"
        skill={skill}
        onClose={() => {}}
        onSubmit={async () => {
          throw new Error('Learning API 400: probability must be between 0 and 1')
        }}
      />
    )

    fireEvent.change(screen.getByLabelText('Override reason'), { target: { value: 'Valid reason' } })
    fireEvent.click(screen.getByRole('button', { name: /save override/i }))

    expect(await screen.findByText(/probability must be between 0 and 1/)).toBeTruthy()
  })
})
