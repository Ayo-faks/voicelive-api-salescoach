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
  it('shows the roster for the selected class', () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise<Response>(() => {})
    )

    render(<TeacherMasteryDashboard />)

    expect(screen.getByText('Tobi A.')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'JSS1 A' }))

    expect(screen.getByText('Adaeze N.')).toBeTruthy()
    expect(screen.queryByText('Tobi A.')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'SS3 A' }))

    expect(screen.getByText('Aminat O.')).toBeTruthy()
    expect(screen.queryByText('Adaeze N.')).toBeNull()
  })

  it('does not add pilot live rows to a different class roster', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(input => {
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
      expect(urls).toContain('/api/learning/class/mastery?class_id=class-jss1-a')
      expect(urls).toContain('/api/learning/approvals/pending?class_id=class-jss1-a')
    })
  })
})