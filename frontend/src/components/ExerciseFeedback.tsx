/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
  Badge,
  Button,
  Card,
  Spinner,
  Text,
  makeStyles,
} from '@fluentui/react-components'
import { MicOffRegular, MicRegular } from '@fluentui/react-icons'
import type { PronunciationAssessment } from '../types'

const useStyles = makeStyles({
  card: {
    padding: 'var(--space-md)',
    borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-bg-card)',
    boxShadow: 'var(--shadow-sm)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-sm)',
    '@media (max-width: 640px)': {
      padding: 'var(--space-md)',
    },
  },
  title: {
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-primary)',
    fontSize: '0.875rem',
    fontWeight: '600',
  },
  bodyText: {
    color: 'var(--color-text-secondary)',
    lineHeight: 1.5,
    fontSize: '0.8125rem',
  },
  disclaimer: {
    color: 'var(--color-text-tertiary)',
    fontSize: '0.6875rem',
  },
  actionButton: {
    minHeight: '40px',
    borderRadius: 'var(--radius-md)',
    fontFamily: 'var(--font-display)',
    fontWeight: '600',
    fontSize: '0.875rem',
    width: '100%',
  },
  words: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
    gap: 'var(--space-sm)',
    '@media (max-width: 640px)': {
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    },
  },
  wordCard: {
    padding: 'var(--space-sm) var(--space-md)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid transparent',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    minHeight: '68px',
  },
  wordCardSuccess: {
    backgroundColor: 'var(--color-success-soft)',
    border: '1px solid var(--color-success-light)',
  },
  wordCardWarning: {
    backgroundColor: 'var(--color-warning-soft)',
    border: '1px solid var(--color-warning)',
  },
  wordCardDanger: {
    backgroundColor: 'var(--color-error-soft)',
    border: '1px solid var(--color-error-light)',
  },
  wordLabel: {
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-primary)',
    fontSize: '0.875rem',
    fontWeight: '600',
  },
  feedbackRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-sm)',
  },
  emptyState: {
    padding: 'var(--space-md)',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--color-bg-muted)',
    fontSize: '0.8125rem',
  },
  loadingRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-sm)',
    fontSize: '0.8125rem',
  },
})

interface Props {
  referenceText: string
  feedback: PronunciationAssessment | null
  recording: boolean
  loading: boolean
  onToggleRecording: () => void | Promise<void>
}

function getScoreColor(score: number): 'success' | 'warning' | 'danger' {
  if (score >= 80) return 'success'
  if (score >= 60) return 'warning'
  return 'danger'
}

function getWordCardClass(styles: ReturnType<typeof useStyles>, score: number) {
  const scoreColor = getScoreColor(score)

  if (scoreColor === 'success') return `${styles.wordCard} ${styles.wordCardSuccess}`
  if (scoreColor === 'warning') return `${styles.wordCard} ${styles.wordCardWarning}`
  return `${styles.wordCard} ${styles.wordCardDanger}`
}

function getPracticeLabel(score: number) {
  if (score >= 80) return 'Great try'
  if (score >= 60) return 'Let\'s practice again'
  return 'Try this sound with me'
}

export function ExerciseFeedback({
  referenceText,
  feedback,
  recording,
  loading,
  onToggleRecording,
}: Props) {
  const styles = useStyles()
  const canRecord = Boolean(referenceText.trim())

  return (
    <Card className={styles.card}>
      <Text className={styles.title} size={500} weight="semibold">
        Your results
      </Text>
      <Text className={styles.bodyText} size={300}>
        Record one try, then stop to see calm word-by-word feedback right away.
      </Text>
      <Text className={styles.disclaimer}>Practice feedback — not a clinical assessment.</Text>

      <Button
        appearance="primary"
        className={styles.actionButton}
        disabled={!canRecord || loading}
        icon={recording ? <MicOffRegular /> : <MicRegular />}
        onClick={onToggleRecording}
      >
        {recording ? 'Stop and check this try' : 'Record one try'}
      </Button>

      {loading && (
        <div className={styles.loadingRow}>
          <Spinner size="tiny" />
          <Text size={300}>Checking this try...</Text>
        </div>
      )}

      {!canRecord && (
        <div className={styles.emptyState}>
          <Text size={300}>
            Choose an exercise with target words to unlock one-try feedback.
          </Text>
        </div>
      )}

      {feedback?.words?.length ? (
        <div className={styles.words}>
          {feedback.words.map(word => (
            <div
              key={`${word.target_word || word.word}-${word.accuracy}-${word.error_type}`}
              className={getWordCardClass(styles, word.accuracy)}
            >
              <Text className={styles.wordLabel} size={400} weight="semibold">
                {word.target_word || word.word}
              </Text>
              <div className={styles.feedbackRow}>
                <Badge color={getScoreColor(word.accuracy)} appearance="filled">
                  {Math.round(word.accuracy)}%
                </Badge>
                <Text size={200}>{getPracticeLabel(word.accuracy)}</Text>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.emptyState}>
          <Text size={300}>
            Tap the button when you want quick word feedback for this exercise.
          </Text>
        </div>
      )}
    </Card>
  )
}