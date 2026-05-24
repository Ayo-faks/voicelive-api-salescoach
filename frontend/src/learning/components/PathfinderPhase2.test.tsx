import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  PathfinderPhase2Demo,
  type HeatmapCellView,
  type PendingApprovalPlanView,
} from './PathfinderPhase2'

const provenance = [
  {
    source: 'pathfinder_phase_2_fixture',
    ruleId: 'contract_phase_2_item_bank',
    confidence: 1,
    evidenceCount: 50,
  },
]

const cells: HeatmapCellView[] = [
  {
    studentId: 'student-ade',
    skillId: 'ratio-proportion',
    skillLabel: 'Ratio and proportion',
    probability: 0.82,
    uncertainty: 0.22,
    status: 'secure',
    lang: 'en-NG',
    provenance,
  },
  {
    studentId: 'student-ade',
    skillId: 'fraction-operations',
    skillLabel: 'Fraction operations',
    probability: 0.63,
    uncertainty: 0.36,
    status: 'developing',
    lang: 'en-NG',
    provenance,
  },
  {
    studentId: 'student-ade',
    skillId: 'linear-equations',
    skillLabel: 'Linear equations',
    probability: 0.46,
    uncertainty: 0.42,
    status: 'needs_support',
    lang: 'en-NG',
    provenance,
  },
  {
    studentId: 'student-ade',
    skillId: 'plane-geometry',
    skillLabel: 'Plane geometry',
    probability: 0.78,
    uncertainty: 0.26,
    status: 'secure',
    lang: 'en-NG',
    provenance,
  },
]

const pendingPlan: PendingApprovalPlanView = {
  planId: 'intervention-plan-phase-2',
  targetSkillIds: [
    'ratio-proportion',
    'fraction-operations',
    'linear-equations',
    'plane-geometry',
  ],
  targetStudentIds: ['student-ade'],
  itemTypes: ['reteach', 'guided_practice'],
  suggestedResources: ['ratio-mini-lesson'],
  rationale: 'Synthetic intervention generated without a cloud call.',
  requiresApproval: true,
  lang: 'en-NG',
  provenance,
}

describe('PathfinderPhase2Demo', () => {
  it('renders the mastery heatmap and pending approval with provenance', () => {
    render(<PathfinderPhase2Demo cells={cells} pendingPlan={pendingPlan} />)

    const pendingApprovalCard = screen.getByTestId(
      'phase2-pending-approval-card'
    )
    expect(screen.getByTestId('phase2-teacher-workspace')).toBeTruthy()
    expect(screen.getByTestId('phase2-teacher-heatmap')).toBeTruthy()
    expect(pendingApprovalCard.textContent).toContain(
      'Pending teacher approval'
    )
    expect(pendingApprovalCard.textContent).toContain('Synthetic intervention')
    expect(screen.getAllByText('Secure')).toHaveLength(2)
    expect(screen.getByText('Developing')).toBeTruthy()
    expect(screen.getByText('Needs support')).toBeTruthy()

    const provenanceFooter = screen.getByTestId('phase2-provenance-footer')
    expect(provenanceFooter.getAttribute('data-provenance-count')).toBe('1')
    expect(provenanceFooter.textContent).toContain('Review signal 1 · 50 evidence points')
  })

  it('submits text-path teacher intent without applying a plan', () => {
    const onSubmitIntent = vi.fn()
    render(
      <PathfinderPhase2Demo
        cells={cells}
        pendingPlan={pendingPlan}
        onSubmitIntent={onSubmitIntent}
      />
    )

    fireEvent.change(screen.getByLabelText('Text request'), {
      target: { value: 'Group learners who need fraction support' },
    })
    fireEvent.click(screen.getByLabelText('Send request'))

    expect(onSubmitIntent).toHaveBeenCalledWith(
      'Group learners who need fraction support'
    )
  })

  it('requires plan review before teacher approval actions', () => {
    const onApprove = vi.fn()
    const onReject = vi.fn()
    const onEditApprove = vi.fn()
    render(
      <PathfinderPhase2Demo
        cells={cells}
        pendingPlan={pendingPlan}
        onApprove={onApprove}
        onReject={onReject}
        onEditApprove={onEditApprove}
      />
    )

    const card = screen.getByTestId('phase2-pending-approval-card')
    expect(within(card).queryByRole('button', { name: /approve/i })).toBeNull()
    expect(within(card).queryByRole('button', { name: /reject/i })).toBeNull()
    expect(within(card).queryByRole('button', { name: /edit plan/i })).toBeNull()

    fireEvent.click(within(card).getByRole('button', { name: /review plan/i }))
    expect(screen.getByTestId('phase2-plan-review').textContent).toContain('Read plan before decision')
    expect(within(card).getByRole('button', { name: /edit plan/i })).toBeTruthy()

    fireEvent.click(within(card).getByRole('button', { name: /approve/i }))
    fireEvent.click(within(card).getByRole('button', { name: /reject/i }))

    expect(onApprove).toHaveBeenCalledWith('intervention-plan-phase-2')
    expect(onReject).toHaveBeenCalledWith('intervention-plan-phase-2')
  })

  it('submits inline plan edits through edited approval', async () => {
    const onEditApprove = vi.fn()
    render(
      <PathfinderPhase2Demo
        cells={cells}
        pendingPlan={pendingPlan}
        onEditApprove={onEditApprove}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /review plan/i }))
    fireEvent.click(screen.getByRole('button', { name: /edit plan/i }))
    fireEvent.change(screen.getByLabelText('Edited rationale'), {
      target: { value: 'Retain fractions and add small-group ratio practice.' },
    })
    fireEvent.change(screen.getByLabelText('Edited resources'), {
      target: { value: 'ratio-mini-lesson, fraction-exit-ticket' },
    })
    fireEvent.change(screen.getByLabelText('Edit approval reason'), {
      target: { value: 'Adjusted for today\'s group' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: /save edits and approve/i })
    )

    await waitFor(() => {
      expect(onEditApprove).toHaveBeenCalledWith(
        'intervention-plan-phase-2',
        {
          targetSkillIds: [
            'ratio-proportion',
            'fraction-operations',
            'linear-equations',
            'plane-geometry',
          ],
          targetStudentIds: ['student-ade'],
          itemTypes: ['reteach', 'guided_practice'],
          suggestedResources: ['ratio-mini-lesson', 'fraction-exit-ticket'],
          rationale: 'Retain fractions and add small-group ratio practice.',
        },
        "Adjusted for today's group"
      )
    })
  })
})
