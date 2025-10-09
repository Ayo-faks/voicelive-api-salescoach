/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Text, makeStyles, tokens } from '@fluentui/react-components'
import { TokenUsageBreakdown } from '../types'

const useStyles = makeStyles({
  container: {
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: tokens.spacingVerticalS,
    paddingLeft: tokens.spacingHorizontalM,
    paddingRight: tokens.spacingHorizontalM,
    display: 'grid',
    gap: tokens.spacingVerticalXS,
  },
  metricRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontSize: tokens.fontSizeBase200,
    gap: tokens.spacingHorizontalM,
  },
  label: {
    color: tokens.colorNeutralForeground2,
  },
  value: {
    fontVariantNumeric: 'tabular-nums',
  },
})

interface Props {
  latestUsage: TokenUsageBreakdown | null
  totals: TokenUsageBreakdown
  elapsedMinutes: number
}

const hasValues = (usage?: TokenUsageBreakdown | null) => {
  if (!usage) {
    return false
  }
  const hasTopLevel = Object.keys(usage.topLevel).length > 0
  const hasDetails = Object.values(usage.details).some(
    detail => Object.keys(detail).length > 0
  )
  return hasTopLevel || hasDetails
}

const formatLabel = (key: string) =>
  key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase())

interface MetricRow {
  id: string
  label: string
  value: number
  delta?: number
}

const buildMetricRows = (
  totals: TokenUsageBreakdown,
  latestUsage: TokenUsageBreakdown | null
): MetricRow[] => {
  const rows: MetricRow[] = []
  Object.entries(totals.topLevel)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([key, value]) => {
      rows.push({
        id: key,
        label: formatLabel(key),
        value,
        delta: latestUsage?.topLevel[key],
      })
    })

  Object.entries(totals.details)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([groupKey, metrics]) => {
      Object.entries(metrics)
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([metricKey, metricValue]) => {
          const id = `${groupKey}:${metricKey}`
          rows.push({
            id,
            label: `${formatLabel(groupKey)} - ${formatLabel(metricKey)}`,
            value: metricValue,
            delta: latestUsage?.details?.[groupKey]?.[metricKey],
          })
        })
    })

  return rows
}

export function TokenUsagePanel({ latestUsage, totals, elapsedMinutes }: Props) {
  const styles = useStyles()
  const showTotals = hasValues(totals)

  return (
    <div className={styles.container}>
      <div className={styles.metricRow}>
        <Text size={200} className={styles.label}>
          Conversation time
        </Text>
        <Text size={200} weight="semibold" className={styles.value}>
          {elapsedMinutes.toFixed(2)} min
        </Text>
      </div>

      {showTotals &&
        buildMetricRows(totals, latestUsage).map(row => (
          <div key={row.id} className={styles.metricRow}>
            <Text size={200} className={styles.label}>
              {row.label}
            </Text>
            <Text size={200} weight="semibold" className={styles.value}>
              {row.value.toLocaleString()}
              {row.delta && row.delta > 0
                ? ` (+${row.delta.toLocaleString()})`
                : ''}
            </Text>
          </div>
        ))}
    </div>
  )
}
