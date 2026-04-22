/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  Dropdown,
  Field,
  mergeClasses,
  Option,
  Spinner,
  Tab,
  TabList,
  Textarea,
  Text,
  makeStyles,
} from '@fluentui/react-components'
import type { TabValue } from '@fluentui/react-components'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useEffect, useState } from 'react'
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
import type {
  ChildMemoryCategory,
  ChildMemoryEvidenceLink,
  ChildMemoryItem,
  ChildMemoryProposal,
  ChildMemorySummary,
  ChildProfile,
  InstitutionalMemoryInsight,
  PlannerReadiness,
  ProgressReport,
  ProgressReportAudience,
  ProgressReportCreateRequest,
  ProgressReportRedactionOverrides,
  ProgressReportSummaryRewriteSuggestion,
  ProgressReportUpdateRequest,
  PracticePlan,
  ReportExportFormat,
  RecommendationDetail,
  RecommendationLog,
  SessionDetail,
  SessionSummary,
} from '../types'

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

type ReportExportMode = 'preview' | 'download'
type ReportSaveResult = ProgressReport | null | undefined

type NormalizedReportRedactionOverrides = {
  hide_summary_text: boolean
  hide_overview_metrics: boolean
  hide_session_list: boolean
  hide_internal_metadata: boolean
  hidden_section_keys: string[]
}

type SharedReportRedactionToggle = Exclude<keyof NormalizedReportRedactionOverrides, 'hidden_section_keys'>

const SHARED_REPORT_SECTION_OPTIONS: Record<'parent' | 'school', Array<{ key: string; title: string }>> = {
  parent: [
    { key: 'overview', title: 'Overview' },
    { key: 'session-highlights', title: 'Session highlights' },
    { key: 'family-wins', title: 'What is going well' },
    { key: 'home-support', title: 'How to support at home' },
  ],
  school: [
    { key: 'overview', title: 'Overview' },
    { key: 'session-highlights', title: 'Session highlights' },
    { key: 'school-impact', title: 'School participation impact' },
    { key: 'classroom-support', title: 'Suggested classroom supports' },
  ],
}

const SHARED_REPORT_REDACTION_OPTIONS: Array<{
  key: SharedReportRedactionToggle
  label: string
  helper: string
}> = [
  {
    key: 'hide_summary_text',
    label: 'Hide executive summary',
    helper: 'Removes the free-text summary note from shared exports.',
  },
  {
    key: 'hide_overview_metrics',
    label: 'Hide overview metrics',
    helper: 'Removes reviewed-session counts and average score cards.',
  },
  {
    key: 'hide_session_list',
    label: 'Hide included-session list',
    helper: 'Keeps the shared export from listing each saved session.',
  },
  {
    key: 'hide_internal_metadata',
    label: 'Hide internal workflow metadata',
    helper: 'Removes draft status and other internal workflow markers.',
  },
]

function isSharedReportAudience(audience: ProgressReportAudience): audience is 'parent' | 'school' {
  return audience === 'parent' || audience === 'school'
}

function getSharedReportSectionOptions(audience: ProgressReportAudience): Array<{ key: string; title: string }> {
  return isSharedReportAudience(audience) ? SHARED_REPORT_SECTION_OPTIONS[audience] : []
}

function normalizeReportRedactionOverrides(
  overrides: ProgressReportRedactionOverrides | Record<string, unknown> | null | undefined,
  audience: ProgressReportAudience,
): NormalizedReportRedactionOverrides {
  if (!isSharedReportAudience(audience)) {
    return {
      hide_summary_text: false,
      hide_overview_metrics: false,
      hide_session_list: false,
      hide_internal_metadata: false,
      hidden_section_keys: [],
    }
  }

  const availableSectionKeys = new Set(getSharedReportSectionOptions(audience).map(section => section.key))
  const hiddenSectionKeys = Array.isArray(overrides?.hidden_section_keys)
    ? overrides.hidden_section_keys
        .map(sectionKey => String(sectionKey).trim())
        .filter(sectionKey => sectionKey && availableSectionKeys.has(sectionKey))
    : []

  return {
    hide_summary_text: Boolean(overrides?.hide_summary_text),
    hide_overview_metrics: Boolean(overrides?.hide_overview_metrics),
    hide_session_list: Boolean(overrides?.hide_session_list),
    hide_internal_metadata: Boolean(overrides?.hide_internal_metadata),
    hidden_section_keys: hiddenSectionKeys,
  }
}

