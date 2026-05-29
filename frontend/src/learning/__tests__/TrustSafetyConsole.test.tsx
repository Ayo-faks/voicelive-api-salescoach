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
    expect(
      screen.getByText('One-page parent summaries can be sent home')
    ).toBeTruthy()
    expect(
      screen.getByText(
        /whether approved interventions are changing outcomes after 6-8 weeks/i
      )
    ).toBeTruthy()

    await waitFor(() => {
      expect(screen.getByTestId('pilot-kpi-error')).toBeTruthy()
    })
  })

  it('shows safe defaults (voice unavailable, export blocked) when /api/config fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(input => {
      const url = String(input)
      if (url === '/api/learning/kpis') {
        return Promise.reject(new Error('offline'))
      }
      if (url === '/api/config') {
        return Promise.reject(new Error('offline'))
      }
      return Promise.reject(new Error(`Unexpected URL ${url}`))
    })

    render(<TrustSafetyConsole />)

    await waitFor(() => {
      expect(screen.getByTestId('admin-safety-status')).toBeTruthy()
    })
    expect(screen.getByTestId('admin-safety-voice').textContent).toMatch(
      /temporarily unavailable/i
    )
    expect(screen.getByTestId('admin-safety-export').textContent).toMatch(
      /blocked while safety review is open/i
    )
    expect(screen.getByTestId('admin-safety-error').textContent).toMatch(
      /Safety status unavailable/i
    )
    const exportBtn = screen.getByTestId(
      'admin-export-report'
    ) as HTMLButtonElement
    expect(exportBtn.disabled).toBe(true)
    expect(exportBtn.textContent).toMatch(/Export blocked/i)
  })

  it('renders the available state when /api/config reports voice enabled and content review off', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(input => {
      const url = String(input)
      if (url === '/api/learning/kpis') {
        return Promise.reject(new Error('offline'))
      }
      if (url === '/api/config') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: 'ok',
              proxy_enabled: true,
              ws_endpoint: '/ws',
              storage_ready: true,
              telemetry_enabled: false,
              image_base_path: '/img',
              safety: {
                learner_voice_disabled: false,
                session_turn_cap: null,
                session_token_cap: null,
                production_content_review_required: false,
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        )
      }
      return Promise.reject(new Error(`Unexpected URL ${url}`))
    })

    render(<TrustSafetyConsole />)

    await waitFor(() => {
      expect(screen.getByTestId('admin-safety-voice').textContent).toMatch(
        /Learner voice: available/i
      )
    })
    expect(screen.getByTestId('admin-safety-export').textContent).toMatch(
      /Report export: enabled/i
    )
    expect(
      screen.queryByTestId('admin-safety-error')
    ).toBeNull()
    const exportBtn = screen.getByTestId(
      'admin-export-report'
    ) as HTMLButtonElement
    expect(exportBtn.disabled).toBe(false)
    expect(exportBtn.textContent).toMatch(/Export report/i)
  })
})
