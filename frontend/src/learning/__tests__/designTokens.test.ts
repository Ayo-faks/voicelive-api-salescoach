import { describe, expect, it } from 'vitest'
import { pathfinderTokens as t } from '../theme/pathfinder-tokens'

/**
 * Pure-JS WCAG 2.1 contrast checks on the token hex values.
 * jsdom cannot compute rendered contrast, so we validate the source-of-truth
 * tokens directly. Muted foregrounds must clear AA (>=4.5:1) on every neutral
 * surface they can land on (surface, surfaceMuted, page).
 */
function channelLuminance(c: number): number {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

function relativeLuminance(hex: string): number {
  const h = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16))
  return (
    0.2126 * channelLuminance(r) +
    0.7152 * channelLuminance(g) +
    0.0722 * channelLuminance(b)
  )
}

function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg)
  const l2 = relativeLuminance(bg)
  const hi = Math.max(l1, l2)
  const lo = Math.min(l1, l2)
  return (hi + 0.05) / (lo + 0.05)
}

const AA_NORMAL = 4.5
const surfaces = [t.brand.surface, t.brand.surfaceMuted, t.brand.page]

describe('design token contrast (WCAG AA)', () => {
  it('textSecondary clears AA on every neutral surface', () => {
    for (const bg of surfaces) {
      expect(contrastRatio(t.brand.textSecondary, bg)).toBeGreaterThanOrEqual(
        AA_NORMAL
      )
    }
  })

  it('textTertiary clears AA on every neutral surface', () => {
    for (const bg of surfaces) {
      expect(contrastRatio(t.brand.textTertiary, bg)).toBeGreaterThanOrEqual(
        AA_NORMAL
      )
    }
  })

  it('primary text clears AA on every neutral surface', () => {
    for (const bg of surfaces) {
      expect(contrastRatio(t.brand.text, bg)).toBeGreaterThanOrEqual(AA_NORMAL)
    }
  })

  it('preserves a two-step muted hierarchy (secondary darker than tertiary)', () => {
    expect(relativeLuminance(t.brand.textSecondary)).toBeLessThan(
      relativeLuminance(t.brand.textTertiary)
    )
  })
})

describe('design token scales', () => {
  it('exposes a three-step weight scale capped at 700', () => {
    expect(t.weight.regular).toBe(500)
    expect(t.weight.medium).toBe(600)
    expect(t.weight.strong).toBe(700)
    expect(t.weight.strong).toBeLessThanOrEqual(700)
  })

  it('exposes a >=44px control hit-height token', () => {
    expect(parseInt(t.control.minHeight, 10)).toBeGreaterThanOrEqual(44)
  })

  it('exposes a non-square control radius', () => {
    expect(parseInt(t.radius.control, 10)).toBeGreaterThan(0)
  })
})
