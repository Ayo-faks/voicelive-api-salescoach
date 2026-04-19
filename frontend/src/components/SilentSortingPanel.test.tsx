import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../services/api'
import { SilentSortingPanel } from './SilentSortingPanel'

/*---------------------------------------------------------------------------------------------
 *  Session C, §D.2 items 18–23 (updated in Session E to run against the real
 *  `ExerciseShell` from `./ExerciseShell`, not the retired local mock).
 *  Phase transitions are:
 *    orient → expose (auto, after user gesture on the shell + onBeatEnter resolves)
 *    expose → bridge (only via `advance({force:true})` from the "Start game" button,
 *                     or when `canAdvanceFromExpose` returns true AND advance() is called)
 *    bridge → perform (auto, after onBeatEnter resolves)
 *  The real shell gates audio + auto-advance on a user gesture (a11y/autoplay), so
 *  each test seeds a `pointerDown` on the shell `<section>` before asserting on
 *  expose-phase DOM via the `seedShellGesture()` helper below.
 *--------------------------------------------------------------------------------------------*/

function seedShellGesture(): void {
  const section = document.querySelector('section.exercise-shell')
  if (section) {
    fireEvent.pointerDown(section)
  }
}

vi.mock('../services/api', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      synthesizeSpeech: vi.fn().mockResolvedValue('dGVzdA=='),
    },
  }
})

class AudioMock {
  addEventListener = vi.fn()
  pause = vi.fn()
  play = vi.fn().mockResolvedValue(undefined)
}

const baseMetadata = {
  targetSound: 'th',
  errorSound: 'f',
  targetWords: ['thin', 'fin'],
}

