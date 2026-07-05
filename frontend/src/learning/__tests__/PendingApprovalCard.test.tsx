import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  PendingApprovalCard,
  type PendingApprovalPlanView,
} from '../components/PathfinderPhase2'

function planView(planId: string): PendingApprovalPlanView {
  return {
    planId,
    targetSkillIds: ['ratio-proportion'],
    targetStudentIds: ['student-001'],
    itemTypes: ['reteach'],
    suggestedResources: ['worked-examples'],
    rationale: 'Ratio reteach for students below 60% mastery',
    requiresApproval: true,
    lang: 'en-NG',
    provenance: [],
  }
}

describe('PendingApprovalCard', () => {
  it('keeps the review panel open when the same plan is re-fetched by polling', () => {
    const { rerender } = render(<PendingApprovalCard plan={planView('plan-1')} />)

    fireEvent.click(screen.getByRole('button', { name: 'Review plan' }))
    expect(screen.getByTestId('phase2-plan-review')).toBeTruthy()

    // Dashboard polling rebuilds the plan view object every cycle; a new
    // object with the same planId must not collapse the open review panel.
    rerender(<PendingApprovalCard plan={planView('plan-1')} />)

    expect(screen.getByTestId('phase2-plan-review')).toBeTruthy()
  })

  it('resets the review panel when a different plan arrives', () => {
    const { rerender } = render(<PendingApprovalCard plan={planView('plan-1')} />)

    fireEvent.click(screen.getByRole('button', { name: 'Review plan' }))
    expect(screen.getByTestId('phase2-plan-review')).toBeTruthy()

    rerender(<PendingApprovalCard plan={planView('plan-2')} />)

    expect(screen.queryByTestId('phase2-plan-review')).toBeNull()
  })
})
