import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { logEvent, readEvents } from './telemetry'

const originalFetch = globalThis.fetch

describe('telemetry.logEvent', () => {
  beforeEach(() => {
    window.localStorage.clear()
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 202 }))
  })
  afterEach(() => {
    window.localStorage.clear()
    globalThis.fetch = originalFetch
  })

  it('appends events to localStorage with name, props, ts', () => {
    logEvent('parent_summary_shared', { channel: 'copy' })
    const events = readEvents()
    expect(events).toHaveLength(1)
    expect(events[0].name).toBe('parent_summary_shared')
    expect(events[0].props).toEqual({ channel: 'copy' })
    expect(typeof events[0].ts).toBe('string')
    expect(Number.isNaN(Date.parse(events[0].ts))).toBe(false)
  })

  it('caps the rolling log at 200 entries (drops oldest)', () => {
    for (let i = 0; i < 205; i++) logEvent('e', { i })
    const events = readEvents()
    expect(events).toHaveLength(200)
    expect(events[0].props).toEqual({ i: 5 })
    expect(events[events.length - 1].props).toEqual({ i: 204 })
  })

  it('survives corrupted storage by resetting', () => {
    window.localStorage.setItem('pathfinder-events', 'not-json')
    logEvent('e')
    const events = readEvents()
    expect(events).toHaveLength(1)
  })

  it('POSTs the event to /api/events with same-origin credentials', () => {
    logEvent('parent_summary_shared', { channel: 'copy' })
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/events')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('same-origin')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(init.keepalive).toBe(true)
    const body = JSON.parse(init.body as string)
    expect(body.name).toBe('parent_summary_shared')
    expect(body.props).toEqual({ channel: 'copy' })
    expect(typeof body.ts).toBe('string')
  })

  it('swallows fetch failures so UI never sees a rejection', () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down')) as typeof fetch
    expect(() => logEvent('trust_badge_clicked')).not.toThrow()
    // The event is still persisted to localStorage even if the POST fails.
    expect(readEvents()).toHaveLength(1)
  })
})
