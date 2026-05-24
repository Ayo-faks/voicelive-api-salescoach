import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OverrideMasteryDialog } from '../OverrideMasteryDialog'
import type { StudentProfileSkill } from '../api'

const skill: StudentProfileSkill = {
  skill_id: 'ratio-proportion',
  skill_label: 'Ratio and proportion',
  probability: 0.42,
  uncertainty: 0.18,
  kind: 'model',
  status: 'developing',
}

function renderDialog(nextSkill = skill) {
  return render(
    <OverrideMasteryDialog
      open
      studentId="student-1"
      skill={nextSkill}
      onClose={vi.fn()}
      onSubmit={vi.fn().mockResolvedValue(undefined)}
    />
  )
}

describe('OverrideMasteryDialog', () => {
  it('shows frozen current estimates and adjusted values for mastery edits', () => {
    renderDialog()

    expect(screen.getByText('Current estimate: 42% (unchanged)')).toBeTruthy()
    expect(screen.getByText('Current uncertainty: 18% (unchanged)')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Probability'), {
      target: { value: '0.65' },
    })
    fireEvent.change(screen.getByLabelText('Uncertainty'), {
      target: { value: '0.11' },
    })

    expect(screen.getByText('Current estimate: 42% → adjusted value: 65%')).toBeTruthy()
    expect(screen.getByText('Current uncertainty: 18% → adjusted value: 11%')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Probability'), {
      target: { value: '0.42' },
    })

    expect(screen.getByText('Current estimate: 42% (unchanged)')).toBeTruthy()
    expect(screen.queryByText('Current estimate: 42% → adjusted value: 42%')).toBeNull()
  })

  it('does not move the current estimate when the open dialog receives refreshed skill data', () => {
    const { rerender } = renderDialog()

    rerender(
      <OverrideMasteryDialog
        open
        studentId="student-1"
        skill={{ ...skill, probability: 0.9, uncertainty: 0.44 }}
        onClose={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
      />
    )

    expect(screen.getByText('Current estimate: 42% (unchanged)')).toBeTruthy()
    expect(screen.getByText('Current uncertainty: 18% (unchanged)')).toBeTruthy()
  })
})