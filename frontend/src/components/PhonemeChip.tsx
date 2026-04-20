/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, mergeClasses } from '@fluentui/react-components'

// PR8 — dedicated phoneme chip. Renders `/k/` style notation with mono font,
// teal accent ring, and guaranteed consistent sizing regardless of host card.
// Callers pass the raw phoneme (e.g. 'k', 'th', 'SH'); slashes and casing are
// applied here so stray variations can't leak into the UI.

const useStyles = makeStyles({
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    minHeight: '26px',
    paddingInline: 'var(--space-sm)',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--color-primary-soft)',
    backgroundColor: 'var(--color-primary-softer)',
    color: 'var(--color-primary-dark)',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.78rem',
    fontWeight: '600',
    letterSpacing: '0.02em',
    lineHeight: 1,
  },
  label: {
    fontFamily: 'var(--font-display)',
    fontWeight: '500',
    color: 'var(--color-text-tertiary)',
    textTransform: 'uppercase',
    fontSize: '0.68rem',
    letterSpacing: '0.08em',
  },
})

interface PhonemeChipProps {
  /** Raw phoneme, e.g. 'k', 'th', 'SH'. Rendered as /k/, /th/, /sh/. */
  phoneme: string
  /** Optional eyebrow label (e.g. "Sound"). Hidden when omitted. */
  label?: string
  className?: string
}

export function PhonemeChip({ phoneme, label, className }: PhonemeChipProps) {
  const styles = useStyles()
  const normalized = (phoneme ?? '').trim().toLowerCase()
  if (!normalized) return null

  return (
    <span className={mergeClasses(styles.chip, className)} aria-label={label ? `${label} ${normalized}` : `phoneme ${normalized}`}>
      {label ? <span className={styles.label}>{label}</span> : null}
      <span>/{normalized}/</span>
    </span>
  )
}
