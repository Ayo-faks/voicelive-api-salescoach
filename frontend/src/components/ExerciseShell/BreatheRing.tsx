/*---------------------------------------------------------------------------------------------
 *  BreatheRing — PR6. Calm, breathing SVG ring that replaces the bare "warming up…"
 *  text while the realtime channel is still coming up. Honors prefers-reduced-motion
 *  by freezing the animation. Text content is preserved (same testid + copy) so the
 *  live-region and existing tests continue to work.
 *--------------------------------------------------------------------------------------------*/

import type { FC } from 'react'

interface BreatheRingProps {
  label: string
  reducedMotion: boolean
  size?: number
}

export const BreatheRing: FC<BreatheRingProps> = ({ label, reducedMotion, size = 72 }) => {
  const stroke = 'var(--color-primary-500, #6b8afd)'
  const ringStyle = reducedMotion
    ? undefined
    : ({ animation: 'exercise-shell-breathe 3.2s ease-in-out infinite' } as const)

  return (
    <div
      className="exercise-shell__warming-veil"
      aria-live="polite"
      data-testid="exercise-shell-warming-veil"
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 'var(--space-sm, 0.5rem)',
        padding: 'var(--space-md, 0.75rem)',
        color: 'var(--color-text-secondary, #667085)',
        fontSize: '0.85rem',
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 72 72"
        aria-hidden="true"
        style={{ display: 'block', transformOrigin: 'center', ...ringStyle }}
      >
        <circle cx="36" cy="36" r="28" fill="none" stroke={stroke} strokeWidth="2" opacity="0.35" />
        <circle cx="36" cy="36" r="20" fill="none" stroke={stroke} strokeWidth="2" opacity="0.7" />
      </svg>
      <style>{`@keyframes exercise-shell-breathe { 0%,100% { transform: scale(0.92); opacity: 0.7 } 50% { transform: scale(1.06); opacity: 1 } }`}</style>
      <span>{label}</span>
    </div>
  )
}

export default BreatheRing
