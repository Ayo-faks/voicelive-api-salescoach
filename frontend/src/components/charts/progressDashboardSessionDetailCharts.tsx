/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, ProgressBar, Text } from '@fluentui/react-components'
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from 'recharts'
import type { PronunciationWordResult, SessionDetail } from '../../types'
import {
  chartPalette,
  describeArc,
  getGaugeColor,
  getRadarChartData,
  getWordHeatmapColor,
  type PlanConfidence,
  type ProgressDashboardChartStyles,
} from './progressDashboardChartShared'

export function SessionQualityRadar({
  selectedSession,
  showHeading = true,
  styles,
}: {
  selectedSession: SessionDetail | null
  showHeading?: boolean
  styles: ProgressDashboardChartStyles
}) {
  const data = getRadarChartData(selectedSession)
  const pronunciationAssessment = selectedSession?.assessment.pronunciation_assessment
  const aiAssessment = selectedSession?.assessment.ai_assessment

  if (!data.length) {
    return null
  }

  return (
    <div>
      {showHeading ? (
        <Text className={styles.sectionTitle} size={400} weight="semibold">
          Session quality snapshot
        </Text>
      ) : null}
      <div className={styles.radarLayout}>
        <div style={{ width: '100%', maxWidth: '280px', height: '280px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={data} outerRadius="72%">
              <PolarGrid stroke="rgba(15, 42, 58, 0.1)" />
              <PolarAngleAxis dataKey="subject" tick={{ fill: chartPalette.axis, fontSize: 12, fontFamily: 'Manrope' }} />
              <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
              <Radar dataKey="score" stroke={chartPalette.primary} fill={chartPalette.primarySoft} fillOpacity={1} strokeWidth={2} />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        <div className={styles.radarMetaGrid}>
          <div className={styles.statTile}>
            <Text className={styles.summaryLabel}>Overall</Text>
            <Text className={styles.summaryValue} style={{ fontSize: '1.35rem' }}>
              {aiAssessment?.overall_score != null ? `${Math.round(aiAssessment.overall_score)}%` : '—'}
            </Text>
          </div>
          <div className={styles.statTile}>
            <Text className={styles.summaryLabel}>Pronunciation composite</Text>
            <Text className={styles.summaryValue} style={{ fontSize: '1.35rem' }}>
              {pronunciationAssessment?.pronunciation_score != null ? `${Math.round(pronunciationAssessment.pronunciation_score)}%` : '—'}
            </Text>
          </div>
          <div className={styles.statTile}>
            <Text className={styles.summaryLabel}>Fluency</Text>
            <Text className={styles.summaryValue} style={{ fontSize: '1.35rem' }}>
              {pronunciationAssessment?.fluency_score != null ? `${Math.round(pronunciationAssessment.fluency_score)}%` : '—'}
            </Text>
          </div>
        </div>
      </div>
    </div>
  )
}

export function WordAccuracyHeatmap({
  styles,
  words,
}: {
  styles: ProgressDashboardChartStyles
  words: PronunciationWordResult[]
}) {
  if (!words.length) {
    return null
  }

  return (
    <div className={styles.wordHeatmapGrid}>
      {words.map(word => (
        <svg
          key={`${word.word}-${word.accuracy}-${word.error_type}`}
          viewBox="0 0 96 64"
          role="img"
          aria-label={`${word.word} scored ${Math.round(word.accuracy)} percent`}
          style={{ width: '100%', height: '72px' }}
        >
          <rect width="96" height="64" fill={getWordHeatmapColor(word.accuracy)} stroke="rgba(15, 42, 58, 0.08)" />
          <text x="48" y="27" textAnchor="middle" fill={chartPalette.accent} fontSize="12" fontFamily="Manrope" fontWeight="700">
            {word.word.slice(0, 12)}
          </text>
          <text x="48" y="46" textAnchor="middle" fill={chartPalette.axis} fontSize="10" fontFamily="Manrope">
            {Math.round(word.accuracy)}%
          </text>
          <title>{`${word.word}: ${Math.round(word.accuracy)}%${word.error_type ? `, ${word.error_type}` : ''}`}</title>
        </svg>
      ))}
    </div>
  )
}

export function CelebrationDonut({
  earned,
  styles,
}: {
  earned: number
  styles: ProgressDashboardChartStyles
}) {
  const total = Math.max(5, earned || 5)
  const radius = 34
  const circumference = 2 * Math.PI * radius
  const progress = earned / total

  return (
    <div style={{ width: '120px', height: '120px', position: 'relative' }}>
      <svg viewBox="0 0 120 120" width="120" height="120" role="img" aria-label="Celebration points donut chart">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="rgba(15, 42, 58, 0.06)" strokeWidth="12" />
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke={chartPalette.primary}
          strokeWidth="12"
          strokeDasharray={`${circumference * progress} ${circumference}`}
          strokeLinecap="butt"
          transform="rotate(-90 60 60)"
        />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center', pointerEvents: 'none' }}>
        <div>
          <Text className={styles.summaryValue} style={{ fontSize: '1.5rem' }}>
            {earned}
          </Text>
          <Text className={styles.helperText} size={200}>
            of {total}
          </Text>
        </div>
      </div>
    </div>
  )
}

export function PlanConfidenceGauge({
  confidence,
  styles,
}: {
  confidence: PlanConfidence
  styles: ProgressDashboardChartStyles
}) {
  const color = getGaugeColor(confidence.value)
  const endAngle = 180 - (confidence.value / 100) * 180
  const radius = 52
  const angleInRadians = ((endAngle - 90) * Math.PI) / 180
  const marker = {
    x: 90 + radius * Math.cos(angleInRadians),
    y: 90 + radius * Math.sin(angleInRadians),
  }

  return (
    <div
      style={{
        width: '188px',
        display: 'grid',
        gap: '8px',
        justifyItems: 'center',
        padding: '10px 10px 12px',
        border: '1px solid rgba(15, 42, 58, 0.12)',
        backgroundColor: 'rgba(255, 253, 249, 0.98)',
      }}
    >
      <svg viewBox="0 0 180 120" width="180" height="120" role="img" aria-label="Plan confidence gauge">
        <path d={describeArc(90, 90, radius, 180, 0)} fill="none" stroke="rgba(15, 42, 58, 0.08)" strokeWidth="12" />
        <path d={describeArc(90, 90, radius, 180, endAngle)} fill="none" stroke={color} strokeWidth="12" />
        <circle cx={marker.x} cy={marker.y} r="4" fill={color} />
        <text x="90" y="80" textAnchor="middle" fill={chartPalette.accent} fontSize="38" fontWeight="700" fontFamily="Manrope">
          {confidence.value}
        </text>
        <text x="90" y="98" textAnchor="middle" fill={chartPalette.axis} fontSize="11" fontFamily="Manrope">
          confidence
        </text>
      </svg>
      <Text className={styles.helperText} size={200} style={{ textAlign: 'center' }}>
        {confidence.label}
      </Text>
    </div>
  )
}

export function ComparisonMetricBar({
  averageValue,
  label,
  max,
  styles,
  value,
}: {
  averageValue: number | null
  label: string
  max: number
  styles: ProgressDashboardChartStyles
  value: number
}) {
  const currentValue = Math.max(0, Math.min(max, value))
  const normalizedAverage = averageValue != null ? Math.max(0, Math.min(max, averageValue)) / max : null

  return (
    <div className={styles.metric}>
      <div className={styles.metricHeader}>
        <Text size={300}>{label}</Text>
        <Badge appearance="tint" className={styles.scoreBadge}>
          {currentValue}/{max}
        </Badge>
      </div>
      <div className={styles.progressRail}>
        <ProgressBar value={currentValue / max} style={{ color: chartPalette.primary }} />
        {normalizedAverage != null ? (
          <div className={styles.progressAverageMarker} style={{ left: `calc(${normalizedAverage * 100}% - 1px)` }}>
            <span className={styles.progressAverageDot} />
          </div>
        ) : null}
      </div>
      <div className={styles.progressMeta}>
        <span>Session {currentValue}/{max}</span>
        <span>{averageValue != null ? `Avg ${averageValue.toFixed(1)}/${max}` : 'Avg unavailable'}</span>
      </div>
    </div>
  )
}