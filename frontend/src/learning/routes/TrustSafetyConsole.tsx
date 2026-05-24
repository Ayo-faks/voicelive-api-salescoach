import {
  Card,
  CardHeader,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  ArrowDownTrayIcon,
  ExclamationTriangleIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline'
import { useEffect, useState } from 'react'
import { getPilotKpis, type PilotKpiCard, type PilotKpiResponse } from '../api'
import { pilotMetrics } from '../fixtures'
import { pathfinderTokens as t } from '../theme/pathfinder-tokens'

const fixtureCards: PilotKpiCard[] = pilotMetrics.map(([label, value, detail]) => ({
  label,
  value,
  detail,
}))

const safetyTrend = [
  { week: 'W1', safety: 97.8, dsr: 100, provenance: 98 },
  { week: 'W2', safety: 98.2, dsr: 100, provenance: 99 },
  { week: 'W3', safety: 98.5, dsr: 100, provenance: 99 },
  { week: 'W4', safety: 99.0, dsr: 100, provenance: 100 },
  { week: 'W5', safety: 99.1, dsr: 100, provenance: 100 },
  { week: 'W6', safety: 99.3, dsr: 100, provenance: 100 },
]

const auditLog = [
  {
    ts: '2026-05-23 09:42',
    actor: 'teacher:ada.o',
    action: 'Approved plan plan-jss2-ratio-recovery',
    risk: 'low',
  },
  {
    ts: '2026-05-23 09:38',
    actor: 'agent:planner',
    action: 'Proposed intervention plan',
    risk: 'review',
  },
  {
    ts: '2026-05-23 09:22',
    actor: 'counsellor:mike.k',
    action: 'Signed off career narration career-plan-001',
    risk: 'low',
  },
  {
    ts: '2026-05-23 09:14',
    actor: 'system',
    action: 'Canary cohort raised to 25%',
    risk: 'low',
  },
  {
    ts: '2026-05-23 08:57',
    actor: 'agent:advisor',
    action: 'Typed refusal (PII suspected)',
    risk: 'high',
  },
]

const useStyles = makeStyles({
  shell: { display: 'grid', gap: '18px' },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: '16px',
    flexWrap: 'wrap',
  },
  headerCopy: {
    display: 'grid',
    gap: '10px',
  },
  title: {
    fontFamily: t.font.display,
    fontSize: 'clamp(1.6rem, 2.4vw, 2rem)',
    fontWeight: 700,
    letterSpacing: '-0.025em',
  },
  subtitle: { color: tokens.colorNeutralForeground2 },
  headerMeta: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
  },
  actions: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
  actionButton: {
    appearance: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    minHeight: '38px',
    paddingRight: '15px',
    paddingLeft: '15px',
    borderRadius: t.radius.pill,
    border: t.surface.hairline,
    backgroundColor: t.brand.surface,
    color: t.brand.text,
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.84rem',
    fontWeight: 700,
  },
  primaryActionButton: {
    appearance: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    minHeight: '38px',
    paddingRight: '15px',
    paddingLeft: '15px',
    borderRadius: t.radius.pill,
    border: `1px solid ${t.brand.ink}`,
    backgroundColor: t.brand.ink,
    color: t.brand.onInk,
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.84rem',
    fontWeight: 700,
  },
  pill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    minHeight: '24px',
    paddingRight: '10px',
    paddingLeft: '10px',
    borderRadius: t.radius.pill,
    border: t.surface.hairline,
    backgroundColor: t.surface.cardMuted,
    color: t.brand.textSecondary,
    boxSizing: 'border-box',
    fontSize: '0.72rem',
    fontWeight: 700,
    lineHeight: 1.35,
    whiteSpace: 'nowrap',
    overflowWrap: 'normal',
  },
  pillSolid: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    minHeight: '24px',
    paddingRight: '10px',
    paddingLeft: '10px',
    borderRadius: t.radius.pill,
    border: `1px solid ${t.brand.ink}`,
    backgroundColor: t.brand.ink,
    color: t.brand.onInk,
    boxSizing: 'border-box',
    fontSize: '0.72rem',
    fontWeight: 700,
    lineHeight: 1.35,
    whiteSpace: 'nowrap',
    overflowWrap: 'normal',
  },
  metricStrip: {
    display: 'grid',
    gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
    gap: '10px',
    '@media (max-width: 1100px)': {
      gridTemplateColumns: 'repeat(3, 1fr)',
    },
    '@media (max-width: 640px)': {
      gridTemplateColumns: 'repeat(2, 1fr)',
    },
  },
  metricCard: {
    padding: '14px',
    borderRadius: t.radius.md,
    border: t.surface.hairline,
    backgroundColor: t.surface.card,
    boxShadow: t.surface.cardElevatedShadow,
    display: 'grid',
    gap: '4px',
  },
  metricLabel: {
    fontSize: '0.7rem',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    color: tokens.colorNeutralForeground2,
  },
  metricValue: { fontSize: '1.4rem', fontWeight: 800 },
  metricDetail: {
    fontSize: '0.72rem',
    color: tokens.colorNeutralForeground3,
  },
  twoCol: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)',
    gap: '16px',
    '@media (max-width: 1000px)': { gridTemplateColumns: '1fr' },
  },
  chartCard: {
    padding: '16px',
    borderRadius: t.radius.md,
    border: t.surface.hairline,
    boxShadow: t.surface.cardElevatedShadow,
    display: 'grid',
    gap: '8px',
  },
  chartBox: { height: '260px', width: '100%' },
  canaryCard: {
    padding: '16px',
    borderRadius: t.radius.md,
    border: t.surface.hairline,
    borderLeft: `3px solid ${t.status.okFg}`,
    backgroundColor: t.surface.card,
    boxShadow: t.surface.cardElevatedShadow,
    display: 'grid',
    gap: '10px',
  },
  canaryTitle: { fontWeight: 800, color: t.brand.text },
  canaryStages: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    flexWrap: 'wrap',
  },
  canaryStage: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: '26px',
    paddingRight: '9px',
    paddingLeft: '9px',
    borderRadius: t.radius.pill,
    border: t.surface.hairline,
    backgroundColor: t.surface.cardMuted,
    color: t.brand.textSecondary,
    boxSizing: 'border-box',
    fontSize: '0.72rem',
    fontWeight: 700,
    lineHeight: 1.35,
    whiteSpace: 'nowrap',
  },
  canaryStageComplete: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: '26px',
    paddingRight: '9px',
    paddingLeft: '9px',
    borderRadius: t.radius.pill,
    border: `1px solid ${t.brand.ink}`,
    boxSizing: 'border-box',
    fontSize: '0.72rem',
    fontWeight: 700,
    lineHeight: 1.35,
    whiteSpace: 'nowrap',
    backgroundColor: t.brand.ink,
    color: t.brand.onInk,
  },
  rollbackBtn: {
    appearance: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    justifySelf: 'start',
    minHeight: '38px',
    paddingRight: '15px',
    paddingLeft: '15px',
    borderRadius: t.radius.pill,
    fontWeight: 700,
    backgroundColor: t.brand.surface,
    color: t.status.criticalFg,
    border: `1px solid ${t.status.criticalFg}`,
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.84rem',
    ':hover': {
      backgroundColor: t.status.criticalBg,
      color: t.status.criticalFg,
      border: `1px solid ${t.status.criticalFg}`,
    },
  },
  auditCard: {
    padding: '16px',
    borderRadius: t.radius.md,
    border: t.surface.hairline,
    boxShadow: t.surface.cardElevatedShadow,
    display: 'grid',
    gap: '8px',
  },
  auditTable: {
    width: '100%',
    borderCollapse: 'separate',
    borderSpacing: 0,
  },
  auditRow: {
    display: 'grid',
    gridTemplateColumns: '120px 130px 1fr 80px',
    gap: '8px',
    padding: '8px 0',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    fontSize: '0.78rem',
    alignItems: 'center',
    '@media (max-width: 700px)': { gridTemplateColumns: '1fr' },
  },
  auditTs: { color: tokens.colorNeutralForeground3, fontVariantNumeric: 'tabular-nums' },
  auditActor: { fontWeight: 700 },
  riskBadgeLow: {
    backgroundColor: t.risk.low.bg,
    color: t.risk.low.fg,
    padding: '2px 8px',
    borderRadius: '999px',
    fontSize: '0.7rem',
    fontWeight: 700,
    justifySelf: 'start',
  },
  riskBadgeReview: {
    backgroundColor: t.risk.review.bg,
    color: t.risk.review.fg,
    padding: '2px 8px',
    borderRadius: '999px',
    fontSize: '0.7rem',
    fontWeight: 700,
    justifySelf: 'start',
  },
  riskBadgeHigh: {
    backgroundColor: t.risk.high.fg,
    color: t.brand.onInk,
    padding: '2px 8px',
    borderRadius: '999px',
    fontSize: '0.7rem',
    fontWeight: 700,
    justifySelf: 'start',
  },
  govBanner: {
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
    flexWrap: 'wrap',
    padding: '12px 14px',
    borderRadius: t.radius.md,
    backgroundColor: t.surface.card,
    border: t.surface.hairline,
    boxShadow: t.surface.cardElevatedShadow,
    color: t.brand.text,
    fontWeight: 600,
  },
  govBannerMeta: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
  },
})

