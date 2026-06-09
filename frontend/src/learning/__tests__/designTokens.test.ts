import { describe, expect, it } from 'vitest'
import {
  pathfinderTokens as t,
  pathfinderTokensDark as td,
} from '../theme/pathfinder-tokens'

/**
 * Pure-JS WCAG 2.1 contrast checks on the token hex values.
 * jsdom cannot compute rendered contrast, so we validate the source-of-truth
 * tokens directly. Muted foregrounds must clear AA (>=4.5:1) on every neutral
 * surface they can land on (surface, surfaceMuted, page).
 */
function channelLuminance(c: number): number {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function relativeLuminance(hex: string): number {
  const h = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map(i => Number.parseInt(h.slice(i, i + 2), 16))
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
const AA_LARGE_OR_UI = 3
const surfaces = [t.brand.surface, t.brand.surfaceMuted, t.brand.page]
const darkSurfaces = [td.brand.surface, td.brand.surfaceMuted, td.brand.page]
const semanticPairs = [
  [t.status.criticalFg, t.status.criticalBg],
  [t.status.warnFg, t.status.warnBg],
  [t.status.okFg, t.status.okBg],
  [t.status.infoFg, t.status.infoBg],
  [t.mastery.needsSupportFg, t.mastery.needsSupportBg],
  [t.mastery.developingFg, t.mastery.developingBg],
  [t.mastery.approachingFg, t.mastery.approachingBg],
  [t.mastery.secureFg, t.mastery.secureBg],
  [t.risk.low.fg, t.risk.low.bg],
  [t.risk.review.fg, t.risk.review.bg],
  [t.risk.high.fg, t.risk.high.bg],
] as const
const darkSemanticPairs = [
  [td.status.criticalFg, td.status.criticalBg],
  [td.status.warnFg, td.status.warnBg],
  [td.status.okFg, td.status.okBg],
  [td.status.infoFg, td.status.infoBg],
  [td.mastery.needsSupportFg, td.mastery.needsSupportBg],
  [td.mastery.developingFg, td.mastery.developingBg],
  [td.mastery.approachingFg, td.mastery.approachingBg],
  [td.mastery.secureFg, td.mastery.secureBg],
  [td.risk.low.fg, td.risk.low.bg],
  [td.risk.review.fg, td.risk.review.bg],
  [td.risk.high.fg, td.risk.high.bg],
] as const

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

  it('dark primary and secondary text tokens clear AA on every dark neutral surface', () => {
    for (const bg of darkSurfaces) {
      expect(contrastRatio(td.brand.text, bg)).toBeGreaterThanOrEqual(AA_NORMAL)
      expect(contrastRatio(td.brand.textSecondary, bg)).toBeGreaterThanOrEqual(
        AA_NORMAL
      )
    }
  })

  it('dark tertiary text clears AA for large/UI metadata on every dark neutral surface', () => {
    for (const bg of darkSurfaces) {
      expect(contrastRatio(td.brand.textTertiary, bg)).toBeGreaterThanOrEqual(
        AA_LARGE_OR_UI
      )
    }
  })

  it('dark ink-filled controls keep dark glyphs on light ink', () => {
    expect(contrastRatio(td.brand.onInk, td.brand.ink)).toBeGreaterThanOrEqual(
      AA_NORMAL
    )
  })

  it('semantic badge pairs clear AA in light and dark mode', () => {
    for (const [fg, bg] of [...semanticPairs, ...darkSemanticPairs]) {
      expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_NORMAL)
    }
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
    expect(Number.parseInt(t.control.minHeight, 10)).toBeGreaterThanOrEqual(44)
  })

  it('exposes a non-square control radius', () => {
    expect(Number.parseInt(t.radius.control, 10)).toBeGreaterThan(0)
  })

  it('exposes shared spacing, type, focus, and motion scales', () => {
    expect(Number.parseInt(t.space.sm, 10)).toBeLessThan(
      Number.parseInt(t.space.md, 10)
    )
    expect(Number.parseInt(t.space.pageX, 10)).toBeGreaterThanOrEqual(32)
    expect(t.type.display.fontSize).toMatch(/rem$/)
    expect(t.focus.outline).toContain(t.focus.ringSoft)
    expect(t.motion.durationFast).toMatch(/ms$/)
    expect(t.motion.easingStandard).toContain('cubic-bezier')
  })

  it('dark mode exposes its own visible focus ring', () => {
    expect(td.focus.ring).not.toBe(t.focus.ring)
    expect(contrastRatio(td.focus.ring, td.brand.page)).toBeGreaterThanOrEqual(
      AA_NORMAL
    )
  })
})
