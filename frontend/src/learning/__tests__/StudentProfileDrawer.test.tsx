import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
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

const secureSkill: StudentProfileSkill = {
  skill_id: 'plane-geometry',
  skill_label: 'Plane geometry',
  probability: 0.88,
  uncertainty: 0.07,
  kind: 'beta',
  status: 'secure',
}

const profile: StudentProfileResponse = {
  tenant_id: 'tenant-phase-2',
  student_id: 'student-001',
  skills: [skill, secureSkill],
  strengths: [
    {
      skill_id: secureSkill.skill_id,
      skill_label: secureSkill.skill_label,
      probability: secureSkill.probability,
      uncertainty: secureSkill.uncertainty,
      status: secureSkill.status,
      evidence: [
        {
          source: 'mastery_model',
          summary: 'Mastery model estimates 88% mastery with 7% uncertainty',
          skill_id: secureSkill.skill_id,
          confidence: 0.82,
        },
      ],
    },
  ],
  gaps: [
    {
      skill_id: skill.skill_id,
      skill_label: skill.skill_label,
      probability: skill.probability,
      uncertainty: skill.uncertainty,
      status: skill.status,
      evidence: [
        {
          source: 'diagnostic_response',
          summary: "Incorrect diagnostic response '3:4' on item-ratio-1",
          skill_id: skill.skill_id,
          item_id: 'item-ratio-1',
          correct: false,
          confidence: 0.9,
        },
      ],
    },
  ],
  voice_fluency: {
    status: 'available',
    score: 72,
    label: 'Developing oral reading fluency',
    evidence:
      'Latest oral-reading check: 72/100 fluency, hesitations around ratio vocabulary.',
    captured_at: '2026-05-24T09:15:00+00:00',
    lang: 'en-NG',
    provenance: [
      {
        source: 'LearningApi._voice_fluency_for_student',
        rule_id: 'pilot_oral_reading_fluency_snapshot',
        confidence: 0.84,
        evidence_count: 1,
      },
    ],
  },
  proposed_student_facts: [
    {
      id: 'student-fact-1',
      tenant_id: 'tenant-phase-2',
      class_id: 'class-jss2-a',
      student_id: 'student-001',
      created_by_user_id: 'pathfinder-detector',
      status: 'pending',
      lang: 'en-NG',
      provenance: [],
      fact: {
        fact_id: 'student-fact-1',
        tenant_id: 'tenant-phase-2',
        class_id: 'class-jss2-a',
        student_id: 'student-001',
        student_name: 'Tobi A.',
        key: 'learning_support',
        value: 'Needs worked examples before independent ratio practice',
        evidence: 'Diagnostic response pattern + exit ticket',
        requires_approval: true,
        lang: 'en-NG',
        provenance: [],
      },
    },
  ],
  approved_student_facts: [],
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
  skills: [
    { ...skill, probability: 0.65, uncertainty: 0.09, status: 'developing' },
  ],
  recent_mastery_events: [
    {
      id: 'mastery-model-1',
      kind: 'mastery_event',
      skill_id: 'ratio-proportion',
      estimate: {
        kind: 'beta',
        probability: 0.42,
        uncertainty: 0.18,
        a: 21,
        b: 29,
      },
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
  it('renders skills from the profile response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(profile))

    render(
      <StudentProfileDrawer open studentId="student-001" onClose={() => {}} />
    )

    expect(
      (await screen.findAllByText('Ratio and proportion')).length
    ).toBeGreaterThan(0)
    expect(screen.getAllByText('Plane geometry').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Needs support').length).toBeGreaterThan(0)
    expect(screen.getByText('Strengths')).toBeTruthy()
    expect(screen.getByText('Gaps and evidence')).toBeTruthy()
    expect(
      screen.getByText("Incorrect diagnostic response '3:4' on item-ratio-1")
    ).toBeTruthy()
    expect(screen.getByText('Fluency 72%')).toBeTruthy()
    expect(
      screen.getByText(
        'Needs worked examples before independent ratio practice'
      )
    ).toBeTruthy()
    expect(
      screen.getByText(
        'Ratio Proportion · Response: 3:4 · Practice item item ratio 1'
      )
    ).toBeTruthy()
  })

  it('does not serialize missing optional query params as undefined strings', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(profile))

    render(
      <StudentProfileDrawer open studentId="student-001" onClose={() => {}} />
    )

    await screen.findAllByText('Ratio and proportion')
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/learning/students/student-001/profile'
    )
  })

  it('uses fallback heatmap skills when the live profile is not hydrated yet', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ ...profile, skills: [] })
    )

    render(
      <StudentProfileDrawer
        open
        studentId="student-001"
        fallbackSkills={[skill]}
        onClose={() => {}}
      />
    )

    expect(
      (await screen.findAllByText('Ratio and proportion')).length
    ).toBeGreaterThan(0)
    expect(screen.getAllByText('Needs support').length).toBeGreaterThan(0)
  })

  it('opens adjustment dialog with the selected skill', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(profile))
    render(
      <StudentProfileDrawer open studentId="student-001" onClose={() => {}} />
    )

    await screen.findAllByText('Ratio and proportion')
    fireEvent.click(
      screen.getAllByRole('button', { name: /adjust mastery/i })[0]
    )

    const dialog = screen.getByLabelText('Adjust mastery dialog')
    expect(
      within(dialog).getByText('Learner profile · Ratio and proportion')
    ).toBeTruthy()
  })

  it('submits a valid mastery adjustment to the endpoint', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(profile))
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          student_id: 'student-001',
          skill_id: 'ratio-proportion',
          estimate: {
            kind: 'beta',
            probability: 0.9,
            uncertainty: 0.05,
            a: 45,
            b: 5,
          },
          status: 'secure',
          xapi_id: 'override-1',
          audit: profile.audit,
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({ ...profile, skills: [{ ...skill, probability: 0.9 }] })
      )
    render(
      <StudentProfileDrawer open studentId="student-001" onClose={() => {}} />
    )

    await screen.findAllByText('Ratio and proportion')
    fireEvent.click(
      screen.getAllByRole('button', { name: /adjust mastery/i })[0]
    )
    fireEvent.change(screen.getByLabelText('Probability value'), {
      target: { value: '0.9' },
    })
    fireEvent.change(screen.getByLabelText('Uncertainty value'), {
      target: { value: '0.05' },
    })
    fireEvent.change(screen.getByLabelText('Adjustment reason'), {
      target: { value: 'Teacher observed a secure explanation.' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save adjustment/i }))

    await waitFor(() => {
      expect(fetchMock.mock.calls[1]?.[0]).toBe(
        '/api/learning/students/student-001/override'
      )
    })
    const payload = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))
    expect(payload).toMatchObject({
      skill_id: 'ratio-proportion',
      probability: 0.9,
      uncertainty: 0.05,
      reason: 'Teacher observed a secure explanation.',
    })
    expect(await screen.findByText('Mastery adjustment saved')).toBeTruthy()
  })

  it('enables restore for latest teacher adjustments and shows the estimate diff', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(overriddenProfile)
    )
    render(
      <StudentProfileDrawer open studentId="student-001" onClose={() => {}} />
    )

    await screen.findAllByText('Ratio and proportion')
    const revertButton = screen.getAllByRole('button', {
      name: /restore estimate/i,
    })[0]
    expect(revertButton.getAttribute('disabled')).toBeNull()

    fireEvent.click(revertButton)

    const dialog = screen.getByLabelText('Restore mastery dialog')
    expect(
      within(dialog).getByText('Restore mastery from 65% to 42%?')
    ).toBeTruthy()
  })

  it('submits a restore using the prior estimate', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(overriddenProfile))
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          student_id: 'student-001',
          skill_id: 'ratio-proportion',
          estimate: {
            kind: 'beta',
            probability: 0.42,
            uncertainty: 0.18,
            a: 21,
            b: 29,
          },
          status: 'needs_support',
          xapi_id: 'override-revert-1',
          audit: profile.audit,
        })
      )
      .mockResolvedValueOnce(jsonResponse(profile))
    render(
      <StudentProfileDrawer open studentId="student-001" onClose={() => {}} />
    )

    await screen.findAllByText('Ratio and proportion')
    fireEvent.click(
      screen.getAllByRole('button', { name: /restore estimate/i })[0]
    )
    fireEvent.click(screen.getByRole('button', { name: /confirm restore/i }))

    await waitFor(() => {
      expect(fetchMock.mock.calls[1]?.[0]).toBe(
        '/api/learning/students/student-001/override'
      )
    })
    const payload = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))
    expect(payload).toMatchObject({
      skill_id: 'ratio-proportion',
      probability: 0.42,
      uncertainty: 0.18,
      reason: 'Restored previous teacher-reviewed estimate',
    })
    expect(
      await screen.findByText('Mastery restored to the previous estimate')
    ).toBeTruthy()
  })

  it('disables restore when no previous estimate is available', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(overrideWithoutPriorProfile)
    )
    render(
      <StudentProfileDrawer open studentId="student-001" onClose={() => {}} />
    )

    await screen.findAllByText('Ratio and proportion')
    const revertButton = screen.getAllByRole('button', {
      name: /restore estimate/i,
    })[0]
    expect(revertButton.getAttribute('disabled')).not.toBeNull()
    expect(revertButton.getAttribute('title')).toBe(
      'No previous estimate available'
    )
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

    fireEvent.change(screen.getByLabelText('Probability value'), {
      target: { value: '1.2' },
    })
    fireEvent.change(screen.getByLabelText('Adjustment reason'), {
      target: { value: 'Valid reason' },
    })

    expect(
      screen
        .getByRole('button', { name: /save adjustment/i })
        .getAttribute('disabled')
    ).not.toBeNull()
  })

  it('surfaces a server error message inline', async () => {
    render(
      <OverrideMasteryDialog
        open
        studentId="student-001"
        skill={skill}
        onClose={() => {}}
        onSubmit={async () => {
          throw new Error(
            'Learning API 400: probability must be between 0 and 1'
          )
        }}
      />
    )

    fireEvent.change(screen.getByLabelText('Adjustment reason'), {
      target: { value: 'Valid reason' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save adjustment/i }))

    expect(
      await screen.findByText(/probability must be between 0 and 1/)
    ).toBeTruthy()
  })
})
