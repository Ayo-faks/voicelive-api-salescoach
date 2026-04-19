/*---------------------------------------------------------------------------------------------
 *  ExerciseShell render tests — plan §D.2 items 1–4, 8–11, 14–17.
 *  Items 5, 6, 12, 13 are covered by useExercisePhase.test.ts (reducer).
 *  Item 7 is covered by assertBridgeCopy.test.ts.
 *--------------------------------------------------------------------------------------------*/

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { ExerciseShell } from './ExerciseShell'
import { useExercisePhaseContext } from './useExercisePhase'
import type {
  ExerciseBeatCopy,
  ExerciseShellProps,
  PhaseEvent,
} from './types'
import type { ExerciseMetadata } from '../../types'

const metadata: ExerciseMetadata = {
  type: 'silent_sorting',
  targetSound: 'th',
  targetWords: ['thumb', 'thin', 'think'],
  difficulty: 'easy',
  stepNumber: 2,
  masteryThreshold: 80,
}

const beats: ExerciseBeatCopy = {
  orient: "Hi friend, let's listen to two sounds and sort some pictures.",
  bridge: 'Now sort the pictures.',
  reinforce: 'Great sorting! Want another go?',
}

function AdvanceHarness(props: { event: PhaseEvent }): ReactElement {
  const ctx = useExercisePhaseContext()
  return (
    <button
      type="button"
      data-testid={`harness-${props.event.type.toLowerCase()}`}
      onClick={() => ctx.dispatch(props.event)}
    >
      dispatch {props.event.type}
    </button>
  )
}

function makeSlots(withHarness: boolean): ExerciseShellProps['slots'] {
  return {
    expose: (
      <>
        <button
          type="button"
          data-primary-affordance="true"
          data-for-phase="expose"
        >
          Explore
        </button>
        {withHarness ? (
          <>
            <AdvanceHarness event={{ type: 'EXPOSE_INTERACT' }} />
            <AdvanceHarness event={{ type: 'ADVANCE' }} />
          </>
        ) : null}
      </>
    ),
    perform: (
      <button
        type="button"
        data-primary-affordance="true"
        data-for-phase="perform"
      >
        Record
      </button>
    ),
    reinforce: (
      <button
        type="button"
        data-primary-affordance="true"
        data-for-phase="reinforce"
      >
        Again
      </button>
    ),
  }
}

function baseProps(overrides: Partial<ExerciseShellProps> = {}): ExerciseShellProps {
  return {
    metadata,
    audience: 'child',
    beats,
    slots: makeSlots(false),
    performComplete: false,
    ...overrides,
  }
}

function renderShell(
  overrides: Partial<ExerciseShellProps> = {}
): ReturnType<typeof render> {
  return render(<ExerciseShell {...baseProps(overrides)} />)
}

function renderWithHarness(
  overrides: Partial<ExerciseShellProps> = {}
): ReturnType<typeof render> {
  return render(
    <ExerciseShell {...baseProps({ slots: makeSlots(true), ...overrides })} />
  )
}

function section(): HTMLElement {
  return document.querySelector('section.exercise-shell') as HTMLElement
}

async function unlockGesture(): Promise<void> {
  await act(async () => {
    fireEvent.pointerDown(section())
  })
}

async function driveToPerform(
  onBeatEnter: ReturnType<typeof vi.fn>
): Promise<void> {
  await unlockGesture()
  await waitFor(() => expect(section().dataset.phase).toBe('expose'))
  await act(async () => {
    fireEvent.click(screen.getByTestId('harness-expose_interact'))
  })
  await act(async () => {
    fireEvent.click(screen.getByTestId('harness-advance'))
  })
  await waitFor(() => expect(section().dataset.phase).toBe('perform'))
  expect(onBeatEnter).toHaveBeenCalledWith('bridge', beats.bridge)
}

// ---------------------------------------------------------------------------
// Items 1–4: orient + gesture unlock + orient→expose on beat resolve.
// ---------------------------------------------------------------------------

