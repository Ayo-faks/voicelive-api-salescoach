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
    gap: 'var(--space-md)',
    padding: 'clamp(1.5rem, 3vw, 2.25rem)',
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-surface-strong)',
  },
  eyebrow: {
    color: 'var(--color-text-tertiary)',
    fontSize: '0.75rem',
    fontWeight: '700',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-primary)',
    fontSize: 'clamp(2rem, 4vw, 2.8rem)',
    fontWeight: '800',
    letterSpacing: '-0.05em',
    lineHeight: 0.98,
  },
  copy: {
    color: 'var(--color-text-secondary)',
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
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-bg-card)',
  },
  cardTitle: {
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-primary)',
    fontSize: '1rem',
    fontWeight: '700',
    letterSpacing: '-0.02em',
  },
  stack: {
    display: 'grid',
    gap: 'var(--space-xs)',
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
  actions: {
    display: 'grid',
    gap: 'var(--space-sm)',
  },
  actionButton: {
    justifyContent: 'flex-start',
    minHeight: '42px',
    fontFamily: 'var(--font-display)',
    fontWeight: '600',
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

  return (
    <div className={styles.layout}>
      <Card className={styles.hero}>
        <Text className={styles.eyebrow}>Workspace settings</Text>
        <Text className={styles.title}>Keep the practice workspace aligned.</Text>
        <Text className={styles.copy}>
          Use this area to review the active profile context, switch back to the entry flow,
          or jump into therapist review tools without changing the app architecture.
        </Text>
      </Card>

      <div className={styles.grid}>
        <Card className={styles.card}>
          <Text className={styles.cardTitle}>Current context</Text>
          <div className={styles.stack}>
            <Text className={styles.label}>Account role</Text>
            <Text className={styles.value}>{authRole || 'Unknown role'}</Text>
          </div>
          <div className={styles.stack}>
            <Text className={styles.label}>Mode</Text>
            <Text className={styles.value}>{currentMode || 'No mode selected'}</Text>
          </div>
          <div className={styles.stack}>
            <Text className={styles.label}>Active child</Text>
            <Text className={styles.value}>{selectedChild?.name || 'No child selected'}</Text>
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
          <Text className={styles.cardTitle}>Session guardrails</Text>
          <div className={styles.stack}>
            <Text className={styles.label}>Navigation model</Text>
            <Text className={styles.value}>State-based navigation without route changes.</Text>
          </div>
          <div className={styles.stack}>
            <Text className={styles.label}>Therapist tools</Text>
            <Text className={styles.value}>
              Planner workflows stay available from dashboard review, without exposing internal readiness diagnostics.
            </Text>
          </div>
        </Card>
      </div>
    </div>
  )
}