describe('SilentSortingPanel (ExerciseShell adapter)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.mocked(api.synthesizeSpeech).mockResolvedValue('dGVzdA==')

    Object.defineProperty(globalThis, 'Audio', {
      writable: true,
      value: AudioMock,
    })

    Object.defineProperty(globalThis.URL, 'createObjectURL', {
      writable: true,
      value: vi.fn(() => 'blob:test-audio'),
    })

    Object.defineProperty(globalThis.URL, 'revokeObjectURL', {
      writable: true,
      value: vi.fn(),
    })
  })

  it('requires both phoneme buttons tapped before bridge', async () => {
    render(<SilentSortingPanel metadata={baseMetadata} />)
    seedShellGesture()

    // Wait for ORIENT→EXPOSE auto-advance.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Hear thhh sound/i })).toBeTruthy()
    })

    // No perform-phase affordances before Start.
    expect(screen.queryAllByText('Cards to sort')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /Reset sorting/i })).toBeNull()

    // Tapping only one phoneme does NOT advance to perform.
    fireEvent.click(screen.getByRole('button', { name: /Hear thhh sound/i }))
    await waitFor(() => {
      // Preview resolves and button re-enables (pending cleared).
      expect(
        (screen.getByRole('button', { name: /Hear thhh sound/i }) as HTMLButtonElement).disabled,
      ).toBe(false)
    })
    expect(screen.queryAllByText('Cards to sort')).toHaveLength(0)

    // Tap the second phoneme — still in expose until Start is pressed.
    fireEvent.click(screen.getByRole('button', { name: /Hear fff sound/i }))
    await waitFor(() => {
      expect(
        (screen.getByTestId('silent-sorting-start-game') as HTMLButtonElement).disabled,
      ).toBe(false)
    })
    expect(screen.queryAllByText('Cards to sort')).toHaveLength(0)

    // Press Start game → we advance through bridge into perform.
    fireEvent.click(screen.getByTestId('silent-sorting-start-game'))

    await waitFor(() => {
      expect(screen.queryAllByText('Cards to sort').length).toBeGreaterThan(0)
    })
  })

  it('renders percept labels, not letter names, in expose', async () => {
    const { container } = render(<SilentSortingPanel metadata={baseMetadata} />)
    seedShellGesture()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Hear thhh sound/i })).toBeTruthy()
    })

    // Percept labels present.
    expect(screen.getByText('Hear thhh')).toBeTruthy()
    expect(screen.getByText('Hear fff')).toBeTruthy()

    // Letter-name buttons must NOT exist in the expose slot.
    expect(screen.queryByRole('button', { name: 'Hear TH' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Hear F' })).toBeNull()

    // Phoneme icons carry the data-phoneme attribute.
    expect(container.querySelector('[data-phoneme="th"]')).not.toBeNull()
    expect(container.querySelector('[data-phoneme="f"]')).not.toBeNull()
  })

  it('keeps phoneme preview accordion reachable in perform', async () => {
    render(<SilentSortingPanel metadata={baseMetadata} />)
    seedShellGesture()

    // Tap both previews so canAdvanceFromExpose flips true and Start enables.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Hear thhh sound/i })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: /Hear thhh sound/i }))
    fireEvent.click(screen.getByRole('button', { name: /Hear fff sound/i }))
    await waitFor(() => {
      expect(
        (screen.getByTestId('silent-sorting-start-game') as HTMLButtonElement).disabled,
      ).toBe(false)
    })
    fireEvent.click(screen.getByTestId('silent-sorting-start-game'))

    // Perform phase entered — pool drop zone ("Cards to sort") renders.
    await waitFor(() => {
      expect(screen.queryAllByText('Cards to sort').length).toBeGreaterThan(0)
    })

    // Demoted expose lives inside a <details> with summary "Hear the sounds".
    const summary = screen.getByText('Hear the sounds')
    expect(summary.tagName.toLowerCase()).toBe('summary')

    const details = summary.closest('details')
    expect(details).not.toBeNull()
    // Phoneme buttons still reachable from within the demoted panel.
    expect(within(details as HTMLElement).getByRole('button', { name: /Hear thhh sound/i })).toBeTruthy()
  })

  it('falls back to TTS candidate when curated asset is missing', async () => {
    vi.mocked(api.synthesizeSpeech).mockClear()

    render(<SilentSortingPanel metadata={baseMetadata} />)
    seedShellGesture()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Hear fff sound/i })).toBeTruthy()
    })

    // F has no curated asset → must route via api.synthesizeSpeech with the pseudo-spelling "fff".
    fireEvent.click(screen.getByRole('button', { name: /Hear fff sound/i }))

    await waitFor(() => {
      expect(api.synthesizeSpeech).toHaveBeenLastCalledWith('fff')
    })
  })

  it('uses curated TH asset when targetSound is th', async () => {
    vi.mocked(api.synthesizeSpeech).mockClear()

    render(<SilentSortingPanel metadata={baseMetadata} />)
    seedShellGesture()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Hear thhh sound/i })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: /Hear thhh sound/i }))

    // Curated asset path never hits the TTS endpoint.
    await waitFor(() => {
      expect(api.synthesizeSpeech).not.toHaveBeenCalled()
    })
  })

  it('dev save-take appears only when VITE_ENABLE_PREVIEW_EXPORT is set', async () => {
    // Default (flag unset): no Save take button, even for therapists.
    const { unmount } = render(
      <SilentSortingPanel audience="therapist" metadata={baseMetadata} />,
    )
    seedShellGesture()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Hear thhh sound/i })).toBeTruthy()
    })

    expect(screen.queryByRole('button', { name: 'Save take' })).toBeNull()
    expect(screen.queryByTestId('silent-sorting-dev-tools')).toBeNull()

    unmount()

    // Flag on: Save take button rendered inside the shell devSlot.
    vi.stubEnv('VITE_ENABLE_PREVIEW_EXPORT', 'true')
    try {
      render(<SilentSortingPanel audience="therapist" metadata={baseMetadata} />)
      seedShellGesture()

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Save take' })).toBeTruthy()
      })
      expect(screen.getByTestId('silent-sorting-dev-tools')).toBeTruthy()
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
