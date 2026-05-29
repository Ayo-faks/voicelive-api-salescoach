import { render, screen, act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VoiceCtaPill, VOICE_PILL_ANNOUNCE_DELAY_MS } from './VoiceCtaPill'

describe('VoiceCtaPill', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders an idle dot with "Tap to start" by default', () => {
    render(<VoiceCtaPill state="idle" level={0} />)
    const pill = screen.getByTestId('voice-cta-pill')
    expect(pill.getAttribute('data-state')).toBe('idle')
    expect(pill.textContent).toContain('Tap to start')
  })

  it.each([
    ['connecting', 'Connecting'],
    ['listening', 'Listening'],
    ['thinking', 'Thinking'],
    ['speaking', 'Tutor speaking'],
    ['error', 'Try again'],
  ] as const)('shows the correct visible label for state=%s', (state, expected) => {
    render(<VoiceCtaPill state={state} level={0.5} />)
    const pill = screen.getByTestId('voice-cta-pill')
    expect(pill.getAttribute('data-state')).toBe(state)
    expect(pill.textContent).toContain(expected)
  })

  it('marks the visible label aria-hidden and exposes a polite live region', () => {
    render(<VoiceCtaPill state="listening" level={0.4} />)
    const pill = screen.getByTestId('voice-cta-pill')
    // The <output> itself must NOT carry aria-live (would double-announce).
    expect(pill.hasAttribute('aria-live')).toBe(false)
    const live = pill.querySelector('[role="status"]')
    expect(live).not.toBeNull()
    expect(live!.getAttribute('aria-live')).toBe('polite')
    // The visible label span is aria-hidden so SR users only hear the live region.
    const hidden = Array.from(pill.querySelectorAll('[aria-hidden="true"]'))
    expect(hidden.some((el) => el.textContent === 'Listening…')).toBe(true)
  })

  it('debounces live-region announcements by ~800ms', async () => {
    vi.useFakeTimers()
    const { rerender } = render(<VoiceCtaPill state="listening" level={0.4} />)
    const live = screen.getByTestId('voice-cta-pill').querySelector('[role="status"]')!
    // Initial render: announced text matches initial label after one tick.
    act(() => {
      vi.advanceTimersByTime(VOICE_PILL_ANNOUNCE_DELAY_MS + 10)
    })
    expect(live.textContent).toBe('Listening…')

    rerender(<VoiceCtaPill state="thinking" level={0.4} />)
    // Just before the debounce expires, live region must still show old label.
    act(() => {
      vi.advanceTimersByTime(VOICE_PILL_ANNOUNCE_DELAY_MS - 50)
    })
    expect(live.textContent).toBe('Listening…')

    // After the debounce, the new label is committed.
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(live.textContent).toBe('Thinking…')
  })

  it('renders static dots instead of an animated wave when reduced motion is preferred', () => {
    const matchMedia = vi.fn().mockReturnValue({
      matches: true,
      media: '(prefers-reduced-motion: reduce)',
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    } as unknown as MediaQueryList)
    const original = window.matchMedia
    window.matchMedia = matchMedia as unknown as typeof window.matchMedia
    try {
      render(<VoiceCtaPill state="listening" level={0.8} />)
      const pill = screen.getByTestId('voice-cta-pill')
      // Three static dot spans, no animated bars.
      const spans = pill.querySelectorAll('span[aria-hidden="true"] > span')
      expect(spans.length).toBe(3)
    } finally {
      window.matchMedia = original
    }
  })
})
