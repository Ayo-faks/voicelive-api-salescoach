import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  BRIDGE_MAX_WORDS,
  ORIENT_SOFT_WORD_CAP,
  assertBridgeCopy,
  buildBeatInstructions,
  createBeatDispatcher,
  __testing,
} from './beatInstructions'

const BASE = {
  avatarName: 'Ollie',
  avatarPersona: 'a playful robot',
  scenarioName: 'TH Sound Sorting',
  scenarioDescription: 'sort pictures by their starting sound',
}

// --------------------------------------------------------------------------
// Helpers to toggle Vite's import.meta.env.DEV flag from inside tests.
// --------------------------------------------------------------------------

beforeEach(() => {
  __testing.setDevOverride(null)
})

afterEach(() => {
  __testing.setDevOverride(null)
  vi.restoreAllMocks()
})

function setDev(value: boolean): void {
  __testing.setDevOverride(value)
}

// --------------------------------------------------------------------------
// ORIENT
// --------------------------------------------------------------------------

describe('buildBeatInstructions — ORIENT', () => {
  it('preserves TH silent_sorting letter-name prohibition for child audience', () => {
    const out = buildBeatInstructions({
      ...BASE,
      beat: 'orient',
      audience: 'child',
      childName: 'Sam',
      exerciseType: 'silent_sorting',
      targetSound: 'th',
    })
    expect(out).toContain('sound button')
    expect(out).toContain('Never say the phrases "th sound" or "f sound"')
    expect(out).toContain('Do not spell the letters')
    expect(out).not.toContain('Hear TH')
    expect(out).not.toContain('Hear F')
    expect(out).not.toContain('TH_THIN_MODEL')
    expect(out).not.toContain('F_FIN_MODEL')
  })

  it('preserves TH silent_sorting letter-name prohibition for therapist audience', () => {
    const out = buildBeatInstructions({
      ...BASE,
      beat: 'orient',
      audience: 'therapist',
      childName: 'Sam',
      exerciseType: 'silent_sorting',
      targetSound: 'th',
    })
    expect(out).toContain('sound button')
    expect(out).toContain('Never say the phrases "th sound" or "f sound"')
  })

  it('includes the child name on the generic path', () => {
    const out = buildBeatInstructions({
      ...BASE,
      beat: 'orient',
      audience: 'child',
      childName: 'Sam',
      exerciseType: 'vowel_blending',
      targetSound: 'r',
    })
    expect(out).toContain('Sam')
  })

  it('respects ≤25-word soft cap on the generic path', () => {
    const out = buildBeatInstructions({
      ...BASE,
      beat: 'orient',
      audience: 'child',
      childName: 'Sam',
      exerciseType: 'vowel_blending',
      targetSound: 'r',
    })
    expect(__testing.wordCount(out)).toBeLessThanOrEqual(ORIENT_SOFT_WORD_CAP)
  })

  it('never uses "test" (EN-GB rule)', () => {
    const out = buildBeatInstructions({
      ...BASE,
      beat: 'orient',
      audience: 'child',
      childName: 'Sam',
      exerciseType: 'vowel_blending',
      targetSound: 'r',
    })
    expect(out.toLowerCase()).not.toMatch(/\btest\b/)
  })

  it('addresses the therapist when audience is therapist', () => {
    const out = buildBeatInstructions({
      ...BASE,
      beat: 'orient',
      audience: 'therapist',
      childName: 'Sam',
      exerciseType: 'vowel_blending',
      targetSound: 'r',
    })
    expect(out.toLowerCase()).toContain('therapist')
  })
})

// --------------------------------------------------------------------------
// BRIDGE
// --------------------------------------------------------------------------

describe('buildBeatInstructions — BRIDGE', () => {
  it('returns a ≤7-word imperative for silent_sorting', () => {
    const out = buildBeatInstructions({
      ...BASE,
      beat: 'bridge',
      childName: 'Sam',
      exerciseType: 'silent_sorting',
      targetSound: 'th',
    })
    expect(__testing.wordCount(out)).toBeLessThanOrEqual(BRIDGE_MAX_WORDS)
    expect(out).toBe('Now sort the pictures.')
  })

  it('throws in dev when bridge exceeds 7 words', () => {
    setDev(true)
    expect(() => assertBridgeCopy('One two three four five six seven eight')).toThrow(
      /exceeds 7 words/,
    )
  })

  it('truncates and warns in prod when bridge exceeds 7 words', () => {
    setDev(false)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = assertBridgeCopy('One two three four five six seven eight nine')
    expect(__testing.wordCount(result)).toBeLessThanOrEqual(BRIDGE_MAX_WORDS)
    expect(warn).toHaveBeenCalled()
  })

  it('contains no scoring vocabulary', () => {
    const out = buildBeatInstructions({
      ...BASE,
      beat: 'bridge',
      childName: 'Sam',
      exerciseType: 'silent_sorting',
      targetSound: 'th',
    }).toLowerCase()
    for (const term of __testing.SCORING_VOCAB) {
      expect(out).not.toContain(term)
    }
  })
})

// --------------------------------------------------------------------------
// REINFORCE
// --------------------------------------------------------------------------

