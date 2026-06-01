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
  // Minimum interactive target height (px) — keeps tap targets >= 44px (WCAG 2.5.5).
  control: {
    minHeight: '44px',
    minHeightCompact: '36px',
  },
  font: {
    display:
      '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", system-ui, sans-serif',
    text: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif',
  },
} as const

export type PathfinderTokens = typeof pathfinderTokens
