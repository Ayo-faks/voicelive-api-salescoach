/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Card, Text, mergeClasses } from '@fluentui/react-components'
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { SessionSummary } from '../../types'
import {
  chartPalette,
  getCalendarCellColor,
  getCalendarHeatmapData,
  type ProgressDashboardChartStyles,
  type TrendChartDatum,
} from './progressDashboardChartShared'

export function SummaryTrendCard({
  averageScore,
  data,
  styles,
  trendLabel,
}: {
  averageScore: number | null
  data: TrendChartDatum[]
  styles: ProgressDashboardChartStyles
  trendLabel: string
}) {
  const hasSeriesData = data.some(point => point.overall != null || point.accuracy != null || point.pronunciation != null)
  const showDots = data.length <= 3 ? { r: 3.5, strokeWidth: 0 } : false

  return (
    <Card className={mergeClasses(styles.summaryCard, styles.summaryChartCard)}>
      <div className={styles.chartHeader}>
        <div>
          <Text className={styles.summaryLabel}>Progress trendline</Text>
          <Text className={styles.summaryCopy}>Overall, accuracy, and pronunciation movement across saved sessions.</Text>
          <div className={styles.chartLegend}>
            <span className={styles.legendItem}>
              <span className={styles.legendSwatch} style={{ backgroundColor: chartPalette.primary }} />
              Overall
            </span>
            <span className={styles.legendItem}>
              <span
                className={styles.legendSwatch}
                style={{
                  background: `linear-gradient(90deg, ${chartPalette.primaryLight} 0 50%, transparent 50% 100%)`,
                  borderColor: chartPalette.primaryLight,
                }}
              />
              Accuracy
            </span>
            <span className={styles.legendItem}>
              <span className={styles.legendSwatch} style={{ backgroundColor: chartPalette.warning }} />
              Pronunciation
            </span>
          </div>
        </div>
        <div style={{ display: 'grid', gap: '4px', justifyItems: 'end' }}>
          <Text className={styles.summaryValue}>{averageScore != null ? `${Math.round(averageScore)}%` : '—'}</Text>
          <Text className={styles.summaryCopy}>{trendLabel}</Text>
        </div>
      </div>

      <div className={styles.chartArea}>
        {hasSeriesData ? (
          <ResponsiveContainer width="100%" height={188}>
            <LineChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke={chartPalette.grid} vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: chartPalette.axis, fontSize: 11, fontFamily: 'Manrope' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fill: chartPalette.axis, fontSize: 11, fontFamily: 'Manrope' }}
                axisLine={false}
                tickLine={false}
                width={34}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: chartPalette.surface,
                  border: `1px solid ${chartPalette.border}`,
                  borderRadius: 0,
                  boxShadow: 'none',
                  fontFamily: 'Manrope',
                  fontSize: '12px',
                  color: chartPalette.accent,
                }}
                formatter={(value, name) => [typeof value === 'number' ? `${Math.round(value)}%` : '—', String(name)]}
                labelFormatter={(_label, payload) => payload?.[0]?.payload?.fullLabel || ''}
              />
              <Line type="monotone" dataKey="overall" name="Overall" stroke={chartPalette.primary} strokeWidth={2.5} dot={showDots} connectNulls />
              <Line type="monotone" dataKey="accuracy" name="Accuracy" stroke={chartPalette.primaryLight} strokeWidth={2} strokeDasharray="5 4" dot={showDots} connectNulls />
              <Line type="monotone" dataKey="pronunciation" name="Pronunciation" stroke={chartPalette.warning} strokeWidth={2} dot={showDots} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className={styles.sparklineEmpty}>Save one reviewed session to start the visual trendline.</div>
        )}
      </div>
    </Card>
  )
}

