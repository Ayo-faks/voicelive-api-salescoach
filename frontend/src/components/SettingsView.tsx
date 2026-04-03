/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
  Card,
  Text,
  makeStyles,
} from '@fluentui/react-components'
import type { ChildProfile } from '../types'

const useStyles = makeStyles({
  layout: {
    display: 'grid',
    gap: 'var(--space-lg)',
  },
  hero: {
    display: 'grid',
    gap: 'var(--space-md)',
    padding: 'clamp(1.35rem, 3vw, 2rem)',
    border: '1px solid rgba(13, 138, 132, 0.12)',
    background:
      'radial-gradient(circle at top right, rgba(32, 163, 158, 0.18), transparent 34%), linear-gradient(135deg, rgba(235, 247, 246, 0.98), rgba(224, 241, 239, 0.98))',
  },
  heroTop: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 'var(--space-lg)',
    alignItems: 'flex-end',
    flexWrap: 'wrap',
  },
  heroCopy: {
    display: 'grid',
    gap: '6px',
    maxWidth: '54ch',
  },
  heroStats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 'var(--space-sm)',
    minWidth: 'min(100%, 420px)',
    '@media (max-width: 760px)': {
      gridTemplateColumns: '1fr',
      minWidth: '100%',
    },
  },
  statCard: {
    display: 'grid',
    gap: '4px',
    padding: 'var(--space-md)',
    border: '1px solid rgba(13, 138, 132, 0.12)',
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
  },
  statLabel: {
    color: 'var(--color-text-tertiary)',
    fontSize: '0.72rem',
    fontWeight: '700',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
  statValue: {
    color: 'var(--color-primary-light)',
    fontFamily: 'var(--font-display)',
    fontSize: '1.25rem',
    fontWeight: '800',
    letterSpacing: '-0.03em',
  },
  statCopy: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.78rem',
    lineHeight: 1.45,
  },
  eyebrow: {
    color: 'var(--color-primary-light)',
    fontSize: '0.72rem',
    fontWeight: '700',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-primary)',
    fontSize: 'clamp(1.8rem, 4vw, 2.5rem)',
    fontWeight: '800',
    letterSpacing: '-0.05em',
    lineHeight: 1.02,
  },
  copy: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.92rem',
    lineHeight: 1.55,
    maxWidth: '56ch',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
  },
  card: {
    display: 'grid',
    gap: 'var(--space-lg)',
    padding: 'var(--space-lg)',
    border: '1px solid rgba(15, 42, 58, 0.12)',
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
  },
  cardTitle: {
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-primary)',
    fontSize: '1.05rem',
    fontWeight: '700',
    letterSpacing: '-0.02em',
  },
  stack: {
    display: 'grid',
    gap: '6px',
  },
  contextGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 'var(--space-md)',
    '@media (max-width: 900px)': {
      gridTemplateColumns: '1fr',
    },
  },
  contextBlock: {
    display: 'grid',
    gap: '6px',
    padding: 'var(--space-md)',
    border: '1px solid rgba(15, 42, 58, 0.08)',
    backgroundColor: 'rgba(248, 252, 251, 0.92)',
  },
  label: {
    color: 'var(--color-text-tertiary)',
    fontSize: '0.75rem',
    fontWeight: '700',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  },
  value: {
    color: 'var(--color-text-primary)',
    fontSize: '0.92rem',
    lineHeight: 1.5,
  },
  metricRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-md)',
    padding: 'var(--space-md)',
    border: '1px solid rgba(13, 138, 132, 0.12)',
    backgroundColor: 'rgba(32, 163, 158, 0.08)',
    '@media (max-width: 720px)': {
      alignItems: 'flex-start',
      flexDirection: 'column',
    },
  },
  metricValue: {
    color: 'var(--color-primary-light)',
    fontFamily: 'var(--font-display)',
    fontWeight: '800',
    letterSpacing: '-0.02em',
  },
  supportCopy: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.9rem',
    lineHeight: 1.55,
  },
})

interface SettingsViewProps {
  isTherapist: boolean
  currentMode: 'therapist' | 'child' | null
  authRole?: string | null
  selectedChild: ChildProfile | null
}

export function SettingsView({
  isTherapist,
  currentMode,
  authRole,
  selectedChild,
}: SettingsViewProps) {
  const styles = useStyles()
  const roleLabel = authRole || 'Unknown role'
  const modeLabel = currentMode || 'No mode selected'
  const childLabel = selectedChild?.name || 'No child selected'
  const toolAccessLabel = isTherapist ? 'Dashboard and planner tools ready' : 'Child-safe practice context'

  return (
    <div className={styles.layout}>
      <Card className={styles.hero}>
        <div className={styles.heroTop}>
          <div className={styles.heroCopy}>
            <Text className={styles.eyebrow}>Workspace controls</Text>
            <Text className={styles.title}>Settings for the active review environment.</Text>
            <Text className={styles.copy}>
              Review the current workspace context without extra navigation chrome. The primary controls already live in the main shell, so this page can stay focused on who is active and what environment is in use.
            </Text>
          </div>

          <div className={styles.heroStats}>
            <div className={styles.statCard}>
              <Text className={styles.statLabel}>Role</Text>
              <Text className={styles.statValue}>{roleLabel}</Text>
              <Text className={styles.statCopy}>Authenticated workspace identity.</Text>
            </div>
            <div className={styles.statCard}>
              <Text className={styles.statLabel}>Mode</Text>
              <Text className={styles.statValue}>{modeLabel}</Text>
              <Text className={styles.statCopy}>Current app state branch in use.</Text>
            </div>
            <div className={styles.statCard}>
              <Text className={styles.statLabel}>Active child</Text>
              <Text className={styles.statValue}>{childLabel}</Text>
              <Text className={styles.statCopy}>Context applied across therapist tools.</Text>
            </div>
          </div>
        </div>
      </Card>

      <div className={styles.grid}>
        <Card className={styles.card}>
          <Text className={styles.cardTitle}>Current context</Text>
          <div className={styles.contextGrid}>
            <div className={styles.contextBlock}>
              <Text className={styles.label}>Account role</Text>
              <Text className={styles.value}>{roleLabel}</Text>
            </div>
            <div className={styles.contextBlock}>
              <Text className={styles.label}>Mode</Text>
              <Text className={styles.value}>{modeLabel}</Text>
            </div>
            <div className={styles.contextBlock}>
              <Text className={styles.label}>Active child</Text>
              <Text className={styles.value}>{childLabel}</Text>
            </div>
          </div>
          <div className={styles.metricRow}>
            <Text className={styles.label}>Workspace status</Text>
            <Text className={styles.metricValue}>{toolAccessLabel}</Text>
          </div>
          <Text className={styles.supportCopy}>
            This view now stays intentionally quiet. Navigation already exists in the surrounding shell, so the settings surface only carries environment context and status.
          </Text>
        </Card>
      </div>
    </div>
  )
}