describe('buildBeatInstructions — REINFORCE', () => {
  it('includes praise and an "another go?" prompt by default', () => {
    const out = buildBeatInstructions({
      ...BASE,
      beat: 'reinforce',
      audience: 'child',
      childName: 'Sam',
      exerciseType: 'silent_sorting',
      targetSound: 'th',
    })
    expect(out.toLowerCase()).toMatch(/great|good|well done/)
    expect(out).toContain('another go?')
    expect(out).toContain('Sam')
  })

  it('never uses corrective vocabulary', () => {
    const out = buildBeatInstructions({
      ...BASE,
      beat: 'reinforce',
      audience: 'child',
      childName: 'Sam',
      exerciseType: 'silent_sorting',
      targetSound: 'th',
    }).toLowerCase()
    for (const term of __testing.CORRECTIVE_VOCAB) {
      expect(out).not.toContain(term)
    }
  })

  it('incorporates outcomeSummary when provided', () => {
    const out = buildBeatInstructions({
      ...BASE,
      beat: 'reinforce',
      audience: 'child',
      childName: 'Sam',
      exerciseType: 'silent_sorting',
      targetSound: 'th',
      outcomeSummary: 'You sorted four pictures.',
    })
    expect(out).toContain('You sorted four pictures.')
  })

  it('omits the "another go?" prompt when offerAnotherGo is false', () => {
    const out = buildBeatInstructions({
      ...BASE,
      beat: 'reinforce',
      audience: 'child',
      childName: 'Sam',
      exerciseType: 'silent_sorting',
      targetSound: 'th',
      offerAnotherGo: false,
    })
    expect(out).not.toContain('another go?')
  })
})

// --------------------------------------------------------------------------
// Dispatcher
// --------------------------------------------------------------------------

describe('createBeatDispatcher — queue + flush', () => {
  function makeHarness(initialReady = false) {
    const sent: Array<
      | { type: 'response.cancel' }
      | {
          type: 'response.create'
          response: { modalities: ['audio', 'text']; instructions: string }
        }
    > = []
    let ready = initialReady
    let fakeNow = 0
    const logs: Array<{ event: string; detail?: unknown }> = []
    const dispatcher = createBeatDispatcher({
      send: env => {
        sent.push(env)
      },
      isReady: () => ready,
      now: () => fakeNow,
      logger: (event, detail) => {
        logs.push({ event, detail })
      },
    })
    return {
      sent,
      logs,
      dispatcher,
      setReady: (v: boolean) => {
        ready = v
      },
      advanceTime: (ms: number) => {
        fakeNow += ms
      },
    }
  }

  it('queues beats when not ready and sends nothing', () => {
    const h = makeHarness(false)
    h.dispatcher.send('orient-1')
    h.dispatcher.send('bridge-1')
    expect(h.sent).toEqual([])
    expect(h.dispatcher.pendingCount()).toBe(2)
  })

  it('flushes queued beats FIFO on readiness', () => {
    const h = makeHarness(false)
    h.dispatcher.send('orient-1')
    h.dispatcher.send('bridge-1')
    h.setReady(true)
    h.dispatcher.flushIfReady()
    const creates = h.sent.filter(e => e.type === 'response.create') as Array<{
      type: 'response.create'
      response: { instructions: string }
    }>
    expect(creates.map(c => c.response.instructions)).toEqual(['orient-1', 'bridge-1'])
    expect(h.dispatcher.pendingCount()).toBe(0)
  })

  it('single flush on readiness — calling flushIfReady twice does not re-send', () => {
    const h = makeHarness(false)
    h.dispatcher.send('orient-1')
    h.setReady(true)
    h.dispatcher.flushIfReady()
    const firstCount = h.sent.length
    h.dispatcher.flushIfReady()
    expect(h.sent.length).toBe(firstCount)
  })

  it('issues response.cancel before response.create when a new beat preempts a previous one', () => {
    const h = makeHarness(true)
    h.dispatcher.send('orient-1')
    h.dispatcher.send('bridge-1')
    // First beat: create only (no prior beat to cancel).
    // Second beat: cancel then create.
    expect(h.sent[0]).toEqual({
      type: 'response.create',
      response: { modalities: ['audio', 'text'], instructions: 'orient-1' },
    })
    expect(h.sent[1]).toEqual({ type: 'response.cancel' })
    expect(h.sent[2]).toEqual({
      type: 'response.create',
      response: { modalities: ['audio', 'text'], instructions: 'bridge-1' },
    })
  })

  it('does not emit response.cancel before the very first beat', () => {
    const h = makeHarness(true)
    h.dispatcher.send('orient-1')
    expect(h.sent[0]?.type).toBe('response.create')
  })

  it('retries once on transient send error', () => {
    let fail = true
    const sent: Array<unknown> = []
    const logs: Array<{ event: string }> = []
    const dispatcher = createBeatDispatcher({
      send: env => {
        if (env.type === 'response.create' && fail) {
          fail = false
          throw new Error('transient')
        }
        sent.push(env)
      },
      isReady: () => true,
      logger: event => logs.push({ event }),
    })
    dispatcher.send('orient-1')
    // After the throw on the first attempt we retry once and succeed.
    expect(sent.some(e => (e as { type: string }).type === 'response.create')).toBe(true)
    expect(logs.some(l => l.event === 'beat.retry')).toBe(true)
  })

  it('drops silently and logs telemetry after persistent failure', () => {
    const h = (() => {
      const sent: Array<unknown> = []
      const logs: Array<{ event: string }> = []
      let fakeNow = 0
      const dispatcher = createBeatDispatcher({
        send: env => {
          if (env.type === 'response.create') {
            // Advance clock past dropAfterMs between attempts.
            fakeNow += 4000
            throw new Error('persistent')
          }
          sent.push(env)
        },
        isReady: () => true,
        now: () => fakeNow,
        dropAfterMs: 3000,
        logger: event => logs.push({ event }),
      })
      return { sent, logs, dispatcher }
    })()

    h.dispatcher.send('orient-1')
    expect(h.logs.some(l => l.event === 'beat.retry')).toBe(true)
    expect(h.logs.some(l => l.event === 'beat.dropped')).toBe(true)
    // No response.create ever successfully landed.
    expect(h.sent.filter(e => (e as { type: string }).type === 'response.create')).toEqual([])
  })
})
