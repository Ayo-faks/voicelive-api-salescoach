/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PracticePlan, SessionDetail, SessionSummary } from '../../types'

export const chartPalette = {
  primary: '#0d8a84',
  primaryLight: '#20a39e',
  primaryDark: '#06625e',
  primarySoft: 'rgba(13, 138, 132, 0.22)',
  warning: '#b89455',
  accent: '#0f2a3a',
  border: 'rgba(15, 42, 58, 0.18)',
  grid: 'rgba(15, 42, 58, 0.11)',
  axis: '#405057',
  surface: '#fffdf9',
  muted: 'rgba(15, 42, 58, 0.08)',
} as const

export type TrendChartDatum = {
  label: string
  fullLabel: string
  overall: number | null
  accuracy: number | null
  pronunciation: number | null
}

export type PlanConfidence = {
  value: number
  label: string
}

export type ProgressDashboardChartStyles = {
  calendarWrap: string
  chartArea: string
  chartHeader: string
  chartLegend: string
  compactChartArea: string
  helperText: string
  legendItem: string
  legendSwatch: string
  metric: string
  metricHeader: string
  progressAverageDot: string
  progressAverageMarker: string
  progressMeta: string
  progressRail: string
  radarLayout: string
  radarMetaGrid: string
  scoreBadge: string
  sectionTitle: string
  sparklineEmpty: string
  statTile: string
  summaryCard: string
  summaryChartCard: string
  summaryCopy: string
  summaryLabel: string
  summaryValue: string
  textList: string
  textItem: string
  visualSplit: string
  wordHeatmapGrid: string
}

function clampScore(value?: number | null) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return null
  }

  return Math.max(0, Math.min(100, value))
}

function getTrendDelta(sessions: SessionSummary[]) {
  const scores = [...sessions]
    .sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime())
    .map(session => session.overall_score)
    .filter((score): score is number => typeof score === 'number')

  if (scores.length < 2) return null

  const midpoint = Math.max(1, Math.floor(scores.length / 2))
  const earlyAverage = scores.slice(0, midpoint).reduce((total, score) => total + score, 0) / midpoint
  const recentScores = scores.slice(midpoint)
  const recentAverage = recentScores.reduce((total, score) => total + score, 0) / recentScores.length

  return Math.round(recentAverage - earlyAverage)
}

export function getTrendChartData(
  sessions: SessionSummary[],
  formatShortDate: (timestamp?: string | null) => string,
  formatTimestamp: (timestamp?: string | null) => string
): TrendChartDatum[] {
  return [...sessions]
    .sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime())
    .map(session => ({
      label: formatShortDate(session.timestamp),
      fullLabel: formatTimestamp(session.timestamp),
      overall: clampScore(session.overall_score),
      accuracy: clampScore(session.accuracy_score),
      pronunciation: clampScore(session.pronunciation_score),
    }))
}

export function getAverageFromSeries(
  sessions: SessionSummary[],
  key: 'overall_score' | 'accuracy_score' | 'pronunciation_score'
) {
  const scores = sessions
    .map(session => session[key])
    .filter((score): score is number => typeof score === 'number')

  if (!scores.length) return null

  return scores.reduce((total, score) => total + score, 0) / scores.length
}

export function getSoundAccuracyBreakdown(sessions: SessionSummary[]) {
  const grouped = new Map<string, { total: number; count: number }>()

  for (const session of sessions) {
    const sound = session.exercise_metadata?.targetSound || session.exercise.exerciseMetadata?.targetSound
    const score = clampScore(session.accuracy_score ?? session.overall_score)

    if (!sound || score == null) continue

    const current = grouped.get(sound) ?? { total: 0, count: 0 }
    grouped.set(sound, { total: current.total + score, count: current.count + 1 })
  }

  return Array.from(grouped.entries())
    .map(([sound, summary]) => ({
      sound,
      score: Math.round(summary.total / summary.count),
      count: summary.count,
    }))
    .sort((left, right) => right.count - left.count || left.sound.localeCompare(right.sound))
    .slice(0, 6)
}

export function getPlanConfidence(sessions: SessionSummary[], selectedPlan: PracticePlan | null): PlanConfidence | null {
  if (!selectedPlan) return null

  const sessionFactor = Math.min(36, sessions.length * 6)
  const trendDelta = getTrendDelta(sessions) ?? 0
  const trendFactor = trendDelta >= 8 ? 28 : trendDelta >= 3 ? 22 : trendDelta >= -2 ? 15 : trendDelta >= -8 ? 8 : 4
  const statusFactor = selectedPlan.status === 'approved' ? 28 : 18
  const value = Math.max(0, Math.min(100, Math.round(sessionFactor + trendFactor + statusFactor)))

  let label = 'Developing confidence'
  if (value >= 70) label = 'High confidence'
  else if (value >= 40) label = 'Moderate confidence'

  return { value, label }
}

