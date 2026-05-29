import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SafeguardingEventsPanel from '../components/SafeguardingEventsPanel'
import type { SafeguardingEvent } from '../../services/api'

afterEach(() => {
  vi.restoreAllMocks()
})

function makeEvent(overrides: Partial<SafeguardingEvent> = {}): SafeguardingEvent {
  return {
    id: 'evt-1',
    user_id: 'user-1',
    child_id: 'child-1',
    parent_user_id: 'parent-1',
    session_id: 'sess-1',
    direction: 'inbound',
    severity: 'critical',
    categories: ['self_harm'],
    evidence_quote: 'i want to hurt myself',
    rationale: 'lexicon match: self_harm pattern',
    layer_scores: { lexicon: { severity: 'critical' } },
    context_window: [
      { role: 'child', text: 'i feel really alone' },
      { role: 'assistant', text: 'i hear you. tell me more.' },
    ],
    created_at: '2026-05-29T10:00:00Z',
    acknowledged_at: null,
    acknowledged_by: null,
    action_taken: null,
    action_notes: null,
    ...overrides,
  }
}

describe('SafeguardingEventsPanel', () => {
  it('lists open events and shows severity and counts', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(input => {
      const url = String(input)
      if (url.startsWith('/api/admin/safeguarding/events?')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              events: [
                makeEvent({ id: 'evt-1', severity: 'critical' }),
                makeEvent({ id: 'evt-2', severity: 'high' }),
                makeEvent({ id: 'evt-3', severity: 'medium' }),
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        )
      }
      return Promise.reject(new Error(`Unexpected URL ${url}`))
    })

    render(<SafeguardingEventsPanel />)

    await waitFor(() => {
      expect(screen.getByTestId('safeguarding-row-evt-1')).toBeTruthy()
    })
    expect(screen.getByTestId('safeguarding-row-evt-2')).toBeTruthy()
    expect(screen.getByTestId('safeguarding-row-evt-3')).toBeTruthy()
    expect(screen.getByTestId('safeguarding-counts').textContent).toMatch(
      /1 critical/
    )
    expect(screen.getByTestId('safeguarding-counts').textContent).toMatch(
      /1 high/
    )
  })

  it('shows empty state when there are no events', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ events: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    )

    render(<SafeguardingEventsPanel />)

    await waitFor(() => {
      expect(screen.getByTestId('safeguarding-empty')).toBeTruthy()
    })
  })

  it('acknowledges an event with action_taken and refreshes the list', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    let listCallCount = 0

    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.startsWith('/api/admin/safeguarding/events?')) {
        listCallCount += 1
        const events =
          listCallCount === 1
            ? [makeEvent({ id: 'evt-1', severity: 'critical' })]
            : []
        return Promise.resolve(
          new Response(JSON.stringify({ events }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        )
      }
      if (
        url === '/api/admin/safeguarding/events/evt-1/acknowledge' &&
        init?.method === 'POST'
      ) {
        return Promise.resolve(
          new Response(
            JSON.stringify(
              makeEvent({
                id: 'evt-1',
                acknowledged_at: '2026-05-29T10:05:00Z',
                acknowledged_by: 'admin@wulo.test',
                action_taken: 'called DSL',
              })
            ),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        )
      }
      return Promise.reject(new Error(`Unexpected URL ${url}`))
    })

    render(<SafeguardingEventsPanel />)

    const row = await screen.findByTestId('safeguarding-row-evt-1')
    // Expand the row by clicking the clickable header div (first child).
    fireEvent.click(row.firstChild as Element)

    const actionInput = await screen.findByTestId('safeguarding-action-taken')
    fireEvent.change(actionInput, { target: { value: 'called DSL' } })

    const submit = screen.getByTestId('safeguarding-ack-submit')
    fireEvent.click(submit)

    await waitFor(() => {
      expect(screen.getByTestId('safeguarding-empty')).toBeTruthy()
    })

    const ackCall = calls.find(
      c => c.url === '/api/admin/safeguarding/events/evt-1/acknowledge'
    )
    expect(ackCall).toBeTruthy()
    expect(ackCall?.init?.method).toBe('POST')
    expect(JSON.parse(String(ackCall?.init?.body))).toEqual({
      action_taken: 'called DSL',
    })
  })

  it('shows a load error banner when the API rejects', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: 'forbidden' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    )

    render(<SafeguardingEventsPanel />)

    await waitFor(() => {
      expect(screen.getByTestId('safeguarding-load-error')).toBeTruthy()
    })
  })
})
