import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TrustSafetyConsole from '../routes/TrustSafetyConsole'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('TrustSafetyConsole', () => {
  it('renders an admin school-leader snapshot with outcome and buying-logic signals', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(input => {
      const url = String(input)
      if (url === '/api/learning/kpis') {
        return Promise.reject(new Error('offline'))
      }
      return Promise.reject(new Error(`Unexpected URL ${url}`))
    })

    render(<TrustSafetyConsole />)

    expect(screen.getByTestId('school-leader-view')).toBeTruthy()
    expect(screen.getByText('Admin / School Leader View')).toBeTruthy()
    expect(screen.getByText('Cohort progress')).toBeTruthy()
    expect(screen.getByText('64% on track')).toBeTruthy()
    expect(screen.getByText(/58 students in JSS2 A/i)).toBeTruthy()
    expect(screen.getByText('Students at risk')).toBeTruthy()
    expect(screen.getByText('7 flagged')).toBeTruthy()
    expect(screen.getByText('Most common skill gaps')).toBeTruthy()
    expect(screen.getByText('Ratio, fractions')).toBeTruthy()
    expect(screen.getByText('Practice completion')).toBeTruthy()
    expect(screen.getByText('76%')).toBeTruthy()
    expect(screen.getByText('Cost per student')).toBeTruthy()
    expect(screen.getByText('NGN 1,450/wk')).toBeTruthy()
    expect(screen.getByText('Teacher approvals pending')).toBeTruthy()
    expect(screen.getByText('4 pending')).toBeTruthy()
    expect(screen.getByText('Intervention impact')).toBeTruthy()
    expect(screen.getByText('+18 pts')).toBeTruthy()
    expect(screen.getByText('Family output')).toBeTruthy()
    expect(screen.getByText('One-page parent summaries can be sent home')).toBeTruthy()
    expect(screen.getByText(/whether approved interventions are changing outcomes after 6-8 weeks/i)).toBeTruthy()

    await waitFor(() => {
      expect(screen.getByTestId('pilot-kpi-error')).toBeTruthy()
    })
  })
})