function getCalendarStart(weeks: number) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dayOffset = (today.getDay() + 6) % 7
  today.setDate(today.getDate() - dayOffset)
  today.setDate(today.getDate() - (weeks - 1) * 7)
  return today
}

function toDateKey(value: Date) {
  const year = value.getFullYear()
  const month = `${value.getMonth() + 1}`.padStart(2, '0')
  const day = `${value.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function getCalendarHeatmapData(sessions: SessionSummary[], weeks = 12) {
  const counts = new Map<string, number>()

  for (const session of sessions) {
    const date = new Date(session.timestamp)
    date.setHours(0, 0, 0, 0)
    const key = toDateKey(date)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const data: Array<{ key: string; week: number; day: number; count: number; label: string }> = []
  const start = getCalendarStart(weeks)

  for (let week = 0; week < weeks; week += 1) {
    for (let day = 0; day < 7; day += 1) {
      const current = new Date(start)
      current.setDate(start.getDate() + week * 7 + day)
      const key = toDateKey(current)
      data.push({
        key,
        week,
        day,
        count: counts.get(key) ?? 0,
        label: new Intl.DateTimeFormat('en-GB', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        }).format(current),
      })
    }
  }

  return data
}

export function getCalendarCellColor(count: number) {
  if (count >= 3) return 'rgba(13, 138, 132, 0.5)'
  if (count === 2) return 'rgba(13, 138, 132, 0.3)'
  if (count === 1) return 'rgba(13, 138, 132, 0.15)'
  return 'rgba(15, 42, 58, 0.04)'
}

export function getRadarChartData(selectedSession: SessionDetail | null) {
  const aiAssessment = selectedSession?.assessment.ai_assessment
  const pronunciationAssessment = selectedSession?.assessment.pronunciation_assessment

  if (!aiAssessment && !pronunciationAssessment) return []

  return [
    {
      subject: 'Target Sound Accuracy',
      score:
        clampScore(pronunciationAssessment?.accuracy_score) ??
        (aiAssessment?.articulation_clarity.target_sound_accuracy ?? 0) * 10,
    },
    {
      subject: 'Overall Clarity',
      score:
        (aiAssessment?.articulation_clarity.overall_clarity ?? null) != null
          ? (aiAssessment?.articulation_clarity.overall_clarity ?? 0) * 10
          : clampScore(pronunciationAssessment?.pronunciation_score) ?? 0,
    },
    {
      subject: 'Consistency',
      score:
        (aiAssessment?.articulation_clarity.consistency ?? null) != null
          ? (aiAssessment?.articulation_clarity.consistency ?? 0) * 10
          : clampScore(pronunciationAssessment?.fluency_score) ?? 0,
    },
    {
      subject: 'Task Completion',
      score: (aiAssessment?.engagement_and_effort.task_completion ?? 0) * 10,
    },
    {
      subject: 'Willingness to Retry',
      score: (aiAssessment?.engagement_and_effort.willingness_to_retry ?? 0) * 10,
    },
    {
      subject: 'Self-Correction',
      score: (aiAssessment?.engagement_and_effort.self_correction_attempts ?? 0) * 10,
    },
  ]
}

export function getWordHeatmapColor(accuracy: number) {
  if (accuracy >= 100) return 'rgba(13, 138, 132, 0.42)'
  if (accuracy >= 80) return 'rgba(13, 138, 132, 0.24)'
  if (accuracy >= 50) return 'rgba(184, 148, 85, 0.24)'
  return 'rgba(184, 148, 85, 0.46)'
}

function polarToCartesian(centerX: number, centerY: number, radius: number, angleInDegrees: number) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180

  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians),
  }
}

export function describeArc(centerX: number, centerY: number, radius: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(centerX, centerY, radius, endAngle)
  const end = polarToCartesian(centerX, centerY, radius, startAngle)
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1'

  return ['M', start.x, start.y, 'A', radius, radius, 0, largeArcFlag, 0, end.x, end.y].join(' ')
}

export function getGaugeColor(value: number) {
  if (value < 40) return chartPalette.warning
  if (value < 70) return '#ddd2bf'
  return chartPalette.primary
}