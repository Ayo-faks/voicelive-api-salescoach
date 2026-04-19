/*---------------------------------------------------------------------------------------------
 *  PhonemeIcon — thin SVG placeholder, one icon per sound token.
 *  Pairs with getPerceptLabel (§C.3) to replace letter-name copy in EXPOSE.
 *  Intentionally simple for PR1; richer articulation artwork lands later.
 *--------------------------------------------------------------------------------------------*/

import type { FC } from 'react'

export type PhonemeIconSound = 'th' | 'f' | 's' | 'sh' | 'r' | 'k' | 'v' | 'z'

const PERCEPT_LABELS: Readonly<Record<string, string>> = Object.freeze({
  th: 'thhh',
  f: 'fff',
  s: 'sss',
  sh: 'shhh',
  r: 'rrr',
  k: 'kuh',
  v: 'vvv',
  z: 'zzz',
})

const COLOUR_TOKENS: Readonly<Record<string, string>> = Object.freeze({
  th: 'var(--phoneme-th, #0d8a84)',
  f: 'var(--phoneme-f, #d48c3b)',
  s: 'var(--phoneme-s, #4e8cff)',
  sh: 'var(--phoneme-sh, #a45dd1)',
  r: 'var(--phoneme-r, #e5594a)',
  k: 'var(--phoneme-k, #6a7b3f)',
  v: 'var(--phoneme-v, #2f6f8c)',
  z: 'var(--phoneme-z, #8c6a2f)',
})

/**
 * Returns the child-facing percept label for a sound (no letter names).
 * Unknown sounds degrade to the lowercased token — never to an uppercase letter.
 */
export function getPerceptLabel(sound: string | null | undefined): string {
  if (!sound) return ''
  const key = sound.trim().toLowerCase()
  return PERCEPT_LABELS[key] ?? key
}

export function getPhonemeColour(sound: string | null | undefined): string {
  if (!sound) return 'var(--color-text-secondary, #5a6a6f)'
  const key = sound.trim().toLowerCase()
  return COLOUR_TOKENS[key] ?? 'var(--color-text-secondary, #5a6a6f)'
}

export interface PhonemeIconProps {
  sound: string
  size?: number
  title?: string
  className?: string
}

/**
 * Thin SVG placeholder: a rounded square filled with the phoneme colour,
 * overlaid with the percept label text. role="img" with aria-label.
 */
export const PhonemeIcon: FC<PhonemeIconProps> = ({
  sound,
  size = 40,
  title,
  className,
}) => {
  const label = getPerceptLabel(sound)
  const colour = getPhonemeColour(sound)
  const ariaLabel = title ?? `${label} sound`
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 40 40"
      role="img"
      aria-label={ariaLabel}
      className={className}
      data-phoneme={sound.trim().toLowerCase()}
    >
      <title>{ariaLabel}</title>
      <rect
        x="1"
        y="1"
        width="38"
        height="38"
        rx="8"
        ry="8"
        fill={colour}
        stroke="rgba(15, 42, 58, 0.24)"
        strokeWidth="1"
      />
      <text
        x="20"
        y="25"
        textAnchor="middle"
        fontFamily="var(--font-display, system-ui)"
        fontSize="12"
        fontWeight="700"
        fill="#ffffff"
      >
        {label}
      </text>
    </svg>
  )
}

export default PhonemeIcon
