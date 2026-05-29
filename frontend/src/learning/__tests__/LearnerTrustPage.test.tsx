import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import LearnerTrustPage from '../routes/LearnerTrustPage'

function renderPage() {
  return render(
    <MemoryRouter>
      <LearnerTrustPage />
    </MemoryRouter>
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

function mockConfig(voiceDisabled: boolean) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(input => {
    const url = String(input)
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
              learner_voice_disabled: voiceDisabled,
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
}

describe('LearnerTrustPage', () => {
  it('shows the unavailable copy when the kill switch is on', async () => {
    mockConfig(true)
    const { unmount } = renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('learner-trust-voice-status').textContent).toMatch(
        /temporarily unavailable/i
      )
    })
    unmount()
  })

  it('shows the available copy when voice is enabled', async () => {
    mockConfig(false)
    const { unmount } = renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('learner-trust-voice-status').textContent).toMatch(
        /Voice practice is available/i
      )
    })
    unmount()
  })

  it('fails closed when /api/config rejects', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(input => {
      const url = String(input)
      if (url === '/api/config') {
        return Promise.reject(new Error('offline'))
      }
      return Promise.reject(new Error(`Unexpected URL ${url}`))
    })
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('learner-trust-voice-status').textContent).toMatch(
        /temporarily unavailable/i
      )
    })
  })
})