function buildPersistedReportRedactionOverrides(
  overrides: NormalizedReportRedactionOverrides,
  audience: ProgressReportAudience,
): ProgressReportRedactionOverrides {
  if (!isSharedReportAudience(audience)) {
    return {}
  }

  const persisted: ProgressReportRedactionOverrides = {}
  if (overrides.hide_summary_text) persisted.hide_summary_text = true
  if (overrides.hide_overview_metrics) persisted.hide_overview_metrics = true
  if (overrides.hide_session_list) persisted.hide_session_list = true
  if (overrides.hide_internal_metadata) persisted.hide_internal_metadata = true
  if (overrides.hidden_section_keys.length) persisted.hidden_section_keys = overrides.hidden_section_keys
  return persisted
}

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
    borderRadius: 'var(--radius-card)',
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-bg-card)',
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
    borderRadius: 'var(--radius-card)',
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-surface-elevated)',
    display: 'grid',
    gap: '6px',
    alignContent: 'start',
  },
  summaryLabel: {
    display: 'block',
    color: 'var(--color-text-tertiary)',
    fontSize: 'var(--font-body-15-size)',
    fontWeight: '600',
  },
  summaryValue: {
    color: 'var(--color-text-primary)',
    fontFamily: 'var(--font-display)',
    fontSize: 'var(--font-display-lg-size)',
    lineHeight: 'var(--font-display-lg-line)',
    fontWeight: '600',
    letterSpacing: '-0.02em',
  },
  summaryCopy: {
    display: 'block',
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
    backgroundColor: 'var(--color-surface-elevated)',
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
    fontSize: 'var(--font-body-15-size)',
    fontWeight: '600',
  },
  title: {
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-primary)',
    fontSize: 'var(--font-display-xl-size)',
    lineHeight: 'var(--font-display-xl-line)',
    fontWeight: 'var(--font-display-xl-weight)',
    letterSpacing: 'var(--font-display-xl-tracking)',
  },
  subtitle: {
    color: 'var(--color-text-secondary)',
    maxWidth: '52ch',
    fontSize: 'var(--font-body-15-size)',
    lineHeight: 'var(--font-body-15-line)',
    fontWeight: 'var(--font-body-15-weight)',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(320px, 360px) minmax(0, 1fr)',
    gap: 'var(--space-md)',
    alignItems: 'start',
    minWidth: 0,
    '@media (max-width: 1080px)': {
      gridTemplateColumns: '1fr',
    },
  },
  card: {
    padding: 'var(--space-lg)',
    borderRadius: 'var(--radius-card)',
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-bg-card)',
    minWidth: 0,
  },
  sidebar: {
    display: 'grid',
    gap: 'var(--space-md)',
    alignSelf: 'start',
    minWidth: 0,
    '@media (min-width: 1081px)': {
      position: 'sticky',
      top: 'var(--space-md)',
      maxHeight: 'calc(100vh - var(--space-3xl))',
      overflow: 'hidden',
    },
  },
  sidebarCard: {
    display: 'grid',
    gap: '12px',
    minWidth: 0,
  },
  sessionHistoryScroll: {
    height: 'clamp(400px, 52vh, 620px)',
    minHeight: '400px',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    paddingRight: '2px',
    '@media (max-width: 1080px)': {
      height: 'auto',
      maxHeight: 'none',
      minHeight: 0,
      overflowY: 'visible',
      overscrollBehavior: 'auto',
    },
  },
  mainColumn: {
    display: 'grid',
    gap: 'var(--space-md)',
    minWidth: 0,
  },
  tabShell: {
    display: 'grid',
    gap: 'var(--space-md)',
    minWidth: 0,
  },
  topTabs: {
    borderBottom: '1px solid var(--color-border)',
    paddingBottom: '8px',
    minWidth: 0,
    overflowX: 'auto',
  },
  topTab: {
    fontWeight: '600',
    color: 'var(--color-text-secondary)',
    fontSize: 'var(--font-body-15-size)',
  },
  tabPanel: {
    display: 'grid',
    gap: 'var(--space-md)',
    minWidth: 0,
  },
  tabPanelCard: {
    display: 'grid',
    gap: 'var(--space-md)',
    minWidth: 0,
  },
  tabOverviewGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '10px',
    minWidth: 0,
  },
  overviewCard: {
    display: 'grid',
    gap: '8px',
    padding: '12px 14px',
    borderRadius: 'var(--radius-card)',
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-surface-elevated)',
    minWidth: 0,
    overflowWrap: 'anywhere',
  },
  overviewValue: {
    color: 'var(--color-text-primary)',
    fontFamily: 'var(--font-display)',
    fontSize: 'var(--font-display-lg-size)',
    lineHeight: 'var(--font-display-lg-line)',
    fontWeight: '600',
    letterSpacing: '-0.02em',
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
    display: 'block',
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
    marginTop: '2px',
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
    minWidth: 0,
    width: '100%',
  },
  sessionHistoryList: {
    display: 'grid',
    gap: '8px',
    marginTop: '12px',
  },
  sessionHistoryButton: {
    justifyContent: 'flex-start',
    minHeight: '68px',
    padding: '12px',
    border: '1px solid rgba(15, 42, 58, 0.1)',
    backgroundColor: 'rgba(255, 252, 247, 0.74)',
    borderBottom: '1px solid rgba(15, 42, 58, 0.12)',
    '@media (max-width: 720px)': {
      minHeight: '76px',
    },
  },
  sessionHistoryButtonSelected: {
    border: '1px solid rgba(13, 138, 132, 0.26)',
    backgroundColor: 'rgba(13, 138, 132, 0.08)',
  },
  sessionHistoryContent: {
    display: 'grid',
    gap: '6px',
    width: '100%',
  },
  sessionHistoryHeader: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gap: '8px',
    alignItems: 'start',
    width: '100%',
  },
  sessionHistoryTitleWrap: {
    display: 'grid',
    gap: '4px',
    minWidth: 0,
  },
  sessionHistoryTitle: {
    color: 'var(--color-text-primary)',
    fontSize: '0.82rem',
    fontWeight: '700',
    lineHeight: 1.25,
  },
  sessionHistoryMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    flexWrap: 'wrap',
    color: 'var(--color-text-tertiary)',
    fontSize: '0.7rem',
  },
  sessionHistoryScoreWrap: {
    display: 'grid',
    gap: '1px',
    justifyItems: 'end',
    textAlign: 'right',
    flexShrink: 0,
  },
  sessionHistoryScore: {
    color: 'var(--color-text-primary)',
    fontFamily: 'var(--font-display)',
    fontSize: '1.08rem',
    fontWeight: '800',
    lineHeight: 1,
    letterSpacing: '-0.03em',
  },
  sessionHistoryScoreLabel: {
    color: 'var(--color-text-tertiary)',
    fontSize: '0.62rem',
    fontWeight: '700',
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
  },
  sessionHistoryMetrics: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    flexWrap: 'wrap',
  },
  sessionHistoryMetric: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '2px 6px',
    border: '1px solid rgba(15, 42, 58, 0.1)',
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    color: 'var(--color-text-secondary)',
    fontSize: '0.66rem',
    lineHeight: 1.35,
    whiteSpace: 'nowrap',
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
    minWidth: 0,
  },
  scoreHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'start',
    gap: 'var(--space-md)',
    flexWrap: 'wrap',
    minWidth: 0,
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
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))',
    gap: 'var(--space-lg)',
    minWidth: 0,
    alignItems: 'start',
    width: '100%',
  },
  sectionTitle: {
    display: 'block',
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-primary)',
    marginBottom: '12px',
    fontSize: '0.95rem',
    fontWeight: '700',
    letterSpacing: '-0.02em',
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
    gridTemplateColumns: 'minmax(320px, 1.25fr) minmax(0, 1fr)',
    gap: '16px',
    alignItems: 'start',
    minWidth: 0,
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
    minWidth: 0,
    alignContent: 'start',
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
    backgroundColor: 'var(--color-surface-elevated)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text-primary)',
    fontSize: '0.84rem',
    lineHeight: 1.6,
    minWidth: 0,
    overflowWrap: 'anywhere',
  },
  textStack: {
    display: 'grid',
    gap: '4px',
    minWidth: 0,
  },
  markdownContent: {
    display: 'grid',
    gap: '6px',
    color: 'inherit',
    fontSize: 'inherit',
    lineHeight: 'inherit',
    minWidth: 0,
    overflowWrap: 'anywhere',
  },
  markdownParagraph: {
    margin: 0,
    whiteSpace: 'pre-wrap' as const,
    overflowWrap: 'anywhere',
  },
  markdownList: {
    margin: 0,
    paddingLeft: '18px',
    display: 'grid',
    gap: '4px',
  },
  markdownListItem: {
    margin: 0,
  },
  markdownCode: {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.8em',
    padding: '1px 4px',
    backgroundColor: 'rgba(15, 42, 58, 0.06)',
  },
  transcriptList: {
    display: 'grid',
    gap: '10px',
    minWidth: 0,
  },
  transcriptTurn: {
    display: 'grid',
    gap: '6px',
    padding: '12px 14px',
    border: '1px solid rgba(15, 42, 58, 0.12)',
    backgroundColor: 'rgba(255, 255, 255, 0.98)',
    minWidth: 0,
    overflowWrap: 'anywhere',
  },
  transcriptTurnUser: {
    border: '1px solid rgba(13, 138, 132, 0.18)',
    backgroundColor: 'rgba(13, 138, 132, 0.08)',
  },
  transcriptTurnAssistant: {
    border: '1px solid rgba(184, 148, 85, 0.18)',
    backgroundColor: 'rgba(242, 233, 216, 0.36)',
  },
  transcriptTurnLabel: {
    color: 'var(--color-text-tertiary)',
    fontSize: '0.68rem',
    fontWeight: '700',
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
  },
  transcript: {
    padding: 'var(--space-md)',
    borderRadius: 'var(--radius-card)',
    backgroundColor: 'var(--color-surface-elevated)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text-secondary)',
    whiteSpace: 'pre-wrap',
    lineHeight: 1.6,
    fontFamily: 'var(--font-mono)',
    fontSize: '0.8125rem',
    minWidth: 0,
    overflowWrap: 'anywhere',
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
    backgroundColor: 'var(--color-surface-elevated)',
    transition: 'border-color 120ms ease, background-color 120ms ease',
    ':focus-visible': {
      outline: '2px solid var(--color-primary)',
      outlineOffset: '2px',
      border: '1px solid transparent',
    },
  },
  planActions: {
    display: 'flex',
    gap: '6px',
    flexWrap: 'wrap',
  },
  planList: {
    display: 'grid',
    gap: '6px',
    minWidth: 0,
  },
  planItem: {
    padding: '12px 14px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-bg-card)',
    display: 'grid',
    gap: '2px',
    minWidth: 0,
    transition: 'background-color 120ms ease, border-color 120ms ease',
  },
  conversationItem: {
    padding: '12px 14px',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--color-bg-card)',
    border: '1px solid var(--color-border)',
    display: 'grid',
    gap: '2px',
    minWidth: 0,
    transition: 'background-color 120ms ease, border-color 120ms ease',
  },
  scoreBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: '100%',
    borderRadius: '9999px',
    paddingInline: '10px',
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-bg-card)',
    color: 'var(--color-text-primary)',
    whiteSpace: 'normal' as const,
    overflowWrap: 'anywhere',
    textAlign: 'center',
  },
  scoreBadgeTeal: {
    borderRadius: '9999px',
    paddingInline: '10px',
    border: '1px solid rgba(13, 138, 132, 0.26)',
    backgroundColor: 'rgba(13, 138, 132, 0.14)',
    color: 'var(--color-primary-dark)',
  },
  scoreBadgeSand: {
    borderRadius: '9999px',
    paddingInline: '10px',
    border: '1px solid rgba(184, 148, 85, 0.3)',
    backgroundColor: 'rgba(184, 148, 85, 0.14)',
    color: '#7a6131',
  },
  scoreBadgeInk: {
    borderRadius: '9999px',
    paddingInline: '10px',
    border: '1px solid rgba(15, 42, 58, 0.22)',
    backgroundColor: 'rgba(15, 42, 58, 0.1)',
    color: 'var(--color-text-primary)',
  },
  errorText: {
    color: '#7a6131',
  },
  memorySection: {
    display: 'grid',
    gap: '20px',
    paddingTop: '16px',
    borderTop: '1px solid var(--color-border)',
  },
  recommendationSection: {
    display: 'grid',
    gap: '12px',
    paddingTop: '12px',
    borderTop: '1px solid var(--color-border)',
    minWidth: 0,
  },
  recommendationComposer: {
    display: 'grid',
    gap: '12px',
    padding: '14px 16px',
    borderRadius: 'var(--radius-card)',
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-bg-muted)',
    minWidth: 0,
  },
  reportScopeGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '12px',
    '@media (max-width: 720px)': {
      gridTemplateColumns: '1fr',
    },
  },
  reportDateInput: {
    width: '100%',
    minHeight: '36px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid rgba(15, 42, 58, 0.14)',
    padding: '0 12px',
    font: 'inherit',
    color: 'var(--color-text-primary)',
    backgroundColor: 'var(--color-surface-elevated)',
    transition: 'border-color 120ms ease, background-color 120ms ease',
    ':focus-visible': {
      outline: '2px solid var(--color-primary)',
      outlineOffset: '2px',
      border: '1px solid transparent',
    },
  },
  reportSessionSelection: {
    display: 'grid',
    gap: '10px',
    padding: '14px 16px',
    borderRadius: 'var(--radius-card)',
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-bg-card)',
  },
  reportSessionSelectionList: {
    display: 'grid',
    gap: '8px',
    maxHeight: '280px',
    overflowY: 'auto' as const,
    paddingRight: '4px',
  },
  reportSessionOption: {
    display: 'grid',
    gridTemplateColumns: '18px minmax(0, 1fr)',
    gap: '10px',
    alignItems: 'start',
    padding: '10px 12px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-surface-elevated)',
    cursor: 'pointer',
    transition: 'background-color 120ms ease, border-color 120ms ease',
    ':hover': {
      backgroundColor: 'rgba(13, 138, 132, 0.06)',
    },
  },
  reportSessionOptionSelected: {
    border: '1px solid rgba(13, 138, 132, 0.24)',
    backgroundColor: 'rgba(13, 138, 132, 0.08)',
  },
  reportSessionCheckbox: {
    marginTop: '3px',
  },
  reportSessionCopy: {
    display: 'grid',
    gap: '4px',
    minWidth: 0,
  },
  recommendationLayout: {
    display: 'grid',
    gridTemplateColumns: 'minmax(220px, 300px) minmax(0, 1fr)',
    gap: '12px',
    minWidth: 0,
    alignItems: 'start',
    '@media (max-width: 1600px)': {
      gridTemplateColumns: '1fr',
    },
  },
  recommendationHistoryList: {
    display: 'grid',
    gap: '8px',
    minWidth: 0,
    alignContent: 'start',
  },
  recommendationHistoryButton: {
    justifyContent: 'flex-start',
    minHeight: '84px',
    padding: '14px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-bg-card)',
    width: '100%',
    minWidth: 0,
    transition: 'background-color 120ms ease, border-color 120ms ease',
    ':hover': {
      backgroundColor: 'rgba(13, 138, 132, 0.06)',
    },
  },
  recommendationHistoryButtonSelected: {
    border: '1px solid rgba(13, 138, 132, 0.22)',
    backgroundColor: 'rgba(13, 138, 132, 0.08)',
  },
  recommendationHistoryContent: {
    display: 'grid',
    gap: '8px',
    width: '100%',
    minWidth: 0,
  },
  recommendationDetail: {
    display: 'grid',
    gap: '12px',
    minWidth: 0,
    width: '100%',
    alignContent: 'start',
  },
  recommendationCandidate: {
    display: 'grid',
    gap: '10px',
    padding: '14px 16px',
    borderRadius: 'var(--radius-card)',
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-bg-card)',
    minWidth: 0,
    width: '100%',
    alignContent: 'start',
  },
  recommendationCandidateTop: {
    border: '1px solid rgba(13, 138, 132, 0.24)',
    backgroundColor: 'rgba(13, 138, 132, 0.08)',
  },
  recommendationFactorList: {
    display: 'grid',
    gap: '8px',
    minWidth: 0,
  },
  recommendationFactorItem: {
    display: 'grid',
    gap: '4px',
    padding: '10px 12px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid rgba(15, 42, 58, 0.08)',
    backgroundColor: 'var(--color-bg-muted)',
    minWidth: 0,
    overflowWrap: 'anywhere',
  },
  recommendationSessionList: {
    display: 'grid',
    gap: '8px',
    minWidth: 0,
  },
  recommendationSessionItem: {
    display: 'grid',
    gap: '6px',
    padding: '10px 12px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid rgba(15, 42, 58, 0.08)',
    backgroundColor: 'var(--color-bg-card)',
    minWidth: 0,
    overflowWrap: 'anywhere',
  },
  memorySummaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))',
    gap: '8px',
    minWidth: 0,
  },
  memoryCard: {
    display: 'grid',
    gap: '10px',
    padding: '14px 16px',
    borderRadius: 'var(--radius-card)',
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-bg-card)',
    minWidth: 0,
    overflowWrap: 'anywhere',
  },
  memoryList: {
    display: 'grid',
    gap: '8px',
    minWidth: 0,
  },
  memoryProposalCard: {
    display: 'grid',
    gap: '10px',
    padding: '14px 16px',
    borderRadius: 'var(--radius-card)',
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-bg-card)',
    minWidth: 0,
    overflow: 'hidden',
  },
  memoryActionRow: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    alignItems: 'center',
    width: '100%',
  },
  memoryComposer: {
    display: 'grid',
    gap: '12px',
    padding: '14px 16px',
    borderRadius: 'var(--radius-card)',
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-bg-muted)',
    minWidth: 0,
  },
  memoryComposerGrid: {
    display: 'grid',
    gridTemplateColumns: '180px minmax(0, 1fr)',
    gap: '12px',
    alignItems: 'start',
    '@media (max-width: 720px)': {
      gridTemplateColumns: '1fr',
    },
  },
  evidenceList: {
    display: 'grid',
    gap: '8px',
    minWidth: 0,
  },
  evidenceItem: {
    display: 'grid',
    gap: '6px',
    padding: '10px 12px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid rgba(15, 42, 58, 0.08)',
    backgroundColor: 'rgba(13, 138, 132, 0.06)',
    minWidth: 0,
    overflowWrap: 'anywhere',
  },
  evidenceMeta: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    alignItems: 'center',
    minWidth: 0,
  },
  evidenceButton: {
    justifyContent: 'flex-start',
    paddingLeft: 0,
    minHeight: 'auto',
    border: 'none',
    backgroundColor: 'transparent',
    color: 'var(--color-primary-dark)',
  },
  provenanceSection: {
    display: 'grid',
    gap: '12px',
    padding: '12px 0 4px',
    borderTop: '1px solid rgba(15, 42, 58, 0.08)',
  },
  provenanceHeader: {
    display: 'grid',
    gap: '4px',
  },
  provenanceMeta: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
})

const memoryCategoryLabels: Record<string, string> = {
  targets: 'Targets',
  effective_cues: 'Effective cues',
  ineffective_cues: 'Ineffective cues',
  preferences: 'Preferences',
  constraints: 'Constraints',
  blockers: 'Blockers',
  general: 'Other notes',
}

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

function formatDateInputValue(timestamp?: string | null) {
  const text = String(timestamp || '').trim()
  if (!text) return ''

  const match = text.match(/^(\d{4}-\d{2}-\d{2})/)
  if (match) {
    return match[1]
  }

  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) {
    return ''
  }

  return parsed.toISOString().slice(0, 10)
}

