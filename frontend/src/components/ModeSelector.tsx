/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Card, Text, makeStyles } from '@fluentui/react-components'

const useStyles = makeStyles({
  layout: {
    display: 'grid',
    gap: 'var(--space-lg)',
  },
  hero: {
    padding: 'var(--space-xl)',
    borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--color-border)',
    background:
      'radial-gradient(circle at top right, rgba(13, 138, 132, 0.12), transparent 34%), radial-gradient(circle at bottom left, rgba(212, 143, 75, 0.1), transparent 30%), var(--color-bg-card)',
    boxShadow: 'var(--shadow-lg)',
    display: 'grid',
    gap: 'var(--space-sm)',
  },
  title: {
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-primary)',
    fontSize: 'clamp(1.8rem, 4vw, 2.5rem)',
    fontWeight: '800',
    letterSpacing: '-0.04em',
    lineHeight: 1.05,
  },
  copy: {
    color: 'var(--color-text-secondary)',
    maxWidth: '720px',
    lineHeight: 1.6,
    fontSize: '0.9375rem',
  },
  options: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 'var(--space-lg)',
    '@media (max-width: 900px)': {
      gridTemplateColumns: '1fr',
    },
  },
  card: {
    padding: 'var(--space-xl)',
    borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-bg-card)',
    boxShadow: 'var(--shadow-md)',
    display: 'grid',
    gap: 'var(--space-md)',
  },
  cardTitle: {
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-primary)',
    fontSize: '1.2rem',
    fontWeight: '700',
  },
  cardCopy: {
    color: 'var(--color-text-secondary)',
    lineHeight: 1.6,
    fontSize: '0.875rem',
  },
  checklist: {
    display: 'grid',
    gap: 'var(--space-xs)',
  },
  checklistItem: {
    color: 'var(--color-text-primary)',
    fontSize: '0.875rem',
    lineHeight: 1.5,
  },
  action: {
    minHeight: '46px',
    borderRadius: 'var(--radius-md)',
    fontFamily: 'var(--font-display)',
    fontSize: '0.875rem',
    fontWeight: '600',
  },
})

interface Props {
  selectedChildName?: string | null
  onChooseMode: (mode: 'therapist' | 'child') => void
}

export function ModeSelector({ selectedChildName, onChooseMode }: Props) {
  const styles = useStyles()
  const childLabel = selectedChildName ? ` for ${selectedChildName}` : ''

  return (
    <div className={styles.layout}>
      <Card className={styles.hero}>
        <Text className={styles.title}>Pick the right view for this moment.</Text>
        <Text className={styles.copy}>
          Therapists can stay in the full dashboard. Children can enter a much
          simpler practice screen with fewer decisions and less review-heavy
          language.
        </Text>
      </Card>

      <div className={styles.options}>
        <Card className={styles.card}>
          <Text className={styles.cardTitle}>Therapist dashboard</Text>
          <Text className={styles.cardCopy}>
            Use the full control surface for exercise planning, recent-session
            review, and therapist-led setup.
          </Text>
          <div className={styles.checklist}>
            <Text className={styles.checklistItem}>Session trends and recent history</Text>
            <Text className={styles.checklistItem}>Custom exercise authoring</Text>
            <Text className={styles.checklistItem}>Therapist review and handoff tools</Text>
          </div>
          <Button
            appearance="primary"
            className={styles.action}
            onClick={() => onChooseMode('therapist')}
          >
            Open therapist dashboard
          </Button>
        </Card>

        <Card className={styles.card}>
          <Text className={styles.cardTitle}>Child practice mode</Text>
          <Text className={styles.cardCopy}>
            Open a lighter practice screen{childLabel} with a big avatar, a short
            welcome, and one clear path into practice.
          </Text>
          <div className={styles.checklist}>
            <Text className={styles.checklistItem}>Simple exercise choices</Text>
            <Text className={styles.checklistItem}>No therapist review controls</Text>
            <Text className={styles.checklistItem}>Fast path into the live session</Text>
          </div>
          <Button
            appearance="secondary"
            className={styles.action}
            onClick={() => onChooseMode('child')}
          >
            Open child practice mode
          </Button>
        </Card>
      </div>
    </div>
  )
}