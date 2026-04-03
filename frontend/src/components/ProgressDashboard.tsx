/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
  Badge,
  Button,
  Card,
  CardHeader,
  mergeClasses,
  ProgressBar,
  Spinner,
  Text,
  makeStyles,
} from '@fluentui/react-components'
import { useState } from 'react'
import type { ChildProfile, PlannerReadiness, PracticePlan, SessionDetail, SessionSummary } from '../types'

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
  shell: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-lg)',
    width: '100%',
  },
  summaryStrip: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: 'var(--space-md)',
    '@media (max-width: 1080px)': {
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    },
    '@media (max-width: 640px)': {
      gridTemplateColumns: '1fr',
    },
  },
  summaryCard: {
    padding: 'var(--space-md)',
    borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--color-border)',
    background:
      'linear-gradient(135deg, rgba(233, 245, 246, 0.96), rgba(224, 239, 241, 0.96))',
    boxShadow: 'var(--shadow-md)',
    display: 'grid',
    gap: '4px',
  },
  summaryLabel: {
    color: 'var(--color-text-tertiary)',
    fontSize: '0.72rem',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    fontWeight: '600',
  },
  summaryValue: {
    color: 'var(--color-text-primary)',
    fontFamily: 'var(--font-display)',
    fontSize: '1.6rem',
    fontWeight: '800',
    lineHeight: 1,
    letterSpacing: '-0.03em',
  },
  summaryCopy: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.78rem',
    lineHeight: 1.5,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-md)',
    flexWrap: 'wrap',
    paddingBottom: 'var(--space-md)',
    borderBottom: '1px solid var(--color-border)',
  },
  headerCopy: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  title: {
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-primary)',
    fontSize: '1.25rem',
    fontWeight: '700',
    letterSpacing: '-0.02em',
  },
  subtitle: {
    color: 'var(--color-text-secondary)',
    maxWidth: '600px',
    lineHeight: 1.5,
    fontSize: '0.8125rem',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '220px minmax(260px, 0.8fr) minmax(360px, 1.2fr)',
    gap: 'var(--space-md)',
    alignItems: 'start',
    '@media (max-width: 1200px)': {
      gridTemplateColumns: '1fr',
    },
  },
  card: {
    padding: 'var(--space-md)',
    borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-bg-card)',
    boxShadow: 'var(--shadow-md)',
  },
  backButton: {
    minWidth: '140px',
    borderRadius: '4px',
    fontFamily: 'var(--font-display)',
    fontWeight: '600',
    minHeight: '36px',
    fontSize: '0.8125rem',
    border: '1px solid var(--color-border)',
  },
  headerActions: {
    display: 'flex',
    gap: 'var(--space-sm)',
    flexWrap: 'wrap',
  },
  exitButton: {
    minWidth: '140px',
    borderRadius: '4px',
    fontFamily: 'var(--font-display)',
    fontWeight: '600',
    minHeight: '36px',
    fontSize: '0.8125rem',
    color: 'var(--color-text-secondary)',
  },
  columnTitle: {
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-primary)',
    fontSize: '0.875rem',
    fontWeight: '600',
  },
  helperText: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.8125rem',
  },
  list: {
    display: 'grid',
    gap: '4px',
    marginTop: 'var(--space-md)',
  },
  listButton: {
    justifyContent: 'flex-start',
    minHeight: '52px',
    borderRadius: 'var(--radius-md)',
    paddingInline: 'var(--space-sm)',
    border: '1px solid transparent',
    backgroundColor: 'transparent',
    '@media (max-width: 720px)': {
      minHeight: '56px',
    },
  },
  listButtonSelected: {
    border: '1px solid var(--color-primary)',
    backgroundColor: 'var(--color-primary-soft)',
    boxShadow: 'var(--shadow-glow)',
  },
  listButtonContent: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '2px',
    width: '100%',
  },
  listTitle: {
    color: 'var(--color-text-primary)',
    fontSize: '0.8125rem',
    fontWeight: '600',
  },
  listMeta: {
    color: 'var(--color-text-tertiary)',
    fontSize: '0.75rem',
  },
  summaryRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    flexWrap: 'wrap',
    marginTop: '4px',
  },
  detailLayout: {
    display: 'grid',
    gap: 'var(--space-md)',
  },
  scoreHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 'var(--space-md)',
    flexWrap: 'wrap',
  },
  scoreValue: {
    fontFamily: 'var(--font-display)',
    fontSize: '2.5rem',
    lineHeight: 1,
    fontWeight: '700',
    color: 'var(--color-text-primary)',
    letterSpacing: '-0.03em',
    '@media (max-width: 640px)': {
      fontSize: '2rem',
    },
  },
  metricsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 'var(--space-md)',
    '@media (max-width: 960px)': {
      gridTemplateColumns: '1fr',
    },
  },
  sectionTitle: {
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-primary)',
    marginBottom: 'var(--space-sm)',
    fontSize: '0.8125rem',
    fontWeight: '600',
  },
  metric: {
    display: 'grid',
    gap: '2px',
    marginBottom: 'var(--space-sm)',
  },
  metricHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 'var(--space-sm)',
  },
  chipGrid: {
    display: 'flex',
    gap: '6px',
    flexWrap: 'wrap',
  },
  textList: {
    display: 'grid',
    gap: 'var(--space-sm)',
  },
  textItem: {
    padding: 'var(--space-sm) var(--space-md)',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--color-bg-muted)',
    borderLeft: '3px solid var(--color-primary)',
    color: 'var(--color-text-primary)',
    fontSize: '0.8125rem',
    lineHeight: 1.5,
  },
  transcript: {
    padding: 'var(--space-md)',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--color-bg-muted)',
    color: 'var(--color-text-secondary)',
    whiteSpace: 'pre-wrap',
    lineHeight: 1.6,
    fontFamily: 'var(--font-mono)',
    fontSize: '0.8125rem',
  },
  emptyState: {
    padding: 'var(--space-lg)',
    borderRadius: 'var(--radius-md)',
    border: '1px dashed var(--color-border-strong)',
    backgroundColor: 'var(--color-bg-muted)',
    textAlign: 'center',
    color: 'var(--color-text-tertiary)',
    fontSize: '0.8125rem',
  },
  loading: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '120px',
  },
  planSection: {
    display: 'grid',
    gap: 'var(--space-md)',
    paddingTop: 'var(--space-sm)',
    borderTop: '1px solid var(--color-border)',
  },
  plannerStatusCard: {
    display: 'grid',
    gap: '4px',
    padding: 'var(--space-sm)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)',
    backgroundColor: 'rgba(233, 245, 246, 0.45)',
  },
  plannerStatusCardWarning: {
    border: '1px solid rgba(180, 35, 24, 0.22)',
    backgroundColor: 'rgba(254, 243, 242, 0.92)',
  },
  plannerStatusList: {
    display: 'grid',
    gap: '4px',
  },
  planComposer: {
    width: '100%',
    minHeight: '92px',
    resize: 'vertical' as const,
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)',
    padding: 'var(--space-sm)',
    font: 'inherit',
    color: 'var(--color-text-primary)',
    backgroundColor: 'var(--color-bg-card)',
  },
  planActions: {
    display: 'flex',
    gap: 'var(--space-sm)',
    flexWrap: 'wrap',
  },
  planList: {
    display: 'grid',
    gap: 'var(--space-sm)',
  },
  planItem: {
    padding: 'var(--space-sm)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)',
    backgroundColor: 'rgba(233, 245, 246, 0.4)',
    display: 'grid',
    gap: '4px',
  },
  conversationItem: {
    padding: 'var(--space-sm)',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--color-bg-card)',
    border: '1px solid var(--color-border)',
    display: 'grid',
    gap: '2px',
  },
  errorText: {
    color: '#b42318',
  },
})

