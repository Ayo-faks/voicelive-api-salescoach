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
      'radial-gradient(circle at top right, rgba(13, 138, 132, 0.12), transparent 34%), radial-gradient(circle at bottom left, rgba(13, 138, 132, 0.08), transparent 30%), var(--color-bg-card)',
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
  action: {
    minHeight: '46px',
    paddingInline: 'var(--space-lg)',
    borderRadius: 'var(--radius-md)',
    fontFamily: 'var(--font-display)',
    fontSize: '0.875rem',
    fontWeight: '600',
    justifySelf: 'start',
  },
})

interface Props {
  isTherapist: boolean
  selectedChildName?: string | null
  onChooseMode: (mode: 'therapist' | 'child') => void
}

export function ModeSelector({ isTherapist, selectedChildName, onChooseMode }: Props) {
  const styles = useStyles()
  const childLabel = selectedChildName ? ` for ${selectedChildName}` : ''

  return (
    <div className={styles.layout}>
      <Card className={styles.hero}>
        <Text className={styles.title}>Choose a profile to continue.</Text>
      </Card>

      <div className={styles.options}>
        <Card className={styles.card}>
          <Text className={styles.cardTitle}>Therapist dashboard</Text>
          <Text className={styles.cardCopy}>
            {isTherapist
              ? 'Open child setup, therapist-authored exercises, and saved session review.'
              : 'This area is available only to therapist accounts.'}
          </Text>
          <Button
            appearance="primary"
            className={styles.action}
            disabled={!isTherapist}
            onClick={() => onChooseMode('therapist')}
          >
            Open therapist dashboard
          </Button>
        </Card>

        <Card className={styles.card}>
          <Text className={styles.cardTitle}>Child practice mode</Text>
          <Text className={styles.cardCopy}>
            Start the voice session directly{childLabel} and hand over the device when you are ready.
          </Text>
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