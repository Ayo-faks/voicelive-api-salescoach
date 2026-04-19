/*---------------------------------------------------------------------------------------------
 *  useExercisePhase reducer tests (Session A commit A2).
 *  Pure reducer coverage for plan §B.3 events + variant branches (§D.2 items 5, 6, 12, 13).
 *--------------------------------------------------------------------------------------------*/

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  INITIAL_PHASE_STATE,
  exercisePhaseReducer,
} from './useExercisePhase'
import type { PhaseState } from './types'

function stateAt(overrides: Partial<PhaseState> = {}): PhaseState {
  return { ...INITIAL_PHASE_STATE, ...overrides }
}

describe('exercisePhaseReducer — linear happy path', () => {
  it('START yields orient (idempotent from initial)', () => {
    const s = exercisePhaseReducer(INITIAL_PHASE_STATE, { type: 'START' })
    expect(s.phase).toBe('orient')
  })

  it('ORIENT_DONE advances orient → expose', () => {
    const s = exercisePhaseReducer(stateAt({ phase: 'orient' }), { type: 'ORIENT_DONE' })
    expect(s.phase).toBe('expose')
  })

  it('ORIENT_DONE is a no-op outside orient', () => {
    const s = exercisePhaseReducer(stateAt({ phase: 'bridge' }), { type: 'ORIENT_DONE' })
    expect(s.phase).toBe('bridge')
  })

  it('BRIDGE_DONE advances bridge → perform and stamps performStartedAt', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-04-19T10:00:00Z'))
    try {
      const s = exercisePhaseReducer(stateAt({ phase: 'bridge' }), { type: 'BRIDGE_DONE' })
      expect(s.phase).toBe('perform')
      expect(s.performStartedAt).toBe(new Date('2026-04-19T10:00:00Z').getTime())
    } finally {
      vi.useRealTimers()
    }
  })

  it('BRIDGE_DONE is a no-op outside bridge', () => {
    const s = exercisePhaseReducer(stateAt({ phase: 'perform' }), { type: 'BRIDGE_DONE' })
    expect(s.phase).toBe('perform')
    expect(s.performStartedAt).toBeNull()
  })

  it('PERFORM_DONE advances perform → reinforce', () => {
    const s = exercisePhaseReducer(stateAt({ phase: 'perform' }), { type: 'PERFORM_DONE' })
    expect(s.phase).toBe('reinforce')
  })

  it('PERFORM_DONE is a no-op outside perform', () => {
    const s = exercisePhaseReducer(stateAt({ phase: 'expose' }), { type: 'PERFORM_DONE' })
    expect(s.phase).toBe('expose')
  })
})

describe('exercisePhaseReducer — EXPOSE_INTERACT', () => {
  it('sets exposeTouched=true on first interaction', () => {
    const s = exercisePhaseReducer(stateAt({ phase: 'expose' }), { type: 'EXPOSE_INTERACT' })
    expect(s.exposeTouched).toBe(true)
  })

  it('is idempotent after first interaction (same reference not required, state equal)', () => {
    const once = exercisePhaseReducer(stateAt({ phase: 'expose' }), { type: 'EXPOSE_INTERACT' })
    const twice = exercisePhaseReducer(once, { type: 'EXPOSE_INTERACT' })
    expect(twice).toBe(once) // reducer short-circuits to preserve reference
  })
})

describe('exercisePhaseReducer — ADVANCE gate (plan §D.2 items 5 & 6)', () => {
  it('blocks advance from expose when canAdvance is false and exposeTouched is false', () => {
    const s = exercisePhaseReducer(
      stateAt({ phase: 'expose', exposeTouched: false }),
      { type: 'ADVANCE', canAdvance: false }
    )
    expect(s.phase).toBe('expose')
  })

  it('blocks advance from expose when canAdvance is omitted and exposeTouched is false', () => {
    const s = exercisePhaseReducer(
      stateAt({ phase: 'expose', exposeTouched: false }),
      { type: 'ADVANCE' }
    )
    expect(s.phase).toBe('expose')
  })

  it('permits advance from expose when exposeTouched is true (implicit gate)', () => {
    const s = exercisePhaseReducer(
      stateAt({ phase: 'expose', exposeTouched: true }),
      { type: 'ADVANCE' }
    )
    expect(s.phase).toBe('bridge')
  })

  it('permits advance on explicit Start press regardless of gate (canAdvance=true wins)', () => {
    const s = exercisePhaseReducer(
      stateAt({ phase: 'expose', exposeTouched: false }),
      { type: 'ADVANCE', canAdvance: true }
    )
    expect(s.phase).toBe('bridge')
  })

  it('is a no-op outside expose', () => {
    const s = exercisePhaseReducer(
      stateAt({ phase: 'orient' }),
      { type: 'ADVANCE', canAdvance: true }
    )
    expect(s.phase).toBe('orient')
  })
})

