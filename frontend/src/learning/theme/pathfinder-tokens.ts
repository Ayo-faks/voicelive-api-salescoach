/**
 * Pathfinder design tokens — monochrome, Apple × ChatGPT inspired.
 * Black primary, fine greys, near-white background. Status colour is muted
 * and used only for risk/mastery semantics; no brand accent hues.
 */
export const pathfinderTokens = {
  brand: {
    ink: '#0a0a0a',
    inkSoft: '#1c1c1e',
    inkMuted: '#3a3a3c',
    line: '#e5e5ea',
    lineSoft: '#f0f0f3',
    surface: '#ffffff',
    surfaceMuted: '#fafafa',
    page: '#f7f7f8',
    text: '#0a0a0a',
    // Muted foregrounds tuned to clear WCAG AA (>=4.5:1) on surface, surfaceMuted
    // and page backgrounds while preserving a two-step hierarchy.
    textSecondary: '#5c5c61',
    textTertiary: '#6e6e73',
    onInk: '#ffffff',
  },
  status: {
    criticalBg: '#fef0ef',
    criticalFg: '#86181d',
    warnBg: '#f6f6f7',
    warnFg: '#7a5b00',
    okBg: '#f3f6f3',
    okFg: '#1b5e20',
    infoBg: '#f1f2f4',
    infoFg: '#1f3a68',
  },
  mastery: {
    needsSupportBg: '#f4e3e3',
    needsSupportFg: '#86181d',
    developingBg: '#f2f2f3',
    developingFg: '#7a5b00',
    approachingBg: '#ededee',
    approachingFg: '#1b5e20',
    secureBg: '#e3e6e3',
    secureFg: '#0f3d12',
  },
  risk: {
    low: { bg: '#f3f6f3', fg: '#1b5e20' },
    review: { bg: '#f6f6f7', fg: '#7a5b00' },
    high: { bg: '#fef0ef', fg: '#86181d' },
  },
  surface: {
    page: '#f7f7f8',
    card: '#ffffff',
    cardMuted: '#fafafa',
    raisedShadow: '0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.04)',
    hoverShadow: '0 1px 2px rgba(0,0,0,0.06), 0 12px 28px rgba(0,0,0,0.08)',
    cardElevatedShadow:
      'inset 0 1px 0 rgba(255,255,255,0.86), 0 1px 2px rgba(0,0,0,0.04), 0 12px 32px rgba(0,0,0,0.045)',
    cardHoverShadow:
      'inset 0 1px 0 rgba(255,255,255,0.9), 0 1px 2px rgba(0,0,0,0.06), 0 16px 36px rgba(0,0,0,0.075)',
    hairline: '1px solid #e5e5ea',
  },
  space: {
    xxs: '4px',
    xs: '6px',
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '20px',
    xxl: '24px',
    xxxl: '32px',
    pageX: '36px',
    pageY: '28px',
  },
  radius: {
    sm: '8px',
    md: '12px',
    lg: '14px',
    xl: '18px',
    xxl: '22px',
    pill: '999px',
    // Deliberate control radius so chrome (selectors, secondary buttons) is
    // never left on a square Fluent default.
    control: '10px',
  },
  // Three-step weight scale. Use these instead of ad-hoc 700/800/850 values so
  // type weight stays coherent across the learner surface.
  weight: {
    regular: 500,
    medium: 600,
    strong: 700,
  },
  type: {
    caption: { fontSize: '0.72rem', lineHeight: '1rem' },
    body: { fontSize: '0.9rem', lineHeight: '1.45rem' },
    bodyStrong: { fontSize: '0.98rem', lineHeight: '1.55rem' },
    title: { fontSize: '1.2rem', lineHeight: '1.55rem' },
    display: { fontSize: '2.4rem', lineHeight: '2.75rem' },
  },
  focus: {
    ring: '#0a0a0a',
    ringSoft: 'rgba(10,10,12,0.18)',
    outline: '0 0 0 3px rgba(10,10,12,0.18)',
  },
  motion: {
    durationFast: '120ms',
    durationNormal: '180ms',
    durationSlow: '280ms',
    easingStandard: 'cubic-bezier(0.2, 0, 0, 1)',
    easingSpring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  },
  // Minimum interactive target height (px) — keeps tap targets >= 44px (WCAG 2.5.5).
  control: {
    minHeight: '44px',
    minHeightCompact: '36px',
  },
  font: {
    display:
      '"Manrope", -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
    text: '"Manrope", -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
  },
} as const

type WidenTokenValue<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends object
      ? { readonly [K in keyof T]: WidenTokenValue<T[K]> }
      : T

export type PathfinderTokens = WidenTokenValue<typeof pathfinderTokens>

export type PathfinderThemeMode = 'light' | 'dark'

export const pathfinderTokensDark: PathfinderTokens = {
  ...pathfinderTokens,
  brand: {
    ...pathfinderTokens.brand,
    ink: '#f5f5f7',
    inkSoft: '#e4e4e7',
    inkMuted: '#c8c8cc',
    line: '#2c2c30',
    lineSoft: '#232327',
    surface: '#1b1b1e',
    surfaceMuted: '#202024',
    page: '#0d0d0f',
    text: '#f5f5f7',
    textSecondary: '#a2a2a9',
    textTertiary: '#86868c',
    onInk: '#0a0a0a',
  },
  status: {
    criticalBg: '#3a171a',
    criticalFg: '#ffb4b8',
    warnBg: '#33270a',
    warnFg: '#f2c94c',
    okBg: '#14301b',
    okFg: '#8fd694',
    infoBg: '#17233a',
    infoFg: '#9bc2ff',
  },
  mastery: {
    needsSupportBg: '#3a171a',
    needsSupportFg: '#ffb4b8',
    developingBg: '#33270a',
    developingFg: '#f2c94c',
    approachingBg: '#173220',
    approachingFg: '#9be29f',
    secureBg: '#15351b',
    secureFg: '#a7e7aa',
  },
  risk: {
    low: { bg: '#14301b', fg: '#8fd694' },
    review: { bg: '#33270a', fg: '#f2c94c' },
    high: { bg: '#3a171a', fg: '#ffb4b8' },
  },
  surface: {
    ...pathfinderTokens.surface,
    page: '#0d0d0f',
    card: '#1b1b1e',
    cardMuted: '#202024',
    raisedShadow: '0 1px 2px rgba(0,0,0,0.4), 0 8px 24px rgba(0,0,0,0.5)',
    hoverShadow: '0 1px 2px rgba(0,0,0,0.45), 0 12px 28px rgba(0,0,0,0.56)',
    cardElevatedShadow:
      'inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 2px rgba(0,0,0,0.4), 0 12px 32px rgba(0,0,0,0.55)',
    cardHoverShadow:
      'inset 0 1px 0 rgba(255,255,255,0.06), 0 1px 2px rgba(0,0,0,0.45), 0 16px 36px rgba(0,0,0,0.6)',
    hairline: '1px solid #2c2c30',
  },
  focus: {
    ring: '#f5f5f7',
    ringSoft: 'rgba(245,245,247,0.28)',
    outline: '0 0 0 3px rgba(245,245,247,0.28)',
  },
}

export function getPathfinderTokens(
  mode: PathfinderThemeMode
): PathfinderTokens {
  return mode === 'dark' ? pathfinderTokensDark : pathfinderTokens
}
