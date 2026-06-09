import { Card, makeStyles, Text } from '@fluentui/react-components'
import {
  ArrowPathIcon,
  ChartBarSquareIcon,
} from '@heroicons/react/24/outline'
import { useCallback, useEffect, useState } from 'react'
import {
  getObservabilityDashboard,
  type ObservabilityDashboardResponse,
  type ObservabilitySection,
  type ObservabilityTile,
  type ObservabilityTileSource,
  type ObservabilityTileStatus,
} from '../api'
import { pathfinderTokens as t } from '../theme/pathfinder-tokens'

const STATUS_LABEL: Record<ObservabilityTileStatus, string> = {
  ok: 'Healthy',
  warn: 'Watch',
  crit: 'Action',
  nodata: 'No data',
}

const SOURCE_LABEL: Record<ObservabilityTileSource, string> = {
  live: 'Live',
  kql: 'Azure Monitor',
  snapshot: 'Pilot snapshot',
  fixture: 'Pilot data',
  nodata: 'No data',
}

const useStyles = makeStyles({
  shell: { display: 'grid', gap: 'var(--pf-space-xl)' },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: 'var(--pf-space-lg)',
    flexWrap: 'wrap',
  },
  headerCopy: { display: 'grid', gap: 'var(--pf-space-sm)' },
  title: {
    fontFamily: t.font.display,
    fontSize: 'clamp(1.6rem, 2.4vw, 2rem)',
    fontWeight: 700,
    letterSpacing: '-0.025em',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  titleIcon: { width: '26px', height: '26px' },
  subtitle: { color: 'var(--pf-text-secondary)', maxWidth: '60ch' },
  headerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--pf-space-md)',
  },
  overallPill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    minHeight: '30px',
    paddingRight: '14px',
    paddingLeft: '14px',
    borderRadius: t.radius.pill,
    border: 'var(--pf-hairline)',
    fontSize: '0.78rem',
    fontWeight: 700,
  },
  refreshButton: {
    appearance: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    minHeight: '36px',
    paddingRight: '15px',
    paddingLeft: '15px',
    borderRadius: t.radius.pill,
    border: '1px solid var(--pf-ink)',
    backgroundColor: 'var(--pf-ink)',
    color: 'var(--pf-on-ink)',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.82rem',
    fontWeight: 700,
    ':focus-visible': {
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: 'var(--pf-focus-ring)',
      outlineOffset: '3px',
      boxShadow: 'var(--pf-focus-outline)',
    },
  },
  refreshButtonBusy: { opacity: 0.65, cursor: 'progress' },
  refreshIcon: { width: '16px', height: '16px' },
  refreshIconSpinning: {
    animationName: {
      from: { transform: 'rotate(0deg)' },
      to: { transform: 'rotate(360deg)' },
    },
    animationDuration: '800ms',
    animationIterationCount: 'infinite',
    animationTimingFunction: 'linear',
  },
  section: { display: 'grid', gap: 'var(--pf-space-md)' },
  sectionTitle: {
    fontSize: '1.05rem',
    fontWeight: 700,
    letterSpacing: '-0.01em',
  },
  tileGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 'var(--pf-space-lg)',
    '@media (max-width: 980px)': { gridTemplateColumns: 'repeat(2, 1fr)' },
    '@media (max-width: 620px)': { gridTemplateColumns: '1fr' },
  },
  tile: {
    display: 'grid',
    gap: 'var(--pf-space-sm)',
    padding: 'var(--pf-space-lg)',
    borderRadius: t.radius.sm,
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface)',
    boxShadow: 'var(--pf-shadow-card-elevated)',
  },
  tileTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '8px',
  },
  tileLabel: {
    fontSize: '0.78rem',
    fontWeight: 700,
    color: 'var(--pf-text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  tileValue: {
    fontFamily: t.font.display,
    fontSize: '1.7rem',
    fontWeight: 700,
    letterSpacing: '-0.02em',
    lineHeight: 1.1,
  },
  tileDetail: {
    fontSize: '0.82rem',
    color: 'var(--pf-text-secondary)',
    lineHeight: 1.4,
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: '22px',
    paddingRight: '9px',
    paddingLeft: '9px',
    borderRadius: t.radius.pill,
    fontSize: '0.68rem',
    fontWeight: 700,
    whiteSpace: 'nowrap',
  },
  sourceBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: '20px',
    paddingRight: '8px',
    paddingLeft: '8px',
    borderRadius: t.radius.pill,
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface-muted)',
    color: 'var(--pf-text-tertiary)',
    fontSize: '0.66rem',
    fontWeight: 700,
    width: 'fit-content',
  },
  statusOk: {
    backgroundColor: 'var(--pf-status-ok-bg)',
    color: 'var(--pf-status-ok-fg)',
  },
  statusWarn: {
    backgroundColor: 'var(--pf-status-warn-bg)',
    color: 'var(--pf-status-warn-fg)',
  },
  statusCrit: {
    backgroundColor: 'var(--pf-status-critical-bg)',
    color: 'var(--pf-status-critical-fg)',
  },
  statusNodata: {
    backgroundColor: 'var(--pf-status-info-bg)',
    color: 'var(--pf-status-info-fg)',
  },
  stateCard: {
    display: 'grid',
    gap: '8px',
    padding: 'var(--pf-space-xxl)',
    borderRadius: t.radius.sm,
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface)',
  },
  generatedAt: { fontSize: '0.74rem', color: 'var(--pf-text-tertiary)' },
})