function formatTimestamp(timestamp?: string | null) {
  if (!timestamp) return 'No sessions yet'

  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp))
}

function getScoreColor(score?: number | null): 'success' | 'warning' | 'danger' | 'informative' {
  if (score == null) return 'informative'
  if (score >= 80) return 'success'
  if (score >= 60) return 'warning'
  return 'danger'
}

function formatShortDate(timestamp?: string | null) {
  if (!timestamp) return 'No sessions yet'

  return new Intl.DateTimeFormat('en-GB', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(timestamp))
}

function getAverageScore(sessions: SessionSummary[]) {
  const scores = sessions
    .map(session => session.overall_score)
    .filter((score): score is number => typeof score === 'number')

  if (scores.length === 0) return null

  return Math.round(scores.reduce((total, score) => total + score, 0) / scores.length)
}

function getTrendLabel(sessions: SessionSummary[]) {
  const scores = [...sessions]
    .sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime())
    .map(session => session.overall_score)
    .filter((score): score is number => typeof score === 'number')

  if (scores.length < 2) return 'Build a baseline with a few sessions.'

  const midpoint = Math.max(1, Math.floor(scores.length / 2))
  const earlyAverage = scores.slice(0, midpoint).reduce((total, score) => total + score, 0) / midpoint
  const recentScores = scores.slice(midpoint)
  const recentAverage = recentScores.reduce((total, score) => total + score, 0) / recentScores.length
  const delta = Math.round(recentAverage - earlyAverage)

  if (delta >= 6) return `Trending up by ${delta} points.`
  if (delta <= -6) return `Trending down by ${Math.abs(delta)} points.`
  return 'Recent sessions are holding steady.'
}

