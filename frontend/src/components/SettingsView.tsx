/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
  Button,
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
    gap: 'var(--space-lg)',
    padding: 'clamp(1.5rem, 3vw, 2.25rem)',
    border: '1px solid rgba(255, 255, 255, 0.14)',
    background:
      'linear-gradient(145deg, rgba(6, 98, 94, 0.96), rgba(13, 138, 132, 0.92) 58%, rgba(32, 163, 158, 0.9))',
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
    maxWidth: '60ch',
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
    border: '1px solid rgba(255, 255, 255, 0.16)',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  statLabel: {
    color: 'rgba(255, 255, 255, 0.72)',
    fontSize: '0.72rem',
    fontWeight: '700',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
  statValue: {
    color: 'var(--color-text-inverse)',
    fontFamily: 'var(--font-display)',
    fontSize: '1.25rem',
    fontWeight: '800',
    letterSpacing: '-0.03em',
  },
  statCopy: {
    color: 'rgba(255, 255, 255, 0.84)',
    fontSize: '0.78rem',
    lineHeight: 1.45,
  },
  eyebrow: {
    color: 'rgba(255, 255, 255, 0.74)',
    fontSize: '0.72rem',
    fontWeight: '700',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-inverse)',
    fontSize: 'clamp(2rem, 4vw, 2.8rem)',
    fontWeight: '800',
    letterSpacing: '-0.05em',
    lineHeight: 0.98,
  },
  copy: {
    color: 'rgba(255, 255, 255, 0.86)',
    fontSize: '0.95rem',
    lineHeight: 1.65,
    maxWidth: '62ch',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 'var(--space-md)',
    '@media (max-width: 1080px)': {
      gridTemplateColumns: '1fr',
    },
  },
  card: {
    display: 'grid',
    gap: 'var(--space-md)',
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
    paddingTop: 'var(--space-sm)',
    borderTop: '1px solid rgba(15, 42, 58, 0.08)',
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
    gap: 'var(--space-sm)',
    padding: 'var(--space-sm) var(--space-md)',
    border: '1px solid rgba(15, 42, 58, 0.08)',
    backgroundColor: 'rgba(13, 138, 132, 0.04)',
  },
  metricValue: {
    color: 'var(--color-primary-dark)',
    fontFamily: 'var(--font-display)',
    fontWeight: '800',
    letterSpacing: '-0.02em',
  },
  actions: {
    display: 'grid',
    gap: 'var(--space-sm)',
  },
  actionButton: {
    justifyContent: 'flex-start',
    minHeight: '44px',
    fontFamily: 'var(--font-display)',
    fontWeight: '700',
  },
})

interface SettingsViewProps {
  isTherapist: boolean
  currentMode: 'therapist' | 'child' | null
  authRole?: string | null
  selectedChild: ChildProfile | null
  onGoHome: () => void
  onOpenDashboard: () => void
  onReturnToEntry: () => void
}

export function SettingsView({
  isTherapist,
  currentMode,
  authRole,
  selectedChild,
  onGoHome,
  onOpenDashboard,
  onReturnToEntry,
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
              Audit the current operating context, move between core surfaces, and keep the workspace aligned with the therapist flow.
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
          <div className={styles.stack}>
            <Text className={styles.label}>Account role</Text>
            <Text className={styles.value}>{roleLabel}</Text>
          </div>
          <div className={styles.stack}>
            <Text className={styles.label}>Mode</Text>
            <Text className={styles.value}>{modeLabel}</Text>
          </div>
          <div className={styles.stack}>
            <Text className={styles.label}>Active child</Text>
            <Text className={styles.value}>{childLabel}</Text>
          </div>
          <div className={styles.metricRow}>
            <Text className={styles.label}>Workspace status</Text>
            <Text className={styles.metricValue}>{toolAccessLabel}</Text>
          </div>
        </Card>

        <Card className={styles.card}>
          <Text className={styles.cardTitle}>Navigation</Text>
          <div className={styles.actions}>
            <Button appearance="primary" className={styles.actionButton} onClick={onGoHome}>
              Return to home
            </Button>
            {isTherapist ? (
              <Button appearance="secondary" className={styles.actionButton} onClick={onOpenDashboard}>
                Open dashboard
              </Button>
            ) : null}
            <Button appearance="subtle" className={styles.actionButton} onClick={onReturnToEntry}>
              Switch profile
            </Button>
          </div>
        </Card>

        <Card className={styles.card}>
          <Text className={styles.cardTitle}>Operational guardrails</Text>
          <div className={styles.stack}>
            <Text className={styles.label}>Navigation model</Text>
            <Text className={styles.value}>State-driven transitions with no route changes.</Text>
          </div>
          <div className={styles.stack}>
            <Text className={styles.label}>Therapist workflow</Text>
            <Text className={styles.value}>
              Review tools and planning stay in the same supervised workspace, without exposing internal system diagnostics.
            </Text>
          </div>
          <div className={styles.stack}>
            <Text className={styles.label}>Contrast and controls</Text>
            <Text className={styles.value}>
              Primary actions stay teal-led, secondary actions stay quieter, and context stays visible before navigation changes.
            </Text>
          </div>
        </Card>
      </div>
    </div>
  )
}