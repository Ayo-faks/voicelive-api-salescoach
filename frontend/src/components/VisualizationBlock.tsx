/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, Text, tokens } from '@fluentui/react-components'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { VisualizationSpec } from '../types'
import { chartPalette } from './charts/progressDashboardChartShared'

const SERIES_COLOR_KEYS = [
  'primary',
  'warning',
  'accent',
  'primaryLight',
  'primaryDark',
  'muted',
] as const

const MAX_TITLE_LENGTH = 120
const MAX_CAPTION_LENGTH = 280
const MAX_SERIES_PER_CHART = 8
const MAX_POINTS_PER_SERIES = 200
const MAX_TABLE_COLUMNS = 24
const MAX_TABLE_ROWS = 200

const useStyles = makeStyles({
  container: {
    display: 'grid',
    gap: '6px',
    padding: '10px 12px',
    border: '1px solid rgba(15, 42, 58, 0.14)',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
  },
  title: {
    color: 'var(--color-text-primary)',
  },
  caption: {
    color: 'var(--color-text-secondary)',
  },
  chartFrame: {
    width: '100%',
    height: '240px',
  },
  fallback: {
    padding: '8px 10px',
    border: '1px dashed rgba(15, 42, 58, 0.22)',
    borderRadius: tokens.borderRadiusMedium,
    color: 'var(--color-text-secondary)',
    fontStyle: 'italic',
  },
  tableScroller: {
    maxWidth: '100%',
    overflowX: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '13px',
  },
  tableCell: {
    padding: '6px 10px',
    borderBottom: '1px solid rgba(15, 42, 58, 0.12)',
    textAlign: 'left',
    verticalAlign: 'top',
  },
  tableHeader: {
    padding: '6px 10px',
    borderBottom: '1px solid rgba(15, 42, 58, 0.22)',
    backgroundColor: 'rgba(13, 138, 132, 0.08)',
    color: 'var(--color-text-primary)',
    textAlign: 'left',
    fontWeight: 600,
  },
})

interface VisualizationBlockProps {
  spec: unknown
}

/**
 * Renders a single Insights visualization (line, bar, or table) from a spec
 * that matches the backend visualization contract. Malformed specs fall back
 * to an inert placeholder — this component never throws for untrusted input.
 */
export function VisualizationBlock({ spec }: VisualizationBlockProps) {
  const styles = useStyles()
  const normalized = normalizeSpec(spec)

  if (!normalized) {
    return (
      <div className={styles.container} aria-label="Unavailable visualization">
        <div className={styles.fallback}>
          <Text size={200}>Visualization unavailable — the data did not match the expected format.</Text>
        </div>
      </div>
    )
  }

  return (
    <div
      className={styles.container}
      aria-label={`Visualization: ${normalized.title}`}
      data-testid="visualization-block"
      data-kind={normalized.kind}
    >
      <Text size={300} weight="semibold" className={styles.title}>
        {normalized.title}
      </Text>
      {normalized.caption ? (
        <Text size={200} className={styles.caption}>
          {normalized.caption}
        </Text>
      ) : null}
      {normalized.kind === 'table'
        ? renderTable(normalized, styles)
        : renderChart(normalized, styles)}
    </div>
  )
}

