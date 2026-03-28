/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles } from '@fluentui/react-components'
import { AVATAR_OPTIONS } from '../types'

const useStyles = makeStyles({
  wrapper: {
    borderRadius: '50%',
    display: 'grid',
    placeItems: 'center',
    overflow: 'hidden',
    flexShrink: 0,
  },
  fallback: {
    borderRadius: '50%',
    display: 'grid',
    placeItems: 'center',
    background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-light))',
    color: 'var(--color-text-inverse)',
    fontFamily: 'var(--font-display)',
    fontWeight: '800',
    letterSpacing: '-0.04em',
  },
})

interface Props {
  avatarValue: string
  /** Pixel size for width & height */
  size?: number
}

/* -------------------------------------------------------------------------- */
/*  Inline SVG illustrations — one per buddy                                  */
/*  Each is drawn at a 0 0 200 200 viewBox so the caller just sets CSS size.  */
/* -------------------------------------------------------------------------- */

function LisaIllustration() {
  return (
    <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" role="img" aria-labelledby="lisa-title">
      <title id="lisa-title">Lisa avatar</title>
      <defs>
        <linearGradient id="lisa-bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#e8f6f4" />
          <stop offset="100%" stopColor="#cde9e6" />
        </linearGradient>
      </defs>
      <circle cx="100" cy="100" r="100" fill="url(#lisa-bg)" />
      <path d="M40 188 C52 154, 72 138, 100 138 C128 138, 148 154, 160 188 L160 200 L40 200Z" fill="#0d8a84" />
      <path d="M60 74 C60 42, 83 26, 113 29 C138 31, 156 49, 154 82 L146 125 C143 145, 126 160, 106 163 L98 163 C76 160, 58 143, 55 121 Z" fill="#6A4B3C" />
      <path d="M64 84 C66 57, 84 42, 110 43 C129 44, 144 58, 144 82 C139 75, 130 69, 116 66 C103 63, 85 64, 64 84Z" fill="#7b5a49" />
      <ellipse cx="100" cy="104" rx="42" ry="50" fill="#f5d2b3" />
      <path d="M58 101 C58 70, 79 48, 110 48 C129 48, 142 58, 146 79 C135 71, 121 67, 107 66 C90 65, 75 69, 58 101Z" fill="#6A4B3C" />
      <path d="M63 89 C59 101, 58 117, 61 130 C67 122, 70 109, 71 93 Z" fill="#5b3f32" />
      <path d="M137 88 C141 100, 142 116, 139 130 C133 121, 130 108, 129 92 Z" fill="#5b3f32" />
      <ellipse cx="81" cy="104" rx="4.7" ry="6" fill="#2f221d" />
      <ellipse cx="119" cy="104" rx="4.7" ry="6" fill="#2f221d" />
      <circle cx="82.5" cy="102.5" r="1.8" fill="#fff" opacity="0.85" />
      <circle cx="120.5" cy="102.5" r="1.8" fill="#fff" opacity="0.85" />
      <path d="M71 94 Q81 89, 91 93" stroke="#5b3f32" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <path d="M109 93 Q119 89, 129 94" stroke="#5b3f32" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <path d="M100 108 C98 114, 98 119, 100 123 C102 119, 102 114, 100 108Z" fill="#e1b38f" />
      <path d="M85 128 Q100 138, 115 128" stroke="#bf775f" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <circle cx="72" cy="118" r="7" fill="#efb0ac" opacity="0.25" />
      <circle cx="128" cy="118" r="7" fill="#efb0ac" opacity="0.25" />
      <path d="M70 151 Q82 140, 100 140 Q118 140, 130 151 L122 200 L78 200Z" fill="#fff8f0" />
      <path d="M56 170 Q66 149, 100 146 Q134 149, 144 170 L144 200 L56 200Z" fill="#167f79" />
      <path d="M85 146 L100 162 L115 146" stroke="#d6b58e" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <circle cx="66" cy="112" r="3.5" fill="#d9a441" opacity="0.7" />
      <circle cx="134" cy="112" r="3.5" fill="#d9a441" opacity="0.7" />
    </svg>
  )
}