function statusClass(
  styles: ReturnType<typeof useStyles>,
  status: ObservabilityTileStatus
): string {
  switch (status) {
    case 'ok':
      return styles.statusOk
    case 'warn':
      return styles.statusWarn
    case 'crit':
      return styles.statusCrit
    default:
      return styles.statusNodata
  }
}

function ObservabilityTileCard({ tile }: { tile: ObservabilityTile }) {
  const styles = useStyles()
  return (
    <div className={styles.tile} data-testid={`pf-obs-tile-${tile.id}`}>
      <div className={styles.tileTop}>
        <Text className={styles.tileLabel}>{tile.label}</Text>
        <span
          className={`${styles.badge} ${statusClass(styles, tile.status)}`}
          data-testid={`pf-obs-tile-${tile.id}-status`}
          data-status={tile.status}
        >
          {STATUS_LABEL[tile.status]}
        </span>
      </div>
      <Text className={styles.tileValue} data-testid={`pf-obs-tile-${tile.id}-value`}>
        {tile.value}
      </Text>
      <Text className={styles.tileDetail}>{tile.detail}</Text>
      <span className={styles.sourceBadge} data-source={tile.source}>
        {SOURCE_LABEL[tile.source]}
      </span>
    </div>
  )
}

function ObservabilitySectionBlock({ section }: { section: ObservabilitySection }) {
  const styles = useStyles()
  return (
    <section
      className={styles.section}
      data-testid={`pf-obs-section-${section.id}`}
    >
      <Text as="h2" className={styles.sectionTitle}>
        {section.title}
      </Text>
      <div className={styles.tileGrid}>
        {section.tiles.map((tile) => (
          <ObservabilityTileCard key={tile.id} tile={tile} />
        ))}
      </div>
    </section>
  )
}

export default function ObservabilityDashboard() {
  const styles = useStyles()
  const [data, setData] = useState<ObservabilityDashboardResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await getObservabilityDashboard()
      setData(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const overallStatus = data?.overall_status ?? 'nodata'

  return (
    <div className={styles.shell} data-testid="pf-observability-dashboard">
      <header className={styles.header}>
        <div className={styles.headerCopy}>
          <Text as="h1" className={styles.title}>
            <ChartBarSquareIcon className={styles.titleIcon} aria-hidden />
            Observability
          </Text>
          <Text className={styles.subtitle}>
            Live product, service-health and safety signals for the Wulo Academy
            pilot. Tiles are badged by source: live counters seen by this
            service, pilot data snapshots, or no data yet.
          </Text>
        </div>
        <div className={styles.headerActions}>
          <span
            className={`${styles.overallPill} ${statusClass(styles, overallStatus)}`}
            data-testid="pf-obs-overall-status"
            data-status={overallStatus}
          >
            {STATUS_LABEL[overallStatus]}
          </span>
          <button
            type="button"
            className={`${styles.refreshButton} ${loading ? styles.refreshButtonBusy : ''}`}
            onClick={() => void load()}
            disabled={loading}
            aria-busy={loading}
            data-testid="pf-obs-refresh"
          >
            <ArrowPathIcon
              className={`${styles.refreshIcon} ${loading ? styles.refreshIconSpinning : ''}`}
              aria-hidden
            />
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      {error ? (
        <Card className={styles.stateCard} data-testid="pf-obs-error">
          <Text weight="semibold">Could not load observability data</Text>
          <Text className={styles.tileDetail}>{error}</Text>
        </Card>
      ) : loading && !data ? (
        <Card className={styles.stateCard} data-testid="pf-obs-loading">
          <Text>Loading observability signals…</Text>
        </Card>
      ) : data ? (
        <>
          {data.sections.map((section) => (
            <ObservabilitySectionBlock key={section.id} section={section} />
          ))}
          <Text className={styles.generatedAt} data-testid="pf-obs-generated-at">
            Generated {new Date(data.generated_at).toLocaleString()}
          </Text>
        </>
      ) : null}
    </div>
  )
}
