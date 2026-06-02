import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TeacherMasteryDashboard from '../routes/TeacherMasteryDashboard'

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('TeacherMasteryDashboard', () => {
  it('surfaces the pilot dashboard goal metrics', () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise<Response>(() => {})
    )

    render(<TeacherMasteryDashboard />)

    expect(screen.getAllByText('58 students').length).toBeGreaterThan(0)
    expect(screen.getByText('Class heatmap')).toBeTruthy()
    expect(
      screen.getAllByText('weakest sub-skills this week').length
    ).toBeGreaterThan(0)
    expect(screen.getByText('7 students flagged for intervention')).toBeTruthy()
    expect(
      screen.getAllByText('3 proposed student facts awaiting approval').length
    ).toBeGreaterThan(0)
    expect(screen.getByTestId('transparent-profile-entry')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Open student profile' })
    ).toBeTruthy()
  })

  it('opens the transparent student profile from the heatmap prompt', () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise<Response>(() => {})
    )

    render(<TeacherMasteryDashboard />)

    fireEvent.click(
      screen.getByRole('button', { name: 'Open student profile' })
    )

    expect(screen.getByText('Student profile')).toBeTruthy()
    expect(screen.getByText('Strengths')).toBeTruthy()
    expect(screen.getByText('Gaps and evidence')).toBeTruthy()
    expect(screen.getByText('Voice fluency result')).toBeTruthy()
    expect(screen.getByText('Proposed memory facts')).toBeTruthy()
  })

  it('shows the roster for the selected class', () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise<Response>(() => {})
    )

    render(<TeacherMasteryDashboard />)

    expect(
      screen.getByRole('button', {
        name: /Open profile for Tobi A\., Ratio mastery/,
      })
    ).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'JSS1 A' }))

    expect(screen.getByText('Adaeze N.')).toBeTruthy()
    expect(
      screen.queryByRole('button', {
        name: /Open profile for Tobi A\., Ratio mastery/,
      })
    ).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'SS3 A' }))

    expect(screen.getByText('Aminat O.')).toBeTruthy()
    expect(screen.queryByText('Adaeze N.')).toBeNull()
  })

  it('does not add pilot live rows to a different class roster', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(input => {
        const url = String(input)
        if (url.startsWith('/api/learning/class/mastery')) {
          return Promise.resolve(
            jsonResponse({
              tenant_id: 'tenant-phase-2',
              class_id: 'class-jss2-a',
              diagnostic_id: 'diag-jss2',
              source: 'live',
              cells: [
                {
                  student_id: 'student-001',
                  skill_id: 'ratio-proportion',
                  skill_label: 'Ratio',
                  probability: 0.41,
                  uncertainty: 0.19,
                  status: 'needs_support',
                },
              ],
            })
          )
        }

        if (url.startsWith('/api/learning/approvals/pending')) {
          return Promise.resolve(jsonResponse({ plans: [], count: 0 }))
        }

        if (url.startsWith('/api/learning/audit')) {
          return Promise.resolve(jsonResponse({ events: [] }))
        }

        return Promise.reject(new Error(`Unexpected URL ${url}`))
      })

    render(<TeacherMasteryDashboard />)

    fireEvent.click(screen.getByRole('tab', { name: 'JSS1 A' }))

    expect(await screen.findByText('Adaeze N.')).toBeTruthy()
    expect(screen.queryByText('student-001')).toBeNull()
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map(call => String(call[0]))
      expect(urls).toContain(
        '/api/learning/class/mastery?class_id=class-jss1-a'
      )
      expect(urls).toContain(
        '/api/learning/approvals/pending?class_id=class-jss1-a'
      )
    })
  })

  it('shows a 1-2 week Pathfinder practice plan that the teacher approves', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(input => {
        const url = String(input)
        if (url.startsWith('/api/learning/class/mastery')) {
          return Promise.resolve(
            jsonResponse({
              tenant_id: 'tenant-phase-2',
              class_id: 'class-jss2-a',
              diagnostic_id: 'diag-jss2',
              source: 'live',
              cells: [],
            })
          )
        }

        if (url.startsWith('/api/learning/approvals/pending')) {
          return Promise.resolve(
            jsonResponse({
              count: 1,
              plans: [
                {
                  id: 'plan-jss2-ratio-recovery',
                  tenant_id: 'tenant-phase-2',
                  created_by_user_id: 'pathfinder-planner',
                  status: 'pending',
                  lang: 'en-NG',
                  provenance: [],
                  plan: {
                    plan_id: 'plan-jss2-ratio-recovery',
                    parent_plan_id: null,
                    target_skill_ids: [
                      'ratio-proportion',
                      'fraction-operations',
                    ],
                    target_student_ids: [
                      'student-001',
                      'student-014',
                      'student-022',
                    ],
                    item_types: [
                      'worked_example',
                      'short_answer',
                      'exit_ticket',
                    ],
                    suggested_resources: [
                      'ratio table mini-lesson',
                      'fraction bar check-in',
                      'teacher-led exit ticket',
                    ],
                    rationale:
                      'Pathfinder proposes a small-group recovery plan based on low ratio mastery and high uncertainty.',
                    requires_approval: true,
                    lang: 'en-NG',
                    provenance: [
                      {
                        source: 'planner-test',
                        rule_id: 'practice_plan_demo',
                        confidence: 0.92,
                        evidence_count: 3,
                      },
                    ],
                  },
                },
              ],
            })
          )
        }

        if (url.startsWith('/api/learning/student-facts')) {
          return Promise.resolve(jsonResponse({ facts: [], count: 0 }))
        }

        if (url.startsWith('/api/learning/audit')) {
          return Promise.resolve(jsonResponse({ events: [] }))
        }

        if (
          url === '/api/learning/approvals/plan-jss2-ratio-recovery/approve'
        ) {
          return Promise.resolve(
            jsonResponse({
              ok: true,
              plan_id: 'plan-jss2-ratio-recovery',
              action: 'approved',
            })
          )
        }

        return Promise.reject(new Error(`Unexpected URL ${url}`))
      })

    render(<TeacherMasteryDashboard />)

    expect(
      await screen.findByText(
        '1-2 week practice plan awaiting teacher approval'
      )
    ).toBeTruthy()
    expect(
      screen.getByText('Wulo Academy proposes; the teacher stays in charge.')
    ).toBeTruthy()
    expect(screen.getByTestId('practice-plan-proposal')).toBeTruthy()
    expect(screen.getByText('1-2 weeks')).toBeTruthy()
    expect(screen.getByText('3 learners')).toBeTruthy()
    expect(screen.getByText('Teacher approval required')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Review plan' }))
    expect(screen.getByTestId('phase2-plan-review')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          call =>
            String(call[0]) ===
            '/api/learning/approvals/plan-jss2-ratio-recovery/approve'
        )
      ).toBe(true)
    })
  })

  it('shows teacher-controlled memory facts that can be approved, edited, or rejected', async () => {
    const facts = [
      {
        id: 'fact-1',
        tenant_id: 'tenant-phase-2',
        class_id: 'class-jss2-a',
        student_id: 'student-001',
        created_by_user_id: 'pathfinder-detector',
        status: 'pending',
        lang: 'en-NG',
        provenance: [],
        fact: {
          fact_id: 'fact-1',
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
      {
        id: 'fact-2',
        tenant_id: 'tenant-phase-2',
        class_id: 'class-jss2-a',
        student_id: 'student-003',
        created_by_user_id: 'pathfinder-detector',
        status: 'pending',
        lang: 'en-NG',
        provenance: [],
        fact: {
          fact_id: 'fact-2',
          tenant_id: 'tenant-phase-2',
          class_id: 'class-jss2-a',
          student_id: 'student-003',
          student_name: 'Ibrahim S.',
          key: 'learning_modality',
          value: 'Fraction bar visuals improve accuracy',
          evidence: 'Three recent fraction attempts',
          requires_approval: true,
          lang: 'en-NG',
          provenance: [],
        },
      },
      {
        id: 'fact-3',
        tenant_id: 'tenant-phase-2',
        class_id: 'class-jss2-a',
        student_id: 'student-008',
        created_by_user_id: 'pathfinder-detector',
        status: 'pending',
        lang: 'en-NG',
        provenance: [],
        fact: {
          fact_id: 'fact-3',
          tenant_id: 'tenant-phase-2',
          class_id: 'class-jss2-a',
          student_id: 'student-008',
          student_name: 'Zainab H.',
          key: 'access_preference',
          value: 'Prefers short voice prompts for review tasks',
          evidence: 'Reading drill completion logs',
          requires_approval: true,
          lang: 'en-NG',
          provenance: [],
        },
      },
    ]
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(input => {
        const url = String(input)
        if (url.startsWith('/api/learning/class/mastery')) {
          return Promise.resolve(
            jsonResponse({
              tenant_id: 'tenant-phase-2',
              class_id: 'class-jss2-a',
              diagnostic_id: 'diag-jss2',
              source: 'live',
              cells: [],
            })
          )
        }

        if (url.startsWith('/api/learning/approvals/pending')) {
          return Promise.resolve(jsonResponse({ plans: [], count: 0 }))
        }

        if (url.startsWith('/api/learning/student-facts/pending')) {
          return Promise.resolve(jsonResponse({ facts, count: facts.length }))
        }

        if (url.startsWith('/api/learning/audit')) {
          return Promise.resolve(jsonResponse({ events: [] }))
        }

        if (url === '/api/learning/student-facts/fact-1/edit-approve') {
          return Promise.resolve(
            jsonResponse({
              ok: true,
              fact_id: 'fact-1',
              action: 'edited_approved',
            })
          )
        }

        if (url === '/api/learning/student-facts/fact-2/approve') {
          return Promise.resolve(
            jsonResponse({ ok: true, fact_id: 'fact-2', action: 'approved' })
          )
        }

        if (url === '/api/learning/student-facts/fact-3/reject') {
          return Promise.resolve(
            jsonResponse({ ok: true, fact_id: 'fact-3', action: 'rejected' })
          )
        }

        return Promise.reject(new Error(`Unexpected URL ${url}`))
      })

    render(<TeacherMasteryDashboard />)

    expect(await screen.findByText('Teacher-controlled memory')).toBeTruthy()
    expect(
      screen.getByText(/personalization does not happen invisibly/i)
    ).toBeTruthy()
    expect(
      screen.getByText(
        'Needs worked examples before independent ratio practice'
      )
    ).toBeTruthy()
    expect(
      screen.getByText('Fraction bar visuals improve accuracy')
    ).toBeTruthy()
    expect(
      screen.getByText('Prefers short voice prompts for review tasks')
    ).toBeTruthy()

    await waitFor(() => {
      const approveButtons = screen.getAllByRole('button', {
        name: 'Approve',
      }) as HTMLButtonElement[]
      expect(approveButtons[0].disabled).toBe(false)
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0])
    fireEvent.change(screen.getByLabelText('Edited memory fact for Tobi A.'), {
      target: {
        value: 'Needs two worked examples before independent ratio practice',
      },
    })
    fireEvent.change(screen.getByLabelText('Edited evidence for Tobi A.'), {
      target: { value: 'Teacher reviewed diagnostic pattern and exit ticket' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save edited fact' }))

    await waitFor(() => {
      const editCall = fetchMock.mock.calls.find(
        call =>
          String(call[0]) === '/api/learning/student-facts/fact-1/edit-approve'
      )
      expect(editCall).toBeTruthy()
      expect(
        String((editCall?.[1] as RequestInit | undefined)?.body)
      ).toContain('Needs two worked examples')
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'Approve' })[1])
    fireEvent.click(screen.getAllByRole('button', { name: 'Reject' })[2])

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          call =>
            String(call[0]) === '/api/learning/student-facts/fact-2/approve'
        )
      ).toBe(true)
      expect(
        fetchMock.mock.calls.some(
          call =>
            String(call[0]) === '/api/learning/student-facts/fact-3/reject'
        )
      ).toBe(true)
    })
  })
})
