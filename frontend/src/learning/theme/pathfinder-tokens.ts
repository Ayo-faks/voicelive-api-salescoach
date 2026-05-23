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
    textSecondary: '#6e6e73',
    textTertiary: '#8e8e93',
    onInk: '#ffffff',
  },
  status: {
    criticalBg: '#fef0ef',
    criticalFg: '#86181d',
    warnBg: '#fdf6e3',
    warnFg: '#7a5b00',
    okBg: '#eef7ef',
    okFg: '#1b5e20',
    infoBg: '#eef1f7',
    infoFg: '#1f3a68',
  },
  mastery: {
    needsSupportBg: '#f4e3e3',
    needsSupportFg: '#86181d',
    developingBg: '#f4ecd9',
    developingFg: '#7a5b00',
    approachingBg: '#e8efe8',
    approachingFg: '#1b5e20',
    secureBg: '#dde6dd',
    secureFg: '#0f3d12',
  },
  risk: {
    low: { bg: '#eef7ef', fg: '#1b5e20' },
    review: { bg: '#fdf6e3', fg: '#7a5b00' },
    high: { bg: '#fef0ef', fg: '#86181d' },
  },
  surface: {
    page: '#f7f7f8',
    card: '#ffffff',
    cardMuted: '#fafafa',
    raisedShadow: '0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.04)',
    hoverShadow: '0 1px 2px rgba(0,0,0,0.06), 0 12px 28px rgba(0,0,0,0.08)',
    hairline: '1px solid #e5e5ea',
  },
  radius: {
    sm: '8px',
    md: '12px',
    lg: '14px',
    xl: '18px',
    xxl: '22px',
    pill: '999px',
  },
  font: {
    display:
      '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", system-ui, sans-serif',
    text:
      '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif',
  },
} as const

export type PathfinderTokens = typeof pathfinderTokens
