// v1: localStorage-only event log. Backend ingestion (`POST /api/events`) is a follow-up.
const STORAGE_KEY = 'pathfinder-events'
const MAX_EVENTS = 200

export type TelemetryEvent = {
  name: string
  props?: Record<string, unknown>
  ts: string
}

export function logEvent(name: string, props?: Record<string, unknown>): void {
  if (typeof window === 'undefined') return
  const event: TelemetryEvent = {
    name,
    props,
    ts: new Date().toISOString(),
  }
  try {
    const events = safeRead()
    events.push(event)
    const trimmed = events.slice(-MAX_EVENTS)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed))
  } catch {
    // Telemetry is best-effort; never throw into the UI.
  }
  // Fire-and-forget POST to backend. Failures are silent — the localStorage
  // log above doubles as an offline buffer.
  try {
    void fetch('/api/events', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
      keepalive: true,
    }).catch(() => {})
  } catch {
    // ignore
  }
}

function safeRead(): TelemetryEvent[] {
  if (typeof window === 'undefined') return []
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as TelemetryEvent[]) : []
  } catch {
    return []
  }
}

export function readEvents(): TelemetryEvent[] {
  return safeRead()
}