function RiyaIllustration() {
  return (
    <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" role="img" aria-labelledby="riya-title">
      <title id="riya-title">Riya avatar</title>
      {/* background */}
      {/* face */}
      <ellipse cx="100" cy="104" rx="46" ry="50" fill="#E8C49A" />
      {/* hair front — straight bangs */}
      <rect x="56" y="58" width="88" height="26" rx="10" fill="#1A1A2E" />
      {/* hair side left */}
      <path d="M56 70 C44 90, 42 118, 48 140 C52 124, 52 100, 56 70Z" fill="#12122B" />
      {/* hair side right */}
      <path d="M144 70 C156 90, 158 118, 152 140 C148 124, 148 100, 144 70Z" fill="#12122B" />
      {/* eyes */}
      <ellipse cx="80" cy="104" rx="5.5" ry="6.5" fill="#2D1B00" />
      <ellipse cx="120" cy="104" rx="5.5" ry="6.5" fill="#2D1B00" />
      {/* eye highlights */}
      <circle cx="82" cy="101" r="2.2" fill="#FFF" opacity="0.8" />
      <circle cx="122" cy="101" r="2.2" fill="#FFF" opacity="0.8" />
      {/* eyelashes */}
      <path d="M73 98 Q80 94, 87 98" stroke="#2D1B00" strokeWidth="1.8" fill="none" />
      <path d="M113 98 Q120 94, 127 98" stroke="#2D1B00" strokeWidth="1.8" fill="none" />
      {/* nose */}
      <ellipse cx="100" cy="116" rx="3.5" ry="3" fill="#D4A878" />
      {/* smile */}
      <path d="M86 126 Q100 140, 114 126" stroke="#C08060" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      {/* cheeks */}
      <circle cx="72" cy="118" r="7" fill="#E8A0D0" opacity="0.3" />
      <circle cx="128" cy="118" r="7" fill="#E8A0D0" opacity="0.3" />
      {/* bindi / decorative dot */}
      <circle cx="100" cy="88" r="2.5" fill="#A855F7" />
      {/* body */}
      <path d="M56 170 Q60 152, 100 148 Q140 152, 144 170 L144 200 L56 200Z" fill="#A855F7" />
      {/* collar */}
      <path d="M84 150 Q100 158, 116 150" stroke="#9333EA" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  )
}

function SimoneIllustration() {
  return (
    <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" role="img" aria-labelledby="simone-title">
      <title id="simone-title">Simone avatar</title>
      {/* background */}
      <ellipse cx="100" cy="78" rx="66" ry="62" fill="#4A2C1A" />
      <circle cx="56" cy="72" r="18" fill="#4A2C1A" />
      <circle cx="144" cy="72" r="18" fill="#4A2C1A" />
      <circle cx="46" cy="92" r="14" fill="#4A2C1A" />
      <circle cx="154" cy="92" r="14" fill="#4A2C1A" />
      {/* face */}
      <ellipse cx="100" cy="106" rx="44" ry="48" fill="#8D5524" />
      {/* hair top curls */}
      <circle cx="72" cy="56" r="14" fill="#3E1F0E" />
      <circle cx="100" cy="48" r="16" fill="#3E1F0E" />
      <circle cx="128" cy="56" r="14" fill="#3E1F0E" />
      {/* eyes */}
      <ellipse cx="82" cy="104" rx="5" ry="6" fill="#1A0E00" />
      <ellipse cx="118" cy="104" rx="5" ry="6" fill="#1A0E00" />
      {/* eye highlights */}
      <circle cx="84" cy="102" r="2" fill="#FFF" opacity="0.7" />
      <circle cx="120" cy="102" r="2" fill="#FFF" opacity="0.7" />
      {/* eyebrows */}
      <path d="M72 94 Q82 88, 90 93" stroke="#3E1F0E" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <path d="M110 93 Q118 88, 128 94" stroke="#3E1F0E" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      {/* nose */}
      <ellipse cx="100" cy="116" rx="5" ry="3.5" fill="#7A4A20" />
      {/* smile — wide warm grin */}
      <path d="M82 128 Q100 146, 118 128" stroke="#6B3A14" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      {/* cheeks */}
      <circle cx="70" cy="120" r="8" fill="#F97316" opacity="0.2" />
      <circle cx="130" cy="120" r="8" fill="#F97316" opacity="0.2" />
      {/* earrings */}
      <circle cx="56" cy="114" r="4" fill="#F97316" opacity="0.6" />
      <circle cx="144" cy="114" r="4" fill="#F97316" opacity="0.6" />
      {/* body */}
      <path d="M58 172 Q62 154, 100 148 Q138 154, 142 172 L142 200 L58 200Z" fill="#F97316" />
      {/* collar detail */}
      <path d="M86 150 L100 160 L114 150" stroke="#EA580C" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  )
}

const illustrationMap: Record<string, React.FC> = {
  'lisa-casual-sitting': LisaIllustration,
  riya: RiyaIllustration,
  simone: SimoneIllustration,
}

export function BuddyAvatar({ avatarValue, size = 140 }: Props) {
  const styles = useStyles()
  const Illustration = illustrationMap[avatarValue]

  if (!Illustration) {
    const label =
      AVATAR_OPTIONS.find(o => o.value === avatarValue)?.label || 'Buddy'
    const monogram = label.charAt(0).toUpperCase()
    const fontSize = Math.round(size * 0.38)
    return (
      <div
        className={styles.fallback}
        style={{ width: size, height: size, fontSize }}
      >
        {monogram}
      </div>
    )
  }

  return (
    <div className={styles.wrapper} style={{ width: size, height: size }}>
      <Illustration />
    </div>
  )
}
