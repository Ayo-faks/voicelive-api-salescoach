/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
  Dialog,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogActions,
  Button,
  Card,
  CardHeader,
  Text,
  ProgressBar,
  Badge,
  makeStyles,
  tokens,
  TabList,
  Tab,
  Field,
  Textarea,
  mergeClasses,
} from '@fluentui/react-components'
import type { TabValue } from '@fluentui/react-components'
import type { Assessment, TherapistFeedbackRating } from '../types'
import { useState } from 'react'

const articulationMetrics = [
  { key: 'target_sound_accuracy', label: 'Target Sound Accuracy', max: 10 },
  { key: 'overall_clarity', label: 'Overall Clarity', max: 10 },
  { key: 'consistency', label: 'Consistency', max: 10 },
] as const

const engagementMetrics = [
  { key: 'task_completion', label: 'Task Completion', max: 10 },
  { key: 'willingness_to_retry', label: 'Willingness to Retry', max: 10 },
  {
    key: 'self_correction_attempts',
    label: 'Self-Correction Attempts',
    max: 10,
  },
] as const

const useStyles = makeStyles({
  dialogSurface: {
    width: 'min(95vw, 1200px)',
    maxWidth: '1200px',
    maxHeight: '90vh',
    backgroundColor: 'var(--color-bg-card)',
    borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--color-border)',
    boxShadow: 'var(--shadow-lg)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  dialogBody: {
    padding: tokens.spacingVerticalL,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    overflowY: 'auto',
    minHeight: 0,
  },
  headerBar: {
    backgroundColor: 'var(--color-surface-strong)',
    borderRadius: 'var(--radius-md)',
    padding: tokens.spacingVerticalM,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
    border: '1px solid var(--color-border)',
  },
  scoreRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: tokens.spacingHorizontalM,
  },
  scoreValue: {
    fontSize: '40px',
    lineHeight: 1,
    fontWeight: 700,
    fontFamily: 'var(--font-display)',
    letterSpacing: '-0.03em',
  },
  tabs: {},
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: tokens.spacingHorizontalM,
    '@media (max-width: 900px)': {
      gridTemplateColumns: '1fr',
    },
  },
  card: {
    padding: tokens.spacingVerticalM,
    height: 'fit-content',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--color-surface-strong)',
    boxShadow: 'var(--shadow-sm)',
    border: '1px solid var(--color-border)',
  },
  tabContent: {
    minHeight: '360px',
  },
  sectionTitle: {
    marginBottom: tokens.spacingVerticalS,
    paddingBottom: tokens.spacingVerticalXS,
    borderBottom: '1px solid var(--color-border)',
  },
  metric: {
    marginBottom: tokens.spacingVerticalM,
  },
  metricHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: tokens.spacingVerticalXS,
  },
  feedbackCard: {
    padding: tokens.spacingVerticalM,
    borderRadius: 'var(--radius-lg)',
    backgroundColor: 'var(--color-surface-strong)',
    boxShadow: 'var(--shadow-sm)',
    border: '1px solid var(--color-border)',
  },
  feedbackSection: {
    marginBottom: tokens.spacingVerticalL,
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    marginBottom: tokens.spacingVerticalM,
    paddingBottom: tokens.spacingVerticalXS,
    borderBottom: '1px solid var(--color-border)',
  },
  sectionIcon: {
    fontSize: '20px',
  },
  feedbackGrid: {
    display: 'grid',
    gap: tokens.spacingVerticalS,
  },
  feedbackItem: {
    padding: tokens.spacingVerticalM,
    marginBottom: '0',
    backgroundColor: 'rgba(255,255,255,0.84)',
    borderRadius: 'var(--radius-md)',
    borderLeft: '3px solid var(--color-primary)',
    boxShadow: 'var(--shadow-sm)',
    transition: 'box-shadow var(--transition-fast)',
    '&:hover': {
      boxShadow: 'var(--shadow-md)',
    },
  },
  improvementItem: {
    borderLeftColor: 'var(--color-warning)',
    backgroundColor: 'rgba(184, 148, 85, 0.12)',
  },
  strengthItem: {
    borderLeftColor: 'var(--color-success)',
    backgroundColor: 'rgba(13, 138, 132, 0.08)',
  },
  feedbackText: {
    lineHeight: 1.6,
    fontSize: '0.8125rem',
  },
  noContent: {
    textAlign: 'center',
    color: 'var(--color-text-tertiary)',
    fontStyle: 'italic',
    padding: tokens.spacingVerticalM,
    fontSize: '0.8125rem',
  },
  wordGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
    gap: tokens.spacingHorizontalS,
    marginTop: tokens.spacingVerticalS,
  },
  therapistFeedbackCard: {
    padding: tokens.spacingVerticalM,
    display: 'grid',
    gap: tokens.spacingVerticalS,
    borderRadius: 'var(--radius-lg)',
    backgroundColor: 'var(--color-surface-strong)',
    boxShadow: 'var(--shadow-sm)',
    border: '1px solid var(--color-border)',
  },
  notesCard: {
    padding: tokens.spacingVerticalM,
    display: 'grid',
    gap: tokens.spacingVerticalS,
    borderRadius: 'var(--radius-lg)',
    backgroundColor: 'var(--color-surface-strong)',
    boxShadow: 'var(--shadow-sm)',
    border: '1px solid var(--color-border)',
  },
  notesScroll: {
    maxHeight: '260px',
    overflowY: 'auto',
    paddingRight: tokens.spacingHorizontalXS,
    scrollbarGutter: 'stable',
  },
  notesText: {
    display: 'block',
    lineHeight: 1.7,
    fontSize: '0.875rem',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
  },
  feedbackButtons: {
    display: 'flex',
    gap: tokens.spacingHorizontalS,
    flexWrap: 'wrap',
  },
  feedbackMeta: {
    color: 'var(--color-text-tertiary)',
    fontSize: '0.75rem',
  },
  textarea: {
    minHeight: '80px',
  },
  primaryButton: {
    borderRadius: 'var(--radius-md)',
    fontFamily: 'var(--font-display)',
    fontWeight: '600',
    fontSize: '0.875rem',
  },
  secondaryButton: {
    borderRadius: 'var(--radius-md)',
    fontFamily: 'var(--font-display)',
    fontWeight: '600',
    fontSize: '0.875rem',
  },
  dialogActions: {
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalL}`,
    borderTop: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-bg-card)',
  },
  scoreBadge: {
    border: '1px solid var(--color-border-strong)',
    backgroundColor: 'rgba(255,255,255,0.92)',
    color: 'var(--color-text-primary)',
  },
  scoreBadgeTeal: {
    border: '1px solid rgba(13, 138, 132, 0.18)',
    backgroundColor: 'rgba(13, 138, 132, 0.1)',
    color: 'var(--color-primary-dark)',
  },
  scoreBadgeSand: {
    border: '1px solid rgba(184, 148, 85, 0.24)',
    backgroundColor: 'rgba(184, 148, 85, 0.12)',
    color: '#7a6131',
  },
  scoreBadgeInk: {
    border: '1px solid rgba(15, 42, 58, 0.18)',
    backgroundColor: 'rgba(15, 42, 58, 0.08)',
    color: 'var(--color-text-primary)',
  },
})

interface Props {
  open: boolean
  assessment: Assessment | null
  feedbackRating: TherapistFeedbackRating | null
  feedbackNote: string
  feedbackSubmittedAt?: string | null
  feedbackSaving: boolean
  feedbackError?: string | null
  showTherapistControls?: boolean
  onFeedbackRatingChange: (rating: TherapistFeedbackRating) => void
  onFeedbackNoteChange: (note: string) => void
  onSubmitFeedback: () => void
  onClose: () => void
}

function formatFeedbackTimestamp(timestamp?: string | null) {
  if (!timestamp) return null

  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp))
}

export function AssessmentPanel({
  open,
  assessment,
  feedbackRating,
  feedbackNote,
  feedbackSubmittedAt,
  feedbackSaving,
  feedbackError,
  showTherapistControls = true,
  onFeedbackRatingChange,
  onFeedbackNoteChange,
  onSubmitFeedback,
  onClose,
}: Props) {
  const styles = useStyles()
  const [tab, setTab] = useState<TabValue>('overview')

  if (!assessment) return null

  const aiAssessment = assessment.ai_assessment
  const pronunciationAssessment = assessment.pronunciation_assessment

  const getScoreBadgeClass = (score: number) => {
    if (score >= 80) return mergeClasses(styles.scoreBadge, styles.scoreBadgeTeal)
    if (score >= 60) return mergeClasses(styles.scoreBadge, styles.scoreBadgeSand)
    return mergeClasses(styles.scoreBadge, styles.scoreBadgeInk)
  }

  return (
    <Dialog open={open} onOpenChange={(_, data) => !data.open && onClose()}>
      <DialogSurface className={styles.dialogSurface}>
        <DialogTitle>Session Summary</DialogTitle>
        <DialogBody className={styles.dialogBody}>
          <Text size={200}>Practice feedback — not a clinical assessment.</Text>

          {/* Overall Score Section */}
          {aiAssessment && (
            <div className={styles.headerBar}>
              <Text size={600} weight="semibold">
                Overall Result
              </Text>
              <div className={styles.scoreRow}>
                <span className={styles.scoreValue}>
                  {aiAssessment.overall_score}
                </span>
                <Badge
                  appearance="filled"
                  className={getScoreBadgeClass(aiAssessment.overall_score)}
                  size="large"
                >
                  {aiAssessment.overall_score >= 80
                    ? 'Great'
                    : aiAssessment.overall_score >= 60
                      ? 'Good'
                      : 'Needs Work'}
                </Badge>
              </div>
              <ProgressBar value={aiAssessment.overall_score / 100} thickness="large" />
            </div>
          )}

          {/* Tabs Section */}
          <TabList
            className={styles.tabs}
            appearance="subtle"
            size="large"
            selectedValue={tab}
            onTabSelect={(_, data) => setTab(data.value)}
          >
            <Tab value="overview">Overview</Tab>
            <Tab value="recommendations">Next Steps</Tab>
            {showTherapistControls ? <Tab value="notes">Therapist Notes</Tab> : null}
          </TabList>

          {/* Content Section */}
          {tab === 'overview' && (
            <div className={styles.grid}>
              {aiAssessment && (
                <Card className={styles.card}>
                  <CardHeader
                    header={
                      <Text size={500} weight="semibold">
                        Speech Practice Review
                      </Text>
                    }
                  />

                  <div className={styles.sectionTitle}>
                    <Text size={400} weight="semibold">
                      Articulation Clarity (
                      {aiAssessment.articulation_clarity.total}/30)
                    </Text>
                  </div>

                  {articulationMetrics.map(metric => (
                    <div className={styles.metric} key={metric.key}>
                      <div className={styles.metricHeader}>
                        <Text size={300}>{metric.label}</Text>
                        <Badge appearance="tint" className={styles.scoreBadge}>
                          {aiAssessment.articulation_clarity[metric.key]}
                          /{metric.max}
                        </Badge>
                      </div>
                      <ProgressBar
                        value={aiAssessment.articulation_clarity[metric.key] / metric.max}
                      />
                    </div>
                  ))}

                  <div className={styles.sectionTitle}>
                    <Text size={400} weight="semibold">
                      Engagement & Effort (
                      {aiAssessment.engagement_and_effort.total}/30)
                    </Text>
                  </div>

                  {engagementMetrics.map(metric => (
                    <div className={styles.metric} key={metric.key}>
                      <div className={styles.metricHeader}>
                        <Text size={300}>{metric.label}</Text>
                        <Badge appearance="tint" className={styles.scoreBadge}>
                          {aiAssessment.engagement_and_effort[metric.key]}
                          /{metric.max}
                        </Badge>
                      </div>
                      <ProgressBar
                        value={aiAssessment.engagement_and_effort[metric.key] / metric.max}
                      />
                    </div>
                  ))}
                </Card>
              )}

              {pronunciationAssessment && (
                <Card className={styles.card}>
                  <CardHeader
                    header={
                      <Text size={500} weight="semibold">
                        Pronunciation Feedback
                      </Text>
                    }
                  />

                  <div className={styles.metric}>
                    <div className={styles.metricHeader}>
                      <Text size={300}>Accuracy</Text>
                      <Badge appearance="filled" className={getScoreBadgeClass(pronunciationAssessment.accuracy_score)}>
                        {pronunciationAssessment.accuracy_score.toFixed(1)}
                      </Badge>
                    </div>
                    <ProgressBar value={pronunciationAssessment.accuracy_score / 100} />
                  </div>

                  <div className={styles.metric}>
                    <div className={styles.metricHeader}>
                      <Text size={300}>Fluency</Text>
                      <Badge appearance="filled" className={getScoreBadgeClass(pronunciationAssessment.fluency_score)}>
                        {pronunciationAssessment.fluency_score.toFixed(1)}
                      </Badge>
                    </div>
                    <ProgressBar value={pronunciationAssessment.fluency_score / 100} />
                  </div>

                  {pronunciationAssessment.words && (
                    <>
                      <div className={styles.sectionTitle}>
                        <Text size={400} weight="semibold">
                          Word-Level Feedback
                        </Text>
                      </div>
                      <div className={styles.wordGrid}>
                        {pronunciationAssessment.words
                          .slice(0, 12)
                          .map(word => (
                            <Badge
                              key={`${word.word}-${word.accuracy}-${word.error_type}`}
                              appearance="tint"
                              className={getScoreBadgeClass(word.accuracy)}
                              size="small"
                            >
                              {word.word} ({word.accuracy}%)
                            </Badge>
                          ))}
                      </div>
                    </>
                  )}
                </Card>
              )}
            </div>
          )}

          {tab === 'recommendations' && aiAssessment && (
            <Card className={styles.feedbackCard}>
              <CardHeader
                header={
                  <Text size={500} weight="semibold">
                    Highlights and Practice Ideas
                  </Text>
                }
              />

              <div className={styles.feedbackSection}>
                <div className={styles.sectionHeader}>
                  <Text size={500} weight="semibold">
                    Celebration Points
                  </Text>
                </div>
                {aiAssessment.celebration_points.length > 0 ? (
                  <div className={styles.feedbackGrid}>
                    {aiAssessment.celebration_points.map(
                      point => (
                        <div
                          key={point}
                          className={mergeClasses(styles.feedbackItem, styles.strengthItem)}
                        >
                          <Text className={styles.feedbackText}>{point}</Text>
                        </div>
                      )
                    )}
                  </div>
                ) : (
                  <div className={styles.noContent}>
                    <Text>No celebration points available for this session.</Text>
                  </div>
                )}
              </div>

              <div className={styles.feedbackSection}>
                <div className={styles.sectionHeader}>
                  <Text size={500} weight="semibold">
                    Practice Suggestions
                  </Text>
                </div>
                {aiAssessment.practice_suggestions.length > 0 ? (
                  <div className={styles.feedbackGrid}>
                    {aiAssessment.practice_suggestions.map(
                      suggestion => (
                        <div
                          key={suggestion}
                          className={mergeClasses(styles.feedbackItem, styles.improvementItem)}
                        >
                          <Text className={styles.feedbackText}>
                            {suggestion}
                          </Text>
                        </div>
                      )
                    )}
                  </div>
                ) : (
                  <div className={styles.noContent}>
                    <Text>No practice suggestions available.</Text>
                  </div>
                )}
              </div>
            </Card>
          )}

          {showTherapistControls && tab === 'notes' && (
            <Card className={styles.notesCard}>
              <CardHeader
                header={
                  <Text size={500} weight="semibold">
                    Therapist Notes
                  </Text>
                }
              />
              <div className={styles.notesScroll}>
                <Text size={300} className={styles.notesText} block>
                  {aiAssessment?.therapist_notes || 'No therapist notes available.'}
                </Text>
              </div>
            </Card>
          )}

          {showTherapistControls ? (
            <Card className={styles.therapistFeedbackCard}>
              <CardHeader
                header={
                  <Text size={500} weight="semibold">
                    Therapist feedback
                  </Text>
                }
              />

              <div className={styles.feedbackButtons}>
                <Button
                  appearance={feedbackRating === 'up' ? 'primary' : 'secondary'}
                  className={feedbackRating === 'up' ? styles.primaryButton : styles.secondaryButton}
                  onClick={() => onFeedbackRatingChange('up')}
                >
                  Helpful session
                </Button>
                <Button
                  appearance={feedbackRating === 'down' ? 'primary' : 'secondary'}
                  className={feedbackRating === 'down' ? styles.primaryButton : styles.secondaryButton}
                  onClick={() => onFeedbackRatingChange('down')}
                >
                  Needs follow-up
                </Button>
              </div>

              <Field label="Optional therapist note">
                <Textarea
                  className={styles.textarea}
                  placeholder="Add a short note about the session if useful."
                  value={feedbackNote}
                  onChange={(_, data) => onFeedbackNoteChange(data.value)}
                />
              </Field>

              {feedbackError ? <Text>{feedbackError}</Text> : null}
              {feedbackSubmittedAt ? (
                <Text className={styles.feedbackMeta} size={200}>
                  Feedback saved {formatFeedbackTimestamp(feedbackSubmittedAt)}.
                </Text>
              ) : null}

              <div className={styles.feedbackButtons}>
                <Button
                  appearance="primary"
                  className={styles.primaryButton}
                  disabled={!assessment.session_id || !feedbackRating || feedbackSaving}
                  onClick={onSubmitFeedback}
                >
                  {feedbackSaving ? 'Saving…' : 'Save therapist feedback'}
                </Button>
              </div>
            </Card>
          ) : null}
        </DialogBody>
        <DialogActions className={styles.dialogActions}>
          <Button appearance="primary" className={styles.primaryButton} onClick={onClose}>
            Close
          </Button>
        </DialogActions>
      </DialogSurface>
    </Dialog>
  )
}
