/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, mergeClasses } from '@fluentui/react-components'
import { useEffect, useState } from 'react'

/* -------------------------------------------------------------------------- */
/*  Styles & keyframes                                                        */
/* -------------------------------------------------------------------------- */

const useStyles = makeStyles({
  wrap: {
    display: 'inline-block',
    lineHeight: 0,
  },
  /* Drop-in entrance */
  dropIn: {
    animationName: {
      '0%': { transform: 'translateY(-80px) scale(0.8)', opacity: 0 },
      '55%': { transform: 'translateY(8px) scale(1.04)', opacity: 1 },
      '75%': { transform: 'translateY(-4px) scale(0.98)' },
      '100%': { transform: 'translateY(0) scale(1)' },
    },
    animationDuration: '0.8s',
    animationTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    animationFillMode: 'forwards',
  },
  /* Gentle idle hover after landing */
  idle: {
    animationName: {
      '0%, 100%': { transform: 'translateY(0)' },
      '50%': { transform: 'translateY(-6px)' },
    },
    animationDuration: '3s',
    animationTimingFunction: 'ease-in-out',
    animationIterationCount: 'infinite',
  },
  '@media (prefers-reduced-motion: reduce)': {
    dropIn: { animationDuration: '0.01s' },
    idle: { animationDuration: '0.01s' },
  },
})

interface Props {
  size?: number
  /** Show the wink animation cycle */
  wink?: boolean
}

/**
 * A friendly 3D-ish robot mascot drawn in SVG.
 * Drops in from above then gently bobs. Optionally winks.
 */
export function WuloRobot({ size = 220, wink = true }: Props) {
  const styles = useStyles()
  const [landed, setLanded] = useState(false)
  const [winking, setWinking] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setLanded(true), 850)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (!wink || !landed) return

    // First wink shortly after landing, then every few seconds
    const first = setTimeout(() => {
      setWinking(true)
      setTimeout(() => setWinking(false), 320)
    }, 600)

    const interval = setInterval(() => {
      setWinking(true)
      setTimeout(() => setWinking(false), 320)
    }, 4000)

    return () => {
      clearTimeout(first)
      clearInterval(interval)
    }
  }, [landed, wink])

  return (
    <div
      className={mergeClasses(
        styles.wrap,
        styles.dropIn,
        landed && styles.idle
      )}
    >
      <svg
        viewBox="0 0 200 220"
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size * (220 / 200)}
        role="img"
        aria-label="Wulo robot mascot"
      >
        <defs>
          {/* Body gradient — 3D-ish teal sphere */}
          <radialGradient id="wr-body" cx="45%" cy="38%" r="55%">
            <stop offset="0%" stopColor="#4eeae0" />
            <stop offset="55%" stopColor="#0d8a84" />
            <stop offset="100%" stopColor="#065550" />
          </radialGradient>
          {/* Head highlight */}
          <radialGradient id="wr-head" cx="42%" cy="35%" r="52%">
            <stop offset="0%" stopColor="#5cf5ea" />
            <stop offset="50%" stopColor="#14a89f" />
            <stop offset="100%" stopColor="#0a706a" />
          </radialGradient>
          {/* Eye screen glow */}
          <radialGradient id="wr-screen" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#e0fffe" />
            <stop offset="100%" stopColor="#b2f5f0" />
          </radialGradient>
          {/* Shadow beneath */}
          <radialGradient id="wr-shadow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(0,0,0,0.18)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0)" />
          </radialGradient>
        </defs>

        {/* Ground shadow */}
        <ellipse cx="100" cy="214" rx="52" ry="6" fill="url(#wr-shadow)" />

        {/* Antenna */}
        <line x1="100" y1="18" x2="100" y2="38" stroke="#0d8a84" strokeWidth="4" strokeLinecap="round" />
        <circle cx="100" cy="14" r="7" fill="#ffca28" />
        <circle cx="100" cy="12" r="3" fill="#fff8e1" opacity="0.7" />

        {/* Head */}
        <rect x="46" y="38" width="108" height="80" rx="26" fill="url(#wr-head)" />
        {/* Visor / eye area */}
        <rect x="58" y="54" width="84" height="46" rx="18" fill="url(#wr-screen)" />

        {/* Left eye */}
        <ellipse cx="82" cy="77" rx="12" ry={winking ? 1.5 : 13} fill="#1a2744">
          <animate attributeName="ry" dur="0.15s" fill="freeze"
            from={winking ? '13' : '13'} to={winking ? '1.5' : '13'} />
        </ellipse>
        {!winking && (
          <>
            <circle cx="86" cy="72" r="4" fill="#fff" opacity="0.85" />
            <circle cx="79" cy="81" r="2" fill="#fff" opacity="0.4" />
          </>
        )}

        {/* Right eye */}
        <ellipse cx="118" cy="77" rx="12" ry="13" fill="#1a2744" />
        <circle cx="122" cy="72" r="4" fill="#fff" opacity="0.85" />
        <circle cx="115" cy="81" r="2" fill="#fff" opacity="0.4" />

        {/* Smile */}
        <path d="M82 92 Q100 106, 118 92" stroke="#065550" strokeWidth="3" fill="none" strokeLinecap="round" />

        {/* Cheek blush */}
        <circle cx="64" cy="88" r="8" fill="#ff8a80" opacity="0.25" />
        <circle cx="136" cy="88" r="8" fill="#ff8a80" opacity="0.25" />

        {/* Body */}
        <rect x="56" y="122" width="88" height="64" rx="22" fill="url(#wr-body)" />
        {/* Chest circle / speaker */}
        <circle cx="100" cy="150" r="14" fill="#065550" opacity="0.4" />
        <circle cx="100" cy="150" r="9" fill="#4eeae0" opacity="0.6" />
        <circle cx="100" cy="150" r="4" fill="#e0fffe" opacity="0.8" />

        {/* Left arm */}
        <rect x="32" y="132" width="24" height="40" rx="12" fill="#0a706a" />
        <circle cx="44" cy="176" r="10" fill="#0d8a84" />
        <circle cx="44" cy="176" r="5" fill="#14a89f" />

        {/* Right arm */}
        <rect x="144" y="132" width="24" height="40" rx="12" fill="#0a706a" />
        <circle cx="156" cy="176" r="10" fill="#0d8a84" />
        <circle cx="156" cy="176" r="5" fill="#14a89f" />

        {/* Left leg */}
        <rect x="72" y="184" width="18" height="22" rx="9" fill="#0a706a" />
        <ellipse cx="81" cy="208" rx="14" ry="8" fill="#065550" />

        {/* Right leg */}
        <rect x="110" y="184" width="18" height="22" rx="9" fill="#0a706a" />
        <ellipse cx="119" cy="208" rx="14" ry="8" fill="#065550" />

        {/* Head shine / 3D highlight */}
        <ellipse cx="82" cy="48" rx="28" ry="6" fill="#fff" opacity="0.18" />
        {/* Body shine */}
        <ellipse cx="86" cy="130" rx="20" ry="5" fill="#fff" opacity="0.15" />
      </svg>
    </div>
  )
}
