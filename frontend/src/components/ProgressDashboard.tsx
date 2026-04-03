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
import {
  CelebrationDonut,
  ComparisonMetricBar,
  PlanConfidenceGauge,
  SessionFrequencyHeatmap,
  SessionQualityRadar,
  SoundBreakdownCard,
  SummaryTrendCard,
  WordAccuracyHeatmap,
  getAverageFromSeries,
  getPlanConfidence,
  getSoundAccuracyBreakdown,
  getTrendChartData,
} from './charts'
import { progressDashboardChartStyleSlots } from './charts/progressDashboardChartStyles'
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
  hero: {
    display: 'grid',
    gap: 'var(--space-md)',
    padding: 'clamp(1.1rem, 2.2vw, 1.6rem)',
    borderRadius: '0px',
    border: '1px solid var(--color-border)',
    background:
      'radial-gradient(circle at top right, rgba(13, 138, 132, 0.09), transparent 34%), radial-gradient(circle at bottom left, rgba(13, 138, 132, 0.04), transparent 32%), linear-gradient(135deg, rgba(240, 247, 247, 0.94), rgba(234, 243, 243, 0.92))',
    color: 'var(--color-text-primary)',
  },
  summaryStrip: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: '12px',
    '@media (max-width: 1080px)': {
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    },
    '@media (max-width: 640px)': {
      gridTemplateColumns: '1fr',
    },
  },
  summaryStripCompact: {
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    '@media (max-width: 640px)': {
      gridTemplateColumns: '1fr',
    },
  },
  summaryCard: {
    padding: '14px 16px',
    borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--color-border)',
    backgroundColor: 'rgba(255, 252, 247, 0.9)',
    boxShadow: 'var(--shadow-md)',
    display: 'grid',
    gap: '6px',
    alignContent: 'start',
  },
  summaryLabel: {
    color: 'var(--color-text-tertiary)',
    fontSize: '0.74rem',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    fontWeight: '700',
  },
  summaryValue: {
    color: 'var(--color-text-primary)',
    fontFamily: 'var(--font-display)',
    fontSize: '1.26rem',
    fontWeight: '800',
    lineHeight: 1,
    letterSpacing: '-0.03em',
  },
  summaryCopy: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.78rem',
    lineHeight: 1.45,
  },
  summaryCopyQuiet: {
    color: 'var(--color-text-tertiary)',
    fontSize: '0.74rem',
    lineHeight: 1.35,
  },
  summaryCardQuiet: {
    gap: '4px',
    backgroundColor: 'rgba(255, 252, 247, 0.82)',
  },
  sparseHeroMarker: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    paddingTop: '4px',
  },
  sparseHeroDivider: {
    width: '42px',
    height: '1px',
    backgroundColor: 'rgba(15, 42, 58, 0.16)',
  },
  sparseHeroIcon: {
    width: '28px',
    height: '28px',
    color: 'var(--color-text-tertiary)',
    opacity: 0.8,
  },
  summaryTrendWrap: {
    display: 'grid',
    gap: '8px',
  },
  sparkline: {
    width: '100%',
    height: '44px',
    overflow: 'visible',
  },
  sparklineTrack: {
    fill: 'none',
    stroke: 'rgba(13, 138, 132, 0.14)',
    strokeWidth: 1,
  },
  sparklineLine: {
    fill: 'none',
    stroke: 'var(--color-primary)',
    strokeWidth: 2,
    vectorEffect: 'non-scaling-stroke',
  },
  sparklineArea: {
    fill: 'rgba(13, 138, 132, 0.08)',
  },
  sparklineDot: {
    fill: 'var(--color-primary)',
  },
  sparklineEmpty: {
    height: '44px',
    display: 'grid',
    placeItems: 'center',
    border: '1px dashed var(--color-border-strong)',
    color: 'var(--color-text-tertiary)',
    fontSize: '0.75rem',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 'var(--space-md)',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
  },
  headerCopy: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    maxWidth: '720px',
  },
  eyebrow: {
    color: 'var(--color-text-tertiary)',
    fontSize: '0.74rem',
    fontWeight: '700',
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
  },
  title: {
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-primary)',
    fontSize: 'clamp(1.55rem, 3vw, 2rem)',
    fontWeight: '800',
    letterSpacing: '-0.04em',
  },
  subtitle: {
    color: 'var(--color-text-secondary)',
    maxWidth: '52ch',
    lineHeight: 1.45,
    fontSize: '0.84rem',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '196px minmax(280px, 0.82fr) minmax(380px, 1.18fr)',
    gap: 'var(--space-md)',
    alignItems: 'start',
    '@media (max-width: 1200px)': {
      gridTemplateColumns: '1fr',
    },
  },
  card: {
    padding: 'var(--space-lg)',
    borderRadius: 'var(--radius-lg)',
    border: '1px solid rgba(15, 42, 58, 0.16)',
    background:
      'radial-gradient(circle at top right, rgba(13, 138, 132, 0.08), transparent 38%), linear-gradient(135deg, rgba(244, 249, 249, 0.94), rgba(238, 245, 245, 0.9) 52%, rgba(252, 248, 240, 0.98))',
    boxShadow: 'var(--shadow-md)',
  },
  backButton: {
    minWidth: '148px',
    borderRadius: '0px',
    fontFamily: 'var(--font-display)',
    fontWeight: '700',
    minHeight: '44px',
    fontSize: '0.92rem',
    backgroundColor: 'var(--color-primary)',
    color: 'var(--color-text-inverse)',
    border: 'none',
  },
  headerActions: {
    display: 'flex',
    gap: 'var(--space-sm)',
    flexWrap: 'wrap',
  },
  exitButton: {
    minWidth: '148px',
    borderRadius: '0px',
    fontFamily: 'var(--font-display)',
    fontWeight: '600',
    minHeight: '44px',
    fontSize: '0.92rem',
    color: 'var(--color-text-secondary)',
    border: '1px solid var(--color-border-strong)',
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
  },
  columnTitle: {
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-primary)',
    fontSize: '0.94rem',
    fontWeight: '700',
  },
  helperText: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.8125rem',
    lineHeight: 1.55,
  },
  list: {
    display: 'grid',
    gap: '6px',
    marginTop: '12px',
  },
  childList: {
    display: 'grid',
    gap: '4px',
    marginTop: '10px',
  },
  listButton: {
    justifyContent: 'flex-start',
    minHeight: '58px',
    borderRadius: 'var(--radius-md)',
    padding: '10px 12px',
    border: '1px solid transparent',
    backgroundColor: 'transparent',
    borderBottom: '1px solid rgba(15, 42, 58, 0.06)',
    '@media (max-width: 720px)': {
      minHeight: '56px',
    },
  },
  listButtonSelected: {
    border: '1px solid rgba(13, 138, 132, 0.18)',
    backgroundColor: 'rgba(13, 138, 132, 0.12)',
    boxShadow: 'var(--shadow-glow)',
  },
  listButtonContent: {
    display: 'grid',
    gap: '4px',
    width: '100%',
  },
  rowHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 'var(--space-sm)',
    width: '100%',
  },
  rowMain: {
    display: 'grid',
    gap: '3px',
    minWidth: 0,
  },
  rowValue: {
    color: 'var(--color-text-primary)',
    fontFamily: 'var(--font-display)',
    fontSize: '1rem',
    fontWeight: '800',
    lineHeight: 1,
    letterSpacing: '-0.03em',
    flexShrink: 0,
  },
  listTitle: {
    color: 'var(--color-text-primary)',
    fontSize: '0.84rem',
    fontWeight: '700',
  },
  listMeta: {
    color: 'var(--color-text-tertiary)',
    fontSize: '0.72rem',
  },
  rowMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
  metaDivider: {
    width: '4px',
    height: '4px',
    borderRadius: '9999px',
    backgroundColor: 'rgba(15, 42, 58, 0.18)',
  },
  miniTrend: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, auto))',
    gap: '6px',
    alignItems: 'center',
    justifyContent: 'start',
  },
  miniMetric: {
    padding: '4px 10px',
    border: '1px solid rgba(15, 42, 58, 0.12)',
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    color: 'var(--color-text-secondary)',
    fontSize: '0.75rem',
    fontWeight: '700',
    letterSpacing: '0.02em',
  },
  summaryRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
    marginTop: '8px',
  },
  sessionHistoryList: {
    display: 'grid',
    gap: '10px',
    marginTop: 'var(--space-md)',
  },
  sessionHistoryButton: {
    justifyContent: 'flex-start',
    minHeight: '92px',
    padding: '16px',
    border: '1px solid rgba(15, 42, 58, 0.1)',
    backgroundColor: 'rgba(255, 252, 247, 0.74)',
    borderBottom: '1px solid rgba(15, 42, 58, 0.12)',
    '@media (max-width: 720px)': {
      minHeight: '88px',
    },
  },
  sessionHistoryButtonSelected: {
    border: '1px solid rgba(13, 138, 132, 0.26)',
    backgroundColor: 'rgba(13, 138, 132, 0.08)',
  },
  sessionHistoryContent: {
    display: 'grid',
    gap: '10px',
    width: '100%',
  },
  sessionHistoryHeader: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gap: '12px',
    alignItems: 'start',
    width: '100%',
  },
  sessionHistoryTitleWrap: {
    display: 'grid',
    gap: '6px',
    minWidth: 0,
  },
  sessionHistoryTitle: {
    color: 'var(--color-text-primary)',
    fontSize: '0.88rem',
    fontWeight: '700',
    lineHeight: 1.35,
  },
  sessionHistoryMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
    color: 'var(--color-text-tertiary)',
    fontSize: '0.75rem',
  },
  sessionHistoryScoreWrap: {
    display: 'grid',
    gap: '2px',
    justifyItems: 'end',
    textAlign: 'right',
    flexShrink: 0,
  },
  sessionHistoryScore: {
    color: 'var(--color-text-primary)',
    fontFamily: 'var(--font-display)',
    fontSize: '1.35rem',
    fontWeight: '800',
    lineHeight: 1,
    letterSpacing: '-0.03em',
  },
  sessionHistoryScoreLabel: {
    color: 'var(--color-text-tertiary)',
    fontSize: '0.68rem',
    fontWeight: '700',
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
  },
  sessionHistoryMetrics: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
  sessionHistoryMetric: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 8px',
    border: '1px solid rgba(15, 42, 58, 0.1)',
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    color: 'var(--color-text-secondary)',
    fontSize: '0.74rem',
    lineHeight: 1.35,
  },
  sessionHistoryMetricLabel: {
    color: 'var(--color-text-tertiary)',
    fontWeight: '700',
  },
  sessionHistoryMetricValue: {
    color: 'var(--color-text-primary)',
    fontWeight: '700',
  },
  sessionHistoryFeedback: {
    color: 'var(--color-primary-dark)',
    backgroundColor: 'rgba(13, 138, 132, 0.1)',
    border: '1px solid rgba(13, 138, 132, 0.18)',
  },
  detailLayout: {
    display: 'grid',
    gap: 'var(--space-lg)',
  },
  scoreHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'start',
    gap: 'var(--space-md)',
    flexWrap: 'wrap',
  },
  scoreValue: {
    fontFamily: 'var(--font-display)',
    fontSize: '1.75rem',
    lineHeight: 1,
    fontWeight: '800',
    color: 'var(--color-text-primary)',
    letterSpacing: '-0.03em',
    '@media (max-width: 640px)': {
      fontSize: '1.5rem',
    },
  },
  scorePanel: {
    display: 'grid',
    gap: '6px',
    minWidth: '116px',
    padding: '10px 12px',
    border: '1px solid rgba(15, 42, 58, 0.12)',
    backgroundColor: 'rgba(255, 252, 247, 0.96)',
    justifyItems: 'end',
  },
  scoreLabel: {
    color: 'var(--color-text-tertiary)',
    fontSize: '0.68rem',
    fontWeight: '700',
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
  },
  metricsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 'var(--space-lg)',
    '@media (max-width: 960px)': {
      gridTemplateColumns: '1fr',
    },
  },
  sectionTitle: {
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-primary)',
    marginBottom: '10px',
    fontSize: '0.92rem',
    fontWeight: '700',
  },
  tabRow: {
    display: 'flex',
    gap: '6px',
    flexWrap: 'wrap',
  },
  tabButton: {
    minHeight: '32px',
    padding: '0 10px',
    border: '1px solid rgba(15, 42, 58, 0.1)',
    backgroundColor: 'rgba(255, 255, 255, 0.86)',
    color: 'var(--color-text-secondary)',
    fontSize: '0.76rem',
    fontWeight: '700',
  },
  tabButtonActive: {
    border: '1px solid rgba(13, 138, 132, 0.22)',
    backgroundColor: 'rgba(13, 138, 132, 0.12)',
    color: 'var(--color-primary-dark)',
  },
  compactMetricsBlock: {
    display: 'grid',
    gap: '10px',
  },
  analysisSection: {
    display: 'grid',
    gap: '12px',
  },
  analysisGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(260px, 0.9fr) minmax(0, 1.1fr)',
    gap: '16px',
    alignItems: 'start',
    '@media (max-width: 960px)': {
      gridTemplateColumns: '1fr',
    },
  },
  analysisCopy: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.78rem',
    lineHeight: 1.45,
    maxWidth: '54ch',
  },
  sectionBlock: {
    display: 'grid',
    gap: '12px',
    padding: '16px',
    border: '1px solid rgba(15, 42, 58, 0.12)',
    backgroundColor: 'rgba(255, 252, 247, 0.94)',
  },
  combinedReviewGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 180px) minmax(0, 1fr) minmax(0, 1fr)',
    gap: '12px',
    alignItems: 'start',
    '@media (max-width: 900px)': {
      gridTemplateColumns: '1fr',
    },
  },
  combinedReviewColumn: {
    display: 'grid',
    gap: '10px',
  },
  combinedReviewLabel: {
    color: 'var(--color-text-tertiary)',
    fontSize: '0.7rem',
    fontWeight: '700',
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
  },
  notePanel: {
    display: 'grid',
    gap: '8px',
    paddingTop: '10px',
    borderTop: '1px solid rgba(15, 42, 58, 0.08)',
  },
  metric: {
    display: 'grid',
    gap: '8px',
    marginBottom: 'var(--space-md)',
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
    gap: '12px',
  },
  textItem: {
    padding: '12px 14px',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'rgba(255, 255, 255, 0.98)',
    border: '1px solid rgba(15, 42, 58, 0.14)',
    color: 'var(--color-text-primary)',
    fontSize: '0.84rem',
    lineHeight: 1.6,
  },
  transcript: {
    padding: 'var(--space-md)',
    borderRadius: 'var(--radius-md)',
    background:
      'linear-gradient(135deg, rgba(233, 245, 246, 0.5), rgba(224, 239, 241, 0.4) 60%, rgba(242, 233, 216, 0.5))',
    border: '1px solid rgba(13, 138, 132, 0.1)',
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
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
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
    gap: '12px',
    paddingTop: '12px',
    borderTop: '1px solid var(--color-border)',
  },
  ...progressDashboardChartStyleSlots,
  planComposer: {
    width: '100%',
    minHeight: '72px',
    resize: 'vertical' as const,
    borderRadius: 'var(--radius-md)',
    border: '1px solid rgba(15, 42, 58, 0.14)',
    padding: 'var(--space-sm)',
    font: 'inherit',
    color: 'var(--color-text-primary)',
    backgroundColor: 'rgba(255, 255, 255, 0.98)',
  },
  planActions: {
    display: 'flex',
    gap: '6px',
    flexWrap: 'wrap',
  },
  planList: {
    display: 'grid',
    gap: '6px',
  },
  planItem: {
    padding: '10px 12px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid rgba(15, 42, 58, 0.1)',
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    display: 'grid',
    gap: '2px',
  },
  conversationItem: {
    padding: '10px 12px',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    border: '1px solid rgba(15, 42, 58, 0.1)',
    display: 'grid',
    gap: '2px',
  },
  scoreBadge: {
    border: '1px solid var(--color-border-strong)',
    backgroundColor: 'rgba(255,255,255,0.92)',
    color: 'var(--color-text-primary)',
  },
  scoreBadgeTeal: {
    border: '1px solid rgba(13, 138, 132, 0.26)',
    backgroundColor: 'rgba(13, 138, 132, 0.14)',
    color: 'var(--color-primary-dark)',
  },
  scoreBadgeSand: {
    border: '1px solid rgba(184, 148, 85, 0.3)',
    backgroundColor: 'rgba(184, 148, 85, 0.14)',
    color: '#7a6131',
  },
  scoreBadgeInk: {
    border: '1px solid rgba(15, 42, 58, 0.22)',
    backgroundColor: 'rgba(15, 42, 58, 0.1)',
    color: 'var(--color-text-primary)',
  },
  errorText: {
    color: '#7a6131',
  },
})