function toStartOfDayIso(dateValue: string) {
  return dateValue ? `${dateValue}T00:00:00+00:00` : undefined
}

function toEndOfDayIso(dateValue: string) {
  return dateValue ? `${dateValue}T23:59:59+00:00` : undefined
}

function sessionFallsWithinDateRange(session: SessionSummary, startDate: string, endDate: string) {
  const sessionDate = formatDateInputValue(session.timestamp)
  if (!sessionDate) return false
  if (startDate && sessionDate < startDate) return false
  if (endDate && sessionDate > endDate) return false
  return true
}

function getDefaultReportDateRange(sessions: SessionSummary[]) {
  if (!sessions.length) {
    return { start: '', end: '' }
  }

  const sortedDates = sessions
    .map(session => formatDateInputValue(session.timestamp))
    .filter(Boolean)
    .sort()

  return {
    start: sortedDates[0] || '',
    end: sortedDates[sortedDates.length - 1] || '',
  }
}

function buildChildMemoryItemMap(items: ChildMemoryItem[]) {
  return new Map(items.map(item => [item.id, item]))
}

function renderEvidenceLinks(
  links: ChildMemoryEvidenceLink[] | undefined,
  styles: ReturnType<typeof useStyles>,
  onOpenSession: (sessionId: string) => void
) {
  if (!links?.length) {
    return (
      <Text size={200}>
        No linked source evidence yet.
      </Text>
    )
  }

  return (
    <div className={styles.evidenceList}>
      {links.map(link => (
        <div className={styles.evidenceItem} key={link.id}>
          <div className={styles.evidenceMeta}>
            <Badge appearance="tint" className={styles.scoreBadge}>
              {link.evidence_kind}
            </Badge>
            {link.session_id ? (
              <Button
                appearance="subtle"
                className={styles.evidenceButton}
                onClick={() => {
                  onOpenSession(link.session_id as string)
                }}
              >
                Open source session
              </Button>
            ) : null}
          </div>
          <Text size={200}>{link.snippet || 'Saved evidence link.'}</Text>
        </div>
      ))}
    </div>
  )
}

function formatInstitutionalInsightType(type: InstitutionalMemoryInsight['insight_type']) {
  if (type === 'strategy_insight') return 'Clinic strategy'
  if (type === 'reviewed_pattern') return 'Reviewed pattern'
  return 'Recommendation tuning'
}

function renderInstitutionalInsights(
  insights: InstitutionalMemoryInsight[],
  styles: ReturnType<typeof useStyles>
) {
  return (
    <div className={styles.memoryList}>
      {insights.map(insight => {
        const deidentifiedChildCount = insight.provenance?.deidentified_child_count ?? insight.source_child_count
        const reviewedSessionCount = insight.provenance?.reviewed_session_count ?? insight.source_session_count
        const approvedMemoryItemCount = insight.provenance?.approved_memory_item_count ?? insight.source_memory_item_count

        return (
          <div className={styles.memoryCard} key={insight.id}>
            <div className={styles.summaryRow}>
              <Badge appearance="filled" className={styles.scoreBadgeTeal}>
                {formatInstitutionalInsightType(insight.insight_type)}
              </Badge>
              {insight.target_sound ? (
                <Badge appearance="tint" className={styles.scoreBadge}>
                  /{insight.target_sound}/
                </Badge>
              ) : null}
              <Badge appearance="tint" className={styles.scoreBadge}>
                {deidentifiedChildCount} children
              </Badge>
              <Badge appearance="tint" className={styles.scoreBadge}>
                {reviewedSessionCount} reviewed sessions
              </Badge>
              <Badge appearance="tint" className={styles.scoreBadge}>
                {approvedMemoryItemCount} approved memory items
              </Badge>
            </div>
            <div className={styles.textStack}>
              <Text size={300} weight="semibold">
                {insight.title}
              </Text>
              <Text size={200}>{insight.summary}</Text>
            </div>
          </div>
        )
      })}
    </div>
  )
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
    ? ''
    : ''
}

function SparseStateMarker({ className, dividerClassName }: { className: string; dividerClassName: string }) {
  return (
    <div className={className} aria-hidden="true">
      <span className={dividerClassName} />
      <svg viewBox="0 0 28 28" fill="none">
        <title>Dashboard state marker</title>
        <rect x="4" y="17" width="4" height="7" fill="currentColor" opacity="0.55" />
        <rect x="12" y="11" width="4" height="13" fill="currentColor" opacity="0.75" />
        <rect x="20" y="7" width="4" height="17" fill="currentColor" />
      </svg>
      <span className={dividerClassName} />
    </div>
  )
}

type TranscriptTurn = {
  role: 'user' | 'assistant' | 'other'
  content: string
}

function parseTranscriptTurns(transcript?: string | null): TranscriptTurn[] {
  if (!transcript?.trim()) return []

  const lines = transcript
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)

  const turns: TranscriptTurn[] = []

  for (const line of lines) {
    const match = line.match(/^(user|assistant)\s*:\s*(.*)$/i)

    if (match) {
      turns.push({
        role: match[1].toLowerCase() as 'user' | 'assistant',
        content: match[2].trim(),
      })
      continue
    }

    const previousTurn = turns[turns.length - 1]
    if (previousTurn) {
      previousTurn.content = `${previousTurn.content}\n${line}`.trim()
    } else {
      turns.push({ role: 'other', content: line })
    }
  }

  return turns
}

