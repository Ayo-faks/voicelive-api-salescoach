import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import StudentMasteryProfile from '../routes/StudentMasteryProfile'

describe('StudentMasteryProfile', () => {
  it('renders a one-page parent-ready summary that can be sent home', () => {
    render(<StudentMasteryProfile />)

    expect(screen.getByTestId('parent-ready-summary')).toBeTruthy()
    expect(screen.getByText('One-page parent-ready summary')).toBeTruthy()
    expect(screen.getByText('Ready to send home')).toBeTruthy()
    expect(screen.getByText('What we noticed')).toBeTruthy()
    expect(screen.getByText('What Pathfinder did')).toBeTruthy()
    expect(screen.getByText('What to do at home')).toBeTruthy()
    expect(screen.getByText('Next school action')).toBeTruthy()
    expect(
      screen.getByText(/Ran a short diagnostic and adapted the next item/i)
    ).toBeTruthy()
    expect(
      screen.getByText(
        /Personalisation facts only apply after teacher approval/i
      )
    ).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Send home summary' }))
  })
})
