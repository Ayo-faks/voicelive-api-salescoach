/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
  Badge,
  Card,
  Spinner,
  Text,
  makeStyles,
} from '@fluentui/react-components'
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
  loading: boolean
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
  if (score >= 60) return 'Almost there'
  return 'Try this sound with me'
}

function getEncouragementLabel(score: number) {
  if (score >= 80) return 'Nice!'
  if (score >= 60) return 'Almost!'
  return 'Try again'
}

export function ExerciseFeedback({
  referenceText,
  feedback,
  loading,
}: Props) {
  const styles = useStyles()
  const canScore = Boolean(referenceText.trim())

  return (
    <Card className={styles.card}>
      <Text className={styles.title} size={500} weight="semibold">
        Word feedback
      </Text>
      <Text className={styles.bodyText} size={300}>
        Word-by-word feedback for your last practice turn appears here when this exercise has target words.
      </Text>
      <Text className={styles.disclaimer}>Practice feedback — not a clinical assessment.</Text>

      {loading && (
        <div className={styles.loadingRow}>
          <Spinner size="tiny" />
          <Text size={300}>Checking your try...</Text>
        </div>
      )}

      {!canScore && (
        <div className={styles.emptyState}>
          <Text size={300}>
            This activity is in conversation mode, so practice feedback stays hidden until there are target words.
          </Text>
        </div>
      )}

      {canScore && feedback?.words?.length ? (
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
                  {getEncouragementLabel(word.accuracy)}
                </Badge>
                <Text size={200}>{getPracticeLabel(word.accuracy)}</Text>
              </div>
            </div>
          ))}
        </div>
      ) : canScore && !loading ? (
        <div className={styles.emptyState}>
          <Text size={300}>
            Say the target words, then stop talking to see quick feedback here.
          </Text>
        </div>
      ) : null}
    </Card>
  )
}