describe('exercisePhaseReducer — variants (plan §D.2 items 12 & 13)', () => {
  it('SUPPRESS_BRIDGE jumps expose → perform with no bridge beat', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-04-19T10:05:00Z'))
    try {
      const s = exercisePhaseReducer(
        stateAt({ phase: 'expose', exposeTouched: true }),
        { type: 'SUPPRESS_BRIDGE' }
      )
      expect(s.phase).toBe('perform')
      expect(s.performStartedAt).toBe(new Date('2026-04-19T10:05:00Z').getTime())
    } finally {
      vi.useRealTimers()
    }
  })

  it('SUPPRESS_BRIDGE is a no-op outside expose', () => {
    const s = exercisePhaseReducer(stateAt({ phase: 'orient' }), { type: 'SUPPRESS_BRIDGE' })
    expect(s.phase).toBe('orient')
  })

  it('COLLAPSE_PERFORM from bridge skips straight to reinforce', () => {
    const s = exercisePhaseReducer(stateAt({ phase: 'bridge' }), { type: 'COLLAPSE_PERFORM' })
    expect(s.phase).toBe('reinforce')
  })

  it('COLLAPSE_PERFORM from expose also skips straight to reinforce (Stage 0 bombardment)', () => {
    const s = exercisePhaseReducer(stateAt({ phase: 'expose' }), { type: 'COLLAPSE_PERFORM' })
    expect(s.phase).toBe('reinforce')
  })

  it('COLLAPSE_PERFORM is a no-op in perform/reinforce/orient', () => {
    expect(exercisePhaseReducer(stateAt({ phase: 'perform' }), { type: 'COLLAPSE_PERFORM' }).phase)
      .toBe('perform')
    expect(exercisePhaseReducer(stateAt({ phase: 'reinforce' }), { type: 'COLLAPSE_PERFORM' }).phase)
      .toBe('reinforce')
    expect(exercisePhaseReducer(stateAt({ phase: 'orient' }), { type: 'COLLAPSE_PERFORM' }).phase)
      .toBe('orient')
  })
})

describe('exercisePhaseReducer — THERAPIST_SKIP', () => {
  beforeEach(() => {
    vi.useFakeTimers().setSystemTime(new Date('2026-04-19T11:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('skip-intro jumps to expose and logs override with reason', () => {
    const s = exercisePhaseReducer(
      stateAt({ phase: 'orient' }),
      { type: 'THERAPIST_SKIP', kind: 'skip-intro', reason: 'child impatient' }
    )
    expect(s.phase).toBe('expose')
    expect(s.overrides).toHaveLength(1)
    expect(s.overrides[0]).toMatchObject({
      kind: 'skip-intro',
      reason: 'child impatient',
      at: new Date('2026-04-19T11:00:00Z').getTime(),
    })
  })

  it('skip-expose jumps to bridge and appends override', () => {
    const s = exercisePhaseReducer(
      stateAt({ phase: 'expose', overrides: [{ kind: 'skip-intro', at: 1 }] }),
      { type: 'THERAPIST_SKIP', kind: 'skip-expose' }
    )
    expect(s.phase).toBe('bridge')
    expect(s.overrides).toHaveLength(2)
    expect(s.overrides[1].kind).toBe('skip-expose')
  })

  it('skip-bridge jumps to perform and stamps performStartedAt', () => {
    const s = exercisePhaseReducer(
      stateAt({ phase: 'bridge' }),
      { type: 'THERAPIST_SKIP', kind: 'skip-bridge' }
    )
    expect(s.phase).toBe('perform')
    expect(s.performStartedAt).toBe(new Date('2026-04-19T11:00:00Z').getTime())
    expect(s.overrides[0].kind).toBe('skip-bridge')
  })

  it('honours explicit `at` timestamp when provided', () => {
    const s = exercisePhaseReducer(
      stateAt({ phase: 'orient' }),
      { type: 'THERAPIST_SKIP', kind: 'skip-intro', at: 42 }
    )
    expect(s.overrides[0].at).toBe(42)
  })
})

describe('exercisePhaseReducer — RESET', () => {
  it('returns to orient and clears transient fields but preserves overrides log', () => {
    const seeded = stateAt({
      phase: 'perform',
      exposeTouched: true,
      performStartedAt: 99,
      overrides: [{ kind: 'skip-intro', at: 1, reason: 'why' }],
    })
    const s = exercisePhaseReducer(seeded, { type: 'RESET' })
    expect(s.phase).toBe('orient')
    expect(s.exposeTouched).toBe(false)
    expect(s.performStartedAt).toBeNull()
    expect(s.overrides).toEqual(seeded.overrides)
  })
})

describe('exercisePhaseReducer — unknown event', () => {
  it('returns state unchanged for events outside the union', () => {
    // Intentionally bypass typing to exercise the default branch.
    const weird = { type: 'NOT_A_REAL_EVENT' } as unknown as Parameters<
      typeof exercisePhaseReducer
    >[1]
    const s = exercisePhaseReducer(INITIAL_PHASE_STATE, weird)
    expect(s).toBe(INITIAL_PHASE_STATE)
  })
})
