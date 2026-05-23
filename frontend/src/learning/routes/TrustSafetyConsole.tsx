import {
  Badge,
  Button,
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
  title: {
    fontFamily: 'Manrope, sans-serif',
    fontSize: '1.5rem',
    fontWeight: 800,
  },
  subtitle: { color: tokens.colorNeutralForeground2 },
  actions: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
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
    borderRadius: '12px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: '#fff',
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
    borderRadius: '14px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    display: 'grid',
    gap: '8px',
  },
  chartBox: { height: '260px', width: '100%' },
  canaryCard: {
    padding: '16px',
    borderRadius: '14px',
    border: '1px solid #0a0a0a',
    backgroundColor: '#f0fdfa',
    display: 'grid',
    gap: '10px',
  },
  canaryTitle: { fontWeight: 800, color: '#000000' },
  canaryStages: {
    display: 'flex',
    gap: '6px',
    flexWrap: 'wrap',
  },
  rollbackBtn: {
    backgroundColor: '#dc2626',
    color: '#fff',
  },
  auditCard: {
    padding: '16px',
    borderRadius: '14px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
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
    backgroundColor: '#e5e5e5',
    color: '#0a0a0a',
    padding: '2px 8px',
    borderRadius: '999px',
    fontSize: '0.7rem',
    fontWeight: 700,
    justifySelf: 'start',
  },
  riskBadgeReview: {
    backgroundColor: '#ededed',
    color: '#0a0a0a',
    padding: '2px 8px',
    borderRadius: '999px',
    fontSize: '0.7rem',
    fontWeight: 700,
    justifySelf: 'start',
  },
  riskBadgeHigh: {
    backgroundColor: '#1f1f1f',
    color: '#0a0a0a',
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
    padding: '12px 14px',
    borderRadius: '12px',
    backgroundColor: '#f5f5f5',
    border: '1px solid #0a0a0a',
    color: '#0a0a0a',
    fontWeight: 600,
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

  const cards = kpis?.cards ?? fixtureCards
  const source = kpis?.source ?? 'fixture'
  const provenanceCount = kpis?.provenance.length ?? 0

  return (
    <div className={styles.shell} data-testid="route-trust-safety">
      <div className={styles.header}>
        <div>
          <Text as="h1" className={styles.title}>
            Trust & Safety Console
          </Text>
          <Text className={styles.subtitle}>
            AI Governance Dashboard · safety evals, DSR SLA, provenance,
            canaries and audit evidence.
          </Text>
        </div>
        <div className={styles.actions}>
          <Button
            appearance="secondary"
            icon={<ArrowDownTrayIcon style={{ width: 16, height: 16 }} />}
          >
            Export signed bundle
          </Button>
          <Button
            appearance="primary"
            icon={<ShieldCheckIcon style={{ width: 16, height: 16 }} />}
          >
            Run red-team probe
          </Button>
        </div>
      </div>

      <div className={styles.govBanner}>
        <ShieldCheckIcon style={{ width: 18, height: 18 }} aria-hidden="true" />
        All gates green · canary at 25% · last red-team probe 2026-05-22
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
              <Badge
                appearance={source === 'fixture' ? 'outline' : 'filled'}
                size="small"
                data-testid="pilot-kpi-source-badge"
              >
                {source}
              </Badge>
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
          Showing offline fixture KPIs (backend unavailable: {kpiError}).
        </Text>
      )}
      {provenanceCount > 0 && (
        <Text size={200} data-testid="pilot-kpi-provenance">
          Provenance: {provenanceCount} source{provenanceCount === 1 ? '' : 's'}
          {kpis?.report.meets_pilot_thresholds === false &&
            ' · thresholds not yet met'}
        </Text>
      )}

      <div className={styles.twoCol}>
        <Card className={styles.chartCard}>
          <CardHeader
            header={<Text weight="semibold">Governance trends · last 6 weeks</Text>}
            description={
              <Text size={200}>Safety pass · DSR SLA · provenance coverage</Text>
            }
          />
          <div className={styles.chartBox}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={safetyTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="week" tick={{ fontSize: 12 }} />
                <YAxis domain={[95, 100]} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: '0.78rem' }} />
                <Line
                  type="monotone"
                  dataKey="safety"
                  stroke="#0a0a0a"
                  strokeWidth={2.5}
                />
                <Line
                  type="monotone"
                  dataKey="dsr"
                  stroke="#525252"
                  strokeWidth={2.5}
                />
                <Line
                  type="monotone"
                  dataKey="provenance"
                  stroke="#6366f1"
                  strokeWidth={2.5}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className={styles.canaryCard}>
          <Text className={styles.canaryTitle}>Release canary</Text>
          <Text size={200}>
            Shadow → 5% → 25% → ramp. Auto-rollback armed on safety regression.
          </Text>
          <div className={styles.canaryStages}>
            <Badge appearance="filled">Shadow ✓</Badge>
            <Badge appearance="filled">5% ✓</Badge>
            <Badge appearance="filled">25% ✓</Badge>
            <Badge appearance="outline">50%</Badge>
            <Badge appearance="outline">100%</Badge>
          </div>
          <Text size={200}>
            <strong>Auto-rollback triggers:</strong> safety {'<'} 98%, DSR SLA
            breach, provenance gap.
          </Text>
          <Button className={styles.rollbackBtn}>
            <ExclamationTriangleIcon
              style={{ width: 16, height: 16, marginRight: 6 }}
            />
            Manual rollback
          </Button>
        </Card>
      </div>

      <Card className={styles.auditCard}>
        <CardHeader
          header={<Text weight="semibold">Audit action log</Text>}
          description={
            <Text size={200}>
              Append-only · all entries signed and stored for 7 years.
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