function formatTimestamp(timestamp?: string | null) {
  if (!timestamp) return 'No sessions yet'

  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp))
}

function getScoreBadgeClass(
  styles: ReturnType<typeof useStyles>,
  score?: number | null
) {
  if (score == null) return styles.scoreBadge
  if (score >= 80) return mergeClasses(styles.scoreBadge, styles.scoreBadgeTeal)
  if (score >= 60) return mergeClasses(styles.scoreBadge, styles.scoreBadgeSand)
  return mergeClasses(styles.scoreBadge, styles.scoreBadgeInk)
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

function getSummaryStripMode(hasTrendVisualization: boolean, hasSoundVisualization: boolean) {
  return hasTrendVisualization && hasSoundVisualization ? 'rich' : 'compact'
}

function getHeroSubtitle(isSparseDashboard: boolean) {
  return isSparseDashboard
    ? 'Use saved reviews to build the dashboard for the active child.'
    : 'Track session quality, scan score movement, and turn saved reviews into next-step action for the active child.'
}

function SparseStateMarker({ className, dividerClassName }: { className: string; dividerClassName: string }) {
  return (
    <div className={className} aria-hidden="true">
      <span className={dividerClassName} />
      <svg viewBox="0 0 28 28" fill="none">
        <rect x="4" y="17" width="4" height="7" fill="currentColor" opacity="0.55" />
        <rect x="12" y="11" width="4" height="13" fill="currentColor" opacity="0.75" />
        <rect x="20" y="7" width="4" height="17" fill="currentColor" />
      </svg>
      <span className={dividerClassName} />
    </div>
  )
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
  const [breakdownViewBySession, setBreakdownViewBySession] = useState<Record<string, 'articulation' | 'engagement'>>({})
  const plannerReady = plannerReadiness?.ready ?? false
  const aiAssessment = selectedSession?.assessment.ai_assessment
  const pronunciationAssessment = selectedSession?.assessment.pronunciation_assessment
  const selectedChild = childProfiles.find(child => child.id === selectedChildId) || null
  const averageScore = getAverageScore(sessions)
  const trendLabel = getTrendLabel(sessions)
  const trendChartData = getTrendChartData(sessions, formatShortDate, formatTimestamp)
  const soundBreakdown = getSoundAccuracyBreakdown(sessions)
  const hasTrendVisualization = trendChartData.some(point => point.overall != null || point.accuracy != null || point.pronunciation != null)
  const hasSoundVisualization = soundBreakdown.length > 0
  const isSparseDashboard = sessions.length < 2 && !hasSoundVisualization
  const summaryStripMode = getSummaryStripMode(hasTrendVisualization, hasSoundVisualization)
  const heroSubtitle = getHeroSubtitle(isSparseDashboard)
  const articulationAverageMarker = getAverageFromSeries(sessions, 'accuracy_score') != null
    ? (getAverageFromSeries(sessions, 'accuracy_score') as number) / 10
    : null
  const engagementAverageMarker = getAverageFromSeries(sessions, 'overall_score') != null
    ? (getAverageFromSeries(sessions, 'overall_score') as number) / 10
    : null
  const planConfidence = getPlanConfidence(sessions, selectedPlan)
  const celebrationCount = aiAssessment?.celebration_points?.length ?? 0
  const hasArticulationBreakdown = Boolean(aiAssessment?.articulation_clarity)
  const hasEngagementBreakdown = Boolean(aiAssessment?.engagement_and_effort)
  const selectedSessionBreakdown = selectedSession?.id ? breakdownViewBySession[selectedSession.id] : undefined
  const activeBreakdown = hasArticulationBreakdown && hasEngagementBreakdown
    ? selectedSessionBreakdown ?? 'articulation'
    : hasArticulationBreakdown
      ? 'articulation'
      : 'engagement'

  function setSessionBreakdownView(view: 'articulation' | 'engagement') {
    if (!selectedSession?.id) return

    setBreakdownViewBySession(current => ({
      ...current,
      [selectedSession.id]: view,
    }))
  }

  return (
    <div className={styles.shell}>
      <div className={styles.hero}>
        <div className={styles.header}>
          <div className={styles.headerCopy}>
            <Text className={styles.eyebrow}>Therapist analytics</Text>
            <Text className={styles.title} size={700} weight="semibold">
              Session intelligence dashboard
            </Text>
            <Text className={styles.subtitle} size={300}>
              {heroSubtitle}
            </Text>
            {isSparseDashboard ? (
              <SparseStateMarker className={styles.sparseHeroMarker} dividerClassName={styles.sparseHeroDivider} />
            ) : null}
          </div>

          <div className={styles.headerActions}>
            <Button appearance="subtle" className={styles.exitButton} onClick={onExitToEntry}>
              Return to start
            </Button>
            <Button appearance="primary" className={styles.backButton} onClick={onBackToPractice}>
              Back to practice
            </Button>
          </div>
        </div>

        <div className={mergeClasses(styles.summaryStrip, summaryStripMode === 'compact' && styles.summaryStripCompact)}>
          <Card className={styles.summaryCard}>
            <Text className={styles.summaryLabel}>Selected child</Text>
            <Text className={styles.summaryValue}>{selectedChild?.name || 'Choose child'}</Text>
            <Text className={mergeClasses(styles.summaryCopy, isSparseDashboard && styles.summaryCopyQuiet)}>
              {selectedChild
                ? isSparseDashboard
                  ? `${selectedChild.session_count ?? sessions.length} reviews saved.`
                  : `${selectedChild.session_count ?? sessions.length} reviewed sessions available.`
                : 'Select a child to populate this workspace.'}
            </Text>
          </Card>

          {hasTrendVisualization ? (
            <SummaryTrendCard
              averageScore={averageScore}
              data={trendChartData}
              styles={styles}
              trendLabel={trendLabel}
            />
          ) : (
            <Card className={mergeClasses(styles.summaryCard, styles.summaryCardQuiet)}>
              <Text className={styles.summaryLabel}>Reviewed sessions</Text>
              <Text className={styles.summaryValue}>{sessions.length}</Text>
              <Text className={mergeClasses(styles.summaryCopy, styles.summaryCopyQuiet)}>{isSparseDashboard ? 'More reviews unlock the charts.' : trendLabel}</Text>
              {isSparseDashboard ? (
                <SparseStateMarker className={styles.sparseHeroMarker} dividerClassName={styles.sparseHeroDivider} />
              ) : null}
            </Card>
          )}

          {hasSoundVisualization ? (
            <SoundBreakdownCard
              lastSessionLabel={formatShortDate(selectedChild?.last_session_at)}
              soundBreakdown={soundBreakdown}
              styles={styles}
            />
          ) : null}
        </div>
      </div>

      <div className={styles.grid}>
        <Card className={styles.card}>
          <CardHeader
            header={
              <Text className={styles.columnTitle} size={500} weight="semibold">
                Children
              </Text>
            }
          />

          {loadingChildren ? (
            <div className={styles.loading}>
              <Spinner size="medium" />
            </div>
          ) : (
            <div className={styles.childList}>
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
                      <div className={styles.rowHeader}>
                        <div className={styles.rowMain}>
                          <Text className={styles.listTitle} weight="semibold">
                            {child.name}
                          </Text>
                          <div className={styles.rowMeta}>
                            <Text className={styles.listMeta} size={200}>
                              {child.session_count ?? 0} saved sessions
                            </Text>
                            <span className={styles.metaDivider} />
                            <Text className={styles.listMeta} size={200}>
                              {formatShortDate(child.last_session_at)}
                            </Text>
                          </div>
                        </div>
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
                Session history
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
            <>
              <SessionFrequencyHeatmap sessions={sessions} styles={styles} />
              <div className={styles.sessionHistoryList}>
                {sessions.map(session => {
                  const isSelected = session.id === selectedSession?.id
                  const targetSound = session.exercise_metadata?.targetSound || session.exercise.exerciseMetadata?.targetSound
                  const feedbackLabel = session.therapist_feedback?.rating === 'up' ? 'Helpful' : 'Follow-up'

                  return (
                    <Button
                      key={session.id}
                      appearance="subtle"
                      className={mergeClasses(
                        styles.sessionHistoryButton,
                        isSelected && styles.sessionHistoryButtonSelected
                      )}
                      onClick={() => onOpenSession(session.id)}
                    >
                      <div className={styles.sessionHistoryContent}>
                        <div className={styles.sessionHistoryHeader}>
                          <div className={styles.sessionHistoryTitleWrap}>
                            <Text className={styles.sessionHistoryTitle} weight="semibold">
                              {session.exercise.name}
                            </Text>
                            <div className={styles.sessionHistoryMeta}>
                              <Text size={200}>
                                {formatShortDate(session.timestamp)}
                              </Text>
                              {targetSound ? (
                                <>
                                  <span className={styles.metaDivider} />
                                  <Text size={200}>
                                    Focus {targetSound}
                                  </Text>
                                </>
                              ) : null}
                            </div>
                          </div>
                          <div className={styles.sessionHistoryScoreWrap}>
                            <Text className={styles.sessionHistoryScore}>{session.overall_score ?? '—'}</Text>
                            <Text className={styles.sessionHistoryScoreLabel}>Overall</Text>
                          </div>
                        </div>
                        <div className={styles.sessionHistoryMetrics}>
                          <div className={styles.sessionHistoryMetric}>
                            <span className={styles.sessionHistoryMetricLabel}>Accuracy</span>
                            <span className={styles.sessionHistoryMetricValue}>{session.accuracy_score ?? '—'}</span>
                          </div>
                          {session.pronunciation_score != null ? (
                            <div className={styles.sessionHistoryMetric}>
                              <span className={styles.sessionHistoryMetricLabel}>Pron</span>
                              <span className={styles.sessionHistoryMetricValue}>{Math.round(session.pronunciation_score)}</span>
                            </div>
                          ) : null}
                          {session.therapist_feedback?.rating ? (
                            <div className={mergeClasses(styles.sessionHistoryMetric, styles.sessionHistoryFeedback)}>
                              <span className={styles.sessionHistoryMetricLabel}>Feedback</span>
                              <span className={styles.sessionHistoryMetricValue}>{feedbackLabel}</span>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </Button>
                  )
                })}
              </div>
            </>
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

                <div className={styles.scorePanel}>
                  <Text className={styles.scoreLabel}>Overall result</Text>
                  <Text className={styles.scoreValue}>
                    {aiAssessment?.overall_score ?? '—'}
                  </Text>
                  <Badge appearance="filled" className={getScoreBadgeClass(styles, aiAssessment?.overall_score)}>
                    Session score
                  </Badge>
                </div>
              </div>

              {aiAssessment && (
                <>
                  {(hasArticulationBreakdown || hasEngagementBreakdown) ? (
                    <div className={styles.sectionBlock}>
                      <div className={styles.analysisSection}>
                        <Text className={styles.sectionTitle} size={400} weight="semibold">
                          Session analysis
                        </Text>
                        <Text className={styles.analysisCopy} size={200}>
                          The radar shows the overall session profile. The tabbed metrics compare detailed scores against the reviewed-session average.
                        </Text>
                        <div className={styles.analysisGrid}>
                          <SessionQualityRadar selectedSession={selectedSession} showHeading={false} styles={styles} />
                          <div className={styles.compactMetricsBlock}>
                            {hasArticulationBreakdown && hasEngagementBreakdown ? (
                              <div className={styles.tabRow}>
                                <Button
                                  appearance="subtle"
                                  className={mergeClasses(styles.tabButton, activeBreakdown === 'articulation' && styles.tabButtonActive)}
                                  onClick={() => setSessionBreakdownView('articulation')}
                                >
                                  Articulation
                                </Button>
                                <Button
                                  appearance="subtle"
                                  className={mergeClasses(styles.tabButton, activeBreakdown === 'engagement' && styles.tabButtonActive)}
                                  onClick={() => setSessionBreakdownView('engagement')}
                                >
                                  Engagement
                                </Button>
                              </div>
                            ) : null}
                            {activeBreakdown === 'articulation' && aiAssessment.articulation_clarity ? articulationMetrics.map(metric => (
                              <ComparisonMetricBar
                                key={metric.key}
                                averageValue={articulationAverageMarker}
                                label={metric.label}
                                max={metric.max}
                                styles={styles}
                                value={aiAssessment.articulation_clarity[metric.key] ?? 0}
                              />
                            )) : null}
                            {activeBreakdown === 'engagement' && aiAssessment.engagement_and_effort ? engagementMetrics.map(metric => (
                              <ComparisonMetricBar
                                key={metric.key}
                                averageValue={engagementAverageMarker}
                                label={metric.label}
                                max={metric.max}
                                styles={styles}
                                value={aiAssessment.engagement_and_effort[metric.key] ?? 0}
                              />
                            )) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {selectedSession.therapist_feedback ? (
                    <div className={styles.sectionBlock}>
                      <Text className={styles.sectionTitle} size={400} weight="semibold">
                        Therapist feedback
                      </Text>
                      <div className={styles.summaryRow}>
                        <Badge appearance="filled" className={mergeClasses(styles.scoreBadge, selectedSession.therapist_feedback.rating === 'up' ? styles.scoreBadgeTeal : styles.scoreBadgeSand)}>
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
                <div className={styles.sectionBlock}>
                  <Text className={styles.sectionTitle} size={400} weight="semibold">
                    Therapist feedback
                  </Text>
                  <div className={styles.summaryRow}>
                    <Badge appearance="filled" className={mergeClasses(styles.scoreBadge, selectedSession.therapist_feedback.rating === 'up' ? styles.scoreBadgeTeal : styles.scoreBadgeSand)}>
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
                <div className={styles.sectionBlock}>
                  <Text className={styles.sectionTitle} size={400} weight="semibold">
                    Pronunciation review
                  </Text>
                  <div className={styles.summaryRow}>
                    <Badge appearance="filled" className={getScoreBadgeClass(styles, pronunciationAssessment.accuracy_score)}>
                      Accuracy {pronunciationAssessment.accuracy_score?.toFixed(1) ?? '—'}
                    </Badge>
                    <Badge appearance="filled" className={getScoreBadgeClass(styles, pronunciationAssessment.pronunciation_score)}>
                      Pronunciation {pronunciationAssessment.pronunciation_score?.toFixed(1) ?? '—'}
                    </Badge>
                    <Badge appearance="tint" className={getScoreBadgeClass(styles, pronunciationAssessment.fluency_score)}>
                      Fluency {pronunciationAssessment.fluency_score?.toFixed(1) ?? '—'}
                    </Badge>
                  </div>

                  {pronunciationAssessment.words?.length ? (
                    <WordAccuracyHeatmap styles={styles} words={pronunciationAssessment.words} />
                  ) : null}
                </div>
              )}

              <div className={styles.sectionBlock}>
                <Text className={styles.sectionTitle} size={400} weight="semibold">
                  Review summary
                </Text>
                <div className={styles.combinedReviewGrid}>
                  <div className={styles.combinedReviewColumn}>
                    <Text className={styles.combinedReviewLabel}>Celebration</Text>
                    <CelebrationDonut earned={celebrationCount} styles={styles} />
                  </div>

                  <div className={styles.combinedReviewColumn}>
                    <Text className={styles.combinedReviewLabel}>Highlights</Text>
                    <div className={styles.textList}>
                      {(aiAssessment?.celebration_points?.length
                        ? aiAssessment.celebration_points
                        : ['No celebration points saved for this session.']
                      ).slice(0, 3).map(point => (
                        <div className={styles.textItem} key={point}>
                          <Text size={300}>{point}</Text>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className={styles.combinedReviewColumn}>
                    <Text className={styles.combinedReviewLabel}>Next steps</Text>
                    <div className={styles.textList}>
                      {(aiAssessment?.practice_suggestions?.length
                        ? aiAssessment.practice_suggestions
                        : ['No follow-up suggestions saved for this session.']
                      ).slice(0, 3).map(suggestion => (
                        <div className={styles.textItem} key={suggestion}>
                          <Text size={300}>{suggestion}</Text>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className={styles.notePanel}>
                  <Text className={styles.combinedReviewLabel}>Therapist note</Text>
                  <div className={styles.textItem}>
                    <Text size={300}>
                      {aiAssessment?.therapist_notes || 'No therapist notes saved for this session.'}
                    </Text>
                  </div>
                </div>
              </div>

              <div className={styles.planSection}>
                <div>
                  <Text className={styles.sectionTitle} size={400} weight="semibold">
                    Next-session plan
                  </Text>
                  <Text className={styles.helperText} size={300}>
                    Generate or refine the plan for the next visit.
                  </Text>
                </div>

                {loadingPlans ? (
                  <div className={styles.loading}>
                    <Spinner size="medium" />
                  </div>
                ) : selectedPlan ? (
                  <div className={styles.planList}>
                    <div className={styles.planSummaryGrid}>
                      <div className={styles.planList}>
                        <div className={styles.summaryRow}>
                          <Badge appearance="filled" className={mergeClasses(styles.scoreBadge, selectedPlan.status === 'approved' ? styles.scoreBadgeTeal : styles.scoreBadgeInk)}>
                            {selectedPlan.status === 'approved' ? 'Approved plan' : 'Draft plan'}
                          </Badge>
                          <Badge appearance="tint" className={styles.scoreBadge}>
                            {selectedPlan.draft.estimated_duration_minutes} min
                          </Badge>
                        </div>

                        <div className={styles.textItem}>
                          <Text size={300} weight="semibold">
                            {selectedPlan.draft.objective}
                          </Text>
                          {selectedPlan.draft.focus_sound ? <Text size={200}>Target sound: {selectedPlan.draft.focus_sound}</Text> : null}
                        </div>
                      </div>

                      {planConfidence ? <PlanConfidenceGauge confidence={planConfidence} styles={styles} /> : null}
                    </div>

                    <div>
                      <Text className={styles.sectionTitle} size={300} weight="semibold">
                        Activities
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
                          Cues
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
                          Success markers
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
                          Recent conversation
                        </Text>
                        <div className={styles.planList}>
                          {selectedPlan.conversation.slice(-2).map((message, index) => (
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
                    {selectedPlan ? 'Refine plan' : 'Planning note'}
                  </Text>
                  <textarea
                    className={styles.planComposer}
                    value={planPrompt}
                    onChange={event => setPlanPrompt(event.target.value)}
                    placeholder={
                      selectedPlan
                        ? 'Example: Start with listening and shorten the sequence.'
                        : 'Example: Keep it playful for home carryover.'
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