export function SoundBreakdownCard({
  lastSessionLabel,
  soundBreakdown,
  styles,
}: {
  lastSessionLabel: string
  soundBreakdown: Array<{ sound: string; score: number; count: number }>
  styles: ProgressDashboardChartStyles
}) {
  return (
    <Card className={styles.summaryCard}>
      <Text className={styles.summaryLabel}>Focus sounds</Text>
      <Text className={styles.summaryCopy}>Average accuracy by target sound across reviewed sessions.</Text>
      <div className={styles.compactChartArea}>
        {soundBreakdown.length ? (
          <ResponsiveContainer width="100%" height={Math.max(120, soundBreakdown.length * 30)}>
            <BarChart data={soundBreakdown} layout="vertical" margin={{ top: 4, right: 28, left: 6, bottom: 0 }}>
              <XAxis type="number" domain={[0, 100]} hide />
              <YAxis
                dataKey="sound"
                type="category"
                tick={{ fill: chartPalette.accent, fontSize: 12, fontWeight: 700, fontFamily: 'Manrope' }}
                axisLine={false}
                tickLine={false}
                width={52}
              />
              <Tooltip
                cursor={{ fill: 'rgba(15, 42, 58, 0.03)' }}
                contentStyle={{
                  backgroundColor: chartPalette.surface,
                  border: `1px solid ${chartPalette.border}`,
                  borderRadius: 0,
                  boxShadow: 'none',
                  fontFamily: 'Manrope',
                  fontSize: '12px',
                }}
                formatter={value => [typeof value === 'number' ? `${Math.round(value)}%` : '—', 'Average accuracy']}
              />
              <Bar dataKey="score" fill={chartPalette.primary} background={{ fill: chartPalette.muted }} barSize={22}>
                <LabelList
                  dataKey="score"
                  position="right"
                  formatter={value => (typeof value === 'number' ? `${Math.round(value)}%` : '')}
                  style={{ fill: '#2e3a3f', fontSize: 12, fontFamily: 'Manrope' }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className={styles.sparklineEmpty}>Target-sound accuracy appears once reviewed sessions include sound metadata.</div>
        )}
      </div>
      <Text className={styles.summaryCopy}>Last saved session: {lastSessionLabel}</Text>
    </Card>
  )
}

export function SessionFrequencyHeatmap({
  sessions,
  styles,
}: {
  sessions: SessionSummary[]
  styles: ProgressDashboardChartStyles
}) {
  const data = getCalendarHeatmapData(sessions)
  const cellSize = 14
  const gap = 2
  const labelWidth = 14
  const topPadding = 8
  const svgWidth = labelWidth + 12 * (cellSize + gap)
  const svgHeight = topPadding + 7 * (cellSize + gap)
  const dayLabels = [
    { key: 'mon', label: 'M' },
    { key: 'tue', label: 'T' },
    { key: 'wed', label: 'W' },
    { key: 'thu', label: 'T' },
    { key: 'fri', label: 'F' },
    { key: 'sat', label: 'S' },
    { key: 'sun', label: 'S' },
  ]

  return (
    <div className={styles.calendarWrap}>
      <Text className={styles.helperText} size={200}>
        Last 12 weeks
      </Text>
      <svg
        width={svgWidth}
        height={svgHeight}
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        role="img"
        aria-label="Session frequency calendar heatmap"
      >
        {dayLabels.map((dayLabel, index) => (
          <text
            key={dayLabel.key}
            x={0}
            y={topPadding + index * (cellSize + gap) + 11}
            fill={chartPalette.axis}
            fontSize="9"
            fontFamily="Manrope"
          >
            {dayLabel.label}
          </text>
        ))}
        {data.map(cell => (
          <g key={cell.key}>
            <rect
              x={labelWidth + cell.week * (cellSize + gap)}
              y={topPadding + cell.day * (cellSize + gap)}
              width={cellSize}
              height={cellSize}
              fill={getCalendarCellColor(cell.count)}
              stroke="rgba(15, 42, 58, 0.04)"
            />
            <title>{`${cell.label}: ${cell.count} session${cell.count === 1 ? '' : 's'}`}</title>
          </g>
        ))}
      </svg>
    </div>
  )
}