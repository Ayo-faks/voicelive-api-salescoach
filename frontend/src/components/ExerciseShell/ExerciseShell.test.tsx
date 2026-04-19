import { describe, it } from 'vitest'

/*
 * ExerciseShell test suite — plan §D.2 items 1–17.
 *
 * A1 commits the skeleton with every test name as `it.todo` so the contract
 * of what will be covered is committed alongside the component shape.
 * A2 fills in reducer-driven tests (items 5, 6, 12, 13).
 * A3 fills in render / gesture / focus / a11y tests (items 1–4, 8–11, 14–17).
 * Bridge-copy invariants (item 7) are covered by assertBridgeCopy.test.ts.
 */

describe('ExerciseShell', () => {
  it.todo('starts in orient phase and announces the orient beat')
  it.todo('advances orient → expose when onBeatEnter resolves')
  it.todo('does not play beat audio before first user gesture')
  it.todo('flushes queued beat after first gesture')
  it.todo('blocks advance from expose until canAdvanceFromExpose returns true')
  it.todo('allows advance from expose on explicit Start press regardless of gate')
  it.todo('asserts bridge copy is at most 7 words (valid fixture)')
  it.todo('asserts bridge copy is at most 7 words (throws on >7 in dev)')
  it.todo('keeps expose slot mounted and reachable in perform phase')
  it.todo('drops scoring callbacks outside perform phase')
  it.todo('renders therapist skip-intro only for therapist audience')
  it.todo('logs therapist override and calls onTherapistOverride when skip-intro pressed')
  it.todo('collapsePerform variant skips straight to reinforce')
  it.todo('suppressBridge variant goes expose → perform with no bridge beat')
  it.todo('covertExpose variant hides expose slot from DOM')
  it.todo('queues beat and shows warming veil when realtime not ready')
  it.todo('moves focus to primary affordance on each phase enter')
  it.todo('honours prefers-reduced-motion')
})