describe('ExerciseShell — orient & gesture unlock (items 1–4)', () => {
  it('starts in orient phase and announces the orient beat', () => {
    renderShell()
    expect(section().dataset.phase).toBe('orient')
    expect(screen.getByTestId('exercise-shell-beat-announce').textContent).toBe(
      beats.orient
    )
  })

  it('does not play beat audio before first user gesture', async () => {
    const onBeatEnter = vi.fn().mockResolvedValue(undefined)
    renderShell({ onBeatEnter })
    await act(async () => {
      await Promise.resolve()
    })
    expect(onBeatEnter).not.toHaveBeenCalled()
    expect(section().dataset.phase).toBe('orient')
  })

  it('flushes queued orient beat after first gesture', async () => {
    const onBeatEnter = vi.fn().mockResolvedValue(undefined)
    renderShell({ onBeatEnter })
    await unlockGesture()
    await waitFor(() => expect(onBeatEnter).toHaveBeenCalled())
    expect(onBeatEnter).toHaveBeenCalledWith('orient', beats.orient)
  })

  it('advances orient → expose when onBeatEnter resolves', async () => {
    const onBeatEnter = vi.fn().mockResolvedValue(undefined)
    renderShell({ onBeatEnter })
    await unlockGesture()
    await waitFor(() => expect(section().dataset.phase).toBe('expose'))
    expect(screen.getByRole('button', { name: 'Explore' })).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// Items 8, 9: PERFORM grammar — demoted expose + phase-gated scoring.
// ---------------------------------------------------------------------------

describe('ExerciseShell — PERFORM grammar (items 8, 9)', () => {
  it('keeps expose reachable inside an accordion in perform phase', async () => {
    const onBeatEnter = vi.fn().mockResolvedValue(undefined)
    renderWithHarness({ onBeatEnter })
    await driveToPerform(onBeatEnter)

    expect(screen.getByRole('button', { name: 'Record' })).toBeTruthy()
    const demoted = document.querySelector('[data-slot="expose-demoted"]')
    expect(demoted).not.toBeNull()
    expect(demoted?.querySelector('button[data-for-phase="expose"]')).not.toBeNull()
  })

  it('omits the demoted expose accordion when hideDemotedExpose is true (Stage 8)', async () => {
    const onBeatEnter = vi.fn().mockResolvedValue(undefined)
    renderWithHarness({ onBeatEnter, hideDemotedExpose: true })
    await driveToPerform(onBeatEnter)

    expect(screen.getByRole('button', { name: 'Record' })).toBeTruthy()
    expect(document.querySelector('[data-slot="expose-demoted"]')).toBeNull()
  })

  it('exposes the current phase via context so adapters can gate scoring callbacks', async () => {
    const phasesSeen: string[] = []
    function PhaseProbe(): ReactElement {
      const ctx = useExercisePhaseContext()
      phasesSeen.push(ctx.phase)
      return <span data-testid="phase-probe">{ctx.phase}</span>
    }
    const onBeatEnter = vi.fn().mockResolvedValue(undefined)
    render(
      <ExerciseShell
        {...baseProps({
          onBeatEnter,
          slots: {
            expose: (
              <>
                <PhaseProbe />
                <AdvanceHarness event={{ type: 'EXPOSE_INTERACT' }} />
                <AdvanceHarness event={{ type: 'ADVANCE' }} />
              </>
            ),
            perform: (
              <>
                <PhaseProbe />
                <button
                  type="button"
                  data-primary-affordance="true"
                  data-for-phase="perform"
                >
                  Record
                </button>
              </>
            ),
          },
        })}
      />
    )
    await unlockGesture()
    await waitFor(() => expect(section().dataset.phase).toBe('expose'))
    expect(phasesSeen).toContain('expose')
    // Adapters must check phase === 'perform' before scoring; when not perform
    // the context value tells them to early-return.
    const current = screen.getByTestId('phase-probe')
    expect(current.textContent).toBe('expose')
  })
})

// ---------------------------------------------------------------------------
// Items 10, 11: therapist skip-intro gating + override logging.
// ---------------------------------------------------------------------------

describe('ExerciseShell — therapist skip-intro (items 10, 11)', () => {
  it('does not render skip-intro for child audience', () => {
    renderShell({ audience: 'child', therapistCanSkipIntro: true })
    expect(screen.queryByRole('button', { name: 'Skip introduction' })).toBeNull()
  })

  it('does not render skip-intro when therapistCanSkipIntro is false', () => {
    renderShell({ audience: 'therapist', therapistCanSkipIntro: false })
    expect(screen.queryByRole('button', { name: 'Skip introduction' })).toBeNull()
  })

  it('calls onTherapistOverride and advances past orient when skip-intro pressed', async () => {
    const onTherapistOverride = vi.fn()
    renderShell({
      audience: 'therapist',
      therapistCanSkipIntro: true,
      onTherapistOverride,
    })
    const btn = screen.getByRole('button', { name: 'Skip introduction' })
    await act(async () => {
      fireEvent.click(btn)
    })
    expect(onTherapistOverride).toHaveBeenCalledWith('skip-intro')
    await waitFor(() => expect(section().dataset.phase).toBe('expose'))
  })
})

// ---------------------------------------------------------------------------
// Item 14: covertExpose hides the child-facing expose UI.
// ---------------------------------------------------------------------------

describe('ExerciseShell — covertExpose variant (item 14)', () => {
  it('hides expose slot from the DOM when covertExpose is true', async () => {
    const onBeatEnter = vi.fn().mockResolvedValue(undefined)
    renderWithHarness({ onBeatEnter, covertExpose: true })
    await unlockGesture()
    await waitFor(() => expect(section().dataset.phase).toBe('expose'))
    expect(document.querySelector('[data-slot="expose"]')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Explore' })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Item 15: warming veil while realtime is not ready.
// ---------------------------------------------------------------------------

describe('ExerciseShell — warming veil (item 15)', () => {
  it('queues the beat and shows the warming veil when realtime is not ready', async () => {
    const onBeatEnter = vi.fn().mockResolvedValue(undefined)
    const { rerender } = render(
      <ExerciseShell {...baseProps({ onBeatEnter, realtimeReady: false })} />
    )
    await unlockGesture()
    expect(
      screen.getByTestId('exercise-shell-warming-veil').textContent ?? ''
    ).toMatch(/Buddy is warming up/)
    expect(onBeatEnter).not.toHaveBeenCalled()

    rerender(
      <ExerciseShell {...baseProps({ onBeatEnter, realtimeReady: true })} />
    )
    await waitFor(() =>
      expect(onBeatEnter).toHaveBeenCalledWith('orient', beats.orient)
    )
    expect(screen.queryByTestId('exercise-shell-warming-veil')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Item 16: focus management on phase transitions.
// ---------------------------------------------------------------------------

describe('ExerciseShell — focus management (item 16)', () => {
  it('moves focus to the primary expose affordance when phase enters expose', async () => {
    const onBeatEnter = vi.fn().mockResolvedValue(undefined)
    renderShell({ onBeatEnter })
    await unlockGesture()
    await waitFor(() => expect(section().dataset.phase).toBe('expose'))
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Explore' })
      )
    })
  })

  it('moves focus to the perform affordance when phase enters perform', async () => {
    const onBeatEnter = vi.fn().mockResolvedValue(undefined)
    renderWithHarness({ onBeatEnter })
    await driveToPerform(onBeatEnter)
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Record' })
      )
    })
  })
})

// ---------------------------------------------------------------------------
// Item 17: prefers-reduced-motion honoured via data attribute.
// ---------------------------------------------------------------------------

describe('ExerciseShell — prefers-reduced-motion (item 17)', () => {
  let originalMatchMedia: typeof window.matchMedia

  beforeEach(() => {
    originalMatchMedia = window.matchMedia
  })

  afterEach(() => {
    window.matchMedia = originalMatchMedia
  })

  function stubMatchMedia(matches: boolean): void {
    window.matchMedia = ((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia
  }

  it('sets data-reduced-motion="true" when the media query matches', () => {
    stubMatchMedia(true)
    renderShell()
    expect(section().dataset.reducedMotion).toBe('true')
  })

  it('sets data-reduced-motion="false" when the media query does not match', () => {
    stubMatchMedia(false)
    renderShell()
    expect(section().dataset.reducedMotion).toBe('false')
  })
})