function renderMarkdown(content: string, styles: ReturnType<typeof useStyles>) {
  return (
    <div className={styles.markdownContent}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className={styles.markdownParagraph}>{children}</p>,
          ul: ({ children }) => <ul className={styles.markdownList}>{children}</ul>,
          ol: ({ children }) => <ol className={styles.markdownList}>{children}</ol>,
          li: ({ children }) => <li className={styles.markdownListItem}>{children}</li>,
          code: ({ children }) => <code className={styles.markdownCode}>{children}</code>,
          h1: ({ children }) => <p className={styles.markdownParagraph}><strong>{children}</strong></p>,
          h2: ({ children }) => <p className={styles.markdownParagraph}><strong>{children}</strong></p>,
          h3: ({ children }) => <p className={styles.markdownParagraph}><strong>{children}</strong></p>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

function isRecommendationEvidenceStale({
  recommendationCreatedAt,
  memoryCompiledAt,
  latestSessionAt,
  pendingProposalCount,
}: {
  recommendationCreatedAt?: string | null
  memoryCompiledAt?: string | null
  latestSessionAt?: string | null
  pendingProposalCount: number
}): boolean {
  if (!recommendationCreatedAt) return false
  const recommendationTimestamp = new Date(recommendationCreatedAt).getTime()
  if (!Number.isFinite(recommendationTimestamp)) return false
  if (pendingProposalCount > 0) return true
  const memoryTimestamp = memoryCompiledAt ? new Date(memoryCompiledAt).getTime() : Number.NaN
  if (Number.isFinite(memoryTimestamp) && memoryTimestamp > recommendationTimestamp) return true
  const sessionTimestamp = latestSessionAt ? new Date(latestSessionAt).getTime() : Number.NaN
  return Number.isFinite(sessionTimestamp) && sessionTimestamp > recommendationTimestamp
}

interface Props {
  childProfiles: ChildProfile[]
  selectedChildId: string | null
  sessions: SessionSummary[]
  selectedSession: SessionDetail | null
  selectedPlan: PracticePlan | null
  progressReports: ProgressReport[]
  selectedReport: ProgressReport | null
  childMemorySummary: ChildMemorySummary | null
  childMemoryItems: ChildMemoryItem[]
  childMemoryProposals: ChildMemoryProposal[]
  recommendationHistory: RecommendationLog[]
  selectedRecommendationDetail: RecommendationDetail | null
  plannerReadiness: PlannerReadiness | null
  loadingChildren: boolean
  loadingSessions: boolean
  loadingSessionDetail: boolean
  loadingPlans: boolean
  loadingReports: boolean
  loadingMemory: boolean
  loadingRecommendations: boolean
  planSaving: boolean
  reportSaving: boolean
  recommendationSaving: boolean
  planError: string | null
  reportError: string | null
  memoryError: string | null
  recommendationError: string | null
  memoryReviewPendingId: string | null
  manualMemorySaving: boolean
  onSelectChild: (childId: string) => void
  onOpenSession: (sessionId: string) => void
  onOpenRecommendationDetail: (recommendationId: string) => void | Promise<void>
  onOpenReportDetail: (reportId: string) => void | Promise<void>
  onCreateReport: (payload: ProgressReportCreateRequest) => ReportSaveResult | Promise<ReportSaveResult>
  onUpdateReport: (payload: ProgressReportUpdateRequest) => ReportSaveResult | Promise<ReportSaveResult>
  onSuggestReportSummaryRewrite: (reportId: string) => Promise<ProgressReportSummaryRewriteSuggestion | null>
  onOpenReportExport: (reportId: string, options?: { mode?: ReportExportMode; format?: ReportExportFormat }) => void
  onApproveReport: () => void | Promise<void>
  onSignReport: () => void | Promise<void>
  onArchiveReport: () => void | Promise<void>
  onGenerateRecommendations: (therapistConstraints: string) => void | Promise<void>
  onCreatePlan: (message: string) => void | Promise<void>
  onRefinePlan: (message: string) => void | Promise<void>
  onApprovePlan: () => void | Promise<void>
  onApproveMemoryProposal: (proposalId: string) => void | Promise<void>
  onRejectMemoryProposal: (proposalId: string) => void | Promise<void>
  onCreateMemoryItem: (category: ChildMemoryCategory, statement: string) => void | Promise<void>
  onBackToPractice: () => void
  onExitToEntry: () => void
  initialTab?: DashboardTab
}

type DashboardTab = 'session-detail' | 'memory' | 'recommendations' | 'reports' | 'plan'

export function ProgressDashboard({
  childProfiles,
  selectedChildId,
  sessions,
  selectedSession,
  selectedPlan,
  progressReports,
  selectedReport,
  childMemorySummary,
  childMemoryItems,
  childMemoryProposals,
  recommendationHistory,
  selectedRecommendationDetail,
  plannerReadiness,
  loadingChildren,
  loadingSessions,
  loadingSessionDetail,
  loadingPlans,
  loadingReports,
  loadingMemory,
  loadingRecommendations,
  planSaving,
  reportSaving,
  recommendationSaving,
  planError,
  reportError,
  memoryError,
  recommendationError,
  memoryReviewPendingId,
  manualMemorySaving,
  onSelectChild,
  onOpenSession,
  onOpenRecommendationDetail,
  onOpenReportDetail,
  onCreateReport,
  onUpdateReport,
  onSuggestReportSummaryRewrite,
  onOpenReportExport,
  onApproveReport,
  onSignReport,
  onArchiveReport,
  onGenerateRecommendations,
  onCreatePlan,
  onRefinePlan,
  onApprovePlan,
  onApproveMemoryProposal,
  onRejectMemoryProposal,
  onCreateMemoryItem,
  onBackToPractice,
  onExitToEntry,
  initialTab,
}: Props) {
  const styles = useStyles()
  const [planPrompt, setPlanPrompt] = useState('')
  const [recommendationPrompt, setRecommendationPrompt] = useState('')
  const [reportAudience, setReportAudience] = useState<ProgressReportAudience>('therapist')
  const [reportTitle, setReportTitle] = useState('')
  const [reportSummary, setReportSummary] = useState('')
  const [reportSummarySuggestion, setReportSummarySuggestion] = useState<ProgressReportSummaryRewriteSuggestion | null>(null)
  const [reportPeriodStartDate, setReportPeriodStartDate] = useState('')
  const [reportPeriodEndDate, setReportPeriodEndDate] = useState('')
  const [reportSelectedSessionIds, setReportSelectedSessionIds] = useState<string[]>([])
  const [reportRedactionOverrides, setReportRedactionOverrides] = useState<NormalizedReportRedactionOverrides>(() => normalizeReportRedactionOverrides({}, 'therapist'))
  const [manualMemoryCategory, setManualMemoryCategory] = useState<ChildMemoryCategory>('general')
  const [manualMemoryStatement, setManualMemoryStatement] = useState('')
  const [breakdownViewBySession, setBreakdownViewBySession] = useState<Record<string, 'articulation' | 'engagement'>>({})
  const [activeTab, setActiveTab] = useState<DashboardTab>(initialTab ?? 'session-detail')
  const [reportSourceFilter, setReportSourceFilter] = useState<'all' | 'pipeline' | 'ai_insight' | 'manual'>('all')
  const [reportReviewAcknowledgedId, setReportReviewAcknowledgedId] = useState<string | null>(null)
  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab)
    }
  }, [initialTab])
  const plannerReady = plannerReadiness?.ready ?? false
  const aiAssessment = selectedSession?.assessment.ai_assessment
  const pronunciationAssessment = selectedSession?.assessment.pronunciation_assessment
  const selectedChild = childProfiles.find(child => child.id === selectedChildId) || null
  const averageScore = getAverageScore(sessions)
  const trendLabel = getTrendLabel(sessions)
  const trendChartData = getTrendChartData(sessions, formatShortDate, formatTimestamp)
  const soundBreakdown = getSoundAccuracyBreakdown(sessions)
  const reportSessionsInRange = sessions.filter(session => sessionFallsWithinDateRange(session, reportPeriodStartDate, reportPeriodEndDate))
  const reportComposerCanSubmit = Boolean(selectedChildId && reportSelectedSessionIds.length > 0)
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
  const transcriptTurns = parseTranscriptTurns(selectedSession?.transcript)
  const celebrationCount = aiAssessment?.celebration_points?.length ?? 0
  const hasArticulationBreakdown = Boolean(aiAssessment?.articulation_clarity)
  const hasEngagementBreakdown = Boolean(aiAssessment?.engagement_and_effort)
  const selectedSessionBreakdown = selectedSession?.id ? breakdownViewBySession[selectedSession.id] : undefined
  const activeBreakdown = hasArticulationBreakdown && hasEngagementBreakdown
    ? selectedSessionBreakdown ?? 'articulation'
    : hasArticulationBreakdown
      ? 'articulation'
      : 'engagement'
  const summarySections = Object.entries(childMemorySummary?.summary ?? {}).filter(
    ([, items]) => Array.isArray(items) && items.length > 0
  )
  const childMemoryItemMap = buildChildMemoryItemMap(childMemoryItems)
  const planMemorySnapshot = selectedPlan?.constraints.child_memory_snapshot
  const planMemoryItems = Array.isArray(planMemorySnapshot?.used_items) ? planMemorySnapshot.used_items : []
  const institutionalMemorySnapshot = selectedRecommendationDetail?.ranking_context?.institutional_memory
  const institutionalInsights = Array.isArray(institutionalMemorySnapshot?.insights)
    ? institutionalMemorySnapshot.insights
    : []
  const sharedReportSectionOptions = getSharedReportSectionOptions(reportAudience)
  const hiddenSharedSectionCount = reportRedactionOverrides.hidden_section_keys.length
  const hiddenSharedFieldCount = SHARED_REPORT_REDACTION_OPTIONS.filter(option => reportRedactionOverrides[option.key]).length

  useEffect(() => {
    if (selectedReport) {
      const selectedIds = selectedReport.included_session_ids.length
        ? selectedReport.included_session_ids
        : sessions
          .filter(session => sessionFallsWithinDateRange(
            session,
            formatDateInputValue(selectedReport.period_start),
            formatDateInputValue(selectedReport.period_end),
          ))
          .map(session => session.id)

      setReportAudience(selectedReport.audience)
      setReportTitle(selectedReport.title)
      setReportSummary(selectedReport.summary_text || '')
      setReportSummarySuggestion(null)
      setReportPeriodStartDate(formatDateInputValue(selectedReport.period_start))
      setReportPeriodEndDate(formatDateInputValue(selectedReport.period_end))
      setReportSelectedSessionIds(selectedIds)
      setReportRedactionOverrides(normalizeReportRedactionOverrides(selectedReport.redaction_overrides, selectedReport.audience))
      return
    }

    if (!sessions.length) {
      setReportAudience('therapist')
      setReportTitle('')
      setReportSummary('')
      setReportSummarySuggestion(null)
      setReportPeriodStartDate('')
      setReportPeriodEndDate('')
      setReportSelectedSessionIds([])
      setReportRedactionOverrides(normalizeReportRedactionOverrides({}, 'therapist'))
      return
    }

    const defaultRange = getDefaultReportDateRange(sessions)
    setReportPeriodStartDate(current => current || defaultRange.start)
    setReportPeriodEndDate(current => current || defaultRange.end)
    setReportSelectedSessionIds(current => current.length ? current.filter(id => sessions.some(session => session.id === id)) : sessions.map(session => session.id))
  }, [selectedReport, sessions])

  function setSessionBreakdownView(view: 'articulation' | 'engagement') {
    if (!selectedSession?.id) return

    setBreakdownViewBySession(current => ({
      ...current,
      [selectedSession.id]: view,
    }))
  }

  function handleCreateManualMemory() {
    const normalizedStatement = manualMemoryStatement.trim()
    if (!normalizedStatement) {
      return
    }

    Promise.resolve(onCreateMemoryItem(manualMemoryCategory, normalizedStatement)).then(() => {
      setManualMemoryStatement('')
      setManualMemoryCategory('general')
    })
  }

  function handleGenerateRecommendation() {
    Promise.resolve(onGenerateRecommendations(recommendationPrompt.trim())).then(() => {
      setRecommendationPrompt('')
    })
  }

  function updateReportWindow(nextStartDate: string, nextEndDate: string) {
    setReportPeriodStartDate(nextStartDate)
    setReportPeriodEndDate(nextEndDate)
    setReportSelectedSessionIds(current => current.filter(id => {
      const matchingSession = sessions.find(session => session.id === id)
      return matchingSession ? sessionFallsWithinDateRange(matchingSession, nextStartDate, nextEndDate) : false
    }))
  }

  function toggleReportSession(sessionId: string) {
    setReportSelectedSessionIds(current => (
      current.includes(sessionId)
        ? current.filter(id => id !== sessionId)
        : [...current, sessionId]
    ))
  }

  function handleSelectAllReportSessions() {
    setReportSelectedSessionIds(reportSessionsInRange.map(session => session.id))
  }

  function handleClearReportSessions() {
    setReportSelectedSessionIds([])
  }

  function handleReportAudienceChange(nextAudience: ProgressReportAudience) {
    setReportAudience(nextAudience)
    setReportRedactionOverrides(current => normalizeReportRedactionOverrides(current, nextAudience))
  }

  function handleReportSummaryChange(nextSummary: string) {
    setReportSummary(nextSummary)
    setReportSummarySuggestion(null)
  }

  function toggleReportRedactionOverride(key: SharedReportRedactionToggle) {
    setReportRedactionOverrides(current => normalizeReportRedactionOverrides({
      ...current,
      [key]: !current[key],
    }, reportAudience))
  }

  function toggleReportSectionVisibility(sectionKey: string) {
    setReportRedactionOverrides(current => {
      const hiddenKeys = current.hidden_section_keys.includes(sectionKey)
        ? current.hidden_section_keys.filter(key => key !== sectionKey)
        : [...current.hidden_section_keys, sectionKey]

      return normalizeReportRedactionOverrides(
        {
          ...current,
          hidden_section_keys: hiddenKeys,
        },
        reportAudience,
      )
    })
  }

  function buildReportComposerPayload(): ProgressReportCreateRequest {
    return {
      audience: reportAudience,
      title: reportTitle.trim() || undefined,
      summary_text: reportSummary.trim() || undefined,
      period_start: toStartOfDayIso(reportPeriodStartDate),
      period_end: toEndOfDayIso(reportPeriodEndDate),
      included_session_ids: reportSelectedSessionIds,
      redaction_overrides: buildPersistedReportRedactionOverrides(reportRedactionOverrides, reportAudience),
    }
  }

  function handleCreateReport() {
    Promise.resolve(onCreateReport(buildReportComposerPayload())).then(result => {
      if (result === null) {
        return
      }
      setActiveTab('reports')
    })
  }

  function handleSaveReport() {
    if (!selectedReport) {
      return
    }

    Promise.resolve(onUpdateReport(buildReportComposerPayload())).then(result => {
      if (result === null) {
        return
      }
      setReportSummarySuggestion(null)
      setActiveTab('reports')
    })
  }

  function handleSuggestReportSummaryRewrite() {
    if (!selectedReport || selectedReport.status !== 'draft') {
      return
    }

    void (async () => {
      const result = await onUpdateReport(buildReportComposerPayload())
      if (!result) {
        return
      }

      const suggestion = await onSuggestReportSummaryRewrite(result.id)
      if (!suggestion) {
        return
      }

      setReportSummarySuggestion(suggestion)
    })()
  }

  function handleApplySuggestedReportSummary() {
    if (!reportSummarySuggestion) {
      return
    }

    setReportSummary(reportSummarySuggestion.suggested_summary_text)
    setReportSummarySuggestion(null)
  }

  function handleOpenSelectedReportExport(format: ReportExportFormat, mode: ReportExportMode = 'preview') {
    if (!selectedReport) {
      return
    }

    // Phase 1 AI-draft review gate: exports for `source==='ai_insight'` drafts
    // require the therapist to tick the "Reviewed — OK to export" checkbox.
    // We rely on the disabled state for UI, but belt-and-braces here too.
    if (selectedReport.source === 'ai_insight' && reportReviewAcknowledgedId !== selectedReport.id) {
      return
    }

    const openExport = () => onOpenReportExport(selectedReport.id, { format, mode })
    if (selectedReport.status !== 'draft') {
      openExport()
      return
    }

    Promise.resolve(onUpdateReport(buildReportComposerPayload())).then(result => {
      if (result === null) {
        return
      }
      openExport()
    })
  }

  function handleTabSelect(_: unknown, data: { value: TabValue }) {
    if (typeof data.value === 'string') {
      setActiveTab(data.value as DashboardTab)
    }
  }

  const sessionOverviewCards = selectedSession ? [
    {
      label: 'Session date',
      value: formatShortDate(selectedSession.timestamp),
      copy: formatTimestamp(selectedSession.timestamp),
    },
    {
      label: 'Overall score',
      value: String(aiAssessment?.overall_score ?? '—'),
      copy: selectedSession.exercise.name,
    },
    {
      label: 'Transcript turns',
      value: String(transcriptTurns.length || 0),
      copy: transcriptTurns.length > 1 ? 'Parsed conversation turns.' : 'No structured turns detected.',
    },
  ] : []

  const memoryOverviewCards = [
    {
      label: 'Approved memory',
      value: String(childMemorySummary?.source_item_count ?? 0),
      copy: childMemorySummary?.last_compiled_at
        ? `Updated ${formatTimestamp(childMemorySummary.last_compiled_at)}`
        : 'No compiled summary yet.',
    },
    {
      label: 'Pending review',
      value: String(childMemoryProposals.length),
      copy: childMemoryProposals.length
        ? 'Review the latest proposed memory updates.'
        : 'No pending proposals right now.',
    },
    {
      label: 'Planner signal',
      value: childMemorySummary?.summary_text ? 'Ready' : 'Limited',
      copy: childMemorySummary?.summary_text || 'Approved memory will appear here once it has been reviewed.',
    },
  ]

  const latestRecommendationLog = recommendationHistory[0] ?? null

  const recommendationOverviewCards = [
    {
      label: 'Saved runs',
      value: String(recommendationHistory.length),
      copy: recommendationHistory.length ? 'Most recent recommendation runs stay inspectable.' : 'No recommendation runs saved yet.',
    },
    {
      label: 'Target sound',
      value: selectedRecommendationDetail?.target_sound ? `/${selectedRecommendationDetail.target_sound}/` : '—',
      copy: selectedRecommendationDetail ? formatTimestamp(selectedRecommendationDetail.created_at) : 'Open a saved run to inspect it.',
    },
    {
      label: 'Ranked options',
      value: String(selectedRecommendationDetail?.candidate_count ?? 0),
      copy: selectedRecommendationDetail?.rationale || 'Each run preserves ranking rationale and evidence.',
    },
    {
      label: 'Evidence status',
      value: !latestRecommendationLog
        ? 'Not run'
        : isRecommendationEvidenceStale({
            recommendationCreatedAt: latestRecommendationLog.created_at,
            memoryCompiledAt: childMemorySummary?.last_compiled_at,
            latestSessionAt: selectedChild?.last_session_at,
            pendingProposalCount: childMemoryProposals.length,
          })
          ? 'Stale'
          : 'Current',
      copy: !latestRecommendationLog
        ? 'A saved recommendation run is required before evidence freshness can be evaluated.'
        : childMemoryProposals.length > 0
          ? 'Pending memory proposals mean the saved recommendation may be missing newly proposed evidence.'
          : 'Supporting sessions and approved memory are aligned with the latest saved run.',
    },
  ]

  const planOverviewCards = [
    {
      label: 'Planner',
      value: plannerReady ? 'Ready' : 'Limited',
      copy: plannerReady ? 'Recommendation and plan generation are available.' : 'Planner context is not ready for this child yet.',
    },
    {
      label: 'Plan status',
      value: selectedPlan ? (selectedPlan.status === 'approved' ? 'Approved' : 'Draft') : 'None',
      copy: selectedPlan ? `${selectedPlan.draft.estimated_duration_minutes} min next-session draft.` : 'No plan saved for this child yet.',
    },
    {
      label: 'Memory inputs',
      value: String(planMemoryItems.length || planMemorySnapshot?.used_item_ids.length || 0),
      copy: planMemorySnapshot?.summary_last_compiled_at
        ? `Snapshot ${formatTimestamp(planMemorySnapshot.summary_last_compiled_at)}`
        : 'Memory snapshot appears when a plan has been generated.',
    },
  ]

  const reportOverviewCards = [
    {
      label: 'Saved reports',
      value: String(progressReports.length),
      copy: progressReports.length ? 'Each report keeps its audience, snapshot, and approval state.' : 'No reports have been created for this child yet.',
    },
    {
      label: 'Selected audience',
      value: selectedReport ? selectedReport.audience : reportAudience,
      copy: selectedReport ? formatTimestamp(selectedReport.updated_at) : 'Choose an audience profile before generating a draft.',
    },
    {
      label: 'Included sessions',
      value: String(selectedReport?.included_session_ids.length ?? 0),
      copy: selectedReport?.summary_text || 'Reports compile saved session reviews, approved memory, planning, and recommendation context.',
    },
  ]

  return (
    <div className={styles.shell}>
      <div className={styles.hero}>
        <div className={styles.header}>
          <div className={styles.headerCopy}>
            <Text className={styles.eyebrow}>Therapist analytics</Text>
            <Text className={styles.title} size={700} weight="semibold">
              Session intelligence dashboard
            </Text>
            {heroSubtitle ? (
              <Text className={styles.subtitle} size={300}>
                {heroSubtitle}
              </Text>
            ) : null}
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
        <div className={styles.sidebar}>
          <Card className={mergeClasses(styles.card, styles.sidebarCard)}>
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

          <Card className={mergeClasses(styles.card, styles.sidebarCard)}>
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
                <div className={styles.sessionHistoryScroll}>
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
                </div>
              </>
            )}
          </Card>
        </div>

        <div className={styles.mainColumn}>
          <Card className={mergeClasses(styles.card, styles.tabShell)}>
            <CardHeader
              header={
                <Text className={styles.columnTitle} size={500} weight="semibold">
                  Review workspace
                </Text>
              }
            />

            <TabList selectedValue={activeTab} onTabSelect={handleTabSelect} className={styles.topTabs}>
              <Tab className={styles.topTab} value="session-detail">Session detail</Tab>
              <Tab className={styles.topTab} value="memory">Memory</Tab>
              <Tab className={styles.topTab} value="recommendations">Recommendations</Tab>
              <Tab className={styles.topTab} value="reports">Reports</Tab>
              <Tab className={styles.topTab} value="plan">Plan</Tab>
            </TabList>

            {activeTab === 'session-detail' ? (
              <div className={styles.tabPanel}>
                <div className={styles.tabOverviewGrid}>
                  {sessionOverviewCards.map(card => (
                    <div className={styles.overviewCard} key={card.label}>
                      <Text className={styles.combinedReviewLabel}>{card.label}</Text>
                      <Text className={styles.overviewValue}>{card.value}</Text>
                      <Text size={200}>{card.copy}</Text>
                    </div>
                  ))}
                </div>

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
                          {renderMarkdown(point, styles)}
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
                          {renderMarkdown(suggestion, styles)}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className={styles.notePanel}>
                  <Text className={styles.combinedReviewLabel}>Therapist note</Text>
                  <div className={styles.textItem}>
                    {renderMarkdown(aiAssessment?.therapist_notes || 'No therapist notes saved for this session.', styles)}
                  </div>
                </div>
              </div>

              {selectedSession.transcript ? (
                <div>
                  <Text className={styles.sectionTitle} size={400} weight="semibold">
                    Transcript
                  </Text>
                  <div className={styles.transcript}>
                    {transcriptTurns.length > 1 ? (
                      <div className={styles.transcriptList}>
                        {transcriptTurns.map((turn, index) => (
                          <div
                            className={mergeClasses(
                              styles.transcriptTurn,
                              turn.role === 'user' && styles.transcriptTurnUser,
                              turn.role === 'assistant' && styles.transcriptTurnAssistant
                            )}
                            key={`${turn.role}-${index}-${turn.content}`}
                          >
                            <Text className={styles.transcriptTurnLabel} size={200}>
                              {turn.role === 'user' ? 'User' : turn.role === 'assistant' ? 'Assistant' : 'Transcript'}
                            </Text>
                            {renderMarkdown(turn.content, styles)}
                          </div>
                        ))}
                      </div>
                    ) : (
                      renderMarkdown(selectedSession.transcript, styles)
                    )}
                  </div>
                </div>
              ) : null}
                  </div>
                )}
              </div>
            ) : null}

            {activeTab === 'memory' ? (
              <div className={mergeClasses(styles.tabPanel, styles.tabPanelCard)}>
                <div className={styles.tabOverviewGrid}>
                  {memoryOverviewCards.map(card => (
                    <div className={styles.overviewCard} key={card.label}>
                      <Text className={styles.combinedReviewLabel}>{card.label}</Text>
                      <Text className={styles.overviewValue}>{card.value}</Text>
                      <Text size={200}>{card.copy}</Text>
                    </div>
                  ))}
                </div>
                <div className={styles.memorySection}>
                  <div>
                    <Text className={styles.sectionTitle} size={400} weight="semibold">
                      Child memory review
                    </Text>
                    <Text className={styles.helperText} size={300}>
                      Approved memory feeds planning context. Pending proposals stay separate until a therapist reviews them.
                    </Text>
                  </div>

                  {loadingMemory ? (
                    <div className={styles.loading}>
                      <Spinner size="medium" />
                    </div>
                  ) : (
                    <>
                      {summarySections.length ? (
                        <div className={styles.memoryList}>
                          {summarySections.map(([category, items]) => (
                            <div className={styles.memoryCard} key={category}>
                              <div className={styles.summaryRow}>
                                <Badge appearance="tint" className={styles.scoreBadge}>
                                  {memoryCategoryLabels[category] || category}
                                </Badge>
                                <Text size={200}>{items.length} approved</Text>
                              </div>
                              <div className={styles.textList}>
                                {items.map(item => (
                                  <div className={styles.textItem} key={`${category}-${item.id ?? item.statement}`}>
                                    <div className={styles.textStack}>
                                      <Text size={300} weight="semibold">
                                        {item.statement}
                                      </Text>
                                      {item.confidence != null ? (
                                        <Text size={200}>Confidence {Math.round(item.confidence * 100)}%</Text>
                                      ) : null}
                                    </div>
                                    {item.id ? renderEvidenceLinks(childMemoryItemMap.get(item.id)?.evidence_links, styles, onOpenSession) : null}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className={styles.emptyState}>
                          <Text>No approved child memory has been compiled yet.</Text>
                        </div>
                      )}

                      <div>
                        <Text className={styles.sectionTitle} size={300} weight="semibold">
                          Therapist memory note
                        </Text>
                        <div className={styles.memoryComposer}>
                          <Text size={200}>
                            Add a therapist-authored approved memory item when you need to preserve a clinically useful fact without waiting for synthesis.
                          </Text>
                          <div className={styles.memoryComposerGrid}>
                            <Field label="Category">
                              <Dropdown
                                selectedOptions={[manualMemoryCategory]}
                                value={memoryCategoryLabels[manualMemoryCategory] || manualMemoryCategory}
                                onOptionSelect={(_, data) => {
                                  if (data.optionValue) {
                                    setManualMemoryCategory(data.optionValue as ChildMemoryCategory)
                                  }
                                }}
                              >
                                {Object.entries(memoryCategoryLabels).map(([value, label]) => (
                                  <Option key={value} value={value} text={label}>
                                    {label}
                                  </Option>
                                ))}
                              </Dropdown>
                            </Field>
                            <Field label="Statement">
                              <Textarea
                                value={manualMemoryStatement}
                                resize="vertical"
                                placeholder="Example: Amina settles faster with short visual models."
                                onChange={(_, data) => setManualMemoryStatement(data.value)}
                              />
                            </Field>
                          </div>
                          <div className={styles.memoryActionRow}>
                            <Button
                              appearance="primary"
                              disabled={manualMemorySaving || !manualMemoryStatement.trim()}
                              onClick={handleCreateManualMemory}
                            >
                              {manualMemorySaving ? 'Saving…' : 'Save approved memory'}
                            </Button>
                          </div>
                        </div>
                      </div>

                      <div>
                        <Text className={styles.sectionTitle} size={300} weight="semibold">
                          Pending proposals
                        </Text>
                        {childMemoryProposals.length ? (
                          <div className={styles.memoryList}>
                            {childMemoryProposals.map(proposal => {
                              const sessionIds = Array.isArray(proposal.provenance?.session_ids)
                                ? proposal.provenance.session_ids.length
                                : 0

                              return (
                                <div className={styles.memoryProposalCard} key={proposal.id}>
                                  <div className={styles.summaryRow}>
                                    <Badge appearance="filled" className={styles.scoreBadgeSand}>
                                      {memoryCategoryLabels[proposal.category] || proposal.category}
                                    </Badge>
                                    <Badge appearance="tint" className={styles.scoreBadge}>
                                      {proposal.memory_type}
                                    </Badge>
                                    {proposal.confidence != null ? (
                                      <Badge appearance="tint" className={styles.scoreBadge}>
                                        {Math.round(proposal.confidence * 100)}% confidence
                                      </Badge>
                                    ) : null}
                                  </div>
                                  <div className={styles.textItem}>
                                    <div className={styles.textStack}>
                                      <Text size={300} weight="semibold">
                                        {proposal.statement}
                                      </Text>
                                      <Text size={200}>
                                        {sessionIds
                                          ? `Linked to ${sessionIds} session${sessionIds === 1 ? '' : 's'}.`
                                          : 'Awaiting therapist review.'}
                                      </Text>
                                    </div>
                                    {renderEvidenceLinks(proposal.evidence_links, styles, onOpenSession)}
                                  </div>
                                  <div className={styles.memoryActionRow}>
                                    <Button
                                      appearance="primary"
                                      onClick={() => {
                                        void onApproveMemoryProposal(proposal.id)
                                      }}
                                      disabled={memoryReviewPendingId === proposal.id}
                                    >
                                      {memoryReviewPendingId === proposal.id ? 'Saving…' : 'Approve'}
                                    </Button>
                                    <Button
                                      appearance="secondary"
                                      onClick={() => {
                                        void onRejectMemoryProposal(proposal.id)
                                      }}
                                      disabled={memoryReviewPendingId === proposal.id}
                                    >
                                      Reject
                                    </Button>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        ) : (
                          <div className={styles.emptyState}>
                            <Text>No pending child memory proposals for this child.</Text>
                          </div>
                        )}
                      </div>

                      {memoryError ? (
                        <Text className={styles.errorText} size={300}>
                          {memoryError}
                        </Text>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            ) : null}

            {activeTab === 'recommendations' ? (
              <div className={mergeClasses(styles.tabPanel, styles.tabPanelCard)}>
                <div className={styles.tabOverviewGrid}>
                  {recommendationOverviewCards.map(card => (
                    <div className={styles.overviewCard} key={card.label}>
                      <Text className={styles.combinedReviewLabel}>{card.label}</Text>
                      <Text className={styles.overviewValue}>{card.value}</Text>
                      <Text size={200}>{card.copy}</Text>
                    </div>
                  ))}
                </div>
                <div className={styles.recommendationSection}>
                  <div>
                    <Text className={styles.sectionTitle} size={400} weight="semibold">
                      Next-exercise recommendations
                    </Text>
                    <Text className={styles.helperText} size={300}>
                      Generate a therapist-facing ranking from approved memory, recent sessions, difficulty progression, and your note for this run. Each result stays inspectable through saved scoring reasons and source evidence.
                    </Text>
                  </div>

                  <div className={styles.recommendationComposer}>
                    <Text size={200}>
                      Add an optional therapist note to steer this ranking run.
                    </Text>
                    <Field label="Therapist note for ranking">
                      <Textarea
                        value={recommendationPrompt}
                        resize="vertical"
                        placeholder="Example: Keep this playful, avoid moving above medium difficulty, and favour cues that use short verbal models."
                        onChange={(_, data) => setRecommendationPrompt(data.value)}
                      />
                    </Field>
                    <div className={styles.memoryActionRow}>
                      <Button
                        appearance="primary"
                        disabled={recommendationSaving || !plannerReady || !selectedChildId}
                        onClick={handleGenerateRecommendation}
                      >
                        {recommendationSaving ? 'Generating…' : plannerReady ? 'Generate recommendations' : 'Planner unavailable'}
                      </Button>
                      {selectedRecommendationDetail?.target_sound ? (
                        <Badge appearance="tint" className={styles.scoreBadge}>
                          Target /{selectedRecommendationDetail.target_sound}/
                        </Badge>
                      ) : null}
                      {selectedRecommendationDetail?.candidate_count ? (
                        <Badge appearance="tint" className={styles.scoreBadge}>
                          {selectedRecommendationDetail.candidate_count} ranked candidates
                        </Badge>
                      ) : null}
                    </div>
                  </div>

                  {recommendationError ? (
                    <Text className={styles.errorText} size={300}>
                      {recommendationError}
                    </Text>
                  ) : null}

                  {loadingRecommendations && !selectedRecommendationDetail && recommendationHistory.length === 0 ? (
                    <div className={styles.loading}>
                      <Spinner size="medium" />
                    </div>
                  ) : recommendationHistory.length === 0 && !selectedRecommendationDetail ? (
                    <div className={styles.emptyState}>
                      <Text>No recommendation runs have been saved for this child yet. Generate one to compare the ranked options and inspect the evidence behind them.</Text>
                    </div>
                  ) : (
                    <div className={styles.recommendationLayout}>
                      <div className={styles.recommendationHistoryList}>
                        <Text className={styles.sectionTitle} size={300} weight="semibold">
                          Recommendation history
                        </Text>
                        <Text className={styles.helperText} size={200}>
                          Most recent first. Open any saved run to inspect how the ranking was produced.
                        </Text>
                        {recommendationHistory.map(recommendation => {
                          const isSelected = recommendation.id === selectedRecommendationDetail?.id

                          return (
                            <Button
                              appearance="subtle"
                              className={mergeClasses(
                                styles.recommendationHistoryButton,
                                isSelected && styles.recommendationHistoryButtonSelected
                              )}
                              key={recommendation.id}
                              onClick={() => {
                                void onOpenRecommendationDetail(recommendation.id)
                              }}
                            >
                              <div className={styles.recommendationHistoryContent}>
                                <div className={styles.summaryRow}>
                                  <Badge appearance="filled" className={styles.scoreBadgeTeal}>
                                    /{recommendation.target_sound}/
                                  </Badge>
                                  {recommendation.top_recommendation ? (
                                    <Badge appearance="tint" className={styles.scoreBadge}>
                                      Score {recommendation.top_recommendation.score}
                                    </Badge>
                                  ) : null}
                                </div>
                                <Text size={300} weight="semibold">
                                  {recommendation.top_recommendation?.exercise_name || 'Recommendation run'}
                                </Text>
                                <Text size={200}>{formatTimestamp(recommendation.created_at)}</Text>
                                <Text size={200}>{recommendation.rationale}</Text>
                              </div>
                            </Button>
                          )
                        })}
                      </div>

                      <div className={styles.recommendationDetail}>
                        {selectedRecommendationDetail ? (
                          <>
                            <div className={styles.memorySummaryGrid}>
                              <div className={styles.memoryCard}>
                                <Text className={styles.combinedReviewLabel}>Current target</Text>
                                <Text size={500} weight="semibold">/{selectedRecommendationDetail.target_sound}/</Text>
                                <Text size={200}>{formatTimestamp(selectedRecommendationDetail.created_at)}</Text>
                              </div>

                              <div className={styles.memoryCard}>
                                <Text className={styles.combinedReviewLabel}>Top score</Text>
                                <Text size={500} weight="semibold">{selectedRecommendationDetail.top_recommendation_score ?? '—'}</Text>
                                <Text size={200}>{selectedRecommendationDetail.candidate_count} ranked options logged</Text>
                              </div>

                              <div className={styles.memoryCard}>
                                <Text className={styles.combinedReviewLabel}>Therapist note</Text>
                                <Text size={300}>
                                  {selectedRecommendationDetail.therapist_constraints?.note || 'No extra therapist constraint note was applied.'}
                                </Text>
                              </div>
                            </div>

                            {selectedRecommendationDetail.top_recommendation ? (
                              <div className={mergeClasses(styles.recommendationCandidate, styles.recommendationCandidateTop)}>
                                <div className={styles.summaryRow}>
                                  <Badge appearance="filled" className={styles.scoreBadgeTeal}>Top recommendation</Badge>
                                  <Badge appearance="tint" className={styles.scoreBadge}>
                                    Deterministic score {selectedRecommendationDetail.top_recommendation.score}
                                  </Badge>
                                </div>
                                <Text size={500} weight="semibold">
                                  {selectedRecommendationDetail.top_recommendation.exercise_name}
                                </Text>
                                <Text size={300}>{selectedRecommendationDetail.rationale}</Text>
                                <Text className={styles.helperText} size={200}>
                                  Best overall fit from the saved memory and recent-session evidence for this child.
                                </Text>
                              </div>
                            ) : null}

                            {institutionalInsights.length ? (
                              <div className={styles.sectionBlock}>
                                <Text className={styles.sectionTitle} size={300} weight="semibold">
                                  Clinic-level institutional memory
                                </Text>
                                <Text className={styles.helperText} size={200}>
                                  These de-identified clinic patterns come from approved child memory and reviewed therapist outcomes across the clinic. They tune recommendation ranking without becoming child-specific approved facts.
                                </Text>
                                {institutionalMemorySnapshot?.summary_text ? (
                                  <div className={styles.textItem}>
                                    <Text size={200}>{institutionalMemorySnapshot.summary_text}</Text>
                                  </div>
                                ) : null}
                                {renderInstitutionalInsights(institutionalInsights, styles)}
                              </div>
                            ) : null}

                            <div>
                              <Text className={styles.sectionTitle} size={300} weight="semibold">
                                Ranked options
                              </Text>
                              <Text className={styles.helperText} size={200}>
                                Review the full ranking when you want to compare alternatives instead of only accepting the top pick.
                              </Text>
                            </div>

                            {selectedRecommendationDetail.candidates.map(candidate => {
                              const metadata = candidate.exercise_metadata || {}
                              const difficulty = String(metadata.difficulty || metadata.difficulty_level || '').trim()
                              const targetSound = String(metadata.targetSound || metadata.target_sound || '').trim()

                              return (
                                <div
                                  className={mergeClasses(
                                    styles.recommendationCandidate,
                                    candidate.rank === 1 && styles.recommendationCandidateTop
                                  )}
                                  key={candidate.id}
                                >
                                  <div className={styles.sessionHistoryHeader}>
                                    <div className={styles.sessionHistoryTitleWrap}>
                                      <div className={styles.summaryRow}>
                                        <Badge appearance="filled" className={candidate.rank === 1 ? styles.scoreBadgeTeal : styles.scoreBadge}>
                                          Rank {candidate.rank}
                                        </Badge>
                                        <Badge appearance="tint" className={styles.scoreBadge}>Score {candidate.score}</Badge>
                                        {difficulty ? <Badge appearance="tint" className={styles.scoreBadge}>{difficulty}</Badge> : null}
                                        {targetSound ? <Badge appearance="tint" className={styles.scoreBadge}>/{targetSound}/</Badge> : null}
                                      </div>
                                      <Text className={styles.sessionHistoryTitle} weight="semibold">
                                        {candidate.exercise_name}
                                      </Text>
                                      {candidate.exercise_description ? <Text size={200}>{candidate.exercise_description}</Text> : null}
                                    </div>
                                  </div>

                                  <div className={styles.sectionBlock}>
                                    <Text className={styles.sectionTitle} size={300} weight="semibold">
                                      Why was this exercise recommended?
                                    </Text>
                                    <div className={styles.textItem}>
                                      {renderMarkdown(candidate.explanation.why_recommended, styles)}
                                    </div>
                                    <div className={styles.textItem}>
                                      {renderMarkdown(candidate.explanation.comparison_to_approved_memory, styles)}
                                    </div>
                                  </div>

                                  <div className={styles.sectionBlock}>
                                    <Text className={styles.sectionTitle} size={300} weight="semibold">
                                      Ranking factors
                                    </Text>
                                    <div className={styles.recommendationFactorList}>
                                      {Object.entries(candidate.ranking_factors || {}).map(([factorKey, factor]) => (
                                        <div className={styles.recommendationFactorItem} key={factorKey}>
                                          <div className={styles.summaryRow}>
                                            <Badge appearance="tint" className={styles.scoreBadge}>
                                              {factorKey.replace(/_/g, ' ')}
                                            </Badge>
                                            <Badge appearance="tint" className={styles.scoreBadge}>
                                              {factor.score >= 0 ? '+' : ''}{factor.score}
                                            </Badge>
                                          </div>
                                          <Text size={200}>{factor.reason}</Text>
                                        </div>
                                      ))}
                                    </div>
                                  </div>

                                  <div className={styles.metricsGrid}>
                                    <div className={styles.sectionBlock}>
                                      <Text className={styles.sectionTitle} size={300} weight="semibold">
                                        Which approved memory items support it?
                                      </Text>
                                      {candidate.explanation.supporting_memory_items.length ? (
                                        <div className={styles.memoryList}>
                                          {candidate.explanation.supporting_memory_items.map(item => {
                                            const hydratedItem = childMemoryItemMap.get(item.id) || item

                                            return (
                                              <div className={styles.memoryCard} key={item.id}>
                                                <div className={styles.summaryRow}>
                                                  <Badge appearance="tint" className={styles.scoreBadge}>
                                                    {memoryCategoryLabels[item.category] || item.category}
                                                  </Badge>
                                                  {item.confidence != null ? (
                                                    <Badge appearance="tint" className={styles.scoreBadge}>
                                                      {Math.round(item.confidence * 100)}% confidence
                                                    </Badge>
                                                  ) : null}
                                                </div>
                                                <Text size={300} weight="semibold">{item.statement}</Text>
                                                {renderEvidenceLinks(hydratedItem.evidence_links, styles, onOpenSession)}
                                              </div>
                                            )
                                          })}
                                        </div>
                                      ) : (
                                        <div className={styles.emptyState}>
                                          <Text>No approved memory items were attached to this candidate.</Text>
                                        </div>
                                      )}
                                    </div>

                                    <div className={styles.sectionBlock}>
                                      <Text className={styles.sectionTitle} size={300} weight="semibold">
                                        Which sessions support it?
                                      </Text>
                                      {candidate.explanation.supporting_sessions.length ? (
                                        <div className={styles.recommendationSessionList}>
                                          {candidate.explanation.supporting_sessions.map(session => (
                                            <div className={styles.recommendationSessionItem} key={session.id}>
                                              <div className={styles.summaryRow}>
                                                <Badge appearance="tint" className={styles.scoreBadge}>
                                                  {session.exercise?.name || 'Saved session'}
                                                </Badge>
                                                {session.overall_score != null ? (
                                                  <Badge appearance="tint" className={styles.scoreBadge}>
                                                    Overall {session.overall_score}
                                                  </Badge>
                                                ) : null}
                                              </div>
                                              <Text size={200}>{formatTimestamp(session.timestamp)}</Text>
                                              <Button
                                                appearance="subtle"
                                                className={styles.evidenceButton}
                                                onClick={() => onOpenSession(session.id)}
                                              >
                                                Open source session
                                              </Button>
                                            </div>
                                          ))}
                                        </div>
                                      ) : (
                                        <div className={styles.emptyState}>
                                          <Text>No saved sessions were attached to this candidate.</Text>
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  <div className={styles.sectionBlock}>
                                    <Text className={styles.sectionTitle} size={300} weight="semibold">
                                      What evidence might change this recommendation?
                                    </Text>
                                    <div className={styles.textItem}>
                                      {renderMarkdown(candidate.explanation.evidence_that_could_change_recommendation, styles)}
                                    </div>
                                  </div>
                                </div>
                              )
                            })}
                          </>
                        ) : (
                          <div className={styles.emptyState}>
                            <Text>Select a recommendation run to inspect its rationale and provenance.</Text>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {activeTab === 'reports' ? (
              <div className={mergeClasses(styles.tabPanel, styles.tabPanelCard)}>
                <div className={styles.tabOverviewGrid}>
                  {reportOverviewCards.map(card => (
                    <div className={styles.overviewCard} key={card.label}>
                      <Text className={styles.combinedReviewLabel}>{card.label}</Text>
                      <Text className={styles.overviewValue}>{card.value}</Text>
                      <Text size={200}>{card.copy}</Text>
                    </div>
                  ))}
                </div>

                <div className={styles.recommendationSection}>
                  <div>
                    <Text className={styles.sectionTitle} size={400} weight="semibold">
                      Audience-specific progress reports
                    </Text>
                    <Text className={styles.helperText} size={300}>
                      Generate a reusable report draft from reviewed sessions, approved child memory, planning context, and saved recommendation history. Drafts can be edited, approved, signed, and archived.
                    </Text>
                  </div>

                  <div className={styles.recommendationComposer}>
                    <Field label="Audience">
                      <Dropdown
                        value={reportAudience}
                        selectedOptions={[reportAudience]}
                        onOptionSelect={(_, data) => {
                          if (data.optionValue === 'therapist' || data.optionValue === 'parent' || data.optionValue === 'school') {
                            handleReportAudienceChange(data.optionValue)
                          }
                        }}
                      >
                        <Option value="therapist">Therapist</Option>
                        <Option value="parent">Parent</Option>
                        <Option value="school">School</Option>
                      </Dropdown>
                    </Field>
                    <div className={styles.reportScopeGrid}>
                      <Field label="Review window start">
                        <input
                          className={styles.reportDateInput}
                          type="date"
                          value={reportPeriodStartDate}
                          onChange={event => updateReportWindow(event.target.value, reportPeriodEndDate)}
                        />
                      </Field>
                      <Field label="Review window end">
                        <input
                          className={styles.reportDateInput}
                          type="date"
                          value={reportPeriodEndDate}
                          onChange={event => updateReportWindow(reportPeriodStartDate, event.target.value)}
                        />
                      </Field>
                    </div>
                    <Field label="Report title">
                      <Textarea
                        value={reportTitle}
                        resize="vertical"
                        placeholder="Example: Ayo parent progress update"
                        onChange={(_, data) => setReportTitle(data.value)}
                      />
                    </Field>
                    <Field label="Executive summary note">
                      <Textarea
                        value={reportSummary}
                        resize="vertical"
                        placeholder="Optional note to keep at the top of the draft."
                        onChange={(_, data) => handleReportSummaryChange(data.value)}
                      />
                    </Field>
                    {selectedReport?.status === 'draft' ? (
                      <div className={styles.sectionBlock}>
                        <div className={styles.summaryRow}>
                          <Text className={styles.sectionTitle} size={300} weight="semibold">
                            Draft-only summary rewrite
                          </Text>
                          <Badge appearance="tint" className={styles.scoreBadge}>
                            Human review required
                          </Badge>
                        </div>
                        <Text className={styles.helperText} size={200}>
                          Generate a rewrite suggestion from the current saved draft, review it, then choose whether to apply it to the editor. Nothing is saved automatically.
                        </Text>
                        <div className={styles.memoryActionRow}>
                          <Button appearance="secondary" disabled={reportSaving || !reportComposerCanSubmit} onClick={handleSuggestReportSummaryRewrite}>
                            Suggest rewrite
                          </Button>
                          {reportSummarySuggestion ? (
                            <>
                              <Badge appearance="filled" className={styles.scoreBadgeTeal}>
                                Draft only
                              </Badge>
                              <Button appearance="secondary" disabled={reportSaving} onClick={handleApplySuggestedReportSummary}>
                                Apply suggestion to editor
                              </Button>
                            </>
                          ) : null}
                        </div>
                        {reportSummarySuggestion ? (
                          <div className={styles.memorySummaryGrid}>
                            <div className={styles.memoryCard}>
                              <Text className={styles.combinedReviewLabel}>Current saved summary</Text>
                              <Text size={200}>{reportSummarySuggestion.source_summary_text || 'No saved summary note yet.'}</Text>
                            </div>
                            <div className={styles.memoryCard}>
                              <Text className={styles.combinedReviewLabel}>Suggested rewrite</Text>
                              <Text size={200}>{reportSummarySuggestion.suggested_summary_text}</Text>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {isSharedReportAudience(reportAudience) ? (
                      <div className={styles.reportSessionSelection}>
                        <div>
                          <Text className={styles.sectionTitle} size={300} weight="semibold">
                            Shared export controls
                          </Text>
                          <Text className={styles.helperText} size={200}>
                            Parent and school exports can hide selected fields before HTML preview or true PDF generation.
                          </Text>
                        </div>
                        <div className={styles.memoryActionRow}>
                          <Badge appearance="tint" className={styles.scoreBadge}>
                            {hiddenSharedFieldCount} fields hidden
                          </Badge>
                          <Badge appearance="tint" className={styles.scoreBadge}>
                            {hiddenSharedSectionCount} sections hidden
                          </Badge>
                        </div>
                        <div className={styles.reportSessionSelectionList}>
                          {SHARED_REPORT_REDACTION_OPTIONS.map(option => {
                            const isSelected = reportRedactionOverrides[option.key]

                            return (
                              <label
                                className={mergeClasses(styles.reportSessionOption, isSelected && styles.reportSessionOptionSelected)}
                                key={option.key}
                              >
                                <input
                                  className={styles.reportSessionCheckbox}
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleReportRedactionOverride(option.key)}
                                />
                                <div className={styles.reportSessionCopy}>
                                  <Text size={300} weight="semibold">
                                    {option.label}
                                  </Text>
                                  <Text size={200}>{option.helper}</Text>
                                </div>
                              </label>
                            )
                          })}
                        </div>
                        <div>
                          <Text className={styles.sectionTitle} size={300} weight="semibold">
                            Hide individual sections
                          </Text>
                          <Text className={styles.helperText} size={200}>
                            Exclude any generated section that should not appear in the shared version of this report.
                          </Text>
                        </div>
                        <div className={styles.reportSessionSelectionList}>
                          {sharedReportSectionOptions.map(section => {
                            const isSelected = reportRedactionOverrides.hidden_section_keys.includes(section.key)

                            return (
                              <label
                                className={mergeClasses(styles.reportSessionOption, isSelected && styles.reportSessionOptionSelected)}
                                key={section.key}
                              >
                                <input
                                  className={styles.reportSessionCheckbox}
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleReportSectionVisibility(section.key)}
                                />
                                <div className={styles.reportSessionCopy}>
                                  <Text size={300} weight="semibold">
                                    Hide {section.title}
                                  </Text>
                                  <Text size={200}>Removes this section from the shared export preview and PDF.</Text>
                                </div>
                              </label>
                            )
                          })}
                        </div>
                      </div>
                    ) : null}
                    <div className={styles.reportSessionSelection}>
                      <div>
                        <Text className={styles.sectionTitle} size={300} weight="semibold">
                          Included sessions
                        </Text>
                        <Text className={styles.helperText} size={200}>
                          Filter the review window with dates, then confirm exactly which saved sessions should appear in this report.
                        </Text>
                      </div>
                      <div className={styles.memoryActionRow}>
                        <Badge appearance="tint" className={styles.scoreBadge}>
                          {reportSelectedSessionIds.length} selected
                        </Badge>
                        <Badge appearance="tint" className={styles.scoreBadge}>
                          {reportSessionsInRange.length} in range
                        </Badge>
                        <Button appearance="secondary" onClick={handleSelectAllReportSessions} disabled={!reportSessionsInRange.length}>
                          Select all in range
                        </Button>
                        <Button appearance="secondary" onClick={handleClearReportSessions} disabled={!reportSelectedSessionIds.length}>
                          Clear selection
                        </Button>
                      </div>
                      {reportSessionsInRange.length ? (
                        <div className={styles.reportSessionSelectionList}>
                          {reportSessionsInRange.map(session => {
                            const isSelected = reportSelectedSessionIds.includes(session.id)
                            const targetSound = session.exercise_metadata?.targetSound || session.exercise.exerciseMetadata?.targetSound

                            return (
                              <label
                                className={mergeClasses(styles.reportSessionOption, isSelected && styles.reportSessionOptionSelected)}
                                key={session.id}
                              >
                                <input
                                  className={styles.reportSessionCheckbox}
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleReportSession(session.id)}
                                />
                                <div className={styles.reportSessionCopy}>
                                  <Text size={300} weight="semibold">
                                    {session.exercise.name}
                                  </Text>
                                  <Text size={200}>
                                    {formatTimestamp(session.timestamp)}
                                  </Text>
                                  <Text size={200}>
                                    Overall {session.overall_score ?? '—'} • Accuracy {session.accuracy_score ?? '—'}{targetSound ? ` • /${targetSound}/` : ''}
                                  </Text>
                                </div>
                              </label>
                            )
                          })}
                        </div>
                      ) : (
                        <div className={styles.emptyState}>
                          <Text>No saved sessions fall inside the current report window.</Text>
                        </div>
                      )}
                    </div>
                    <div className={styles.memoryActionRow}>
                      <Button
                        appearance="primary"
                        disabled={reportSaving || !reportComposerCanSubmit}
                        onClick={handleCreateReport}
                      >
                        {reportSaving ? 'Saving…' : 'Generate report'}
                      </Button>
                      {selectedReport?.status === 'draft' ? (
                        <Button
                          appearance="secondary"
                          disabled={reportSaving || !reportComposerCanSubmit}
                          onClick={handleSaveReport}
                        >
                          Save draft changes
                        </Button>
                      ) : null}
                      {selectedReport ? (
                        <Badge appearance="tint" className={styles.scoreBadge}>
                          {selectedReport.status}
                        </Badge>
                      ) : null}
                    </div>
                  </div>

                  {reportError ? (
                    <Text className={styles.errorText} size={300}>
                      {reportError}
                    </Text>
                  ) : null}

                  {loadingReports && !selectedReport && progressReports.length === 0 ? (
                    <div className={styles.loading}>
                      <Spinner size="medium" />
                    </div>
                  ) : progressReports.length === 0 && !selectedReport ? (
                    <div className={styles.emptyState}>
                      <Text>No progress reports have been saved for this child yet. Generate a draft to begin the reporting workflow.</Text>
                    </div>
                  ) : (
                    <div className={styles.recommendationLayout}>
                      <div className={styles.recommendationHistoryList}>
                        <Text className={styles.sectionTitle} size={300} weight="semibold">
                          Report history
                        </Text>
                        <Text className={styles.helperText} size={200}>
                          Most recent first. Open any saved draft or signed report to inspect its generated sections.
                        </Text>
                        {/* Phase 1 AI-draft: source filter chips. Always rendered so */}
                        {/* the "AI draft" filter is discoverable even when no AI row exists. */}
                        <div className={styles.summaryRow}>
                          {([
                            { key: 'all', label: 'All' },
                            { key: 'pipeline', label: 'Pipeline' },
                            { key: 'ai_insight', label: 'AI draft' },
                            { key: 'manual', label: 'Manual' },
                          ] as const).map(chip => {
                            const pressed = reportSourceFilter === chip.key
                            return (
                              <Button
                                key={chip.key}
                                appearance={pressed ? 'primary' : 'subtle'}
                                aria-pressed={pressed}
                                onClick={() => setReportSourceFilter(chip.key)}
                                size="small"
                              >
                                {chip.label}
                              </Button>
                            )
                          })}
                        </div>
                        {(() => {
                          const filteredReports = progressReports.filter(report => {
                            if (reportSourceFilter === 'all') return true
                            const source = report.source ?? 'pipeline'
                            return source === reportSourceFilter
                          })
                          if (filteredReports.length === 0) {
                            return (
                              <div className={styles.emptyState}>
                                <Text>No reports match this filter yet.</Text>
                              </div>
                            )
                          }
                          return filteredReports.map(report => {
                            const isSelected = report.id === selectedReport?.id
                            const isAiDraft = (report.source ?? 'pipeline') === 'ai_insight'

                            return (
                              <Button
                                appearance="subtle"
                                className={mergeClasses(
                                  styles.recommendationHistoryButton,
                                  isSelected && styles.recommendationHistoryButtonSelected
                                )}
                                key={report.id}
                                onClick={() => {
                                  void onOpenReportDetail(report.id)
                                }}
                              >
                                <div className={styles.recommendationHistoryContent}>
                                  <div className={styles.summaryRow}>
                                    <Badge appearance="filled" className={styles.scoreBadgeTeal}>
                                      {report.audience}
                                    </Badge>
                                    <Badge appearance="tint" className={styles.scoreBadge}>
                                      {report.status}
                                    </Badge>
                                    {isAiDraft ? (
                                      <Badge appearance="tint" className={styles.scoreBadge}>
                                        AI draft
                                      </Badge>
                                    ) : null}
                                  </div>
                                  <Text size={300} weight="semibold">
                                    {report.title}
                                  </Text>
                                  <Text size={200}>{formatTimestamp(report.updated_at)}</Text>
                                  <Text size={200}>{report.summary_text || 'No summary note added yet.'}</Text>
                                </div>
                              </Button>
                            )
                          })
                        })()}
                      </div>

                      <div className={styles.recommendationDetail}>
                        {selectedReport ? (
                          <>
                            <div className={styles.memorySummaryGrid}>
                              <div className={styles.memoryCard}>
                                <Text className={styles.combinedReviewLabel}>Audience</Text>
                                <Text size={500} weight="semibold">{selectedReport.audience}</Text>
                                <Text size={200}>{formatTimestamp(selectedReport.updated_at)}</Text>
                              </div>

                              <div className={styles.memoryCard}>
                                <Text className={styles.combinedReviewLabel}>Review window</Text>
                                <Text size={500} weight="semibold">{selectedReport.snapshot.session_count ?? 0} sessions</Text>
                                <Text size={200}>
                                  {formatShortDate(selectedReport.period_start)} to {formatShortDate(selectedReport.period_end)}
                                </Text>
                              </div>

                              <div className={styles.memoryCard}>
                                <Text className={styles.combinedReviewLabel}>Focus</Text>
                                <Text size={300}>
                                  {selectedReport.snapshot.focus_targets?.length
                                    ? selectedReport.snapshot.focus_targets.join(', ')
                                    : 'No target sound tagged in this report window.'}
                                </Text>
                              </div>
                            </div>

                            <div className={mergeClasses(styles.recommendationCandidate, styles.recommendationCandidateTop)}>
                              <div className={styles.summaryRow}>
                                <Badge appearance="filled" className={styles.scoreBadgeTeal}>Report summary</Badge>
                                <Badge appearance="tint" className={styles.scoreBadge}>{selectedReport.status}</Badge>
                                {(selectedReport.source ?? 'pipeline') === 'ai_insight' ? (
                                  <Badge appearance="tint" className={styles.scoreBadge}>AI draft</Badge>
                                ) : null}
                              </div>
                              <Text size={500} weight="semibold">{selectedReport.title}</Text>
                              <Text size={300}>{selectedReport.summary_text || 'No summary note has been saved for this report yet.'}</Text>
                              {(selectedReport.source ?? 'pipeline') === 'ai_insight' ? (
                                <Checkbox
                                  checked={reportReviewAcknowledgedId === selectedReport.id}
                                  label="Reviewed — OK to export"
                                  onChange={(_, data) => {
                                    setReportReviewAcknowledgedId(data.checked ? selectedReport.id : null)
                                  }}
                                />
                              ) : null}
                            </div>

                            {selectedReport.sections.map(section => (
                              <div className={styles.sectionBlock} key={section.key}>
                                <Text className={styles.sectionTitle} size={300} weight="semibold">
                                  {section.title}
                                </Text>
                                {section.narrative ? (
                                  <div className={styles.textItem}>
                                    <Text size={200}>{section.narrative}</Text>
                                  </div>
                                ) : null}
                                {section.metrics?.length ? (
                                  <div className={styles.memorySummaryGrid}>
                                    {section.metrics.map(metric => (
                                      <div className={styles.memoryCard} key={`${section.key}-${metric.label}`}>
                                        <Text className={styles.combinedReviewLabel}>{metric.label}</Text>
                                        <Text size={400} weight="semibold">{metric.value}</Text>
                                      </div>
                                    ))}
                                  </div>
                                ) : null}
                                {section.bullets?.length ? (
                                  <div className={styles.textList}>
                                    {section.bullets.map(bullet => (
                                      <div className={styles.textItem} key={`${section.key}-${bullet}`}>
                                        <Text size={200}>{bullet}</Text>
                                      </div>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            ))}

                            <div className={styles.planActions}>
                              {(() => {
                                // Phase 1 AI-draft gate: exports + approve require the therapist
                                // to check the per-report "Reviewed — OK to export" acknowledgement.
                                const isAiDraftReport = (selectedReport.source ?? 'pipeline') === 'ai_insight'
                                const exportGated = isAiDraftReport && reportReviewAcknowledgedId !== selectedReport.id
                                return (
                                  <>
                                    <Button appearance="secondary" disabled={reportSaving || exportGated} onClick={() => handleOpenSelectedReportExport('html', 'preview')}>
                                      Open print view
                                    </Button>
                                    <Button appearance="secondary" disabled={reportSaving || exportGated} onClick={() => handleOpenSelectedReportExport('html', 'download')}>
                                      Download HTML
                                    </Button>
                                    <Button appearance="secondary" disabled={reportSaving || exportGated} onClick={() => handleOpenSelectedReportExport('pdf', 'preview')}>
                                      Preview PDF
                                    </Button>
                                    <Button appearance="secondary" disabled={reportSaving || exportGated} onClick={() => handleOpenSelectedReportExport('pdf', 'download')}>
                                      Download PDF
                                    </Button>
                                    {selectedReport.status === 'draft' ? (
                                      <>
                                        <Button appearance="secondary" disabled={reportSaving || exportGated} onClick={() => { void onApproveReport() }}>
                                          Approve report
                                        </Button>
                                      </>
                                    ) : null}
                                    {selectedReport.status === 'approved' ? (
                                      <Button appearance="secondary" disabled={reportSaving} onClick={() => { void onSignReport() }}>
                                        Sign report
                                      </Button>
                                    ) : null}
                                    {(selectedReport.status === 'approved' || selectedReport.status === 'signed') ? (
                                      <Button appearance="secondary" disabled={reportSaving} onClick={() => { void onArchiveReport() }}>
                                        Archive report
                                      </Button>
                                    ) : null}
                                  </>
                                )
                              })()}
                            </div>
                          </>
                        ) : (
                          <div className={styles.emptyState}>
                            <Text>Select a saved report to inspect its generated sections and workflow state.</Text>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {activeTab === 'plan' ? (
              <div className={mergeClasses(styles.tabPanel, styles.tabPanelCard)}>
                <div className={styles.tabOverviewGrid}>
                  {planOverviewCards.map(card => (
                    <div className={styles.overviewCard} key={card.label}>
                      <Text className={styles.combinedReviewLabel}>{card.label}</Text>
                      <Text className={styles.overviewValue}>{card.value}</Text>
                      <Text size={200}>{card.copy}</Text>
                    </div>
                  ))}
                </div>
                <div className={styles.planSection}>
                  <div>
                    <Text className={styles.sectionTitle} size={400} weight="semibold">
                      Next-session plan
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
                            <div className={styles.textStack}>
                              <Text size={300} weight="semibold">
                                {selectedPlan.draft.objective.replace(/[*_#`]/g, '').trim()}
                              </Text>
                              {selectedPlan.draft.focus_sound ? <Text size={200}>Target sound: {selectedPlan.draft.focus_sound}</Text> : null}
                            </div>
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
                              {renderMarkdown(activity.reason, styles)}
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
                                {renderMarkdown(cue, styles)}
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
                                {renderMarkdown(criterion, styles)}
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
                              {renderMarkdown(item, styles)}
                            </div>
                          ))}
                        </div>
                      </div>

                      {planMemorySnapshot ? (
                        <div className={styles.provenanceSection}>
                          <div className={styles.provenanceHeader}>
                            <Text className={styles.sectionTitle} size={300} weight="semibold">
                              Memory that informed this plan
                            </Text>
                            <Text className={styles.helperText} size={300}>
                              This saved snapshot shows the approved child memory that was available when the planner produced this draft.
                            </Text>
                          </div>

                          <div className={styles.provenanceMeta}>
                            <Badge appearance="filled" className={styles.scoreBadgeTeal}>
                              {planMemoryItems.length || planMemorySnapshot.used_item_ids.length} memory inputs
                            </Badge>
                            {planMemorySnapshot.summary_last_compiled_at ? (
                              <Badge appearance="tint" className={styles.scoreBadge}>
                                Snapshot {formatTimestamp(planMemorySnapshot.summary_last_compiled_at)}
                              </Badge>
                            ) : null}
                          </div>

                          {planMemoryItems.length ? (
                            <div className={styles.textList}>
                              {planMemoryItems.map(item => (
                                <div className={styles.textItem} key={item.id}>
                                  <div className={styles.summaryRow}>
                                    <Badge appearance="tint" className={styles.scoreBadge}>
                                      {memoryCategoryLabels[item.category] || item.category}
                                    </Badge>
                                    <Badge appearance="tint" className={styles.scoreBadge}>
                                      {item.memory_type}
                                    </Badge>
                                    {item.confidence != null ? (
                                      <Text size={200}>Confidence {Math.round(item.confidence * 100)}%</Text>
                                    ) : null}
                                  </div>
                                  <div className={styles.textStack}>
                                    <Text size={300} weight="semibold">
                                      {item.statement}
                                    </Text>
                                    {item.updated_at ? <Text size={200}>Reviewed {formatTimestamp(item.updated_at)}</Text> : null}
                                  </div>
                                  {renderEvidenceLinks(childMemoryItemMap.get(item.id)?.evidence_links, styles, onOpenSession)}
                                </div>
                              ))}
                            </div>
                          ) : planMemorySnapshot.summary_text ? (
                            <div className={styles.textItem}>
                              {renderMarkdown(planMemorySnapshot.summary_text, styles)}
                            </div>
                          ) : (
                            <div className={styles.emptyState}>
                              <Text>This plan predates detailed memory snapshots.</Text>
                            </div>
                          )}
                        </div>
                      ) : null}

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
                                {renderMarkdown(message.content, styles)}
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
              </div>
            ) : null}
          </Card>
        </div>
      </div>
    </div>
  )
}