function getTargetSoundSummary(sessions: SessionSummary[]) {
  const sounds = sessions
    .map(session => session.exercise_metadata?.targetSound || session.exercise.exerciseMetadata?.targetSound)
    .filter((sound): sound is string => Boolean(sound))

  if (sounds.length === 0) {
    return 'General practice'
  }

  return Array.from(new Set(sounds)).slice(0, 3).join(', ')
}

interface Props {
  childProfiles: ChildProfile[]
  selectedChildId: string | null
  sessions: SessionSummary[]
  selectedSession: SessionDetail | null
  selectedPlan: PracticePlan | null
  plannerReadiness: PlannerReadiness | null
  loadingChildren: boolean
  loadingSessions: boolean
  loadingSessionDetail: boolean
  loadingPlans: boolean
  planSaving: boolean
  planError: string | null
  onSelectChild: (childId: string) => void
  onOpenSession: (sessionId: string) => void
  onCreatePlan: (message: string) => void | Promise<void>
  onRefinePlan: (message: string) => void | Promise<void>
  onApprovePlan: () => void | Promise<void>
  onBackToPractice: () => void
  onExitToEntry: () => void
}

export function ProgressDashboard({
  childProfiles,
  selectedChildId,
  sessions,
  selectedSession,
  selectedPlan,
  plannerReadiness,
  loadingChildren,
  loadingSessions,
  loadingSessionDetail,
  loadingPlans,
  planSaving,
  planError,
  onSelectChild,
  onOpenSession,
  onCreatePlan,
  onRefinePlan,
  onApprovePlan,
  onBackToPractice,
  onExitToEntry,
}: Props) {
  const styles = useStyles()
  const [planPrompt, setPlanPrompt] = useState('')
  const plannerReady = plannerReadiness?.ready ?? false
  const aiAssessment = selectedSession?.assessment.ai_assessment
  const pronunciationAssessment = selectedSession?.assessment.pronunciation_assessment
  const selectedChild = childProfiles.find(child => child.id === selectedChildId) || null
  const averageScore = getAverageScore(sessions)
  const trendLabel = getTrendLabel(sessions)
  const targetSoundSummary = getTargetSoundSummary(sessions)

  return (
    <div className={styles.shell}>
      <div className={styles.header}>
        <div className={styles.headerCopy}>
          <Text className={styles.title} size={700} weight="semibold">
            Progress dashboard for supervised practice
          </Text>
          <Text className={styles.subtitle} size={300}>
            Review saved exercise sessions over time, scan pronunciation trends,
            and open the full session detail without changing the child-facing
            practice flow.
          </Text>
        </div>

        <div className={styles.headerActions}>
          <Button appearance="subtle" className={styles.exitButton} onClick={onExitToEntry}>
            Return to start
          </Button>
          <Button appearance="secondary" className={styles.backButton} onClick={onBackToPractice}>
            Back to practice
          </Button>
        </div>
      </div>

      <div className={styles.summaryStrip}>
        <Card className={styles.summaryCard}>
          <Text className={styles.summaryLabel}>Selected child</Text>
          <Text className={styles.summaryValue}>{selectedChild?.name || 'Choose child'}</Text>
          <Text className={styles.summaryCopy}>
            {selectedChild
              ? `${selectedChild.session_count ?? sessions.length} saved sessions on record.`
              : 'Pick a child to reveal session history and detailed trends.'}
          </Text>
        </Card>

        <Card className={styles.summaryCard}>
          <Text className={styles.summaryLabel}>Average score</Text>
          <Text className={styles.summaryValue}>{averageScore != null ? `${averageScore}%` : '—'}</Text>
          <Text className={styles.summaryCopy}>
            {averageScore != null
              ? 'Based on saved reviewed sessions for this child.'
              : 'Scores appear after analysed sessions are saved.'}
          </Text>
        </Card>

        <Card className={styles.summaryCard}>
          <Text className={styles.summaryLabel}>Recent trend</Text>
          <Text className={styles.summaryValue}>{sessions.length > 1 ? 'Trend' : 'Starting'}</Text>
          <Text className={styles.summaryCopy}>{trendLabel}</Text>
        </Card>

        <Card className={styles.summaryCard}>
          <Text className={styles.summaryLabel}>Focus sounds</Text>
          <Text className={styles.summaryValue}>{targetSoundSummary}</Text>
          <Text className={styles.summaryCopy}>
            Last saved session: {formatShortDate(selectedChild?.last_session_at)}
          </Text>
        </Card>
      </div>

      <div className={styles.grid}>
        <Card className={styles.card}>
          <CardHeader
            header={
              <Text className={styles.columnTitle} size={500} weight="semibold">
                Children
              </Text>
            }
            description={
              <Text className={styles.helperText} size={300}>
                Choose the child whose sessions you want to review.
              </Text>
            }
          />

          {loadingChildren ? (
            <div className={styles.loading}>
              <Spinner size="medium" />
            </div>
          ) : (
            <div className={styles.list}>
              {childProfiles.map(child => {
                const isSelected = child.id === selectedChildId

                return (
                  <Button
                    key={child.id}
                    appearance="subtle"
                    className={mergeClasses(
                      styles.listButton,
                      isSelected && styles.listButtonSelected
                    )}
                    onClick={() => onSelectChild(child.id)}
                  >
                    <div className={styles.listButtonContent}>
                      <Text className={styles.listTitle} weight="semibold">
                        {child.name}
                      </Text>
                      <Text className={styles.listMeta} size={200}>
                        {child.session_count ?? 0} saved sessions
                      </Text>
                      <Text className={styles.listMeta} size={200}>
                        Last session: {formatTimestamp(child.last_session_at)}
                      </Text>
                    </div>
                  </Button>
                )
              })}
            </div>
          )}
        </Card>

        <Card className={styles.card}>
          <CardHeader
            header={
              <Text className={styles.columnTitle} size={500} weight="semibold">
                Session history
              </Text>
            }
            description={
              <Text className={styles.helperText} size={300}>
                Recent sessions appear first so progress is easy to scan.
              </Text>
            }
          />

          {loadingSessions ? (
            <div className={styles.loading}>
              <Spinner size="medium" />
            </div>
          ) : sessions.length === 0 ? (
            <div className={styles.emptyState}>
              <Text>No saved sessions for this child yet.</Text>
            </div>
          ) : (
            <div className={styles.list}>
              {sessions.map(session => {
                const isSelected = session.id === selectedSession?.id

                return (
                  <Button
                    key={session.id}
                    appearance="subtle"
                    className={mergeClasses(
                      styles.listButton,
                      isSelected && styles.listButtonSelected
                    )}
                    onClick={() => onOpenSession(session.id)}
                  >
                    <div className={styles.listButtonContent}>
                      <Text className={styles.listTitle} weight="semibold">
                        {session.exercise.name}
                      </Text>
                      <Text className={styles.listMeta} size={200}>
                        {formatTimestamp(session.timestamp)}
                      </Text>
                      <div className={styles.summaryRow}>
                        <Badge appearance="filled" color={getScoreColor(session.overall_score)}>
                          Overall {session.overall_score ?? '—'}
                        </Badge>
                        <Badge appearance="tint" color={getScoreColor(session.accuracy_score)}>
                          Accuracy {session.accuracy_score ?? '—'}
                        </Badge>
                          {session.therapist_feedback?.rating ? (
                            <Badge appearance="outline">
                              Feedback {session.therapist_feedback.rating === 'up' ? 'helpful' : 'follow-up'}
                            </Badge>
                          ) : null}
                      </div>
                    </div>
                  </Button>
                )
              })}
            </div>
          )}
        </Card>

        <Card className={styles.card}>
          <CardHeader
            header={
              <Text className={styles.columnTitle} size={500} weight="semibold">
                Session detail
              </Text>
            }
            description={
              <Text className={styles.helperText} size={300}>
                Practice feedback — not a clinical assessment.
              </Text>
            }
          />

          {loadingSessionDetail ? (
            <div className={styles.loading}>
              <Spinner size="medium" />
            </div>
          ) : !selectedSession ? (
            <div className={styles.emptyState}>
              <Text>Select a saved session to open the full review.</Text>
            </div>
          ) : (
            <div className={styles.detailLayout}>
              <div className={styles.scoreHeader}>
                <div>
                  <Text className={styles.sectionTitle} size={600} weight="semibold">
                    {selectedSession.exercise.name}
                  </Text>
                  <Text className={styles.helperText} size={300}>
                    {selectedSession.child.name} • {formatTimestamp(selectedSession.timestamp)}
                  </Text>
                </div>

                <div>
                  <Text className={styles.scoreValue}>
                    {aiAssessment?.overall_score ?? '—'}
                  </Text>
                  <Badge appearance="filled" color={getScoreColor(aiAssessment?.overall_score)}>
                    Overall result
                  </Badge>
                </div>
              </div>

              {aiAssessment && (
                <>
                  <div className={styles.metricsGrid}>
                    {aiAssessment.articulation_clarity && (
                    <div>
                      <Text className={styles.sectionTitle} size={400} weight="semibold">
                        Articulation breakdown
                      </Text>
                      {articulationMetrics.map(metric => (
                        <div className={styles.metric} key={metric.key}>
                          <div className={styles.metricHeader}>
                            <Text size={300}>{metric.label}</Text>
                            <Badge appearance="tint">
                              {aiAssessment.articulation_clarity[metric.key] ?? 0}/{metric.max}
                            </Badge>
                          </div>
                          <ProgressBar
                            value={(aiAssessment.articulation_clarity[metric.key] ?? 0) / metric.max}
                          />
                        </div>
                      ))}
                    </div>
                    )}

                    {aiAssessment.engagement_and_effort && (
                    <div>
                      <Text className={styles.sectionTitle} size={400} weight="semibold">
                        Engagement breakdown
                      </Text>
                      {engagementMetrics.map(metric => (
                        <div className={styles.metric} key={metric.key}>
                          <div className={styles.metricHeader}>
                            <Text size={300}>{metric.label}</Text>
                            <Badge appearance="tint">
                              {aiAssessment.engagement_and_effort[metric.key] ?? 0}/{metric.max}
                            </Badge>
                          </div>
                          <ProgressBar
                            value={(aiAssessment.engagement_and_effort[metric.key] ?? 0) / metric.max}
                          />
                        </div>
                      ))}
                    </div>
                    )}
                  </div>

                  {selectedSession.therapist_feedback ? (
                    <div>
                      <Text className={styles.sectionTitle} size={400} weight="semibold">
                        Therapist feedback
                      </Text>
                      <div className={styles.summaryRow}>
                        <Badge appearance="filled">
                          {selectedSession.therapist_feedback.rating === 'up'
                            ? 'Helpful session'
                            : 'Needs follow-up'}
                        </Badge>
                      </div>
                      {selectedSession.therapist_feedback.note ? (
                        <div className={styles.textItem}>
                          <Text>{selectedSession.therapist_feedback.note}</Text>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </>
              )}

              {!aiAssessment && selectedSession.therapist_feedback ? (
                  <div>
                    <Text className={styles.sectionTitle} size={400} weight="semibold">
                      Therapist feedback
                    </Text>
                    <div className={styles.summaryRow}>
                      <Badge appearance="filled">
                        {selectedSession.therapist_feedback.rating === 'up'
                          ? 'Helpful session'
                          : 'Needs follow-up'}
                      </Badge>
                    </div>
                    {selectedSession.therapist_feedback.note ? (
                      <div className={styles.textItem}>
                        <Text>{selectedSession.therapist_feedback.note}</Text>
                      </div>
                    ) : null}
                  </div>
                ) : null}

              {pronunciationAssessment && (
                <div>
                  <Text className={styles.sectionTitle} size={400} weight="semibold">
                    Pronunciation review
                  </Text>
                  <div className={styles.summaryRow}>
                    <Badge appearance="filled" color={getScoreColor(pronunciationAssessment.accuracy_score)}>
                      Accuracy {pronunciationAssessment.accuracy_score?.toFixed(1) ?? '—'}
                    </Badge>
                    <Badge appearance="filled" color={getScoreColor(pronunciationAssessment.pronunciation_score)}>
                      Pronunciation {pronunciationAssessment.pronunciation_score?.toFixed(1) ?? '—'}
                    </Badge>
                    <Badge appearance="tint" color={getScoreColor(pronunciationAssessment.fluency_score)}>
                      Fluency {pronunciationAssessment.fluency_score?.toFixed(1) ?? '—'}
                    </Badge>
                  </div>

                  {pronunciationAssessment.words?.length ? (
                    <div className={styles.chipGrid}>
                      {pronunciationAssessment.words.map(word => (
                        <Badge
                          key={`${word.word}-${word.accuracy}-${word.error_type}`}
                          appearance="tint"
                          color={getScoreColor(word.accuracy)}
                        >
                          {word.word} {Math.round(word.accuracy)}%
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </div>
              )}

              <div className={styles.metricsGrid}>
                <div>
                  <Text className={styles.sectionTitle} size={400} weight="semibold">
                    Celebration points
                  </Text>
                  <div className={styles.textList}>
                    {(aiAssessment?.celebration_points?.length
                      ? aiAssessment.celebration_points
                      : ['No celebration points saved for this session.']
                    ).map(point => (
                      <div className={styles.textItem} key={point}>
                        <Text size={300}>{point}</Text>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <Text className={styles.sectionTitle} size={400} weight="semibold">
                    Practice suggestions
                  </Text>
                  <div className={styles.textList}>
                    {(aiAssessment?.practice_suggestions?.length
                      ? aiAssessment.practice_suggestions
                      : ['No follow-up suggestions saved for this session.']
                    ).map(suggestion => (
                      <div className={styles.textItem} key={suggestion}>
                        <Text size={300}>{suggestion}</Text>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <Text className={styles.sectionTitle} size={400} weight="semibold">
                  Therapist notes
                </Text>
                <div className={styles.textItem}>
                  <Text size={300}>
                    {aiAssessment?.therapist_notes || 'No therapist notes saved for this session.'}
                  </Text>
                </div>
              </div>

              <div className={styles.planSection}>
                <div>
                  <Text className={styles.sectionTitle} size={400} weight="semibold">
                    Plan next session
                  </Text>
                  <Text className={styles.helperText} size={300}>
                    Create a therapist-facing next-step plan from this saved review and refine it before the next visit.
                  </Text>
                </div>

                {plannerReadiness ? (
                  <div
                    className={mergeClasses(
                      styles.plannerStatusCard,
                      !plannerReadiness.ready && styles.plannerStatusCardWarning,
                    )}
                  >
                    <div className={styles.summaryRow}>
                      <Badge appearance="filled">
                        {plannerReadiness.ready ? 'Planner ready' : 'Planner unavailable'}
                      </Badge>
                      <Badge appearance="tint">Model {plannerReadiness.model}</Badge>
                      <Badge appearance="outline">
                        {plannerReadiness.auth.azure_byok_configured ? 'Azure BYOK configured' : 'Azure BYOK missing'}
                      </Badge>
                    </div>

                    <Text size={300}>
                      {plannerReadiness.ready
                        ? 'The backend planner runtime is ready for generation and refinement.'
                        : 'Plan generation is disabled until the backend planner runtime prerequisites are satisfied.'}
                    </Text>

                    {!plannerReadiness.ready && plannerReadiness.reasons.length ? (
                      <div className={styles.plannerStatusList}>
                        {plannerReadiness.reasons.map(reason => (
                          <Text className={styles.errorText} size={300} key={reason}>
                            {reason}
                          </Text>
                        ))}
                      </div>
                    ) : null}

                    <Text className={styles.helperText} size={200}>
                      CLI {plannerReadiness.cli.available ? 'available' : 'missing'}
                      {plannerReadiness.cli.version ? ` • ${plannerReadiness.cli.version}` : ''}
                      {plannerReadiness.cli.auth_message ? ` • ${plannerReadiness.cli.auth_message}` : ''}
                    </Text>
                  </div>
                ) : null}

                {loadingPlans ? (
                  <div className={styles.loading}>
                    <Spinner size="medium" />
                  </div>
                ) : selectedPlan ? (
                  <div className={styles.planList}>
                    <div className={styles.summaryRow}>
                      <Badge appearance="filled">
                        {selectedPlan.status === 'approved' ? 'Approved plan' : 'Draft plan'}
                      </Badge>
                      <Badge appearance="tint">
                        {selectedPlan.draft.estimated_duration_minutes} min
                      </Badge>
                    </div>

                    <div className={styles.textItem}>
                      <Text size={300} weight="semibold">
                        {selectedPlan.draft.objective}
                      </Text>
                      <Text size={300}>{selectedPlan.draft.rationale}</Text>
                    </div>

                    <div>
                      <Text className={styles.sectionTitle} size={300} weight="semibold">
                        Activity sequence
                      </Text>
                      <div className={styles.planList}>
                        {selectedPlan.draft.activities.map(activity => (
                          <div className={styles.planItem} key={`${activity.exercise_id}-${activity.title}`}>
                            <Text size={300} weight="semibold">
                              {activity.title}
                            </Text>
                            <Text size={200}>
                              {activity.exercise_name} • {activity.target_duration_minutes} min
                            </Text>
                            <Text size={200}>{activity.reason}</Text>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className={styles.metricsGrid}>
                      <div>
                        <Text className={styles.sectionTitle} size={300} weight="semibold">
                          Therapist cues
                        </Text>
                        <div className={styles.textList}>
                          {selectedPlan.draft.therapist_cues.map(cue => (
                            <div className={styles.textItem} key={cue}>
                              <Text size={300}>{cue}</Text>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div>
                        <Text className={styles.sectionTitle} size={300} weight="semibold">
                          Success criteria
                        </Text>
                        <div className={styles.textList}>
                          {selectedPlan.draft.success_criteria.map(criterion => (
                            <div className={styles.textItem} key={criterion}>
                              <Text size={300}>{criterion}</Text>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div>
                      <Text className={styles.sectionTitle} size={300} weight="semibold">
                        Carryover
                      </Text>
                      <div className={styles.textList}>
                        {selectedPlan.draft.carryover.map(item => (
                          <div className={styles.textItem} key={item}>
                            <Text size={300}>{item}</Text>
                          </div>
                        ))}
                      </div>
                    </div>

                    {selectedPlan.conversation.length ? (
                      <div>
                        <Text className={styles.sectionTitle} size={300} weight="semibold">
                          Recent plan conversation
                        </Text>
                        <div className={styles.planList}>
                          {selectedPlan.conversation.slice(-4).map((message, index) => (
                            <div className={styles.conversationItem} key={`${message.role}-${index}-${message.content}`}>
                              <Text size={200} weight="semibold">
                                {message.role === 'user' ? 'Therapist' : 'Planner'}
                              </Text>
                              <Text size={300}>{message.content}</Text>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className={styles.emptyState}>
                    <Text>No practice plan has been generated for this saved session yet.</Text>
                  </div>
                )}

                <label>
                  <Text className={styles.sectionTitle} size={300} weight="semibold">
                    {selectedPlan ? 'Refine plan' : 'Optional planning note'}
                  </Text>
                  <textarea
                    className={styles.planComposer}
                    value={planPrompt}
                    onChange={event => setPlanPrompt(event.target.value)}
                    placeholder={
                      selectedPlan
                        ? 'Example: Make this shorter and lead with a listening task.'
                        : 'Example: Keep this playful and confidence-building for home carryover.'
                    }
                  />
                </label>

                {planError ? (
                  <Text className={styles.errorText} size={300}>
                    {planError}
                  </Text>
                ) : null}

                <div className={styles.planActions}>
                  {!selectedPlan ? (
                    <Button
                      appearance="primary"
                      onClick={() => {
                        void onCreatePlan(planPrompt)
                      }}
                      disabled={planSaving || !selectedSession || !plannerReady}
                    >
                      {planSaving ? 'Generating…' : plannerReady ? 'Generate plan' : 'Planner unavailable'}
                    </Button>
                  ) : (
                    <>
                      <Button
                        appearance="primary"
                        onClick={() => {
                          void onRefinePlan(planPrompt)
                        }}
                        disabled={planSaving || !planPrompt.trim() || !plannerReady}
                      >
                        {planSaving ? 'Updating…' : plannerReady ? 'Refine plan' : 'Planner unavailable'}
                      </Button>
                      <Button
                        appearance="secondary"
                        onClick={() => {
                          void onApprovePlan()
                        }}
                        disabled={planSaving || selectedPlan.status === 'approved'}
                      >
                        {selectedPlan.status === 'approved' ? 'Approved' : 'Approve plan'}
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {selectedSession.transcript ? (
                <div>
                  <Text className={styles.sectionTitle} size={400} weight="semibold">
                    Transcript
                  </Text>
                  <div className={styles.transcript}>
                    <Text size={300}>{selectedSession.transcript}</Text>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}