function riskClass(
  styles: ReturnType<typeof useStyles>,
  r: string
): string {
  if (r === 'high') return styles.riskBadgeHigh
  if (r === 'review') return styles.riskBadgeReview
  return styles.riskBadgeLow
}

function kpiLabel(label: string) {
  if (label.toLowerCase() === 'provenance coverage') return 'Evidence coverage'
  if (label.toLowerCase() === 'dsr sla') return 'Data request SLA'
  return label
}

export default function TrustSafetyConsole() {
  const styles = useStyles()
  const [kpis, setKpis] = useState<PilotKpiResponse | null>(null)
  const [kpiError, setKpiError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getPilotKpis()
      .then(payload => {
        if (!cancelled) {
          setKpis(payload)
          setKpiError(null)
        }
      })
      .catch(err => {
        if (!cancelled) {
          setKpiError((err as Error).message)
          setKpis(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const cards = (kpis?.cards ?? fixtureCards).map(card => ({
    ...card,
    label: kpiLabel(card.label),
  }))
  const source = kpis?.source ?? 'fixture'
  const provenanceCount = kpis?.provenance.length ?? 0
  const sourceLabel = source === 'live' ? 'Live' : 'Snapshot'

  return (
    <div className={styles.shell} data-testid="route-trust-safety">
      <div className={styles.header}>
        <div className={styles.headerCopy}>
          <Text as="h1" className={styles.title}>
            Trust & Safety Console
          </Text>
          <div className={styles.headerMeta} aria-label="Governance context">
            <span className={styles.pill}>Safety</span>
            <span className={styles.pill}>Privacy response</span>
            <span className={styles.pill}>Release readiness</span>
            <span className={styles.pill}>{sourceLabel} evidence</span>
            <span className={styles.pill}>{provenanceCount} provenance signals</span>
          </div>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.actionButton}>
            <ArrowDownTrayIcon style={{ width: 16, height: 16 }} aria-hidden="true" />
            Export report
          </button>
          <button type="button" className={styles.primaryActionButton}>
            <ShieldCheckIcon style={{ width: 16, height: 16 }} aria-hidden="true" />
            Run safety review
          </button>
        </div>
      </div>

      <div className={styles.govBanner}>
        <ShieldCheckIcon style={{ width: 18, height: 18 }} aria-hidden="true" />
        <div className={styles.govBannerMeta} aria-label="Release status">
          <span className={styles.pillSolid}>All gates green</span>
          <span className={styles.pill}>25% controlled rollout</span>
          <span className={styles.pill}>Last review 2026-05-22</span>
        </div>
      </div>

      <div className={styles.metricStrip} data-testid="pilot-kpi-strip">
        {cards.map(card => (
          <Card key={card.label} className={styles.metricCard} data-testid="pilot-kpi-card">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <Text className={styles.metricLabel}>{card.label}</Text>
              <span
                className={source === 'fixture' ? styles.pill : styles.pillSolid}
                data-testid="pilot-kpi-source-badge"
              >
                {sourceLabel}
              </span>
            </div>
            <Text className={styles.metricValue}>{card.value}</Text>
            <Text className={styles.metricDetail}>{card.detail}</Text>
          </Card>
        ))}
      </div>
      {kpiError && (
        <Text
          size={200}
          style={{ color: tokens.colorPaletteRedForeground1 }}
          data-testid="pilot-kpi-error"
        >
          Showing the latest saved KPI snapshot while live metrics reconnect.
        </Text>
      )}
      {provenanceCount > 0 && (
        <Text size={200} data-testid="pilot-kpi-provenance">
          Evidence coverage: {provenanceCount} source{provenanceCount === 1 ? '' : 's'}
          {kpis?.report.meets_pilot_thresholds === false &&
            ' · review thresholds not yet met'}
        </Text>
      )}

      <div className={styles.twoCol}>
        <Card className={styles.chartCard}>
          <CardHeader
            header={<Text weight="semibold">Governance trends · last 6 weeks</Text>}
            description={
              <Text size={200}>Safety pass rate · data request SLA · evidence coverage</Text>
            }
          />
          <div className={styles.chartBox}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={safetyTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke={t.brand.line} />
                <XAxis dataKey="week" tick={{ fontSize: 12, fill: t.brand.textTertiary }} />
                <YAxis domain={[95, 100]} tick={{ fontSize: 12, fill: t.brand.textTertiary }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: '0.78rem' }} />
                <Line
                  type="monotone"
                  dataKey="safety"
                  name="Safety pass rate"
                  stroke={t.brand.ink}
                  strokeWidth={2.5}
                />
                <Line
                  type="monotone"
                  dataKey="dsr"
                  name="Data requests"
                  stroke={t.brand.inkMuted}
                  strokeWidth={2.5}
                  strokeDasharray="5 4"
                />
                <Line
                  type="monotone"
                  dataKey="provenance"
                  name="Evidence coverage"
                  stroke={t.brand.textSecondary}
                  strokeWidth={2.5}
                  strokeDasharray="2 5"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className={styles.canaryCard}>
          <Text className={styles.canaryTitle}>Release rollout</Text>
          <Text size={200}>
            Private review → 5% → 25% → wider release. Rollback is armed for any safety regression.
          </Text>
          <div className={styles.canaryStages}>
            <span className={styles.canaryStageComplete}>Private review ✓</span>
            <span className={styles.canaryStageComplete}>5% ✓</span>
            <span className={styles.canaryStageComplete}>25% ✓</span>
            <span className={styles.canaryStage}>50%</span>
            <span className={styles.canaryStage}>100%</span>
          </div>
          <Text size={200}>
            <strong>Rollback triggers:</strong> safety {'<'} 98%, data request SLA
            breach, evidence gap.
          </Text>
          <button type="button" className={styles.rollbackBtn}>
            <ExclamationTriangleIcon
              style={{ width: 16, height: 16, marginRight: 6 }}
              aria-hidden="true"
            />
            Pause rollout
          </button>
        </Card>
      </div>

      <Card className={styles.auditCard}>
        <CardHeader
          header={<Text weight="semibold">Audit action log</Text>}
          description={
            <Text size={200}>
              Signed history kept for compliance review.
            </Text>
          }
        />
        <div className={styles.auditRow} style={{ fontWeight: 700 }}>
          <span>Timestamp</span>
          <span>Actor</span>
          <span>Action</span>
          <span>Risk</span>
        </div>
        {auditLog.map(row => (
          <div key={`${row.ts}-${row.actor}`} className={styles.auditRow}>
            <span className={styles.auditTs}>{row.ts}</span>
            <span className={styles.auditActor}>{row.actor}</span>
            <span>{row.action}</span>
            <span className={riskClass(styles, row.risk)}>{row.risk}</span>
          </div>
        ))}
      </Card>
    </div>
  )
}