function renderChart(
  spec: Extract<VisualizationSpec, { kind: 'line' | 'bar' }>,
  styles: ReturnType<typeof useStyles>,
) {
  const mergedData = buildChartData(spec)
  const ChartComponent = spec.kind === 'line' ? LineChart : BarChart
  const seriesNames = spec.series.map(series => series.name)

  return (
    <div className={styles.chartFrame} data-testid="visualization-chart">
      <ResponsiveContainer width="100%" height="100%">
        <ChartComponent data={mergedData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid stroke={chartPalette.grid} strokeDasharray="3 3" />
          <XAxis
            dataKey="x"
            stroke={chartPalette.axis}
            label={spec.x_label ? { value: spec.x_label, position: 'insideBottom', offset: -2 } : undefined}
          />
          <YAxis
            stroke={chartPalette.axis}
            label={spec.y_label ? { value: spec.y_label, angle: -90, position: 'insideLeft' } : undefined}
          />
          <Tooltip />
          <Legend />
          {seriesNames.map((name, index) => {
            const colorKey = SERIES_COLOR_KEYS[index % SERIES_COLOR_KEYS.length]
            const color = chartPalette[colorKey]
            const safeDataKey = `s_${index}`
            if (spec.kind === 'line') {
              return (
                <Line
                  key={safeDataKey}
                  type="monotone"
                  name={name}
                  dataKey={safeDataKey}
                  stroke={color}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  isAnimationActive={false}
                />
              )
            }
            return (
              <Bar
                key={safeDataKey}
                name={name}
                dataKey={safeDataKey}
                fill={color}
                isAnimationActive={false}
              />
            )
          })}
        </ChartComponent>
      </ResponsiveContainer>
    </div>
  )
}

function renderTable(
  spec: Extract<VisualizationSpec, { kind: 'table' }>,
  styles: ReturnType<typeof useStyles>,
) {
  return (
    <div className={styles.tableScroller}>
      <table className={styles.table} data-testid="visualization-table">
        <thead>
          <tr>
            {spec.columns.map(column => (
              <th key={column.key} className={styles.tableHeader} scope="col">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {spec.rows.map((row, rowIndex) => (
            <tr key={buildRowKey(spec.columns, row, rowIndex)}>
              {spec.columns.map(column => (
                <td key={column.key} className={styles.tableCell}>
                  {formatCell(row[column.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '—'
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return '—'
    }
    return String(value)
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No'
  }
  if (typeof value === 'string') {
    return value
  }
  return '—'
}

function buildRowKey(
  columns: Array<{ key: string }>,
  row: Record<string, unknown>,
  fallbackIndex: number,
): string {
  const parts: string[] = []
  for (const column of columns) {
    const value = row[column.key]
    if (value === null || value === undefined) {
      parts.push('')
    } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      parts.push(String(value))
    } else {
      parts.push('')
    }
  }
  const joined = parts.join('|')
  return joined.length > 0 ? `${fallbackIndex}:${joined}` : `row-${fallbackIndex}`
}

function buildChartData(
  spec: Extract<VisualizationSpec, { kind: 'line' | 'bar' }>,
): Array<Record<string, string | number>> {
  const merged = new Map<string, Record<string, string | number>>()
  for (let index = 0; index < spec.series.length; index += 1) {
    const series = spec.series[index]
    const key = `s_${index}`
    for (const point of series.points) {
      const xKey = String(point.x)
      const row = merged.get(xKey) ?? { x: point.x }
      row[key] = point.y
      merged.set(xKey, row)
    }
  }
  return Array.from(merged.values())
}

/**
 * Type-narrow and cap a raw spec. Returns null when the spec does not
 * satisfy the contract — callers render a fallback instead of throwing.
 * Mirrors {@link file://backend/src/services/visualization_service.py}.
 */
function normalizeSpec(raw: unknown): VisualizationSpec | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null
  }
  const spec = raw as Record<string, unknown>
  const kind = spec.kind
  if (kind !== 'line' && kind !== 'bar' && kind !== 'table') {
    return null
  }
  const title = sanitizeString(spec.title, MAX_TITLE_LENGTH)
  if (!title) {
    return null
  }
  const caption = sanitizeOptionalString(spec.caption, MAX_CAPTION_LENGTH)

  if (kind === 'table') {
    const columnsRaw = spec.columns
    const rowsRaw = spec.rows
    if (!Array.isArray(columnsRaw) || columnsRaw.length === 0 || columnsRaw.length > MAX_TABLE_COLUMNS) {
      return null
    }
    const columns: Array<{ key: string; label: string }> = []
    const seenKeys = new Set<string>()
    for (const col of columnsRaw) {
      if (!col || typeof col !== 'object') return null
      const entry = col as Record<string, unknown>
      const key = sanitizeString(entry.key, 60)
      const label = sanitizeString(entry.label, 60)
      if (!key || !label || seenKeys.has(key)) {
        return null
      }
      seenKeys.add(key)
      columns.push({ key, label })
    }
    if (!Array.isArray(rowsRaw) || rowsRaw.length > MAX_TABLE_ROWS) {
      return null
    }
    const rows: Array<Record<string, string | number | boolean | null>> = []
    for (const rowRaw of rowsRaw) {
      if (!rowRaw || typeof rowRaw !== 'object') return null
      const row = rowRaw as Record<string, unknown>
      const sanitizedRow: Record<string, string | number | boolean | null> = {}
      for (const column of columns) {
        sanitizedRow[column.key] = sanitizeCell(row[column.key])
      }
      rows.push(sanitizedRow)
    }
    const tableSpec: VisualizationSpec = { kind: 'table', title, columns, rows }
    if (caption) tableSpec.caption = caption
    return tableSpec
  }

  const seriesRaw = spec.series
  if (!Array.isArray(seriesRaw) || seriesRaw.length === 0 || seriesRaw.length > MAX_SERIES_PER_CHART) {
    return null
  }
  const series: Array<{ name: string; points: Array<{ x: string | number; y: number }> }> = []
  for (const item of seriesRaw) {
    if (!item || typeof item !== 'object') return null
    const entry = item as Record<string, unknown>
    const name = sanitizeString(entry.name, 60)
    const pointsRaw = entry.points
    if (!name || !Array.isArray(pointsRaw) || pointsRaw.length === 0 || pointsRaw.length > MAX_POINTS_PER_SERIES) {
      return null
    }
    const points: Array<{ x: string | number; y: number }> = []
    for (const point of pointsRaw) {
      if (!point || typeof point !== 'object') return null
      const p = point as Record<string, unknown>
      const x = sanitizeAxisValue(p.x)
      const y = sanitizeNumber(p.y)
      if (x === null || y === null) {
        return null
      }
      points.push({ x, y })
    }
    series.push({ name, points })
  }
  const chartSpec: VisualizationSpec = {
    kind,
    title,
    x_label: sanitizeOptionalString(spec.x_label, 60) ?? '',
    y_label: sanitizeOptionalString(spec.y_label, 60) ?? '',
    series,
  }
  if (caption) chartSpec.caption = caption
  return chartSpec
}

function sanitizeString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value.trim()
  if (!cleaned) return null
  return cleaned.length > maxLength ? cleaned.slice(0, maxLength) : cleaned
}

function sanitizeOptionalString(value: unknown, maxLength: number): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') return null
  const cleaned = value.trim()
  if (!cleaned) return null
  return cleaned.length > maxLength ? cleaned.slice(0, maxLength) : cleaned
}

function sanitizeAxisValue(value: unknown): string | number | null {
  if (typeof value === 'boolean') return null
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === 'string') {
    const cleaned = value.trim()
    return cleaned ? cleaned.slice(0, 40) : null
  }
  return null
}

function sanitizeNumber(value: unknown): number | null {
  if (typeof value === 'boolean') return null
  if (typeof value !== 'number') return null
  return Number.isFinite(value) ? value : null
}

function sanitizeCell(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const cleaned = value.length > 200 ? value.slice(0, 200) : value
    return cleaned
  }
  return null
}
