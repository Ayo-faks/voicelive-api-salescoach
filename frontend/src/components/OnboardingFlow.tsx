/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
  Button,
  Card,
  Field,
  Input,
  Spinner,
  Text,
  makeStyles,
} from '@fluentui/react-components'

const useStyles = makeStyles({
  layout: {
    display: 'grid',
    gridTemplateColumns: '1fr minmax(300px, 400px)',
    gap: 'var(--space-xl)',
    alignItems: 'start',
    '@media (max-width: 960px)': {
      gridTemplateColumns: '1fr',
    },
  },
  heroCard: {
    padding: 'var(--space-lg)',
    borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--color-border)',
    background:
      'radial-gradient(circle at right center, rgba(13, 138, 132, 0.08), transparent 34%), var(--color-bg-card)',
    boxShadow: 'var(--shadow-lg)',
    display: 'grid',
    gap: 'var(--space-lg)',
  },
  sideCard: {
    padding: 'var(--space-lg)',
    borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-bg-card)',
    boxShadow: 'var(--shadow-md)',
    display: 'grid',
    gap: 'var(--space-md)',
  },
  title: {
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-primary)',
    fontSize: 'clamp(1.35rem, 2.5vw, 1.75rem)',
    lineHeight: 1.2,
    letterSpacing: '-0.02em',
    fontWeight: '700',
  },
  body: {
    color: 'var(--color-text-secondary)',
    lineHeight: 1.6,
    fontSize: '0.875rem',
  },
  checklist: {
    display: 'grid',
    gap: 'var(--space-sm)',
  },
  checklistItem: {
    padding: 'var(--space-md)',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--color-bg-muted)',
    display: 'grid',
    gap: '2px',
  },
  checklistTitle: {
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-primary)',
    fontSize: '0.875rem',
    fontWeight: '600',
  },
  pinField: {
    display: 'grid',
    gap: 'var(--space-sm)',
  },
  statusCard: {
    padding: 'var(--space-md)',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--color-primary-soft)',
    border: '1px solid rgba(13, 138, 132, 0.2)',
  },
  actionRow: {
    display: 'flex',
    gap: 'var(--space-sm)',
    flexWrap: 'wrap',
  },
  button: {
    minHeight: '40px',
    borderRadius: 'var(--radius-md)',
    fontFamily: 'var(--font-display)',
    fontWeight: '600',
    fontSize: '0.875rem',
    border: '1px solid var(--color-border)',
  },
})

interface Props {
  loading: boolean
  therapistPinConfigured: boolean
  therapistUnlocked: boolean
  pinValue: string
  pinError: string | null
  validatingPin: boolean
  onPinChange: (value: string) => void
  onConfirmPin: () => void
  onContinue: () => void
}

export function OnboardingFlow({
  loading,
  therapistPinConfigured,
  therapistUnlocked,
  pinValue,
  pinError,
  validatingPin,
  onPinChange,
  onConfirmPin,
  onContinue,
}: Props) {
  const styles = useStyles()

  if (loading) {
    return (
      <Card className={styles.sideCard}>
        <Spinner size="large" />
        <Text>Loading therapist setup...</Text>
      </Card>
    )
  }

  return (
    <div className={styles.layout}>
      <Card className={styles.heroCard}>
        <Text className={styles.title}>
          Set up a calm, supervised practice flow before you hand over the device.
        </Text>
        <Text className={styles.body} size={300}>
          SpeakBright supports short speech practice sessions for children while a therapist stays nearby. It offers practice feedback for the session, not diagnosis.
        </Text>

        <div className={styles.checklist}>
          <div className={styles.checklistItem}>
            <Text className={styles.checklistTitle} size={400} weight="semibold">
              1. Confirm therapist access
            </Text>
            <Text className={styles.body} size={300}>
              Use the therapist PIN so review tools and pilot consent stay in therapist hands.
            </Text>
          </div>
          <div className={styles.checklistItem}>
            <Text className={styles.checklistTitle} size={400} weight="semibold">
              2. Choose the child and exercise
            </Text>
            <Text className={styles.body} size={300}>
              Pick the child profile, choose the exercise, then start the session when you are ready.
            </Text>
          </div>
          <div className={styles.checklistItem}>
            <Text className={styles.checklistTitle} size={400} weight="semibold">
              3. Hand the device to the child
            </Text>
            <Text className={styles.body} size={300}>
              Stay nearby, guide the child as needed, and review the results afterward.
            </Text>
          </div>
        </div>
      </Card>

      <Card className={styles.sideCard}>
        <Text className={styles.checklistTitle} size={500} weight="semibold">
          Before the first child session
        </Text>
        <Text className={styles.body} size={300}>
          Keep this short. Confirm therapist access once for this browser session, then continue to child setup.
        </Text>

        {therapistPinConfigured ? (
          therapistUnlocked ? (
            <div className={styles.statusCard}>
              <Text size={300} weight="semibold">
                Therapist PIN confirmed for this browser session.
              </Text>
            </div>
          ) : (
            <Field
              className={styles.pinField}
              label="Therapist PIN"
              validationMessage={pinError || undefined}
            >
              <Input
                type="password"
                placeholder="Enter PIN"
                value={pinValue}
                onChange={(_, data) => onPinChange(data.value)}
              />
            </Field>
          )
        ) : (
          <div className={styles.statusCard}>
            <Text size={300}>Therapist access is available without an additional local PIN.</Text>
          </div>
        )}

        <div className={styles.actionRow}>
          {therapistPinConfigured && !therapistUnlocked ? (
            <Button
              appearance="secondary"
              className={styles.button}
              disabled={validatingPin}
              onClick={onConfirmPin}
            >
              {validatingPin ? 'Checking…' : 'Confirm therapist PIN'}
            </Button>
          ) : null}
          <Button appearance="primary" className={styles.button} onClick={onContinue}>
            Continue to child setup
          </Button>
        </div>
      </Card>
    </div>
  )
}